// Package copilot 是 M02 专家协作 (Expert Collaboration) 模块 ——  8 个 HTTP 路由 + 支撑它们的完整 turn/状态机实现,所有 copilot_*.go 文件都在这个包里。
// 历史背景: 历史上 copilot_*.go 文件位于 internal/server/ 下, 接收者为 (s *Server);包边界由 internal/copilot/handler.go 里的一个函数字段 Handler 强制约束。
// 本文件(以及 internal/copilot/ 其它文件)用一个真正持有 M02 域逻辑的 Service 类型替换了那层包装壳。
// Service 在 server 启动时由 NewService(store, deps) 构造一次,跨 HTTP 调用复用。
// 它直接持有 M02 依赖:Store + 一小撮对服务端方法的函数字段引用(LLM 流式调用、RAG 检索、记忆治理、runtime 技能等,共约 22 个方法)。用函数字段而不是 interface:
//   - 让 Service 不依赖任何 internal/server/ 导入(无回环风险)
//   - 测试可只 stub 用到的字段,不必实现 22 方法接口
//   - 避免出现一个 22 方法 interface(每个签名都不简单)——99% 的
//     调用方只需要一个字段
//
// 跨调用保活的流式局部状态(lastMemoryBudgetReport 单 slot + supervisor 面板用的 participant map)挂在 Service 上,
// 这些字段原先都在 *Server 上。
//
// 推荐阅读顺序:service.go(本文件)→ handler.go → types.go →  copilot_route.go → copilot_harness.go → copilot_react.go →
// copilot_live_stream.go。完整导览见 internal/copilot/README 旁的文件级导读块。


package copilot

// service.go — 主服务结构:封装 M02 专家协作的全部域逻辑。
//
// Service 在 boot 时由 NewService 构造一次(见文件末尾),跨 HTTP 调用复用;
// 承载 turn state、单 slot 上次预算报告、participant map 等需要跨调用保活的状态。
// 这些字段原先挂在 *Server 上,M11 拆分后下沉到 Service,职责更内聚。
//
// 文件按"类型 → Service 结构 → 工厂/挂载方法 → accessor"四块组织;
// 新增跨包依赖一律加到 Deps 的函数字段里(不进 Service 本身),以保持本文件
// 不反向依赖 internal/server/。

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/agentos"
	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/internal/infra"
	memid "github.com/qizhida-partner-platform/backend/internal/memory/identity"
	"github.com/qizhida-partner-platform/backend/internal/modelprov"
	"github.com/qizhida-partner-platform/backend/internal/store"
)

// ResolvedTurn 是一次 copilot 回合实际命中的"模型元数据"(provider + model + 协议)。
// 它是从模型路由层解析出来的最终生效模型,而不是用户原始请求里写的 modelId。
//
// 历史是从 internal/server/model_invoke.go 里的 `resolvedTurn` 结构镜像过来;
// 迁到这里是为了让 model_invoke.go 可以单向导入 copilot 取这个类型,
// 同时 copilot 自身不再依赖 internal/server/(避免循环回环)。
//
// Source 字段标注这个模型是从哪条路径解析出来的:
//   - "provider" : 直接从模型供应商配置里命中
//   - "routing"  : 经过路由策略选择
//   - "env"     : 走环境变量默认
type ResolvedTurn struct {
	ModelID      string
	ModelName    string
	ProviderID   string
	ProviderName string
	Protocol     string
	Level        string
	Source       string // provider | routing | env
	Request      modelprov.ChatRequest
}

