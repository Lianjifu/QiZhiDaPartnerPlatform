// service_dispatch_test.go — Deps 字段的 nil-safety 烟雾测试。
//
// 目的:确保 Service 在 Deps 部分填充或全零时不会 panic;
// 这是 32+ 个函数字段依赖契约的最低防线。
//
// 运行方式(不需要 DB,纯内存):
//
//	go test ./internal/copilot/ -run TestDepsNilSafety -count=1
package copilot

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/store"
)

// makeReq 构造一个最小可用的 *http.Request,用于测试。
func makeReq(method, path, ws string) *http.Request {
	r := httptest.NewRequest(method, path, strings.NewReader(""))
	if ws != "" {
		r.Header.Set("X-Workspace-Id", ws)
	}
	return r
}

// TestService_DepsNilSafe_DepAccessors 验证每个 Deps 访问器
// 在 Deps 为零值时不 panic,且返回合理的零值/默认值。
func TestService_DepsNilSafe_DepAccessors(t *testing.T) {
	s := NewService(store.New(), Deps{})

	// depWorkspaceID: 无注入时返回空串。
	if got := s.depWorkspaceID(makeReq("GET", "/", "")); got != "" {
		t.Errorf("depWorkspaceID = %q, want empty", got)
	}

	// depCheckModelBudget: 无注入时按"放行 + 0 剩余 + nil err"返回。
	allowed, remaining, err := s.depCheckModelBudget("ws1", "emp1", "model-x")
	if err != nil {
		t.Errorf("depCheckModelBudget err = %v, want nil", err)
	}
	if !allowed {
		t.Errorf("depCheckModelBudget allowed = false, want true (nil-safe default)")
	}
	if remaining != 0 {
		t.Errorf("depCheckModelBudget remaining = %v, want 0", remaining)
	}

	// nil receiver 也安全(测试 init 阶段)。
	var nilS *Service
	if got := nilS.depWorkspaceID(makeReq("GET", "/", "")); got != "" {
		t.Errorf("nil receiver depWorkspaceID = %q, want empty", got)
	}
	if _, _, err := nilS.depCheckModelBudget("ws", "e", "m"); err != nil {
		t.Errorf("nil receiver depCheckModelBudget err = %v, want nil", err)
	}
}

// TestService_DepsNilSafe_HandlerWiring 验证 CopH() 在没有 wire 任何
// 函数字段时不 panic,只让 handler 路由回 404 / "not implemented"。
func TestService_DepsNilSafe_HandlerWiring(t *testing.T) {
	s := NewService(store.New(), Deps{})
	h := s.CopH()
	if h == nil {
		t.Fatal("CopH() returned nil")
	}

	// 8 个标准路由 + 1 个内部钩子,逐一打,验证不 panic。
	cases := []struct {
		method, path string
	}{
		{"GET", "/api/copilot/conversations"},
		{"POST", "/api/copilot/conversations"},
		{"GET", "/api/copilot/conversations/c1/turns/t1/status"},
		{"GET", "/api/copilot/conversations/c1/turns/t1/replay"},
		{"POST", "/api/copilot/conversations/c1/cancel"},
		{"POST", "/api/copilot/conversations/c1/stream"},
		{"POST", "/api/copilot/conversations/c1/messages/m1/feedback"},
		{"POST", "/api/internal/copilot/post-turn"},
		{"POST", "/api/evolve/candidates/c1/accept"},
	}
	for _, c := range cases {
		req := makeReq(c.method, c.path, "")
		w := httptest.NewRecorder()
		// 不 panic 即视为通过。
		h.ServeHTTP(w, req)
	}
}

// TestService_DepsNilSafe_TurnStateMachine 验证 turn 状态机在零 Deps 时
// 也能构造和更新(状态机本身不依赖任何 Deps 字段)。
func TestService_DepsNilSafe_TurnStateMachine(t *testing.T) {
	s := NewService(store.New(), Deps{})

	// 直接访问内存字段应不 panic。
	s.lastMemoryBudgetReport = &memoryBudgetReport{BudgetTokens: 1000, UsedTokens: 200}
	if s.lastMemoryBudgetReport == nil {
		t.Error("lastMemoryBudgetReport should be assignable")
	}
	if got := s.lastMemoryBudgetReport.BudgetTokens; got != 1000 {
		t.Errorf("BudgetTokens = %d, want 1000", got)
	}

	s.participantMemoryBudgetMu.Lock()
	s.participantMemoryBudgetReports = map[string]*memoryBudgetReport{
		"p1": {BudgetTokens: 500, UsedTokens: 50},
	}
	s.participantMemoryBudgetMu.Unlock()
	if got := len(s.participantMemoryBudgetReports); got != 1 {
		t.Errorf("participantMemoryBudgetReports len = %d, want 1", got)
	}
}

