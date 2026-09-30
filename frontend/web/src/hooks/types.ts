/**
 * 会话模块共享类型 — 企业级数字伙伴会话规范
 *
 * 在原有 ChatMessageEx / ChatSession 基础上扩展：
 *  - 消息生命周期状态机
 *  - Reasoning / Tool / RAG 完整审计字段
 *  - 双签审批（policy + 角色 + 时间戳）
 *  - Feedback 写回（RAG eval / 训练）
 *  - 安全与合规（moderation / 安全标签）
 *  - 可观测性（correlationId / requestId / metrics）
 *
 * 旧字段全部保留以兼容既有 UI（Copilot.tsx / DebugPanel.tsx）。
 */

/* ---------- 枚举 ---------- */

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';
export type MessageStatus =
  | 'queued'
  | 'in_flight'
  | 'streaming'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'moderated';

export type FeedbackKind = 'like' | 'dislike' | null;
export type FeedbackTag = 'factuality' | 'helpfulness' | 'harmful' | 'style' | 'outdated' | 'other';

export type ApprovalDecision = 'pending' | 'approved' | 'rejected' | 'expired';
export type SignerRole = 'operator' | 'auditor' | 'approver';

export type SessionStatus = 'active' | 'idle' | 'archived' | 'deleted';
export type SessionGroup = 'today' | 'yesterday' | 'week' | 'earlier' | 'archived';

export type ErrorCategory =
  | 'network'
  | 'auth'
  | 'timeout'
  | 'rate_limit'
  | 'content_filter'
  | 'tool_denied'
  | 'internal'
  | 'unknown';

/* ---------- 公共结构 ---------- */

export interface Citation {
  id: string;
  docId: string;
  chunkId?: string;
  source: string;
  page?: number | null;
  score: number;
  rerankScore?: number;
  span?: { start: number; end: number };
  text: string;
  evalLabel?: 'gold' | 'useful' | 'noisy' | 'harmful';
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'denied' | 'needs_instruction';
  durationMs?: number;
  retryCount?: number;
  /** 权限策略：auto / approval-required / denied / disabled / prohibited … */
  permission?: string;
  /** gVisor 沙箱执行 ID，可审计 */
  sandboxId?: string;
  /** 调用 traceId，与审计事件关联 */
  traceId?: string;
  error?: string;
}

export interface ReasoningStep {
  id: string;
  kind: 'plan' | 'search' | 'analyze' | 'tool_call' | 'reflect' | 'finalize' | 'framework';
  title: string;
  detail?: string;
  /** 该步骤产生的引用 ID（RAG） */
  citationIds?: string[];
  /** 该步骤触发的工具调用 ID */
  toolCallIds?: string[];
  /** 该步骤开始/结束时间（ISO） */
  startedAt?: string;
  endedAt?: string;
  /** 认知思路模型框架 id：logic | problem | creative */
  framework?: string;
  frameworkLabel?: string;
  /** quick | standard | deep */
  cognitiveMode?: string;
  phase?: string;
  phaseStep?: string;
  phases?: string[];
  role?: 'primary' | 'secondary' | string;
  confidence?: number;
}

export interface Signer {
  /** 已绑定的审批主体 ID；审批依据必须是身份而不是可编辑的显示姓名。 */
  userId: string;
  name: string;
  role: SignerRole;
  signed: boolean;
  signedAt?: string;
  /** 签名 hash（合规审计链） */
  signatureHash?: string;
}

export interface SkillTurnStep {
  id?: string;
  action?: string;
  title?: string;
  status?: string;
  args?: Record<string, unknown>;
  output?: string;
}

export interface SkillTurnPlan {
  version?: number;
  summary?: string;
  steps?: SkillTurnStep[];
}

export interface ApprovalRequest {
  action: string;
  /** 写操作对应的命令/资源标识 */
  resource?: string;
  /** 至少需要的签名人数（生产路径固定为 1） */
  required: number;
  /** 已完成签名人数（兼容旧字段名） */
  signed: number;
  signers: Signer[];
  decision: ApprovalDecision;
  /** 关联工单 / 变更单 */
  ticketId?: string;
  /** 触发原因（如等保 3 / 高危命令） */
  reason?: string;
  /** 该审批在审计日志中的 hash */
  policyHash?: string;
  decidedAt?: string;
  /** Skill Turn 多步计划（write → run） */
  skillTurn?: SkillTurnPlan;
  planSummary?: string;
  /** 单人审核：escalationOwner / 角色提示 */
  approverRoleHint?: string;
  /** 解析后的授权候选人 userId */
  approverCandidateIds?: string[];
  approverCandidateNames?: string[];
}

export interface MessageFeedback {
  kind: FeedbackKind;
  tags?: FeedbackTag[];
  comment?: string;
  ratedBy?: string;
  ratedAt?: string;
}