// StreamLLMForCopilotFn 是 copilot 模块对 LLM 流式调用依赖的函数类型契约。
// 函数实现在 internal/models/handlers_invoke.go(作为 *models.Service 的方法,
// 在 boot 时绑定)。
//
// 把类型定义放在消费方包(copilot)而非提供方包(models)的原因:
// 让 models 包不需要导入 copilot 取类型别名,只需要导入 ResolvedTurn 类型(用于返回)。
//
// 历史上是 *Server.streamLLMForCopilot 方法,签名保持一致,
// 所以迁移后既有测试无需改方法签名也能继续工作。
//
// 参数说明:
//   - ctx               : 上下文(用于支持取消与超时)
//   - r                 : HTTP 请求(用于鉴权信息透传)
//   - ws                : 工作区 ID
//   - modelID           : 目标模型 ID
//   - messages          : LLM 输入消息序列
//   - system            : system prompt
//   - onDelta           : 流式回调(每段 token 触发一次,resolvedModelID 用于路由标识)
//
// 返回:完整 reply + 实际命中的 ResolvedTurn + error
type StreamLLMForCopilotFn func(ctx context.Context, r *http.Request, ws, modelID string, messages []modelprov.ChatMessage, system string, onDelta func(text, resolvedModelID string) error) (reply string, resolved ResolvedTurn, err error)

// runtimeMemoryInput 是 ingestRuntimeMemoryLocked 的入参结构体(覆盖范围 / 来源 / 置信度等)。
// 从 internal/server/handlers_memory.go 迁过来,以便 copilot 直接传入而不产生 import cycle。
//
// 字段语义:
//   - WorkspaceID / OwnerID / OwnerName : 记忆归属与所属人
//   - DigitalPartnerID : 关联的数字伙伴 ID(可空)
//   - Title / Content : 记忆标题与正文
//   - SourceType / SourceID : 来源类型(如 "tool_call"\| "user_input") + 来源实体 ID
//   - CorrelationID : 链路关联键,贯穿整次调用
//   - Layer : "short_term" 短期记忆 \| "working" 工作记忆
//   - Scope : 可见性 scope(决定谁能访问)
//   - Confidence : 置信度(0-1,用于后续治理筛选)
type runtimeMemoryInput struct {
	WorkspaceID       string
	OwnerID           string
	OwnerName         string
	DigitalPartnerID string
	Title             string
	Content           string
	SourceType        string
	SourceID          string
	CorrelationID     string
	Layer             string // short_term | working
	Scope             string
	Confidence        float64
}

// participantCtxInput 是构造 participantContext 时的输入载体(身份 / 消息 / 工具 / 会话模式等)。
// 由 dispatch 侧填好,供 participantContext 构造器读取。
//
// 字段语义:
//   - WorkspaceID / ConversationID / CorrelationID : 链路三件套
//   - OwnerID / UserMessage : 用户身份与本轮输入
//   - Channel : 来源渠道(web / feishu / wecom / dingtalk / weixin 等)
//   - EnabledTools : 本次可调用的工具白名单
//   - Viewer / Request : 当前 HTTP 请求的鉴权身份与原始请求
//   - Emit : reactEmitFunc,流式事件 emit
//   - SessionModeHint / RiskLevelHint : 由路由给出的会话模式 / 风险等级建议
type participantCtxInput struct {
	WorkspaceID     string
	ConversationID  string
	CorrelationID   string
	OwnerID         string
	UserMessage     string
	Channel         string
	EnabledTools    []string
	Viewer          *auth.Identity
	Request         *http.Request
	Emit            reactEmitFunc
	SessionModeHint string
	RiskLevelHint   string
}

// participantContext 是 runParticipantTurn 用的"子专家执行上下文"
// (含独立身份 / 记忆 / 模型 / 工具),每次多面板调度会构造一个。
//
// 与 primaryTopicContext 的区别在于它隔离了记忆与工具上下文,
// 多个子专家之间互不污染记忆视野。
//
// IdentityPresent 用于标记身份是否成功加载(避免 nil deref),
// MemoryHits 缓存本轮的召回记忆,避免每次重复检索。
type participantContext struct {
	WorkspaceID     string
	ConversationID  string
	CorrelationID   string
	DigitalPartner string
	SessionMode     string
	RiskLevel       string
	ModelID         string
	Identity        memid.Profile
	IdentityPresent bool
	MemoryHits      []memoryHit
	Tools           []registeredTool
	Channel         string
	Viewer          *auth.Identity
	OwnerID         string
	UserMessage     string
	Request         *http.Request
	Emit            reactEmitFunc
}