// TestService_DepsNilSafe_TestHooks 验证 SetTestHooks 在零 Deps 时
// 也能正常工作(testHooks 字段独立)。
func TestService_DepsNilSafe_TestHooks(t *testing.T) {
	s := NewService(store.New(), Deps{})
	if s.testHooks != nil {
		t.Fatal("testHooks should be nil initially")
	}

	hooks := &serviceTestHooks{
		runCopilotToolOverride: func(ctx toolRunContext, t *registeredTool, call toolCallRequest) toolExecResult {
			return toolExecResult{Status: "ok"}
		},
		runPlanExecuteOverride: func(in reactTurnInput) reactTurnResult {
			return reactTurnResult{Text: "stub"}
		},
	}
	s.SetTestHooks(hooks)
	if s.testHooks == nil {
		t.Fatal("SetTestHooks should set testHooks")
	}
}

// TestService_DepsNilSafe_NewAlias 验证 New() 别名行为。
func TestService_DepsNilSafe_NewAlias(t *testing.T) {
	s := New(store.New())
	if s == nil || s.Store == nil {
		t.Fatal("New() should return a Service with Store")
	}
	if s.Deps.Workspace.WorkspaceIDFn != nil {
		t.Error("Deps should be zero-value (New() uses Deps{})")
	}
}

// TestService_RAGCache_TTLAndEvict 验证 RAG 缓存的 TTL 与失效语义。
func TestService_RAGCache_TTLAndEvict(t *testing.T) {
	c := newRAGCacheWithTTL(50 * time.Millisecond)
	if c == nil {
		t.Fatal("newRAGCacheWithTTL returned nil")
	}

	// LoadOrCompute 第一次:compute 执行
	calls := 0
	result, err := c.LoadOrCompute("k1", func() (any, error) {
		calls++
		return "v1", nil
	})
	if err != nil {
		t.Fatalf("first call err = %v", err)
	}
	if result != "v1" || calls != 1 {
		t.Errorf("first call result=%v calls=%d, want v1/1", result, calls)
	}

	// 第二次:缓存命中,compute 不再执行
	result, err = c.LoadOrCompute("k1", func() (any, error) {
		calls++
		return "v2", nil
	})
	if result != "v1" || calls != 1 {
		t.Errorf("cached call result=%v calls=%d, want v1/1", result, calls)
	}

	// 等 TTL 过期
	time.Sleep(60 * time.Millisecond)
	_, _ = c.LoadOrCompute("k1", func() (any, error) {
		calls++
		return "v3", nil
	})
	if calls != 2 {
		t.Errorf("after TTL, calls=%d, want 2", calls)
	}

	// Evict 主动失效
	c.Set("k2", "v-k2")
	c.Evict("k2")
	if _, ok := c.Get("k2"); ok {
		t.Error("Evict should remove key")
	}

	// nil receiver 安全
	var nilC *ragCache
	if _, ok := nilC.Get("anything"); ok {
		t.Error("nil ragCache.Get should return false")
	}
}

// TestService_Retry_ExponentialBackoff 验证 retry helper 的退避行为。
func TestService_Retry_ExponentialBackoff(t *testing.T) {
	fastPolicy := retryPolicy{
		maxAttempts: 3,
		baseDelay:   5 * time.Millisecond,
		isRetryable: func(err error) bool { return err != nil },
	}

	t.Run("non_retryable_immediate_return", func(t *testing.T) {
		calls := 0
		op := func(ctx context.Context) error {
			calls++
			return errors.New("fatal")
		}
		err := withRetry(testContext(t), retryPolicy{
			maxAttempts: 3,
			baseDelay:   5 * time.Millisecond,
			isRetryable: func(err error) bool { return false },
		}, op)
		if err == nil || calls != 1 {
			t.Errorf("non-retryable: calls=%d err=%v, want 1/err", calls, err)
		}
	})

	t.Run("retry_then_succeed", func(t *testing.T) {
		calls := 0
		op := func(ctx context.Context) error {
			calls++
			if calls < 2 {
				return errors.New("transient")
			}
			return nil
		}
		err := withRetry(testContext(t), fastPolicy, op)
		if err != nil {
			t.Errorf("retry-then-succeed err = %v, want nil", err)
		}
		if calls != 2 {
			t.Errorf("retry-then-succeed calls=%d, want 2", calls)
		}
	})

	t.Run("exhaust_returns_last_error", func(t *testing.T) {
		calls := 0
		op := func(ctx context.Context) error {
			calls++
			return errors.New("persistent")
		}
		err := withRetry(testContext(t), fastPolicy, op)
		if err == nil || err.Error() != "persistent" {
			t.Errorf("exhaust err = %v, want 'persistent'", err)
		}
		if calls != fastPolicy.maxAttempts {
			t.Errorf("exhaust calls=%d, want %d", calls, fastPolicy.maxAttempts)
		}
	})

	t.Run("success_first_try", func(t *testing.T) {
		calls := 0
		op := func(ctx context.Context) error {
			calls++
			return nil
		}
		err := withRetry(testContext(t), fastPolicy, op)
		if err != nil || calls != 1 {
			t.Errorf("success-first err=%v calls=%d, want nil/1", err, calls)
		}
	})
}