export interface SafetyInfo {
  /** 内容过滤命中分类 */
  flaggedCategory?: 'pii' | 'secrets' | 'harmful' | 'compliance';
  /** 命中后采取的处理：redact / block / warn */
  action?: 'redact' | 'block' | 'warn' | 'allow';
  /** 脱敏后的原文（若有） */
  redactedText?: string;
}

/* ---------- 指标 ---------- */

export interface MessageMetrics {
  /** 首 token 时间（ms） */
  ttftMs?: number;
  /** 总耗时 */
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  /** 上下文缓存命中数 */
  cacheHits?: number;
  /** 模型 / 提供商 */
  model?: string;
  provider?: string;
  /** 本轮注入的记忆白盒溯源 */
  memoryHits?: number;
  memoryProvenance?: Array<{ id?: string; title?: string; layer?: string; score?: number }>;
  ragHits?: number;
  /** Agent OS 回合快照，用于只读复盘 */
  snapshotId?: string;
}

/* ---------- 消息 ---------- */

export interface ChatMessageEx {
  /* 兼容字段 */
  id: string;
  role: MessageRole;
  content: string;
  agentId?: string;
  agentName?: string;
  citations?: Citation[];
  toolCalls?: ToolCall[];
  codeBlock?: { lang: string; code: string };
  attachment?: { name: string; size: string; type: 'file' | 'image' };
  thinking?: string;
  approvalRequest?: ApprovalRequest;
  /** 批准后仍待续跑的 skill.run command */
  nextRunCommand?: string;
  canContinueRun?: boolean;
  createdAt: string;

  /* 新增字段（企业级） */
  /** 客户端幂等 ID，用于重试去重 */
  clientMsgId?: string;
  /** 服务端消息 ID（流式完成后填回） */
  serverMsgId?: string;
  status?: MessageStatus;
  /** 失败原因 */
  error?: { category: ErrorCategory; message: string; retryable?: boolean };
  /** 链路追踪 ID */
  correlationId?: string;
  /** 父消息 ID（分支 / 重新生成） */
  parentId?: string;
  /** 分支序号（同一 parent 的多次重新生成） */
  branchIndex?: number;
  /** Reasoning 步骤 */
  reasoningSteps?: ReasoningStep[];
  /** Reasoning 折叠摘要（一段式兼容字段） */
  thinkingSummary?: string;
  /** 本轮认知思路模型快照（主/辅框架、模式、是否旁路） */
  cognitive?: {
    bypass?: boolean;
    bypassReason?: string;
    enabled?: boolean;
    primary?: string;
    primaryLabel?: string;
    secondary?: string;
    secondaryLabel?: string;
    mode?: string;
    phases?: string[];
    confidence?: number;
    reasons?: string[];
    digestTokensEst?: number;
    showNarrative?: boolean;
  };
  /** 回合叙事元数据（意图理解/任务规划/工具执行） */
  turnMeta?: {
    narrative?: string;
    summary?: string;
    phases?: Array<{
      phase: string;
      label: string;
      status: string;
      stepCount?: number;
      steps?: ReasoningStep[];
    }>;
    tasks?: Array<{
      id: string;
      title: string;
      status: string;
      detail?: string;
    }>;
  };
  /** 流式任务清单（done 后合并进 turnMeta） */
  turnTasks?: Array<{
    id: string;
    title: string;
    status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
    detail?: string;
    startedAt?: string;
    endedAt?: string;
  }>;
  /** 生成态进度（气泡「正在执行」；不进思考面板） */
  progressHint?: string;
  /** 用户反馈 */
  feedback?: MessageFeedback;
  /** 本轮注入记忆白盒溯源 */
  memoryProvenance?: Array<{ id?: string; title?: string; layer?: string; score?: number }>;
  /** 内容安全 */
  safety?: SafetyInfo;
  /** 指标 */
  metrics?: MessageMetrics;
  /** 升级到人工 */
  escalatedTo?: { userId: string; userName: string; at: string };
  /** 关联任务 / 工单 */
  linkedTaskId?: string;
  /** 最近一次编辑时间 */
  editedAt?: string;
  /** 多段回复序号（同一 correlationId 内从 0 递增） */
  segmentIndex?: number;
  /** 分段类型：artifact 等为下载附件段 */
  segmentKind?: 'ack' | 'body' | 'summary' | 'step' | 'artifact';
}

/* ---------- 会话 ---------- */

export interface ChatSessionMetrics {
  totalMessages: number;
  totalTokens: number;
  avgTtftMs: number;
  successRate: number;
  cancelledCount: number;
  feedbackLike: number;
  feedbackDislike: number;
}