// participantTurnResult 是 runParticipantTurn 的返回结果(文本 / 状态 / 时长 / 硬性拒答原因)。
// 由 supervisor 聚合时拼成 panel view。
//
// HardNoRefusal 用于"硬性拒答"(如内容安全触发),区别于普通失败:
// 前者会被记入审计并影响整体 supervisor 决策,后者只算本次失败。
type participantTurnResult struct {
	ParticipantID string
	Text        string
	ModelID     string
	Status      string
	Reason      string
	DurationMs  int
	HardNoRefusal string
	ToolCalls   []map[string]any
}

// serviceTestHooks 把"测试用的可替换钩子"集中在一个结构体里
// (覆盖 runCopilotTool / runPlanExecute 两个执行点)。
//
// 与 serverTestHooks 的区别:本结构限定在 M02 模块内部;
// participantTurnOverride 仍留在 serverTestHooks 上(供 session_panel 测试用)。
//
// 字段语义:
//   - runCopilotToolOverride : 在 copilot 工具执行点注入 panic / 假结果
//   - runPlanExecuteOverride : 在计划执行点注入 plan-execute 的回退
type serviceTestHooks struct {
	runCopilotToolOverride func(ctx toolRunContext, t *registeredTool, call toolCallRequest) toolExecResult
	runPlanExecuteOverride func(in reactTurnInput) reactTurnResult
}

// Deps 是 M02 copilot 模块对 server/ 的"函数字段依赖"集合。
// Server.New() 构造 *Service 时把 dep.Set 按字段绑定到自己的 *Server 方法。
//
// 用函数字段而不是 interface 的两个原因:
//  1. 让 Service 不依赖任何 internal/server/ 导入;
//  2. 测试可只 stub 用到的字段(不必实现 22 方法接口)。
//
// 生产调用方(Server.New)会把全部字段填好;
// 测试可保留任一字段为 nil,在调用现场做 nil 检查。
//
// 字段分组:
//   - 工作区 / 请求上下文(WorkspaceIDFn / RequireMemoryGovernanceFn / EvaluateZeroTrustFn)
//   - 路由 / 模型(ResolveDefaultRouteR*Fn / StreamLLMForCopilotFn)
//   - 记忆 / 审计(Persist*Fn / Ingest*Fn / LogCitationsForRAGFn / MemoryPolicyForFn / MemoryCanReadFn)
//   - RAG / 知识(RetrievePublishedFn)
//   - 技能 / 工具(DispatchAuthorizedToolFn / RunSkillToolFn / ...)
//   - 多 agent / 面板(BuildParticipantContextFn / RunParticipantTurnFn)
//   - 持久化(DurableDeleteSyncFn)
//   - 沙箱 / 模型别名小助手(IsSandboxCopilotWsPathFn / IsDemoModelAliasFn / ...)
//   - 内置技能根目录(BuiltinSkillsRootFn,server 注入,避免拉 M09 skills/ 进 copilot)
// WorkspaceDeps 是请求上下文相关的依赖(workspace ID 提取 + 记忆治理 + 零信任评估)。
// 任何字段都允许 nil(开发期默认);调用前走 Service 上的 depWorkspaceXxx 访问器。
type WorkspaceDeps struct {
	// WorkspaceIDFn 从 HTTP Request 中取出当前请求归属的工作区 ID。
	WorkspaceIDFn func(r *http.Request) string
	// RequireMemoryGovernanceFn 校验当前请求是否符合记忆治理策略
	// (写权限、验证数据边界),不通过直接返回 error 让 handler 拒绝。
	RequireMemoryGovernanceFn func(r *http.Request, actionLabel string) (*auth.Identity, error)
	// EvaluateZeroTrustFn 评估零信任策略(资源 × 操作 × 分类 × 是否外部 × 关联键),
	// 返回策略结果(含 allow/deny + 审计元数据)。
	EvaluateZeroTrustFn func(id *auth.Identity, resource, action, classification string, external bool, corr string) (map[string]any, error)
}

