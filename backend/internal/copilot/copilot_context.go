// Package copilot —— 对话上下文装配模块。
//
// 职责：
//   - 把"存储里的历史消息"投影成 LLM 可消费的 []modelprov.ChatMessage（窗口化 + 工具摘要折叠）
//   - 把 RAG 命中转成 citations（带 tier/score/quote hash 等可审计字段）
//   - 召回跨会话记忆（retrieveMemoryForTurnLocked）并落"memory.budget"报表
//   - 给数字伙伴拼 system prompt（人格 + 记忆 + RAG + 推理强度）
//   - 维护"memory.recall 工具"在已预注入记忆时的禁用策略
//
// 该模块是 SSE 流的事实"上游"：system prompt / 记忆 / RAG 都在这里定型，
// 下游 runReactTurn/runPlanExecuteTurn 只负责把这些输入跑完。
package copilot

import (
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/knowledge/citation"
	membudget "github.com/qizhida-partner-platform/backend/internal/memory/budget"
	memret "github.com/qizhida-partner-platform/backend/internal/memory/retrieval"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

const (
	copilotHistoryMaxMessages = 24 // ~12 轮（与前端 COPILOT_LLM_HISTORY_MESSAGES 对齐）
	copilotHistoryMaxRunes    = 1200
	copilotHistoryPriorRunes  = 600 // 较早轮次更短，为最近轮留出 token
	copilotMemoryMaxItems     = 5
	copilotMemoryMaxRunes     = 400
	copilotMemoryBudgetTokens = 1000 // 跨会话记忆合计 token 上限（≈ 5 条 × 200 token）
	copilotMemoryPriorityBase = 1    // long_term=3, working=2, short_term=1
	copilotToolSummaryRunes   = 200  // 历史工具观察摘要（每条工具）
)

// assembleCopilotChatMessages projects stored conversation messages into LLM turns.
// stored should already include the current user message as the last entry.
// Prior turns are windowed; the current user turn is always kept.
func assembleCopilotChatMessages(stored []map[string]any) []modelprov.ChatMessage {
	if len(stored) == 0 {
		return nil
	}
	stored = mergeStoredAssistantTurns(stored)
	start := 0
	if len(stored) > copilotHistoryMaxMessages {
		start = len(stored) - copilotHistoryMaxMessages
	}
	window := stored[start:]
	out := make([]modelprov.ChatMessage, 0, len(window))
	for i, m := range window {
		role := strings.ToLower(strings.TrimSpace(str(m["role"])))
		content := strings.TrimSpace(str(m["content"]))
		if content == "" && role != "assistant" {
			continue
		}
		switch role {
		case "user":
			out = append(out, modelprov.ChatMessage{
				Role:    "user",
				Content: truncateRunes(content, copilotHistoryMaxRunes),
			})
		case "assistant":
			body := content
			if summary := toolCallsSummary(m["toolCalls"]); summary != "" {
				if body != "" {
					body += "\n"
				}
				body += summary
			}
			if body == "" {
				continue
			}
			limit := copilotHistoryMaxRunes
			if i < len(window)-1 {
				limit = copilotHistoryPriorRunes
			}
			out = append(out, modelprov.ChatMessage{
				Role:    "assistant",
				Content: truncateRunes(body, limit),
			})
		case "tool", "system":
			// Phase 0: fold tool/system into assistant summaries only.
			continue
		default:
			continue
		}
	}
	if len(out) == 0 {
		return nil
	}
	// Ensure last message is the current user turn when possible.
	return out
}

func toolCallsSummary(raw any) string {
	items := knowledgeSliceMaps(raw)
	if len(items) == 0 {
		if arr, ok := raw.([]any); ok {
			for _, x := range arr {
				if m, ok := x.(map[string]any); ok {
					items = append(items, m)
				}
			}
		}
	}
	if len(items) == 0 {
		return ""
	}
	perTool := copilotToolSummaryRunes
	if len(items) > 1 {
		perTool = copilotToolSummaryRunes / len(items)
		if perTool < 48 {
			perTool = 48
		}
	}
	parts := make([]string, 0, len(items))
	for _, tc := range items {
		name := coalesce(str(tc["name"]), "tool")
		status := coalesce(str(tc["status"]), "ok")
		part := name + "(" + status + ")"
		if snippet := toolResultSnippet(tc, perTool); snippet != "" {
			part += "：" + snippet
		}
		parts = append(parts, part)
	}
	return "【本回合工具】" + strings.Join(parts, "、")
}

func toolResultSnippet(tc map[string]any, maxRunes int) string {
	raw := strings.TrimSpace(coalesce(str(tc["result"]), str(tc["output"])))
	if raw == "" {
		return ""
	}
	return truncateRunes(raw, maxRunes)
}

func citationsFromRagHits(ragHits any) []map[string]any {
	results := ragHitResults(ragHits)
	if len(results) == 0 {
		return nil
	}
	now := time.Now().UTC()
	hits := make([]citation.Hit, 0, len(results))
	for _, h := range results {
		docID := coalesce(str(h["docId"]), str(h["id"]))
		if docID == "" {
			continue
		}
		hits = append(hits, citation.Hit{
			ID:        str(h["id"]),
			DocID:     docID,
			ChunkID:   str(h["chunkId"]),
			Source:    firstNonEmptyStr(str(h["source"]), str(h["title"]), "knowledge"),
			Title:     str(h["title"]),
			Tier:      citationTierFromDocStatus(str(h["status"])),
			Score:     toFloat(h["score"]),
			Snippet:   coalesce(str(h["snippet"]), str(h["text"])),
			EvalRunID: str(h["evalRunId"]),
		})
	}
	cites := citation.Build(hits, now)
	out := make([]map[string]any, 0, len(cites))
	for _, c := range cites {
		out = append(out, map[string]any{
			"id":          c.ID,
			"docId":       c.DocID,
			"chunkId":     c.ChunkID,
			"source":      c.Source,
			"title":       c.Title,
			"tier":        string(c.Tier),
			"score":       c.Score,
			"quoted":      c.Quoted,
			"charStart":   c.CharStart,
			"charEnd":     c.CharEnd,
			"quoteHash":   c.QuoteHash,
			"retrievedAt": c.RetrievedAt.Format(time.RFC3339),
			"evalRunId":   c.EvalRunID,
		})
	}
	return out
}

func citationTierFromDocStatus(status string) citation.Tier {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "published":
		return citation.TierPublished
	case "ready":
		return citation.TierReview
	case "draft", "archived":
		return citation.TierWorkspace
	}
	return citation.TierReview
}

