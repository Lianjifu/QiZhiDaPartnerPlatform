/**
 * 跨模块共享类型 — 来自「企智搭 · 数字伙伴平台 v3.0」架构文档
 * 这里只放真正跨多个模块共享的类型；模块私有类型放在各模块 internal 目录。
 */

// ============ 通用基础 ============
export type ID = string;
export type ISODate = string;
export type Timestamp = number;

// ============ 角色与权限（来自 P11）============
/**
 * 平台预置角色。工作区成员展示的历史岗位名称不等同于平台访问角色，
 * 平台实际授权统一收敛为使用者、管理员和审计员三类。
 */
export type Role = 'user' | 'admin' | 'auditor';
export type EnvironmentScope = 'sandbox' | 'staging' | 'production';

export type Permission =
  | 'workspace.read'
  | 'workspace.write'
  | 'agent.read'
  | 'agent.write'
  | 'agent.install'
  | 'workflow.read'
  | 'workflow.write'
  | 'workflow.execute'
  | 'knowledge.read'
  | 'knowledge.write'
  | 'skill.read'
  | 'skill.write'
  | 'skill.execute'
  | 'model.read'
  | 'model.write'
  | 'task.read'
  | 'task.write'
  | 'task.approve' // 双重审批 / 任务放行
  | 'channel.read'
  | 'channel.write'
  | 'audit.read'
  | 'audit.export'
  | 'access.read'
  | 'access.write'
  | 'release.approve'
  | 'billing.read'
  | 'billing.write';

export interface User {
  id: ID;
  name: string;
  email: string;
  avatar?: string;
  role: Role;
  tenantId: ID;
  workspaceId: ID;
  workspaceIds: ID[];
  environmentScopes: EnvironmentScope[];
  permissions: Permission[];
  mfaEnabled: boolean;
}

// ============ 工作区 P4 ============
export type WorkspacePlan = 'enterprise' | 'enterprise_plus' | 'standard';

export interface Workspace {
  id: ID;
  tenantId: ID;
  name: string;
  region: 'cn-east-1' | 'cn-south-1' | 'global';
  plan: WorkspacePlan;
  memberCount: number;
  complianceScore: number; // 0-100
  createdAt: ISODate;
  ownerId: ID;
  status: 'active' | 'frozen' | 'archived';
}

export type WorkspaceEnvironmentKind = 'sandbox' | 'staging' | 'production';
/** 工作区内的业务岗位展示字段，不参与平台访问控制。 */
export interface WorkspaceMember { id: ID; workspaceId: ID; name: string; email: string; role: string; mfa: boolean; expiresAt?: ISODate; lastActive: string; }

export interface AccessGrant {
  id: ID;
  subjectId: ID;
  subjectName: string;
  role: Role;
  tenantId: ID;
  workspaceIds: ID[];
  environmentScopes: EnvironmentScope[];
  status: 'active' | 'expiring' | 'expired';
  expiresAt?: ISODate;
  grantedBy: string;
  createdAt: ISODate;
}

export interface AccessReview {
  id: ID;
  title: string;
  scope: string;
  dueAt: ISODate;
  status: 'open' | 'completed' | 'overdue';
  owner: string;
  reviewed: number;
  total: number;
}

export interface SeparationOfDutyRule {
  id: ID;
  title: string;
  description: string;
  scope: 'tenant' | 'production' | 'sensitive-data';
  enabled: boolean;
  violations: number;
}

export interface ReleaseApproval {
  id: ID;
  workspaceId: ID;
  environment: EnvironmentScope;
  resourceType: 'agent' | 'workflow' | 'model' | 'channel';
  resourceName: string;
  submittedBy: string;
  submittedById: ID;
  submittedAt: ISODate;
  status: 'pending' | 'approved' | 'rejected';
  risk: 'low' | 'medium' | 'high';
  correlationId: string;
}

// ============ 安全与零信任 ============
export type ZeroTrustDecision = 'allow' | 'mask' | 'approval_required' | 'deny';
export type ZeroTrustResource = 'session' | 'task' | 'agent' | 'workflow' | 'knowledge' | 'memory' | 'skill' | 'model' | 'channel' | 'export';
export type ZeroTrustAction = 'read' | 'write' | 'run' | 'publish' | 'approve' | 'export' | 'connect';

export interface ZeroTrustPolicy {
  id: ID;
  name: string;
  resource: ZeroTrustResource;
  action: ZeroTrustAction;
  scope: 'tenant' | 'workspace' | 'production' | 'external_egress';
  condition: string;
  decision: ZeroTrustDecision;
  enabled: boolean;
  version: number;
  updatedAt: ISODate;
  updatedBy: string;
  baseline?: boolean;
}

export interface ZeroTrustEvent {
  id: ID;
  time: ISODate;
  tenantId: ID;
  workspaceId: ID;
  actor: string;
  resource: ZeroTrustResource;
  action: ZeroTrustAction;
  classification: 'public' | 'internal' | 'confidential' | 'restricted';
  decision: ZeroTrustDecision;
  policyId: ID;
  reason: string;
  correlationId: string;
}

export interface ZeroTrustEvaluation {
  decision: ZeroTrustDecision;
  policyId: ID;
  reason: string;
  obligations: Array<'audit' | 'mask_sensitive_fields' | 'require_approval' | 'human_handoff'>;
  correlationId: string;
  riskScore: number;
}