// RoutingDeps 是路由 / 模型选择相关的依赖。
// 任何字段都允许 nil;调用前走 Service 上的 depRoutingXxx 访问器。
type RoutingDeps struct {
	// ResolveDefaultRiskLevelFn 解析员工默认的风险等级。
	ResolveDefaultRiskLevelFn func(employeeID string) string
	// ResolveDefaultSessionModeFn 解析员工默认的会话模式(reactive / proactive / review)。
	ResolveDefaultSessionModeFn func(employeeID string) string
	// ResolveMessageBucketIDFn 把 msgBucketId 原始值映射到存储桶 ID(用于消息幂等键)。
	ResolveMessageBucketIDFn func(ws, raw string) string
	// PublishedPolicyByLevelFn 返回某风险等级对应的已发布策略快照(供 system prompt 拼装用)。
	PublishedPolicyByLevelFn func(ws, level string) map[string]any
	// StreamLLMForCopilotFn 是 LLM 流式调用的契约,见类型定义。
	StreamLLMForCopilotFn StreamLLMForCopilotFn
	// CheckModelBudgetFn 在路由决策前调用,判断当前 workspace 的
	// 模型用量预算是否还有剩余;不通过时 copilot 应降级或拒答。
	// Nil 时表示"未启用用量门禁",直接放行(开发期默认)。
	CheckModelBudgetFn func(ws, employeeID, proposedModelID string) (allowed bool, remainingUSD float64, err error)
}

// MemoryDeps 是记忆治理与审计相关的依赖。
type MemoryDeps struct {
	// PersistMemorySyncFn 同步落盘记忆到 PG(在 ingestLocked 完成后调用)。
	PersistMemorySyncFn func()
	// IngestRuntimeMemoryLockedFn 摄入运行时记忆,返回摄入元数据(MemoryID + 时间戳)。
	IngestRuntimeMemoryLockedFn func(in runtimeMemoryInput) (map[string]any, error)
	// AppendMemoryAuditLockedFn 追加记忆治理审计日志。
	AppendMemoryAuditLockedFn func(ws, actor, action, target, result, corr string)
	// LogCitationsForRAGFn 把 RAG 命中结果写入审计日志(用于追溯答案依据)。
	LogCitationsForRAGFn func(ws, turnID string, hits []map[string]any)
	// MemoryPolicyForFn 返回某工作区的记忆治理策略。
	MemoryPolicyForFn func(ws string) map[string]any
	// MemoryCanReadFn 判断当前身份能否读取该记忆项(用于读取侧零信任)。
	MemoryCanReadFn func(id *auth.Identity, item map[string]any) bool
}

// RAGDeps 是知识检索的依赖。
type RAGDeps struct {
	// RetrievePublishedFn 调用 qzda-rag 服务做已发布知识检索。
	RetrievePublishedFn func(r *http.Request, body map[string]any, corr string) (any, error)
}

// ToolDeps 是工具执行编排的依赖。
type ToolDeps struct {
	// DispatchAuthorizedToolFn 总调度入口:在授权工具集里查找并执行调用。
	DispatchAuthorizedToolFn func(runCtx toolRunContext, reg []registeredTool, call toolCallRequest, sessionMode, risk string, emit reactEmitFunc) (tool *registeredTool, res toolExecResult)
	// RunSkillToolFn 执行技能类工具(builtin 技能的具体执行点)。
	RunSkillToolFn func(ctx toolRunContext, t *registeredTool, call toolCallRequest, started time.Time) toolExecResult
	// RunSkillReadToolFn 执行技能读取类操作(只读,无副作用)。
	RunSkillReadToolFn func(ctx toolRunContext, call toolCallRequest, started time.Time) toolExecResult
	// RunPilotdeckToolFn 执行 Pilotdeck 平台工具(todo_write / ask_user_question 等)。
	RunPilotdeckToolFn func(ctx toolRunContext, t *registeredTool, call toolCallRequest, started time.Time) toolExecResult
	// RunCMDBLookupFn 执行 CMDB 只读适配器(查资产/配置/关系图)。
	RunCMDBLookupFn func(ctx toolRunContext, t *registeredTool, call toolCallRequest, started time.Time) toolExecResult
	// RunRuntimeToolFn 执行平台 runtime 工具(平台预置、不需要授权的)。
	RunRuntimeToolFn func(ctx toolRunContext, t *registeredTool, call toolCallRequest, started time.Time) toolExecResult
	// PersistSkillHealthFn 同步落盘技能健康检查快照。
	PersistSkillHealthFn func()
}

