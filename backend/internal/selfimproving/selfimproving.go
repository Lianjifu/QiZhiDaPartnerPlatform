// Package selfimproving converts recent model-trace events into a
// Standard Operating Procedure (SOP) candidate and decides whether the
// candidate should be created, merged with an existing doc, or
// rejected for review.
//
// The package is intentionally pure: it reads from a *trace.Recorder
// (Recent + AggregatesWindow only), emits a SOP value object, and never
// touches the network, the file system, or the in-memory store. The
// HTTP handler in internal/server is responsible for writing the SOP
// through the existing knowledge write path.
package selfimproving

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/modelprov/trace"
)

// Verdict describes what the caller should do with a SOP.
type Verdict string

const (
	VerdictCreated  Verdict = "created"
	VerdictMerged   Verdict = "merged"
	VerdictRejected Verdict = "rejected"
)

// Reason explains why the engine picked a particular verdict.
type Reason string

const (
	ReasonSampleTooSmall    Reason = "sample_too_small"
	ReasonNoAnomaly         Reason = "no_anomaly_detected"
	ReasonErrorRateElevated Reason = "error_rate_elevated"
	ReasonLatencyElevated   Reason = "latency_elevated"
	ReasonRecurringErrors   Reason = "recurring_errors"
)

// Pattern is one cluster of similar trace events that informs the SOP.
type Pattern struct {
	Key     string
	Count   int
	Example trace.Event
	Verdict Verdict
	Reason  Reason
	Insight string
	Suggest string
}

// SOP is the engine's output. Caller decides what to do with it.
type SOP struct {
	Title      string
	Markdown   string
	Tags       []string
	Verdict    Verdict
	Reason     Reason
	SampleSize int
	Window     string
	Patterns   []Pattern
	Summary    Summary
}

// Summary is the human-readable rollup of the window.
type Summary struct {
	Window        string
	SampleSize    int
	SuccessRate   float64
	P50LatencyMs  float64
	P95LatencyMs  float64
	MeanLatencyMs float64
	ByStatus      map[string]int
	ByErrorClass  map[string]int
	WorkspaceID   string
}

// Options tunes Generate.
type Options struct {
	WorkspaceID string
	Window      string
	TopN        int
	TitleHint   string
	Now         func() time.Time
}

// Engine wraps a *trace.Recorder and produces SOPs from recent events.
type Engine struct {
	recorder *trace.Recorder
}

// New returns an engine bound to the given recorder.
func New(r *trace.Recorder) *Engine {
	if r == nil {
		r = trace.NewRecorder(0)
	}
	return &Engine{recorder: r}
}

// Recorder exposes the wrapped recorder so tests and handlers can verify
// what the engine saw.
func (e *Engine) Recorder() *trace.Recorder {
	return e.recorder
}

// Errors returned by Generate.
var (
	ErrSampleTooSmall = errors.New("selfimproving: sample too small to form a SOP")
)

// Thresholds the engine uses to decide which verdict to assign. Kept
// exported so tests and operators can tune them in code.
type Thresholds struct {
	// MinSample is the minimum number of trace events required before a
	// SOP can be generated at all.
	MinSample int
	// ErrorRateReject is the success-rate floor below which the engine
	// always emits a VerdictCreated (errors are happening, write a SOP).
	ErrorRateReject float64
	// P95LatencyMs is the latency ceiling beyond which the engine emits
	// VerdictCreated even if the error rate is OK.
	P95LatencyMs float64
	// RecurringErrorThreshold is how many events of the same error class
	// must appear before it counts as a pattern.
	RecurringErrorThreshold int
}

// DefaultThresholds returns sensible CI defaults.
func DefaultThresholds() Thresholds {
	return Thresholds{
		MinSample:               3,
		ErrorRateReject:         0.9,
		P95LatencyMs:            4000,
		RecurringErrorThreshold: 2,
	}
}

// Generate inspects the recorder's recent events and emits a SOP.
//
// Verdict semantics:
//   - VerdictRejected + ErrSampleTooSmall when SampleSize < MinSample.
//   - VerdictRejected (no error) when there is no anomaly to act on.
//   - VerdictCreated when an anomaly is detected (errors / recurring
//     failures / elevated latency).
//   - VerdictMerged is reserved for a future iteration that compares
//     against existing knowledge docs.
func (e *Engine) Generate(opts Options) (SOP, error) {
	thr := DefaultThresholds()
	evs := e.recentEvents(opts.WorkspaceID)
	if len(evs) < thr.MinSample {
		return SOP{}, ErrSampleTooSmall
	}
	agg := e.recorder.AggregatesWindow(opts.Window)
	if opts.Window == "" {
		opts.Window = "1h"
	}

	patterns := e.detectPatterns(evs, thr)

	// Decide verdict from aggregates + patterns.
	verdict, reason := classify(agg, patterns, thr)
	if verdict == VerdictRejected && reason == "" {
		reason = ReasonNoAnomaly
	}

	now := opts.Now
	if now == nil {
		now = time.Now
	}
	title := composeTitle(opts.TitleHint, opts.WorkspaceID, now(), verdict)
	md := renderMarkdown(title, agg, patterns, opts.WorkspaceID, opts.Window, verdict, reason, now())

	return SOP{
		Title:      title,
		Markdown:   md,
		Tags:       []string{"self-improving", "auto-generated"},
		Verdict:    verdict,
		Reason:     reason,
		SampleSize: len(evs),
		Window:     opts.Window,
		Patterns:   patterns,
		Summary: Summary{
			Window:        opts.Window,
			SampleSize:    len(evs),
			SuccessRate:   agg.SuccessRate,
			P50LatencyMs:  agg.P50LatencyMs,
			P95LatencyMs:  agg.P95LatencyMs,
			MeanLatencyMs: agg.MeanLatencyMs,
			ByStatus:      agg.ByStatus,
			ByErrorClass:  agg.ByErrorClass,
			WorkspaceID:   opts.WorkspaceID,
		},
	}, nil
}

