// copilot_react_tools.go —— P3 结构化工具执行。
//
// 改造前:模型在正文里吐 <<<TOOL>>>{...}<<<END>>> 文本块,平台用正则去抠,
//
//	工具名/参数拼错、幻觉出未注册工具、参数缺字段都要到运行期才发现,
//	而且一轮只能调一个工具(串行,每步一次 LLM 往返)。
//
// 改造后:能力契约(P2)直接转成 JSON Schema 下发给模型,模型回结构化 tool_use,
//
//	平台按协议归一后一轮内可并行执行多个工具。
//
// 降级:provider 不支持原生 tool_use 时,modelprov 会自动去掉 tools 重发,
//
//	此时不会有结构化调用,ReAct 继续走原有的文本解析路径 —— 两条路并存。
package copilot

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/qizhida-partner-platform/backend/internal/modelprov"
)

// registryToSchemas 把工具注册表转成下发模型的工具契约。
//
// 规则:
//   - prohibited 的工具不下发(模型看不到被禁用的能力)
//   - approval_required 的工具**要**下发 —— 否则模型不知道自己能申请审批
//   - 未启用的工具不下发(会话勾选才是最终交集)
func registryToSchemas(reg []registeredTool) []modelprov.ToolSchema {
	out := make([]modelprov.ToolSchema, 0, len(reg))
	seen := map[string]bool{}
	for _, t := range reg {
		if !t.Enabled || t.Mode == toolModeProhibit {
			continue
		}
		name := strings.TrimSpace(t.Name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		desc := t.Contract.Description
		if desc == "" {
			desc = t.Description
		}
		if t.RequiresApproval {
			desc += "（执行前需要人工授权）"
		}
		schema := t.Contract.InputSchema
		if schema == nil {
			schema = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		out = append(out, modelprov.ToolSchema{
			Name:        name,
			Description: desc,
			InputSchema: schema,
		})
	}
	return out
}

// structuredToolCalls 把模型返回的结构化工具调用转成平台内部的调用请求。
//
// 参数非法(JSON 不是对象)时保留原始文本,由契约校验层拦截。
func structuredToolCalls(calls []modelprov.ToolCall) []toolCallRequest {
	out := make([]toolCallRequest, 0, len(calls))
	for _, c := range calls {
		name := strings.TrimSpace(c.Name)
		if name == "" {
			continue
		}
		args := map[string]any{}
		if len(c.Arguments) > 0 {
			if err := json.Unmarshal(c.Arguments, &args); err != nil {
				args = map[string]any{"__raw": string(c.Arguments)}
			}
		}
		out = append(out, toolCallRequest{Name: name, Args: args})
	}
	return out
}

// emitSafe 是 nil 安全的 SSE 发射(测试与内部调用可能不带 emit)。
func emitSafe(emit reactEmitFunc, typ, stage string, extra map[string]any) {
	if emit == nil {
		return
	}
	emit(typ, stage, extra)
}

// toolExecRecord 是一次工具执行的结构化记录。
type toolExecRecord struct {
	ID   string
	Name string
	Args map[string]any
	Tool *registeredTool
	Res  toolExecResult
	// ContextObservation 是真正进模型上下文的那段文本。
	// 大输出被卸载时,这里是"引用 + 摘要",完整正文仍在 Res.Output 里落库。
	ContextObservation string
}

// reactToolConcurrency 是一轮内并行执行的工具数上限。
//
// 治理不放松:每个工具仍然走同一套授权闸(DispatchAuthorizedToolFn),
// 并行只影响吞吐,不影响边界。
const reactToolConcurrency = 4

// executeToolCalls 并行执行一轮内的多个工具调用。
//
// 结果按调用顺序返回(与模型发起顺序一致),保证回灌给模型的观察序列稳定。
func (s *Service) executeToolCalls(
	runCtx toolRunContext,
	reg []registeredTool,
	calls []toolCallRequest,
	sessionMode, risk string,
	emit reactEmitFunc,
) []toolExecRecord {
	records := make([]toolExecRecord, len(calls))
	if len(calls) == 1 {
		rec := s.executeOneToolCall(runCtx, reg, calls[0], sessionMode, risk, emit, "tc_react_1")
		records[0] = rec
		return records
	}

	sem := make(chan struct{}, reactToolConcurrency)
	var wg sync.WaitGroup
	for i := range calls {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			records[idx] = s.executeOneToolCall(runCtx, reg, calls[idx], sessionMode, risk, emit, fmt.Sprintf("tc_react_%d", idx+1))
		}(i)
	}
	wg.Wait()
	return records
}

// executeOneToolCall 执行单个工具调用并发出 SSE 事件。
func (s *Service) executeOneToolCall(
	runCtx toolRunContext,
	reg []registeredTool,
	call toolCallRequest,
	sessionMode, risk string,
	emit reactEmitFunc,
	tcID string,
) toolExecRecord {
	if title, detail := thoughtForToolChoice(call.Name); title != "" {
		emitThoughtPhase(emit, "tool_call", turnPhaseExecute, title, detail, map[string]any{
			"toolCallId": tcID,
		})
	}
	emitSafe(emit, "tool", "react", map[string]any{
		"name": call.Name, "status": "running", "args": call.Args, "id": tcID,
	})
	if s.Deps.Tools.DispatchAuthorizedToolFn == nil {
		return toolExecRecord{ID: tcID, Name: call.Name, Args: call.Args,
			Res: toolExecResult{Status: "unavailable", Permission: "unavailable", Error: "工具调度未接入"}}
	}
	tool, res := s.Deps.Tools.DispatchAuthorizedToolFn(runCtx, reg, call, sessionMode, risk, emit)
	displayName := call.Name
	if tool != nil {
		displayName = tool.Name
	}
	extra := map[string]any{
		"name": displayName, "status": res.Status, "args": call.Args, "id": tcID,
		"durationMs": res.DurationMs, "permission": res.Permission,
	}
	if res.Hits != nil {
		extra["hits"] = res.Hits
	}
	if res.Error != "" {
		extra["error"] = res.Error
	}
	if res.SandboxID != "" {
		extra["sandboxId"] = res.SandboxID
	}
	emitSafe(emit, "tool", "react", extra)
	if title, detail := thoughtForToolResult(res.Status, displayName); title != "" {
		emitThoughtPhase(emit, "tool_call", turnPhaseExecute, title, detail, map[string]any{
			"toolCallId": tcID,
		})
	}
	return toolExecRecord{ID: tcID, Name: displayName, Args: call.Args, Tool: tool, Res: res}
}

// observationText 渲染一次工具执行的观察文本。
func observationText(rec toolExecRecord) string {
	if rec.ContextObservation != "" {
		return rec.ContextObservation
	}
	obs := rec.Res.Output
	if obs == "" {
		obs = coalesce(rec.Res.Error, rec.Res.Status)
	}
	return truncateRunes(obs, reactToolObservationMaxRunes)
}

// toolResultContent 渲染回灌给模型的工具结果正文。
func toolResultContent(rec toolExecRecord) string {
	return fmt.Sprintf("【工具观察 %s · %s】\n%s", rec.Name, rec.Res.Status, observationText(rec))
}

// sortedToolNames 返回注册表里启用的工具名(用于日志与断言)。
func sortedToolNames(reg []registeredTool) []string {
	out := make([]string, 0, len(reg))
	for _, t := range reg {
		if t.Enabled {
			out = append(out, t.Name)
		}
	}
	sort.Strings(out)
	return out
}

// toolCallsToResults 把执行记录转成结构化回灌项。
func toolCallsToResults(records []toolExecRecord, structCalls []modelprov.ToolCall) []modelprov.ToolResult {
	out := make([]modelprov.ToolResult, 0, len(records))
	for i, rec := range records {
		tr := modelprov.ToolResult{
			ToolCallID: rec.ID,
			Name:       rec.Name,
			Content:    toolResultContent(rec),
		}
		if i < len(structCalls) && structCalls[i].ID != "" {
			tr.ToolCallID = structCalls[i].ID
		}
		if rec.Res.Status != "success" {
			tr.IsError = true
		}
		out = append(out, tr)
	}
	return out
}

// autoContinueAfterWrite 处理"写完技能脚本后自动跑一次"的续跑链。
//
// 返回 (观察补充文本, 续跑产生的工具调用记录)。没有续跑时返回 ("", nil)。
func (s *Service) autoContinueAfterWrite(
	runCtx toolRunContext,
	reg []registeredTool,
	rec *toolExecRecord,
	call toolCallRequest,
	sessionMode, risk string,
	emit reactEmitFunc,
) (string, *toolExecRecord) {
	if s.Deps.Sandbox.ParseNextRunCommandFn == nil {
		return "", nil
	}
	runCmd := s.Deps.Sandbox.ParseNextRunCommandFn(rec.Res.Output)
	if runCmd == "" {
		return "", nil
	}
	if s.Deps.Sandbox.ShouldAutoRunAfterSkillWriteFn != nil && !s.Deps.Sandbox.ShouldAutoRunAfterSkillWriteFn(rec.Res, runCmd) {
		return "", nil
	}
	if s.Deps.Sandbox.IsSkillWorkspaceWriteCallFn != nil && !s.Deps.Sandbox.IsSkillWorkspaceWriteCallFn(call, rec.Tool) {
		return "", nil
	}
	if s.Deps.Sandbox.BuildAutoRunToolCallAfterWriteFn == nil {
		return "", nil
	}
	runCall := s.Deps.Sandbox.BuildAutoRunToolCallAfterWriteFn(reg, rec.Tool, call, runCmd)
	runTcID := rec.ID + "_autorun"
	runDisplay := runCall.Name
	emitSafe(emit, "tool", "react", map[string]any{
		"name": runDisplay, "status": "running", "args": runCall.Args, "id": runTcID, "autoContinue": true,
	})
	runTool, runRes := s.Deps.Tools.DispatchAuthorizedToolFn(runCtx, reg, runCall, sessionMode, risk, emit)
	// write 已在本回合成功:若 run 仍被送进审核队列,改为直接执行沙箱脚本(避免卡在「只写不跑」)。
	if runRes.Status == "pending_authorization" && s.Deps.Sandbox.IsSandboxCopilotWsPathFn(runCmd) {
		if runTool == nil {
			runTool = registryLookup(reg, runCall.Name)
		}
		if runTool != nil {
			runRes = s.runCopilotTool(runCtx, runTool, runCall)
		}
	}
	if runTool != nil {
		runDisplay = runTool.Name
	}
	runExtra := map[string]any{
		"name": runDisplay, "status": runRes.Status, "args": runCall.Args, "id": runTcID, "autoContinue": true,
		"durationMs": runRes.DurationMs, "permission": runRes.Permission,
	}
	if runRes.Error != "" {
		runExtra["error"] = runRes.Error
	}
	if runRes.SandboxID != "" {
		runExtra["sandboxId"] = runRes.SandboxID
	}
	emitSafe(emit, "tool", "react", runExtra)
	runObs := coalesce(runRes.Output, coalesce(runRes.Error, runRes.Status))
	obs := strings.TrimSpace("【自动续跑 run · " + runDisplay + " · " + runRes.Status + "】\n" + runObs)
	return obs, &toolExecRecord{ID: runTcID, Name: runDisplay, Args: runCall.Args, Tool: runTool, Res: runRes}
}

// ctxAlive 判断上下文是否已取消(并行执行的收尾检查)。
func ctxAlive(ctx context.Context) bool {
	if ctx == nil {
		return true
	}
	select {
	case <-ctx.Done():
		return false
	default:
		return true
	}
}