// MultiAgentDeps 是多专家面板的依赖。
type MultiAgentDeps struct {
	// BuildParticipantContextFn 构造子专家执行上下文(身份+记忆+工具+模型)。
	BuildParticipantContextFn func(in ParticipantCtxInput, emp map[string]any) ParticipantContext
	// RunParticipantTurnFn 运行单个子专家 turn。
	RunParticipantTurnFn func(ctx context.Context, pc participantContext) participantTurnResult
}

// PersistenceDeps 是持久化的依赖。
type PersistenceDeps struct {
	// DurableDeleteSyncFn 同步硬删除某个集合下的若干 ID(用于会话/知识/技能卸载)。
	DurableDeleteSyncFn func(collection string, ids ...string)
}

// SandboxHelperDeps 是沙箱 / 模型别名小助手集合。
// 把这些小函数提到 Deps 是为了避免把它们全量依赖链都拉进 copilot。
type SandboxHelperDeps struct {
	// RequireProductionDualApprovalFn 检查生产双人审批是否必需(高风险写操作触发)。
	RequireProductionDualApprovalFn func(submitterID, submitterName string, actor *auth.Identity, verb string) error
	// IsSandboxCopilotWsPathFn 判断路径/命令是否属于 sandbox-copilot 工作区(允许下放)。
	IsSandboxCopilotWsPathFn func(pathOrCmd string) bool
	// IsDemoModelAliasFn 判断模型 ID 是否为 demo 别名(demo 模式下专享)。
	IsDemoModelAliasFn func(id string) bool
	// ParseNextRunCommandFn 从 LLM 输出中解析 next-run 指令(/run ...)。
	ParseNextRunCommandFn func(output string) string
	// ShouldAutoRunAfterSkillWriteFn 判断技能写入后是否需要自动 follow-up run。
	ShouldAutoRunAfterSkillWriteFn func(res toolExecResult, runCmd string) bool
	// IsSkillWorkspaceWriteCallFn 判断本次工具调用是否属于技能工作区写入(用于触发 follow-up 决策)。
	IsSkillWorkspaceWriteCallFn func(call toolCallRequest, tool *registeredTool) bool
	// BuildAutoRunToolCallAfterWriteFn 构造一次写入后的自动 follow-up run 调用。
	BuildAutoRunToolCallAfterWriteFn func(reg []registeredTool, tool *registeredTool, writeCall toolCallRequest, runCmd string) toolCallRequest
}

// SkillsRootDeps 是 builtin 技能根目录解析的依赖。
type SkillsRootDeps struct {
	// BuiltinSkillsRootFn 解析打包的内置技能目录路径。
	// 由 *Server 注入(目录查找逻辑归 M09 skills/ 包,不进 copilot)。
	// Nil-safe:未注入时退回到包内 builtinSkillsRoot 默认值。
	BuiltinSkillsRootFn func() string
}

// Deps 是 M02 copilot 模块对 server/ 的"函数字段依赖"集合(按职责分 9 个子结构)。
//
// Server.New() 构造 *Service 时把 Deps 按子结构绑到自己的 *Server 方法。
//
// 用函数字段而不是 interface 的两个原因:
//  1. 让 Service 不依赖任何 internal/server/ 导入;
//  2. 测试可只 stub 用到的子结构(不必实现 22 方法接口)。
//
// 生产调用方(Server.New)把所有子结构都填好;
// 测试可保留任一字段为 nil,在调用现场做 nil 检查。
//
// 推荐用 Service 上的 `depXxx` 访问器(已统一 nil-safe)。
type Deps struct {
	Workspace  WorkspaceDeps
	Routing    RoutingDeps
	Memory     MemoryDeps
	RAG        RAGDeps
	Tools      ToolDeps
	MultiAgent MultiAgentDeps
	Persist    PersistenceDeps
	Sandbox    SandboxHelperDeps
	SkillsRoot SkillsRootDeps
}