func firstNonEmptyStr(vs ...string) string {
	for _, v := range vs {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func ragHitResults(ragHits any) []map[string]any {
	m, ok := ragHits.(map[string]any)
	if !ok || m == nil {
		return nil
	}
	return knowledgeSliceMaps(m["results"])
}

func knowledgeToolCallFromHits(ragHits any, durationMs int) map[string]any {
	backend := "published-memory"
	query := ""
	hitCount := 0
	if m, ok := ragHits.(map[string]any); ok && m != nil {
		backend = coalesce(str(m["backend"]), backend)
		query = str(m["query"])
		hitCount = len(ragHitResults(ragHits))
	}
	return map[string]any{
		"id":   "tc_knowledge_retrieve",
		"name": "knowledge.retrieve",
		"args": map[string]any{
			"backend":  backend,
			"query":    query,
			"hitCount": hitCount,
		},
		"status":     "success",
		"durationMs": durationMs,
	}
}

// memoryHit 是注入到 system prompt 的"一条记忆"的最终形状。
//
// 字段语义：
//   - ID/Source —— 至少有一个不为空：用于审计追溯（system prompt 行尾括号里打印）
//   - Title     —— 记忆标题，可在 prompt 里以"- {title}：{content}"展示
//   - Content   —— 已按 copilotMemoryMaxRunes 截断后的正文
//   - Layer     —— short_term / working / long_term，决定排序权重
//   - Score     —— 来自 BM25+ MMR 综合分；空查询走兜底时给个 0.3~0.5 的基础分
type memoryHit struct {
	ID      string
	Title   string
	Content string
	Layer   string
	Score   float64
	Source  string
}

type memRecord struct {
	id, title, content, layer, sourceID string
}

// memoryProvenanceMaps turns injected hits into white-box audit rows for SSE / message store.
func memoryProvenanceMaps(hits []memoryHit) []map[string]any {
	if len(hits) == 0 {
		return nil
	}
	out := make([]map[string]any, 0, len(hits))
	for _, h := range hits {
		out = append(out, map[string]any{
			"id":    coalesce(h.ID, h.Source),
			"title": h.Title,
			"layer": h.Layer,
			"score": h.Score,
		})
	}
	return out
}

// retrieveMemoryForTurnLocked 是跨会话记忆召回的主入口。
//
// 前置条件：调用方须持 Store.RLock 或 Store.Lock（与 ingestRuntimeMemoryLocked
// 在并发写入上互斥，避免读到半结构化的 m）。
//
// 召回流程：
//  1. 过滤：workspace 一致 + status=active + 未过期 + MemoryCanRead 通过 +
//     layer ∈ {short_term, working, long_term}
//  2. DE-id 严格隔离：memDE 非空且 ≠ deID 直接 skip（修复了旧逻辑"DE-less
//     记录漏给所有专家"的越权 bug）
//  3. short_term 的同会话切片按 excludeSourceID 去重，避免与 Messages 双写
//  4. short_term user 范围只保留 owner 一致，避免跨用户泄漏
//  5. 召回策略分两路：
//     - 无 query tokens → 按 layer 排序取 working/long_term（跨会话兜底）
//     - 有 query tokens → memret.Score（BM25 + MMR）→ membudget.Select 受 token 预算约束
//  6. 每次都通过 recordMemoryBudgetReport 留痕——空召回也要写一条零报表，
//     让 SSE 端能稳定拿到 memory.budget 事件、便于排查"为什么不显示记忆"
func (s *Service) retrieveMemoryForTurnLocked(ws, ownerID, deID, excludeSourceID, query string, viewer *auth.Identity) []memoryHit {
	now := time.Now().UTC()
	var pool []memRecord
	qTokens := tokenizeQuery(query)

	for _, m := range s.Store.MemoryRecords {
		if str(m["workspaceId"]) != ws {
			continue
		}
		if str(m["status"]) != "active" {
			continue
		}
		if s.Deps.MemoryCanReadFn != nil && !s.Deps.MemoryCanReadFn(viewer, m) {
			continue
		}
		layer := str(m["layer"])
		if layer != "short_term" && layer != "working" && layer != "long_term" {
			continue
		}
		if exp := str(m["expiresAt"]); exp != "" {
			if t, err := time.Parse(time.RFC3339, exp); err == nil && now.After(t) {
				continue
			}
		}
		memDE := str(m["digitalPartnerId"])
		// DE-id scoping must be strict: when the specialist is bound to a
		// specific digital employee, unkeyed memories (memDE=="" — legacy
		// admin ingest, task writes without DE) must NOT leak across every
		// specialist. The old guard `deID != "" && memDE != "" && memDE != deID`
		// short-circuited to false when memDE=="" so DE-less records were
		// surfaced to every specialist regardless of which DE was queried.
		if deID != "" && memDE != deID {
			continue
		}
		sourceID := str(m["sourceId"])
		// Avoid duplicating the active conversation transcript already in Messages.
		if layer == "short_term" && excludeSourceID != "" && sourceID == excludeSourceID {
			continue
		}
		title := str(m["title"])
		content := str(m["content"])
		// Prefer owner-scoped short_term for the same user.
		if layer == "short_term" && ownerID != "" && str(m["ownerId"]) != ownerID && str(m["scope"]) == "user" {
			continue
		}
		pool = append(pool, memRecord{
			id:       str(m["id"]),
			title:    title,
			content:  content,
			layer:    layer,
			sourceID: sourceID,
		})
	}

	if len(pool) == 0 {
		// No candidates at all (filtered by workspace/scope/layer/de-id).
		// Surface a zero report for the same reason as the BM25-empty case:
		// downstream consumers rely on every retrieval — even an empty one —
		// leaving a trace so participant memory.budget events line up.
		s.recordMemoryBudgetReport(deID, &membudget.Report{})
		return nil
	}

	// No query tokens: keep working/long_term for cross-session continuity.
	if len(qTokens) == 0 {
		var keep []memRecord
		for _, r := range pool {
			if r.layer == "working" || r.layer == "long_term" {
				keep = append(keep, r)
			}
		}
		sort.SliceStable(keep, func(i, j int) bool { return layerRank(keep[i].layer) > layerRank(keep[j].layer) })
		if len(keep) > copilotMemoryMaxItems {
			keep = keep[:copilotMemoryMaxItems]
		}
		out := make([]memoryHit, 0, len(keep))
		for _, k := range keep {
			out = append(out, memoryHit{
				ID:      k.id,
				Title:   k.title,
				Content: truncateRunes(k.content, copilotMemoryMaxRunes),
				Layer:   k.layer,
				Score:   0.3 + 0.1*float64(layerRank(k.layer)),
				Source:  coalesce(k.sourceID, k.id),
			})
		}
		return out
	}

	// Real BM25 + MMR over the filtered corpus.
	corpus := make([]memret.Doc, len(pool))
	for i, r := range pool {
		corpus[i] = memret.Doc{ID: r.id, Title: r.title, Content: r.content, Layer: r.layer}
	}
	scored := memret.Score(corpus, memret.Query{Text: query, TopK: copilotMemoryMaxItems, FetchK: 20, Lambda: 0.7})
	if len(scored) == 0 {
		// No candidates: still surface a (zero) report so operators can
		// distinguish "memory pool is empty" from "memory.budget event
		// never fired". The drain block downstream relies on every
		// retrieval attempt producing an entry.
		s.recordMemoryBudgetReport(deID, &membudget.Report{})
		return nil
	}
	cands := make([]membudget.Candidate, 0, len(scored))
	for _, sd := range scored {
		cands = append(cands, membudget.Candidate{
			ID:        sd.ID,
			Title:     sd.Title,
			Content:   sd.Content,
			Score:     sd.Final,
			Priority:  memPriority(sd.Layer),
			Source:    sourceForMemID(pool, sd.ID),
			RecencyNs: memRecencyNs(sd),
		})
	}
	items, report := membudget.Select(cands, copilotMemoryBudgetTokens, 0.5)
	out := make([]memoryHit, 0, len(items))
	for _, it := range items {
		out = append(out, memoryHit{
			ID:      it.ID,
			Title:   it.Title,
			Content: it.Content,
			Layer:   memLayerForID(pool, it.ID),
			Score:   it.Score,
			Source:  it.Source,
		})
	}
	// Surface the budget decision so operators can explain silent memory
	// recall gaps. Budget truncation/drop happens; if the audit trail doesn't
	// say so, debuggers have to reverse-engineer the policy from logs.
	s.recordMemoryBudgetReport(deID, &membudget.Report{
		UsedTokens:     report.UsedTokens,
		Kept:           report.Kept,
		TruncatedItems: report.TruncatedItems,
		DroppedIDs:     report.DroppedIDs,
	})
	return out
}

// memoryBudgetReport is the observability tail of one memory retrieval pass.
// Stored on Server so copilot_stream can flush it as a SSE event after the
// memory section of the system prompt has been built.
type memoryBudgetReport struct {
	BudgetTokens   int
	UsedTokens     int
	Kept           int
	Dropped        int
	TruncatedItems int
	DroppedIDs     []string
}

// consumeLastMemoryBudgetReport 原子地读出 lastMemoryBudgetReport 并清空 slot。
// 用于 SSE flush，避免与并发 recordMemoryBudgetReport 写者撞 race。
func (s *Service) consumeLastMemoryBudgetReport() *memoryBudgetReport {
	s.participantMemoryBudgetMu.Lock()
	rep := s.lastMemoryBudgetReport
	s.lastMemoryBudgetReport = nil
	s.participantMemoryBudgetMu.Unlock()
	return rep
}

// recordMemoryBudgetReport stores one report on the single-slot (for the
// supervisor SSE flush in handlers_c.go) AND, when deID is set, into the
// per-participant collector (for the runMultiAgentTurn drain block).
//
// Called from retrieveMemoryForTurnLocked so every retrieval — even an
// empty one — leaves a trace; the per-turn drain relies on entries always
// being written.
func (s *Service) recordMemoryBudgetReport(deID string, r *membudget.Report) {
	if r == nil {
		return
	}
	rep := &memoryBudgetReport{
		BudgetTokens:   copilotMemoryBudgetTokens,
		UsedTokens:     r.UsedTokens,
		Kept:           r.Kept,
		Dropped:        len(r.DroppedIDs),
		TruncatedItems: r.TruncatedItems,
		DroppedIDs:     append([]string(nil), r.DroppedIDs...),
	}
	// lastMemoryBudgetReport 与 participantMemoryBudgetReports 共用同一把 mutex：
	// 单 slot 字段在并发 wecom webhook 下也会被同时读写，必须加锁。
	s.participantMemoryBudgetMu.Lock()
	s.lastMemoryBudgetReport = rep
	if deID == "" {
		s.participantMemoryBudgetMu.Unlock()
		return
	}
	if s.participantMemoryBudgetReports == nil {
		s.participantMemoryBudgetReports = map[string]*memoryBudgetReport{}
	}
	s.participantMemoryBudgetReports[deID] = rep
	s.participantMemoryBudgetMu.Unlock()
}

func memPriority(layer string) int {
	switch layer {
	case "long_term":
		return copilotMemoryPriorityBase + 2
	case "working":
		return copilotMemoryPriorityBase + 1
	default:
		return copilotMemoryPriorityBase
	}
}

// memRecencyNs uses the doc's update hint if present in pool; otherwise
// the retrieval engine doesn't carry a timestamp, so fall back to 0.
func memRecencyNs(sd memret.ScoredDoc) int64 { return 0 }

func memLayerForID(pool []memRecord, id string) string {
	for _, r := range pool {
		if r.id == id {
			return r.layer
		}
	}
	return ""
}

func sourceForMemID(pool []memRecord, id string) string {
	for _, r := range pool {
		if r.id == id {
			return coalesce(r.sourceID, r.id)
		}
	}
	return id
}

func layerRank(layer string) int {
	switch layer {
	case "long_term":
		return 3
	case "working":
		return 2
	case "short_term":
		return 1
	default:
		return 0
	}
}

func tokenizeQuery(q string) []string {
	q = strings.ToLower(strings.TrimSpace(q))
	if q == "" {
		return nil
	}
	var tokens []string
	var b strings.Builder
	var han strings.Builder
	flush := func() {
		t := b.String()
		b.Reset()
		if t == "" {
			return
		}
		runes := []rune(t)
		if len(runes) == 1 && unicode.Is(unicode.Han, runes[0]) {
			tokens = append(tokens, t)
			return
		}
		if len(runes) >= 2 {
			tokens = append(tokens, t)
		}
	}
	flushHanBigrams := func() {
		rs := []rune(han.String())
		han.Reset()
		for i := 0; i+1 < len(rs); i++ {
			if unicode.Is(unicode.Han, rs[i]) && unicode.Is(unicode.Han, rs[i+1]) {
				tokens = append(tokens, string(rs[i:i+2]))
			}
		}
	}
	for _, r := range q {
		if unicode.Is(unicode.Han, r) {
			flush()
			tokens = append(tokens, string(r))
			han.WriteRune(r)
			continue
		}
		flushHanBigrams()
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			continue
		}
		flush()
	}
	flush()
	flushHanBigrams()
	return uniqueStrings(tokens)
}

func uniqueStrings(in []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

func buildCopilotSystemPrompt(emp map[string]any, ragHits any, memoryHits []memoryHit) string {
	return buildCopilotSystemPromptWithEffort(emp, ragHits, memoryHits, "")
}

func reasoningEffortGuidance(effort string) string {
	switch strings.ToLower(strings.TrimSpace(effort)) {
	case "off":
		return "推理强度：直接给出结论，不要展开冗长链式思考；必要时用一两句说明依据即可。\n"
	case "deep":
		return "推理强度：请深入分析，必要时分步说明假设、证据与权衡，再给出可执行结论。\n"
	case "standard", "":
		return ""
	default:
		return ""
	}
}

func buildCopilotSystemPromptWithEffort(emp map[string]any, ragHits any, memoryHits []memoryHit, reasoningEffort string) string {
	var b strings.Builder
	if emp != nil && emp["skipped"] != true && emp["active"] != false {
		name := coalesce(str(emp["name"]), "数字伙伴")
		role := coalesce(str(emp["role"]), str(emp["title"]))
		dept := str(emp["department"])
		b.WriteString("你是「")
		b.WriteString(name)
		b.WriteString("」。\n")
		if role != "" {
			b.WriteString("岗位：")
			b.WriteString(role)
			if dept != "" {
				b.WriteString(" · ")
				b.WriteString(dept)
			}
			b.WriteString("\n")
		}
		if desc := str(emp["description"]); desc != "" {
			b.WriteString("职责说明：")
			b.WriteString(desc)
			b.WriteString("\n")
		}
		if resp := stringSlice(emp["responsibilities"]); len(resp) > 0 {
			b.WriteString("职责边界：")
			b.WriteString(strings.Join(resp, "、"))
			b.WriteString("\n")
		}
		if proh := stringSlice(emp["prohibitedActions"]); len(proh) > 0 {
			b.WriteString("禁止行为：")
			b.WriteString(strings.Join(proh, "、"))
			b.WriteString("\n")
		}
		b.WriteString("请用中文简洁、可执行地回答，严格遵守岗位边界；涉及审批、写操作或敏感数据时提示人工接管。\n")
		b.WriteString("若用户使用「刚才/上面/之前」等指代，请结合对话历史与跨会话记忆作答，不要假装遗忘。\n")
	} else {
		b.WriteString("你是企业企智搭 · 数字伙伴平台的协作助手。请用中文简洁、可执行地回答。\n")
		b.WriteString("若用户使用「刚才/上面/之前」等指代，请结合对话历史与跨会话记忆作答。\n")
	}
	if g := reasoningEffortGuidance(reasoningEffort); g != "" {
		b.WriteString(g)
	}
	if len(memoryHits) > 0 {
		b.WriteString("\n跨会话记忆（按相关性，可修正；括号内为记忆 ID，便于审计追溯）：\n")
		for i, hit := range memoryHits {
			if i >= copilotMemoryMaxItems {
				break
			}
			b.WriteString("- [")
			b.WriteString(hit.Layer)
			b.WriteString("]")
			if mid := coalesce(hit.ID, hit.Source); mid != "" {
				b.WriteString("(")
				b.WriteString(mid)
				b.WriteString(") ")
			} else {
				b.WriteString(" ")
			}
			if hit.Title != "" {
				b.WriteString(hit.Title)
				b.WriteString("：")
			}
			b.WriteString(hit.Content)
			b.WriteString("\n")
		}
	}
	if snippets := ragSnippetsForPrompt(ragHits); len(snippets) > 0 {
		b.WriteString("\n已检索已发布知识（仅供参考，与记忆分栏）：\n")
		for i, sn := range snippets {
			if i >= 5 {
				break
			}
			b.WriteString("- ")
			b.WriteString(sn)
			b.WriteString("\n")
		}
	}
	return strings.TrimSpace(b.String())
}

func lastUserContent(messages []modelprov.ChatMessage) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			return messages[i].Content
		}
	}
	return ""
}