func (e *Engine) recentEvents(ws string) []trace.Event {
	all := e.recorder.Recent(0)
	if ws == "" {
		return all
	}
	out := make([]trace.Event, 0, len(all))
	for _, ev := range all {
		if ev.WorkspaceID == "" || ev.WorkspaceID == ws {
			out = append(out, ev)
		}
	}
	return out
}

// detectPatterns groups events into clusters by (ProviderID, ErrorClass)
// for failures and (ProviderID, Level) for slowness.
func (e *Engine) detectPatterns(evs []trace.Event, thr Thresholds) []Pattern {
	type key struct {
		Provider string
		Kind     string // errorClass for errors, level for slowness
		Dim      string // "error" or "latency"
	}
	bucket := map[key][]trace.Event{}
	for _, ev := range evs {
		switch {
		case ev.Status == trace.StatusError || ev.Status == trace.StatusTimeout || ev.Status == trace.Status429:
			k := key{Provider: ev.ProviderID, Kind: ev.ErrorClass, Dim: "error"}
			if k.Kind == "" {
				k.Kind = "unknown"
			}
			bucket[k] = append(bucket[k], ev)
		case ev.LatencyMs > 0 && float64(ev.LatencyMs) > thr.P95LatencyMs*0.5:
			k := key{Provider: ev.ProviderID, Kind: ev.Level, Dim: "latency"}
			bucket[k] = append(bucket[k], ev)
		}
	}

	out := make([]Pattern, 0, len(bucket))
	for k, list := range bucket {
		if len(list) == 0 {
			continue
		}
		example := list[0]
		p := Pattern{
			Key:     fmt.Sprintf("%s:%s:%s", k.Dim, k.Provider, k.Kind),
			Count:   len(list),
			Example: example,
		}
		switch k.Dim {
		case "error":
			if len(list) >= thr.RecurringErrorThreshold {
				p.Verdict = VerdictCreated
				p.Reason = ReasonRecurringErrors
				p.Insight = fmt.Sprintf("Provider %s 出现 %d 次 %s 类错误", k.Provider, len(list), k.Kind)
				p.Suggest = fmt.Sprintf("在调用 %s 前加入 health probe 或 fallback 到备用模型", k.Provider)
			} else {
				p.Verdict = VerdictRejected
				p.Reason = ReasonNoAnomaly
				p.Insight = fmt.Sprintf("Provider %s 偶发 %s 错误 (%d 次)", k.Provider, k.Kind, len(list))
				p.Suggest = "观察一段时间后再决定是否形成 SOP"
			}
		case "latency":
			avg := avgLatency(list)
			p.Insight = fmt.Sprintf("Provider %s 在 %s 层平均延迟 %.0f ms", k.Provider, k.Kind, avg)
			if avg > thr.P95LatencyMs {
				p.Verdict = VerdictCreated
				p.Reason = ReasonLatencyElevated
				p.Suggest = "在 system prompt 中加入响应延迟预期，或设置 client-side timeout"
			}
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Verdict != out[j].Verdict {
			return out[i].Verdict == VerdictCreated
		}
		return out[i].Count > out[j].Count
	})
	return out
}

func avgLatency(evs []trace.Event) float64 {
	if len(evs) == 0 {
		return 0
	}
	var sum float64
	for _, e := range evs {
		sum += float64(e.LatencyMs)
	}
	return sum / float64(len(evs))
}

func classify(agg trace.Aggregates, patterns []Pattern, thr Thresholds) (Verdict, Reason) {
	hasCreated := false
	var reason Reason
	for _, p := range patterns {
		if p.Verdict == VerdictCreated {
			hasCreated = true
			reason = p.Reason
			break
		}
	}
	if hasCreated {
		return VerdictCreated, reason
	}
	if agg.SampleSize > 0 && agg.SuccessRate < thr.ErrorRateReject {
		return VerdictCreated, ReasonErrorRateElevated
	}
	if agg.P95LatencyMs > thr.P95LatencyMs {
		return VerdictCreated, ReasonLatencyElevated
	}
	return VerdictRejected, ReasonNoAnomaly
}

