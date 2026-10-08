// Package copilot —— M02 专家协作 (Expert Collaboration) 模块。
//
// 这是 Go monolith(qzda-app 单进程)里负责"专家对话回合"的实现:
// 路由 → ReAct 循环 → 工具执行 → 多面板 → 反思 → 答案富化 → SSE 流式下发。
//
// # 与 server/ 的边界
//
// 本包通过 32 个"函数字段" (Deps) 引用 server/ 的方法,
// 不直接 import internal/server/(避免回环)。Service 在 server.New()
// 构造时把 Deps 绑到 server 的方法上,Handler 结构体再用方法值分发 8 个 HTTP 路由。
//
// # 主要文件分工
//
//	service.go            主服务结构 + Deps 函数字段 + 工厂/挂载方法
//	handler.go            HTTP 路由分发(8 个 M02 路由)
//	types.go              共享类型(请求/响应/事件/状态)
//	copilot_route.go      路由决策:direct / react / plan_exec / multi_agent
//	copilot_safety.go     安全护栏(零信任 / 高风险写操作)
//	copilot_ratelimit.go  频控 + clientMsgId 幂等
//	copilot_harness.go    ReAct harness 总编排(route → react → reflect → enrich)
//	copilot_cognitive.go  认知层(thought → plan → action)
//	copilot_thought.go    思维链
//	copilot_plan.go       计划阶段
//	copilot_react.go      ReAct 主循环(think → tool → observe)
//	copilot_reflect.go    反思阶段
//	copilot_answer_enrich.go 答案富化(citations / source links)
//	copilot_context.go    LLM 输入拼装(prompt + memory + knowledge + tools)
//	copilot_snapshot.go   ContextSnapshot 数据模型
//	copilot_segments.go   段落切分
//	copilot_artifacts.go  artifacts 入口(图表/链接/技能)
//	chart_artifacts.go     图表 artifacts 实现(SVG 后端)
//	skill_artifacts_helpers.go 技能 artifacts 解析回填(包内最大文件)
//	copilot_tools.go      工具注册与执行编排
//	tool_helpers.go       工具参数解析 / 结果归一
//	shell_tools.go        shell 工具实现
//	web_tools.go          web 工具(computer-use 子集)
//	mcp_client.go         MCP 客户端(JSON-RPC)
//	copilot_multi.go      多专家面板(supervisor)
//	multi_panel_helpers.go 面板渲染辅助
//	copilot_variants.go   答案变体
//	copilot_evolve.go      自学习/演化
//	copilot_live_stream.go SSE 流式发射器
//	copilot_turn_state.go 回合状态机
//	copilot_turn_meta.go  回合元数据
//	service_retry.go      LLM/RAG 指数退避重试器
//	service_cache.go      RAG TTL 缓存
//	helpers.go            通用辅助
//	utility_helpers.go    杂项 utility
//	metrics.go            进程级指标计数器
//
// # 8 个 HTTP 路由
//
//   - GET   /api/copilot/conversations                       → ListConversations
//   - POST  /api/copilot/conversations                       → CreateConversation
//   - GET   /api/copilot/conversations/{id}/turns/{corr}/status → GetCopilotTurnStatus
//   - GET   /api/copilot/conversations/{id}/turns/{corr}/replay → ReplayCopilotTurn
//   - POST  /api/copilot/conversations/{id}/cancel           → CancelCopilotTurn
//   - POST  /api/copilot/conversations/{id}/stream           → Stream   (SSE)
//   - POST  /api/copilot/conversations/{cid}/messages/{mid}/feedback → MessageFeedback
//   - POST  /api/internal/copilot/post-turn                  → PostTurnAPI
//
// SSE 实际处理器在 internal/server/ 中绑定到 CopilotStream 函数字段。
//
// # SSE 事件类型
//
// stage / delta / done / tool / plan / agent / memory.budget / reflect / evolve.candidate
//
// # Deps 子结构速查
//
// Deps 在 M13(P3) 重构为 9 个子结构,按职责分组:
//   - workspace(3)  : WorkspaceIDFn / RequireMemoryGovernanceFn / EvaluateZeroTrustFn
//   - routing(6)    : ResolveDefaultRiskLevelFn / ResolveDefaultSessionModeFn /
//                     ResolveMessageBucketIDFn / PublishedPolicyByLevelFn /
//                     StreamLLMForCopilotFn / CheckModelBudgetFn
//   - memory(6)     : PersistMemorySyncFn / IngestRuntimeMemoryLockedFn /
//                     AppendMemoryAuditLockedFn / LogCitationsForRAGFn /
//                     MemoryPolicyForFn / MemoryCanReadFn
//   - rag(1)        : RetrievePublishedFn
//   - tools(7)      : DispatchAuthorizedToolFn / RunSkillToolFn / RunSkillReadToolFn /
//                     RunPilotdeckToolFn / RunCMDBLookupFn / RunRuntimeToolFn /
//                     PersistSkillHealthFn
//   - multi_agent(2): BuildParticipantContextFn / RunParticipantTurnFn
//   - persist(1)    : DurableDeleteSyncFn
//   - sandbox(7)    : RequireProductionDualApprovalFn / IsSandboxCopilotWsPathFn /
//                     IsDemoModelAliasFn / ParseNextRunCommandFn /
//                     ShouldAutoRunAfterSkillWriteFn / IsSkillWorkspaceWriteCallFn /
//                     BuildAutoRunToolCallAfterWriteFn
//   - skills_root(1): BuiltinSkillsRootFn
//
// 合计 34 字段。任何子结构字段允许 nil(测试态);访问用 Service.depXxx 访问器
// 已统一 nil-safe 语义,不要直接 s.Deps.X.Foo(DeepEquals null) 调用。
//
// # 可靠性层(service_retry.go / service_cache.go / budget gate)
//
//   - LLM 调用 6 处均包了 withLLMRetry:1+2 次重试,基数 2s,context 取消时立即返回
//   - RAG 调用 1 处包了 withRAGRetry + ragCache.LoadOrCompute:5min TTL,跨 worker 复用
//   - Budget gate(copilot_harness.go):per-turn 一次,resolved model 之后 / cognitive 之前;
//     不通过时 emit `stage=budget_denied` + metric `copilotBudgetDenied` 递增 +
//     返回 reactTurnResult{Err: budget_error}
//
// # Prompt 版本化(service_prompts.go)
//
// 静态 prompt 块已抽到 PromptRegistry,默认 v1;env 切换:
//   - QZDA_PROMPT_VERSION=v2                     (全局切)
//   - QZDA_PROMPT_<NAME>_VERSION=v2              (单名切,覆盖全局)
//   - 未注册版本时回退到 hardcodedFallbacks,向后兼容
//
// 已注册的 prompt 块:
//   - system.identity.fallback
//   - system.identity.active.tail
//   - reasoning.off / reasoning.deep
//   - section.memory.header
//   - section.rag.header
//
// 升级到 v2 时先 Register 再 SetActive;生产上线推荐先在 staging 验证再切。
//
// # 调试指南(常见 panic 在哪)
//
//   - "nil pointer dereference" 在 runParticipantTurn / dispatchParticipants:
//     Deps.MultiAgent.BuildParticipantContextFn 或 RunParticipantTurnFn 未注入
//   - "index out of range" 在 retrieveMemoryForTurnLocked:
//     Deps.Memory.PersistMemorySyncFn / IngestRuntimeMemoryLockedFn 未注入
//   - "all goroutines are asleep" 在 runReactTurn:
//     Deps.Routing.StreamLLMForCopilotFn 永远是 nil,模型路由失败
//
// # 阅读顺序
//
// 新读者建议:
//   1. service.go(主服务 + Deps 9 子结构总览)
//   2. handler.go(8 个 HTTP 入口)
//   3. types.go(共享类型)
//   4. copilot_route.go(路由决策)
//   5. copilot_harness.go(harness 总编排,含 budget gate)
//   6. copilot_react.go(ReAct 主循环,所有 LLM 调用都包了 withLLMRetry)
//   7. copilot_live_stream.go(SSE 发射)
//   8. service_prompts.go(prompt 版本化)
//
// 二次深入:
//   - copilot_cognitive.go / copilot_thought.go / copilot_plan.go 认知三件套
//   - copilot_multi.go 多面板
//   - copilot_reflect.go / copilot_answer_enrich.go 后处理
//   - service_retry.go / service_cache.go 可靠性层
//   - service_dispatch_test.go 烟雾测试(Deps nil-safe / Budget / Cache / Retry / Prompts)
package copilot