func ragHitCount(ragHits any) int {
	return len(ragHitResults(ragHits))
}

func ragDegradeWarning(ragHits any) string {
	m, _ := ragHits.(map[string]any)
	if m == nil {
		return ""
	}
	if b, ok := m["degraded"].(bool); ok && b {
		return coalesce(str(m["warning"]), "向量检索已降级")
	}
	return ""
}

func registryHasEnabledTool(registry []registeredTool, name string) bool {
	for _, t := range registry {
		if t.Enabled && (t.Name == name || t.Key == "builtin:"+name) {
			return true
		}
	}
	return false
}

// filterRegistrySkipMemoryRecall 已在 system 注入记忆时禁用 memory.recall，避免重复 token。
func filterRegistrySkipMemoryRecall(registry []registeredTool, memoryPrefetched bool) []registeredTool {
	if !memoryPrefetched {
		return registry
	}
	out := make([]registeredTool, 0, len(registry))
	for _, t := range registry {
		if t.Enabled && (t.Name == "memory.recall" || t.Key == "builtin:memory.recall") {
			clone := t
			clone.Enabled = false
			out = append(out, clone)
			continue
		}
		out = append(out, t)
	}
	return out
}

// shouldIngestTurnMemory 控制 short_term 写入频率，避免与 Messages 全量双写冗余。
func shouldIngestTurnMemory(stored []map[string]any, userMsg, assistantText string, toolCalls []map[string]any) bool {
	if len(toolCalls) > 0 {
		return true
	}
	if len(stored) <= 2 {
		return true
	}
	// 约每 2 轮（4 条消息）写一次，或内容较长时写
	if len(stored)%4 == 0 {
		return true
	}
	combined := len([]rune(userMsg + assistantText))
	return combined >= 400
}

func toolCallsIncludeName(toolCalls []map[string]any, name string) bool {
	for _, tc := range toolCalls {
		if str(tc["name"]) == name {
			return true
		}
	}
	return false
}