func composeTitle(hint, ws string, now time.Time, verdict Verdict) string {
	if hint == "" {
		hint = "Trace 反馈萃取"
	}
	wsLabel := ws
	if wsLabel == "" {
		wsLabel = "全局"
	}
	stamp := now.UTC().Format("2006-01-02 15:04")
	return fmt.Sprintf("[%s] %s · %s · %s", verdict, hint, wsLabel, stamp)
}

func renderMarkdown(title string, agg trace.Aggregates, patterns []Pattern, ws, window string, verdict Verdict, reason Reason, now time.Time) string {
	var b strings.Builder
	b.WriteString("# ")
	b.WriteString(title)
	b.WriteString("\n\n")
	b.WriteString("> 本文档由 `internal/selfimproving` 自动生成；verdict=")
	b.WriteString(string(verdict))
	b.WriteString("，原因=")
	b.WriteString(string(reason))
	b.WriteString("\n\n## 采样\n\n")
	fmt.Fprintf(&b, "- 时间窗：`%s`\n", window)
	fmt.Fprintf(&b, "- 工作区：`%s`\n", ws)
	fmt.Fprintf(&b, "- 样本数：%d 条 trace\n", agg.SampleSize)
	fmt.Fprintf(&b, "- 成功率：%.1f%%\n", agg.SuccessRate*100)
	fmt.Fprintf(&b, "- 延迟 p50：%.0f ms / p95：%.0f ms / 均值：%.0f ms\n", agg.P50LatencyMs, agg.P95LatencyMs, agg.MeanLatencyMs)
	if len(agg.ByStatus) > 0 {
		b.WriteString("- 状态分布：")
		keys := sortedKeys(agg.ByStatus)
		for i, k := range keys {
			if i > 0 {
				b.WriteString("；")
			}
			fmt.Fprintf(&b, "`%s`=%d", k, agg.ByStatus[k])
		}
		b.WriteString("\n")
	}
	if len(agg.ByErrorClass) > 0 {
		b.WriteString("- 错误类：")
		keys := sortedKeys(agg.ByErrorClass)
		for i, k := range keys {
			if i > 0 {
				b.WriteString("；")
			}
			fmt.Fprintf(&b, "`%s`=%d", k, agg.ByErrorClass[k])
		}
		b.WriteString("\n")
	}

	b.WriteString("\n## 触发模式\n\n")
	if len(patterns) == 0 {
		b.WriteString("未检测到反复出现的失败 / 慢调用模式。\n")
	} else {
		for i, p := range patterns {
			fmt.Fprintf(&b, "### 模式 %d: `%s`\n", i+1, p.Key)
			fmt.Fprintf(&b, "- 出现次数：%d\n", p.Count)
			fmt.Fprintf(&b, "- 触发判定：`%s`（%s）\n", p.Verdict, p.Reason)
			fmt.Fprintf(&b, "- 观察：%s\n", p.Insight)
			if p.Suggest != "" {
				fmt.Fprintf(&b, "- 建议：%s\n", p.Suggest)
			}
			fmt.Fprintf(&b, "- 代表事件：model=%s provider=%s status=%s latency=%dms\n",
				p.Example.ModelID, p.Example.ProviderID, p.Example.Status, p.Example.LatencyMs)
			b.WriteString("\n")
		}
	}

	b.WriteString("## 建议步骤\n\n")
	switch reason {
	case ReasonErrorRateElevated:
		b.WriteString("1. 在 system prompt 中加入\"连续 3 次失败即 fallback\"。\n")
		b.WriteString("2. 启用 modelprov 的 trace fallback 路径；记录自动切换前后的成功率。\n")
		b.WriteString("3. 与平台 owner 复核 provider SLA，决定是否切换到次级 provider。\n")
	case ReasonLatencyElevated:
		b.WriteString("1. 在 client 设置更严格的 timeout（建议 3s）。\n")
		b.WriteString("2. 把高延迟 provider 的请求改为 stream 模式，让用户先看到部分输出。\n")
		b.WriteString("3. 若延迟稳定超过 5s，触发 SOP review。\n")
	case ReasonRecurringErrors:
		b.WriteString("1. 将对应的失败模式封装为 vetter 规则或 fallback 路径。\n")
		b.WriteString("2. 在知识包中追加「如何处置该 provider 失败」的小节。\n")
		b.WriteString("3. 安排 owner review 后再发布到 published 状态。\n")
	default:
		b.WriteString("- 当前 trace 信号未触发任何阈值。保持现有策略，继续观察。\n")
	}

	b.WriteString("\n## 元数据\n\n")
	fmt.Fprintf(&b, "- workspaceId: %s\n", ws)
	b.WriteString("- generatedBy: selfimproving\n")
	fmt.Fprintf(&b, "- generatedAt: %s\n", now.UTC().Format(time.RFC3339))
	fmt.Fprintf(&b, "- verdict: %s\n", verdict)
	b.WriteString("- tags: [self-improving, auto-generated]\n")
	return b.String()
}

func sortedKeys(m map[string]int) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