/** 刷新后可恢复的进行中回合元数据 */
export interface PendingTurn {
  correlationId: string;
  clientMsgId: string;
  replyId?: string;
  userMessageId?: string;
  content: string;
  startedAt: string;
}

export interface ChatSession {
  /* 兼容字段 */
  id: string;
  title: string;
  preview: string;
  /** @deprecated 展示用岗位专家名称；请优先使用 digitalEmployeeName / digitalEmployeeId */
  agent: string;
  agentKey?: string;
  /** 绑定的在岗数字伙伴（主对象） */
  digitalEmployeeId?: string;
  digitalEmployeeName?: string;
  status: 'active' | 'done' | 'closed' | 'archived';
  group: SessionGroup;
  time: string;
  pinned?: boolean;
  starred?: boolean;
  unread?: number;
  messages: ChatMessageEx[];
  createdAt: number;

  /* 新增字段 */
  /** 企业级会话状态 */
  lifecycle?: SessionStatus;
  /** 工作区 ID（RBAC） */
  workspaceId?: string;
  /** 服务端会话详情 id；缺省时与 session.id 相同 */
  conversationId?: string;
  /** 会话选用的模型路由 key */
  modelId?: string;
  /** 启用的工具链 */
  enabledTools?: string[];
  /** 研判 / 受控执行（由 runMode 派生，ABI 保留） */
  sessionMode?: 'investigate' | 'execute';
  /** 产品协作模式：问答 / 方案 / 执行 */
  runMode?: 'ask' | 'plan' | 'agent';
  /** 推理强度：关 / 标准 / 深度 */
  reasoningEffort?: 'off' | 'standard' | 'deep';
  /** 会话风险等级 */
  riskLevel?: 'low' | 'medium' | 'high';
  /** 回复分段：单条 / 语义分段 / 步骤播报 */
  replyMode?: 'single' | 'segmented' | 'stepwise';
  /** 人工交接 */
  handoff?: { active?: boolean; ownerId?: string; ownerName?: string; at?: string; note?: string };
  /** 结案摘要 */
  closeSummary?: string;
  /** 会话所有者 */
  ownerId?: string;
  ownerName?: string;
  /** 协作者列表 */
  collaborators?: { userId: string; userName: string; role: 'viewer' | 'editor' }[];
  /** 会话标签 */
  tags?: string[];
  /** 自动摘要（归档 / 长会话） */
  summary?: string;
  /** 归档时间 */
  archivedAt?: number;
  /** 过期时间（TTL） */
  expiresAt?: number;
  /** 整体指标 */
  metrics?: ChatSessionMetrics;
  /** 最近一次活跃（用于侧栏排序） */
  lastActiveAt?: number;
  /** 已 POST /api/sessions 创建，等待列表 API 收录前勿 reconcile 删除 */
  pendingServerSync?: boolean;
  /** 进行中回合（刷新后可恢复轮询） */
  pendingTurn?: PendingTurn;
  /** 分享 token（仅查看） */
  shareToken?: string;
}

/* ---------- 输入 ---------- */

export interface SendMessageInput {
  text: string;
  /** 携带附件（图片 / 文件） */
  attachments?: { name: string; size: string; type: 'file' | 'image'; url?: string }[];
  /** 显式指定数字伙伴（默认沿用会话绑定） */
  digitalEmployeeId?: string;
  /** @deprecated 内部执行内核引用 */
  agentId?: string;
  /** 显式指定模型（兼容旧字段） */
  model?: string;
  /** 运行配置：模型 ID（优先于 session.modelId） */
  modelId?: string;
  /** 运行配置：本会话启用的工具链 */
  enabledTools?: string[];
  /** Harness 模式提示（react / plan / direct） */
  modeHint?: string;
  /** Reflection 开关提示 */
  reflectHint?: string;
  /** 研判 / 受控执行 */
  sessionMode?: 'investigate' | 'execute';
  /** 产品协作模式 */
  runMode?: 'ask' | 'plan' | 'agent';
  /** 推理强度 */
  reasoningEffort?: 'off' | 'standard' | 'deep';
  /** 风险等级 */
  riskLevel?: 'low' | 'medium' | 'high';
  /** 回复分段模式 */
  replyMode?: 'single' | 'segmented' | 'stepwise';
  attachmentIds?: string[];
  /** 客户端幂等键 */
  clientMsgId?: string;
  /** 携带的 @ 提及 */
  mentions?: { kind: 'expert' | 'skill' | 'doc' | 'member' | 'agent'; key: string }[];
}

/* ---------- 导出 ---------- */

export interface SessionExportPayload {
  format: 'markdown' | 'json' | 'audit';
  sessionId: string;
  includeCitations?: boolean;
  includeToolCalls?: boolean;
  includeReasoning?: boolean;
  includeAuditTrail?: boolean;
}