export interface TemporaryAuthorization {
  id: ID;
  subjectName: string;
  subjectId: ID;
  workspaceId: ID;
  environment: EnvironmentScope;
  resource: ZeroTrustResource;
  action: ZeroTrustAction;
  reason: string;
  status: 'active' | 'expired' | 'revoked';
  expiresAt: ISODate;
  approvedBy: string;
}
export interface WorkspaceBinding { id: ID; workspaceId: ID; environment: WorkspaceEnvironmentKind; kind: 'agent' | 'workflow' | 'knowledge' | 'skill' | 'model' | 'channel'; name: string; status: 'active' | 'paused'; }
export interface WorkspaceEnvironment { id: ID; workspaceId: ID; kind: WorkspaceEnvironmentKind; approvalRequired: boolean; canaryPercent: number; status: 'ready' | 'blocked'; }
export interface WorkspacePolicy { workspaceId: ID; dataClassification: 'internal' | 'restricted'; egressAllowed: boolean; toolAllowlist: string[]; retentionDays: number; exceptionStatus: 'none' | 'pending' | 'approved'; }
export interface WorkspaceQuota { workspaceId: ID; seats: { used: number; limit: number }; agents: { used: number; limit: number }; concurrency: { used: number; limit: number }; tokens: { used: number; limit: number }; budgetUsd: { used: number; limit: number }; }
export interface WorkspaceAuditEvent { id: ID; workspaceId: ID; time: ISODate; actor: string; action: string; target: string; result: 'success' | 'failed'; reason?: string; correlationId: string; }
export interface WorkspaceRuntimeEvent { id: ID; workspaceId: ID; type: 'handoff' | 'paused' | 'emergency_stop' | 'incident'; status: 'open' | 'resolved'; detail: string; createdAt: ISODate; }

// ============ 任务 P3 ============
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type TaskStatus = 'pending' | 'in_progress' | 'review' | 'completed' | 'archived';