// testContext 返回一个带 5 秒 timeout 的 ctx,防止测试卡死。
func testContext(t *testing.T) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	return ctx
}

// silence unused warnings(导入保留供未来测试扩展)
var (
	_ = http.MethodGet
	_ = (*retryPolicy)(nil)
)

// TestService_BudgetGate_NilSafe 验证 depCheckModelBudget 在
// Deps 未注入 / Viewer 未传 / Deps 报错 三个场景下都安全。
func TestService_BudgetGate_NilSafe(t *testing.T) {
	s := NewService(store.New(), Deps{})

	// 1. Deps 未注入 → 默认放行,remaining=0,err=nil
	allowed, remaining, err := s.depCheckModelBudget("ws1", "emp1", "model-x")
	if err != nil || !allowed || remaining != 0 {
		t.Errorf("nil-deps: allowed=%v remaining=%v err=%v, want true/0/nil", allowed, remaining, err)
	}

	// 2. Deps 注入但返回 denied → allowed=false,remaining=具体值
	denied := Deps{
		Routing: RoutingDeps{
			CheckModelBudgetFn: func(ws, emp, m string) (bool, float64, error) {
				return false, 0.05, nil
			},
		},
	}
	s2 := NewService(store.New(), denied)
	allowed, remaining, err = s2.depCheckModelBudget("ws1", "emp1", "model-x")
	if allowed || remaining != 0.05 || err != nil {
		t.Errorf("denied: allowed=%v remaining=%v err=%v, want false/0.05/nil", allowed, remaining, err)
	}

	// 3. Deps 注入并返回 (true, $, err) → accessor 透传三个值;
	//    err 是否引发"拒绝"由 caller(harness)按业务决定,accessor 仅如实返回。
	failing := Deps{
		Routing: RoutingDeps{
			CheckModelBudgetFn: func(ws, emp, m string) (bool, float64, error) {
				return true, 100.0, errors.New("budget service down")
			},
		},
	}
	s3 := NewService(store.New(), failing)
	allowed, remaining, err = s3.depCheckModelBudget("ws1", "emp1", "model-x")
	if !allowed || remaining != 100.0 || err == nil || err.Error() != "budget service down" {
		t.Errorf("err-returning: allowed=%v remaining=%v err=%v, want true/100.0/'budget service down'", allowed, remaining, err)
	}
}

// TestToolRegistryPrompt_PromptRegistry 验证 toolRegistryPrompt 的
// 静态片段(ReAct 头/格式/XML 禁用/收尾/Skill Harness/产物协议)接入注册表;
// docx/pptx/pdf 专项仍为内联动态代码(不变)。
func TestToolRegistryPrompt_PromptRegistry(t *testing.T) {
	ResetPromptsForTest()
	defer ResetPromptsForTest()

	// 1. 空工具列表:走 empty 段
	out := toolRegistryPrompt(nil)
	if !strings.Contains(out, "本回合未启用任何工具") {
		t.Errorf("expected empty fallback in output, got: %s", out)
	}

	// 2. 非空工具列表:含 react_header + format + xml_forbidden + finalize + skill_harness + artifact_protocol
	out = toolRegistryPrompt([]registeredTool{
		{Name: "knowledge.retrieve", Kind: "platform", Enabled: true},
	})
	for _, expect := range []string{
		"你可以使用下列工具（ReAct）",
		"<<<TOOL>>>",
		"禁止输出 <skill.read>",
		"收到工具观察结果后",
		"【Skill Harness】",
		"【产物协议】docx/pptx/pdf",
	} {
		if !strings.Contains(out, expect) {
			t.Errorf("expected %q in registry output, got: %s", expect, out)
		}
	}

	// 3. 替换 skill_harness 后,新内容应出现;旧内容应消失
	ResetPromptsForTest()
	reg := prompts()
	reg.Register("tool.registry.skill_harness", "v2", "CUSTOM SKILL HARNESS")
	reg.SetActive("tool.registry.skill_harness", "v2")
	out = toolRegistryPrompt([]registeredTool{
		{Name: "knowledge.retrieve", Kind: "platform", Enabled: true},
	})
	if !strings.Contains(out, "CUSTOM SKILL HARNESS") {
		t.Errorf("expected v2 custom content, got: %s", out)
	}
	if strings.Contains(out, "首次先 action=open") {
		t.Errorf("expected old v1 content to be gone, got: %s", out)
	}
}