// Service 是 M02 专家协作 (Expert Collaboration) 的 HTTP handler + 状态机。
// 8 个路由 + SSE 流都绑定到这个结构体的方法上。
//
// 字段分四类:
//   - 数据底座(Store / SubAgent / Kernel):只读数据源
//   - 跨包依赖(Deps):server/ 方法的函数字段引用
//   - 流式局部状态(lastMemoryBudgetReport + participant map):跨调用保活
//   - 测试钩子(testHooks)+ 8 个 HTTP handler 函数字段:在 CopH() 里串到 Handler
type Service struct {
	// Store 是 copilot handler 所有读写操作的内存底座(必填)。
	Store *store.Store

	// SubAgent 是多 agent 面板调度用的有界并发引擎
	// (runMultiAgentTurn → dispatchParticipants)。
	// 镜像自历史 *Server.SubAgent 字段;server.New() 构造引擎后交给
	// copilot.NewService,从而 M02 模块可在共享并发上限内并行调度子专家。
	// 为 nil 表示"用零值 Engine"(测试 + 启动早期阶段)。
	SubAgent *agentos.Engine

	// Kernel 是 durable Agent-OS 存储(可选)。
	// nil 时回退到 Store 的内存读取以做 snapshot replay。
	// Server.New 在 boot 时一次性 wire 好 KernelStore。
	Kernel *infra.KernelStore

	// Deps 持有 copilot 模块调用 server/ 方法的函数字段
	// (LLM 流式 / RAG 检索 / 记忆治理 / runtime 技能等)。
	// 详见 Deps 类型注释。
	Deps Deps

	// lastMemoryBudgetReport 由 retrieveMemoryForTurnLocked 设置,
	// 让 copilot stream 能 flush 一条 `memory.budget` SSE 事件。
	// 单 slot:并发回合会相互覆盖——这对可观测性 tail 是可接受的
	// (活 SSE 流只看自己本轮的最近一次写入)。
	lastMemoryBudgetReport *memoryBudgetReport

	// participantMemoryBudgetReports 收集多面板调度期间各子专家的
	// 记忆预算报告,由 supervisor 在面板完成后合并 flush 一条
	// consolidated `memory.budget` 事件。
	participantMemoryBudgetReports map[string]*memoryBudgetReport
	// participantMemoryBudgetMu 守护 participantMemoryBudgetReports。
	participantMemoryBudgetMu sync.Mutex

	// testHooks 让 *_test.go 在明确的接缝处(runPlanExecuteTurn /
	// runCopilotTool)替换行为,不需要把 LLM/RAG 完整栈搭起来。
	// 生产为 nil;nil 内字段表示"该接缝无 override"。
	testHooks *serviceTestHooks

	// ragCache 是 RAG 检索结果缓存(详见 service_cache.go);
	// 懒构造,5min TTL,避免重复问题反复打 qzda-rag。
	ragCache *ragCache

	// HTTP handler 函数字段(8 个标准路由 + 1 个内部钩子)。
	// 生产调用方(server.New)在构造时把这些绑到自己的 *Server 方法上。
	// Handler 结构体把它们当 method value 使用,从而让包依赖始终单向
	// (copilot 永不导入 server/)。
	// CopH() 方法在本包独立运行(例如 copilot 内部测试)时,
	// 会把这些字段填上自身闭包。
	listConversationsFn      func(r *http.Request) (any, error)
	createConversationFn     func(r *http.Request) (any, error)
	getCopilotTurnStatusFn   func(r *http.Request) (any, error)
	replayCopilotTurnFn      func(r *http.Request) (any, error)
	cancelCopilotTurnFn      func(r *http.Request) (any, error)
	copilotMessageFeedbackFn func(r *http.Request) (any, error)
	copilotPostTurnAPIFn     func(r *http.Request) (any, error)
	copilotStreamFn          func(w http.ResponseWriter, r *http.Request)
	evolveCandidateActionFn  func(r *http.Request) (any, error)
}