export interface Task {
  id: ID;
  /** Mock 阶段的工作区归属；真实服务端应从身份上下文派生，不能信任客户端提交值。 */
  workspaceId?: ID;
  ownerId?: ID;
  environment?: WorkspaceEnvironmentKind;
  lifecycleStatus?: string;
  classification?: 'internal' | 'confidential' | 'restricted';
  createdBy?: ID;
  correlationId?: string;
  code: string; // TSK-20260710-019
  title: string;
  description?: string;
  priority: Priority;
  status: TaskStatus;
  assignee?: string;
  /** 绑定的在岗数字伙伴（主对象） */
  digitalPartnerId?: ID;
  /** 展示用岗位专家名称；以员工档案为准，列表可缓存 */
  digitalPartnerName?: string;
  /** @deprecated 执行内核；由数字伙伴 capabilities.agentId 派生，不对外主称 */
  agentId?: ID;
  /** 发起调度的部门负责人数字伙伴 */
  coordinatorId?: ID;
  coordinatorName?: string;
  /** assign=本部门派工；assist=跨部门协办 */
  dispatchKind?: 'assign' | 'assist';
  /** 跨部门协办专家 */
  collaboratorIds?: ID[];
  collaboratorNames?: string[];
  /** 跨部门协办确认；本部门派工为 not_required */
  assistStatus?: 'not_required' | 'pending' | 'accepted' | 'rejected';
  progress: { done: number; total: number };
  slaRemainingMin?: number;
  tags: string[];
  relatedTaskCode?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type TaskLifecycleStage =
  | 'pending'
  | 'running'
  | 'human_action'
  | 'risk'
  | 'completed'
  | 'archived';

export type TaskRisk = 'none' | 'warning' | 'critical' | 'overdue' | 'failed' | 'blocked';

export interface TaskAuditEvent {
  id: ID;
  at: ISODate;
  actor: string;
  action: string;
  detail?: string;
  tone: 'info' | 'success' | 'warn' | 'error';
}

export interface ControlledTask extends Task {
  lifecycleStage: TaskLifecycleStage;
  source: 'alert' | 'conversation' | 'workflow' | 'manual' | 'dispatch';
  sla: {
    dueAt?: ISODate;
    remainingMin?: number;
    risk: TaskRisk;
    escalated: boolean;
  };
  execution: {
    runId?: string;
    currentStep?: string;
    retryCount: number;
    error?: string;
    paused: boolean;
  };
  governance: {
    approvalRequired: boolean;
    approvalStatus: 'not_required' | 'pending' | 'approved' | 'rejected';
    takeoverBy?: string;
    takeoverReason?: string;
    policyBlocked?: boolean;
  };
  links: {
    conversationId?: ID;
    alertCode?: string;
    workflowId?: ID;
    assetName?: string;
    blockedBy?: ID;
  };
  auditEvents: TaskAuditEvent[];
  version: number;
}

// ============ 智能体 P5 ============
export type AgentCategory = 'AIOps' | 'SecOps';
export type AgentStatus = 'installed' | 'available' | 'beta' | 'deprecated';

export interface Agent {
  id: ID;
  workspaceId?: ID;
  ownerId?: ID;
  environment?: WorkspaceEnvironmentKind;
  lifecycleStatus?: string;
  classification?: 'internal' | 'confidential' | 'restricted';
  createdBy?: ID;
  updatedAt?: ISODate;
  name: string;
  category: AgentCategory;
  description: string;
  version: string;
  status: AgentStatus;
  rating: number; // 0-5
  installCount: number;
  cacheHitRate?: number; // 0-1
  p95Ms?: number;
  tools: string[];
  price?: string;
  isStarred?: boolean;
}

// ============ 数字伙伴 ============
/**
 * 数字伙伴是面向业务岗位的一等对象；Agent 仅是其底层执行内核之一。
 * 业务身份、职责边界、受控能力、上岗状态和运行证据均收敛在此对象。
 */
export type DigitalPartnerLifecycle = 'draft' | 'testing' | 'pending_approval' | 'active' | 'paused' | 'quarantined';
export type DigitalPartnerRisk = 'low' | 'medium' | 'high';
export type DigitalPartnerTemplateSource = 'platform' | 'department';
export type DigitalPartnerTemplateStatus = 'certified' | 'review' | 'deprecated';

export interface DigitalPartnerCapabilities {
  agentId?: ID;
  model: string;
  knowledge: string[];
  skills: string[];
  tools: string[];
  workflows: string[];
  channels: string[];
  /** 对话认知思路模型（逻辑/问题解决/创意决策） */
  cognitive?: {
    enabled?: boolean;
    defaultPack?: string;
    allowOverride?: boolean;
    maxFrameworksPerTurn?: number;
    preferredFramework?: 'logic' | 'problem' | 'creative' | string;
    /** 是否在对话中展示三阶段思考叙事 */
    showNarrative?: boolean;
  };
}

/**
 * 岗位授权契约：将数字伙伴的业务职责、可执行范围和人工升级条件结构化，
 * 而不是以不可审计的大段自由文本保存。
 */
export type DigitalPartnerExecutionMode = 'recommend' | 'approval_required' | 'execute' | 'prohibited';
export interface DigitalPartnerResponsibility {
  id: ID;
  title: string;
  objective: string;
  trigger: string;
  deliverables: string[];
  evidenceRequired: boolean;
  workflowRef?: string;
}
export interface DigitalPartnerCapabilityBoundary {
  capabilityType: 'tool' | 'workflow' | 'skill';
  capabilityName: string;
  mode: DigitalPartnerExecutionMode;
}
export interface DigitalPartnerBoundaryPolicy {
  responsibilities: DigitalPartnerResponsibility[];
  capabilityModes: DigitalPartnerCapabilityBoundary[];
  dataClassification: 'internal' | 'confidential' | 'restricted';
  allowedEnvironments: WorkspaceEnvironmentKind[];
  handoff: {
    triggers: string[];
    approvers: string[];
    notificationChannels: string[];
    slaMinutes: number;
  };
}

export interface DigitalPartner {
  id: ID;
  workspaceId: ID;
  name: string;
  role: string;
  department: string;
  description: string;
  owner: string;
  escalationOwner: string;
  serviceObject: string;
  version: string;
  environment: WorkspaceEnvironmentKind;
  lifecycle: DigitalPartnerLifecycle;
  risk: DigitalPartnerRisk;
  /** Optional portrait URL; when absent UI renders a deterministic illustrated avatar. */
  avatarUrl?: string;
  responsibilities: string[];
  prohibitedActions: string[];
  handoffPolicy?: { triggers: string[]; approvalRequiredFor: string[] };
  /** 新版岗位授权契约；历史字段保留以兼容已发布员工与模板。 */
  boundaryPolicy?: DigitalPartnerBoundaryPolicy;
  capabilities: DigitalPartnerCapabilities;
  memoryPolicy: { shortTermHours: number; workingDays: number; longTermCadence: 'daily' | 'weekly'; knowledgePromotion: 'approval_required' | 'disabled' };
  runtime: { calls24h: number; successRate: number; p95Ms: number; costToday: number; handoffs24h: number; anomalies: number };
  evaluation: { status: 'not_started' | 'passed' | 'failed' | 'running'; score?: number; lastRunAt?: ISODate };
  release: {
    status: 'not_released' | 'pending_approval' | 'released';
    releasedAt?: ISODate;
    /** 上岗申请提交人（花名/展示名） */
    requestedBy?: string;
    requestedById?: string;
    /** 双重审批批准人；不得与 requestedById 相同 */
    approver?: string;
    approverId?: string;
    /** 最近一次驳回原因（若有） */
    rejectedReason?: string;
    rejectedBy?: string;
  };
  templateId?: ID;
  templateVersion?: string;
  /** 最近一次运行处置（暂停/隔离/恢复）审计摘要 */
  opsControl?: {
    lastAction: 'paused' | 'quarantined' | 'resumed';
    reason?: string;
    actor?: string;
    at?: ISODate;
  };
  updatedAt: ISODate;
}

/** 员工配置的不可变版本记录；生产或高风险变更需先进入受控审批。 */
export interface DigitalPartnerConfigurationVersion {
  id: ID;
  employeeId: ID;
  version: string;
  status: 'current' | 'pending_approval' | 'superseded';
  changeSummary: string;
  changedFields: string[];
  updatedBy: string;
  /** 提交人 ID；批准时用于职责分离校验 */
  updatedById?: string;
  updatedAt: ISODate;
}

/** 可复用岗位蓝图；采用后会创建独立员工草稿并锁定模板版本。 */
export interface DigitalPartnerTemplate {
  id: ID;
  name: string;
  role: string;
  department: string;
  description: string;
  serviceObject: string;
  version: string;
  risk: DigitalPartnerRisk;
  responsibilities: string[];
  prohibitedActions: string[];
  capabilities: DigitalPartnerCapabilities;
  memoryPolicy: DigitalPartner['memoryPolicy'];
  source: DigitalPartnerTemplateSource;
  sourceName: string;
  status: DigitalPartnerTemplateStatus;
  scope: 'organization' | 'workspace';
  /** 工作区模板必须绑定工作区；组织模板由平台统一维护。 */
  workspaceId?: ID;
  applicableEnvironments: WorkspaceEnvironmentKind[];
  evaluationScore?: number;
  adoptionCount: number;
  tags: string[];
  publishedAt: ISODate;
  updatedAt: ISODate;
}

export interface DigitalPartnerTemplateAdoption {
  id: ID;
  templateId: ID;
  templateVersion: string;
  employeeId: ID;
  workspaceId: ID;
  adoptedBy: string;
  status: DigitalPartnerLifecycle;
  createdAt: ISODate;
}

// ============ 工作流 P6 ============
export type WorkflowNodeKind =
  | 'trigger'
  | 'schedule'
  | 'event'
  | 'retrieve'
  | 'transform'
  | 'decision'
  | 'condition'
  | 'approval'
  | 'policy'
  | 'branch'
  | 'parallel'
  | 'execute'
  | 'http'
  | 'mcp'
  | 'task'
  | 'retry'
  | 'compensate'
  | 'audit'
  | 'notify';

export interface WorkflowNode {
  id: ID;
  kind: WorkflowNodeKind;
  label: string;
  status?: 'idle' | 'running' | 'success' | 'failed';
  durationMs?: number;
  position?: { x: number; y: number };
  description?: string;
}

export interface WorkflowEdge {
  id: ID;
  source: ID;
  target: ID;
}

export interface Workflow {
  id: ID;
  workspaceId?: ID;
  ownerId?: ID;
  environment?: WorkspaceEnvironmentKind;
  lifecycleStatus?: string;
  classification?: 'internal' | 'confidential' | 'restricted';
  createdBy?: ID;
  updatedAt?: ISODate;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  triggerCount: number;
  successRate: number; // 0-1
  avgDurationSec: number;
  status: 'active' | 'draft' | 'paused';
}

// ============ 知识 P7 ============
export type KnowledgeStep = 'ingest' | 'chunk' | 'embed' | 'index' | 'retrieve';

export interface KnowledgeChunk {
  id: ID;
  docId: ID;
  text: string;
  score: number;
  source: string;
  page?: number;
}

export interface KnowledgeDoc {
  id: ID;
  workspaceId?: ID;
  ownerId?: ID;
  /** 归属知识包；未纳管时可为空。 */
  packageId?: ID;
  classification?: 'internal' | 'confidential' | 'restricted';
  correlationId?: string;
  title: string;
  source: string; // Runbook / CMDB / CVE / ...
  sizeKb: number;
  chunks: number;
  citeCount: number;
  status: 'parsing' | 'indexing' | 'ready' | 'failed' | 'published';
  updatedAt: ISODate;
}

export interface KnowledgeSourceConnection {
  id: ID;
  name: string;
  kind: 'REST API' | 'Git / Markdown' | 'Webhook' | '数据库只读连接';
  schedule: string;
  /** 连接目标：API URL / Git 仓库 / 回调地址 / 数据库连接标识（不含密钥） */
  endpoint?: string;
  /** 凭据说明（演示用，不存真实密钥） */
  credentialHint?: string;
  lastSync: string;
  documents: number;
  status: 'healthy' | 'syncing' | 'attention';
}

export interface KnowledgeGovernancePolicy {
  sensitiveDataDetection: boolean;
  versionRetention: boolean;
  retentionDays: number;
  highRiskChangeApproval: boolean;
}

export interface KnowledgeAuditEvent {
  id: ID;
  time: string;
  actor: string;
  action: string;
  target: string;
  result: 'success' | 'failed';
}

export interface KnowledgeRetrievalResult {
  idx: number;
  source: string;
  page?: number | null;
  score: number;
  docId: ID;
  text: string;
}

/** 可被智能体和工作流引用的知识交付单元，而非浮动的原始文档集合。 */
export type KnowledgePackageStatus = 'draft' | 'review' | 'published' | 'deprecated' | 'archived';
export type KnowledgeChunkStrategy = 'structured' | 'semantic' | 'fixed' | 'table';
export type KnowledgeConsumerType = 'agent' | 'workflow' | 'digital_employee';

export interface KnowledgePackageVersion {
  id: ID;
  version: string;
  status: KnowledgePackageStatus;
  indexVersion: string;
  publishedAt?: ISODate;
  qualityScore: number;
  changeSummary: string;
}

export interface KnowledgePackage {
  id: ID;
  workspaceId?: ID;
  ownerId?: ID;
  environment?: WorkspaceEnvironmentKind;
  name: string;
  description: string;
  domain: string;
  classification: 'internal' | 'confidential' | 'restricted';
  owner: string;
  status: KnowledgePackageStatus;
  documentCount: number;
  /** 已纳管文档 ID；与 documentCount 对齐。 */
  documentIds?: ID[];
  consumers: number;
  currentVersion: KnowledgePackageVersion;
  versions: KnowledgePackageVersion[];
  updatedAt?: ISODate;
}

export interface KnowledgeProcessingJob {
  id: ID;
  packageId: ID;
  source: string;
  strategy: KnowledgeChunkStrategy;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  documentCount: number;
  chunkCount: number;
  indexVersion: string;
  startedAt: ISODate;
  error?: string;
}

export interface KnowledgeRetrievalProfile {
  id: ID;
  name: string;
  packageId: ID;
  retrievalModes: Array<'keyword' | 'vector' | 'graph'>;
  topK: number;
  rerankEnabled: boolean;
  noResultPolicy: 'clarify' | 'handoff' | 'block';
}

export interface KnowledgeEvaluation {
  id: ID;
  packageId: ID;
  profileId: ID;
  baselineVersion: string;
  evaluatedVersion: string;
  recallAtK: number;
  mrr: number;
  ndcg: number;
  citationAccuracy: number;
  p95LatencyMs: number;
  status: 'passed' | 'needs_review' | 'failed';
  evaluatedAt: ISODate;
}

export interface KnowledgeGraphEntity {
  id: ID;
  name: string;
  type: 'service' | 'asset' | 'runbook' | 'alert' | 'vulnerability' | 'owner';
  confidence: number;
  sourceDocId: ID;
  sourceVersion: string;
}

export interface KnowledgeGraphRelation {
  id: ID;
  fromId: ID;
  toId: ID;
  type: 'depends_on' | 'impacts' | 'owned_by' | 'handled_by' | 'references';
  confidence: number;
  sourceDocId: ID;
  sourceVersion: string;
}

export interface KnowledgeConsumerBinding {
  id: ID;
  workspaceId?: ID;
  correlationId?: string;
  packageId: ID;
  packageName: string;
  packageVersion: string;
  consumerType: KnowledgeConsumerType;
  consumerId: ID;
  consumerName: string;
  environment: 'production' | 'staging' | 'sandbox';
  profileId: ID;
  noResultPolicy: KnowledgeRetrievalProfile['noResultPolicy'];
}

// ============ 记忆中心 ============
export type MemoryLayer = 'short_term' | 'working' | 'long_term';
export type MemoryScope = 'user' | 'team' | 'workspace' | 'agent';
export type MemorySourceType = 'conversation' | 'task' | 'workflow' | 'manual';
export type MemoryStatus = 'active' | 'pending_review' | 'expired' | 'revoked' | 'promoted';

/** 受控运行记忆，不等同于已发布的企业知识资产。 */
export interface MemoryRecord {
  id: ID;
  workspaceId: ID;
  ownerId: ID;
  /** 关联数字伙伴；用于岗位维度检索与策略对照。 */
  digitalPartnerId?: ID;
  layer: MemoryLayer;
  scope: MemoryScope;
  title: string;
  content: string;
  classification: 'internal' | 'confidential' | 'restricted';
  sourceType: MemorySourceType;
  sourceId: ID;
  correlationId: string;
  confidence: number;
  status: MemoryStatus;
  expiresAt?: ISODate;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface MemoryKnowledgeCandidate {
  id: ID;
  workspaceId: ID;
  memoryId: ID;
  title: string;
  summary: string;
  classification: MemoryRecord['classification'];
  sourceCorrelationId: string;
  status: 'pending_review' | 'approved' | 'rejected';
  submittedAt: ISODate;
  reviewedAt?: ISODate;
  reviewer?: string;
  knowledgePackageId?: ID;
}

/** Phase 4 Self-Evolution：回合/反馈产生的受控候选，审核前不改生产策略。 */
export type EvolveCandidateKind = 'memory_promote' | 'skill_patch' | 'routing_hint' | 'dream';
export type EvolveCandidateStatus = 'pending_review' | 'pending_countersign' | 'approved' | 'rejected' | 'applied';

export interface EvolveCandidate {
  id: ID;
  workspaceId: ID;
  kind: EvolveCandidateKind;
  status: EvolveCandidateStatus;
  title: string;
  summary: string;
  fingerprint?: string;
  payload?: Record<string, unknown>;
  conversationId?: ID;
  messageId?: ID;
  correlationId?: string;
  sourceCorrelationId?: string;
  submittedAt: ISODate;
  reviewedAt?: ISODate;
  reviewer?: string;
  firstReviewer?: string;
  createdBy?: string;
  effect?: Record<string, unknown>;
  feedbackKind?: 'like' | 'dislike';
  signers?: Array<{ userId?: ID; name?: string; role?: string; signedAt?: ISODate }>;
}

export interface MemoryPolicy {
  workspaceId: ID;
  shortTermTtlHours: number;
  workingMemoryTtlDays: number;
  /** 每日渐进提炼的调度时间；由真实后端调度器执行。 */
  dailyRefinementTime: string;
  shortToWorkingEnabled: boolean;
  workingToLongEnabled: boolean;
  longToKnowledgeEnabled: boolean;
  minimumConfidence: number;
  longTermWriteApproval: boolean;
  sensitiveDataMasking: boolean;
  longTermCapacity: number;
  usedCapacity: number;
}

export interface MemoryAuditEvent {
  id: ID;
  workspaceId: ID;
  time: ISODate;
  actor: string;
  action: string;
  target: string;
  result: 'success' | 'failed';
  correlationId: string;
}

// ============ 技能 P8 ============
export type SkillKind = 'skill' | 'mcp' | 'tool';
export type SkillLifecycleStatus = 'enabled' | 'disabled' | 'pending_approval' | 'quarantined' | 'deprecated';
export type SkillSource = 'market' | 'import' | 'mcp' | 'tool' | 'package';

export interface Skill {
  id: ID;
  workspaceId?: ID;
  ownerId?: ID;
  environment?: WorkspaceEnvironmentKind;
  classification?: 'internal' | 'confidential' | 'restricted';
  name: string;
  kind: SkillKind;
  description: string;
  version: string;
  status: AgentStatus;
  rating: number;
  installCount: number;
  riskLevel: 'low' | 'mid' | 'high';
  cacheable: boolean;
  costPerCall?: string;
  lifecycleStatus?: SkillLifecycleStatus;
  source?: SkillSource;
  owner?: string;
  team?: string;
  lastVerifiedAt?: string;
  hasUpdate?: boolean;
  upgradeVersion?: string;
  tags?: string[];
  hasScripts?: boolean;
  packageSha256?: string;
  packageFileName?: string;
  packageFiles?: string[];
  scripts?: string[];
  /** 商店来源：builtin | registry | promoted */
  channel?: 'builtin' | 'registry' | 'promoted' | string;
  channelLabel?: string;
  syncedAt?: string;
  visibilityScope?: 'global' | 'org' | 'workspace' | string;
  releaseChannel?: 'stable' | 'beta' | string;
  publisher?: string;
  signed?: boolean;
}

export interface CapabilityRef {
  id: ID;
  kind: 'skill' | 'mcp' | 'tool' | 'workflow_skill';
  name: string;
  pinnedVersion: string;
}

export interface SkillGovernancePolicy {
  skillId: ID;
  secretRef: string;
  allowedEgress: string[];
  writeApprovalRequired: boolean;
  rateLimitPerMinute: number;
  circuitBreakerEnabled: boolean;
  dataMaskingEnabled: boolean;
}

export type SkillIntegrationType = 'skill' | 'mcp' | 'tool';
export type SkillIntegrationStatus = 'draft' | 'validating' | 'pending_approval' | 'enabled' | 'failed' | 'quarantined' | 'disabled';

export interface SkillIntegration {
  id: ID;
  name: string;
  type: SkillIntegrationType;
  environment: 'development' | 'test' | 'production';
  status: SkillIntegrationStatus;
  owner: string;
  endpoint: string;
  credentialRef: string;
  lastVerifiedAt: string;
  health: 'healthy' | 'attention' | 'unknown';
  discoveredCapabilities: number;
  writeApprovalRequired: boolean;
  allowedEgress: string[];
  lastError?: string;
  /** 关联技能 ID（包导入 / 注册时写入，供连通性验证） */
  skillId?: ID;
  /** MCP 协议规范：mcp-streamable-http | mcp-sse | mcp-stdio */
  protocol?: string;
  authMode?: string;
}

export type SkillHealthStatus = 'healthy' | 'attention' | 'incident' | 'paused' | 'quarantined';

export interface SkillRuntimeHealth {
  id: ID;
  skillId: ID;
  name: string;
  kind: SkillKind;
  environment: 'development' | 'test' | 'production';
  status: SkillHealthStatus;
  calls24h: number;
  successRate: number;
  p95Ms: number;
  errorRate: number;
  riskLevel: 'low' | 'mid' | 'high';
  owner: string;
  references: number;
  updatedAt: string;
}

export interface SkillGovernanceIncident {
  id: ID;
  skillId: ID;
  skillName: string;
  severity: 'P0' | 'P1' | 'P2';
  type: 'execution_failure' | 'latency' | 'policy_blocked' | 'credential' | 'connection';
  title: string;
  detail: string;
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt: string;
  requestId: string;
}

export interface SkillGovernanceEvent {
  id: ID;
  time: string;
  skillName: string;
  type: 'call' | 'policy' | 'approval' | 'change' | 'lifecycle';
  action: string;
  actor: string;
  result: 'success' | 'failed' | 'blocked';
  requestId?: string;
}

export interface SkillRuntimeConfig {
  cacheable: boolean;
  timeout: string;
  retries: string;
}

export interface SkillPermission {
  skillId: ID;
  role: string;
  canCall: boolean;
  canConfig: boolean;
}

export interface SkillImpactReport {
  skillId: ID;
  agents: string[];
  workflows: string[];
  activeRuns: number;
  uninstallAllowed: boolean;
  reason?: string;
}

export interface SkillInstallPreflight {
  skillId: ID;
  trustedPublisher: boolean;
  signatureValid: boolean;
  dependencies: Array<{ name: string; status: 'ready' | 'missing' }>;
  requiresApproval: boolean;
  decision: 'approved' | 'review_required' | 'blocked';
  reason?: string;
  vulnerabilityCount?: number;
  checks?: Array<{ label: string; status: 'passed' | 'failed' | 'review' }>;
}

export interface SkillAuditEvent {
  id: ID;
  time: string;
  actor: string;
  action: string;
  target: string;
  result: 'success' | 'failed';
  correlationId?: string;
}

export interface CapabilityBinding {
  id: ID;
  targetType: 'agent' | 'workflow';
  targetId: ID;
  capabilityKind: 'skill' | 'workflow_skill' | 'mcp' | 'tool';
  capabilityId: ID;
  pinnedVersion: string;
  status: 'active' | 'pending_approval' | 'disabled';
  createdBy: string;
  createdAt: string;
  auditId: string;
}

export interface WorkflowSkill {
  id: ID;
  sourceWorkflowId: ID;
  sourceVersionId: string;
  name: string;
  description: string;
  riskLevel: 'low' | 'mid' | 'high';
  approvalRequired: boolean;
  rollbackSupported: boolean;
  status: 'draft' | 'published' | 'deprecated';
}

// ============ 模型 Provider P9 ============
export type ProviderTier = 'official' | 'self_hosted' | 'connectable';

export interface Provider {
  id: ID;
  name: string;
  tier: ProviderTier;
  models: string[];
  region: 'global' | 'cn';
  status: 'active' | 'standby' | 'offline';
  monthlyTokens: number;
  monthlyCostUsd: number;
}

export type ModelLevel = 'P0' | 'P1' | 'P2' | 'P3' | 'audit';

export interface ModelRoute {
  level: ModelLevel;
  primary: string;
  fallback1: string;
  fallback2?: string;
  crossBorder: boolean; // 是否出境
}

// ============ 模型控制面（P0/P1 治理契约）============
export type ModelCapability = 'chat' | 'reasoning' | 'embedding' | 'vision';
export type ModelProviderStatus = 'draft' | 'standby' | 'active' | 'disabled' | 'offline';
export type RoutingPolicyStatus = 'draft' | 'ready' | 'published' | 'superseded';
/** 主流大模型接入协议，决定表单字段与默认 Base URL。 */
export type ModelConnectProtocol =
  | 'openai_compatible'
  | 'azure_openai'
  | 'anthropic'
  | 'dashscope'
  | 'ollama'
  | 'custom';

/** 已准入的模型部署；凭据只以引用和掩码形式出现在客户端。 */
export interface ModelProfile {
  id: ID;
  providerId: ID;
  name: string;
  cloudRegion: string;
  dataResidency: 'cn' | 'global';
  capabilities: ModelCapability[];
  status: 'available' | 'unavailable';
  contextWindow: number;
}

export interface ModelProvider {
  id: ID;
  workspaceId: ID;
  name: string;
  tier: ProviderTier;
  /** 接入协议，缺省按 tier 推断展示。 */
  protocol?: ModelConnectProtocol;
  /** API Base URL / Azure Endpoint，不含密钥。 */
  baseUrl?: string;
  /** Azure 等需要的 API Version。 */
  apiVersion?: string;
  /** OpenAI Organization / Project（可选）。 */
  organizationId?: string;
  /** Azure Deployment Name 等。 */
  deploymentName?: string;
  /** 接入备注（账号用途等）。 */
  note?: string;
  cloudRegion: string;
  dataResidency: 'cn' | 'global';
  status: ModelProviderStatus;
  credentialRef: string;
  credentialMasked: string;
  lastVerifiedAt?: ISODate;
  models: ModelProfile[];
}

export interface ProviderImpact {
  providerId: ID;
  routeReferences: Array<{ policyId: ID; level: ModelLevel; versionId: ID }>;
  deletionAllowed: boolean;
  blockedReason?: string;
}

export interface RoutingPolicyDraft {
  id: ID;
  workspaceId: ID;
  level: Exclude<ModelLevel, 'audit'>;
  primaryModelId: ID;
  fallbackModelIds: ID[];
  dataScope: 'internal' | 'restricted';
  egressAllowed: boolean;
  budgetLimitUsd: number;
  status: RoutingPolicyStatus;
  validationIssues: string[];
}

export interface RoutingPolicyVersion {
  id: ID;
  policyId: ID;
  version: number;
  snapshot: RoutingPolicyDraft;
  publishedAt: ISODate;
  publishedBy: string;
  rollbackOf?: ID;
}

export interface ModelAuditEvent {
  id: ID;
  time: ISODate;
  workspaceId: ID;
  actor: string;
  action: string;
  target: string;
  result: 'success' | 'failed';
  reason?: string;
  policyVersion?: ID;
  correlationId: string;
}

/** 模型治理总览（Mock 演示语义，非生产结算证明） */
export interface ModelGovernanceSnapshot {
  activeProviders: number;
  standbyProviders: number;
  disabledProviders: number;
  publishedRoutes: number;
  draftRoutes: number;
  budgetRisk: 'normal' | 'attention' | 'critical';
  /** 占用上限：仅已发布路由预算之和（与强制限额一致） */
  monthlyBudgetUsd: number;
  /** 草稿/待发布规划预算，不计入占用分母 */
  draftBudgetUsd?: number;
  monthlySpendUsd: number;
  healthyShare: number;
  avgLatencyMs: number;
  regionDistribution: Array<{ region: string; count: number }>;
  updatedAt: ISODate;
}

// ============ 渠道 P10 ============
export type ChannelKind = 'feishu' | 'wecom' | 'weixin' | 'slack' | 'dingtalk' | 'webhook';

export interface Channel {
  id: ID;
  name: string;
  kind: ChannelKind;
  enabled: boolean;
  monthlySent: number;
  successRate: number; // 0-1
}

// ============ 渠道控制面（P0/P1/P2）============
export type ChannelDeploymentStatus = 'draft' | 'active' | 'disabled' | 'offline';
export type DeliveryPolicyStatus = 'draft' | 'ready' | 'published' | 'superseded';

export interface ChannelDeployment {
  id: ID;
  workspaceId: ID;
  name: string;
  kind: ChannelKind;
  environment: 'production' | 'sandbox';
  status: ChannelDeploymentStatus;
  credentialRef: string;
  credentialMasked: string;
  owner: string;
  lastVerifiedAt?: ISODate;
  /** Provider Open API / ilink base */
  domain?: string;
  appIdMasked?: string;
  clientIdMasked?: string;
  corpIdMasked?: string;
  tokenMasked?: string;
  botOpenId?: string;
  botName?: string;
  robotCode?: string;
  agentId?: string;
  accountId?: string;
  connectionMode?: 'long_connection' | 'webhook' | 'stream' | 'websocket' | 'long_poll';
  webhookPath?: string;
  webhookUrl?: string;
  hasEncryptKey?: boolean;
  hasVerificationToken?: boolean;
  hasCallbackToken?: boolean;
  hasCallbackAesKey?: boolean;
  lastVerifyError?: string;
  latencyMs?: number;
}

export interface DeliveryPolicyDraft {
  id: ID;
  workspaceId: ID;
  eventType: string;
  primaryDeploymentId: ID;
  fallbackDeploymentIds: ID[];
  audience: string;
  dataClassification: 'internal' | 'restricted';
  status: DeliveryPolicyStatus;
  validationIssues: string[];
}

export interface DeliveryPolicyVersion {
  id: ID;
  policyId: ID;
  version: number;
  snapshot: DeliveryPolicyDraft;
  publishedAt: ISODate;
  publishedBy: string;
  rollbackOf?: ID;
}

export interface DeliveryAttempt {
  id: ID;
  workspaceId: ID;
  policyId: ID;
  deploymentId: ID;
  targetMasked: string;
  payloadSummary: string;
  status: 'delivered' | 'failed' | 'dead_letter';
  attempts: number;
  correlationId: string;
  createdAt: ISODate;
}

export interface ChannelAuditEvent {
  id: ID;
  workspaceId: ID;
  time: ISODate;
  actor: string;
  action: string;
  target: string;
  result: 'success' | 'failed';
  reason?: string;
  policyVersion?: ID;
  correlationId: string;
}

// ============ 会话 P2 ============
export type SignerRole = 'operator' | 'approver' | 'auditor';
export type ApprovalDecision = 'pending' | 'approved' | 'rejected';

export interface Signer {
  /** 已绑定的审批主体 ID；审批依据必须是身份而不是可编辑的显示姓名 */
  userId: ID;
  name: string;
  role: SignerRole;
  signed: boolean;
  signedAt?: ISODate;
  /** 签名 hash（合规审计链） */
  signatureHash?: string;
}

export interface ApprovalRequest {
  action: string;
  /** 写操作对应的命令/资源标识 */
  resource?: string;
  /** 至少需要的签名人数 */
  required: number;
  /** 已完成签名人数 */
  signed: number;
  signers: Signer[];
  decision: ApprovalDecision;
  /** 关联工单 / 变更单 */
  ticketId?: string;
  /** 触发原因（如等保 3 / 高危命令） */
  reason?: string;
  /** 该审批在审计日志中的 hash */
  policyHash?: string;
  decidedAt?: ISODate;
}

export interface ChatMessage {
  id: ID;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  agentId?: ID;
  agentName?: string;
  citations?: KnowledgeChunk[];
  toolCalls?: ToolCall[];
  /** 受控写操作的双重审批请求 */
  approvalRequest?: ApprovalRequest;
  linkedTaskId?: ID;
  createdAt: ISODate;
}

export interface ToolCall {
  id: ID;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'denied';
  durationMs?: number;
  permission?: 'auto' | 'ask' | 'deny';
  sandboxId?: string;
  traceId?: string;
}

export interface Conversation {
  id: ID;
  workspaceId?: ID;
  ownerId?: ID;
  correlationId?: string;
  /** 绑定的数字伙伴（主对象） */
  digitalPartnerId?: ID;
  /** @deprecated 执行内核；由数字伙伴 capabilities.agentId 派生 */
  agentId: ID;
  title: string;
  messages: ChatMessage[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ============ 设置 P11 ============
export interface AuditItem {
  id: ID;
  name: string;
  category: 'identity' | 'data' | 'access' | 'audit' | 'compliance';
  status: 'pass' | 'warn' | 'fail';
  updatedAt: ISODate;
}

// ============ KPI（首页 P1）============
export interface KpiCard {
  id: ID;
  label: string;
  value: string | number;
  delta?: { value: number; trend: 'up' | 'down' | 'flat' };
  status?: 'ok' | 'warn' | 'error';
  unit?: string;
}

// ============ 通用 API 响应 ============
export interface ApiResponse<T> {
  ok: boolean;
  data: T;
  error?: { code: string; message: string };
}

export interface PageQuery {
  page: number;
  pageSize: number;
  keyword?: string;
}

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export {
  AGENT_OS_ERROR_CODES,
  INBOUND_CHANNEL_KINDS,
  LOOP_MODES,
  MEMORY_LAYERS,
  POLICY_DECISIONS,
  RISK_LEVELS,
  SESSION_MODES,
  STREAM_EVENT_TYPES,
  isInboundChannelKind,
  isPolicyDecision,
  isSessionMode,
  isStreamEventType,
} from './agent-os';
export type {
  AgentOSErrorCode,
  ContextSnapshot,
  EmployeeBinding,
  Envelope,
  InboundChannelKind,
  LoopMode,
  MemoryLayerWire,
  MemoryProvenance,
  PolicyDecision,
  ReplayTurnResponse,
  RiskLevel,
  SessionMode,
  StreamEvent,
  StreamEventType,
} from './agent-os';