// TestPlanPrompt_PromptRegistry 验证 planPrompt 走注册表。
func TestPlanPrompt_PromptRegistry(t *testing.T) {
	ResetPromptsForTest()
	defer ResetPromptsForTest()

	out := planPrompt()
	if !strings.Contains(out, "<<<PLAN>>>") {
		t.Errorf("expected PLAN marker in default plan prompt, got: %s", out)
	}

	// 替换为自定义
	ResetPromptsForTest()
	reg := prompts()
	reg.Register("plan.prompt", "v2", "CUSTOM PLAN FORMAT")
	reg.SetActive("plan.prompt", "v2")
	if got := planPrompt(); !strings.Contains(got, "CUSTOM PLAN FORMAT") {
		t.Errorf("expected v2 plan prompt, got: %s", got)
	}
}

// TestCognitiveDigestBlock_PromptRegistry 验证 buildCognitiveDigestBlock
// 的所有静态片段都正确接到了 prompt 注册表(默认 v1)。
//
// 设计目标:
//   - 注册表为空时(buildPureDigestBlock 不存在,直接走函数本身),
//     输出应该非空且包含关键 marker(主框架名、约束语句、deep skill hint)。
//   - 注册表被替换为自定义内容时,输出应反映自定义内容。
func TestCognitiveDigestBlock_PromptRegistry(t *testing.T) {
	ResetPromptsForTest()
	defer ResetPromptsForTest()

	d := cognitiveDecision{
		Enabled:   true,
		Primary:   cognitiveLogic,
		Mode:      cognitiveModeDeep,
		Secondary: cognitiveProblem,
	}

	// 1. 默认 v1:输出应包含主框架名 "逻辑" 与 "对用户可见回复须遵循下列骨架"
	out := buildCognitiveDigestBlock(d)
	if out == "" {
		t.Fatal("buildCognitiveDigestBlock returned empty for valid decision")
	}
	if !strings.Contains(out, "逻辑") {
		t.Errorf("expected primary framework label in output, got: %s", out)
	}
	if !strings.Contains(out, "对用户可见回复须遵循下列骨架") {
		t.Errorf("expected primary.intro prompt in output, got: %s", out)
	}
	// deep 模式下应出现 skill_hint 模板片段
	if !strings.Contains(out, "skill.open") {
		t.Errorf("expected skill.open hint in deep mode, got: %s", out)
	}

	// 2. 替换 primary.intro 后,新内容应出现在输出里
	ResetPromptsForTest()
	reg := prompts()
	reg.Register("cognitive.framework.primary.intro", "v2", "CUSTOM PRIMARY INTRO")
	reg.SetActive("cognitive.framework.primary.intro", "v2")

	out2 := buildCognitiveDigestBlock(d)
	if !strings.Contains(out2, "CUSTOM PRIMARY INTRO") {
		t.Errorf("expected custom v2 content in output, got: %s", out2)
	}
	if strings.Contains(out2, "对用户可见回复须遵循下列骨架") {
		t.Errorf("expected old v1 content to be gone after override, got: %s", out2)
	}
}