// NewService 用给定的 Store + Deps 构造一个生产可用的 Service。
// store 是必填的(deps 可为部分填充 —— 测试只跑 SSE / turn 状态机时不需要 LLM/RAG)。
func NewService(store *store.Store, deps Deps) *Service {
	return &Service{
		Store: store,
		Deps:  deps,
	}
}

// New 是 NewService 的零 Deps 便捷别名,供 copilot 内部不接 server/ 依赖的测试使用。
// 用途:跑纯逻辑(频控、模型路由等)而不需要 wire 服务端依赖。
func New(store *store.Store) *Service {
	return NewService(store, Deps{})
}

// CopH 返回 8 个标准 M02 路由的 Handler facade。
// 作为 Service 方法保留,让 copilot 内部测试可以路由 M02 HTTP 路径
// 通过 Handler,不必实例化 *server.Server。
// 生产调用方(server.New)直接用自己方法值 wire Handler。
func (s *Service) CopH() *Handler {
	return &Handler{
		ListConversations:    s.listConversationsFn,
		CreateConversation:    s.createConversationFn,
		GetCopilotTurnStatus:  s.getCopilotTurnStatusFn,
		ReplayCopilotTurn:     s.replayCopilotTurnFn,
		CancelCopilotTurn:     s.cancelCopilotTurnFn,
		// 直接 wire 包内方法,让 copilot 内部测试可经 CopH() 路由
		// 而不必实例化 *server.Server。生产调用方(server.New)会用
		// 自己的方法值覆盖这些字段,做跨包分发。
		CopilotMessageFeedback: s.copilotMessageFeedback,
		CopilotPostTurnAPI:     s.copilotPostTurnAPIFn,
		CopilotStream:          s.copilotStreamFn,
		EvolveCandidateAction:  s.evolveCandidateAction,
	}
}

// SetTestHooks 给 Service 挂上测试用的可替换钩子(panic 注入 / 假 LLM 响应等)。
// 生产调用方不动;测试在 NewService() 之后调一次,把 panic / 假响应注入。
func (s *Service) SetTestHooks(hooks *serviceTestHooks) {
	s.testHooks = hooks
}

// 跨包依赖的便捷访问器。把 nil 检查集中到一处,各方法只调它们即可。
// 每个访问器对 nil receiver 是安全的(测试只跑 SSE / turn 状态机时),
// 生产调用方用 NewService 把 deps 都 wire 好,nil 此处 = 测试态。

// depWorkspaceID 从 Request 里取出当前请求归属的工作区 ID;Deps 未注入时返回空串。
func (s *Service) depWorkspaceID(r *http.Request) string {
	if s == nil || s.Deps.Workspace.WorkspaceIDFn == nil {
		return ""
	}
	return s.Deps.Workspace.WorkspaceIDFn(r)
}

// depCheckModelBudget 短封装,语义见 RoutingDeps.CheckModelBudgetFn。
// 返回 (allowed, remainingUSD):Deps 未注入时按"放行"语义处理(开发期默认)。
func (s *Service) depCheckModelBudget(ws, employeeID, proposedModelID string) (bool, float64, error) {
	if s == nil || s.Deps.Routing.CheckModelBudgetFn == nil {
		return true, 0, nil
	}
	return s.Deps.Routing.CheckModelBudgetFn(ws, employeeID, proposedModelID)
}

// getRAGCache 返回(或懒构造)本 Service 持有的 RAG 缓存。
// nil receiver 返回 nil(测试 / 走旁路场景)。
func (s *Service) getRAGCache() *ragCache {
	if s == nil {
		return nil
	}
	if s.ragCache == nil {
		s.ragCache = newRAGCache()
	}
	return s.ragCache
}