// TestLiveAnswerStream_ContextCancel 验证 SSE 客户端断开后,
// live_stream 所有 emit* 路径立即返回,不再触发 emit 回调。
func TestLiveAnswerStream_ContextCancel(t *testing.T) {
	// 用一个 chan 收集 emit 事件,验证 ctx cancel 后不再写入
	emitted := make(chan map[string]any, 16)
	emit := func(typ, stage string, payload map[string]any) {
		select {
		case emitted <- payload:
		default:
		}
	}
	idGen := func() string { return "test-id" }

	// 已取消的 ctx
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	ls := newLiveAnswerStream(emit, "single", "", "corr1", "msg1", "model-x", idGen).WithContext(ctx)
	if ls == nil {
		t.Fatal("newLiveAnswerStream returned nil")
	}

	// Active 在 ctx 取消时必须返回 false
	if ls.Active() {
		t.Error("Active() should return false when ctx is cancelled")
	}

	// OnDelta 应立即返回,不触发 emit
	ls.OnDelta("hello", "hello world")

	// 等一小段时间,确认没有 emit 事件被发送
	select {
	case ev := <-emitted:
		t.Errorf("expected no emit after ctx cancel, got %v", ev)
	case <-time.After(50 * time.Millisecond):
		// 期望:无事件
	}

	// emitPlainDelta / emitSegmentDelta 同样应短路
	ls.emitPlainDelta("chunk")
	ls.emitSegmentDelta("chunk")

	select {
	case ev := <-emitted:
		t.Errorf("expected no emit after ctx cancel, got %v", ev)
	case <-time.After(50 * time.Millisecond):
		// 期望:无事件
	}
}

// TestPrompts_RegistryAndFallback 验证 prompt 注册表的语义:
// 注册表优先,空串时回退 hardcoded;SetActive 可切版本;Snapshot 可观测。
func TestPrompts_RegistryAndFallback(t *testing.T) {
	// 隔离全局注册表,避免污染其它测试
	ResetPromptsForTest()
	defer ResetPromptsForTest()
	r := prompts()

	// 1. v1 默认值已注册
	if got := r.Get("system.identity.active.tail"); got == "" {
		t.Error("expected default v1 prompt to be registered")
	}

	// 2. Snapshot 包含所有已注册 name
	snap := r.Snapshot()
	if _, ok := snap["system.identity.active.tail"]; !ok {
		t.Errorf("Snapshot missing expected key, got %v", snap)
	}

	// 3. promptGet 在未激活 name 上回退 hardcoded
	if got := promptGet("nonexistent.prompt"); got != "" {
		t.Errorf("unknown prompt should return empty, got %q", got)
	}
	if got := promptGet("reasoning.off"); got == "" {
		t.Error("reasoning.off should not be empty (registered)")
	}

	// 4. SetActive 切版本:已注册 v2 后可激活
	r.Register("system.identity.active.tail", "v2", "CUSTOM V2 CONTENT")
	r.SetActive("system.identity.active.tail", "v2")
	if got := r.Get("system.identity.active.tail"); got != "CUSTOM V2 CONTENT" {
		t.Errorf("expected v2 content, got %q", got)
	}

	// 5. SetActive 切到未注册版本 → Get 返回空,promptGet 回退 hardcoded
	r.SetActive("system.identity.active.tail", "v999")
	if got := r.Get("system.identity.active.tail"); got != "" {
		t.Errorf("unknown active version should return empty, got %q", got)
	}
	if got := promptGet("system.identity.active.tail"); got == "" {
		t.Error("promptGet should fall back to hardcoded when active version unregistered")
	}
}

// TestPrompts_EnvOverride 验证 env 覆盖语义:
// QZDA_PROMPT_VERSION 全局切;QZDA_PROMPT_<NAME>_VERSION 单名切。
func TestPrompts_EnvOverride(t *testing.T) {
	ResetPromptsForTest()
	defer ResetPromptsForTest()

	// 注册 v2 内容
	reg := newPromptRegistry()
	reg.Register("system.identity.fallback", "v1", "V1 FALLBACK")
	reg.Register("system.identity.fallback", "v2", "V2 FALLBACK")
	reg.SetActive("system.identity.fallback", "v1")

	// 直接读 → V1
	if got := reg.Get("system.identity.fallback"); got != "V1 FALLBACK" {
		t.Errorf("before env override: got %q", got)
	}

	// 用环境变量模拟全局切到 v2
	t.Setenv("QZDA_PROMPT_VERSION", "v2")
	reg.SetActive("system.identity.fallback", "v2") // simulate applyEnvOverrides
	if got := reg.Get("system.identity.fallback"); got != "V2 FALLBACK" {
		t.Errorf("after env v2 override: got %q", got)
	}

	// 单名覆盖:即使全局是 v2,name=reasoning.off 单独切到 v1
	t.Setenv("QZDA_PROMPT_REASONING_OFF_VERSION", "v1")
	reg.Register("reasoning.off", "v1", "R-OFF V1")
	reg.Register("reasoning.off", "v2", "R-OFF V2")
	reg.SetActive("reasoning.off", "v1")
	if got := reg.Get("reasoning.off"); got != "R-OFF V1" {
		t.Errorf("per-name override: got %q", got)
	}
}