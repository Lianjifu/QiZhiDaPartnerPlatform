/**
 * Mock 适配器 — 前端可独立运行
 * 运行时默认不注入；仅 VITE_USE_MOCK=true 时由 web/main.tsx 挂载。单元测试可直接 import mockHandler。
 */
import type {
  Agent,
  DigitalPartner,
  DigitalPartnerConfigurationVersion,
  DigitalPartnerTemplate,
  DigitalPartnerTemplateAdoption,
  CapabilityBinding,
  AuditItem,
  Channel,
  ChannelAuditEvent,
  ChannelDeployment,
  ChannelKind,
  DeliveryAttempt,
  DeliveryPolicyDraft,
  DeliveryPolicyVersion,
  ControlledTask,
  ScheduledTask,
  ScheduledTaskRun,
  Conversation,
  KnowledgeAuditEvent,
  KnowledgeConsumerBinding,
  KnowledgeGovernancePolicy,
  KnowledgeDoc,
  KnowledgeEvaluation,
  KnowledgeGraphEntity,
  KnowledgeGraphRelation,
  KnowledgePackage,
  KnowledgeProcessingJob,
  KnowledgeRetrievalProfile,
  KnowledgeRetrievalResult,
  KnowledgeSourceConnection,
  KpiCard,
  ModelAuditEvent,
  ModelConnectProtocol,
  ModelProfile,
  ModelProvider,
  ModelRoute,
  MemoryAuditEvent, MemoryKnowledgeCandidate, MemoryPolicy, MemoryRecord, EvolveCandidate,
  Provider,
  ProviderImpact,
  RoutingPolicyDraft,
  RoutingPolicyVersion,
  Skill,
  SkillAuditEvent,
  SkillImpactReport,
  SkillInstallPreflight,
  SkillPermission,
  SkillGovernancePolicy,
  SkillIntegration,
  SkillRuntimeHealth,
  SkillGovernanceIncident,
  SkillGovernanceEvent,
  SkillRuntimeConfig,
  Task,
  Workflow,
  WorkflowSkill,
  Workspace,
  WorkspaceAuditEvent, WorkspaceBinding, WorkspaceEnvironment, WorkspaceMember, WorkspacePolicy, WorkspaceQuota, WorkspaceRuntimeEvent,
  AccessGrant, AccessReview, SeparationOfDutyRule, ReleaseApproval, Role, Permission, User, TemporaryAuthorization, ZeroTrustAction, ZeroTrustDecision, ZeroTrustEvaluation, ZeroTrustEvent, ZeroTrustPolicy, ZeroTrustResource,
} from '@qzda/web-types';
import { sleep } from '@qzda/web-utils';
import { createScheduleDomain, mockScheduledTasks } from './schedule-domain';
import {
  buildHomeExtraLive,
  normalizeEmployeeCapabilities,
  type HomeExtraLive,
} from './home-live-aggregate';
import { dispatchM01Handler, type M01Context } from './m01-mock-handlers';
export * from './home-live-aggregate';

// ============ 静态 Mock 数据（来自功能模块文档） ============

// ============ P4 工作区扩展数据 ============

/** @deprecated 遗留花名列表；/api/workspaces/:id/partners 已改为返回数字伙伴实体。 */
export const mockWorkspaceAgents = {
  w1: ['夜航', '青禾', '观星', '衡山', '明鉴', '暖橙'],
  w2: ['衡山'],
  w3: ['追影'],
  w4: [],
};

export const mockWorkspaceTools = {
  w1: { enabled: 18, total: 24, list: ['redis-cli', 'kubectl', 'loki-query', 'prometheus-mcp', 'cmdb-tool', 'jira-tool', '...'] },
  w2: { enabled: 12, total: 24, list: ['kubectl', 'redis-cli', '...'] },
  w3: { enabled: 14, total: 24, list: ['siem-mcp', 'cve-tool', '...'] },
  w4: { enabled: 3, total: 24, list: ['email-tool'] },
};

export const mockWorkspaceMembers = {
  w1: [
    { id: 'u1', name: '王昊', role: 'Admin', email: 'wanghao@acme.com', mfa: true, lastActive: '刚刚' },
    { id: 'u2', name: '李婷', role: 'SRE', email: 'liting@acme.com', mfa: true, lastActive: '5min 前' },
    { id: 'u3', name: '张睿', role: 'Sec', email: 'zhangrui@acme.com', mfa: true, lastActive: '12min 前' },
    { id: 'u4', name: '孙博', role: 'Admin', email: 'sunbo@acme.com', mfa: true, lastActive: '32min 前' },
    { id: 'u5', name: '周慧', role: 'View', email: 'zhouhui@acme.com', mfa: false, lastActive: '1h 前' },
  ],
  w2: [
    { id: 'u6', name: '赵明', role: 'SRE', email: 'zhaoming@acme.com', mfa: true, lastActive: '8min 前' },
    { id: 'u7', name: '陈雪', role: 'SRE', email: 'chenxue@acme.com', mfa: true, lastActive: '15min 前' },
  ],
  w3: [
    { id: 'u8', name: '李雷', role: 'Sec', email: 'lilei@acme.com', mfa: true, lastActive: '2min 前' },
    { id: 'u9', name: '韩梅梅', role: 'Sec', email: 'hanmeimei@acme.com', mfa: true, lastActive: '20min 前' },
    { id: 'u10', name: 'Lucy', role: 'View', email: 'lucy@acme.com', mfa: true, lastActive: '45min 前' },
  ],
  w4: [
    { id: 'u11', name: '外协 A', role: 'View', email: 'partner-a@external.com', mfa: true, lastActive: '1d 前' },
    { id: 'u12', name: '外协 B', role: 'View', email: 'partner-b@external.com', mfa: true, lastActive: '3d 前' },
  ],
};

export const mockWorkspaceSwitchHistory = [
  { id: 's1', time: '14:32', user: '王昊', from: 'ACME 预发', to: 'ACME 生产', reason: '故障处理' },
  { id: 's2', time: '12:15', user: '张睿', from: 'ACME 安全', to: 'ACME 生产', reason: '审计报告' },
  { id: 's3', time: '09:30', user: '李婷', from: 'ACME 生产', to: 'ACME 预发', reason: '测试部署' },
  { id: 's4', time: '昨天 17:20', user: '孙博', from: '外协沙箱', to: 'ACME 生产', reason: '代码合并' },
];

export const mockWorkspaces: Workspace[] = [
  { id: 'w1', tenantId: 'tenant-acme', ownerId: 'u1', status: 'active', name: 'ACME 生产', region: 'cn-east-1', plan: 'enterprise_plus', memberCount: 18, complianceScore: 98, createdAt: '2024-03-12T00:00:00Z' },
  { id: 'w2', tenantId: 'tenant-acme', ownerId: 'u1', status: 'active', name: 'ACME 预发', region: 'cn-east-1', plan: 'enterprise', memberCount: 6, complianceScore: 92, createdAt: '2024-05-08T00:00:00Z' },
  { id: 'w3', tenantId: 'tenant-acme', ownerId: 'u1', status: 'active', name: 'ACME 安全', region: 'cn-east-1', plan: 'enterprise_plus', memberCount: 4, complianceScore: 100, createdAt: '2024-06-01T00:00:00Z' },
  { id: 'w4', tenantId: 'tenant-acme', ownerId: 'u1', status: 'active', name: '外协沙箱', region: 'cn-south-1', plan: 'standard', memberCount: 2, complianceScore: 85, createdAt: '2025-01-15T00:00:00Z' },
];
const workspaceBindings: WorkspaceBinding[] = [{ id: 'wb1', workspaceId: 'w1', environment: 'production', kind: 'agent', name: '夜航 · SRE 故障处置专员', status: 'active' }, { id: 'wb2', workspaceId: 'w1', environment: 'production', kind: 'model', name: 'P0 路由', status: 'active' }];
const workspaceEnvironments: WorkspaceEnvironment[] = ['sandbox', 'staging', 'production'].map((kind) => ({ id: `w1-${kind}`, workspaceId: 'w1', kind: kind as WorkspaceEnvironment['kind'], approvalRequired: kind === 'production', canaryPercent: kind === 'production' ? 10 : 100, status: 'ready' }));
const workspacePolicies: WorkspacePolicy[] = [{ workspaceId: 'w1', dataClassification: 'restricted', egressAllowed: false, toolAllowlist: ['kubectl', 'cmdb-tool'], retentionDays: 365, exceptionStatus: 'none' }];
const workspaceQuotas: WorkspaceQuota[] = [{ workspaceId: 'w1', seats: { used: 18, limit: 50 }, agents: { used: 6, limit: 20 }, concurrency: { used: 4, limit: 20 }, tokens: { used: 1240000, limit: 5000000 }, budgetUsd: { used: 1240, limit: 3000 } }];
const workspaceAudits: WorkspaceAuditEvent[] = [];
const workspaceRuntimeEvents: WorkspaceRuntimeEvent[] = [];

// ============ P0-P2 身份与访问治理（Mock） ============
const rolePermissions: Record<Role, Permission[]> = {
  user: ['workspace.read', 'agent.read', 'agent.write', 'workflow.read', 'workflow.write', 'workflow.execute', 'knowledge.read', 'knowledge.write', 'skill.read', 'skill.write', 'skill.execute', 'task.read', 'task.write'],
  admin: ['workspace.read', 'workspace.write', 'agent.read', 'agent.write', 'agent.install', 'workflow.read', 'workflow.write', 'workflow.execute', 'knowledge.read', 'knowledge.write', 'skill.read', 'skill.write', 'skill.execute', 'model.read', 'model.write', 'task.read', 'task.write', 'task.approve', 'channel.read', 'channel.write', 'audit.read', 'audit.export', 'access.read', 'access.write', 'release.approve', 'billing.read', 'billing.write'],
  auditor: ['workspace.read', 'agent.read', 'workflow.read', 'knowledge.read', 'skill.read', 'model.read', 'task.read', 'channel.read', 'audit.read', 'audit.export'],
};

const mockAccessGrants: AccessGrant[] = [
  { id: 'grant-admin', subjectId: 'u1', subjectName: '平台管理员', role: 'admin', tenantId: 'tenant-acme', workspaceIds: ['w1', 'w2', 'w3', 'w4'], environmentScopes: ['sandbox', 'staging', 'production'], status: 'active', grantedBy: '系统初始化', createdAt: '2026-07-01T08:00:00Z' },
  { id: 'grant-user', subjectId: 'u2', subjectName: '业务构建者', role: 'user', tenantId: 'tenant-acme', workspaceIds: ['w1', 'w2'], environmentScopes: ['sandbox', 'staging'], status: 'active', grantedBy: '平台管理员', createdAt: '2026-07-02T08:00:00Z' },
  { id: 'grant-auditor', subjectId: 'u3', subjectName: '合规审计员', role: 'auditor', tenantId: 'tenant-acme', workspaceIds: ['w1', 'w2', 'w3'], environmentScopes: ['sandbox', 'staging', 'production'], status: 'active', grantedBy: '平台管理员', createdAt: '2026-07-03T08:00:00Z' },
  { id: 'grant-expiring', subjectId: 'u12', subjectName: '外协复核员', role: 'auditor', tenantId: 'tenant-acme', workspaceIds: ['w4'], environmentScopes: ['sandbox'], status: 'expiring', expiresAt: '2026-07-25T18:00:00Z', grantedBy: '平台管理员', createdAt: '2026-07-10T08:00:00Z' },
];

const mockAccessReviews: AccessReview[] = [
  { id: 'review-q3', title: '第三季度生产环境访问复核', scope: '生产环境 · 3 个工作区', dueAt: '2026-07-31T23:59:59Z', status: 'open', owner: '平台管理员', reviewed: 12, total: 18 },
  { id: 'review-external', title: '外协沙箱临时授权复核', scope: '外协沙箱', dueAt: '2026-07-25T18:00:00Z', status: 'open', owner: '平台管理员', reviewed: 1, total: 2 },
];

const mockSodRules: SeparationOfDutyRule[] = [
  { id: 'sod-self-approval', title: '创建者不可审批自己的生产发布', description: '生产环境变更必须由另一名管理员审批。', scope: 'production', enabled: true, violations: 0 },
  { id: 'sod-audit-readonly', title: '审计用户只读', description: '审计用户不得拥有资源编辑、权限配置或发布动作。', scope: 'tenant', enabled: true, violations: 0 },
  { id: 'sod-sensitive-export', title: '高敏数据导出双人复核', description: '受限知识与记忆导出需要管理员审批并保留用途记录。', scope: 'sensitive-data', enabled: true, violations: 1 },
];

const mockReleaseApprovals: ReleaseApproval[] = [
  { id: 'approval-agent-21', workspaceId: 'w1', environment: 'production', resourceType: 'agent', resourceName: '客服质检助手 v2.1', submittedBy: '业务构建者', submittedById: 'u2', submittedAt: '2026-07-21T02:30:00Z', status: 'pending', risk: 'medium', correlationId: 'corr-release-agent-21' },
  { id: 'approval-channel-12', workspaceId: 'w1', environment: 'production', resourceType: 'channel', resourceName: '企业微信通知策略 v1.2', submittedBy: '业务构建者', submittedById: 'u2', submittedAt: '2026-07-21T03:05:00Z', status: 'pending', risk: 'high', correlationId: 'corr-release-channel-12' },
];

const zeroTrustPolicies: ZeroTrustPolicy[] = [
  { id: 'zt-user-production', name: '普通用户生产变更门禁', resource: 'workflow', action: 'publish', scope: 'production', condition: '角色为普通用户', decision: 'approval_required', enabled: true, baseline: true, version: 3, updatedAt: '2026-07-22T00:00:00Z', updatedBy: '平台管理员' },
  { id: 'zt-restricted-egress', name: '受限数据禁止外部出口', resource: 'model', action: 'run', scope: 'external_egress', condition: '数据分类为受限', decision: 'deny', enabled: true, baseline: true, version: 5, updatedAt: '2026-07-22T00:00:00Z', updatedBy: '安全管理员' },
  { id: 'zt-memory-governance', name: '记忆治理管理员专属', resource: 'memory', action: 'write', scope: 'workspace', condition: '修改保留、提炼或审核策略', decision: 'deny', enabled: true, baseline: true, version: 2, updatedAt: '2026-07-22T00:00:00Z', updatedBy: '平台管理员' },
  { id: 'zt-tool-approval', name: '高风险工具调用复核', resource: 'skill', action: 'run', scope: 'production', condition: '高风险或写操作工具', decision: 'approval_required', enabled: true, baseline: true, version: 4, updatedAt: '2026-07-22T00:00:00Z', updatedBy: '安全管理员' },
  { id: 'zt-auditor-readonly', name: '审计角色只读', resource: 'export', action: 'write', scope: 'tenant', condition: '角色为审计用户', decision: 'deny', enabled: true, baseline: true, version: 1, updatedAt: '2026-07-22T00:00:00Z', updatedBy: '平台管理员' },
];
const zeroTrustEvents: ZeroTrustEvent[] = [
  { id: 'zt-event-1', time: '2026-07-22T08:12:00Z', tenantId: 'tenant-acme', workspaceId: 'w1', actor: '业务构建者', resource: 'memory', action: 'write', classification: 'internal', decision: 'deny', policyId: 'zt-memory-governance', reason: '普通用户不能修改记忆治理策略', correlationId: 'corr-zt-memory-1' },
  { id: 'zt-event-2', time: '2026-07-22T08:06:00Z', tenantId: 'tenant-acme', workspaceId: 'w1', actor: '业务构建者', resource: 'workflow', action: 'publish', classification: 'internal', decision: 'approval_required', policyId: 'zt-user-production', reason: '生产发布已转为管理员审批', correlationId: 'corr-zt-release-1' },
  { id: 'zt-event-3', time: '2026-07-22T07:54:00Z', tenantId: 'tenant-acme', workspaceId: 'w1', actor: '数字伙伴', resource: 'model', action: 'run', classification: 'restricted', decision: 'deny', policyId: 'zt-restricted-egress', reason: '受限数据禁止发送到外部模型', correlationId: 'corr-zt-egress-1' },
];
const temporaryAuthorizations: TemporaryAuthorization[] = [
  { id: 'zta-1', subjectId: 'u2', subjectName: '业务构建者', workspaceId: 'w2', environment: 'staging', resource: 'workflow', action: 'run', reason: '预发回归验证', status: 'active', expiresAt: '2026-07-24T18:00:00Z', approvedBy: '平台管理员' },
];

function mockIdentity(headers?: Record<string, string>): User | null {
  const token = headers?.Authorization?.replace(/^Bearer\s+/i, '');
  const role = headers?.['x-mock-role'] as Role | undefined;
  const mapped: Record<string, { role: Role; id: string; name: string }> = {
    'mock-admin-token': { role: 'admin', id: 'u1', name: '平台管理员' },
    'mock-model-admin-token': { role: 'admin', id: 'u1', name: '平台管理员' },
    'mock-user-token': { role: 'user', id: 'u2', name: '业务构建者' },
    'mock-jwt-token': { role: 'user', id: 'u2', name: '业务构建者' },
    'mock-auditor-token': { role: 'auditor', id: 'u3', name: '合规审计员' },
  };
  const base = (token && mapped[token]) ?? (role ? { role, id: headers?.['x-mock-user-id'] ?? 'u1', name: headers?.['x-mock-actor'] ?? '当前用户' } : null);
  if (!base) return null;
  const grant = mockAccessGrants.find((item) => item.subjectId === base.id) ?? { workspaceIds: ['w1'], environmentScopes: ['sandbox', 'staging'] as const };
  return { id: base.id, name: base.name, email: `${base.id}@acme.com`, role: base.role, tenantId: 'tenant-acme', workspaceId: grant.workspaceIds[0] ?? 'w1', workspaceIds: [...grant.workspaceIds], environmentScopes: [...grant.environmentScopes], permissions: rolePermissions[base.role], mfaEnabled: true };
}

// ============ 首页扩展数据（live-aggregate；禁止演示 KPI 充数） ============
export type HomeExtra = HomeExtraLive;

/** @deprecated 仅保留类型兼容；运行时由 buildHomeExtraLive 聚合 */
export const mockHomeExtra: HomeExtra = buildHomeExtraLive({
  workspaceId: 'w1',
  tasks: [],
  employees: [],
  sessions: [],
  members: [],
  usageMeters: [],
});

/** 用量计量；空数组 → costMonth.source=none（诚实空态） */
export const mockUsageMeters: Array<{ workspaceId: string; usd: number; budgetUsd: number; units: number }> = [];

const homeAlertAcknowledgements = new Map<string, { acknowledgedAt: string; acknowledgedBy: string; acknowledgementNote: string }>();

export const mockTasks: Task[] = [
  {
    id: 't-dispatch-1', code: 'TSK-20260722-101', title: '本部门派工 · 告警降噪复核', priority: 'P1', status: 'pending',
    assignee: '王昊', digitalPartnerId: 'de-alert-ops', digitalPartnerName: '告警运营专员', agentId: 'a6',
    coordinatorId: 'de-it-head', coordinatorName: '信息技术部负责人', dispatchKind: 'assign', assistStatus: 'not_required',
    progress: { done: 0, total: 3 }, slaRemainingMin: 180, tags: ['派工', '告警'],
    description: '北辰向本部门观星派工：复核重复告警合并建议并回报值班影响。',
    createdAt: '2026-07-22T08:00:00Z', updatedAt: '2026-07-22T08:00:00Z',
  },
  {
    id: 't-assist-1', code: 'TSK-20260722-102', title: '跨部门协办 · 发布窗口费用核验', priority: 'P2', status: 'review',
    assignee: '钱财', digitalPartnerId: 'de-expense-ops', digitalPartnerName: '费用核算专员', agentId: 'a2',
    coordinatorId: 'de-it-head', coordinatorName: '信息技术部负责人', dispatchKind: 'assist',
    collaboratorIds: ['de-expense-ops'], collaboratorNames: ['费用核算专员'], assistStatus: 'pending',
    progress: { done: 0, total: 2 }, slaRemainingMin: 360, tags: ['协办', '财务', '发布'],
    description: '北辰请求财务部精算协助核验灰度发布相关费用单据；待对方确认协办后执行。',
    createdAt: '2026-07-22T08:10:00Z', updatedAt: '2026-07-22T08:10:00Z',
  },
  {
    id: 't1', code: 'TSK-20260713-001', title: '与夜航协同处置 Redis OOM', priority: 'P0', status: 'in_progress',
    assignee: '王昊', digitalPartnerId: 'de-sre', digitalPartnerName: 'SRE 故障处置专员', agentId: 'a1',
    progress: { done: 4, total: 6 }, slaRemainingMin: -8, tags: ['redis', '生产', 'OOM'],
    description: 'prod-redis-01 触发 maxmemory；需与在岗专家夜航确认扩容方案并完成双重审批后执行。',
    createdAt: '2026-07-13T08:12:00Z', updatedAt: '2026-07-13T08:24:00Z',
  },
  {
    id: 't2', code: 'TSK-20260713-002', title: 'K8s 节点扩容 · 待专家确认', priority: 'P1', status: 'review',
    assignee: '李婷', digitalPartnerId: 'de-change', digitalPartnerName: '变更协同专员', agentId: 'a3',
    progress: { done: 3, total: 4 }, slaRemainingMin: 32, tags: ['k8s', '扩容'], relatedTaskCode: 'INC-019',
    description: '扩容影响 5 个服务；磐石已汇集风险，等待双重审批与负责人确认。',
    createdAt: '2026-07-13T07:55:00Z', updatedAt: '2026-07-13T08:20:00Z',
  },
  {
    id: 't3', code: 'TSK-20260713-003', title: '威胁狩猎 · 横向移动线索复核', priority: 'P1', status: 'in_progress',
    assignee: '张睿', digitalPartnerId: 'de-threat-hunt', digitalPartnerName: '威胁狩猎专员', agentId: 'a5',
    progress: { done: 2, total: 5 }, slaRemainingMin: 120, tags: ['siem', 'edr'],
    description: '追影已关联 SIEM/EDR 线索，需安全分析师复核后决定是否升级响应。',
    createdAt: '2026-07-13T07:30:00Z', updatedAt: '2026-07-13T08:00:00Z',
  },
  {
    id: 't4', code: 'TSK-20260713-004', title: '告警降噪 · 重复规则合并建议', priority: 'P2', status: 'in_progress',
    assignee: '陈雪', digitalPartnerId: 'de-alert-ops', digitalPartnerName: '告警运营专员', agentId: 'a6',
    progress: { done: 1, total: 3 }, slaRemainingMin: 240, tags: ['siem'],
    description: '观星归并重复规则后，由值班经理确认静默策略。',
    createdAt: '2026-07-13T06:40:00Z', updatedAt: '2026-07-13T07:50:00Z',
  },
  {
    id: 't5', code: 'TSK-20260712-019', title: '漏洞 CVE-2026-3321 · 修复协同', priority: 'P1', status: 'review',
    assignee: '赵明', digitalPartnerId: 'de-vulnerability', digitalPartnerName: '漏洞响应专员', agentId: 'a7',
    progress: { done: 5, total: 5 }, tags: ['cve', '安全'],
    description: '破晓已完成影响分析；待安全负责人确认修复窗口。',
    createdAt: '2026-07-12T16:20:00Z', updatedAt: '2026-07-13T02:00:00Z',
  },
  {
    id: 't6', code: 'TSK-20260712-018', title: '容量预测 · Q3 评估结论', priority: 'P3', status: 'completed',
    assignee: '周慧', digitalPartnerId: 'de-capacity', digitalPartnerName: '容量与性能专员', agentId: 'a4',
    progress: { done: 4, total: 4 }, tags: ['容量'],
    description: '衡山完成 Q3 评估，结论已交由平台运维负责人决策。',
    createdAt: '2026-07-12T10:00:00Z', updatedAt: '2026-07-12T18:00:00Z',
  },
  {
    id: 't7', code: 'TSK-20260712-017', title: '网关灰度发布 · 保障协同', priority: 'P2', status: 'completed',
    assignee: '孙博', digitalPartnerId: 'de-release-guard', digitalPartnerName: '发布保障专员', agentId: 'a3',
    progress: { done: 6, total: 6 }, tags: ['灰度'],
    description: '守望完成灰度观察与回滚预案确认。',
    createdAt: '2026-07-12T09:15:00Z', updatedAt: '2026-07-12T11:30:00Z',
  },
];

// 演示数据也必须经过工作区边界。真实服务端应由认证后的主体决定该字段。
mockTasks.forEach((task, index) => Object.assign(task, {
  workspaceId: index === 4 ? 'w3' : index === 5 ? 'w2' : 'w1',
  ownerId: index === 2 ? 'u3' : 'u1',
  environment: index === 5 ? 'staging' : 'production',
  classification: index === 2 || index === 4 ? 'restricted' : 'internal',
  createdBy: 'u1',
  correlationId: `corr_task_${task.id}`,
}));

type TaskActor = { actor?: string; reason?: string };
type TaskSeed = Task | ControlledTask;

const cloneTask = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** 岗位 → 执行内核映射（唯一源）；一对多共享内核时仍以岗位 ID 为准。 */
const EMPLOYEE_BY_ID: Record<string, { name: string; role: string; agentId?: string }> = {
  'de-sre': { name: '夜航', role: 'SRE 故障处置专员', agentId: 'a1' },
  'de-it': { name: '青禾', role: 'IT 服务台专员', agentId: 'a2' },
  'de-change': { name: '磐石', role: '变更协同专员', agentId: 'a3' },
  'de-capacity': { name: '衡山', role: '容量与性能专员', agentId: 'a4' },
  'de-alert-ops': { name: '观星', role: '告警运营专员', agentId: 'a6' },
  'de-release-guard': { name: '守望', role: '发布保障专员', agentId: 'a3' },
  'de-vulnerability': { name: '破晓', role: '漏洞响应专员', agentId: 'a7' },
  'de-threat-hunt': { name: '追影', role: '威胁狩猎专员', agentId: 'a5' },
  'de-secops': { name: '听潮', role: '安全事件分析专员', agentId: 'a5' },
  'de-expense-ops': { name: '精算', role: '费用核算专员', agentId: 'a2' },
  'de-it-head': { name: '北辰', role: '信息技术部负责人', agentId: 'a2' },
  'de-compliance': { name: '明鉴', role: '安全合规核查专员', agentId: 'a8' },
  'de-endpoint-support': { name: '知秋', role: '终端支持专员', agentId: 'a2' },
  'de-identity-access': { name: '钥灵', role: '身份与访问专员', agentId: 'a2' },
  'de-workplace': { name: '云桥', role: '协作平台运营专员', agentId: 'a2' },
  'de-rd-manager': { name: '铸锋', role: '研发部负责人', agentId: 'a3' },
  'de-qa-assistant': { name: '拾光', role: '质量保障专员', agentId: 'a3' },
  'de-sales-manager': { name: '远航', role: '销售部负责人', agentId: 'a2' },
  'de-crm-assistant': { name: '暖橙', role: '客户跟进专员', agentId: 'a2' },
  'de-marketing-manager': { name: '星河', role: '市场部负责人', agentId: 'a2' },
  'de-content-ops': { name: '墨白', role: '内容运营专员', agentId: 'a2' },
  'de-bizops-manager': { name: '行远', role: '运营部负责人', agentId: 'a2' },
  'de-growth-ops': { name: '破浪', role: '增长运营专员', agentId: 'a2' },
  'de-hr-manager': { name: '春晖', role: '人事部负责人', agentId: 'a2' },
  'de-hr-assistant': { name: '清欢', role: '人事服务专员', agentId: 'a2' },
  'de-finance-manager': { name: '衡通', role: '财务部负责人', agentId: 'a2' },
};

/** 执行内核 → 主岗位（仅缺 digitalPartnerId 时的回退；由 EMPLOYEE_BY_ID 主键推导）。 */
const EMPLOYEE_BY_AGENT: Record<string, { id: string; name: string; role: string }> = Object.fromEntries(
  (Object.entries(EMPLOYEE_BY_ID) as Array<[string, { name: string; role: string; agentId?: string }]>)
    .filter(([, meta]) => meta.agentId)
    .reduce((acc, [id, meta]) => {
      const agentId = meta.agentId!;
      if (!acc.has(agentId)) acc.set(agentId, { id, name: meta.name, role: meta.role });
      return acc;
    }, new Map<string, { id: string; name: string; role: string }>())
    .entries(),
);

function resolveEmployeeFields(seed: Partial<Task>) {
  if (seed.digitalPartnerId) {
    const known = EMPLOYEE_BY_ID[seed.digitalPartnerId];
    return {
      digitalPartnerId: seed.digitalPartnerId,
      digitalPartnerName: seed.digitalPartnerName ?? known?.role ?? known?.name,
      agentId: seed.agentId ?? known?.agentId,
    };
  }
  if (seed.agentId && EMPLOYEE_BY_AGENT[seed.agentId]) {
    const mapped = EMPLOYEE_BY_AGENT[seed.agentId];
    return { digitalPartnerId: mapped.id, digitalPartnerName: seed.digitalPartnerName ?? mapped.role ?? mapped.name, agentId: seed.agentId };
  }
  return {
    digitalPartnerId: seed.digitalPartnerId,
    digitalPartnerName: seed.digitalPartnerName,
    agentId: seed.agentId,
  };
}

function controlledTask(seed: TaskSeed): ControlledTask {
  if ('lifecycleStage' in seed) return cloneTask(seed);

  const task = cloneTask(seed);
  const employee = resolveEmployeeFields(task);
  const lifecycleStage = task.status === 'completed' ? 'completed'
    : task.status === 'review' ? 'human_action'
      : task.status === 'in_progress' ? 'running' : 'pending';
  const approvalPending = task.id === 't2' || task.dispatchKind === 'assist' || task.assistStatus === 'pending';
  const fromConversation = task.id === 't1' || task.id === 't7';
  const fromAlert = task.id === 't4';
  const fromDispatch = task.dispatchKind === 'assign' || task.dispatchKind === 'assist';
  return {
    ...task,
    ...employee,
    lifecycleStage,
    source: fromDispatch ? 'dispatch' : fromConversation ? 'conversation' : fromAlert ? 'alert' : 'manual',
    sla: {
      remainingMin: task.slaRemainingMin,
      risk: task.slaRemainingMin !== undefined && task.slaRemainingMin < 0 ? 'overdue' : 'none',
      escalated: false,
    },
    execution: {
      retryCount: 0,
      paused: false,
      currentStep: lifecycleStage === 'completed'
        ? (fromConversation ? '已回链会话' : '可归档')
        : lifecycleStage === 'human_action'
          ? (task.dispatchKind === 'assist' ? '待跨部门协办确认' : approvalPending ? '待双重审批' : '待专家确认')
          : lifecycleStage === 'running'
            ? '与数字伙伴协同执行中'
            : lifecycleStage === 'pending'
              ? (task.dispatchKind === 'assign' ? '本部门派工待执行' : '待开始')
              : undefined,
    },
    governance: {
      approvalRequired: approvalPending,
      approvalStatus: approvalPending ? 'pending' : 'not_required',
    },
    links: fromConversation
      ? { conversationId: task.id === 't1' ? 's1' : 's1', assetName: task.id === 't1' ? 'prod-redis-01' : undefined }
      : fromAlert
        ? { alertCode: 'ALT-REDIS-NOISE' }
        : {},
    comments: [],
    auditEvents: [],
    version: 1,
  };
}

function statusFor(stage: ControlledTask['lifecycleStage']): Task['status'] {
  if (stage === 'running' || stage === 'risk') return 'in_progress';
  if (stage === 'human_action') return 'review';
  if (stage === 'completed') return 'completed';
  if (stage === 'archived') return 'archived';
  return 'pending';
}

function stageFor(value: Task['status'] | ControlledTask['lifecycleStage']): ControlledTask['lifecycleStage'] {
  if (value === 'in_progress') return 'running';
  if (value === 'review') return 'human_action';
  return value as ControlledTask['lifecycleStage'];
}

/** In-memory controlled-task aggregate used by both task and conversation routes. */
export function createTaskDomain(seed: TaskSeed[] = mockTasks) {
  const initial = seed.map(controlledTask);
  let tasks = initial.map(cloneTask);

  const find = (id: string) => {
    const task = tasks.find((item) => item.id === id);
    if (!task) throw new Error('任务不存在');
    return task;
  };
  const write = (task: ControlledTask, action: string, meta: TaskActor = {}, tone: ControlledTask['auditEvents'][number]['tone'] = 'info') => {
    const at = new Date().toISOString();
    task.version += 1;
    task.updatedAt = at;
    task.auditEvents.push({ id: mockId('task_audit'), at, actor: meta.actor ?? '数字伙伴', action, detail: meta.reason, tone });
    return task;
  };

  return {
    list: () => tasks.map(cloneTask),
    get: (id: string) => {
      const task = tasks.find((item) => item.id === id);
      return task ? cloneTask(task) : undefined;
    },
    create: (input: Partial<ControlledTask> & Pick<Task, 'title'>, meta: TaskActor = {}) => {
      const now = new Date().toISOString();
      const employee = resolveEmployeeFields(input);
      const task = controlledTask({
        id: input.id ?? mockId('task'),
        code: input.code ?? `TSK-${now.slice(0, 10).replaceAll('-', '')}-${String(tasks.length + 1).padStart(3, '0')}`,
        title: input.title,
        description: input.description,
        priority: input.priority ?? 'P1',
        status: input.status ?? 'pending',
        assignee: input.assignee,
        digitalPartnerId: employee.digitalPartnerId,
        digitalPartnerName: employee.digitalPartnerName,
        agentId: employee.agentId,
        progress: input.progress ?? { done: 0, total: 1 },
        slaRemainingMin: input.slaRemainingMin,
        tags: input.tags ?? [],
        relatedTaskCode: input.relatedTaskCode,
        createdAt: now,
        updatedAt: now,
      });
      Object.assign(task, input, employee, {
        coordinatorId: input.coordinatorId,
        coordinatorName: input.coordinatorName,
        dispatchKind: input.dispatchKind,
        collaboratorIds: input.collaboratorIds,
        collaboratorNames: input.collaboratorNames,
        assistStatus: input.assistStatus ?? (input.dispatchKind === 'assist' ? 'pending' : input.dispatchKind === 'assign' ? 'not_required' : undefined),
        auditEvents: [],
        version: 0,
        createdAt: now,
        updatedAt: now,
      });
      if (input.dispatchKind === 'assist') {
        task.source = 'dispatch';
        task.governance.approvalRequired = true;
        task.governance.approvalStatus = 'pending';
        task.lifecycleStage = 'human_action';
        task.status = 'review';
        task.execution.currentStep = '待跨部门协办确认';
      } else if (input.dispatchKind === 'assign') {
        task.source = 'dispatch';
        task.execution.currentStep = '本部门派工待执行';
      }
      if (input.source) task.source = input.source;
      if (input.links) task.links = { ...task.links, ...input.links };
      if (input.execution?.currentStep) task.execution.currentStep = input.execution.currentStep;
      else if (input.source === 'conversation') task.execution.currentStep = '待专家确认';
      tasks.unshift(task);
      task.comments = [];
      return cloneTask(write(task, '创建任务', meta, 'success'));
    },
    transition: (id: string, target: Task['status'] | ControlledTask['lifecycleStage'], meta: TaskActor = {}) => {
      const task = find(id);
      const stage = stageFor(target);
      if (task.governance.approvalRequired && (stage === 'running' || stage === 'completed')) {
        if (task.governance.approvalStatus === 'rejected') throw new Error('任务审批已拒绝');
        if (task.governance.approvalStatus !== 'approved') throw new Error('任务等待人工审批');
      }
      if (task.lifecycleStage === 'risk' || task.sla.risk !== 'none') throw new Error('风险或失败任务仅允许重试或人工接管');
      task.lifecycleStage = stage;
      task.status = statusFor(stage);
      return cloneTask(write(task, '状态流转', meta, stage === 'completed' ? 'success' : 'info'));
    },
    approve: (id: string, input: TaskActor & { approved?: boolean } = {}) => {
      const task = find(id);
      task.governance.approvalStatus = input.approved === false ? 'rejected' : 'approved';
      if (task.dispatchKind === 'assist') {
        task.assistStatus = input.approved === false ? 'rejected' : 'accepted';
        if (input.approved !== false) {
          task.lifecycleStage = 'pending';
          task.status = 'pending';
          task.execution.currentStep = '协办已接受，待开始协同';
        }
      }
      return cloneTask(write(task, input.approved === false ? (task.dispatchKind === 'assist' ? '拒绝协办' : '审批拒绝') : (task.dispatchKind === 'assist' ? '接受协办' : '审批通过'), input, input.approved === false ? 'error' : 'success'));
    },
    takeover: (id: string, meta: TaskActor = {}) => {
      const task = find(id);
      task.governance.takeoverBy = meta.actor ?? '人工操作员';
      task.governance.takeoverReason = meta.reason;
      task.lifecycleStage = 'human_action';
      task.status = 'review';
      task.execution.paused = true;
      return cloneTask(write(task, '人工接管', meta, 'warn'));
    },
    retry: (id: string, meta: TaskActor = {}) => {
      const task = find(id);
      if (task.lifecycleStage !== 'risk' && task.sla.risk === 'none') throw new Error('仅失败或风险任务可以重试');
      task.execution.retryCount += 1;
      task.execution.error = undefined;
      task.execution.paused = false;
      task.lifecycleStage = 'running';
      task.status = 'in_progress';
      task.sla.risk = 'none';
      return cloneTask(write(task, '重试任务', meta, 'info'));
    },
    audit: (id: string) => cloneTask(find(id).auditEvents),
    comments: (id: string) => cloneTask(find(id).comments ?? []),
    comment: (id: string, body: string, meta: TaskActor = {}) => {
      const task = find(id);
      const entry = { id: mockId('cmt'), at: new Date().toISOString(), actor: meta.actor ?? '当前用户', body };
      task.comments = [...(task.comments ?? []), entry];
      write(task, '团队留言', { ...meta, reason: body }, 'info');
      return cloneTask(entry);
    },
    reset: () => {
      tasks = initial.map(cloneTask);
      return { ok: true };
    },
  };
}
// Agent 扩展数据：版本历史 + 7 天调用趋势 + Top 排行
export interface AgentVersion {
  version: string;
  date: string;
  changelog: string[];
  type: 'major' | 'minor' | 'patch';
}

export const mockAgentVersions: Record<string, AgentVersion[]> = {
  a1: [
    { version: '1.4.2', date: '2026-07-08', type: 'minor', changelog: ['+ 新增 Redis 7.x 兼容', '+ 优化 volatile-lru 策略切换', '- 修复内存计算偏差'] },
    { version: '1.4.1', date: '2026-06-20', type: 'patch', changelog: ['+ 支持 cluster bus', '- 修复大 Key 扫描卡顿'] },
    { version: '1.4.0', date: '2026-06-01', type: 'major', changelog: ['+ 全新 LangGraph 0.2 内核', '+ 支持多实例并行恢复', '+ 缓存命中率 +12%'] },
    { version: '1.3.5', date: '2026-05-15', type: 'minor', changelog: ['+ 双签流程整合'] },
    { version: '1.3.0', date: '2026-04-01', type: 'major', changelog: ['+ RAG 检索集成'] },
  ],
};

export const mockCallTrends: Record<string, number[]> = {
  a1: [120, 180, 220, 190, 240, 280, 310], // 7 天调用趋势
  a2: [80, 95, 110, 90, 120, 130, 140],
  a3: [40, 60, 80, 70, 90, 100, 110],
  a4: [1, 0, 2, 1, 0, 1, 1],
  a5: [380, 420, 410, 450, 480, 460, 500],
  a6: [780, 820, 810, 850, 880, 860, 900],
  a7: [0, 2, 1, 3, 1, 2, 3],
  a8: [5, 6, 7, 8, 6, 7, 7],
};

export const mockAgentRank = [
  { rank: 1, id: 'a6', name: '告警降噪', calls: 5900, change: 8.2 },
  { rank: 2, id: 'a1', name: '故障自愈', calls: 1540, change: 12.5 },
  { rank: 3, id: 'a5', name: '威胁狩猎', calls: 3100, change: 4.1 },
  { rank: 4, id: 'a2', name: 'K8s 操作', calls: 765, change: 15.3 },
  { rank: 5, id: 'a3', name: '变更辅助', calls: 550, change: 22.1 },
  { rank: 6, id: 'a7', name: '漏洞修复', calls: 12, change: -5.0 },
  { rank: 7, id: 'a8', name: '合规审计', calls: 46, change: 0 },
  { rank: 8, id: 'a4', name: '容量预测', calls: 6, change: 0 },
];

/** @deprecated LEGACY 执行内核目录；产品主路径为 /api/partners + /partners。新功能勿依赖。 */
export const mockAgents: Agent[] = [
  { id: 'a1', name: 'Redis 故障自愈', category: 'AIOps', description: 'redis-cli · MONITOR · CONFIG 自动恢复', version: '1.4.2', status: 'installed', rating: 4.8, installCount: 1240, cacheHitRate: 0.32, p95Ms: 580, tools: ['redis-cli', 'MONITOR'], isStarred: true },
  { id: 'a2', name: 'K8s 操作助手', category: 'AIOps', description: 'kubectl apply / scale / rollout', version: '2.1.0', status: 'installed', rating: 4.7, installCount: 980, cacheHitRate: 0.28, p95Ms: 720, tools: ['kubectl'] },
  { id: 'a3', name: '变更辅助', category: 'AIOps', description: '灰度发布 + 风险评估 + 回滚', version: '1.2.5', status: 'installed', rating: 4.6, installCount: 760, cacheHitRate: 0.22, p95Ms: 1100, tools: ['kubectl', 'argo'] },
  { id: 'a4', name: '容量预测', category: 'AIOps', description: '历史数据 + 趋势分析 + 建议', version: '1.0.8', status: 'installed', rating: 4.5, installCount: 540, cacheHitRate: 0.18, p95Ms: 2300, tools: ['prometheus'] },
  { id: 'a5', name: '威胁狩猎', category: 'SecOps', description: 'ATT&CK 框架 + EDR + SIEM', version: '1.6.0', status: 'installed', rating: 4.9, installCount: 460, p95Ms: 880, tools: ['siem', 'edr'] },
  { id: 'a6', name: '告警降噪', category: 'SecOps', description: '误报识别 + 规则合并', version: '1.3.2', status: 'installed', rating: 4.7, installCount: 380, p95Ms: 420, tools: ['siem'] },
  { id: 'a7', name: '漏洞修复', category: 'SecOps', description: 'CVE → 资产 → 工单', version: '2.0.1', status: 'installed', rating: 4.8, installCount: 320, p95Ms: 1500, tools: ['cmdb', 'jira'] },
  { id: 'a8', name: '合规审计', category: 'SecOps', description: '等保 3 / SOX 自动核查', version: '1.1.0', status: 'installed', rating: 4.6, installCount: 210, p95Ms: 3200, tools: ['audit'] },
  { id: 'a9', name: 'PromQL 生成', category: 'AIOps', description: '自然语言转 PromQL', version: '1.0.0', status: 'available', rating: 4.4, installCount: 120, tools: ['prometheus'] },
  { id: 'a10', name: '日志查询', category: 'AIOps', description: 'Loki · ES · S3 统一查询', version: '2.3.0', status: 'available', rating: 4.7, installCount: 880, tools: ['loki', 'opensearch'] },
];

// 企业纳管字段：负责人、工作区和生命周期状态
mockAgents.forEach((agent, index) => Object.assign(agent, {
  owner: ['王昊', '李婷', '张睿'][index % 3],
  workspace: index % 2 === 0 ? '生产运维' : '安全运营',
  // 演示盘执行内核统一挂在主工作区，避免岗位在 w1 却看不到内核
  workspaceId: 'w1',
  ownerId: index % 3 === 2 ? 'u3' : 'u1',
  environment: 'production',
  classification: agent.id === 'a5' || agent.id === 'a7' || agent.id === 'a8' ? 'restricted' : 'internal',
  createdBy: 'u1',
  updatedAt: '2026-07-19T12:00:00.000Z',
  configStatus: agent.status === 'installed' ? 'configured' : 'pending',
  evaluationStatus: agent.status === 'installed' ? 'passed' : 'pending',
  publishStatus: agent.status === 'installed' ? 'published' : 'unpublished',
  hasUpdate: index === 1 || index === 5,
  lastRunAt: agent.status === 'installed' ? `${index + 2} 分钟前` : '—',
}));

// LEGACY P5：执行内核评测/实时调用/告警 Mock（仅 /api/agents*）
export const mockAgentEvaluations = [
  { id: 'e01', name: '故障自愈-2026-W28-A', agentId: 'a1', agentName: 'Redis 故障自愈', version: '1.4.2', totalCases: 2400, accuracy: 92.4, recall: 90.1, p95Ms: 580, tokensPerCall: 820, rating: 4.7, calls: 12453, status: 'champion', passedAt: '2026-07-14T03:20:00Z', dataset: 'incident-v3', judgeModel: 'gpt-4o' },
  { id: 'e02', name: '变更辅助-2026-W27', agentId: 'a3', agentName: '变更辅助', version: '1.2.5', totalCases: 1200, accuracy: 94.1, recall: 92.0, p95Ms: 520, tokensPerCall: 640, rating: 4.6, calls: 8210, status: 'champion', passedAt: '2026-07-08T09:00:00Z', dataset: 'changeqa-v2', judgeModel: 'claude-sonnet' },
  { id: 'e03', name: '威胁狩猎-2026-W27', agentId: 'a5', agentName: '威胁狩猎', version: '1.6.0', totalCases: 800, accuracy: 87.3, recall: 91.2, p95Ms: 720, tokensPerCall: 980, rating: 4.4, calls: 5430, status: 'baseline', passedAt: '2026-07-07T08:30:00Z', dataset: 'threatbench-v1', judgeModel: 'gpt-4o' },
];

export const mockAgentLiveCalls = [
  { id: 'lc01', agentId: 'a1', agent: 'Redis 故障自愈', ts: '14:55', latencyMs: 620, tokens: 880, status: 'ok', channel: 'api' },
  { id: 'lc02', agentId: 'a3', agent: '变更辅助', ts: '14:54', latencyMs: 510, tokens: 640, status: 'ok', channel: 'cli' },
  { id: 'lc03', agentId: 'a5', agent: '威胁狩猎', ts: '14:53', latencyMs: 880, tokens: 1020, status: 'ok', channel: 'mcp' },
  { id: 'lc04', agentId: 'a1', agent: 'Redis 故障自愈', ts: '14:49', latencyMs: 1500, tokens: 880, status: 'timeout', channel: 'api' },
];

export const mockAgentAlerts = [
  { id: 'al1', agent: 'Redis 故障自愈', agentId: 'a1', severity: 'warn', type: 'latency', title: 'P95 超阈值（800ms > 600ms）', ts: '14:32', acknowledged: false },
  { id: 'al2', agent: '容量预测', agentId: 'a4', severity: 'warn', type: 'token', title: 'Token 用量超预算 80%', ts: '13:18', acknowledged: false },
  { id: 'al3', agent: '威胁狩猎', agentId: 'a5', severity: 'error', type: 'approval', title: '高风险操作待双签', ts: '11:05', acknowledged: false },
];

const mockAgentRuntime = {
  evaluations: [...mockAgentEvaluations] as any[],
  liveCalls: [...mockAgentLiveCalls] as any[],
  alerts: [...mockAgentAlerts] as any[],
};

// LEGACY：执行内核导入 / 审核 / 审计（仅兼容 /api/agents/imports；产品主路径不使用）
const mockAgentImports: any[] = [];

// ============ 数字伙伴：岗位身份与受控运行控制面 ============
const mockDigitalPartners: DigitalPartner[] = [
  { id: 'de-sre', workspaceId: 'w1', name: '夜航', role: 'SRE 故障处置专员', department: '信息技术部', description: '关联告警、日志和资产上下文定位生产故障；在受控工作流内执行恢复操作，超出边界立即转人工。', owner: '陈晓', escalationOwner: '王昊', serviceObject: '生产业务系统', version: '1.3.0', environment: 'production', lifecycle: 'active', risk: 'high', responsibilities: ['告警关联与影响分析', '故障定位建议', '执行已批准的恢复流程'], prohibitedActions: ['不得绕过生产变更审批', '不得执行未批准的写操作', '不得关闭重大事件证据'], capabilities: { agentId: 'a1', model: '企业通用路由 v2', knowledge: ['运行手册库', '故障知识库'], skills: ['日志检索', '告警分析'], tools: ['Prometheus', 'Loki', 'CMDB'], workflows: ['生产故障处置流'], channels: ['企业微信', '事件中心'] }, memoryPolicy: { shortTermHours: 24, workingDays: 7, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 286, successRate: 0.982, p95Ms: 840, costToday: 46.8, handoffs24h: 12, anomalies: 0 }, evaluation: { status: 'passed', score: 94.2, lastRunAt: '2026-07-22T02:30:00Z' }, release: { status: 'released', releasedAt: '2026-07-20T08:00:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T08:00:00Z' },
  { id: 'de-it', workspaceId: 'w1', name: '青禾', role: 'IT 服务台专员', department: '信息技术部', description: '受理常见 IT 服务请求，执行低风险标准操作并对高风险请求发起人工交接。', owner: '李婷', escalationOwner: '王昊', serviceObject: '内部员工', version: '2.1.0', environment: 'production', lifecycle: 'active', risk: 'medium', responsibilities: ['工单分诊', '知识问答', '受控执行标准操作'], prohibitedActions: ['不得重置高权限账号', '不得绕过变更审批', '不得导出终端数据'], capabilities: { agentId: 'a2', model: '企业通用路由 v2', knowledge: ['IT 服务知识库'], skills: ['工单分诊', '资产查询'], tools: ['CMDB', 'Jira'], workflows: ['IT 服务请求流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 12, workingDays: 14, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 462, successRate: 0.976, p95Ms: 680, costToday: 61.4, handoffs24h: 21, anomalies: 1 }, evaluation: { status: 'passed', score: 92.8, lastRunAt: '2026-07-21T09:20:00Z' }, release: { status: 'released', releasedAt: '2026-07-18T09:30:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T07:40:00Z' },
  { id: 'de-secops', workspaceId: 'w1', name: '听潮', role: '安全事件分析专员', department: '信息技术部', description: '关联 SIEM、EDR 与资产信息研判安全告警，形成处置建议并对高风险事件升级至安全响应人员。', owner: '张睿', escalationOwner: '安全负责人', serviceObject: '企业安全运营中心', version: '0.9.0', environment: 'staging', lifecycle: 'pending_approval', risk: 'high', responsibilities: ['安全告警去重与研判', '事件证据汇集', '响应建议与升级'], prohibitedActions: ['不得自动隔离核心生产资产', '不得删除安全证据', '不得绕过双人复核'], capabilities: { agentId: 'a5', model: '受限数据路由 v1', knowledge: ['安全运行手册', '威胁情报库'], skills: ['告警研判', '威胁狩猎'], tools: ['SIEM', 'EDR', 'CMDB'], workflows: ['安全事件响应流'], channels: ['事件中心'] }, memoryPolicy: { shortTermHours: 8, workingDays: 7, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 38, successRate: 0.947, p95Ms: 1120, costToday: 12.6, handoffs24h: 8, anomalies: 0 }, evaluation: { status: 'passed', score: 91.4, lastRunAt: '2026-07-22T03:10:00Z' }, release: { status: 'pending_approval' }, updatedAt: '2026-07-22T09:10:00Z' },
  { id: 'de-change', workspaceId: 'w1', name: '磐石', role: '变更协同专员', department: '信息技术部', description: '在发布前汇集变更上下文、验证风险与依赖，协同审批、灰度和回滚；不替代变更负责人决策。', owner: '周慧', escalationOwner: '变更经理', serviceObject: '应用与运维团队', version: '0.1.0', environment: 'sandbox', lifecycle: 'draft', risk: 'medium', responsibilities: ['变更单完整性检查', '风险与依赖分析', '灰度发布协同'], prohibitedActions: ['不得自行批准生产变更', '不得绕过回滚门禁', '不得修改变更记录'], capabilities: { agentId: 'a3', model: '企业通用路由 v2', knowledge: ['变更规范库', '运行手册库'], skills: ['变更风险评估'], tools: ['Jira', 'CMDB'], workflows: ['生产变更协同流'], channels: ['企业微信', '事件中心'] }, memoryPolicy: { shortTermHours: 24, workingDays: 7, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 0, successRate: 0, p95Ms: 0, costToday: 0, handoffs24h: 0, anomalies: 0 }, evaluation: { status: 'not_started' }, release: { status: 'not_released' }, updatedAt: '2026-07-22T10:00:00Z' },
  { id: 'de-alert-ops', workspaceId: 'w1', name: '观星', role: '告警运营专员', department: '信息技术部', description: '持续归并重复告警、识别影响范围并按值班规则分派；为重大事件提供静默建议，不直接关闭关键告警。', owner: '陈晓', escalationOwner: '值班经理', serviceObject: '生产监控与值班团队', version: '1.1.0', environment: 'production', lifecycle: 'active', risk: 'medium', responsibilities: ['告警去重与聚合', '影响范围初判', '值班分派与升级建议'], prohibitedActions: ['不得关闭重大告警', '不得修改监控阈值', '不得绕过事件升级规则'], capabilities: { agentId: 'a6', model: '企业通用路由 v2', knowledge: ['运行手册库', '告警规则库'], skills: ['告警分析', '事件分派'], tools: ['Prometheus', '事件中心', 'CMDB'], workflows: ['告警响应协同流'], channels: ['企业微信', '事件中心'] }, memoryPolicy: { shortTermHours: 24, workingDays: 7, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 684, successRate: 0.989, p95Ms: 520, costToday: 38.2, handoffs24h: 16, anomalies: 0 }, evaluation: { status: 'passed', score: 95.1, lastRunAt: '2026-07-22T04:00:00Z' }, release: { status: 'released', releasedAt: '2026-07-19T09:00:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T09:30:00Z' },
  { id: 'de-capacity', workspaceId: 'w1', name: '衡山', role: '容量与性能专员', department: '信息技术部', description: '结合指标、变更与业务周期识别容量趋势和性能瓶颈，形成扩缩容建议并交由负责人决策执行。', owner: '周慧', escalationOwner: '平台运维负责人', serviceObject: '生产计算与存储资源', version: '1.0.2', environment: 'production', lifecycle: 'active', risk: 'medium', responsibilities: ['容量趋势预测', '性能瓶颈分析', '扩缩容建议与复盘'], prohibitedActions: ['不得直接调整生产资源配额', '不得跳过成本审批', '不得修改性能基线证据'], capabilities: { agentId: 'a4', model: '企业通用路由 v2', knowledge: ['容量规划规范', '性能基线库'], skills: ['指标分析', '容量评估'], tools: ['Prometheus', 'Grafana', 'CMDB'], workflows: ['容量评估协同流'], channels: ['Web', '企业微信'] }, memoryPolicy: { shortTermHours: 24, workingDays: 30, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 124, successRate: 0.971, p95Ms: 760, costToday: 21.8, handoffs24h: 5, anomalies: 0 }, evaluation: { status: 'passed', score: 93.6, lastRunAt: '2026-07-22T05:10:00Z' }, release: { status: 'released', releasedAt: '2026-07-17T08:30:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T08:45:00Z' },
  { id: 'de-release-guard', workspaceId: 'w1', name: '守望', role: '发布保障专员', department: '信息技术部', description: '在既定变更窗口内跟踪灰度指标和依赖状态，提示放量或回滚条件，不替代变更负责人审批。', owner: '周慧', escalationOwner: '变更经理', serviceObject: '应用发布与变更团队', version: '0.8.0', environment: 'staging', lifecycle: 'testing', risk: 'high', responsibilities: ['灰度指标观察', '发布风险提示', '回滚协同与记录'], prohibitedActions: ['不得自行批准生产发布', '不得触发未批准的回滚', '不得覆盖发布审计记录'], capabilities: { agentId: 'a3', model: '企业通用路由 v2', knowledge: ['变更规范库', '发布运行手册'], skills: ['发布风险评估', '指标分析'], tools: ['Jira', 'Grafana', '事件中心'], workflows: ['生产发布保障流'], channels: ['企业微信', '事件中心'] }, memoryPolicy: { shortTermHours: 12, workingDays: 14, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 26, successRate: 0.923, p95Ms: 960, costToday: 9.4, handoffs24h: 6, anomalies: 1 }, evaluation: { status: 'passed', score: 90.2, lastRunAt: '2026-07-22T06:20:00Z' }, release: { status: 'not_released' }, updatedAt: '2026-07-22T10:20:00Z' },
  { id: 'de-vulnerability', workspaceId: 'w1', name: '破晓', role: '漏洞响应专员', department: '信息技术部', description: '匹配漏洞情报与资产清单，评估暴露和业务影响，生成修复优先级与任务建议并跟踪处置证据。', owner: '张睿', escalationOwner: '安全负责人', serviceObject: '企业资产与漏洞管理', version: '1.2.0', environment: 'production', lifecycle: 'active', risk: 'high', responsibilities: ['漏洞影响与暴露分析', '修复优先级建议', '处置任务与证据跟踪'], prohibitedActions: ['不得自动修复生产资产', '不得忽略高危漏洞', '不得删除漏洞处置证据'], capabilities: { agentId: 'a7', model: '受限数据路由 v1', knowledge: ['漏洞处置规范', '资产风险基线'], skills: ['漏洞研判', '资产匹配'], tools: ['漏洞管理平台', 'CMDB', 'Jira'], workflows: ['漏洞响应协同流'], channels: ['事件中心', '企业微信'] }, memoryPolicy: { shortTermHours: 12, workingDays: 30, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 186, successRate: 0.964, p95Ms: 890, costToday: 29.6, handoffs24h: 9, anomalies: 0 }, evaluation: { status: 'passed', score: 92.9, lastRunAt: '2026-07-22T02:50:00Z' }, release: { status: 'released', releasedAt: '2026-07-16T11:00:00Z', approver: '安全管理员' }, updatedAt: '2026-07-22T09:05:00Z' },
  { id: 'de-threat-hunt', workspaceId: 'w1', name: '追影', role: '威胁狩猎专员', department: '信息技术部', description: '依据威胁情报和攻击链假设检索异常行为，沉淀调查线索与处置建议，高风险结论必须由分析师复核。', owner: '张睿', escalationOwner: '安全响应负责人', serviceObject: '企业安全运营中心', version: '0.7.0', environment: 'staging', lifecycle: 'pending_approval', risk: 'high', responsibilities: ['威胁情报关联', '异常行为检索', '调查线索与处置建议'], prohibitedActions: ['不得自动隔离资产', '不得访问无授权业务数据', '不得对外发送安全事件结论'], capabilities: { agentId: 'a5', model: '受限数据路由 v1', knowledge: ['威胁情报库', '安全运行手册'], skills: ['威胁狩猎', '日志检索'], tools: ['SIEM', 'EDR', 'Loki'], workflows: ['威胁调查协同流'], channels: ['事件中心'] }, memoryPolicy: { shortTermHours: 8, workingDays: 14, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 42, successRate: 0.938, p95Ms: 1240, costToday: 18.7, handoffs24h: 11, anomalies: 0 }, evaluation: { status: 'passed', score: 90.8, lastRunAt: '2026-07-22T03:40:00Z' }, release: { status: 'pending_approval' }, updatedAt: '2026-07-22T10:35:00Z' },
  { id: 'de-compliance', workspaceId: 'w1', name: '明鉴', role: '安全合规核查专员', department: '信息技术部', description: '周期性核查资产安全基线和控制项证据，汇总整改差距并持续跟踪；不替代审计人员作出合规结论。', owner: '林雅', escalationOwner: '安全合规负责人', serviceObject: '安全控制项与合规证据', version: '0.5.0', environment: 'staging', lifecycle: 'pending_approval', risk: 'medium', responsibilities: ['安全基线检查', '合规证据汇总', '整改进度跟踪'], prohibitedActions: ['不得修改合规证据原件', '不得关闭未验证整改项', '不得替代审计签署结论'], capabilities: { agentId: 'a8', model: '受限数据路由 v1', knowledge: ['安全基线规范', '合规控制库'], skills: ['基线核查', '证据汇总'], tools: ['CMDB', 'SIEM', 'Jira'], workflows: ['安全合规核查流'], channels: ['Web', '企业微信'] }, memoryPolicy: { shortTermHours: 12, workingDays: 30, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 67, successRate: 0.956, p95Ms: 710, costToday: 13.2, handoffs24h: 4, anomalies: 0 }, evaluation: { status: 'passed', score: 91.7, lastRunAt: '2026-07-22T04:30:00Z' }, release: { status: 'pending_approval' }, updatedAt: '2026-07-22T09:50:00Z' },
  { id: 'de-it-head', workspaceId: 'w1', name: '北辰', role: '信息技术部负责人', department: '信息技术部', description: '汇总运维、安全与 IT 服务水位，形成值班、风险与资源优先级建议，协助部门负责人统筹跨岗位协同与升级处置；不替代生产变更、安全签署与采购决策。', owner: '王昊', escalationOwner: '技术平台主管', serviceObject: '信息技术部运行、安全与员工服务', version: '1.0.0', environment: 'production', lifecycle: 'active', risk: 'medium', responsibilities: ['部门态势汇总', '跨岗位任务协调', '风险升级与经营简报'], prohibitedActions: ['不得批准生产变更', '不得关闭安全事件或批准安全例外', '不得替代负责人作出人员、预算或采购决策'], capabilities: { agentId: 'a2', model: '企业通用路由 v2', knowledge: ['运行手册库', '安全运行手册', 'IT 服务知识库'], skills: ['态势汇总', '风险评估'], tools: ['Prometheus', 'SIEM', 'Jira', 'CMDB'], workflows: ['信息技术部态势协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 24, workingDays: 30, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 112, successRate: 0.981, p95Ms: 590, costToday: 18.4, handoffs24h: 4, anomalies: 0 }, evaluation: { status: 'passed', score: 94.1, lastRunAt: '2026-07-22T06:00:00Z' }, release: { status: 'released', releasedAt: '2026-07-14T09:30:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T10:50:00Z' },
  { id: 'de-endpoint-support', workspaceId: 'w1', name: '知秋', role: '终端支持专员', department: '信息技术部', description: '关联设备资产、终端健康与工单上下文，诊断常见终端问题并执行获批的低风险修复操作。', owner: '李婷', escalationOwner: '终端服务负责人', serviceObject: '员工终端与办公设备', version: '1.1.0', environment: 'production', lifecycle: 'active', risk: 'medium', responsibilities: ['终端健康巡检', '故障诊断与分派', '低风险修复建议'], prohibitedActions: ['不得擦除终端数据', '不得变更高权限设备策略', '不得绕过终端安全基线'], capabilities: { agentId: 'a2', model: '企业通用路由 v2', knowledge: ['终端管理规范', 'IT 服务知识库'], skills: ['终端诊断', '工单分诊'], tools: ['终端管理平台', 'CMDB', 'Jira'], workflows: ['终端支持服务流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 12, workingDays: 14, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 318, successRate: 0.972, p95Ms: 710, costToday: 35.6, handoffs24h: 14, anomalies: 0 }, evaluation: { status: 'passed', score: 92.5, lastRunAt: '2026-07-22T04:45:00Z' }, release: { status: 'released', releasedAt: '2026-07-17T10:30:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T10:55:00Z' },
  { id: 'de-identity-access', workspaceId: 'w1', name: '钥灵', role: '身份与访问专员', department: '信息技术部', description: '校验访问申请的身份、岗位与策略上下文，生成低风险授权建议并将敏感权限交由授权人复核。', owner: '李婷', escalationOwner: '身份与访问负责人', serviceObject: '员工身份与应用访问', version: '0.9.0', environment: 'staging', lifecycle: 'pending_approval', risk: 'high', responsibilities: ['访问申请完整性核验', '权限策略匹配', '敏感访问升级与证据留存'], prohibitedActions: ['不得授予高权限账号', '不得绕过双人复核', '不得导出身份目录数据'], capabilities: { agentId: 'a2', model: '受限数据路由 v1', knowledge: ['身份访问规范', '权限矩阵库'], skills: ['访问核验', '权限分析'], tools: ['IAM', 'CMDB', 'Jira'], workflows: ['访问申请协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 8, workingDays: 14, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 88, successRate: 0.952, p95Ms: 940, costToday: 17.3, handoffs24h: 12, anomalies: 0 }, evaluation: { status: 'passed', score: 91.9, lastRunAt: '2026-07-22T03:55:00Z' }, release: { status: 'pending_approval' }, updatedAt: '2026-07-22T11:00:00Z' },
  { id: 'de-workplace', workspaceId: 'w1', name: '云桥', role: '协作平台运营专员', department: '信息技术部', description: '受理企业协作平台的配置与使用请求，分析服务健康和使用问题；涉及组织级配置时转交管理员审批。', owner: '李婷', escalationOwner: '协作平台负责人', serviceObject: '企业协作与办公平台', version: '0.6.0', environment: 'staging', lifecycle: 'testing', risk: 'medium', responsibilities: ['协作服务请求分诊', '平台健康观察', '组织级配置升级建议'], prohibitedActions: ['不得修改组织级安全策略', '不得导出协作内容', '不得跳过管理员审批'], capabilities: { agentId: 'a2', model: '企业通用路由 v2', knowledge: ['协作平台操作手册', 'IT 服务知识库'], skills: ['服务分诊', '配置核验'], tools: ['服务台', 'Jira', 'CMDB'], workflows: ['协作平台服务流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 12, workingDays: 14, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 51, successRate: 0.941, p95Ms: 820, costToday: 11.6, handoffs24h: 7, anomalies: 0 }, evaluation: { status: 'passed', score: 90.6, lastRunAt: '2026-07-22T05:20:00Z' }, release: { status: 'not_released' }, updatedAt: '2026-07-22T11:05:00Z' },
  // —— 中小企业业务部门：市场 / 运营 / 人事 / 财务 / 研发 / 销售 ——
  { id: 'de-rd-manager', workspaceId: 'w1', name: '铸锋', role: '研发部负责人', department: '研发部', description: '汇总需求、缺陷与版本节奏，协助研发负责人识别交付风险与跨团队依赖，不替代技术决策与排期拍板。', owner: '赵研', escalationOwner: '技术负责人', serviceObject: '产品研发与交付节奏', version: '1.0.0', environment: 'production', lifecycle: 'active', risk: 'medium', responsibilities: ['交付态势汇总', '跨团队依赖协调', '风险升级与周报'], prohibitedActions: ['不得擅自变更发布窗口', '不得绕过代码评审门禁', '不得替代负责人作出排期决策'], capabilities: { agentId: 'a3', model: '企业通用路由 v2', knowledge: ['研发规范库', '缺陷知识库'], skills: ['交付分析', '风险评估'], tools: ['Jira', 'Git', 'CI'], workflows: ['研发交付协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 24, workingDays: 30, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 96, successRate: 0.974, p95Ms: 620, costToday: 16.2, handoffs24h: 5, anomalies: 0 }, evaluation: { status: 'passed', score: 93.4, lastRunAt: '2026-07-22T06:10:00Z' }, release: { status: 'released', releasedAt: '2026-07-14T08:00:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T11:10:00Z' },
  { id: 'de-qa-assistant', workspaceId: 'w1', name: '拾光', role: '质量保障专员', department: '研发部', description: '关联缺陷、用例与版本上下文做分诊与回归建议；高风险放行必须由测试负责人确认。', owner: '赵研', escalationOwner: '测试负责人', serviceObject: '产品质量与发布门禁', version: '1.0.0', environment: 'production', lifecycle: 'active', risk: 'medium', responsibilities: ['缺陷分诊与优先级建议', '回归范围建议', '发布门禁检查清单'], prohibitedActions: ['不得直接关闭阻塞缺陷', '不得绕过发布门禁', '不得修改测试结论原件'], capabilities: { agentId: 'a3', model: '企业通用路由 v2', knowledge: ['测试用例库', '缺陷知识库'], skills: ['缺陷分诊', '回归分析'], tools: ['Jira', 'TestRail', 'CI'], workflows: ['质量保障协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 24, workingDays: 14, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 142, successRate: 0.968, p95Ms: 580, costToday: 22.4, handoffs24h: 8, anomalies: 0 }, evaluation: { status: 'passed', score: 92.7, lastRunAt: '2026-07-22T05:30:00Z' }, release: { status: 'released', releasedAt: '2026-07-16T09:00:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T11:12:00Z' },
  { id: 'de-sales-manager', workspaceId: 'w1', name: '远航', role: '销售部负责人', department: '销售部', description: '汇总商机、跟进与回款风险，协助销售负责人调配资源；不替代商务签约与价格决策。', owner: '孙销', escalationOwner: '销售负责人', serviceObject: '销售漏斗与客户关系', version: '1.0.0', environment: 'production', lifecycle: 'active', risk: 'medium', responsibilities: ['商机态势汇总', '跟进节奏提醒', '风险升级与周报'], prohibitedActions: ['不得擅自承诺折扣', '不得对外发送未审合同', '不得替代负责人作出签约决策'], capabilities: { agentId: 'a2', model: '企业通用路由 v2', knowledge: ['销售话术库', '产品资料库'], skills: ['商机分析', '跟进提醒'], tools: ['CRM', '企业微信', '文档中心'], workflows: ['销售态势协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 24, workingDays: 30, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 118, successRate: 0.979, p95Ms: 540, costToday: 19.1, handoffs24h: 6, anomalies: 0 }, evaluation: { status: 'passed', score: 93.9, lastRunAt: '2026-07-22T06:20:00Z' }, release: { status: 'released', releasedAt: '2026-07-13T09:00:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T11:14:00Z' },
  { id: 'de-crm-assistant', workspaceId: 'w1', name: '暖橙', role: '客户跟进专员', department: '销售部', description: '根据 CRM 与沟通记录整理跟进要点、下次动作与风险提示；报价与合同须人工确认。', owner: '孙销', escalationOwner: '大客户经理', serviceObject: '在跟客户与商机', version: '1.1.0', environment: 'production', lifecycle: 'active', risk: 'low', responsibilities: ['跟进记录整理', '下次动作建议', '会议纪要草稿'], prohibitedActions: ['不得擅自发送报价', '不得修改成交金额', '不得对外泄露客户敏感信息'], capabilities: { agentId: 'a2', model: '企业通用路由 v2', knowledge: ['销售话术库', '客户档案库'], skills: ['跟进整理', '纪要生成'], tools: ['CRM', '企业微信', '日历'], workflows: ['客户跟进协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 12, workingDays: 14, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 256, successRate: 0.983, p95Ms: 490, costToday: 28.7, handoffs24h: 11, anomalies: 0 }, evaluation: { status: 'passed', score: 94.2, lastRunAt: '2026-07-22T04:50:00Z' }, release: { status: 'released', releasedAt: '2026-07-15T10:00:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T11:16:00Z' },
  { id: 'de-marketing-manager', workspaceId: 'w1', name: '星河', role: '市场部负责人', department: '市场部', description: '汇总活动、内容和线索质量，协助市场负责人识别投放与品牌风险；不替代预算与对外发布审批。', owner: '周市', escalationOwner: '市场负责人', serviceObject: '品牌与获客活动', version: '1.0.0', environment: 'production', lifecycle: 'active', risk: 'medium', responsibilities: ['活动态势汇总', '内容排期协同', '线索质量简报'], prohibitedActions: ['不得擅自对外发布物料', '不得绕过品牌审核', '不得替代负责人批准投放预算'], capabilities: { agentId: 'a2', model: '企业通用路由 v2', knowledge: ['品牌规范库', '活动案例库'], skills: ['活动分析', '内容排期'], tools: ['内容中心', '数据分析', '企业微信'], workflows: ['市场态势协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 24, workingDays: 30, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 84, successRate: 0.976, p95Ms: 610, costToday: 14.8, handoffs24h: 4, anomalies: 0 }, evaluation: { status: 'passed', score: 93.1, lastRunAt: '2026-07-22T06:30:00Z' }, release: { status: 'released', releasedAt: '2026-07-14T11:00:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T11:18:00Z' },
  { id: 'de-content-ops', workspaceId: 'w1', name: '墨白', role: '内容运营专员', department: '市场部', description: '根据选题与品牌规范生成内容草稿、发布清单与渠道适配建议；正式发布须完成品牌与合规审核。', owner: '周市', escalationOwner: '品牌负责人', serviceObject: '官网与社媒内容', version: '1.0.0', environment: 'production', lifecycle: 'active', risk: 'low', responsibilities: ['内容草稿生成', '发布清单整理', '渠道适配建议'], prohibitedActions: ['不得跳过品牌审核直接发布', '不得使用未授权素材', '不得对外承诺未上线能力'], capabilities: { agentId: 'a2', model: '企业通用路由 v2', knowledge: ['品牌规范库', '内容素材库'], skills: ['文案起草', '发布清单'], tools: ['内容中心', '素材库', '企业微信'], workflows: ['内容发布协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 12, workingDays: 14, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 198, successRate: 0.981, p95Ms: 520, costToday: 24.3, handoffs24h: 9, anomalies: 0 }, evaluation: { status: 'passed', score: 94.0, lastRunAt: '2026-07-22T05:00:00Z' }, release: { status: 'released', releasedAt: '2026-07-16T08:30:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T11:20:00Z' },
  { id: 'de-bizops-manager', workspaceId: 'w1', name: '行远', role: '运营部负责人', department: '运营部', description: '汇总转化、留存与流程瓶颈，协助运营负责人识别改进优先级；不替代经营决策与资源分配拍板。', owner: '吴运', escalationOwner: '运营负责人', serviceObject: '业务运营与用户增长', version: '1.0.0', environment: 'production', lifecycle: 'active', risk: 'medium', responsibilities: ['运营指标汇总', '流程瓶颈识别', '改进建议与周报'], prohibitedActions: ['不得擅自变更计费规则', '不得绕过活动审批', '不得替代负责人作出经营决策'], capabilities: { agentId: 'a2', model: '企业通用路由 v2', knowledge: ['运营指标库', '流程规范库'], skills: ['指标分析', '流程诊断'], tools: ['数据分析', 'CRM', 'Jira'], workflows: ['运营态势协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 24, workingDays: 30, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 102, successRate: 0.972, p95Ms: 640, costToday: 17.5, handoffs24h: 5, anomalies: 0 }, evaluation: { status: 'passed', score: 93.5, lastRunAt: '2026-07-22T06:40:00Z' }, release: { status: 'released', releasedAt: '2026-07-13T10:30:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T11:22:00Z' },
  { id: 'de-growth-ops', workspaceId: 'w1', name: '破浪', role: '增长运营专员', department: '运营部', description: '检查活动配置完整性、汇总转化漏斗异常并给出优化建议；上线与预算变更须运营负责人审批。', owner: '吴运', escalationOwner: '增长负责人', serviceObject: '获客活动与转化漏斗', version: '1.0.0', environment: 'production', lifecycle: 'active', risk: 'medium', responsibilities: ['活动配置完整性检查', '转化漏斗异常提示', '实验结论草稿'], prohibitedActions: ['不得擅自上线活动', '不得修改用户权益规则', '不得跳过预算审批'], capabilities: { agentId: 'a2', model: '企业通用路由 v2', knowledge: ['活动规范库', '转化分析手册'], skills: ['漏斗分析', '配置核验'], tools: ['数据分析', '活动后台', '企业微信'], workflows: ['增长运营协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 24, workingDays: 14, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 167, successRate: 0.969, p95Ms: 600, costToday: 21.9, handoffs24h: 7, anomalies: 0 }, evaluation: { status: 'passed', score: 92.8, lastRunAt: '2026-07-22T05:15:00Z' }, release: { status: 'released', releasedAt: '2026-07-17T09:30:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T11:24:00Z' },
  { id: 'de-hr-manager', workspaceId: 'w1', name: '春晖', role: '人事部负责人', department: '人事部', description: '汇总入转调离、考勤与招聘进度，提醒合规节点；不替代录用、处分与薪酬决策。', owner: '郑人', escalationOwner: '人事负责人', serviceObject: '组织人事与员工服务', version: '1.0.0', environment: 'production', lifecycle: 'active', risk: 'medium', responsibilities: ['人事态势汇总', '合规节点提醒', '招聘进度简报'], prohibitedActions: ['不得擅自发送录用通知', '不得修改薪酬数据', '不得替代负责人作出人事处分'], capabilities: { agentId: 'a2', model: '受限数据路由 v1', knowledge: ['人事制度库', '劳动法要点库'], skills: ['流程提醒', '态势汇总'], tools: ['HRIS', '企业微信', '文档中心'], workflows: ['人事态势协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 12, workingDays: 30, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 76, successRate: 0.977, p95Ms: 570, costToday: 13.9, handoffs24h: 4, anomalies: 0 }, evaluation: { status: 'passed', score: 94.3, lastRunAt: '2026-07-22T06:50:00Z' }, release: { status: 'released', releasedAt: '2026-07-12T09:00:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T11:26:00Z' },
  { id: 'de-hr-assistant', workspaceId: 'w1', name: '清欢', role: '人事服务专员', department: '人事部', description: '回答常见人事政策、生成入职指引与材料清单；涉及录用、薪酬与处分须转交人事负责人。', owner: '郑人', escalationOwner: '人事业务伙伴', serviceObject: '在职与入职员工', version: '1.1.0', environment: 'production', lifecycle: 'active', risk: 'low', responsibilities: ['政策问答', '入职材料清单', '流程进度查询'], prohibitedActions: ['不得承诺未审批的编制', '不得泄露员工隐私数据', '不得代签劳动合同'], capabilities: { agentId: 'a2', model: '受限数据路由 v1', knowledge: ['人事制度库', '入职手册'], skills: ['政策问答', '清单生成'], tools: ['HRIS', '企业微信', '知识库'], workflows: ['人事服务协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 8, workingDays: 14, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 214, successRate: 0.985, p95Ms: 460, costToday: 18.6, handoffs24h: 10, anomalies: 0 }, evaluation: { status: 'passed', score: 95.0, lastRunAt: '2026-07-22T04:20:00Z' }, release: { status: 'released', releasedAt: '2026-07-15T08:00:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T11:28:00Z' },
  { id: 'de-finance-manager', workspaceId: 'w1', name: '衡通', role: '财务部负责人', department: '财务部', description: '汇总报销、付款与合规异常，协助财务负责人识别风险；不替代审批签字与账务处理。', owner: '钱财', escalationOwner: '财务负责人', serviceObject: '费用控制与财务合规', version: '1.0.0', environment: 'production', lifecycle: 'active', risk: 'high', responsibilities: ['费用态势汇总', '异常单据提示', '合规节点提醒'], prohibitedActions: ['不得擅自批准付款', '不得修改账务凭证', '不得替代负责人完成审批签字'], capabilities: { agentId: 'a2', model: '受限数据路由 v1', knowledge: ['费用制度库', '税务合规要点'], skills: ['费用分析', '异常识别'], tools: ['费控', 'ERP', '企业微信'], workflows: ['财务态势协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 12, workingDays: 30, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 91, successRate: 0.971, p95Ms: 680, costToday: 15.4, handoffs24h: 6, anomalies: 0 }, evaluation: { status: 'passed', score: 93.7, lastRunAt: '2026-07-22T07:00:00Z' }, release: { status: 'released', releasedAt: '2026-07-12T10:00:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T11:30:00Z' },
  { id: 'de-expense-ops', workspaceId: 'w1', name: '精算', role: '费用核算专员', department: '财务部', description: '核验报销单完整性、发票与制度匹配度，生成补正建议；付款与入账须财务审批。', owner: '钱财', escalationOwner: '费用会计', serviceObject: '员工报销与对公付款申请', version: '1.0.0', environment: 'production', lifecycle: 'active', risk: 'medium', responsibilities: ['单据完整性核验', '制度匹配检查', '补正建议'], prohibitedActions: ['不得直接批准付款', '不得篡改票据信息', '不得跳过双重审批'], capabilities: { agentId: 'a2', model: '受限数据路由 v1', knowledge: ['费用制度库', '发票核验规范'], skills: ['单据核验', '补正建议'], tools: ['费控', '发票验真', '企业微信'], workflows: ['费用核算协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 12, workingDays: 14, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 289, successRate: 0.978, p95Ms: 550, costToday: 26.8, handoffs24h: 13, anomalies: 1 }, evaluation: { status: 'passed', score: 94.5, lastRunAt: '2026-07-22T04:10:00Z' }, release: { status: 'released', releasedAt: '2026-07-16T11:00:00Z', approver: '平台管理员' }, updatedAt: '2026-07-22T11:32:00Z' },
];

// Demo 种子 ID（de-sre 等）与 backend store（de-1 等）刻意分离；切 Mock↔真后端会换片，联调以 backend 为准。
mockDigitalPartners.forEach((employee) => {
  const mapped = EMPLOYEE_BY_ID[employee.id];
  if (mapped?.agentId) employee.capabilities.agentId = mapped.agentId;
  employee.capabilities = normalizeEmployeeCapabilities(employee.capabilities);
  if (!employee.boundaryPolicy) {
    employee.boundaryPolicy = {
      responsibilities: employee.responsibilities.map((title, index) => ({
        id: `${employee.id}-resp-${index}`,
        title,
        objective: '在岗位授权范围内形成可复核的业务结果。',
        trigger: '收到工作请求或命中服务事件',
        deliverables: ['处理结论与处置证据'],
        evidenceRequired: true,
      })),
      capabilityModes: [
        ...employee.capabilities.skills.map((capabilityName) => ({ capabilityType: 'skill' as const, capabilityName, mode: 'approval_required' as const })),
        ...employee.capabilities.tools.map((capabilityName) => ({ capabilityType: 'tool' as const, capabilityName, mode: 'approval_required' as const })),
      ],
      dataClassification: employee.risk === 'high' ? 'confidential' : 'internal',
      allowedEnvironments: employee.environment === 'production' ? ['staging', 'production'] : [employee.environment],
      handoff: {
        triggers: employee.prohibitedActions.slice(0, 2),
        approvers: [employee.escalationOwner || employee.owner],
        notificationChannels: employee.capabilities.channels.slice(0, 2),
        slaMinutes: employee.risk === 'high' ? 30 : 120,
      },
    };
  }
});

// 员工广场：岗位模板与工作区员工实例分离。模板可被采用，实例必须重新评测和上岗。
const mockDigitalPartnerTemplates: DigitalPartnerTemplate[] = [
  { id: 'det-sre', name: 'SRE 故障处置专员', role: '生产故障诊断与处置', department: '信息技术部', description: '关联告警、日志和资产上下文定位生产故障，在受控流程内执行已批准的恢复操作。', serviceObject: '生产业务系统', version: '1.3.0', risk: 'high', responsibilities: ['告警关联与影响分析', '故障定位建议', '执行已批准的恢复流程'], prohibitedActions: ['不得绕过生产变更审批', '不得执行未批准的写操作', '不得关闭重大事件证据'], capabilities: { agentId: 'a1', model: '企业通用路由 v2', knowledge: ['运行手册库', '故障知识库'], skills: ['日志检索', '告警分析'], tools: ['Prometheus', 'Loki', 'CMDB'], workflows: ['生产故障处置流'], channels: ['企业微信', '事件中心'] }, memoryPolicy: { shortTermHours: 24, workingDays: 7, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, source: 'platform', sourceName: '平台认证模板', status: 'certified', scope: 'organization', applicableEnvironments: ['staging', 'production'], evaluationScore: 94.2, adoptionCount: 12, tags: ['运维', '故障处置', '生产'], publishedAt: '2026-06-20T08:00:00Z', updatedAt: '2026-07-20T08:00:00Z' },
  { id: 'det-secops', name: '安全事件分析专员', role: '安全告警研判与响应', department: '信息技术部', description: '关联 SIEM、EDR 与资产信息研判安全告警，形成处置建议并将高风险事件升级至安全响应人员。', serviceObject: '企业安全运营中心', version: '1.0.0', risk: 'high', responsibilities: ['安全告警去重与研判', '事件证据汇集', '响应建议与升级'], prohibitedActions: ['不得自动隔离核心生产资产', '不得删除安全证据', '不得绕过双人复核'], capabilities: { agentId: 'a5', model: '受限数据路由 v1', knowledge: ['安全运行手册', '威胁情报库'], skills: ['告警研判', '威胁狩猎'], tools: ['SIEM', 'EDR', 'CMDB'], workflows: ['安全事件响应流'], channels: ['事件中心'] }, memoryPolicy: { shortTermHours: 8, workingDays: 7, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, source: 'platform', sourceName: '平台认证模板', status: 'certified', scope: 'organization', applicableEnvironments: ['staging', 'production'], evaluationScore: 93.6, adoptionCount: 8, tags: ['安全', '事件响应', '高风险'], publishedAt: '2026-06-28T08:00:00Z', updatedAt: '2026-07-18T08:00:00Z' },
  { id: 'det-service-desk', name: 'IT 服务台专员', role: '员工 IT 服务', department: '信息技术部', description: '受理常见 IT 服务请求，执行低风险标准操作，并将高风险请求交接至人工处理。', serviceObject: '内部员工', version: '2.1.0', risk: 'medium', responsibilities: ['工单分诊', '知识问答', '受控执行标准操作'], prohibitedActions: ['不得重置高权限账号', '不得绕过变更审批', '不得导出终端数据'], capabilities: { agentId: 'a2', model: '企业通用路由 v2', knowledge: ['IT 服务知识库'], skills: ['工单分诊', '资产查询'], tools: ['CMDB', 'Jira'], workflows: ['IT 服务请求流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 12, workingDays: 14, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, source: 'platform', sourceName: '平台认证模板', status: 'certified', scope: 'organization', applicableEnvironments: ['sandbox', 'staging', 'production'], evaluationScore: 92.8, adoptionCount: 18, tags: ['IT 服务', '服务台', '员工体验'], publishedAt: '2026-06-10T08:00:00Z', updatedAt: '2026-07-16T08:00:00Z' },
  { id: 'det-alert-ops', name: '告警运营专员', role: '告警聚合与值班分派', department: '信息技术部', description: '归并重复告警、识别影响范围并按值班规则分派，向重大事件提供静默与升级建议。', serviceObject: '生产监控与值班团队', version: '1.1.0', risk: 'medium', responsibilities: ['告警去重与聚合', '影响范围初判', '值班分派与升级建议'], prohibitedActions: ['不得关闭重大告警', '不得修改监控阈值', '不得绕过事件升级规则'], capabilities: { agentId: 'a6', model: '企业通用路由 v2', knowledge: ['运行手册库', '告警规则库'], skills: ['告警分析', '事件分派'], tools: ['Prometheus', '事件中心', 'CMDB'], workflows: ['告警响应协同流'], channels: ['企业微信', '事件中心'] }, memoryPolicy: { shortTermHours: 24, workingDays: 7, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, source: 'department', sourceName: '信息技术部共享模板', status: 'review', scope: 'workspace', workspaceId: 'w1', applicableEnvironments: ['sandbox', 'staging'], evaluationScore: 91.5, adoptionCount: 3, tags: ['运维', '告警', '值班'], publishedAt: '2026-07-02T08:00:00Z', updatedAt: '2026-07-21T08:00:00Z' },
  { id: 'det-crm-assistant', name: '客户跟进专员', role: '商机跟进与会议纪要整理', department: '销售部', description: '整理跟进要点与下次动作；报价与合同须人工确认。', serviceObject: '在跟客户与商机', version: '1.1.0', risk: 'low', responsibilities: ['跟进记录整理', '下次动作建议', '会议纪要草稿'], prohibitedActions: ['不得擅自发送报价', '不得修改成交金额', '不得对外泄露客户敏感信息'], capabilities: { agentId: 'a2', model: '企业通用路由 v2', knowledge: ['销售话术库', '客户档案库'], skills: ['跟进整理', '纪要生成'], tools: ['CRM', '企业微信', '日历'], workflows: ['客户跟进协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 12, workingDays: 14, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, source: 'platform', sourceName: '平台认证模板', status: 'certified', scope: 'organization', applicableEnvironments: ['sandbox', 'staging', 'production'], evaluationScore: 94.2, adoptionCount: 9, tags: ['销售', 'CRM', '跟进'], publishedAt: '2026-07-01T08:00:00Z', updatedAt: '2026-07-20T08:00:00Z' },
  { id: 'det-content-ops', name: '内容运营专员', role: '内容草稿与发布清单协同', department: '市场部', description: '按品牌规范生成内容草稿与发布清单；正式发布须审核。', serviceObject: '官网与社媒内容', version: '1.0.0', risk: 'low', responsibilities: ['内容草稿生成', '发布清单整理', '渠道适配建议'], prohibitedActions: ['不得跳过品牌审核直接发布', '不得使用未授权素材', '不得对外承诺未上线能力'], capabilities: { agentId: 'a2', model: '企业通用路由 v2', knowledge: ['品牌规范库', '内容素材库'], skills: ['文案起草', '发布清单'], tools: ['内容中心', '素材库', '企业微信'], workflows: ['内容发布协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 12, workingDays: 14, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, source: 'platform', sourceName: '平台认证模板', status: 'certified', scope: 'organization', applicableEnvironments: ['sandbox', 'staging', 'production'], evaluationScore: 94.0, adoptionCount: 7, tags: ['市场', '内容', '品牌'], publishedAt: '2026-07-03T08:00:00Z', updatedAt: '2026-07-19T08:00:00Z' },
  { id: 'det-hr-assistant', name: '人事服务专员', role: '入职指引与政策问答', department: '人事部', description: '回答常见人事政策并生成入职指引；录用与薪酬须负责人确认。', serviceObject: '在职与入职员工', version: '1.1.0', risk: 'low', responsibilities: ['政策问答', '入职材料清单', '流程进度查询'], prohibitedActions: ['不得承诺未审批的编制', '不得泄露员工隐私数据', '不得代签劳动合同'], capabilities: { agentId: 'a2', model: '受限数据路由 v1', knowledge: ['人事制度库', '入职手册'], skills: ['政策问答', '清单生成'], tools: ['HRIS', '企业微信', '知识库'], workflows: ['人事服务协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 8, workingDays: 14, longTermCadence: 'weekly', knowledgePromotion: 'approval_required' }, source: 'platform', sourceName: '平台认证模板', status: 'certified', scope: 'organization', applicableEnvironments: ['sandbox', 'staging', 'production'], evaluationScore: 95.0, adoptionCount: 11, tags: ['人事', '员工服务', '入职'], publishedAt: '2026-07-04T08:00:00Z', updatedAt: '2026-07-18T08:00:00Z' },
  { id: 'det-expense-ops', name: '费用核算专员', role: '报销核验与票据完整性检查', department: '财务部', description: '核验报销完整性与制度匹配；付款入账须财务审批。', serviceObject: '员工报销与对公付款申请', version: '1.0.0', risk: 'medium', responsibilities: ['单据完整性核验', '制度匹配检查', '补正建议'], prohibitedActions: ['不得直接批准付款', '不得篡改票据信息', '不得跳过双重审批'], capabilities: { agentId: 'a2', model: '受限数据路由 v1', knowledge: ['费用制度库', '发票核验规范'], skills: ['单据核验', '补正建议'], tools: ['费控', '发票验真', '企业微信'], workflows: ['费用核算协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 12, workingDays: 14, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, source: 'platform', sourceName: '平台认证模板', status: 'certified', scope: 'organization', applicableEnvironments: ['sandbox', 'staging', 'production'], evaluationScore: 94.5, adoptionCount: 10, tags: ['财务', '报销', '合规'], publishedAt: '2026-07-05T08:00:00Z', updatedAt: '2026-07-17T08:00:00Z' },
  { id: 'det-qa-assistant', name: '质量保障专员', role: '缺陷分诊与回归建议', department: '研发部', description: '缺陷分诊与回归建议；高风险放行须测试负责人确认。', serviceObject: '产品质量与发布门禁', version: '1.0.0', risk: 'medium', responsibilities: ['缺陷分诊与优先级建议', '回归范围建议', '发布门禁检查清单'], prohibitedActions: ['不得直接关闭阻塞缺陷', '不得绕过发布门禁', '不得修改测试结论原件'], capabilities: { agentId: 'a3', model: '企业通用路由 v2', knowledge: ['测试用例库', '缺陷知识库'], skills: ['缺陷分诊', '回归分析'], tools: ['Jira', 'TestRail', 'CI'], workflows: ['质量保障协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 24, workingDays: 14, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, source: 'platform', sourceName: '平台认证模板', status: 'certified', scope: 'organization', applicableEnvironments: ['sandbox', 'staging', 'production'], evaluationScore: 92.7, adoptionCount: 6, tags: ['研发', '质量', '发布'], publishedAt: '2026-07-06T08:00:00Z', updatedAt: '2026-07-16T08:00:00Z' },
  { id: 'det-growth-ops', name: '增长运营专员', role: '活动配置检查与转化分析', department: '运营部', description: '检查活动配置并汇总转化异常；上线与预算变更须审批。', serviceObject: '获客活动与转化漏斗', version: '1.0.0', risk: 'medium', responsibilities: ['活动配置完整性检查', '转化漏斗异常提示', '实验结论草稿'], prohibitedActions: ['不得擅自上线活动', '不得修改用户权益规则', '不得跳过预算审批'], capabilities: { agentId: 'a2', model: '企业通用路由 v2', knowledge: ['活动规范库', '转化分析手册'], skills: ['漏斗分析', '配置核验'], tools: ['数据分析', '活动后台', '企业微信'], workflows: ['增长运营协同流'], channels: ['企业微信', 'Web'] }, memoryPolicy: { shortTermHours: 24, workingDays: 14, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, source: 'platform', sourceName: '平台认证模板', status: 'certified', scope: 'organization', applicableEnvironments: ['sandbox', 'staging', 'production'], evaluationScore: 92.8, adoptionCount: 5, tags: ['运营', '增长', '活动'], publishedAt: '2026-07-07T08:00:00Z', updatedAt: '2026-07-15T08:00:00Z' },
];


mockDigitalPartnerTemplates.forEach((template) => {
  template.capabilities = normalizeEmployeeCapabilities(template.capabilities);
});

const mockDigitalPartnerTemplateAdoptions: DigitalPartnerTemplateAdoption[] = [
  { id: 'deta-1', templateId: 'det-sre', templateVersion: '1.3.0', employeeId: 'de-sre', workspaceId: 'w1', adoptedBy: '王昊', status: 'active', createdAt: '2026-07-20T08:00:00Z' },
  { id: 'deta-2', templateId: 'det-service-desk', templateVersion: '2.1.0', employeeId: 'de-it', workspaceId: 'w1', adoptedBy: '李婷', status: 'active', createdAt: '2026-07-18T09:30:00Z' },
];

type DigitalPartnerConfigurationInput = {
  /** capability 装配直接生效；role/缺省仍按在岗·生产·高风险走审批 */
  scope?: 'capability' | 'role';
  profile: Pick<DigitalPartner, 'name' | 'role' | 'department' | 'description' | 'owner' | 'escalationOwner' | 'serviceObject' | 'risk' | 'environment'>;
  boundary: Pick<DigitalPartner, 'responsibilities' | 'prohibitedActions' | 'handoffPolicy' | 'boundaryPolicy'>;
  capabilities?: DigitalPartner['capabilities'];
  memoryPolicy: DigitalPartner['memoryPolicy'];
};

const mockDigitalPartnerConfigurationVersions: DigitalPartnerConfigurationVersion[] = mockDigitalPartners.map((employee) => ({
  id: `decv-${employee.id}-1`, employeeId: employee.id, version: '配置 v1', status: 'current', changeSummary: '初始化岗位配置', changedFields: ['岗位档案', '职责边界', '能力装配', '记忆策略'], updatedBy: employee.owner, updatedAt: employee.updatedAt,
}));
const mockDigitalPartnerConfigurationDrafts = new Map<string, DigitalPartnerConfigurationInput>();

function applyDigitalPartnerConfiguration(employee: DigitalPartner, input: DigitalPartnerConfigurationInput) {
  const scope = input.scope ?? 'role';
  Object.assign(employee, input.profile, {
    responsibilities: [...input.boundary.responsibilities],
    prohibitedActions: [...input.boundary.prohibitedActions],
    handoffPolicy: input.boundary.handoffPolicy ? { triggers: [...input.boundary.handoffPolicy.triggers], approvalRequiredFor: [...input.boundary.handoffPolicy.approvalRequiredFor] } : undefined,
    boundaryPolicy: input.boundary.boundaryPolicy ? {
      ...input.boundary.boundaryPolicy,
      responsibilities: input.boundary.boundaryPolicy.responsibilities.map((item) => ({ ...item, deliverables: [...item.deliverables] })),
      capabilityModes: input.boundary.boundaryPolicy.capabilityModes.map((item) => ({ ...item })),
      allowedEnvironments: [...input.boundary.boundaryPolicy.allowedEnvironments],
      handoff: {
        ...input.boundary.boundaryPolicy.handoff,
        triggers: [...input.boundary.boundaryPolicy.handoff.triggers],
        approvers: [...input.boundary.boundaryPolicy.handoff.approvers],
        notificationChannels: [...input.boundary.boundaryPolicy.handoff.notificationChannels],
      },
    } : undefined,
    ...(scope === 'capability' && input.capabilities ? {
      capabilities: { ...input.capabilities, knowledge: [...input.capabilities.knowledge], skills: [...input.capabilities.skills], tools: [...input.capabilities.tools], workflows: [...input.capabilities.workflows], channels: [...input.capabilities.channels] },
    } : {}),
    memoryPolicy: { ...input.memoryPolicy }, updatedAt: new Date().toISOString(),
  });
}

function digitalPartnerEvidence(employee: DigitalPartner) {
  const events = [
    { id: `${employee.id}-e1`, time: employee.updatedAt, actor: employee.owner, action: '更新员工配置', target: `${employee.role} · ${employee.name} · v${employee.version}`, result: 'success' },
    { id: `${employee.id}-e2`, time: employee.evaluation.lastRunAt ?? employee.updatedAt, actor: '评测服务', action: '执行质量评测', target: `评分 ${employee.evaluation.score ?? '待执行'}`, result: employee.evaluation.status === 'failed' ? 'failed' : 'success' },
    { id: `${employee.id}-e3`, time: employee.release.releasedAt ?? employee.updatedAt, actor: employee.release.approver ?? employee.owner, action: employee.release.status === 'released' ? '批准上岗' : '更新上岗状态', target: employee.environment, result: employee.release.status === 'released' ? 'success' : 'pending' },
  ];
  if (employee.opsControl?.at) {
    const actionLabel = employee.opsControl.lastAction === 'paused' ? '暂停运行' : employee.opsControl.lastAction === 'quarantined' ? '隔离运行' : '恢复运行';
    events.unshift({
      id: `${employee.id}-ops`,
      time: employee.opsControl.at,
      actor: employee.opsControl.actor ?? employee.owner,
      action: actionLabel,
      target: employee.opsControl.reason ? `${employee.role} · ${employee.name} · ${employee.opsControl.reason}` : `${employee.role} · ${employee.name}`,
      result: 'success',
    });
  }
  return events;
}

// ============ P6 工作流扩展数据 ============

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  department?: string;
  library?: 'default' | 'advanced';
  parentId?: string;
  nodes: number;
  installs: number;
  rating: number;
  version?: string;
  owner?: string;
  ownerId?: string;
  workspaceId?: string;
  verifiedAt?: string;
  risk?: 'L1' | 'L2' | 'L3';
  health?: '健康' | '需授权';
  successRate?: string;
  dependencies?: string[];
  dependencyStatus?: Array<{ name: string; status: 'ready' | 'unauthorized'; reason?: string }>;
  blockers?: string[];
  sequence?: string[];
  variables?: Array<{ key: string; label: string; required: boolean }>;
  permissions?: Array<{ action: string; gate: string }>;
  changelog?: Array<{ version: string; date: string; note: string }>;
  recentRuns?: Array<{ id: string; time: string; status: 'success' | 'failed'; note: string }>;
  audience?: string;
  builtin?: boolean;
  source?: 'platform' | 'personal' | string;
  certification?: string;
  knowledgePackageIds?: string[];
  requiredSkills?: string[];
  graph?: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
}

const readyDep = (name: string) => ({ name, status: 'ready' as const });

export const mockWorkflowTemplates: WorkflowTemplate[] = [
  {
    id: "wf.compliance.export_review", name: "数据导出审批", description: "敏感数据导出申请、脱敏策略校验、审批与审计留痕。",
    category: 'business', department: "it", library: "default", nodes: 7, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L3", health: "健康", successRate: 'Certified',
    audience: "业务申请人 / 合规 / 数据管理员", dependencies: ["data.export", "notify.send"],
    dependencyStatus: [readyDep("data.export"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "policy", "decision", "approval", "execute", "audit", "notify"] as any,
    variables: [{"key": "dataset", "label": "数据集", "required": true, "type": "string"}, {"key": "classification", "label": "密级", "required": true, "type": "enum", "enum": ["internal", "confidential", "restricted"]}, {"key": "purpose", "label": "用途说明", "required": true, "type": "string"}] as any,
    permissions: [],
    changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "出厂 Certified 首发"}] as any,
    recentRuns: [],
  },
  {
    id: "wf.fin.expense", name: "费用报销", description: "票据校验、预算核验、分级审批；无付款连接器时可降级为仅审批闭环。",
    category: 'business', department: "finance", library: "default", nodes: 9, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L3", health: "健康", successRate: 'Certified',
    audience: "报销人 / 财务共享", dependencies: ["knowledge.retrieve", "payment.initiate", "notify.send"],
    dependencyStatus: [readyDep("knowledge.retrieve"), readyDep("payment.initiate"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "decision", "policy", "approval", "execute", "compensate", "audit", "notify"] as any,
    variables: [{"key": "amount", "label": "报销金额", "required": true, "type": "number"}, {"key": "cost_center", "label": "成本中心", "required": true, "type": "string"}, {"key": "invoice_ids", "label": "票据编号", "required": true, "type": "string"}] as any,
    permissions: [],
    changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "出厂 Certified；支持付款槽位降级"}] as any,
    recentRuns: [],
  },
  {
    id: "wf.fin.purchase", name: "采购申请", description: "采购立项、预算占用、审批与订单回写；可按企业裁剪三单匹配。",
    category: 'business', department: "finance", library: "default", nodes: 8, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L3", health: "健康", successRate: 'Certified',
    audience: "采购 / 预算责任人", dependencies: ["erp.purchase", "notify.send"],
    dependencyStatus: [readyDep("erp.purchase"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "decision", "approval", "execute", "task", "audit", "notify"] as any,
    variables: [{"key": "po_title", "label": "采购事项", "required": true, "type": "string"}, {"key": "budget_code", "label": "预算科目", "required": true, "type": "string"}, {"key": "amount", "label": "金额", "required": true, "type": "number"}] as any,
    permissions: [],
    changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "出厂 Certified 首发"}] as any,
    recentRuns: [],
  },
  {
    id: "wf.hr.offboarding", name: "离职交接与权限回收", description: "资产交还、账号回收、证明开具与交接确认，保障离场安全基线。",
    category: 'business', department: "hr", library: "default", nodes: 6, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L2", health: "健康", successRate: 'Certified',
    audience: "离职员工 / HRBP / IT", dependencies: ["identity.revoke", "notify.send"],
    dependencyStatus: [readyDep("identity.revoke"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "approval", "execute", "audit", "notify"] as any,
    variables: [{"key": "employee_id", "label": "员工工号", "required": true, "type": "string"}, {"key": "last_day", "label": "最后工作日", "required": true, "type": "date"}] as any,
    permissions: [],
    changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "出厂 Certified 首发"}] as any,
    recentRuns: [],
  },
  {
    id: "wf.hr.onboarding", name: "员工入职开通", description: "入职申请、材料核验、账号开通、权限分配与欢迎通知；跨行业通用。",
    category: 'business', department: "hr", library: "default", nodes: 8, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L2", health: "健康", successRate: 'Certified',
    audience: "新员工 / HRBP / IT", dependencies: ["identity.provision", "knowledge.retrieve", "notify.send"],
    dependencyStatus: [readyDep("identity.provision"), readyDep("knowledge.retrieve"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "decision", "approval", "execute", "task", "audit", "notify"] as any,
    variables: [{"key": "employee_name", "label": "入职人姓名", "required": true, "type": "string"}, {"key": "start_date", "label": "入职日期", "required": true, "type": "date"}, {"key": "role_profile", "label": "岗位画像", "required": true, "type": "string"}] as any,
    permissions: [],
    changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "出厂 Certified 首发"}] as any,
    recentRuns: [],
  },
  {
    id: "wf.it.access_request", name: "权限申请", description: "权限申请、影响评估、审批开通/时限授权与到期回收。",
    category: 'business', department: "it", library: "default", nodes: 8, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L2", health: "健康", successRate: 'Certified',
    audience: "全体员工 / IT 服务台", dependencies: ["identity.provision", "notify.send"],
    dependencyStatus: [readyDep("identity.provision"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "decision", "approval", "execute", "schedule", "audit", "notify"] as any,
    variables: [{"key": "account", "label": "账号", "required": true, "type": "string"}, {"key": "permission_set", "label": "权限集", "required": true, "type": "string"}, {"key": "expire_days", "label": "授权天数", "required": false, "type": "number", "default": 90}] as any,
    permissions: [],
    changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "出厂 Certified 首发"}] as any,
    recentRuns: [],
  },
  {
    id: "wf.it.incident_mitigate", name: "生产事件缓解", description: "告警触发、研判、双重审批、受控执行与补偿回滚（运维高级库）。",
    category: 'business', department: "it", library: "advanced", nodes: 9, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L3", health: "需授权", successRate: 'Certified',
    audience: "SRE / 平台", dependencies: ["infra.execute", "notify.send"],
    dependencyStatus: [{ name: "infra.execute", status: 'unauthorized' as const, reason: "infra.execute：未绑定连接器槽位" }, readyDep("notify.send")], blockers: ["infra.execute：未绑定连接器槽位"],
    sequence: ["event", "retrieve", "decision", "policy", "approval", "execute", "compensate", "audit", "notify"] as any,
    variables: [{"key": "incident_id", "label": "事件单号", "required": true, "type": "string"}, {"key": "cluster", "label": "目标集群", "required": true, "type": "string"}] as any,
    permissions: [],
    changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "IT 高级库"}] as any,
    recentRuns: [],
  },
  {
    id: "wf.ops.ticket_escalate", name: "客诉升级闭环", description: "工单分级、SLA 监控、升级人工、回访与知识沉淀。",
    category: 'business', department: "operations", library: "default", nodes: 8, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L2", health: "健康", successRate: 'Certified',
    audience: "客服 / 运营 / 值班", dependencies: ["ticket.manage", "knowledge.retrieve", "notify.send"],
    dependencyStatus: [readyDep("ticket.manage"), readyDep("knowledge.retrieve"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "decision", "task", "approval", "execute", "audit", "notify"] as any,
    variables: [{"key": "ticket_id", "label": "工单号", "required": true, "type": "string"}, {"key": "sla_minutes", "label": "SLA（分钟）", "required": false, "type": "number", "default": 240}] as any,
    permissions: [],
    changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "出厂 Certified 首发"}] as any,
    recentRuns: [],
  },
  {
    id: "wf.rd.release_gate", name: "发版门禁", description: "需求关联、测试门禁、环境审批到发布通报；对齐沙箱/预发/生产。",
    category: 'business', department: "rd", library: "default", nodes: 9, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L2", health: "健康", successRate: 'Certified',
    audience: "产品 / 研发负责人", dependencies: ["ci.pipeline", "notify.send"],
    dependencyStatus: [readyDep("ci.pipeline"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "decision", "approval", "parallel", "condition", "execute", "audit", "notify"] as any,
    variables: [{"key": "requirement_id", "label": "需求编号", "required": true, "type": "string"}, {"key": "target_env", "label": "目标环境", "required": true, "type": "enum", "enum": ["sandbox", "staging", "production"]}] as any,
    permissions: [],
    changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "出厂 Certified 首发"}] as any,
    recentRuns: [],
  },
  {
    id: "wf.sales.contract_approve", name: "合同与折扣审批", description: "商机报价、折扣超阈审批、合同归档与 CRM 阶段回写。",
    category: 'business', department: "sales", library: "default", nodes: 8, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L2", health: "健康", successRate: 'Certified',
    audience: "销售代表 / 销售经理", dependencies: ["crm.update_stage", "notify.send"],
    dependencyStatus: [readyDep("crm.update_stage"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "decision", "policy", "approval", "execute", "audit", "notify"] as any,
    variables: [{"key": "opportunity_id", "label": "商机编号", "required": true, "type": "string"}, {"key": "discount_pct", "label": "折扣比例", "required": false, "type": "number", "default": 0}, {"key": "contract_amount", "label": "合同金额", "required": true, "type": "number"}] as any,
    permissions: [],
    changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "出厂 Certified 首发"}] as any,
    recentRuns: [],
  },
  {
    id: 'tpl-adv-cache-oom', name: 'cache-oom 受控恢复', description: 'Redis 缓存 OOM 受控恢复（IT 高级库）。',
    category: 'system', department: 'it', library: 'advanced', nodes: 10, installs: 0, rating: 4.8,
    version: '2.4.0', owner: 'SRE 平台组', verifiedAt: '2026-07-16', risk: 'L3', health: '需授权', successRate: 'Advanced',
    audience: 'SRE / 平台', dependencies: ['infra.execute'],
    dependencyStatus: [{ name: 'infra.execute', status: 'unauthorized' as const, reason: 'infra.execute：当前工作区未授权生产写权限' }],
    blockers: ['infra.execute：当前工作区未授权生产写权限'],
    sequence: ['event', 'retrieve', 'decision', 'policy', 'approval', 'execute', 'compensate', 'audit', 'notify'] as any,
    variables: [{ key: 'cluster', label: '目标集群', required: true }] as any,
    permissions: [], changelog: [], recentRuns: [],
  },
  {
    id: "wf.office.announce", name: "通知拟稿与发布", description: "按写作规范拟订通知，审批后通过渠道发布。",
    category: 'business', department: "office", library: "default", nodes: 6, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L2", health: "健康", successRate: 'Certified',
    audience: "全员 / 办公协作", dependencies: ["knowledge.retrieve", "notify.send"],
    dependencyStatus: [readyDep("knowledge.retrieve"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "approval", "execute", "audit", "notify"] as any,
    variables: [{"key": "title", "label": "通知标题", "required": true}] as any,
    permissions: [], changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "办公开箱首发"}] as any,
    recentRuns: [], builtin: true, source: 'platform', certification: 'certified',
    knowledgePackageIds: ["kp.office.writing", "kp.office.handbook"] as any, requiredSkills: ["docx", "summarize"] as any,
  },
  {
    id: "wf.office.ask_policy", name: "制度问答与答复留痕", description: "针对制度疑问检索员工手册与制度包，生成可留痕答复并通知提问人。",
    category: 'business', department: "office", library: "default", nodes: 5, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L1", health: "健康", successRate: 'Certified',
    audience: "全员 / 办公协作", dependencies: ["knowledge.retrieve", "notify.send"],
    dependencyStatus: [readyDep("knowledge.retrieve"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "decision", "audit", "notify"] as any,
    variables: [{"key": "question", "label": "制度问题", "required": true}] as any,
    permissions: [], changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "办公开箱首发"}] as any,
    recentRuns: [], builtin: true, source: 'platform', certification: 'certified',
    knowledgePackageIds: ["kp.office.handbook", "kp.office.leave_travel"] as any, requiredSkills: ["summarize"] as any,
  },
  {
    id: "wf.office.doc_review", name: "文档审阅与定稿", description: "按文档质量清单审阅材料，经确认后定稿归档。",
    category: 'business', department: "office", library: "default", nodes: 6, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L2", health: "健康", successRate: 'Certified',
    audience: "全员 / 办公协作", dependencies: ["knowledge.retrieve", "notify.send"],
    dependencyStatus: [readyDep("knowledge.retrieve"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "approval", "execute", "audit", "notify"] as any,
    variables: [{"key": "doc_title", "label": "文档标题", "required": true}] as any,
    permissions: [], changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "办公开箱首发"}] as any,
    recentRuns: [], builtin: true, source: 'platform', certification: 'certified',
    knowledgePackageIds: ["kp.office.writing"] as any, requiredSkills: ["docx", "pdf"] as any,
  },
  {
    id: "wf.office.expense_precheck", name: "报销前自查", description: "按报销常识自查票据与不可报项，通过后可衔接部门报销流程。",
    category: 'business', department: "office", library: "default", nodes: 6, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L1", health: "健康", successRate: 'Certified',
    audience: "全员 / 办公协作", dependencies: ["knowledge.retrieve", "notify.send"],
    dependencyStatus: [readyDep("knowledge.retrieve"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "decision", "task", "audit", "notify"] as any,
    variables: [{"key": "amount", "label": "金额", "required": true}] as any,
    permissions: [], changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "办公开箱首发"}] as any,
    recentRuns: [], builtin: true, source: 'platform', certification: 'certified',
    knowledgePackageIds: ["kp.office.expense_lite"] as any, requiredSkills: ["summarize"] as any,
  },
  {
    id: "wf.office.it_helpdesk", name: "IT 求助工单", description: "先检索 IT 自助知识，无法解决则升级人工处理并通知。",
    category: 'business', department: "office", library: "default", nodes: 6, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L1", health: "健康", successRate: 'Certified',
    audience: "全员 / 办公协作", dependencies: ["knowledge.retrieve", "notify.send"],
    dependencyStatus: [readyDep("knowledge.retrieve"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "decision", "task", "audit", "notify"] as any,
    variables: [{"key": "issue", "label": "问题描述", "required": true}] as any,
    permissions: [], changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "办公开箱首发"}] as any,
    recentRuns: [], builtin: true, source: 'platform', certification: 'certified',
    knowledgePackageIds: ["kp.office.it_selfservice"] as any, requiredSkills: ["summarize"] as any,
  },
  {
    id: "wf.office.leave_request", name: "请假申请", description: "对照假勤制度提交请假，经审批后通知相关人。",
    category: 'business', department: "office", library: "default", nodes: 6, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L2", health: "健康", successRate: 'Certified',
    audience: "全员 / 办公协作", dependencies: ["knowledge.retrieve", "notify.send"],
    dependencyStatus: [readyDep("knowledge.retrieve"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "policy", "approval", "audit", "notify"] as any,
    variables: [{"key": "leave_type", "label": "假种", "required": true}, {"key": "days", "label": "天数", "required": true}] as any,
    permissions: [], changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "办公开箱首发"}] as any,
    recentRuns: [], builtin: true, source: 'platform', certification: 'certified',
    knowledgePackageIds: ["kp.office.leave_travel"] as any, requiredSkills: [] as any,
  },
  {
    id: "wf.office.meeting_book", name: "会议预约协作", description: "发起会议预约意向，确认时间与参会人后通知相关方（可先人工确认会议室）。",
    category: 'business', department: "office", library: "default", nodes: 5, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L1", health: "健康", successRate: 'Certified',
    audience: "全员 / 办公协作", dependencies: ["knowledge.retrieve", "notify.send"],
    dependencyStatus: [readyDep("knowledge.retrieve"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "condition", "approval", "task", "notify"] as any,
    variables: [{"key": "slot", "label": "期望时段", "required": true}] as any,
    permissions: [], changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "办公开箱首发"}] as any,
    recentRuns: [], builtin: true, source: 'platform', certification: 'certified',
    knowledgePackageIds: ["kp.office.meeting"] as any, requiredSkills: [] as any,
  },
  {
    id: "wf.office.meeting_minutes", name: "会议纪要生成与分发", description: "按会议规范整理要点，生成纪要文档并分发给参会人。",
    category: 'business', department: "office", library: "default", nodes: 7, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L1", health: "健康", successRate: 'Certified',
    audience: "全员 / 办公协作", dependencies: ["knowledge.retrieve", "notify.send"],
    dependencyStatus: [readyDep("knowledge.retrieve"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "decision", "execute", "task", "audit", "notify"] as any,
    variables: [{"key": "meeting_title", "label": "会议主题", "required": true}, {"key": "attendees", "label": "参会人", "required": false}] as any,
    permissions: [], changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "办公开箱首发"}] as any,
    recentRuns: [], builtin: true, source: 'platform', certification: 'certified',
    knowledgePackageIds: ["kp.office.meeting"] as any, requiredSkills: ["summarize", "docx"] as any,
  },
  {
    id: "wf.office.todo_followup", name: "待办跟催", description: "对会议纪要或任务中的动作项到期提醒并回传结果。",
    category: 'business', department: "office", library: "default", nodes: 4, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L1", health: "健康", successRate: 'Certified',
    audience: "全员 / 办公协作", dependencies: ["knowledge.retrieve", "notify.send"],
    dependencyStatus: [readyDep("knowledge.retrieve"), readyDep("notify.send")], blockers: [],
    sequence: ["schedule", "retrieve", "task", "notify"] as any,
    variables: [{"key": "todo_id", "label": "待办编号", "required": true}] as any,
    permissions: [], changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "办公开箱首发"}] as any,
    recentRuns: [], builtin: true, source: 'platform', certification: 'certified',
    knowledgePackageIds: ["kp.office.meeting"] as any, requiredSkills: [] as any,
  },
  {
    id: "wf.office.travel_request", name: "出差申请", description: "对照差旅标准提交出差申请，审批后通知与留痕。",
    category: 'business', department: "office", library: "default", nodes: 7, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L2", health: "健康", successRate: 'Certified',
    audience: "全员 / 办公协作", dependencies: ["knowledge.retrieve", "notify.send"],
    dependencyStatus: [readyDep("knowledge.retrieve"), readyDep("notify.send")], blockers: [],
    sequence: ["event", "retrieve", "policy", "approval", "task", "audit", "notify"] as any,
    variables: [{"key": "destination", "label": "目的地", "required": true}, {"key": "days", "label": "天数", "required": true}] as any,
    permissions: [], changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "办公开箱首发"}] as any,
    recentRuns: [], builtin: true, source: 'platform', certification: 'certified',
    knowledgePackageIds: ["kp.office.leave_travel"] as any, requiredSkills: [] as any,
  },
  {
    id: "wf.office.weekly_report", name: "周报汇总", description: "汇总本周工作进展，按写作规范生成周报并通知相关人。",
    category: 'business', department: "office", library: "default", nodes: 6, installs: 0, rating: 5,
    version: "1.0.0", owner: "平台内置", verifiedAt: '2026-08-21', risk: "L1", health: "健康", successRate: 'Certified',
    audience: "全员 / 办公协作", dependencies: ["knowledge.retrieve", "notify.send"],
    dependencyStatus: [readyDep("knowledge.retrieve"), readyDep("notify.send")], blockers: [],
    sequence: ["schedule", "retrieve", "transform", "execute", "audit", "notify"] as any,
    variables: [{"key": "week", "label": "周次", "required": true}] as any,
    permissions: [], changelog: [{"version": "1.0.0", "date": "2026-08-21", "note": "办公开箱首发"}] as any,
    recentRuns: [], builtin: true, source: 'platform', certification: 'certified',
    knowledgePackageIds: ["kp.office.writing"] as any, requiredSkills: ["summarize", "docx"] as any,
  },

  {
    id: 'wft-user-sample-oncall',
    name: '值班交接清单',
    description: '个人另存：值班交接、未决告警核对与群通知；仅当前工作区可见。',
    category: 'business',
    department: 'it',
    library: 'default',
    nodes: 5,
    installs: 0,
    rating: 0,
    version: '1.0.0',
    owner: '业务构建者',
    ownerId: 'u1',
    workspaceId: 'w1',
    verifiedAt: '2026-08-21',
    risk: 'L2',
    health: '健康',
    successRate: 'Personal',
    audience: '本人 / 值班同事',
    dependencies: ['notify.send'],
    dependencyStatus: [readyDep('notify.send')],
    blockers: [],
    sequence: ['event', 'retrieve', 'task', 'audit', 'notify'] as any,
    variables: [{ key: 'shift', label: '班次', required: true }] as any,
    permissions: [],
    changelog: [{ version: '1.0.0', date: '2026-08-21', note: '个人创建示例' }] as any,
    recentRuns: [],
    builtin: false,
    source: 'personal',
    certification: 'preview',
  },
];

export type WorkflowRunRecord = {
  id: string;
  workflowId: string;
  workspaceId?: string;
  time: string;
  trigger: string;
  status: 'success' | 'failed' | 'running';
  duration: number;
  steps: number;
  who: string;
  error?: string;
  revisionId?: string;
  correlationId?: string;
  environment?: 'sandbox' | 'staging' | 'production';
  /** recorded=节点快照来自该次运行；synthetic=仅有汇总、无逐步证据 */
  evidenceMode: 'recorded' | 'synthetic';
  nodeSteps?: Array<{ id: string; kind?: string; label: string; status?: 'pending' | 'success' | 'failed' | 'skipped' }>;
  attempt?: number;
  parentRunId?: string;
};

function buildRunNodeSteps(nodes: any[] | undefined, opts?: { failedAt?: number; status?: WorkflowRunRecord['status'] }): WorkflowRunRecord['nodeSteps'] {
  const list = (nodes ?? []).map((node: any, index: number) => ({
    id: String(node.id ?? `n${index + 1}`),
    kind: node.kind ?? node.data?.kind,
    label: String(node.label ?? node.data?.label ?? `步骤 ${index + 1}`),
    status: 'pending' as const,
  }));
  if (!list.length) return list;
  const status = opts?.status ?? 'success';
  const failedAt = opts?.failedAt;
  return list.map((step, index) => {
    if (status === 'running') {
      return { ...step, status: index === 0 ? 'success' : 'pending' };
    }
    if (status === 'failed') {
      const cut = failedAt ?? Math.max(0, list.length - 1);
      if (index < cut) return { ...step, status: 'success' };
      if (index === cut) return { ...step, status: 'failed' };
      return { ...step, status: 'skipped' };
    }
    return { ...step, status: 'success' };
  });
}

export const mockWorkflowRuns: WorkflowRunRecord[] = [
  {
    id: 'r1', workflowId: 'wf1', time: '14:28', trigger: '入职申请', status: 'success', duration: 38, steps: 10, who: '王昊',
    revisionId: 'v4', correlationId: 'corr_run_r1', environment: 'sandbox', evidenceMode: 'recorded',
    nodeSteps: buildRunNodeSteps([
      { id: 'n1', kind: 'trigger', label: 'Webhook 触发' }, { id: 'n2', kind: 'retrieve', label: '知识检索' },
      { id: 'n3', kind: 'decision', label: '数字伙伴研判' }, { id: 'n4', kind: 'approval', label: '双重审批' },
      { id: 'n5', kind: 'branch', label: '分支：成功路径' }, { id: 'n6', kind: 'branch', label: '分支：回滚路径' },
      { id: 'n7', kind: 'execute', label: '执行受控恢复' }, { id: 'n8', kind: 'execute', label: '回滚 + 告警' },
      { id: 'n9', kind: 'audit', label: '审计留痕' }, { id: 'n10', kind: 'notify', label: '飞书 / 企微通知' },
    ], { status: 'success' }),
  },
  {
    id: 'r2', workflowId: 'wf1', time: '13:42', trigger: '入职申请', status: 'success', duration: 36, steps: 10, who: '李婷',
    revisionId: 'v4', correlationId: 'corr_run_r2', environment: 'sandbox', evidenceMode: 'recorded',
    nodeSteps: buildRunNodeSteps([
      { id: 'n1', kind: 'trigger', label: 'Webhook 触发' }, { id: 'n2', kind: 'retrieve', label: '知识检索' },
      { id: 'n3', kind: 'decision', label: '数字伙伴研判' }, { id: 'n4', kind: 'approval', label: '双重审批' },
      { id: 'n5', kind: 'branch', label: '分支：成功路径' }, { id: 'n6', kind: 'branch', label: '分支：回滚路径' },
      { id: 'n7', kind: 'execute', label: '执行受控恢复' }, { id: 'n8', kind: 'execute', label: '回滚 + 告警' },
      { id: 'n9', kind: 'audit', label: '审计留痕' }, { id: 'n10', kind: 'notify', label: '飞书 / 企微通知' },
    ], { status: 'success' }),
  },
  {
    id: 'r3', workflowId: 'wf1', time: '11:18', trigger: '入职申请', status: 'failed', duration: 52, steps: 4, who: '王昊',
    error: '双重审批超时（300s）', revisionId: 'v3', correlationId: 'corr_run_r3', environment: 'sandbox', evidenceMode: 'recorded',
    nodeSteps: buildRunNodeSteps([
      { id: 'n1', kind: 'trigger', label: '入职申请触发' }, { id: 'n2', kind: 'retrieve', label: '知识检索' },
      { id: 'n3', kind: 'decision', label: '数字伙伴研判' }, { id: 'n4', kind: 'approval', label: '双重审批' },
      { id: 'n5', kind: 'branch', label: '条件分支' }, { id: 'n6', kind: 'execute', label: '开通账号权限' },
    ], { status: 'failed', failedAt: 3 }),
  },
  {
    id: 'r4', workflowId: 'wf1', time: '09:54', trigger: '发版门禁', status: 'success', duration: 124, steps: 8, who: '孙博',
    revisionId: 'v2', correlationId: 'corr_run_r4', environment: 'staging', evidenceMode: 'synthetic',
  },
  {
    id: 'r5', workflowId: 'wf1', time: '08:30', trigger: '合同审批', status: 'success', duration: 78, steps: 6, who: '张睿',
    revisionId: 'v2', correlationId: 'corr_run_r5', environment: 'staging', evidenceMode: 'synthetic',
  },
];

export const mockWorkflowKpi = {
  running: 3,
  totalToday: 47,
  successRate: 97.8,
  avgDuration: 42,
  mttrImprovement: -65,
};

export const mockWorkflow: Workflow = {
  id: 'wf1',
  name: '入职办理与权限开通',
  status: 'active',
  triggerCount: 124,
  successRate: 1.0,
  avgDurationSec: 38,
  nodes: [
    { id: 'n1', kind: 'trigger', label: '入职申请触发', position: { x: 60, y: 80 }, status: 'success', durationMs: 12 },
    { id: 'n2', kind: 'retrieve', label: '知识检索', position: { x: 280, y: 80 }, status: 'success', durationMs: 320 },
    { id: 'n3', kind: 'decision', label: '数字伙伴研判', position: { x: 500, y: 80 }, status: 'success', durationMs: 880 },
    { id: 'n4', kind: 'approval', label: '双重审批', position: { x: 720, y: 80 }, status: 'success', durationMs: 4500 },
    { id: 'n5', kind: 'branch', label: '分支：开通路径', position: { x: 940, y: 40 }, status: 'success', durationMs: 4 },
    { id: 'n6', kind: 'branch', label: '分支：驳回路径', position: { x: 940, y: 160 }, status: 'success', durationMs: 4 },
    { id: 'n7', kind: 'execute', label: '开通账号权限', position: { x: 1180, y: 40 }, status: 'success', durationMs: 21000 },
    { id: 'n8', kind: 'execute', label: '通知 HRBP', position: { x: 1180, y: 160 }, status: 'success', durationMs: 18000 },
    { id: 'n9', kind: 'audit', label: '审计留痕', position: { x: 1420, y: 100 }, status: 'success', durationMs: 60 },
    { id: 'n10', kind: 'notify', label: '飞书 / 企微通知', position: { x: 1660, y: 100 }, status: 'success', durationMs: 180 },
  ],
  edges: [
    { id: 'e1-2', source: 'n1', target: 'n2' },
    { id: 'e2-3', source: 'n2', target: 'n3' },
    { id: 'e3-4', source: 'n3', target: 'n4' },
    { id: 'e4-5', source: 'n4', target: 'n5' },
    { id: 'e4-6', source: 'n4', target: 'n6' },
    { id: 'e5-7', source: 'n5', target: 'n7' },
    { id: 'e6-8', source: 'n6', target: 'n8' },
    { id: 'e7-9', source: 'n7', target: 'n9' },
    { id: 'e8-9', source: 'n8', target: 'n9' },
    { id: 'e9-10', source: 'n9', target: 'n10' },
  ],
};

/** 变更协同工作流；供 wfs-change.sourceWorkflowId 引用，保持数据流闭环。 */
export const mockWorkflowChange: Workflow = {
  id: 'wf-change',
  name: '生产变更协同',
  status: 'active',
  triggerCount: 56,
  successRate: 0.98,
  avgDurationSec: 120,
  nodes: [
    { id: 'c1', kind: 'trigger', label: '变更单触发', position: { x: 60, y: 80 }, status: 'success', durationMs: 10 },
    { id: 'c2', kind: 'retrieve', label: '风险与依赖检索', position: { x: 280, y: 80 }, status: 'success', durationMs: 280 },
    { id: 'c3', kind: 'decision', label: '变更协同研判', position: { x: 500, y: 80 }, status: 'success', durationMs: 640 },
    { id: 'c4', kind: 'approval', label: '双重审批', position: { x: 720, y: 80 }, status: 'success', durationMs: 5200 },
    { id: 'c5', kind: 'execute', label: '灰度观察', position: { x: 940, y: 80 }, status: 'success', durationMs: 15000 },
    { id: 'c6', kind: 'audit', label: '审计留痕', position: { x: 1160, y: 80 }, status: 'success', durationMs: 50 },
    { id: 'c7', kind: 'notify', label: '企业微信通知', position: { x: 1380, y: 80 }, status: 'success', durationMs: 120 },
  ],
  edges: [
    { id: 'ce1-2', source: 'c1', target: 'c2' },
    { id: 'ce2-3', source: 'c2', target: 'c3' },
    { id: 'ce3-4', source: 'c3', target: 'c4' },
    { id: 'ce4-5', source: 'c4', target: 'c5' },
    { id: 'ce5-6', source: 'c5', target: 'c6' },
    { id: 'ce6-7', source: 'c6', target: 'c7' },
  ],
};

export const mockWorkflowCatalog: Workflow[] = [mockWorkflow, mockWorkflowChange];

// 工作流控制台运行态按工作区分域，避免草稿、运行、版本和审计跨工作区混用。
type WorkflowVersionRecord = {
  id: string;
  label: string;
  time: string;
  desc: string;
  status: 'draft' | 'published';
  evidenceMode: 'recorded' | 'synthetic';
  nodeCount: number;
  edgeCount: number;
  nodes: any[];
  edges: any[];
  publishedAt?: string;
  parentVersionId?: string;
};

function cloneWorkflowGraph(nodes: any[], edges: any[]) {
  return {
    nodes: JSON.parse(JSON.stringify(nodes ?? [])),
    edges: JSON.parse(JSON.stringify(edges ?? [])),
  };
}

function workflowVersionFromGraph(
  partial: Omit<WorkflowVersionRecord, 'nodeCount' | 'edgeCount' | 'nodes' | 'edges' | 'evidenceMode'> & {
    nodes: any[];
    edges: any[];
    evidenceMode?: WorkflowVersionRecord['evidenceMode'];
  },
): WorkflowVersionRecord {
  const graph = cloneWorkflowGraph(partial.nodes, partial.edges);
  return {
    ...partial,
    evidenceMode: partial.evidenceMode ?? 'recorded',
    nodes: graph.nodes,
    edges: graph.edges,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  };
}

function buildInitialWorkflowVersions(): WorkflowVersionRecord[] {
  const full = cloneWorkflowGraph(mockWorkflow.nodes, mockWorkflow.edges);
  const v3Nodes = full.nodes.filter((node: any) => !['n6', 'n8'].includes(node.id));
  const v3Edges = full.edges.filter((edge: any) => !['e4-6', 'e6-8', 'e8-9'].includes(edge.id));
  const v2Nodes = full.nodes.filter((node: any) => ['n1', 'n2', 'n3', 'n4', 'n5', 'n7', 'n9', 'n10'].includes(node.id));
  const v2Edges = full.edges.filter((edge: any) => ['e1-2', 'e2-3', 'e3-4', 'e4-5', 'e5-7', 'e7-9', 'e9-10'].includes(edge.id));
  const v1Nodes = full.nodes.filter((node: any) => ['n1', 'n2', 'n3', 'n4', 'n9', 'n10'].includes(node.id));
  const v1Edges = [
    ...full.edges.filter((edge: any) => ['e1-2', 'e2-3', 'e3-4', 'e9-10'].includes(edge.id)),
    { id: 'e4-9', source: 'n4', target: 'n9' },
  ];
  return [
    workflowVersionFromGraph({
      id: 'v4', label: 'v4 · 当前草稿', time: '刚刚', desc: '新增分支：回滚路径', status: 'draft',
      nodes: full.nodes, edges: full.edges,
    }),
    workflowVersionFromGraph({
      id: 'v3', label: 'v3', time: '15 分钟前', desc: '调整审计节点位置（尚无回滚分支）', status: 'published',
      publishedAt: '2026-07-30T02:00:00Z', nodes: v3Nodes, edges: v3Edges,
    }),
    workflowVersionFromGraph({
      id: 'v2', label: 'v2', time: '1 小时前', desc: '加入成功路径与受控恢复', status: 'published',
      publishedAt: '2026-07-30T01:00:00Z', nodes: v2Nodes, edges: v2Edges,
    }),
    workflowVersionFromGraph({
      id: 'v1', label: 'v1', time: '昨天 18:42', desc: '初始版本 · 审批后直达审计通知', status: 'published',
      publishedAt: '2026-07-29T10:42:00Z', nodes: v1Nodes, edges: v1Edges,
    }),
  ];
}

type WorkflowControl = { draft: any; versions: WorkflowVersionRecord[]; audits: any[]; runs: any[] };
const workflowControls = new Map<string, WorkflowControl>();
function workflowControlFor(workspaceId: string): WorkflowControl {
  const existing = workflowControls.get(workspaceId);
  if (existing) return existing;
  const versions = buildInitialWorkflowVersions();
  const current = versions[0];
  const initial: WorkflowControl = {
    draft: {
      ...JSON.parse(JSON.stringify(mockWorkflow)),
      workspaceId,
      nodes: cloneWorkflowGraph(current.nodes, current.edges).nodes,
      edges: cloneWorkflowGraph(current.nodes, current.edges).edges,
    },
    versions,
    audits: [{ id: 'wa1', action: 'WORKFLOW_LOAD', actor: '系统', target: mockWorkflow.name, time: new Date().toISOString(), result: 'success' }],
    runs: mockWorkflowRuns.map((run) => ({ ...run, workspaceId })),
  };
  workflowControls.set(workspaceId, initial);
  return initial;
}

function workflowAudit(control: WorkflowControl, action: string, target: string, result: 'success' | 'failed' = 'success') {
  const event = { id: mockId('wf_audit'), action, actor: '当前用户', target, time: new Date().toISOString(), result };
  control.audits.unshift(event);
  return event;
}

export type WorkflowGenerationRecord = {
  id: string;
  prompt: string;
  promptDigest: string;
  status: 'generated' | 'review_required' | 'applied' | 'discarded' | 'expired';
  model: string;
  workspaceId: string;
  tenantId: string;
  ownerId: string;
  policyVersion: string;
  expiresAt: string;
  revisionId?: string;
  createdAt: string;
  workflow: { nodes: Array<{ id: string; kind: string; label: string; position: { x: number; y: number }; description?: string }>; edges: Array<{ id: string; source: string; target: string }> };
  checks: { structure: 'passed' | 'review'; dependencies: 'passed' | 'review'; risk: 'passed' | 'review' };
  dependencies: Array<{ type: 'tool' | 'mcp' | 'agent'; name: string; status: 'available' | 'missing'; reason?: string }>;
  risks: Array<{ level: 'L1' | 'L2' | 'L3'; node: string; text: string; requiresApproval: boolean }>;
  warnings: string[];
  qualityScore: number;
  requiresReview: boolean;
};

const ALLOWED_GENERATION_MODELS = new Set(['企业默认模型', 'Qwen-Enterprise']);
const workflowGenerationRevisions = new Map<string, { id: string; generationId: string; nodes: any[]; edges: any[]; createdAt: string }>();

function generationDigest(prompt: string) {
  return `sha256:${Array.from(prompt).reduce((value, char) => ((value * 31 + char.charCodeAt(0)) >>> 0), 7).toString(16)}`;
}

function rejectUnsafeGenerationPrompt(prompt: string) {
  if (/\b(api[_-]?key|password|secret|token)\b\s*[:=]/i.test(prompt)) throw new Error('生成请求包含疑似密钥或凭据，请先脱敏后再提交');
}

function buildGeneratedWorkflow(prompt: string) {
  const lower = prompt.toLowerCase();
  const isScheduled = /每天|每周|定时|巡检|cron|schedule/.test(lower);
  const createsTask = /工单|任务|人工处理|值班/.test(lower);
  const hasExternalWrite = /恢复|执行|变更|扩容|写入|kubectl|api/.test(lower);
  const nodes = [
    { id: 'g1', kind: isScheduled ? 'schedule' : 'event', label: isScheduled ? '定时巡检触发' : '告警事件触发', position: { x: 80, y: 120 }, description: isScheduled ? '按计划发起数字伙伴巡检' : '接收告警或业务事件' },
    { id: 'g2', kind: 'retrieve', label: '检索运行手册', position: { x: 300, y: 120 }, description: '查询知识库与历史处置证据' },
    { id: 'g3', kind: 'decision', label: '数字伙伴研判', position: { x: 520, y: 120 }, description: '结合上下文判断处置路径' },
    { id: 'g4', kind: 'policy', label: '风险策略校验', position: { x: 740, y: 120 }, description: '校验权限、风险等级与变更策略' },
    ...(hasExternalWrite ? [{ id: 'g5', kind: 'approval', label: '双重审批', position: { x: 960, y: 120 }, description: '高风险动作需专家双重审批' }] : []),
    { id: 'g6', kind: createsTask ? 'task' : hasExternalWrite ? 'execute' : 'notify', label: createsTask ? '创建处置工单' : hasExternalWrite ? '执行受控动作' : '通知负责人', position: { x: hasExternalWrite ? 1180 : 960, y: 120 }, description: createsTask ? '派发专家处置任务并回传结果' : hasExternalWrite ? '调用已授权的 Skill 或 MCP 工具' : '发送处置结论通知' },
    ...(hasExternalWrite ? [{ id: 'g7', kind: 'compensate', label: '补偿回滚', position: { x: 1400, y: 120 }, description: '执行失败时回滚可逆变更' }] : []),
    { id: 'g8', kind: 'audit', label: '审计留痕', position: { x: hasExternalWrite ? 1620 : 1180, y: 120 }, description: '写入处置证据、策略与版本信息' },
    { id: 'g9', kind: 'notify', label: '结果通知', position: { x: hasExternalWrite ? 1840 : 1400, y: 120 }, description: '通知负责人和关联任务' },
  ];
  return { nodes, edges: nodes.slice(1).map((node, index) => ({ id: `ge${index + 1}`, source: nodes[index].id, target: node.id })) };
}

export const mockWorkflowGenerations: WorkflowGenerationRecord[] = [
  {
    id: 'gen_demo_001', prompt: '当生产 Redis 触发 OOM 告警时，由数字伙伴研判处置路径，经双重审批后执行受控恢复，写入审计并通知值班负责人', promptDigest: 'sha256:demo', status: 'review_required', model: '企业默认模型', workspaceId: 'prod-ops', tenantId: 'tenant-prod-ops', ownerId: 'current-user', policyVersion: 'workflow-policy-v3', expiresAt: '2026-07-25T09:20:00Z', createdAt: '2026-07-18T09:20:00Z',
    workflow: { nodes: [
      { id: 'g1', kind: 'trigger', label: 'Redis OOM 告警', position: { x: 80, y: 120 }, description: '接收告警事件' },
      { id: 'g2', kind: 'retrieve', label: '检索处置 Runbook', position: { x: 300, y: 120 }, description: '查询处置规范' },
      { id: 'g3', kind: 'decision', label: '数字伙伴研判', position: { x: 520, y: 120 }, description: '判断是否需要扩容' },
      { id: 'g4', kind: 'approval', label: '双重审批', position: { x: 740, y: 120 }, description: '生产写操作需专家双重审批' },
      { id: 'g5', kind: 'execute', label: '执行受控恢复', position: { x: 960, y: 120 }, description: '调用已授权的 kubectl / redis-cli' },
      { id: 'g6', kind: 'audit', label: '写入审计记录', position: { x: 1180, y: 120 }, description: '记录完整证据链' },
      { id: 'g7', kind: 'notify', label: '通知值班负责人', position: { x: 1400, y: 120 }, description: '发送协同通知' },
    ], edges: [
      { id: 'ge1', source: 'g1', target: 'g2' }, { id: 'ge2', source: 'g2', target: 'g3' }, { id: 'ge3', source: 'g3', target: 'g4' },
      { id: 'ge4', source: 'g4', target: 'g5' }, { id: 'ge5', source: 'g5', target: 'g6' }, { id: 'ge6', source: 'g6', target: 'g7' },
    ] },
    checks: { structure: 'passed', dependencies: 'review', risk: 'review' },
    dependencies: [
      { type: 'tool', name: 'redis-cli', status: 'available' }, { type: 'mcp', name: 'kubernetes-mcp', status: 'missing', reason: '当前工作区未授权 kubectl 写权限' },
      { type: 'agent', name: '受控恢复数字伙伴', status: 'available' },
    ],
    risks: [{ level: 'L2', node: '执行受控恢复', text: '将对生产 Redis 执行写操作，需双重审批与回滚策略', requiresApproval: true }],
    warnings: ['执行受控恢复节点需要 kubernetes-mcp 写权限', '请专家在保存前补充回滚分支'], qualityScore: 86, requiresReview: true,
  },
];

export type OrchestrationDocSection = {
  id: string;
  heading: string;
  level: number;
  excerpt: string;
};

export type OrchestrationSessionDocument = {
  id: string;
  fileName: string;
  title: string;
  content: string;
  contentHash: string;
  charCount: number;
  summary: string;
  headings: string[];
  sections: OrchestrationDocSection[];
  source: 'upload' | 'knowledge';
  knowledgeDocId?: string;
  depositedKnowledgeDocId?: string;
  createdAt: string;
};

export type OrchestrationSessionMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  kind?: 'chat' | 'clarify' | 'generate' | 'patch' | 'retrieve' | 'template';
  status?: 'streaming' | 'completed';
  streamChunks?: string[];
  modelInvocation?: {
    provider: string;
    model: string;
    mode: 'orchestration';
    latencyMs: number;
    promptDigest: string;
    toolsUsed?: Array<{ name: string; input: string; output: string }>;
  };
};

export type OrchestrationWorkflowNode = {
  id: string;
  kind: string;
  label: string;
  position: { x: number; y: number };
  description?: string;
  sourceRef?: { documentId: string; heading: string; excerpt?: string };
};

export type OrchestrationCandidate = {
  id: string;
  version: number;
  label: string;
  createdAt: string;
  sourceMessageId?: string;
  workflow: { nodes: OrchestrationWorkflowNode[]; edges: Array<{ id: string; source: string; target: string }> };
  checks: WorkflowGenerationRecord['checks'];
  dependencies: WorkflowGenerationRecord['dependencies'];
  risks: WorkflowGenerationRecord['risks'];
  warnings: string[];
  qualityScore: number;
  requiresReview: boolean;
  changeSummary: string[];
};

export type OrchestrationTemplateCandidate = {
  id: string;
  sessionId: string;
  candidateId: string;
  name: string;
  description: string;
  status: 'pending_approval' | 'approved' | 'rejected';
  requestedBy: string;
  requestedAt: string;
  workspaceId: string;
  sequence: string[];
};

export type OrchestrationSession = {
  id: string;
  title: string;
  status: 'drafting' | 'ready' | 'applied' | 'discarded' | 'expired';
  workspaceId: string;
  tenantId: string;
  ownerId: string;
  model: string;
  policyVersion: string;
  constraints: { riskLevel: 'L1' | 'L2' | 'L3'; requireApproval: boolean; requireAudit: boolean; requireRollback: boolean };
  goal: string;
  documents: OrchestrationSessionDocument[];
  messages: OrchestrationSessionMessage[];
  candidates: OrchestrationCandidate[];
  activeCandidateId?: string;
  appliedRevisionId?: string;
  templateCandidate?: OrchestrationTemplateCandidate;
  lastRetrieve?: { query: string; hits: Array<{ docId: string; title: string; excerpt: string; score: number }>; at: string };
  clarificationSkipped: boolean;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export const mockOrchestrationSessions: OrchestrationSession[] = [];
export const mockOrchestrationTemplateCandidates: OrchestrationTemplateCandidate[] = [];

function parseMarkdownDocument(fileName: string, content: string, source: 'upload' | 'knowledge' = 'upload', knowledgeDocId?: string): Omit<OrchestrationSessionDocument, 'id' | 'createdAt'> {
  const safe = content.slice(0, 80_000);
  const headingMatches = Array.from(safe.matchAll(/^(#{1,3})\s+(.+)$/gm));
  const headings = headingMatches.map((match) => match[2].trim()).slice(0, 12);
  const sections: OrchestrationDocSection[] = headingMatches.slice(0, 12).map((match, index) => {
    const start = match.index ?? 0;
    const next = headingMatches[index + 1]?.index ?? Math.min(safe.length, start + 420);
    const body = safe.slice(start, next).replace(/^#.+$/m, '').replace(/\s+/g, ' ').trim().slice(0, 180);
    return {
      id: `sec_${index + 1}`,
      heading: match[2].trim(),
      level: match[1].length,
      excerpt: body || '（该章节暂无正文摘要）',
    };
  });
  const title = headings[0] || fileName.replace(/\.md$/i, '') || '未命名文档';
  const summary = safe
    .replace(/^#.+$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
  return {
    fileName,
    title,
    content: safe,
    contentHash: generationDigest(safe),
    charCount: safe.length,
    summary: summary || '文档已解析，可与业务目标一并提交模型编排。',
    headings,
    sections,
    source,
    knowledgeDocId,
  };
}

function rebuildCandidateEdges(nodes: OrchestrationWorkflowNode[]) {
  return nodes.slice(1).map((node, index) => ({ id: `ge${index + 1}`, source: nodes[index].id, target: node.id }));
}

function attachSourceRefs(nodes: OrchestrationWorkflowNode[], documents: OrchestrationSessionDocument[]) {
  if (!documents.length) return nodes;
  const sections = documents.flatMap((doc) => doc.sections.map((section) => ({ documentId: doc.id, ...section })));
  return nodes.map((node, index) => {
    const section = sections[index % Math.max(sections.length, 1)];
    if (!section) return node;
    return {
      ...node,
      sourceRef: { documentId: section.documentId, heading: section.heading, excerpt: section.excerpt },
      description: node.description ? `${node.description}（依据 § ${section.heading}）` : `依据文档章节 § ${section.heading}`,
    };
  });
}

function buildOrchestrationCandidate(session: OrchestrationSession, sourceMessageId?: string): OrchestrationCandidate {
  const docContext = session.documents.map((doc) => `${doc.title}\n${doc.summary}\n${doc.sections.map((section) => section.heading).join(' ')}`).join('\n');
  const retrieveContext = session.lastRetrieve?.hits.map((hit) => hit.excerpt).join('\n') ?? '';
  const prompt = [session.goal, docContext, retrieveContext, ...session.messages.filter((item) => item.role === 'user').map((item) => item.content)].filter(Boolean).join('\n');
  const generated = buildGeneratedWorkflow(prompt || '告警触发后由数字伙伴研判并通知值班');
  let nodes: OrchestrationWorkflowNode[] = generated.nodes.map((node) => ({ ...node }));
  const hasExternalWrite = nodes.some((node) => ['execute', 'http', 'mcp'].includes(node.kind));
  if (session.constraints.requireApproval && hasExternalWrite && !nodes.some((node) => node.kind === 'approval')) {
    nodes.splice(Math.max(nodes.length - 3, 1), 0, { id: `g_appr_${nodes.length}`, kind: 'approval', label: '双重审批', position: { x: 900, y: 120 }, description: '高风险动作需专家双重审批' });
  }
  if (session.constraints.requireRollback && hasExternalWrite && !nodes.some((node) => node.kind === 'compensate')) {
    const executeIndex = nodes.findIndex((node) => node.kind === 'execute');
    nodes.splice(executeIndex >= 0 ? executeIndex + 1 : nodes.length - 1, 0, { id: `g_rb_${nodes.length}`, kind: 'compensate', label: '补偿回滚', position: { x: 1100, y: 120 }, description: '执行失败时回滚可逆变更' });
  }
  nodes = attachSourceRefs(nodes, session.documents);
  const edges = rebuildCandidateEdges(nodes);
  const dependencies = hasExternalWrite
    ? [{ type: 'tool' as const, name: '受控执行 Skill', status: 'available' as const }, { type: 'mcp' as const, name: 'kubernetes-mcp', status: 'missing' as const, reason: '当前工作区未授权写权限' }, { type: 'agent' as const, name: '受控恢复数字伙伴', status: 'available' as const }]
    : [{ type: 'agent' as const, name: '数字伙伴编排器', status: 'available' as const }];
  const previous = session.candidates[0];
  const version = (previous?.version ?? 0) + 1;
  const changeSummary = previous
    ? [
        `相对 ${previous.label}：节点 ${previous.workflow.nodes.length} → ${nodes.length}`,
        session.constraints.requireApproval ? '已按约束保留双重审批门禁' : '用户关闭双重审批偏好（写操作仍可能被结构门禁拦截）',
        session.documents.length ? `已引用 ${session.documents.length} 份文档依据（含章节引用）` : '未附带文档，仅依据对话目标',
        session.lastRetrieve ? `已使用 Runbook 检索 ${session.lastRetrieve.hits.length} 条` : '未调用 Runbook 检索工具',
      ]
    : [
        '已由企业模型路由生成首版草稿示例',
        session.clarificationSkipped ? '用户选择跳过澄清，直接出示例' : '可在对话中继续补充修正',
        '节点已挂载 Markdown 章节引用（如有）',
        '应用后进入隔离草稿，不会自动执行或发布',
      ];
  return {
    id: mockId('cand'),
    version,
    label: `示例 v${version}`,
    createdAt: new Date().toISOString(),
    sourceMessageId,
    workflow: { nodes, edges },
    checks: { structure: 'passed', dependencies: dependencies.some((item) => item.status === 'missing') ? 'review' : 'passed', risk: hasExternalWrite ? 'review' : 'passed' },
    dependencies,
    risks: hasExternalWrite ? [{ level: session.constraints.riskLevel === 'L3' ? 'L3' : 'L2', node: '执行受控动作', text: '外部写入操作必须通过策略、双重审批、回滚和权限检查', requiresApproval: true }] : [],
    warnings: [
      '草稿示例需专家复核后才可应用为隔离草稿',
      '审计留痕由工作区策略强制开启',
      ...(hasExternalWrite ? ['执行节点需匹配工作区权限后才能试运行'] : []),
    ],
    qualityScore: hasExternalWrite ? 84 : 91,
    requiresReview: true,
    changeSummary,
  };
}

function chunkAssistantText(text: string) {
  const parts: string[] = [];
  const size = Math.max(12, Math.ceil(text.length / 5));
  for (let index = 0; index < text.length; index += size) parts.push(text.slice(index, index + size));
  return parts.length ? parts : [text];
}

function invokeOrchestrationModel(session: OrchestrationSession, userContent: string, mode: 'chat' | 'clarify' | 'generate' | 'retrieve') {
  const started = Date.now();
  const promptDigest = generationDigest(`${session.model}:${userContent}:${session.documents.map((doc) => doc.contentHash).join(',')}:${session.lastRetrieve?.query ?? ''}`);
  const latencyMs = 180 + (userContent.length % 120);
  const toolsUsed: Array<{ name: string; input: string; output: string }> = [];
  if (mode === 'retrieve' || (mode === 'generate' && /redis|oom|runbook|告警|证书/i.test(`${session.goal}${userContent}`))) {
    toolsUsed.push({
      name: 'knowledge.retrieve_runbook',
      input: userContent || session.goal,
      output: session.lastRetrieve?.hits.map((hit) => `${hit.title}: ${hit.excerpt}`).join(' | ') || '暂无检索命中，将仅依据会话目标生成',
    });
  }
  const invocation = {
    provider: 'enterprise-model-router',
    model: session.model,
    mode: 'orchestration' as const,
    latencyMs,
    promptDigest,
    toolsUsed: toolsUsed.length ? toolsUsed : undefined,
  };
  if (mode === 'clarify') {
    const gaps: string[] = [];
    if (!/审批|双重/.test(`${session.goal}${userContent}`)) gaps.push('写操作是否需要双重审批？');
    if (!/回滚|补偿/.test(`${session.goal}${userContent}`)) gaps.push('失败时如何回滚或补偿？');
    if (!/通知|值班|负责人/.test(`${session.goal}${userContent}`)) gaps.push('结果通知给谁？');
    const content = gaps.length
      ? `我可以根据文档与目标直接出示例。若你愿意补充，可先回答：\n${gaps.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\n也可跳过澄清，点击「一键生成示例」。`
      : '关键信息已较完整。可继续补充细节，或直接「一键生成示例」。';
    return { content, invocation, streamChunks: chunkAssistantText(content), elapsed: Date.now() - started };
  }
  if (mode === 'retrieve') {
    const content = session.lastRetrieve?.hits.length
      ? `已通过模型路由调用 Runbook 检索，命中 ${session.lastRetrieve.hits.length} 条：\n${session.lastRetrieve.hits.map((hit, index) => `${index + 1}. ${hit.title}（${hit.score.toFixed(2)}）`).join('\n')}\n可继续一键生成示例。`
      : '已调用 Runbook 检索，暂无高相关命中；仍可依据业务目标生成示例。';
    return { content, invocation, streamChunks: chunkAssistantText(content), elapsed: Date.now() - started };
  }
  if (mode === 'generate') {
    const content = `已通过「${session.model}」生成可编辑草稿示例${toolsUsed.length ? '（含 Runbook 检索工具）' : ''}。请在右侧核对节点、章节引用与风险；可切换历史示例、结构化微调，或创建隔离草稿。生成结果不会自动执行、发布或覆盖线上流程。`;
    return { content, invocation, streamChunks: chunkAssistantText(content), elapsed: Date.now() - started };
  }
  const content = '已记录你的补充。可继续说明差异，或点击「一键生成示例 / 按对话更新示例」让模型基于最新上下文重算草稿。';
  return { content, invocation, streamChunks: chunkAssistantText(content), elapsed: Date.now() - started };
}

function patchOrchestrationCandidate(candidate: OrchestrationCandidate, patch: { removeNodeId?: string; rename?: { nodeId: string; label: string }; move?: { nodeId: string; direction: 'up' | 'down' } }) {
  const nodes = candidate.workflow.nodes.map((node) => ({ ...node }));
  const summary: string[] = [];
  if (patch.removeNodeId) {
    const index = nodes.findIndex((node) => node.id === patch.removeNodeId);
    if (index < 0) throw new Error('节点不存在');
    if (['approval', 'audit'].includes(nodes[index].kind)) throw new Error('双重审批与审计节点不可直接删除，请通过约束或画布配置调整');
    const [removed] = nodes.splice(index, 1);
    summary.push(`已删除节点「${removed.label}」`);
  }
  if (patch.rename) {
    const node = nodes.find((item) => item.id === patch.rename!.nodeId);
    if (!node) throw new Error('节点不存在');
    const nextLabel = patch.rename.label.trim().slice(0, 40);
    if (!nextLabel) throw new Error('节点名称不能为空');
    summary.push(`已将「${node.label}」重命名为「${nextLabel}」`);
    node.label = nextLabel;
  }
  if (patch.move) {
    const index = nodes.findIndex((node) => node.id === patch.move!.nodeId);
    if (index < 0) throw new Error('节点不存在');
    const target = patch.move.direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= nodes.length) throw new Error('已到边界，无法继续调整顺序');
    const [item] = nodes.splice(index, 1);
    nodes.splice(target, 0, item);
    summary.push(`已${patch.move.direction === 'up' ? '上移' : '下移'}节点「${item.label}」`);
  }
  if (!summary.length) throw new Error('未提供有效的结构化调整');
  const version = candidate.version; // patch creates new candidate with bumped version outside
  return {
    nodes,
    edges: rebuildCandidateEdges(nodes),
    summary,
    version,
  };
}

  // ============ P7 知识扩展数据 ============

export const mockKbList = [
  { key: 'runbook', label: 'Runbook 知识库', count: 86, source: 'Runbook' },
  { key: 'cmdb', label: 'CMDB 资产', count: 1280, source: 'CMDB' },
  { key: 'cve', label: 'CVE 漏洞库', count: 620, source: 'CVE' },
  { key: 'siem', label: 'SIEM 检测用例', count: 380, source: 'SIEM' },
];

export const mockDocDetail = {
  id: 'k1',
  title: 'Redis 故障 Runbook v3.2',
  source: 'Runbook',
  author: '李婷',
  updatedAt: '2026-07-10',
  size: '124 KB',
  chunks: 86,
  version: 'v3.2',
  content: '# Redis 故障 Runbook\n\n## §3.1 OOM 处理\n\n当 Redis 触发 `maxmemory` 限制时，优先检查 `maxmemory-policy` 与最近写入速率；建议在维护窗口执行 `volatile-lru` 切换。\n\n> 生产变更需完成双重审批，并在变更窗口内保留回滚预案。\n\n### 步骤\n\n1. **检测**：监控指标 `used_memory` 与 `maxmemory` 比值\n2. **评估**：判断是否有大 Key 写入（>100MB）\n3. **方案**：临时扩容 OR 切换 LRU 策略\n4. **执行**：`CONFIG SET maxmemory-policy volatile-lru`\n5. **验证**：观察 5min 内 OOM 频率下降\n\n### 历史事件\n\n- 2026-05-22 INC-019：使用 volatile-lru，耗时 38min\n- 2026-04-08 INC-011：临时扩容到 16GB，耗时 22min',
};

export const mockSearchHistory = [
  { id: 'h1', time: '14:28', query: 'Redis OOM 处理', kb: 'Runbook', results: 8, topScore: 0.92 },
  { id: 'h2', time: '14:18', query: 'CVE-2026-3321 影响哪些资产', kb: 'CVE', results: 12, topScore: 0.88 },
  { id: 'h3', time: '13:55', query: '容量预测算法', kb: 'Runbook', results: 6, topScore: 0.79 },
  { id: 'h4', time: '13:42', query: 'K8s 节点扩容', kb: 'Runbook', results: 9, topScore: 0.85 },
];

export const mockCitationTrace = [
  { docId: 'k1', title: 'Redis 故障 Runbook v3.2', citeCount: 320, lastUsed: '2026-07-13', usedBy: ['夜航 · SRE 故障处置专员', '磐石 · 变更协同专员', '42 次任务'] },
  { docId: 'k2', title: 'CMDB 全量资产清单', citeCount: 1280, lastUsed: '2026-07-13', usedBy: ['夜航 · SRE 故障处置专员', '观星 · 告警运营专员', '215 次任务'] },
];

export const mockEvalMetrics = {
  recall: 92,
  precision: 88,
  p95Latency: 320,
  hitRate: 32,
  recallAtK: 0.92,
  citationAccuracy: 0.88,
};

export const mockKnowledgeDocs: KnowledgeDoc[] = [
  { id: 'k1', title: 'Redis 故障 Runbook v3.2', source: 'Runbook', sizeKb: 128, chunks: 86, citeCount: 320, status: 'ready', updatedAt: '2026-07-10T00:00:00Z' },
  { id: 'k2', title: 'CMDB 全量资产清单', source: 'CMDB', sizeKb: 2048, chunks: 1280, citeCount: 1280, status: 'ready', updatedAt: '2026-07-19T00:00:00Z' },
  { id: 'k3', title: 'CVE-2026 漏洞库', source: 'CVE', sizeKb: 840, chunks: 620, citeCount: 88, status: 'ready', updatedAt: '2026-07-12T00:00:00Z' },
  { id: 'k4', title: 'K8s 节点运维手册', source: 'Runbook', sizeKb: 320, chunks: 210, citeCount: 156, status: 'ready', updatedAt: '2026-07-05T00:00:00Z' },
  { id: 'k5', title: '等保 3 合规白皮书', source: '合规', sizeKb: 1240, chunks: 580, citeCount: 240, status: 'ready', updatedAt: '2026-06-28T00:00:00Z' },
  { id: 'k6', title: 'Prometheus 告警规则', source: 'Runbook', sizeKb: 96, chunks: 72, citeCount: 110, status: 'indexing', updatedAt: '2026-07-13T01:00:00Z' },
  { id: 'k7', title: '网关灰度发布流程', source: 'Runbook', sizeKb: 64, chunks: 48, citeCount: 78, status: 'ready', updatedAt: '2026-07-02T00:00:00Z' },
  { id: 'k8', title: 'ATT&CK 检测用例', source: 'SIEM', sizeKb: 540, chunks: 380, citeCount: 95, status: 'ready', updatedAt: '2026-07-09T00:00:00Z' },
];
mockKnowledgeDocs.forEach((doc, index) => Object.assign(doc, {
  workspaceId: doc.id === 'k3' || doc.id === 'k6' ? 'w2' : doc.id === 'k7' ? 'w3' : 'w1',
  ownerId: doc.id === 'k7' ? 'u3' : 'u1',
  classification: doc.id === 'k2' || doc.id === 'k3' || doc.id === 'k8' ? 'restricted' : 'internal',
  correlationId: `corr_knowledge_${doc.id}`,
}));
// Align package membership for primary workspace fixtures.
Object.assign(mockKnowledgeDocs.find((d) => d.id === 'k1')!, { packageId: 'kp-runbook' });
Object.assign(mockKnowledgeDocs.find((d) => d.id === 'k2')!, { packageId: 'kp-cmdb' });
Object.assign(mockKnowledgeDocs.find((d) => d.id === 'k4')!, { packageId: 'kp-runbook' });
Object.assign(mockKnowledgeDocs.find((d) => d.id === 'k5')!, { packageId: 'kp-runbook' });
Object.assign(mockKnowledgeDocs.find((d) => d.id === 'k8')!, { packageId: 'kp-security' });

export const mockKnowledgeChunks: KnowledgeRetrievalResult[] = [
  { idx: 1, source: 'Redis Runbook v3.2 §3.1', page: 12, score: 0.92, docId: 'k1', text: '当触发 OOM 时，优先检查 maxmemory-policy 与最近写入速率；建议在维护窗口执行 volatile-lru 切换。' },
  { idx: 2, source: 'CMDB PRD-CACHE-019', page: null, score: 0.78, docId: 'k2', text: 'prod-redis-01 资产编号 PRD-CACHE-019，归属 ACME 生产集群，cn-east-1 区，双实例主从。' },
  { idx: 3, source: 'INC-019 处理记录', page: 5, score: 0.71, docId: 'k3', text: '历史类似事件在 2026-05-22 处置耗时 38min，使用 CONFIG SET 临时扩容与后续策略调整。' },
  { idx: 4, source: 'Prometheus 告警规则', page: null, score: 0.65, docId: 'k6', text: 'rate(redis_oom_total[5m]) > 3 时触发 P0 告警，持续 10 分钟自动升级。' },
  { idx: 5, source: '网关灰度发布流程', page: 8, score: 0.58, docId: 'k7', text: 'Redis 升级必须在维护窗口执行，建议使用灰度发布与双实例验证。' },
];

export const mockKnowledgeSources: KnowledgeSourceConnection[] = [
  { id: 'source-runbook', name: 'Runbook 文档中心', kind: 'Git / Markdown', schedule: '每 6 小时', endpoint: 'git@github.com:acme/runbooks.git', lastSync: '12 分钟前', documents: 86, status: 'healthy' },
  { id: 'source-cmdb', name: 'CMDB 资产目录', kind: 'REST API', schedule: '每 30 分钟', endpoint: 'https://cmdb.example.com/api/v1/assets', lastSync: '4 分钟前', documents: 1280, status: 'healthy' },
  { id: 'source-siem', name: 'SIEM 检测规则', kind: 'Webhook', schedule: '事件推送', endpoint: '/hooks/knowledge/w3/wh-siem', lastSync: '同步失败 · 36 分钟前', documents: 380, status: 'attention' },
];
(mockSearchHistory as any[]).forEach((item, index) => Object.assign(item, { workspaceId: index === 1 || index === 3 ? 'w2' : 'w1' }));
(mockCitationTrace as any[]).forEach((item) => Object.assign(item, { workspaceId: item.docId === 'k3' ? 'w2' : 'w1' }));
(mockKnowledgeChunks as any[]).forEach((item) => Object.assign(item, { workspaceId: item.docId === 'k3' || item.docId === 'k6' ? 'w2' : item.docId === 'k7' ? 'w3' : 'w1' }));
(mockKnowledgeSources as any[]).forEach((item, index) => Object.assign(item, { workspaceId: index === 2 ? 'w3' : 'w1' }));

export const mockKnowledgeGovernance: KnowledgeGovernancePolicy = {
  sensitiveDataDetection: true,
  versionRetention: true,
  retentionDays: 365,
  highRiskChangeApproval: true,
};

// 知识工程中心的领域状态：知识包是唯一可被运行时消费者绑定的交付物。
export const mockKnowledgePackages: KnowledgePackage[] = [
  {
    id: 'kp-runbook', name: '生产故障处置知识包', description: 'Redis、K8s 与告警处置 Runbook 的受控知识集合。', domain: 'SRE', classification: 'restricted', owner: 'SRE 平台组', status: 'published', documentCount: 3, documentIds: ['k1', 'k4', 'k5'], consumers: 5,
    currentVersion: { id: 'kpv-runbook-32', version: 'v3.2', status: 'published', indexVersion: 'idx-20260718-02', publishedAt: '2026-07-18T09:30:00Z', qualityScore: 94, changeSummary: '补齐 Redis OOM 处置与双签步骤' },
    versions: [
      { id: 'kpv-runbook-32', version: 'v3.2', status: 'published', indexVersion: 'idx-20260718-02', publishedAt: '2026-07-18T09:30:00Z', qualityScore: 94, changeSummary: '补齐 Redis OOM 处置与双签步骤' },
      { id: 'kpv-runbook-31', version: 'v3.1', status: 'deprecated', indexVersion: 'idx-20260702-01', publishedAt: '2026-07-02T09:30:00Z', qualityScore: 91, changeSummary: '上一个稳定版本' },
    ],
  },
  {
    id: 'kp-cmdb', name: '生产资产与依赖知识包', description: '受权限过滤的 CMDB 资产、服务依赖与负责人信息。', domain: 'IT 运营', classification: 'confidential', owner: '基础架构组', status: 'published', documentCount: 1, documentIds: ['k2'], consumers: 3,
    currentVersion: { id: 'kpv-cmdb-18', version: 'v1.8', status: 'published', indexVersion: 'idx-20260719-01', publishedAt: '2026-07-19T06:10:00Z', qualityScore: 92, changeSummary: '同步生产服务依赖关系' },
    versions: [{ id: 'kpv-cmdb-18', version: 'v1.8', status: 'published', indexVersion: 'idx-20260719-01', publishedAt: '2026-07-19T06:10:00Z', qualityScore: 92, changeSummary: '同步生产服务依赖关系' }],
  },
  {
    id: 'kp-security', name: '安全漏洞处置知识包', description: 'CVE、加固基线与漏洞修复流程。', domain: '安全', classification: 'restricted', owner: '安全运营组', status: 'published', documentCount: 1, documentIds: ['k8'], consumers: 2,
    currentVersion: { id: 'kpv-security-14', version: 'v1.4', status: 'published', indexVersion: 'idx-20260719-03', publishedAt: '2026-07-19T09:00:00Z', qualityScore: 88, changeSummary: '新增 CVE-2026 风险与修复依据' },
    versions: [{ id: 'kpv-security-14', version: 'v1.4', status: 'published', indexVersion: 'idx-20260719-03', publishedAt: '2026-07-19T09:00:00Z', qualityScore: 88, changeSummary: '新增 CVE-2026 风险与修复依据' }],
  },
  {
    id: 'kp-draft-review', name: '草稿待发布知识包', description: '用于验证未发布版本不可绑定。', domain: '演示', classification: 'internal', owner: '平台组', status: 'review', documentCount: 0, documentIds: [], consumers: 0,
    currentVersion: { id: 'kpv-draft-01', version: 'v0.1', status: 'review', indexVersion: 'idx-draft-01', qualityScore: 70, changeSummary: '尚未发布' },
    versions: [{ id: 'kpv-draft-01', version: 'v0.1', status: 'review', indexVersion: 'idx-draft-01', qualityScore: 70, changeSummary: '尚未发布' }],
  },
  {
    id: 'kp.office.handbook', workspaceId: 'w1', name: '员工手册与制度问答', description: '办公开箱：员工手册摘要与 FAQ', domain: '办公', classification: 'internal', owner: '平台内置', ownerId: 'u1', status: 'published', documentCount: 2, documentIds: [], consumers: 0,
    currentVersion: { id: 'kpv-office-handbook-1', version: '1.0.0', status: 'published', indexVersion: 'idx-office-1', publishedAt: '2026-08-21T00:00:00Z', qualityScore: 90, changeSummary: '办公开箱首发' },
    versions: [{ id: 'kpv-office-handbook-1', version: '1.0.0', status: 'published', indexVersion: 'idx-office-1', publishedAt: '2026-08-21T00:00:00Z', qualityScore: 90, changeSummary: '办公开箱首发' }],
  },
  {
    id: 'kp.office.meeting', workspaceId: 'w1', name: '会议与纪要规范', description: '办公开箱：会议纪要必填项与分发规则', domain: '办公', classification: 'internal', owner: '平台内置', ownerId: 'u1', status: 'published', documentCount: 2, documentIds: [], consumers: 0,
    currentVersion: { id: 'kpv-office-meeting-1', version: '1.0.0', status: 'published', indexVersion: 'idx-office-1', publishedAt: '2026-08-21T00:00:00Z', qualityScore: 90, changeSummary: '办公开箱首发' },
    versions: [{ id: 'kpv-office-meeting-1', version: '1.0.0', status: 'published', indexVersion: 'idx-office-1', publishedAt: '2026-08-21T00:00:00Z', qualityScore: 90, changeSummary: '办公开箱首发' }],
  },
  {
    id: 'kp.office.writing', workspaceId: 'w1', name: '公文与材料规范', description: '办公开箱：周报/通知写作规范', domain: '办公', classification: 'internal', owner: '平台内置', ownerId: 'u1', status: 'published', documentCount: 2, documentIds: [], consumers: 0,
    currentVersion: { id: 'kpv-office-writing-1', version: '1.0.0', status: 'published', indexVersion: 'idx-office-1', publishedAt: '2026-08-21T00:00:00Z', qualityScore: 90, changeSummary: '办公开箱首发' },
    versions: [{ id: 'kpv-office-writing-1', version: '1.0.0', status: 'published', indexVersion: 'idx-office-1', publishedAt: '2026-08-21T00:00:00Z', qualityScore: 90, changeSummary: '办公开箱首发' }],
  },
  {
    id: 'kp.office.leave_travel', workspaceId: 'w1', name: '假勤与差旅标准', description: '办公开箱：假勤与差旅摘要', domain: '办公', classification: 'internal', owner: '平台内置', ownerId: 'u1', status: 'published', documentCount: 2, documentIds: [], consumers: 0,
    currentVersion: { id: 'kpv-office-leave-1', version: '1.0.0', status: 'published', indexVersion: 'idx-office-1', publishedAt: '2026-08-21T00:00:00Z', qualityScore: 90, changeSummary: '办公开箱首发' },
    versions: [{ id: 'kpv-office-leave-1', version: '1.0.0', status: 'published', indexVersion: 'idx-office-1', publishedAt: '2026-08-21T00:00:00Z', qualityScore: 90, changeSummary: '办公开箱首发' }],
  },
  {
    id: 'kp.office.expense_lite', workspaceId: 'w1', name: '报销常识（轻量）', description: '办公开箱：报销自查与不可报项', domain: '办公', classification: 'internal', owner: '平台内置', ownerId: 'u1', status: 'published', documentCount: 2, documentIds: [], consumers: 0,
    currentVersion: { id: 'kpv-office-expense-1', version: '1.0.0', status: 'published', indexVersion: 'idx-office-1', publishedAt: '2026-08-21T00:00:00Z', qualityScore: 90, changeSummary: '办公开箱首发' },
    versions: [{ id: 'kpv-office-expense-1', version: '1.0.0', status: 'published', indexVersion: 'idx-office-1', publishedAt: '2026-08-21T00:00:00Z', qualityScore: 90, changeSummary: '办公开箱首发' }],
  },
  {
    id: 'kp.office.it_selfservice', workspaceId: 'w1', name: 'IT 自助服务', description: '办公开箱：密码重置与权限自助说明', domain: '办公', classification: 'internal', owner: '平台内置', ownerId: 'u1', status: 'published', documentCount: 2, documentIds: [], consumers: 0,
    currentVersion: { id: 'kpv-office-it-1', version: '1.0.0', status: 'published', indexVersion: 'idx-office-1', publishedAt: '2026-08-21T00:00:00Z', qualityScore: 90, changeSummary: '办公开箱首发' },
    versions: [{ id: 'kpv-office-it-1', version: '1.0.0', status: 'published', indexVersion: 'idx-office-1', publishedAt: '2026-08-21T00:00:00Z', qualityScore: 90, changeSummary: '办公开箱首发' }],
  },
];

mockKnowledgePackages.forEach((item, index) => Object.assign(item, {
  workspaceId: 'w1',
  ownerId: index === 1 ? 'u2' : 'u1',
  environment: index === 1 ? 'staging' : 'production',
}));

export const mockKnowledgeProcessingJobs: KnowledgeProcessingJob[] = [
  { id: 'kpj-01', packageId: 'kp-runbook', source: 'Runbook 文档中心', strategy: 'structured', status: 'succeeded', documentCount: 42, chunkCount: 1260, indexVersion: 'idx-20260718-02', startedAt: '2026-07-18T09:12:00Z' },
  { id: 'kpj-02', packageId: 'kp-cmdb', source: 'CMDB 资产目录', strategy: 'table', status: 'running', documentCount: 1280, chunkCount: 4820, indexVersion: 'idx-20260719-01', startedAt: '2026-07-19T06:00:00Z' },
  { id: 'kpj-03', packageId: 'kp-security', source: 'SIEM 检测规则', strategy: 'semantic', status: 'failed', documentCount: 26, chunkCount: 630, indexVersion: 'idx-20260719-03', startedAt: '2026-07-19T08:40:00Z', error: '3 个 PDF 未能完成 OCR 解析' },
];

export const mockKnowledgeProfiles: KnowledgeRetrievalProfile[] = [
  { id: 'krp-ops', name: '生产处置混合检索', packageId: 'kp-runbook', retrievalModes: ['keyword', 'vector', 'graph'], topK: 6, rerankEnabled: true, noResultPolicy: 'handoff' },
  { id: 'krp-cmdb', name: '资产精确检索', packageId: 'kp-cmdb', retrievalModes: ['keyword', 'graph'], topK: 5, rerankEnabled: false, noResultPolicy: 'clarify' },
];

export const mockKnowledgeEvaluations: KnowledgeEvaluation[] = [
  { id: 'keval-01', packageId: 'kp-runbook', profileId: 'krp-ops', baselineVersion: 'v3.1', evaluatedVersion: 'v3.2', recallAtK: 0.94, mrr: 0.89, ndcg: 0.91, citationAccuracy: 0.97, p95LatencyMs: 338, status: 'passed', evaluatedAt: '2026-07-18T09:20:00Z' },
  { id: 'keval-02', packageId: 'kp-security', profileId: 'krp-ops', baselineVersion: 'v1.3', evaluatedVersion: 'v1.4', recallAtK: 0.86, mrr: 0.78, ndcg: 0.80, citationAccuracy: 0.91, p95LatencyMs: 462, status: 'needs_review', evaluatedAt: '2026-07-19T08:55:00Z' },
];

export const mockKnowledgeGraphEntities: KnowledgeGraphEntity[] = [
  { id: 'kge-redis', name: 'redis-prod-01', type: 'asset', confidence: 0.99, sourceDocId: 'k1', sourceVersion: 'v3.2' },
  { id: 'kge-api', name: '订单 API', type: 'service', confidence: 0.96, sourceDocId: 'k2', sourceVersion: 'v1.8' },
  { id: 'kge-runbook', name: 'Redis OOM 处置 Runbook', type: 'runbook', confidence: 0.98, sourceDocId: 'k1', sourceVersion: 'v3.2' },
  { id: 'kge-owner', name: 'SRE 值班组', type: 'owner', confidence: 0.99, sourceDocId: 'k1', sourceVersion: 'v3.2' },
  { id: 'kge-cve', name: 'CVE-2026-1042', type: 'vulnerability', confidence: 0.93, sourceDocId: 'k3', sourceVersion: 'v1.4' },
];

export const mockKnowledgeGraphRelations: KnowledgeGraphRelation[] = [
  { id: 'kgr-01', fromId: 'kge-api', toId: 'kge-redis', type: 'depends_on', confidence: 0.96, sourceDocId: 'k2', sourceVersion: 'v1.8' },
  { id: 'kgr-02', fromId: 'kge-redis', toId: 'kge-runbook', type: 'handled_by', confidence: 0.98, sourceDocId: 'k1', sourceVersion: 'v3.2' },
  { id: 'kgr-03', fromId: 'kge-runbook', toId: 'kge-owner', type: 'owned_by', confidence: 0.99, sourceDocId: 'k1', sourceVersion: 'v3.2' },
  { id: 'kgr-04', fromId: 'kge-cve', toId: 'kge-redis', type: 'impacts', confidence: 0.89, sourceDocId: 'k3', sourceVersion: 'v1.4' },
];

export const mockKnowledgeBindings: KnowledgeConsumerBinding[] = [
  { id: 'kcb-01', packageId: 'kp-runbook', packageName: '生产故障处置知识包', packageVersion: 'v3.2', consumerType: 'digital_employee', consumerId: 'de-sre', consumerName: '夜航 · SRE 故障处置专员', environment: 'production', profileId: 'krp-ops', noResultPolicy: 'handoff' },
  { id: 'kcb-02', packageId: 'kp-runbook', packageName: '生产故障处置知识包', packageVersion: 'v3.2', consumerType: 'workflow', consumerId: 'wf1', consumerName: 'cache-oom 受控恢复', environment: 'production', profileId: 'krp-ops', noResultPolicy: 'block' },
  { id: 'kcb-03', packageId: 'kp-cmdb', packageName: '生产资产与依赖知识包', packageVersion: 'v1.8', consumerType: 'digital_employee', consumerId: 'de-change', consumerName: '磐石 · 变更协同专员', environment: 'staging', profileId: 'krp-cmdb', noResultPolicy: 'clarify' },
];
mockKnowledgeBindings.forEach((item) => Object.assign(item, {
  workspaceId: 'w1',
  correlationId: `corr_knowledge_binding_${item.id}`,
}));

export const mockKnowledgeAudit: KnowledgeAuditEvent[] = [
  { id: 'knowledge_audit_1', time: '14:32:10', actor: '李婷', action: '知识同步完成', target: 'Runbook 文档中心', result: 'success' },
  { id: 'knowledge_audit_2', time: '13:40:02', actor: '数字伙伴', action: '检索验证', target: 'Redis OOM 处理', result: 'success' },
];

function appendKnowledgeAudit(action: string, target: string, result: KnowledgeAuditEvent['result'] = 'success') {
  const event: KnowledgeAuditEvent = { id: mockId('knowledge_audit'), time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), actor: '当前用户', action, target, result };
  mockKnowledgeAudit.unshift(event);
  return event;
}

const knowledgeDocContents = new Map<string, string>();

function knowledgeDocDetail(doc: KnowledgeDoc) {
  const ownerLabels: Record<string, string> = { u1: '平台管理员', u2: '业务构建者', u3: '合规审计员' };
  const versionMatch = doc.title.match(/v[\d.]+/i);
  const version = versionMatch?.[0] ?? 'v1.0';
  const author = ownerLabels[doc.ownerId ?? 'u1'] ?? '未指定责任人';
  const stored = knowledgeDocContents.get(doc.id);
  return {
    id: doc.id,
    title: doc.title,
    source: doc.source,
    author,
    updatedAt: doc.updatedAt.slice(0, 10),
    size: `${doc.sizeKb} KB`,
    chunks: doc.chunks,
    version,
    status: doc.status,
    citeCount: doc.citeCount,
    tags: doc.source === 'Runbook' ? ['redis', 'oom', '生产环境'] : [doc.source, '企业知识'],
    classification: doc.classification === 'restricted' ? '受限' : doc.classification === 'confidential' ? '机密' : '内部',
    chunkStrategy: doc.source === 'CMDB' ? '表格切片' : '结构切片',
    quality: { completeness: 96, freshness: 92, citationAccuracy: 97 },
    versions: [{ version, time: doc.updatedAt.slice(0, 10), note: '当前发布版本' }, { version: 'v3.1', time: '2026-06-18', note: '补充处置步骤与引用证据' }],
    content: stored
      ?? (doc.id === 'k1' ? mockDocDetail.content : `# ${doc.title}\n\n该知识资产由企业知识运营工作台管理，已纳入版本、权限和引用审计。`),
  };
}

// ============ P8 技能扩展数据 ============

export interface SkillTestCase {
  name: string;
  input: string;
  output: string;
  durationMs: number;
  status: 'success' | 'failed';
}

export const mockSkillExecTrace = {
  s1: {
    trace: [
      { ts: '14:28:01.023', level: 'info', text: 'redis-cli CONFIG SET maxmemory 16GB' },
      { ts: '14:28:01.045', level: 'debug', text: '连接 prod-redis-01:6379' },
      { ts: '14:28:01.123', level: 'info', text: '执行 SET 命令' },
      { ts: '14:28:01.168', level: 'info', text: '响应: +OK (45ms)' },
      { ts: '14:28:01.170', level: 'info', text: '输出已写入审计日志 SignedLog' },
    ],
    testCases: [
      { name: '正常调用', input: 'CONFIG SET maxmemory 16GB', output: '+OK', durationMs: 45, status: 'success' },
      { name: '无效参数', input: 'CONFIG SET invalid', output: '(error) ERR syntax error', durationMs: 12, status: 'failed' },
    ] as SkillTestCase[],
    perf: { calls24h: 2300, errorRate: 0.4, p95Ms: 80 },
  },
};

export const mockSkillVersions = {
  s1: [
    { version: '1.4.2', date: '2026-07-08', type: 'minor', notes: ['+ Redis 7.x 兼容', '+ 新增 CONFIG STATS 命令', '- 修复 cluster bus 报错'] },
    { version: '1.4.1', date: '2026-06-20', type: 'patch', notes: ['+ 超时自动重试 1 次'] },
    { version: '1.4.0', date: '2026-06-01', type: 'major', notes: ['+ 全新沙箱隔离', '+ 支持 TLS 加密'] },
    { version: '1.3.5', date: '2026-05-15', type: 'minor', notes: ['+ 审计日志自动写入'] },
  ],
};

export const mockSkillPerms = [
  { role: 'Admin', canCall: true, canConfig: true },
  { role: 'SRE', canCall: true, canConfig: true },
  { role: 'Sec', canCall: false, canConfig: false },
  { role: 'View', canCall: false, canConfig: false },
];

export const mockSkills: Skill[] = [
  { id: 's1', name: 'redis-cli', kind: 'skill', description: 'Redis 命令执行', version: '1.0', status: 'installed', rating: 4.9, installCount: 1200, riskLevel: 'mid', cacheable: true },
  { id: 's2', name: 'kubectl', kind: 'skill', description: 'K8s 操作', version: '1.0', status: 'installed', rating: 4.8, installCount: 1100, riskLevel: 'high', cacheable: true },
  { id: 's4', name: 'es-query', kind: 'skill', description: 'OpenSearch 查询', version: '1.0', status: 'installed', rating: 4.6, installCount: 820, riskLevel: 'low', cacheable: true },
  { id: 's5', name: 'prometheus', kind: 'mcp', description: 'Prometheus MCP', version: '1.0', status: 'installed', rating: 4.7, installCount: 940, riskLevel: 'low', cacheable: false },
  { id: 's6', name: 'kafka-mcp', kind: 'mcp', description: 'Kafka 消息 MCP', version: '1.0', status: 'installed', rating: 4.5, installCount: 480, riskLevel: 'low', cacheable: false },
  { id: 's7', name: 'cmdb-tool', kind: 'tool', description: 'CMDB 资产查询', version: '1.0', status: 'installed', rating: 4.6, installCount: 760, riskLevel: 'mid', cacheable: true },
  { id: 's8', name: 'jira-tool', kind: 'tool', description: 'Jira 工单', version: '1.0', status: 'installed', rating: 4.5, installCount: 690, riskLevel: 'mid', cacheable: true },
  { id: 's9', name: 'itsm-change-tool', kind: 'tool', description: '创建、查询与更新 ITSM 变更单；生产变更需要审批门禁', version: '2.3.1', status: 'installed', rating: 4.7, installCount: 920, riskLevel: 'high', cacheable: false },
  { id: 's10', name: 'notification-tool', kind: 'tool', description: '向飞书、企业微信、钉钉等受控渠道投递处置通知', version: '1.6.0', status: 'installed', rating: 4.8, installCount: 1680, riskLevel: 'low', cacheable: true },
  { id: 's11', name: 'release-control-tool', kind: 'tool', description: '执行灰度发布、回滚与发布窗口校验，所有写操作要求双人审批', version: '1.4.0', status: 'installed', rating: 4.6, installCount: 540, riskLevel: 'high', cacheable: false },
  { id: 's12', name: 'customer-ticket-tool', kind: 'tool', description: '同步客户工单、服务等级与处理进展，适用于服务运营数字伙伴', version: '1.1.2', status: 'installed', rating: 4.4, installCount: 430, riskLevel: 'mid', cacheable: true },
];

mockSkills.forEach((skill, index) => Object.assign(skill, {
  workspaceId: index === 2 || index === 6 ? 'w2' : index === 5 ? 'w3' : 'w1',
  ownerId: index === 5 ? 'u3' : 'u1',
  environment: index === 2 || index === 6 ? 'staging' : 'production',
  classification: skill.riskLevel === 'high' ? 'restricted' : 'internal',
}));

// ============ P9 模型扩展数据 ============

export const mockProviderHealth = {
  p1: { status: 'healthy', latency: 320, uptime: 99.98, lastCheck: '2 min 前' },
  p2: { status: 'healthy', latency: 280, uptime: 99.95, lastCheck: '2 min 前' },
  p3: { status: 'healthy', latency: 410, uptime: 99.92, lastCheck: '1 min 前' },
  p4: { status: 'standby', latency: 0, uptime: 100, lastCheck: '5 min 前' },
  p5: { status: 'healthy', latency: 120, uptime: 99.99, lastCheck: '30s 前' },
  p6: { status: 'healthy', latency: 180, uptime: 99.96, lastCheck: '1 min 前' },
};

export const mockPromptTemplates = [
  { id: 't1', name: '代码审查', category: 'engineering', preview: '你是一位资深 SRE，请审查以下代码...', uses: 1280, rating: 4.8 },
  { id: 't2', name: '故障定位', category: 'ops', preview: '检测到 Redis OOM，请按 Runbook 执行...', uses: 856, rating: 4.7 },
  { id: 't3', name: '威胁分析', category: 'security', preview: '基于 ATT&CK 框架分析此 SIEM 告警...', uses: 412, rating: 4.5 },
];

export const mockRouteFlow = [
  { level: 'P0', path: ['用户请求', 'P9 路由', 'Sonnet-4', 'GPT-4o (降级)', 'Opus-4 (兜底)'] },
  { level: 'P1', path: ['用户请求', 'P9 路由', 'Sonnet-4', 'Qwen2.5-72B (降级)'] },
  { level: 'P2', path: ['用户请求', 'P9 路由', 'Qwen2.5-72B'] },
  { level: 'P3', path: ['异步队列', 'Qwen2.5-72B (异步)'] },
  { level: 'Audit', path: ['审计通道', '独立集群'] },
];

export const mockExportRoutes = {
  cn: 94,   // 境内占比
  global: 6, // 出境占比
};

export const mockModelCompare = [
  { id: 'p1', name: 'Claude Sonnet-4', price: '$3 / $15', latency: 320, quality: 96, context: '200K' },
  { id: 'p5', name: 'Qwen2.5-72B', price: '$0.4 / $0.4', latency: 120, quality: 88, context: '32K' },
  { id: 'p6', name: 'DeepSeek-V3', price: '$0.3 / $0.5', latency: 180, quality: 90, context: '64K' },
];

export const mockAuditLog = [
  { id: 'l1', time: '14:32', user: '王昊', action: '查询', key: 'sk-prod-...', model: 'Sonnet-4', tokens: 1240 },
  { id: 'l2', time: '14:18', user: '李婷', action: '查询', key: 'sk-prod-...', model: 'Qwen2.5-72B', tokens: 856 },
  { id: 'l3', time: '13:55', user: '孙博', action: '轮转', key: 'sk-prod-...', model: 'GPT-4o', tokens: 0 },
  { id: 'l4', time: '13:42', user: '张睿', action: '查询', key: 'sk-prod-...', model: 'Sonnet-4', tokens: 2100 },
];

export const mockProviders: Provider[] = [
  { id: 'p1', name: 'Anthropic', tier: 'official', models: ['Claude Sonnet-4', 'Opus-4', 'Haiku-4'], region: 'global', status: 'active', monthlyTokens: 8_400_000, monthlyCostUsd: 980 },
  { id: 'p2', name: 'Azure OpenAI', tier: 'official', models: ['GPT-4o'], region: 'global', status: 'standby', monthlyTokens: 0, monthlyCostUsd: 0 },
  { id: 'p3', name: 'Google Vertex', tier: 'official', models: ['Gemini 2.0'], region: 'global', status: 'standby', monthlyTokens: 200_000, monthlyCostUsd: 24 },
  { id: 'p4', name: 'AWS Bedrock', tier: 'official', models: ['Claude 3.5', 'Titan'], region: 'global', status: 'standby', monthlyTokens: 0, monthlyCostUsd: 0 },
  { id: 'p5', name: 'Qwen2.5-72B', tier: 'self_hosted', models: ['Qwen2.5-72B'], region: 'cn', status: 'active', monthlyTokens: 3_200_000, monthlyCostUsd: 180 },
  { id: 'p6', name: 'DeepSeek-V3', tier: 'self_hosted', models: ['DeepSeek-V3'], region: 'cn', status: 'active', monthlyTokens: 600_000, monthlyCostUsd: 60 },
  { id: 'p7', name: 'Mistral', tier: 'connectable', models: ['—'], region: 'global', status: 'offline', monthlyTokens: 0, monthlyCostUsd: 0 },
  { id: 'p8', name: 'Ollama', tier: 'connectable', models: ['—'], region: 'global', status: 'offline', monthlyTokens: 0, monthlyCostUsd: 0 },
];

export const mockRoutes: ModelRoute[] = [
  { level: 'P0', primary: 'Sonnet-4', fallback1: 'GPT-4o', fallback2: 'Opus-4', crossBorder: true },
  { level: 'P1', primary: 'Sonnet-4', fallback1: 'Qwen2.5-72B', crossBorder: true },
  { level: 'P2', primary: 'Qwen2.5-72B', fallback1: '—', crossBorder: false },
  { level: 'P3', primary: 'Qwen2.5-72B', fallback1: '—', crossBorder: false },
  { level: 'audit', primary: '审计专用通道', fallback1: '—', crossBorder: false },
];

// ============ P10 渠道扩展数据 ============

export const mockChannelHealth = {
  c1: { status: 'healthy', latency: 120, success: 99.8, errorCount24h: 2 },
  c2: { status: 'healthy', latency: 95, success: 99.2, errorCount24h: 8 },
  c3: { status: 'healthy', latency: 110, success: 98.5, errorCount24h: 12 },
  c4: { status: 'disabled', latency: 0, success: 0, errorCount24h: 0 },
  c5: { status: 'healthy', latency: 280, success: 97.8, errorCount24h: 24 },
  c6: { status: 'healthy', latency: 45, success: 99.5, errorCount24h: 3 },
};

export const mockMessageStream = [
  { id: 'm1', time: '14:32:01', channel: '飞书', target: '王昊', content: '[P0] Redis OOM 告警已恢复', status: 'delivered', tone: 'success' as const },
  { id: 'm2', time: '14:30:18', channel: '企微', target: 'SRE 组', content: 'K8s 节点扩容审批通过', status: 'delivered', tone: 'success' as const },
  { id: 'm3', time: '14:28:45', channel: '飞书', target: '张睿', content: 'CVE-2026-3321 修复建议', status: 'delivered', tone: 'info' as const },
  { id: 'm4', time: '14:25:12', channel: '飞书', target: 'SRE 值班群', content: '本月合规审计报告 (94/94)', status: 'delivered', tone: 'success' as const },
  { id: 'm5', time: '14:18:32', channel: 'Webhook', target: 'SIEM', content: '告警降噪合并 23 条', status: 'failed', tone: 'warning' as const },
];

export const mockChannelConfig: Record<string, any> = {
  c1: {
    rateLimit: { qps: 50, daily: 10000 },
    retry: { max: 3, backoff: 'exponential' },
    silent: { start: '22:00', end: '08:00' },
    mergeWindow: '5 min',
  },
};

export const mockChannels: Channel[] = [
  { id: 'c1', name: '飞书', kind: 'feishu', enabled: true, monthlySent: 480, successRate: 0.998 },
  { id: 'c2', name: '企业微信', kind: 'wecom', enabled: true, monthlySent: 280, successRate: 0.992 },
  { id: 'c3', name: '钉钉', kind: 'dingtalk', enabled: true, monthlySent: 120, successRate: 0.985 },
  { id: 'c4', name: 'Slack', kind: 'slack', enabled: false, monthlySent: 0, successRate: 0 },
  { id: 'c6', name: 'Webhook', kind: 'webhook', enabled: true, monthlySent: 120, successRate: 0.995 },
];

// 模型、渠道与技能的运行时 Mock 域。所有可写操作汇聚在这里，并写入审计，
// 让运营台的刷新查询、详情抽屉和操作反馈指向同一份数据。
const mockControlPlaneAudit: Array<{ id: string; time: string; actor: string; domain: 'model' | 'channel' | 'skill' | 'tenant' | 'backup' | 'settings'; action: string; target: string; result: 'success' | 'failed' }> = [];
const mockSkillRuntime: Record<string, SkillRuntimeConfig> = {};
const mockSkillIntegrations: SkillIntegration[] = [
  { id: 'integration_mcp_gitlab', name: '企业 GitLab MCP', type: 'mcp', environment: 'production', status: 'enabled', owner: '李婷', endpoint: 'https://gitlab.internal.example.com/mcp', credentialRef: 'vault://integrations/gitlab/oauth', lastVerifiedAt: '4 分钟前', health: 'healthy', discoveredCapabilities: 18, writeApprovalRequired: true, allowedEgress: ['gitlab.internal.example.com'] },
  { id: 'integration_tool_itsm', name: 'ITSM 变更 API', type: 'tool', environment: 'production', status: 'pending_approval', owner: '周楠', endpoint: 'https://itsm.internal.example.com/openapi', credentialRef: 'vault://integrations/itsm/service-account', lastVerifiedAt: '12 分钟前', health: 'healthy', discoveredCapabilities: 9, writeApprovalRequired: true, allowedEgress: ['itsm.internal.example.com'] },
  { id: 'integration_mcp_servicenow', name: 'ServiceNow MCP', type: 'mcp', environment: 'test', status: 'validating', owner: '王昊', endpoint: 'https://sandbox.service-now.example.com/mcp', credentialRef: 'vault://integrations/servicenow/oauth', lastVerifiedAt: '刚刚', health: 'unknown', discoveredCapabilities: 0, writeApprovalRequired: true, allowedEgress: ['sandbox.service-now.example.com'] },
  { id: 'integration_skill_diagnosis', name: '内部诊断 Skill 包', type: 'skill', environment: 'test', status: 'failed', owner: '张睿', endpoint: 'registry://internal/diagnosis-skill:1.2.0', credentialRef: 'vault://registries/internal-reader', lastVerifiedAt: '26 分钟前', health: 'attention', discoveredCapabilities: 0, writeApprovalRequired: false, allowedEgress: ['registry.internal.example.com'], lastError: '制品签名校验失败：签发证书已过期' },
];
const mockSkillRuntimeHealth: SkillRuntimeHealth[] = [
  { id: 'health_s1', skillId: 's1', name: 'redis-cli', kind: 'skill', environment: 'production', status: 'healthy', calls24h: 2300, successRate: 99.6, p95Ms: 80, errorRate: 0.4, riskLevel: 'mid', owner: '李婷', references: 3, updatedAt: '刚刚' },
  { id: 'health_s2', skillId: 's2', name: 'kubectl', kind: 'skill', environment: 'production', status: 'attention', calls24h: 1820, successRate: 98.8, p95Ms: 220, errorRate: 1.2, riskLevel: 'high', owner: '王昊', references: 4, updatedAt: '2 分钟前' },
  { id: 'health_s5', skillId: 's5', name: 'prometheus', kind: 'mcp', environment: 'production', status: 'healthy', calls24h: 5600, successRate: 99.95, p95Ms: 30, errorRate: 0.05, riskLevel: 'low', owner: '张睿', references: 6, updatedAt: '刚刚' },
  { id: 'health_s7', skillId: 's7', name: 'cmdb-tool', kind: 'tool', environment: 'production', status: 'incident', calls24h: 3400, successRate: 95.8, p95Ms: 640, errorRate: 4.2, riskLevel: 'mid', owner: '陈默', references: 2, updatedAt: '6 分钟前' },
  { id: 'health_s9', skillId: 's9', name: 'itsm-change-tool', kind: 'tool', environment: 'production', status: 'attention', calls24h: 680, successRate: 98.2, p95Ms: 380, errorRate: 1.8, riskLevel: 'high', owner: '周楠', references: 3, updatedAt: '12 分钟前' },
  { id: 'health_s10', skillId: 's10', name: 'notification-tool', kind: 'tool', environment: 'production', status: 'healthy', calls24h: 4060, successRate: 99.9, p95Ms: 55, errorRate: 0.1, riskLevel: 'low', owner: '林晓', references: 8, updatedAt: '刚刚' },
  { id: 'health_s11', skillId: 's11', name: 'release-control-tool', kind: 'tool', environment: 'production', status: 'paused', calls24h: 120, successRate: 100, p95Ms: 180, errorRate: 0, riskLevel: 'high', owner: '王昊', references: 2, updatedAt: '1 小时前' },
];
const mockSkillGovernanceIncidents: SkillGovernanceIncident[] = [
  { id: 'incident_cmdb_latency', skillId: 's7', skillName: 'cmdb-tool', severity: 'P1', type: 'latency', title: '错误率超过 4% 且 P95 超阈值', detail: 'CMDB 查询接口响应变慢，影响 2 个工作流和 1 个智能体。', status: 'open', createdAt: '12:36', requestId: 'req_cmdb_20260719_01' },
  { id: 'incident_release_policy', skillId: 's11', skillName: 'release-control-tool', severity: 'P0', type: 'policy_blocked', title: '生产发布动作被双人审批策略阻断', detail: '审批人未齐备，已自动暂停新的发布执行请求。', status: 'open', createdAt: '11:58', requestId: 'req_release_20260719_12' },
  { id: 'incident_kube_credential', skillId: 's2', skillName: 'kubectl', severity: 'P2', type: 'credential', title: '服务凭据将在 7 天内到期', detail: '请在密钥中心完成轮换并执行重新验证。', status: 'acknowledged', createdAt: '09:20', requestId: 'req_kube_20260719_03' },
];
const mockSkillGovernanceEvents: SkillGovernanceEvent[] = [
  { id: 'gov_event_1', time: '12:41', skillName: 'release-control-tool', type: 'policy', action: '双人审批策略阻断', actor: '策略引擎', result: 'blocked', requestId: 'req_release_20260719_12' },
  { id: 'gov_event_2', time: '12:36', skillName: 'cmdb-tool', type: 'call', action: '错误率阈值告警', actor: '运行监控', result: 'failed', requestId: 'req_cmdb_20260719_01' },
  { id: 'gov_event_3', time: '12:20', skillName: 'prometheus', type: 'call', action: '健康验证完成', actor: '当前用户', result: 'success', requestId: 'req_prom_20260719_04' },
  { id: 'gov_event_4', time: '11:58', skillName: 'release-control-tool', type: 'lifecycle', action: '自动暂停高风险发布能力', actor: '策略引擎', result: 'success' },
];
const mockSkillGovernance: Record<string, SkillGovernancePolicy> = {};
const skillAssetDefaults: Record<string, Pick<Skill, 'lifecycleStatus' | 'source' | 'owner' | 'team' | 'lastVerifiedAt' | 'hasUpdate' | 'upgradeVersion' | 'tags'>> = {
  s1: { lifecycleStatus: 'enabled', source: 'market', owner: '李婷', team: 'SRE 平台组', lastVerifiedAt: '12 分钟前', hasUpdate: true, upgradeVersion: '1.5.0', tags: ['生产', '数据变更'] },
  s2: { lifecycleStatus: 'enabled', source: 'import', owner: '王昊', team: '云原生组', lastVerifiedAt: '昨天 18:20', tags: ['生产', '高风险'] },
  s3: { lifecycleStatus: 'enabled', source: 'market', owner: '张睿', team: '可观测性组', lastVerifiedAt: '8 分钟前', tags: ['只读', '日志'] },
  s5: { lifecycleStatus: 'enabled', source: 'mcp', owner: '李婷', team: 'SRE 平台组', lastVerifiedAt: '6 分钟前', tags: ['监控', '只读'] },
  s7: { lifecycleStatus: 'pending_approval', source: 'tool', owner: '陈默', team: '资产运营组', lastVerifiedAt: '2 小时前', tags: ['CMDB', '待审批'] },
  s9: { lifecycleStatus: 'enabled', source: 'tool', owner: '周楠', team: '变更运营组', lastVerifiedAt: '5 分钟前', tags: ['ITSM', '生产变更', '审批'] },
  s10: { lifecycleStatus: 'enabled', source: 'tool', owner: '林晓', team: '服务体验组', lastVerifiedAt: '3 分钟前', tags: ['通知', '只写消息'] },
  s11: { lifecycleStatus: 'pending_approval', source: 'tool', owner: '王昊', team: '交付工程组', lastVerifiedAt: '22 分钟前', tags: ['发布', '回滚', '双人审批'] },
  s12: { lifecycleStatus: 'enabled', source: 'tool', owner: '郑颖', team: '客户运营组', lastVerifiedAt: '1 小时前', tags: ['客户工单', 'SLA'] },
};

function skillAsset(skill: Skill): Skill {
  const defaults = skillAssetDefaults[skill.id] ?? {};
  return { lifecycleStatus: 'enabled', source: skill.kind === 'mcp' ? 'mcp' : skill.kind === 'tool' ? 'tool' : 'import', owner: '未分配', team: '平台工程组', lastVerifiedAt: '尚未验证', hasUpdate: false, tags: [], ...defaults, ...skill };
}

function skillGovernance(id: string): SkillGovernancePolicy {
  return mockSkillGovernance[id] ?? (mockSkillGovernance[id] = { skillId: id, secretRef: 'vault://digital-employee/skills/default', allowedEgress: ['api.internal.example.com'], writeApprovalRequired: true, rateLimitPerMinute: 60, circuitBreakerEnabled: true, dataMaskingEnabled: true });
}
const mockSkillPermissions: Record<string, SkillPermission[]> = Object.fromEntries(mockSkills.map((skill) => [skill.id, mockSkillPerms.map((item) => ({ ...item, skillId: skill.id }))]));
const mockSkillImpacts: Record<string, SkillImpactReport> = {
  s1: { skillId: 's1', agents: ['故障自愈'], workflows: ['Redis OOM 自动处置'], activeRuns: 1, uninstallAllowed: false, reason: '存在 1 个运行中的工作流和 1 个已发布智能体引用' },
  s2: { skillId: 's2', agents: ['故障自愈', '变更辅助'], workflows: ['K8s 节点自愈', '灰度发布'], activeRuns: 0, uninstallAllowed: false, reason: '存在 2 个已发布智能体引用' },
};
const mockSkillCatalog: Array<Skill & { publisher: string; signed: boolean; dependencies: string[]; license: string; lastScannedAt: string; vulnerabilityCount: number; supportedEnvironments: string[] }> = [
  { id: 'st2', name: 'pg-cli', kind: 'skill', description: 'PostgreSQL 客户端', version: '1.8.0', status: 'available', rating: 4.6, installCount: 2800, riskLevel: 'mid', cacheable: true, publisher: '企业能力商店', signed: true, dependencies: [], license: 'Apache-2.0', lastScannedAt: '18 分钟前', vulnerabilityCount: 0, supportedEnvironments: ['测试', '生产'] },
  { id: 'st3', name: 'gitlab-mcp', kind: 'mcp', description: 'GitLab MR/Issue MCP', version: '0.9.0', status: 'available', rating: 4.4, installCount: 1200, riskLevel: 'mid', cacheable: false, publisher: '企业能力商店', signed: true, dependencies: ['gitlab-connector'], license: 'MIT', lastScannedAt: '36 分钟前', vulnerabilityCount: 1, supportedEnvironments: ['测试'] },
  { id: 'st4', name: 'jenkins-mcp', kind: 'mcp', description: 'Jenkins 构建触发', version: '1.0.0', status: 'available', rating: 4.3, installCount: 880, riskLevel: 'high', cacheable: false, publisher: '企业能力商店', signed: true, dependencies: ['jenkins-mcp'], license: '商业授权', lastScannedAt: '刚刚', vulnerabilityCount: 0, supportedEnvironments: ['隔离环境'] },
  { id: 'st5', name: 'runbook-executor', kind: 'skill', description: '按受控运行手册执行诊断与处置步骤', version: '1.3.0', status: 'available', rating: 4.8, installCount: 2180, riskLevel: 'mid', cacheable: false, publisher: 'SRE 平台组', signed: true, dependencies: ['knowledge-retrieval'], license: '内部许可', lastScannedAt: '9 分钟前', vulnerabilityCount: 0, supportedEnvironments: ['测试', '生产'] },
  { id: 'st6', name: 'security-evidence-skill', kind: 'skill', description: '归集告警、日志与资产证据并输出安全研判材料', version: '1.1.0', status: 'available', rating: 4.6, installCount: 960, riskLevel: 'low', cacheable: true, publisher: '安全运营组', signed: true, dependencies: [], license: '内部许可', lastScannedAt: '16 分钟前', vulnerabilityCount: 0, supportedEnvironments: ['测试', '生产'] },
  { id: 'st7', name: 'pagerduty-mcp', kind: 'mcp', description: '查询事件、升级策略与值班排班的 PagerDuty 连接器', version: '1.2.0', status: 'available', rating: 4.5, installCount: 760, riskLevel: 'mid', cacheable: false, publisher: '企业能力商店', signed: true, dependencies: ['pagerduty-oauth'], license: 'MIT', lastScannedAt: '28 分钟前', vulnerabilityCount: 0, supportedEnvironments: ['测试', '生产'] },
  { id: 'st8', name: 'service-now-mcp', kind: 'mcp', description: 'ServiceNow 事件、请求与变更记录连接器', version: '1.0.2', status: 'available', rating: 4.4, installCount: 620, riskLevel: 'high', cacheable: false, publisher: '企业能力商店', signed: true, dependencies: ['servicenow-oauth'], license: '商业授权', lastScannedAt: '41 分钟前', vulnerabilityCount: 0, supportedEnvironments: ['隔离环境'] },
  { id: 'st9', name: 'approval-center-tool', kind: 'tool', description: '发起、查询和回收企业审批；支持双人复核策略', version: '2.0.0', status: 'available', rating: 4.7, installCount: 1450, riskLevel: 'high', cacheable: false, publisher: '流程平台组', signed: true, dependencies: ['approval-api-v2'], license: '内部许可', lastScannedAt: '6 分钟前', vulnerabilityCount: 0, supportedEnvironments: ['测试', '生产'] },
  { id: 'st10', name: 'message-delivery-tool', kind: 'tool', description: '向飞书、企微和钉钉渠道投递可审计的业务通知', version: '1.8.1', status: 'available', rating: 4.8, installCount: 2660, riskLevel: 'low', cacheable: true, publisher: '消息平台组', signed: true, dependencies: [], license: '内部许可', lastScannedAt: '3 分钟前', vulnerabilityCount: 0, supportedEnvironments: ['测试', '生产'] },
];
mockSkillCatalog.forEach((skill, index) => Object.assign(skill, {
  workspaceId: index === 2 ? 'w2' : index === 5 ? 'w3' : 'w1',
  ownerId: 'u1',
  environment: index === 2 ? 'staging' : 'production',
  classification: skill.riskLevel === 'high' ? 'restricted' : 'internal',
  channel: 'builtin',
  channelLabel: '平台内置',
  syncedAt: '种子目录',
  visibilityScope: skill.riskLevel === 'high' ? 'workspace' : 'global',
  releaseChannel: skill.riskLevel === 'high' ? 'beta' : 'stable',
}));
const mockAgentSkillBindings: Record<string, Array<{ skillId: string; skillName: string; status: 'active' | 'pending_approval'; installedAt: string }>> = {
  a1: [{ skillId: 's1', skillName: 'redis-cli', status: 'active', installedAt: '2026-07-19 09:40' }],
  a3: [{ skillId: 's2', skillName: 'kubectl', status: 'active', installedAt: '2026-07-19 10:10' }],
};
const mockCapabilityBindings: CapabilityBinding[] = [
  { id: 'cap_a1_s1', targetType: 'agent', targetId: 'a1', capabilityKind: 'skill', capabilityId: 's1', pinnedVersion: '1.0', status: 'active', createdBy: '系统', createdAt: '2026-07-19T09:40:00Z', auditId: 'audit_cap_a1_s1' },
  { id: 'cap_wf1_s1', targetType: 'workflow', targetId: 'wf1', capabilityKind: 'skill', capabilityId: 's1', pinnedVersion: '1.0', status: 'active', createdBy: '系统', createdAt: '2026-07-19T09:45:00Z', auditId: 'audit_cap_wf1_s1' },
];
const mockWorkflowSkills: WorkflowSkill[] = [
  { id: 'wfs-incident', sourceWorkflowId: 'wf1', sourceVersionId: 'v3', name: '生产故障处置流程技能', description: '标准告警关联、定位建议与受控恢复步骤，供 SRE 岗位装配。', riskLevel: 'high', approvalRequired: true, rollbackSupported: true, status: 'published' },
  { id: 'wfs-change', sourceWorkflowId: 'wf-change', sourceVersionId: 'v2', name: '生产变更协同流程技能', description: '变更风险评估、审批协同与灰度观察的标准作业能力。', riskLevel: 'mid', approvalRequired: true, rollbackSupported: true, status: 'published' },
];

function skillAuditEvents(): SkillAuditEvent[] {
  return mockControlPlaneAudit.filter((event) => event.domain === 'skill').map((event) => ({ ...event, correlationId: `skill:${event.target}` }));
}
const mockChannelTemplates = [
  { id: 'card1', name: '告警卡片', kind: 'feishu', locale: 'zh-CN', status: 'published', tone: 'error', desc: 'P0/P1 紧急事件 · 含一键跳转', preview: '[P0] Redis OOM\n集群: prod-redis-01\n[查看详情 →]', updatedAt: '2026-07-18T08:00:00.000Z' },
  { id: 'card2', name: '审批卡片', kind: 'feishu', locale: 'zh-CN', status: 'published', tone: 'warn', desc: '双签审批 · 同意/拒绝按钮', preview: '变更审批\n[批准] [拒绝]', updatedAt: '2026-07-17T09:30:00.000Z' },
  { id: 'card3', name: '交接摘要', kind: 'feishu', locale: 'zh-CN', status: 'draft', tone: 'info', desc: '人工接管摘要 · 脱敏任务上下文', preview: '交接：夜航 → 值班经理\n任务 TSK-*** 待审批', updatedAt: '2026-07-21T07:10:00.000Z' },
];
const mockChannelBlacklist = [
  { id: 'b1', type: '用户', value: 'test-spammer@external.com', reason: '高频无效告警', addedBy: '系统', expires: '2026-08-01' },
  { id: 'b2', type: '群组', value: 'ext-noise-room', reason: '外部噪音群，禁止投递生产告警', addedBy: '消息平台组', expires: '永久' },
];
const mockChannelLanguages = [
  { key: 'zh-CN', label: '简体中文', sample: '您的服务出现异常，请立即处理。' },
  { key: 'en-US', label: 'English', sample: 'Your service has encountered an anomaly, please handle immediately.' },
];
const mockChannelRoutes = [
  { event: 'P0 紧急告警', main: '飞书', f1: '企微', f2: '钉钉', fb: 'Webhook', tone: 'error' },
  { event: 'P1 重要升级', main: '飞书+企微', f1: '钉钉', f2: 'Webhook', fb: '—', tone: 'warn' },
  { event: 'P2 标准通知', main: '企微', f1: '飞书', f2: '钉钉', fb: '—', tone: 'info' },
];

// 渠道控制面：部署、版本化投递策略、失败队列和审计均由同一领域状态持有。
const channelDeployments: ChannelDeployment[] = [
  { id: 'delivery-feishu', workspaceId: 'w1', name: '飞书生产投递', kind: 'feishu', environment: 'production', status: 'active', credentialRef: 'vault://channel-deployments/delivery-feishu/credential', credentialMasked: 'app-…prod', owner: '消息平台组', lastVerifiedAt: '2026-07-21T12:00:00.000Z', connectionMode: 'webhook', webhookPath: '/api/channel/feishu/events/delivery-feishu' },
];
const channelInbound: Array<{ id: string; workspaceId: string; deploymentId: string; text?: string; eventType?: string; receivedAt: string }> = [];
const deliveryPolicies: DeliveryPolicyDraft[] = [
  { id: 'delivery-policy-p0', workspaceId: 'w1', eventType: 'P0 紧急告警', primaryDeploymentId: 'delivery-feishu', fallbackDeploymentIds: [], audience: 'SRE 值班组', dataClassification: 'internal', status: 'draft', validationIssues: [] },
];
const deliveryVersions: DeliveryPolicyVersion[] = [];
const deliveryAttempts: DeliveryAttempt[] = [
  { id: 'da-demo-1', workspaceId: 'w1', policyId: 'delivery-policy-p0', deploymentId: 'delivery-feishu', targetMasked: 'SRE ****', payloadSummary: '[P0] **** OOM ****', status: 'dead_letter', attempts: 3, correlationId: 'corr_delivery_demo_1', createdAt: '2026-07-21T10:12:00.000Z' },
];
const channelAuditEvents: ChannelAuditEvent[] = [
  { id: 'ca-1', workspaceId: 'w1', time: '2026-07-21T09:40:00.000Z', actor: '消息平台组', action: '验证渠道部署', target: '飞书生产投递', result: 'success', correlationId: 'corr_channel_verify_1' },
  { id: 'ca-2', workspaceId: 'w1', time: '2026-07-20T16:20:00.000Z', actor: '平台管理员', action: '创建渠道部署', target: '飞书生产投递', result: 'success', correlationId: 'corr_channel_create_1' },
  { id: 'ca-3', workspaceId: 'w1', time: '2026-07-19T12:00:00.000Z', actor: '消息平台组', action: '保存投递策略草稿', target: 'P0 紧急告警', result: 'success', correlationId: 'corr_channel_policy_1' },
];

function channelContext(opts: { headers?: Record<string, string> }) {
  const permissions = opts.headers?.['x-mock-permissions']?.split(',').map((item) => item.trim()) ?? [];
  const identity = mockIdentity(opts.headers);
  const resolved = permissions.length ? permissions : identity?.permissions ?? [];
  return { workspaceId: opts.headers?.['x-workspace-id'] ?? identity?.workspaceId ?? 'w1', permissions: resolved, actor: identity?.name ?? '当前用户' };
}
function requireChannel(opts: { headers?: Record<string, string> }, permission: 'channel.read' | 'channel.write', workspaceId?: string) {
  const context = channelContext(opts);
  if (!context.permissions.includes(permission)) throw new Error(`E_CHANNEL_${permission === 'channel.write' ? 'WRITE' : 'READ'}_FORBIDDEN: 缺少 ${permission} 权限`);
  if (workspaceId && context.workspaceId !== workspaceId) throw new Error('E_CHANNEL_WORKSPACE_SCOPE: 无权操作其他工作区渠道资源');
  return context;
}
function appendChannelAudit(opts: { headers?: Record<string, string> }, action: string, target: string, result: 'success' | 'failed', details: { reason?: string; policyVersion?: string; correlationId?: string } = {}) {
  const context = channelContext(opts);
  const event: ChannelAuditEvent = { id: mockId('channel_audit'), workspaceId: context.workspaceId, time: new Date().toISOString(), actor: context.actor, action, target, result, reason: details.reason, policyVersion: details.policyVersion, correlationId: details.correlationId ?? mockId('channel_corr') };
  channelAuditEvents.unshift(event);
  return event;
}
function validateDeliveryPolicy(policy: DeliveryPolicyDraft) {
  const ids = [policy.primaryDeploymentId, ...policy.fallbackDeploymentIds];
  const deployments = ids.map((id) => channelDeployments.find((item) => item.id === id));
  const issues: string[] = [];
  if (!deployments[0] || deployments[0].status !== 'active') issues.push('E_DELIVERY_PRIMARY_UNAVAILABLE: 主渠道不可用');
  if (new Set(ids).size !== ids.length) issues.push('E_DELIVERY_FALLBACK_INVALID: 降级链不能重复');
  if (deployments.some((item) => !item || item.workspaceId !== policy.workspaceId || item.status !== 'active')) issues.push('E_DELIVERY_FALLBACK_INVALID: 降级渠道不可用或不属于当前工作区');
  if (policy.dataClassification === 'restricted' && deployments.some((item) => item?.kind === 'webhook')) issues.push('E_DELIVERY_CLASSIFICATION_BLOCKED: 受限数据不能投递至外部渠道');
  return issues;
}
function maskTarget(value: string) { return value.length < 5 ? '***' : `${value.slice(0, 2)}***${value.slice(-2)}`; }

function appendControlPlaneAudit(domain: 'model' | 'channel' | 'skill' | 'tenant' | 'backup' | 'settings', action: string, target: string, result: 'success' | 'failed' = 'success') {
  const event = { id: mockId('control_audit'), time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), actor: '当前用户', domain, action, target, result };
  mockControlPlaneAudit.unshift(event);
  return event;
}

// ============ 模型控制面 Mock 域 ============
// 注意：凭据仅在接入请求中一次性出现；领域状态绝不保存明文凭据。
const modelProfiles: ModelProfile[] = [
  { id: 'model-sonnet', providerId: 'p1', name: 'Claude Sonnet-4', cloudRegion: 'us-west-2', dataResidency: 'global', capabilities: ['chat', 'reasoning'], status: 'available', contextWindow: 200_000 },
  { id: 'model-gpt4o', providerId: 'p2', name: 'GPT-4o', cloudRegion: 'eastasia', dataResidency: 'global', capabilities: ['chat', 'vision'], status: 'available', contextWindow: 128_000 },
  { id: 'model-qwen', providerId: 'p5', name: 'Qwen2.5-72B', cloudRegion: 'cn-east-1', dataResidency: 'cn', capabilities: ['chat', 'reasoning'], status: 'available', contextWindow: 32_000 },
  { id: 'model-w2-isolated', providerId: 'p9', name: '隔离工作区模型', cloudRegion: 'cn-east-1', dataResidency: 'cn', capabilities: ['chat'], status: 'available', contextWindow: 32_000 },
];

const modelProviders: ModelProvider[] = [
  { id: 'p1', workspaceId: 'w1', name: 'Anthropic', protocol: 'anthropic', tier: 'official', baseUrl: 'https://api.anthropic.com', cloudRegion: 'us-west-2', dataResidency: 'global', status: 'active', credentialRef: 'vault://model-providers/p1/credential', credentialMasked: 'sk-…prod', lastVerifiedAt: '2026-07-19T14:32:00.000Z', models: modelProfiles.filter((model) => model.providerId === 'p1') },
  { id: 'p2', workspaceId: 'w1', name: 'Azure OpenAI', protocol: 'azure_openai', tier: 'official', baseUrl: 'https://contoso.openai.azure.com', apiVersion: '2024-10-21', deploymentName: 'gpt-4o', cloudRegion: 'eastasia', dataResidency: 'global', status: 'standby', credentialRef: 'vault://model-providers/p2/credential', credentialMasked: 'key-…prod', lastVerifiedAt: '2026-07-19T14:28:00.000Z', models: modelProfiles.filter((model) => model.providerId === 'p2') },
  { id: 'p5', workspaceId: 'w1', name: 'Qwen2.5-72B', protocol: 'ollama', tier: 'self_hosted', baseUrl: 'http://llm-gateway.internal/v1', cloudRegion: 'cn-east-1', dataResidency: 'cn', status: 'active', credentialRef: 'vault://model-providers/p5/credential', credentialMasked: 'vault-managed', lastVerifiedAt: '2026-07-19T14:31:00.000Z', models: modelProfiles.filter((model) => model.providerId === 'p5') },
  { id: 'p9', workspaceId: 'w2', name: '隔离工作区供应商', protocol: 'custom', tier: 'self_hosted', baseUrl: 'http://isolated-llm.internal/v1', cloudRegion: 'cn-east-1', dataResidency: 'cn', status: 'active', credentialRef: 'vault://model-providers/p9/credential', credentialMasked: 'vault-managed', lastVerifiedAt: '2026-07-19T14:31:00.000Z', models: modelProfiles.filter((model) => model.providerId === 'p9') },
];

const routingPolicies: RoutingPolicyDraft[] = [
  { id: 'route-p0', workspaceId: 'w1', level: 'P0', primaryModelId: 'model-sonnet', fallbackModelIds: ['model-gpt4o'], dataScope: 'internal', egressAllowed: true, budgetLimitUsd: 1_500, status: 'published', validationIssues: [] },
  { id: 'route-p1', workspaceId: 'w1', level: 'P1', primaryModelId: 'model-qwen', fallbackModelIds: ['model-sonnet'], dataScope: 'internal', egressAllowed: true, budgetLimitUsd: 800, status: 'draft', validationIssues: [] },
  { id: 'route-p2', workspaceId: 'w1', level: 'P2', primaryModelId: 'model-qwen', fallbackModelIds: [], dataScope: 'restricted', egressAllowed: false, budgetLimitUsd: 400, status: 'published', validationIssues: [] },
];

const routingVersions: RoutingPolicyVersion[] = [
  { id: 'route-p0-v1', policyId: 'route-p0', version: 1, snapshot: { ...routingPolicies[0], fallbackModelIds: [...routingPolicies[0].fallbackModelIds] }, publishedAt: '2026-07-18T09:00:00.000Z', publishedBy: '王昊' },
  { id: 'route-p2-v1', policyId: 'route-p2', version: 1, snapshot: { ...routingPolicies[2], fallbackModelIds: [] }, publishedAt: '2026-07-18T09:00:00.000Z', publishedBy: '王昊' },
];

const modelAuditEvents: ModelAuditEvent[] = [
  { id: 'ma-seed-1', time: '2026-07-19T14:32:00.000Z', workspaceId: 'w1', actor: '王昊', action: '验证供应商连通性', target: 'Anthropic', result: 'success', reason: '定时健康检查', correlationId: 'corr_seed_1' },
  { id: 'ma-seed-2', time: '2026-07-18T09:05:00.000Z', workspaceId: 'w1', actor: '王昊', action: '发布路由版本', target: 'P0', result: 'success', policyVersion: 'route-p0-v1', correlationId: 'corr_seed_2' },
  { id: 'ma-seed-3', time: '2026-07-18T08:50:00.000Z', workspaceId: 'w1', actor: '李婷', action: '校验路由草稿', target: 'P1', result: 'failed', reason: '降级链待补齐', correlationId: 'corr_seed_3' },
];

type ModelRequestOptions = { headers?: Record<string, string>; body?: unknown };

function modelContext(opts: ModelRequestOptions) {
  const explicitPermissions = opts.headers?.['x-mock-permissions']?.split(',').map((item) => item.trim());
  const identity = mockIdentity(opts.headers);
  const permissions = explicitPermissions ?? identity?.permissions ?? [];
  const actor = opts.headers?.['x-mock-actor'] ?? identity?.name ?? '当前用户';
  return { workspaceId: opts.headers?.['x-workspace-id'] ?? identity?.workspaceId ?? 'w1', permissions, actor };
}

function requireModelRead(opts: ModelRequestOptions) {
  const context = modelContext(opts);
  if (!context.permissions.includes('model.read')) throw new Error('E_MODEL_READ_FORBIDDEN: 缺少 model.read 权限');
  return context;
}

function requireModelWrite(opts: ModelRequestOptions, workspaceId: string) {
  const context = modelContext(opts);
  if (!context.permissions.includes('model.write')) throw new Error('E_MODEL_WRITE_FORBIDDEN: 缺少 model.write 权限');
  if (context.workspaceId !== workspaceId) throw new Error('E_WORKSPACE_SCOPE: 无权操作其他工作区模型资源');
  return context;
}

function appendModelAudit(opts: ModelRequestOptions, action: string, target: string, result: 'success' | 'failed', details: { reason?: string; policyVersion?: string; correlationId?: string } = {}) {
  const context = modelContext(opts);
  const event: ModelAuditEvent = { id: mockId('model_audit'), time: new Date().toISOString(), workspaceId: context.workspaceId, actor: context.actor, action, target, result, reason: details.reason, policyVersion: details.policyVersion, correlationId: details.correlationId ?? mockId('corr') };
  modelAuditEvents.unshift(event);
  return event;
}

function modelById(id: string) {
  return modelProfiles.find((model) => model.id === id);
}

function validateRoutingPolicy(policy: RoutingPolicyDraft) {
  const issues: string[] = [];
  const primary = modelById(policy.primaryModelId);
  const modelIds = [policy.primaryModelId, ...policy.fallbackModelIds];
  const selectedProviders = modelIds.map((id) => modelById(id)).filter(Boolean).map((model) => modelProviders.find((provider) => provider.id === model!.providerId));
  if (!primary || primary.status !== 'available') issues.push('E_MODEL_UNAVAILABLE: 主模型不可用');
  if (selectedProviders.some((provider) => provider?.workspaceId !== policy.workspaceId)) issues.push('E_MODEL_SCOPE: 模型部署不属于当前工作区');
  if (new Set(modelIds).size !== modelIds.length) issues.push('E_FALLBACK_INVALID: 降级链不能重复或指向主模型');
  if (policy.fallbackModelIds.some((id) => !modelById(id) || modelById(id)?.status !== 'available')) issues.push('E_FALLBACK_INVALID: 降级模型不可用');
  if (policy.dataScope === 'restricted' && policy.egressAllowed) issues.push('E_EGRESS_BLOCKED: 受限数据不允许出境');
  if (policy.dataScope === 'restricted' && modelIds.some((id) => modelById(id)?.dataResidency !== 'cn')) issues.push('E_EGRESS_BLOCKED: 受限数据必须路由至境内模型部署');
  if (policy.budgetLimitUsd <= 0) issues.push('E_BUDGET_EXCEEDED: 预算必须大于 0');
  return issues;
}

function providerImpact(providerId: string): ProviderImpact {
  const routeReferences = routingPolicies
    .filter((policy) => policy.status === 'published')
    .filter((policy) => [policy.primaryModelId, ...policy.fallbackModelIds].some((modelId) => modelById(modelId)?.providerId === providerId))
    .map((policy) => {
      const latest = routingVersions.find((version) => version.policyId === policy.id);
      return { policyId: policy.id, level: policy.level, versionId: latest?.id ?? '' };
    });
  return {
    providerId,
    routeReferences,
    deletionAllowed: routeReferences.length === 0,
    blockedReason: routeReferences.length
      ? '供应商被已发布路由引用，请先在「模型路由」取消发布或替换模型后再删除。'
      : undefined,
  };
}

// ============ P11 设置扩展数据 ============

export const mockApiKeys = [
  { id: 'k1', name: 'Production Primary', prefix: 'sk-prod-****', created: '2026-04-01', lastUsed: '14:32', expires: '2026-08-01', status: 'active' },
  { id: 'k2', name: 'CI/CD Pipeline', prefix: 'sk-cicd-****', created: '2026-05-15', lastUsed: '12:18', expires: '2026-09-15', status: 'active' },
  { id: 'k3', name: 'Dev Sandbox', prefix: 'sk-dev-****', created: '2026-06-20', lastUsed: '昨天', expires: '2026-07-20', status: 'warning' },
];

export const mockWebhooks = [
  { id: 'w1', url: 'https://acme.com/webhook/alert', events: ['P0 告警', 'P1 升级'], status: 'active', secret: 'whsec_****', retry: 3, success: 99.2 },
  { id: 'w2', url: 'https://siem.acme.com/ingest', events: ['审计日志', '合规事件'], status: 'active', secret: 'whsec_****', retry: 5, success: 99.8 },
];

export const mockBackups = [
  { id: 'b1', time: '2026-07-13 02:00', type: '自动', size: '4.2 GB', status: 'success', duration: '12min' },
  { id: 'b2', time: '2026-07-12 02:00', type: '自动', size: '4.1 GB', status: 'success', duration: '11min' },
  { id: 'b3', time: '2026-07-11 02:00', type: '自动', size: '4.1 GB', status: 'success', duration: '12min' },
  { id: 'b4', time: '2026-07-10 02:00', type: '手动', size: '3.9 GB', status: 'success', duration: '15min' },
];

export const mockAuditStream = [
  { id: 'a1', time: '14:32:12', user: '王昊', action: 'CONFIG_SET', target: 'prod-redis-01', result: 'success' },
  { id: 'a2', time: '14:28:45', user: '王昊', action: 'APPROVE', target: 'TSK-20260713-001', result: 'success' },
  { id: 'a3', time: '14:25:30', user: '李婷', action: 'TASK_CREATE', target: 'TSK-20260713-004', result: 'success' },
  { id: 'a4', time: '14:18:22', user: '张睿', action: 'CVE_SCAN', target: 'PRD-CACHE-019', result: 'success' },
  { id: 'a5', time: '14:12:08', user: '孙博', action: 'DEPLOY', target: 'gateway-prod', result: 'success' },
  { id: 'a6', time: '14:05:15', user: '李婷', action: 'WORKFLOW_TRIGGER', target: 'cache-oom', result: 'failed' },
];

export const mockComplianceChecks = [
  { id: 'c1', name: '身份认证 (Authentik+OIDC)', category: 'identity', status: 'pass' },
  { id: 'c2', name: 'MFA 双因素 (100% 启用)', category: 'identity', status: 'pass' },
  { id: 'c3', name: '密码策略 (12 位 + 90d 轮转)', category: 'identity', status: 'pass' },
  { id: 'c4', name: '字段级权限', category: 'access', status: 'pass' },
  { id: 'c5', name: '数据出境策略', category: 'data', status: 'pass' },
  { id: 'c6', name: '双签复核 (写动作 100%)', category: 'access', status: 'pass' },
  { id: 'c7', name: 'SignedLog 审计', category: 'audit', status: 'pass' },
  { id: 'c8', name: 'API Key 30d 轮转', category: 'data', status: 'pass' },
  { id: 'c9', name: 'gVisor 沙箱隔离', category: 'compliance', status: 'pass' },
  { id: 'c10', name: '风险评估', category: 'compliance', status: 'pass' },
  { id: 'c11', name: '下次审计日期', category: 'compliance', status: 'pass' },
  { id: 'c12', name: '导出审计日志', category: 'audit', status: 'warn' },
  { id: 'c13', name: '字段脱敏增强', category: 'data', status: 'warn' },
  { id: 'c14', name: '灰度发布策略', category: 'compliance', status: 'warn' },
];

export const mockBilling = {
  plan: 'Enterprise Plus',
  price: '$5,000',
  usage: {
    cost: 1240,
    budget: 5000,
    tokens: 12.4e6,
    tokenBudget: 50e6,
    seats: 18,
    seatLimit: 50,
    agents: 8,
    agentLimit: 20,
  },
  nextBilling: '2026-08-01',
};

export const mockNotificationChannels = [
  { id: 'n1', name: '安全告警', channels: ['飞书', '企微'], frequency: '即时', enabled: true },
  { id: 'n2', name: '系统状态', channels: ['飞书'], frequency: '每 5 分钟', enabled: true },
  { id: 'n3', name: '日报', channels: ['飞书'], frequency: '每天 9:00', enabled: true },
  { id: 'n4', name: '营销活动', channels: ['企微'], frequency: '每周', enabled: false },
];

export const mockTenantProfile: {
  name: string;
  tenantId: string;
  region: string;
  createdAt: string;
  status: string;
  updatedAt?: string;
} = {
  name: 'ACME Corp',
  tenantId: 'tenant-acme',
  region: 'cn-east-1',
  createdAt: '2024-03-12',
  status: 'active',
};

export const mockAudits: AuditItem[] = mockComplianceChecks.map((c) => ({ ...c, updatedAt: '2026-07-12' })) as unknown as AuditItem[];

// ============ P2 会话扩展数据 ============

export interface AgentMeta {
  id: string;
  name: string;
  category: string;
  version: string;
  description: string;
  rating: number;
  ratingCount: number;
  lastActive: string;
  installCount: number;
  responseP95: number;
  totalTokens: number;
  // 新增字段
  sla: number; // 0-100
  errorRate: number; // 0-1
  knowledgeBases: number; // 引用的知识库数
  tools: number; // 工具数
  languages: string[]; // 支持语言
}

export const mockAgentMeta: AgentMeta = {
  id: 'a1',
  name: '故障自愈',
  category: 'AIOps',
  version: '1.4.2',
  description: '基于 Runbook 的自动故障定位与恢复 · 内置 8 个 Skill',
  rating: 4.8,
  ratingCount: 1240,
  lastActive: '14:32',
  installCount: 1240,
  responseP95: 580,
  totalTokens: 1240000,
  sla: 99.6,
  errorRate: 0.012,
  knowledgeBases: 4,
  tools: 8,
  languages: ['zh-CN', 'en-US'],
};

export interface ChatMessageEx {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  agentId?: string;
  agentName?: string;
  citations?: { id: string; docId: string; text: string; score: number; source: string; page?: number }[];
  toolCalls?: { id: string; name: string; args: Record<string, unknown>; result?: string; status: 'pending' | 'running' | 'success' | 'failed'; durationMs?: number }[];
  codeBlock?: { lang: string; code: string };
  attachment?: { name: string; size: string; type: 'file' | 'image' };
  thinking?: string;
  approvalRequest?: {
    action: string;
    resource?: string;
    reason?: string;
    ticketId?: string;
    required: number;
    signed: number;
    decision: 'pending' | 'approved' | 'rejected';
    policyHash?: string;
    decidedAt?: string;
    signers: Array<{
      userId: string;
      name: string;
      role: 'operator' | 'approver' | 'auditor';
      signed: boolean;
      signedAt?: string;
      signatureHash?: string;
    }>;
  };
  linkedTaskId?: string;
  createdAt: string;
}

export const mockConversationEx = {
  agent: mockAgentMeta,
  messages: [
    {
      id: 'm1',
      role: 'user' as const,
      content: 'prod-redis-01 OOM 了，怎么处理？',
      createdAt: '2026-07-13T14:25:00Z',
    },
    {
      id: 'm2',
      role: 'assistant' as const,
      agentId: 'a1',
      agentName: 'SRE 故障处置专员',
      thinking: '用户问 OOM，我需要先查 Redis 指标 + 最近变更 + Runbook ...',
      content: '检测到 prod-redis-01 在 14:25 触发 maxmemory 限制（used_memory 7.2G / maxmemory 8G）。我已检索相关 Runbook 与最近变更记录，建议执行以下步骤：\n\n1. 临时将 maxmemory 提升至 16GB（需切换受控执行并完成双重审批）\n2. 清理过期 session 缓存（预计释放约 2GB）\n3. 排查近 24h 大 Key 写入来源',
      citations: [
        { id: 'c1', docId: 'k1', text: '当触发 OOM 时，优先检查 maxmemory-policy 与最近写入速率...', score: 0.92, source: 'Redis 故障 Runbook v3.2', page: 12 },
        { id: 'c2', docId: 'k2', text: 'prod-redis-01 资产编号 PRD-CACHE-019，归属 ACME 生产集群 cn-east-1 区...', score: 0.78, source: 'CMDB 全量资产清单' },
      ],
      createdAt: '2026-07-13T14:25:08Z',
    },
    {
      id: 'm3',
      role: 'tool' as const,
      content: 'execute_k8s_resource',
      toolCalls: [
        { id: 't1', name: 'redis-cli INFO memory', args: { host: 'prod-redis-01' }, result: 'used_memory_human: 7.2G · maxmemory_human: 8G · maxmemory_policy: noeviction', status: 'success' as const, durationMs: 120 },
        { id: 't2', name: 'redis-cli CONFIG GET maxmemory*', args: {}, result: 'maxmemory 8589934592 · maxmemory-policy noeviction', status: 'success' as const, durationMs: 80 },
      ],
      createdAt: '2026-07-13T14:25:30Z',
    },
    {
      id: 'm4',
      role: 'user' as const,
      content: '把 maxmemory 提到 16GB，并改成 volatile-lru',
      createdAt: '2026-07-13T14:26:12Z',
    },
    {
      id: 'm5',
      role: 'assistant' as const,
      agentId: 'a1',
      agentName: 'SRE 故障处置专员',
      content: '需要写操作，触发双重审批（等保 3）：',
      approvalRequest: {
        action: 'CONFIG SET maxmemory 16GB + volatile-lru',
        resource: 'prod-redis-01',
        reason: '等保 3 · 高危配置变更',
        ticketId: 'CHG-2026-0156',
        required: 2,
        signed: 1,
        decision: 'pending' as const,
        policyHash: 'pol_redis_oom_v1',
        signers: [
          { userId: 'u2', name: '王昊', role: 'operator' as const, signed: true, signedAt: '2026-07-13T14:26:40Z', signatureHash: 'sig_m5_u2' },
          { userId: 'u1', name: '平台管理员', role: 'approver' as const, signed: false },
        ],
      },
      createdAt: '2026-07-13T14:26:18Z',
    },
    {
      id: 'm6',
      role: 'assistant' as const,
      agentId: 'a1',
      agentName: 'SRE 故障处置专员',
      content: '审批通过，已执行：',
      toolCalls: [
        { id: 't3', name: 'redis-cli CONFIG SET', args: { maxmemory: '16GB', 'maxmemory-policy': 'volatile-lru' }, result: 'OK', status: 'success' as const, durationMs: 45 },
      ],
      codeBlock: { lang: 'bash', code: '$ kubectl exec -it prod-redis-01 -- redis-cli CONFIG SET maxmemory 16GB\nOK\n$ kubectl exec -it prod-redis-01 -- redis-cli CONFIG SET maxmemory-policy volatile-lru\nOK' },
      createdAt: '2026-07-13T14:28:00Z',
    },
    {
      id: 'm7',
      role: 'user' as const,
      content: '给我看下当前的内存使用曲线',
      attachment: { name: 'redis-mem-curve.png', size: '124 KB', type: 'image' },
      createdAt: '2026-07-13T14:30:00Z',
    },
    {
      id: 'm8',
      role: 'assistant' as const,
      agentId: 'a1',
      agentName: 'SRE 故障处置专员',
      content: '根据你的截图，14:00-14:25 内存从 4.8G 涨到 7.2G（斜率 13%/15min），这是异常写入。已识别 3 个大 Key：\n\n• session:user:8a3f:1.4GB\n• cache:render:html:5e2:1.1GB\n• analytics:event:raw:2026-07-13:0.9GB\n\n建议：\n1. volatile-lru 已生效（最近 5min 释放 800MB）\n2. 大 Key 拆分（运维窗口执行）\n3. 加监控告警：内存 > 70% 持续 5min',
      createdAt: '2026-07-13T14:30:20Z',
    },
  ] as ChatMessageEx[],
};

// 会话按时间分组（侧栏）
export interface SessionItem {
  id: string;
  workspaceId: string;
  ownerId: string;
  correlationId: string;
  title: string;
  preview: string;
  /** 岗位专家显示名（兼容侧栏旧字段） */
  agent: string;
  digitalPartnerId?: string;
  digitalPartnerName?: string;
  status: 'active' | 'done';
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  pinned?: boolean;
}

export const mockSessions: SessionItem[] = [
  { id: 's1', workspaceId: 'w1', ownerId: 'u1', correlationId: 'corr_session_s1', title: 'Redis OOM 处理', preview: '已扩容到 16GB + volatile-lru', agent: 'SRE 故障处置专员', digitalPartnerId: 'de-sre', digitalPartnerName: 'SRE 故障处置专员', status: 'active', createdAt: '2026-07-22T12:47:00.000Z', updatedAt: '2026-07-22T12:53:42.000Z', lastMessageAt: '2026-07-22T12:53:42.000Z', pinned: true },
  { id: 's2', workspaceId: 'w1', ownerId: 'u1', correlationId: 'corr_session_s2', title: '合规审计报告生成', preview: '本月 94 项审计已生成 PDF', agent: '安全合规核查专员', digitalPartnerId: 'de-compliance', digitalPartnerName: '安全合规核查专员', status: 'done', createdAt: '2026-07-22T10:40:00.000Z', updatedAt: '2026-07-22T11:20:00.000Z', lastMessageAt: '2026-07-22T11:20:00.000Z' },
  { id: 's3', workspaceId: 'w2', ownerId: 'u2', correlationId: 'corr_session_s3', title: 'K8s 节点扩容申请', preview: '需要 2 个 c5.2xlarge，预计影响 5 个服务', agent: '变更协同专员', digitalPartnerId: 'de-change', digitalPartnerName: '变更协同专员', status: 'active', createdAt: '2026-07-22T09:40:00.000Z', updatedAt: '2026-07-22T10:15:00.000Z', lastMessageAt: '2026-07-22T10:15:00.000Z' },
  { id: 's4', workspaceId: 'w3', ownerId: 'u3', correlationId: 'corr_session_s4', title: 'CVE 周报', preview: '本周 12 个新漏洞，建议优先修复 CVE-2026-3321', agent: '漏洞响应专员', digitalPartnerId: 'de-vulnerability', digitalPartnerName: '漏洞响应专员', status: 'done', createdAt: '2026-07-21T16:30:00.000Z', updatedAt: '2026-07-21T17:45:00.000Z', lastMessageAt: '2026-07-21T17:45:00.000Z' },
  { id: 's5', workspaceId: 'w3', ownerId: 'u3', correlationId: 'corr_session_s5', title: '告警降噪规则', preview: '合并 23 条重复 SIEM 告警', agent: '告警运营专员', digitalPartnerId: 'de-alert-ops', digitalPartnerName: '告警运营专员', status: 'done', createdAt: '2026-07-21T14:00:00.000Z', updatedAt: '2026-07-21T14:30:00.000Z', lastMessageAt: '2026-07-21T14:30:00.000Z' },
  { id: 's6', workspaceId: 'w1', ownerId: 'u1', correlationId: 'corr_session_s6', title: '客户咨询 · 价格问题', preview: '关于 Enterprise Plus 升级方案', agent: 'IT 服务台专员', digitalPartnerId: 'de-it', digitalPartnerName: 'IT 服务台专员', status: 'done', createdAt: '2026-07-10T08:30:00.000Z', updatedAt: '2026-07-10T09:10:00.000Z', lastMessageAt: '2026-07-10T09:10:00.000Z' },
  { id: 's7', workspaceId: 'w2', ownerId: 'u2', correlationId: 'corr_session_s7', title: '容量预测 · Q3', preview: '预计增长 24%，建议提前扩容', agent: '容量与性能专员', digitalPartnerId: 'de-capacity', digitalPartnerName: '容量与性能专员', status: 'done', createdAt: '2026-07-09T08:30:00.000Z', updatedAt: '2026-07-09T09:00:00.000Z', lastMessageAt: '2026-07-09T09:00:00.000Z' },
];

// Slash 命令面板
export const mockSlashCommands = [
  { cmd: '/expert', desc: '切换岗位专家', icon: 'Bot', category: 'agent' },
  { cmd: '/search', desc: '检索知识库', icon: 'Search', category: 'kb' },
  { cmd: '/task', desc: '创建任务', icon: 'ListChecks', category: 'task' },
  { cmd: '/skill', desc: '调用技能', icon: 'Wrench', category: 'tool' },
  { cmd: '/workflow', desc: '触发已装配流程技能', icon: 'Workflow', category: 'tool' },
  { cmd: '/model', desc: '切换模型', icon: 'Cpu', category: 'tool' },
  { cmd: '/doc', desc: '查询文档', icon: 'FileText', category: 'kb' },
  { cmd: '/member', desc: '@ 提及成员', icon: 'Users', category: 'collab' },
  { cmd: '/clear', desc: '清空会话', icon: 'X', category: 'tool' },
  { cmd: '/export', desc: '导出对话', icon: 'Download', category: 'tool' },
  { cmd: '/help', desc: '显示所有命令', icon: 'Sparkles', category: 'tool' },
  { cmd: '/summary', desc: '生成会话摘要', icon: 'FileText', category: 'kb' },
];

export const mockConversation: Conversation = {
  id: 's1',
  workspaceId: 'w1',
  ownerId: 'u1',
  correlationId: 'corr_session_s1',
  digitalPartnerId: 'de-sre',
  agentId: 'a1',
  title: 'Redis OOM 处理',
  createdAt: '2026-07-22T12:47:00.000Z',
  updatedAt: '2026-07-22T12:53:42.000Z',
  messages: [
    { id: 'm1', role: 'user', content: 'prod-redis-01 OOM 了，怎么处理？', createdAt: '2026-07-22T12:47:00.000Z' },
    {
      id: 'm2',
      role: 'assistant',
      agentId: 'a1',
      agentName: 'SRE 故障处置专员',
      content:
        '检测到 prod-redis-01 在 08:09:32 触发 maxmemory 限制。我已检索相关 Runbook 与最近变更记录，建议执行以下步骤：\n1. 临时提升 maxmemory 至 8GB（需双重审批）\n2. 清理已过期的会话缓存（预计释放 2.1GB）\n3. 排查最近 24h 是否存在大 Key 写入',
      citations: [
        { id: 'c1', docId: 'k1', text: '当触发 OOM 时，优先检查 maxmemory-policy 与最近写入速率...', score: 0.92, source: 'Redis 故障 Runbook v3.2', page: 12 },
        { id: 'c2', docId: 'k2', text: 'prod-redis-01 资产编号 PRD-CACHE-019，归属 ACME 生产集群...', score: 0.78, source: 'CMDB 全量资产清单' },
      ],
      toolCalls: [
        { id: 't1', name: 'redis-cli INFO memory', args: {}, status: 'success', durationMs: 120, result: 'used_memory_human: 7.2G' },
        { id: 't2', name: 'redis-cli MONITOR', args: { duration: 5 }, status: 'success', durationMs: 5200 },
      ],
      createdAt: '2026-07-22T12:47:30.000Z',
    },
    {
      id: 'm3',
      role: 'assistant',
      agentId: 'a1',
      agentName: 'SRE 故障处置专员',
      content: '正在请求双重审批：调整 maxmemory 至 8GB（需 1 名 SRE + 1 名 Admin 签发）',
      approvalRequest: {
        action: 'CONFIG SET maxmemory 8GB',
        resource: 'prod-redis-01',
        reason: '等保 3 · 高危配置变更',
        ticketId: 'CHG-2026-0198',
        required: 2,
        signed: 1,
        decision: 'pending',
        policyHash: 'pol_redis_oom_s1',
        signers: [
          {
            userId: 'u2',
            name: '王昊',
            role: 'operator',
            signed: true,
            signedAt: '2026-07-22T12:48:20.000Z',
            signatureHash: 'sig_m3_u2_op',
          },
          {
            userId: 'u1',
            name: '平台管理员',
            role: 'approver',
            signed: false,
          },
        ],
      },
      createdAt: '2026-07-22T12:48:00.000Z',
    },
  ],
};

// ============ 记忆中心：受控运行记忆，不作为权威知识直接使用 ============
const memoryRecords: MemoryRecord[] = [
  { id: 'mem-short-1', workspaceId: 'w1', ownerId: 'u1', digitalPartnerId: 'de-sre', layer: 'short_term', scope: 'user', title: 'Redis OOM 会话上下文', content: '当前会话已确认 prod-redis-01 的 maxmemory 风险，等待双重审批执行。', classification: 'internal', sourceType: 'conversation', sourceId: 'cv1', correlationId: 'corr_conversation_cv1', confidence: .92, status: 'active', expiresAt: '2026-07-22T08:00:00.000Z', createdAt: '2026-07-21T08:12:00.000Z', updatedAt: '2026-07-21T08:24:00.000Z' },
  { id: 'mem-work-1', workspaceId: 'w1', ownerId: 'u1', digitalPartnerId: 'de-sre', layer: 'working', scope: 'team', title: 'TSK-20260713-001 处置上下文', content: '已完成内存趋势验证与大 Key 识别；人工接管前需保留执行证据。', classification: 'internal', sourceType: 'task', sourceId: 't1', correlationId: 'corr_task_t1', confidence: .96, status: 'active', expiresAt: '2026-08-20T00:00:00.000Z', createdAt: '2026-07-13T08:24:00.000Z', updatedAt: '2026-07-21T08:24:00.000Z' },
  { id: 'mem-long-1', workspaceId: 'w1', ownerId: 'u1', digitalPartnerId: 'de-sre', layer: 'long_term', scope: 'workspace', title: 'Redis OOM 处置偏好', content: '生产 Redis OOM 优先检索已发布 Runbook；涉及配置写入必须由 SRE 与管理员完成双重审批。', classification: 'restricted', sourceType: 'workflow', sourceId: 'wf1', correlationId: 'corr_task_t1', confidence: .91, status: 'active', createdAt: '2026-07-18T09:00:00.000Z', updatedAt: '2026-07-21T08:24:00.000Z' },
  { id: 'mem-long-pending', workspaceId: 'w1', ownerId: 'u1', digitalPartnerId: 'de-alert-ops', layer: 'long_term', scope: 'workspace', title: '告警静默窗口经验', content: '重大活动窗口内对已知抖动告警可建议静默，但不得自动关闭 P1；需值班经理确认后执行。', classification: 'confidential', sourceType: 'task', sourceId: 't-dispatch-1', correlationId: 'corr_task_t-dispatch-1', confidence: .89, status: 'pending_review', createdAt: '2026-07-20T10:00:00.000Z', updatedAt: '2026-07-21T09:00:00.000Z' },
  { id: 'mem-long-2', workspaceId: 'w2', ownerId: 'u2', digitalPartnerId: 'de-capacity', layer: 'long_term', scope: 'workspace', title: '预发扩容验收规则', content: '预发扩容先完成 10% 灰度与回滚演练，再提交生产发布审批。', classification: 'internal', sourceType: 'task', sourceId: 't6', correlationId: 'corr_task_t6', confidence: .88, status: 'active', createdAt: '2026-07-17T09:00:00.000Z', updatedAt: '2026-07-20T08:00:00.000Z' },
];
const memoryCandidates: MemoryKnowledgeCandidate[] = [
  { id: 'mc-1', workspaceId: 'w1', memoryId: 'mem-long-pending', title: '告警静默窗口经验', summary: '重大活动窗口内对已知抖动告警可建议静默，但不得自动关闭 P1；需值班经理确认后执行。', classification: 'confidential', sourceCorrelationId: 'corr_task_t-dispatch-1', status: 'pending_review', submittedAt: '2026-07-21T09:00:00.000Z' },
];
const memoryPolicies: MemoryPolicy[] = [{ workspaceId: 'w1', shortTermTtlHours: 24, workingMemoryTtlDays: 30, dailyRefinementTime: '02:00', shortToWorkingEnabled: true, workingToLongEnabled: true, longToKnowledgeEnabled: true, minimumConfidence: .85, longTermWriteApproval: true, sensitiveDataMasking: true, longTermCapacity: 5000, usedCapacity: 312 }];
const memoryAudits: MemoryAuditEvent[] = [
  { id: 'ma-1', workspaceId: 'w1', time: '2026-07-21T09:00:00.000Z', actor: '观星', action: '提炼知识候选', target: '告警静默窗口经验', result: 'success', correlationId: 'corr_task_t-dispatch-1' },
  { id: 'ma-2', workspaceId: 'w1', time: '2026-07-21T08:24:00.000Z', actor: '夜航', action: '写入记忆', target: 'Redis OOM 会话上下文', result: 'success', correlationId: 'corr_conversation_cv1' },
];
const evolveCandidates: EvolveCandidate[] = [
  {
    id: 'evolve-1', workspaceId: 'w1', kind: 'memory_promote', status: 'pending_review',
    title: '会话偏好晋升候选', summary: '用户偏好：以后默认用邮件催办',
    submittedAt: '2026-07-21T10:00:00.000Z', createdBy: '夜航',
    payload: { targetLayer: 'working', title: '用户偏好 · 邮件催办', content: '以后默认用邮件催办', scope: 'user', confidence: 0.9 },
  },
];

// ============ 运行时 Mock 领域状态 ============
// 让会话中的行动、审批、任务、审计和通知共享同一份数据。
// 后续切换真实后端时，页面只需保留相同的 API 契约。
type MockDomainEvent = { id: string; time: string; user: string; action: string; target: string; result: 'success' | 'failed' };
const mockDomain = {
  audits: mockAuditStream.map((event: any) => ({ ...event, result: event.result === 'failed' ? 'failed' as const : 'success' as const })),
  messages: [...mockMessageStream] as any[],
  actions: new Map<string, { id: string; conversationId: string; status: 'pending' | 'approved' | 'executed' | 'rejected'; taskId?: string; approvedSignerIndexes?: number[] }>(),
};
const taskDomain = createTaskDomain(mockTasks);
const scheduleDomain = createScheduleDomain(mockScheduledTasks);

function mockId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function appendDomainEvent(action: string, target: string, result: MockDomainEvent['result'] = 'success') {
  const event: MockDomainEvent = { id: mockId('audit'), time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), user: '数字伙伴', action, target, result };
  mockDomain.audits.unshift(event);
  mockDomain.messages.unshift({
    id: mockId('msg'),
    channel: '飞书',
    target: '会话工作台',
    status: result === 'success' ? 'delivered' : 'failed',
    tone: result === 'success' ? 'success' : 'warning',
    content: `${action}：${target}`,
    time: event.time,
  });
  return event;
}

function appendTaskDomainEvent(task: ControlledTask) {
  const event = task.auditEvents.at(-1);
  if (event) appendDomainEvent(event.action, task.code, event.tone === 'error' ? 'failed' : 'success');
}

// ============ Mock 路由 ============

export async function mockHandler(path: string, opts: { method?: string; body?: unknown; query?: Record<string, any>; headers?: Record<string, string> }): Promise<unknown> {
  await sleep(80); // 模拟网络延迟
  const method = opts.method?.toUpperCase() ?? 'GET';
  const identity = mockIdentity(opts.headers);

  // Mock 阶段也执行服务端式的职责边界：前端隐藏按钮不构成授权校验。
  if (identity && path !== '/api/auth/login') {
    const evolveCountersign = /^\/api\/evolve\/candidates\/[^/]+\/(approve|reject)$/.test(path);
    if (identity.role === 'auditor' && method !== 'GET' && !evolveCountersign) {
      throw new Error('E_AUDITOR_READ_ONLY: 审计用户仅可读取证据，不能修改平台资源');
    }
    if (identity.role === 'user' && (path.startsWith('/api/model') || path.startsWith('/api/channel') || path.startsWith('/api/access'))) {
      throw new Error('E_ROLE_FORBIDDEN: 普通用户无权管理平台能力或访问治理');
    }
    if (identity.role === 'user' && method !== 'GET' && /\/publish(?:$|[/?])/.test(path)) {
      throw new Error('E_RELEASE_REQUEST_REQUIRED: 普通用户不能直接发布生产，请提交发布申请');
    }
  }

  // 工作区控制面：当前 Mock 登录用户仅能访问 tenant-acme 的成员工作区。
  const workspaceContext = () => ({ workspaceId: opts.headers?.['x-workspace-id'] ?? identity?.workspaceId ?? 'w1', actor: identity?.name ?? opts.headers?.['x-mock-actor'] ?? '王昊', canWrite: identity ? identity.permissions.includes('workspace.write') : (opts.headers?.['x-mock-permissions'] ? opts.headers['x-mock-permissions'].includes('workspace.write') : true) });

  // M01 路由（运营总览）：委托给 m01-mock-handlers.ts 的 dispatcher，行为与内联实现等价。
  const requestedWorkspaceId = opts.headers?.['x-workspace-id'] ?? identity?.workspaceId ?? 'w1';
  const homeExtraLiveFor = (workspaceId: string) => {
    const members = (mockWorkspaceMembers[workspaceId as keyof typeof mockWorkspaceMembers] ?? []).map((member) => ({
      id: member.id, name: member.name, role: member.role, lastActive: member.lastActive,
    }));
    const source = buildHomeExtraLive({
      workspaceId,
      tasks: taskDomain.list().filter((task) => !task.workspaceId || task.workspaceId === workspaceId),
      employees: mockDigitalPartners.filter((item) => item.workspaceId === workspaceId),
      sessions: mockSessions.filter((item) => item.workspaceId === workspaceId),
      members,
      usageMeters: mockUsageMeters.filter((item) => item.workspaceId === workspaceId),
    });
    return {
      ...source,
      slaAlerts: source.slaAlerts.map((alert) => ({ ...alert, ...homeAlertAcknowledgements.get(`${workspaceId}:${alert.id}`) })),
    };
  };
  const m01Result = dispatchM01Handler({
    homeExtraLiveFor,
    mockIdentity: mockIdentity as unknown as M01Context['mockIdentity'],
    workspaceContext,
    mockReleaseApprovals,
    deliveryAttempts,
    mockDigitalPartners: mockDigitalPartners as unknown as M01Context['mockDigitalPartners'],
    mockUsageMeters,
    mockBackups,
    homeAlertAcknowledgements,
    appendDomainEvent,
    taskDomain: taskDomain as unknown as M01Context['taskDomain'],
  } satisfies M01Context, path, method, identity, requestedWorkspaceId, opts.body);
  if (m01Result !== undefined) return m01Result;

  const workspaceAudit = (workspaceId: string, action: string, target: string, result: 'success' | 'failed' = 'success', reason?: string) => { const context = workspaceContext(); const event: WorkspaceAuditEvent = { id: mockId('workspace_audit'), workspaceId, time: new Date().toISOString(), actor: context.actor, action, target, result, reason, correlationId: mockId('workspace_corr') }; workspaceAudits.unshift(event); return event; };
  const requireWorkspace = (workspaceId: string, write = false) => { const context = workspaceContext(); const workspace = mockWorkspaces.find((item) => item.id === workspaceId && item.tenantId === (identity?.tenantId ?? 'tenant-acme')); if (!workspace) throw new Error('E_WORKSPACE_NOT_FOUND'); if (identity ? !identity.workspaceIds.includes(workspaceId) : context.workspaceId !== workspaceId) throw new Error('E_WORKSPACE_SCOPE: 无权访问其他工作区资源'); if (write && !context.canWrite) throw new Error('E_WORKSPACE_WRITE_FORBIDDEN'); return workspace; };
  const currentWorkspaceId = workspaceContext().workspaceId;
  const inCurrentWorkspace = <T extends { workspaceId?: string }>(item: T) => item.workspaceId === currentWorkspaceId;
  const isAdministrator = !identity || identity.role === 'admin';
  const canReadScopedResource = <T extends { ownerId?: string; createdBy?: string; classification?: string }>(item: T) => {
    if (!identity || isAdministrator) return true;
    if (item.classification === 'restricted' || item.classification === 'confidential') return item.ownerId === identity.id || item.createdBy === identity.id;
    return true; // 内部级资产可在已授权工作区协作使用。
  };
  const canChangeScopedResource = <T extends { ownerId?: string; createdBy?: string }>(item: T) => !identity || isAdministrator || item.ownerId === identity.id || item.createdBy === identity.id;
  const requireAdministrator = (operation: string) => { if (identity && !isAdministrator) throw new Error(`E_ADMIN_REQUIRED: ${operation} 仅限管理员执行`); };
  const evaluateZeroTrust = (input: { resource: ZeroTrustResource; action: ZeroTrustAction; classification?: ZeroTrustEvent['classification']; external?: boolean; correlationId?: string }): ZeroTrustEvaluation => {
    const classification = input.classification ?? 'internal';
    let decision: ZeroTrustDecision = 'allow';
    let policyId = 'zt-default-allow';
    let reason = '身份、工作区与资源范围校验通过';
    const obligations: ZeroTrustEvaluation['obligations'] = ['audit'];
    const enabled = (id: string) => zeroTrustPolicies.find((policy) => policy.id === id && policy.enabled);
    if (identity?.role === 'auditor' && input.action !== 'read' && input.action !== 'export' && enabled('zt-auditor-readonly')) { decision = 'deny'; policyId = 'zt-auditor-readonly'; reason = '审计用户仅可读取授权范围内证据'; }
    else if (identity?.role === 'user' && input.action === 'publish' && enabled('zt-user-production')) { decision = 'approval_required'; policyId = 'zt-user-production'; reason = '普通用户生产变更需管理员审批'; obligations.push('require_approval'); }
    else if (classification === 'restricted' && input.external && enabled('zt-restricted-egress')) { decision = 'deny'; policyId = 'zt-restricted-egress'; reason = '受限数据不得发送到外部出口'; obligations.push('mask_sensitive_fields'); }
    else if (input.resource === 'skill' && input.action === 'run' && input.external && enabled('zt-tool-approval')) { decision = 'approval_required'; policyId = 'zt-tool-approval'; reason = '高风险工具调用需复核'; obligations.push('require_approval', 'human_handoff'); }
    else if (identity?.role === 'user' && input.resource === 'memory' && input.action === 'write' && enabled('zt-memory-governance')) { decision = 'deny'; policyId = 'zt-memory-governance'; reason = '普通用户不能修改记忆治理策略'; }
    const result: ZeroTrustEvaluation = { decision, policyId, reason, obligations, correlationId: input.correlationId ?? mockId('zt_corr'), riskScore: classification === 'restricted' ? 85 : input.external ? 60 : input.action === 'publish' ? 55 : 18 };
    zeroTrustEvents.unshift({ id: mockId('zt_event'), time: new Date().toISOString(), tenantId: identity?.tenantId ?? 'tenant-acme', workspaceId: currentWorkspaceId, actor: identity?.name ?? '系统', resource: input.resource, action: input.action, classification, decision, policyId, reason, correlationId: result.correlationId });
    return result;
  };
  const knowledgePackageInCurrentWorkspace = (packageId: string) => inCurrentWorkspace(mockKnowledgePackages.find((item) => item.id === packageId) ?? { workspaceId: undefined });
  const workflowControl = workflowControlFor(currentWorkspaceId);
  const memoryAudit = (action: string, target: string, result: 'success' | 'failed' = 'success', correlationId = mockId('memory_corr')) => {
    const event: MemoryAuditEvent = { id: mockId('memory_audit'), workspaceId: currentWorkspaceId, time: new Date().toISOString(), actor: workspaceContext().actor, action, target, result, correlationId };
    memoryAudits.unshift(event);
    return event;
  };
  if (path === '/api/zero-trust/overview' && method === 'GET') {
    const events = zeroTrustEvents.filter((event) => !identity || identity.workspaceIds.includes(event.workspaceId));
    const enabled = zeroTrustPolicies.filter((policy) => policy.enabled).length;
    const blocked = events.filter((event) => event.decision === 'deny').length;
    const approvals = events.filter((event) => event.decision === 'approval_required').length;
    const masked = events.filter((event) => event.decision === 'mask').length;
    const activeTempAuth = temporaryAuthorizations.filter((item) => item.status === 'active' && (!identity || identity.workspaceIds.includes(item.workspaceId))).length;
    return {
      policyCount: zeroTrustPolicies.length,
      enabledCount: enabled,
      eventCount: events.length,
      activeTempAuth,
      policies: enabled,
      blocked,
      approvals,
      masked,
      risk: blocked > 0 || approvals > 0 ? 'attention' : 'normal',
      updatedAt: new Date().toISOString(),
    };
  }
  if (path === '/api/zero-trust/policies' && method === 'GET') return zeroTrustPolicies;
  if (path === '/api/zero-trust/policies' && method === 'POST') {
    requireAdministrator('创建零信任策略'); const body = (opts.body ?? {}) as Partial<ZeroTrustPolicy>;
    if (!body.name?.trim() || !body.resource || !body.action || !body.decision) throw new Error('E_ZERO_TRUST_POLICY_INVALID');
    const policy: ZeroTrustPolicy = { id: mockId('zt_policy'), name: body.name.trim(), resource: body.resource, action: body.action, scope: body.scope ?? 'workspace', condition: body.condition?.trim() ?? '满足工作区访问范围', decision: body.decision, enabled: true, version: 1, updatedAt: new Date().toISOString(), updatedBy: identity?.name ?? '平台管理员' };
    zeroTrustPolicies.unshift(policy); workspaceAudit(currentWorkspaceId, '创建零信任策略', policy.name); return policy;
  }
  const zeroTrustPolicyRoute = path.match(/^\/api\/zero-trust\/policies\/([^/]+)$/);
  if (zeroTrustPolicyRoute && method === 'PATCH') {
    requireAdministrator('更新零信任策略'); const policy = zeroTrustPolicies.find((item) => item.id === zeroTrustPolicyRoute[1]); if (!policy) throw new Error('E_ZERO_TRUST_POLICY_NOT_FOUND');
    if (policy.baseline && (opts.body as Partial<ZeroTrustPolicy>)?.enabled === false) throw new Error('E_ZERO_TRUST_BASELINE_LOCKED: 租户安全基线不可停用');
    Object.assign(policy, opts.body ?? {}, { version: policy.version + 1, updatedAt: new Date().toISOString(), updatedBy: identity?.name ?? '平台管理员' }); workspaceAudit(currentWorkspaceId, '更新零信任策略', policy.name); return policy;
  }
  if (path === '/api/zero-trust/evaluate' && method === 'POST') {
    const body = (opts.body ?? {}) as { resource: ZeroTrustResource; action: ZeroTrustAction; classification?: ZeroTrustEvent['classification']; external?: boolean; correlationId?: string };
    if (!body.resource || !body.action) throw new Error('E_ZERO_TRUST_EVALUATION_INVALID');
    return evaluateZeroTrust(body);
  }
  if (path === '/api/zero-trust/events' && method === 'GET') return zeroTrustEvents.filter((event) => !identity || identity.workspaceIds.includes(event.workspaceId));
  if (path === '/api/zero-trust/authorizations' && method === 'GET') return temporaryAuthorizations.filter((item) => !identity || identity.workspaceIds.includes(item.workspaceId));
  if (path === '/api/zero-trust/authorizations' && method === 'POST') {
    requireAdministrator('授予临时访问'); const body = (opts.body ?? {}) as Partial<TemporaryAuthorization>;
    if (!body.subjectName?.trim() || !body.workspaceId || !body.environment || !body.resource || !body.action || !body.reason?.trim() || !body.expiresAt) throw new Error('E_TEMPORARY_AUTH_INVALID');
    if (body.environment === 'production') throw new Error('E_TEMPORARY_AUTH_PRODUCTION_REQUIRES_DUAL_APPROVAL');
    const expiry = new Date(body.expiresAt).getTime(); if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 24 * 3600_000) throw new Error('E_TEMPORARY_AUTH_TTL_INVALID: 临时授权最长 24 小时');
    requireWorkspace(body.workspaceId); const authorization: TemporaryAuthorization = { id: mockId('zta'), subjectId: body.subjectId ?? mockId('subject'), subjectName: body.subjectName.trim(), workspaceId: body.workspaceId, environment: body.environment, resource: body.resource, action: body.action, reason: body.reason.trim(), status: 'active', expiresAt: body.expiresAt, approvedBy: identity?.name ?? '平台管理员' };
    temporaryAuthorizations.unshift(authorization); workspaceAudit(body.workspaceId, '授予临时零信任授权', `${authorization.subjectName} · ${authorization.resource}:${authorization.action}`); return authorization;
  }
  const temporaryAuthRoute = path.match(/^\/api\/zero-trust\/authorizations\/([^/]+)\/revoke$/);
  if (temporaryAuthRoute && method === 'POST') { requireAdministrator('回收临时访问'); const authorization = temporaryAuthorizations.find((item) => item.id === temporaryAuthRoute[1]); if (!authorization) throw new Error('E_TEMPORARY_AUTH_NOT_FOUND'); authorization.status = 'revoked'; workspaceAudit(authorization.workspaceId, '回收临时零信任授权', authorization.subjectName); return authorization; }
  if (path === '/api/access/governance' && method === 'GET') {
    if (!identity?.permissions.includes('access.read')) throw new Error('E_ACCESS_READ_FORBIDDEN');
    const now = Date.now();
    const conflicts = mockAccessGrants.filter((grant) => grant.role === 'auditor' && grant.workspaceIds.includes('w1')).map((grant) => ({ id: `conflict-${grant.id}`, subjectName: grant.subjectName, reason: '审计角色拥有生产工作区范围，需确认其不含任何写权限', severity: 'medium' as const }));
    return { grants: mockAccessGrants, reviews: mockAccessReviews, rules: mockSodRules, conflicts, generatedAt: new Date(now).toISOString() };
  }
  if (path === '/api/access/grants' && method === 'POST') {
    if (!identity?.permissions.includes('access.write')) throw new Error('E_ACCESS_WRITE_FORBIDDEN');
    const body = (opts.body ?? {}) as Partial<AccessGrant>;
    if (!body.subjectName?.trim() || !body.role || !body.workspaceIds?.length || !body.environmentScopes?.length) throw new Error('E_ACCESS_GRANT_INVALID');
    const grant: AccessGrant = { id: mockId('grant'), subjectId: body.subjectId ?? mockId('subject'), subjectName: body.subjectName.trim(), role: body.role, tenantId: 'tenant-acme', workspaceIds: body.workspaceIds, environmentScopes: body.environmentScopes, status: body.expiresAt ? 'expiring' : 'active', expiresAt: body.expiresAt, grantedBy: identity.name, createdAt: new Date().toISOString() };
    mockAccessGrants.unshift(grant);
    workspaceAudit(grant.workspaceIds[0]!, '授予访问范围', `${grant.subjectName} · ${grant.role}`);
    return grant;
  }
  const grantAction = path.match(/^\/api\/access\/grants\/([^/]+)\/(revoke|extend)$/);
  if (grantAction && method === 'POST') {
    if (!identity?.permissions.includes('access.write')) throw new Error('E_ACCESS_WRITE_FORBIDDEN');
    const grant = mockAccessGrants.find((item) => item.id === grantAction[1]);
    if (!grant) throw new Error('E_ACCESS_GRANT_NOT_FOUND');
    if (grant.subjectId === identity.id) throw new Error('E_ACCESS_SELF_ESCALATION: 管理员不能修改自己的授权范围');
    const body = (opts.body ?? {}) as { expiresAt?: string };
    if (grantAction[2] === 'revoke') grant.status = 'expired';
    else { grant.status = 'active'; grant.expiresAt = body.expiresAt; }
    workspaceAudit(grant.workspaceIds[0]!, grantAction[2] === 'revoke' ? '回收访问范围' : '延长临时授权', `${grant.subjectName} · ${grant.role}`);
    return grant;
  }
  if (path === '/api/access/reviews/complete' && method === 'POST') {
    if (!identity?.permissions.includes('access.write')) throw new Error('E_ACCESS_WRITE_FORBIDDEN');
    const body = (opts.body ?? {}) as { id?: string };
    const review = mockAccessReviews.find((item) => item.id === body.id);
    if (!review) throw new Error('E_ACCESS_REVIEW_NOT_FOUND');
    review.reviewed = review.total; review.status = 'completed';
    workspaceAudit('w1', '完成权限复核', review.title);
    return review;
  }
  if (path === '/api/release-approvals' && method === 'GET') {
    if (!identity?.permissions.includes('audit.read') && identity?.role !== 'admin') throw new Error('E_RELEASE_READ_FORBIDDEN');
    return mockReleaseApprovals.filter((item) => !identity || identity.workspaceIds.includes(item.workspaceId));
  }
  if (path === '/api/release-approvals' && method === 'POST') {
    if (!identity || identity.role === 'auditor') throw new Error('E_RELEASE_REQUEST_FORBIDDEN');
    const body = (opts.body ?? {}) as Partial<ReleaseApproval>;
    if (!body.resourceName?.trim() || !body.resourceType) throw new Error('E_RELEASE_REQUEST_INVALID');
    const workspaceId = body.workspaceId ?? currentWorkspaceId;
    requireWorkspace(workspaceId);
    const policy = evaluateZeroTrust({ resource: body.resourceType, action: 'publish', classification: 'internal', correlationId: body.correlationId });
    if (policy.decision === 'deny') throw new Error(`E_ZERO_TRUST_DENY: ${policy.reason}`);
    const approval: ReleaseApproval = { id: mockId('approval'), workspaceId, environment: 'production', resourceType: body.resourceType, resourceName: body.resourceName.trim(), submittedBy: identity.name, submittedById: identity.id, submittedAt: new Date().toISOString(), status: 'pending', risk: body.risk ?? 'medium', correlationId: policy.correlationId };
    mockReleaseApprovals.unshift(approval);
    workspaceAudit(workspaceId, '提交生产发布申请', approval.resourceName);
    return approval;
  }
  const approvalAction = path.match(/^\/api\/release-approvals\/([^/]+)\/(approve|reject)$/);
  if (approvalAction && method === 'POST') {
    if (!identity?.permissions.includes('release.approve')) throw new Error('E_RELEASE_APPROVE_FORBIDDEN');
    const approval = mockReleaseApprovals.find((item) => item.id === approvalAction[1]);
    if (!approval) throw new Error('E_RELEASE_NOT_FOUND');
    if (approval.submittedById === identity.id) throw new Error('E_SOD_SELF_APPROVAL: 创建者不能审批自己的生产发布');
    approval.status = approvalAction[2] === 'approve' ? 'approved' : 'rejected';
    workspaceAudit(approval.workspaceId, approval.status === 'approved' ? '审批生产发布' : '驳回生产发布', approval.resourceName, 'success');
    return approval;
  }
  if (path === '/api/audit-center' && method === 'GET') {
    if (!identity?.permissions.includes('audit.read')) throw new Error('E_AUDIT_READ_FORBIDDEN');
    const scoped = workspaceAudits.filter((event) => !identity || identity.workspaceIds.includes(event.workspaceId));
    const zeroTrust = zeroTrustEvents.filter((event) => !identity || identity.workspaceIds.includes(event.workspaceId)).map((event) => ({ id: event.id, time: event.time, workspaceId: event.workspaceId, actor: event.actor, action: `零信任：${event.decision}`, target: `${event.resource}:${event.action} · ${event.reason}`, result: event.decision === 'deny' ? 'failed' as const : 'success' as const, correlationId: event.correlationId }));
    return [...scoped, ...memoryAudits.filter((event) => !identity || identity.workspaceIds.includes(event.workspaceId)).map((event) => ({ ...event, result: event.result, target: event.target })), ...zeroTrust].sort((a, b) => b.time.localeCompare(a.time));
  }
  if (path === '/api/audit-center/export' && method === 'POST') {
    if (!identity?.permissions.includes('audit.export')) throw new Error('E_AUDIT_EXPORT_FORBIDDEN');
    const count = workspaceAudits.filter((event) => !identity || identity.workspaceIds.includes(event.workspaceId)).length;
    workspaceAudit(currentWorkspaceId, '登记导出脱敏审计证据', `共 ${count} 条记录`);
    return { id: mockId('export'), status: 'registered', filename: `audit-evidence-${new Date().toISOString().slice(0, 10)}.zip`, recordCount: count, masked: true, registered: true, downloadAvailable: false };
  }
  if (path === '/api/workspaces' && method === 'GET') return mockWorkspaces.filter((item) => item.tenantId === (identity?.tenantId ?? 'tenant-acme') && (!identity || identity.workspaceIds.includes(item.id)));
  if (path === '/api/workspaces' && method === 'POST') {
    const context = workspaceContext();
    if (!context.canWrite) throw new Error('E_WORKSPACE_WRITE_FORBIDDEN');
    const body = (opts.body ?? {}) as Partial<Workspace> & {
      quota?: {
        seats?: { limit?: number } | number;
        agents?: { limit?: number } | number;
        tokens?: { limit?: number } | number;
        concurrency?: { limit?: number } | number;
        budgetUsd?: { limit?: number } | number;
      };
    };
    if (!body.name?.trim()) throw new Error('E_WORKSPACE_NAME_REQUIRED');
    const item: Workspace = {
      id: mockId('workspace'),
      tenantId: 'tenant-acme',
      ownerId: 'u1',
      status: 'active',
      name: body.name.trim(),
      region: body.region ?? 'cn-east-1',
      plan: body.plan ?? 'enterprise',
      memberCount: 1,
      complianceScore: 80,
      createdAt: new Date().toISOString(),
    };
    mockWorkspaces.unshift(item);
    const quotaLimitOf = (raw: { limit?: number } | number | undefined, fallback: number) => {
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      if (raw && typeof raw === 'object' && typeof raw.limit === 'number' && Number.isFinite(raw.limit)) return raw.limit;
      return fallback;
    };
    workspaceQuotas.unshift({
      workspaceId: item.id,
      seats: { used: 1, limit: quotaLimitOf(body.quota?.seats, 50) },
      agents: { used: 0, limit: quotaLimitOf(body.quota?.agents, 20) },
      concurrency: { used: 0, limit: quotaLimitOf(body.quota?.concurrency, 10) },
      tokens: { used: 0, limit: quotaLimitOf(body.quota?.tokens, 1_000_000) },
      budgetUsd: { used: 0, limit: quotaLimitOf(body.quota?.budgetUsd, 5000) },
    });
    workspaceAudit(item.id, '创建工作区', item.name);
    return item;
  }
  const workspaceAction = path.match(/^\/api\/workspaces\/([^/]+)\/(freeze|archive|transfer|runtime|report|impact)$/);
  if (workspaceAction) { const [, id, action] = workspaceAction; const workspace = requireWorkspace(id, action !== 'impact' && action !== 'report'); const body = (opts.body ?? {}) as any; if (action === 'impact') return { blocked: workspaceBindings.some((item) => item.workspaceId === id && item.status === 'active'), bindings: workspaceBindings.filter((item) => item.workspaceId === id) }; if (action === 'report') return { workspace, quota: workspaceQuotas.find((item) => item.workspaceId === id), governanceScore: workspace.complianceScore, auditCount: workspaceAudits.filter((item) => item.workspaceId === id).length }; if (action === 'freeze' || action === 'archive') { if (workspaceBindings.some((item) => item.workspaceId === id && item.status === 'active') && !body.force) throw new Error('E_WORKSPACE_IN_USE'); workspace.status = action === 'freeze' ? 'frozen' : 'archived'; workspaceAudit(id, action === 'freeze' ? '冻结工作区' : '归档工作区', workspace.name, 'success', body.reason); return workspace; } if (action === 'transfer') { if (!body.ownerId) throw new Error('E_WORKSPACE_OWNER_REQUIRED'); workspace.ownerId = body.ownerId; workspaceAudit(id, '移交工作区负责人', workspace.name, 'success', body.reason); return workspace; } const event: WorkspaceRuntimeEvent = { id: mockId('runtime'), workspaceId: id, type: body.type ?? 'incident', status: 'open', detail: body.detail ?? '运行治理动作', createdAt: new Date().toISOString() }; workspaceRuntimeEvents.unshift(event); workspaceAudit(id, `运行治理：${event.type}`, workspace.name, 'success', body.reason); return event; }
  if (path.startsWith('/api/workspaces/') && path.endsWith('/partners')) {
    const id = path.split('/')[3]; requireWorkspace(id);
    return mockDigitalPartners
      .filter((item) => item.workspaceId === id)
      .map((item) => ({ id: item.id, name: item.name, role: item.role, department: item.department, lifecycle: item.lifecycle, environment: item.environment }));
  }
  if (path.startsWith('/api/workspaces/') && path.endsWith('/tools')) {
    const id = path.split('/')[3]; requireWorkspace(id);
    return mockWorkspaceTools[id as keyof typeof mockWorkspaceTools] ?? null;
  }
  if (path.startsWith('/api/workspaces/') && path.endsWith('/members')) {
    const id = path.split('/')[3]; requireWorkspace(id);
    return mockWorkspaceMembers[id as keyof typeof mockWorkspaceMembers] ?? [];
  }
  if (path === '/api/workspace-switch-history') return mockWorkspaceSwitchHistory;
  const workspaceResource = path.match(/^\/api\/workspaces\/([^/]+)\/(bindings|environments|policy|quota|audit)$/);
  if (workspaceResource) { const [, id, resource] = workspaceResource; requireWorkspace(id, method !== 'GET'); const records: Record<string, any> = { bindings: workspaceBindings.filter((item) => item.workspaceId === id), environments: workspaceEnvironments.filter((item) => item.workspaceId === id), policy: workspacePolicies.find((item) => item.workspaceId === id), quota: workspaceQuotas.find((item) => item.workspaceId === id), audit: workspaceAudits.filter((item) => item.workspaceId === id) }; if (method === 'GET') return records[resource]; const body = (opts.body ?? {}) as any; if (resource === 'bindings') { const binding: WorkspaceBinding = { id: mockId('binding'), workspaceId: id, environment: body.environment ?? 'sandbox', kind: body.kind, name: body.name, status: 'active' }; workspaceBindings.unshift(binding); workspaceAudit(id, '绑定资源', binding.name); return binding; } if (resource === 'policy') { if ((body.dataClassification === 'restricted' || records.policy?.dataClassification === 'restricted') && body.egressAllowed) throw new Error('E_WORKSPACE_EGRESS_BLOCKED'); const policy = workspacePolicies.find((item) => item.workspaceId === id); if (policy) Object.assign(policy, body); else workspacePolicies.push({ workspaceId: id, dataClassification: 'internal', egressAllowed: false, toolAllowlist: [], retentionDays: 365, exceptionStatus: 'none', ...body }); workspaceAudit(id, '更新工作区策略', id); return workspacePolicies.find((item) => item.workspaceId === id); } return records[resource]; }

  // 跨资产运营视图：数字伙伴 + 任务 live-aggregate（对齐后端 opsOverviewLive）—— 委托给 m01-mock-handlers.ts dispatcher
  // （执行顺序上 dispatcher 已在文件顶部抢答；此处保留以防万一 dispatcher 漏匹配）。

  // 记忆中心：短期、工作、长期记忆各自独立保留周期；长期记忆只能受控提炼为知识候选。
  if (path === '/api/memory/overview' && method === 'GET') {
    const records = memoryRecords.filter(inCurrentWorkspace).filter(canReadScopedResource);
    const candidates = memoryCandidates.filter(inCurrentWorkspace);
    const active = (layer: MemoryRecord['layer']) => records.filter((item) => item.layer === layer && item.status === 'active').length;
    return { workspaceId: currentWorkspaceId, totals: { shortTerm: active('short_term'), working: active('working'), longTerm: active('long_term'), pendingCandidates: candidates.filter((item) => item.status === 'pending_review').length }, policy: memoryPolicies.find((item) => item.workspaceId === currentWorkspaceId) ?? { workspaceId: currentWorkspaceId, shortTermTtlHours: 24, workingMemoryTtlDays: 30, dailyRefinementTime: '02:00', shortToWorkingEnabled: true, workingToLongEnabled: true, longToKnowledgeEnabled: true, minimumConfidence: .85, longTermWriteApproval: true, sensitiveDataMasking: true, longTermCapacity: 5000, usedCapacity: 0 } };
  }
  if (path === '/api/memory/records' && method === 'GET') return memoryRecords.filter(inCurrentWorkspace).filter(canReadScopedResource);
  if (path === '/api/memory/records' && method === 'POST') {
    const body = (opts.body ?? {}) as Partial<MemoryRecord>;
    if (!body.title?.trim() || !body.content?.trim() || !body.layer) throw new Error('E_MEMORY_INVALID: 标题、内容与记忆层级不能为空');
    if (body.layer === 'long_term' && (memoryPolicies.find((item) => item.workspaceId === currentWorkspaceId)?.longTermWriteApproval ?? true)) throw new Error('E_MEMORY_APPROVAL_REQUIRED: 长期记忆写入需要通过提炼审核');
    const now = new Date().toISOString();
    const record: MemoryRecord = { id: mockId('memory'), workspaceId: currentWorkspaceId, ownerId: identity?.id ?? 'u1', digitalPartnerId: body.digitalPartnerId, layer: body.layer, scope: body.scope ?? 'user', title: body.title.trim(), content: body.content.trim(), classification: body.classification ?? 'internal', sourceType: body.sourceType ?? 'manual', sourceId: body.sourceId ?? 'manual', correlationId: body.correlationId ?? mockId('memory_corr'), confidence: body.confidence ?? .8, status: 'active', expiresAt: body.expiresAt, createdAt: now, updatedAt: now };
    memoryRecords.unshift(record); memoryAudit('写入记忆', record.title, 'success', record.correlationId); return record;
  }
  const memoryRecordRoute = path.match(/^\/api\/memory\/records\/([^/]+)(?:\/(expire|candidate))?$/);
  if (memoryRecordRoute) {
    const [, id, action] = memoryRecordRoute; const record = memoryRecords.find((item) => item.id === id);
    if (!record || !inCurrentWorkspace(record) || !canChangeScopedResource(record)) throw new Error('E_MEMORY_OWNER_SCOPE: 仅可维护本人创建的记忆');
    if (method === 'DELETE' && !action) { record.status = 'revoked'; record.updatedAt = new Date().toISOString(); memoryAudit('删除记忆', record.title, 'success', record.correlationId); return { id, status: 'revoked' }; }
    if (method === 'POST' && action === 'expire') { record.status = 'expired'; record.updatedAt = new Date().toISOString(); memoryAudit('使记忆失效', record.title, 'success', record.correlationId); return record; }
    if (method === 'POST' && action === 'candidate') {
      if (record.layer !== 'long_term') throw new Error('E_MEMORY_LAYER_INVALID: 仅长期记忆可以提炼为知识候选');
      const existing = memoryCandidates.find((item) => item.memoryId === record.id && item.status === 'pending_review'); if (existing) return existing;
      const candidate: MemoryKnowledgeCandidate = { id: mockId('memory_candidate'), workspaceId: currentWorkspaceId, memoryId: record.id, title: record.title, summary: record.content.slice(0, 180), classification: record.classification, sourceCorrelationId: record.correlationId, status: 'pending_review', submittedAt: new Date().toISOString() };
      memoryCandidates.unshift(candidate); record.status = 'pending_review'; memoryAudit('提炼知识候选', record.title, 'success', record.correlationId); return candidate;
    }
  }
  if (path === '/api/memory/candidates' && method === 'GET') return memoryCandidates.filter(inCurrentWorkspace).filter((candidate) => canReadScopedResource(memoryRecords.find((record) => record.id === candidate.memoryId) ?? {}));
  const memoryCandidateRoute = path.match(/^\/api\/memory\/candidates\/([^/]+)\/(approve|reject)$/);
  if (memoryCandidateRoute && method === 'POST') {
    evaluateZeroTrust({ resource: 'memory', action: 'write' });
    requireAdministrator('审核知识候选');
    const candidate = memoryCandidates.find((item) => item.id === memoryCandidateRoute[1]);
    if (!candidate || !inCurrentWorkspace(candidate)) throw new Error('E_WORKSPACE_SCOPE: 无权操作其他工作区知识候选');
    const approved = memoryCandidateRoute[2] === 'approve'; candidate.status = approved ? 'approved' : 'rejected'; candidate.reviewedAt = new Date().toISOString(); candidate.reviewer = workspaceContext().actor;
    const record = memoryRecords.find((item) => item.id === candidate.memoryId)!;
    if (approved) {
      const version = { id: mockId('knowledge_package_version'), version: 'v0.1', status: 'draft' as const, indexVersion: `idx-${Date.now()}`, qualityScore: Math.round(record.confidence * 100), changeSummary: `由记忆候选 ${candidate.id} 受控提炼` };
      const knowledgePackage: KnowledgePackage = { id: mockId('knowledge_package'), workspaceId: currentWorkspaceId, ownerId: 'u1', environment: 'sandbox', name: candidate.title, description: candidate.summary, domain: '运行经验', classification: candidate.classification, owner: workspaceContext().actor, status: 'draft', documentCount: 1, consumers: 0, currentVersion: version, versions: [version] };
      mockKnowledgePackages.unshift(knowledgePackage); candidate.knowledgePackageId = knowledgePackage.id; record.status = 'promoted'; appendKnowledgeAudit('从记忆候选创建知识包', knowledgePackage.name);
    } else record.status = 'active';
    memoryAudit(approved ? '审核通过知识候选' : '拒绝知识候选', candidate.title, 'success', candidate.sourceCorrelationId); return candidate;
  }
  if (path === '/api/memory/refinement/run' && method === 'POST') {
    evaluateZeroTrust({ resource: 'memory', action: 'write' });
    requireAdministrator('执行记忆渐进提炼');
    const policy = memoryPolicies.find((item) => item.workspaceId === currentWorkspaceId) ?? { workspaceId: currentWorkspaceId, shortTermTtlHours: 24, workingMemoryTtlDays: 30, dailyRefinementTime: '02:00', shortToWorkingEnabled: true, workingToLongEnabled: true, longToKnowledgeEnabled: true, minimumConfidence: .85, longTermWriteApproval: true, sensitiveDataMasking: true, longTermCapacity: 5000, usedCapacity: 0 };
    const now = new Date().toISOString(); let workingCreated = 0; let longCreated = 0; let candidatesCreated = 0;
    if (policy.shortToWorkingEnabled) memoryRecords.filter((item) => inCurrentWorkspace(item) && item.layer === 'short_term' && item.status === 'active').forEach((source) => {
      if (memoryRecords.some((item) => item.layer === 'working' && item.sourceId === source.sourceId)) return;
      memoryRecords.unshift({ ...source, id: mockId('memory_work'), digitalPartnerId: source.digitalPartnerId, layer: 'working', scope: 'team', title: `${source.title} · 会话摘要`, content: `每日归纳：${source.content}`, confidence: Math.min(.99, source.confidence + .02), expiresAt: new Date(Date.now() + policy.workingMemoryTtlDays * 86400000).toISOString(), createdAt: now, updatedAt: now }); workingCreated += 1;
    });
    if (policy.workingToLongEnabled) memoryRecords.filter((item) => inCurrentWorkspace(item) && item.layer === 'working' && item.status === 'active' && item.confidence >= policy.minimumConfidence).forEach((source) => {
      if (memoryRecords.some((item) => item.layer === 'long_term' && item.sourceId === source.sourceId)) return;
      memoryRecords.unshift({ ...source, id: mockId('memory_long'), digitalPartnerId: source.digitalPartnerId, layer: 'long_term', scope: 'workspace', title: `${source.title} · 日结经验`, content: `经每日提炼的可复用经验：${source.content}`, status: 'active', createdAt: now, updatedAt: now }); longCreated += 1;
    });
    if (policy.longToKnowledgeEnabled) memoryRecords.filter((item) => inCurrentWorkspace(item) && item.layer === 'long_term' && item.status === 'active' && item.confidence >= policy.minimumConfidence).forEach((source) => {
      if (memoryCandidates.some((item) => item.memoryId === source.id && item.status === 'pending_review')) return;
      memoryCandidates.unshift({ id: mockId('memory_candidate'), workspaceId: currentWorkspaceId, memoryId: source.id, title: source.title, summary: source.content.slice(0, 180), classification: source.classification, sourceCorrelationId: source.correlationId, status: 'pending_review', submittedAt: now }); source.status = 'pending_review'; candidatesCreated += 1;
    });
    memoryAudit('执行每日渐进提炼', `短期→工作 ${workingCreated} · 工作→长期 ${longCreated} · 长期→知识候选 ${candidatesCreated}`); return { scheduledFor: policy.dailyRefinementTime, workingCreated, longCreated, candidatesCreated };
  }
  if (path === '/api/memory/policy' && method === 'GET') return memoryPolicies.find((item) => item.workspaceId === currentWorkspaceId) ?? { workspaceId: currentWorkspaceId, shortTermTtlHours: 24, workingMemoryTtlDays: 30, dailyRefinementTime: '02:00', shortToWorkingEnabled: true, workingToLongEnabled: true, longToKnowledgeEnabled: true, minimumConfidence: .85, longTermWriteApproval: true, sensitiveDataMasking: true, longTermCapacity: 5000, usedCapacity: 0 };
  if (path === '/api/memory/policy' && method === 'PATCH') { evaluateZeroTrust({ resource: 'memory', action: 'write' }); requireAdministrator('更新记忆策略'); const body = (opts.body ?? {}) as Partial<MemoryPolicy>; let policy = memoryPolicies.find((item) => item.workspaceId === currentWorkspaceId); if (!policy) { policy = { workspaceId: currentWorkspaceId, shortTermTtlHours: 24, workingMemoryTtlDays: 30, dailyRefinementTime: '02:00', shortToWorkingEnabled: true, workingToLongEnabled: true, longToKnowledgeEnabled: true, minimumConfidence: .85, longTermWriteApproval: true, sensitiveDataMasking: true, longTermCapacity: 5000, usedCapacity: 0 }; memoryPolicies.push(policy); } Object.assign(policy, body, { workspaceId: currentWorkspaceId }); memoryAudit('更新记忆策略', '记忆策略'); return policy; }
  if (path === '/api/memory/audit' && method === 'GET') return memoryAudits.filter(inCurrentWorkspace);

  // Phase 4 Self-Evolution
  if (path === '/api/evolve/candidates' && method === 'GET') return evolveCandidates.filter(inCurrentWorkspace);
  if (path === '/api/evolve/dream/run' && method === 'POST') {
    evaluateZeroTrust({ resource: 'memory', action: 'write' });
    requireAdministrator('执行 Dream 压缩');
    const policy = memoryPolicies.find((item) => item.workspaceId === currentWorkspaceId);
    if (policy && policy.shortToWorkingEnabled === false) return { applied: 0, candidates: [] };
    const bySource = new Map<string, MemoryRecord[]>();
    memoryRecords.filter((item) => inCurrentWorkspace(item) && item.layer === 'short_term' && item.status === 'active').forEach((item) => {
      const list = bySource.get(item.sourceId) ?? [];
      list.push(item);
      bySource.set(item.sourceId, list);
    });
    let applied = 0;
    const now = new Date().toISOString();
    const created: EvolveCandidate[] = [];
    bySource.forEach((shorts, sourceId) => {
      if (shorts.length < 3) return;
      if (memoryRecords.some((item) => item.layer === 'working' && item.sourceId === sourceId && (item as any).sourceType === 'dream_compress' && item.status === 'active')) return;
      const content = `Dream 压缩（会话摘要）：\n${shorts.slice(0, 8).map((s) => `- ${s.title}：${s.content.slice(0, 160)}`).join('\n')}`;
      const working: MemoryRecord = {
        id: mockId('memory_dream'), workspaceId: currentWorkspaceId, ownerId: identity?.id ?? 'u1',
        layer: 'working', scope: 'team', title: `Dream 压缩 · ${sourceId.slice(0, 24)}`, content,
        classification: 'internal', sourceType: 'manual', sourceId, correlationId: mockId('dream_corr'),
        confidence: 0.88, status: 'active', expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        createdAt: now, updatedAt: now,
      };
      (working as any).sourceType = 'dream_compress';
      memoryRecords.unshift(working);
      shorts.forEach((s) => { s.status = 'expired'; s.updatedAt = now; });
      const cand: EvolveCandidate = {
        id: mockId('evolve'), workspaceId: currentWorkspaceId, kind: 'dream', status: 'applied',
        title: 'Dream 压缩已应用', summary: `合并 ${shorts.length} 条短期记忆 → 工作记忆 ${working.id}`,
        submittedAt: now, reviewedAt: now, reviewer: 'dream',
        payload: { workingMemoryId: working.id, count: shorts.length },
      };
      evolveCandidates.unshift(cand);
      created.push(cand);
      applied += 1;
      memoryAudit('Dream压缩', cand.title, 'success', working.correlationId);
    });
    return { applied, candidates: created };
  }
  const evolveRoute = path.match(/^\/api\/evolve\/candidates\/([^/]+)\/(approve|reject)$/);
  if (evolveRoute && method === 'POST') {
    evaluateZeroTrust({ resource: 'memory', action: 'write' });
    const cand = evolveCandidates.find((item) => item.id === evolveRoute[1]);
    if (!cand || !inCurrentWorkspace(cand)) throw new Error('E_WORKSPACE_SCOPE: 无权操作其他工作区候选');
    const action = evolveRoute[2];
    const role = identity?.role ?? 'admin';
    if (action === 'reject') {
      if (role !== 'admin' && role !== 'auditor') throw new Error('E_ADMIN_REQUIRED: 拒绝自进化候选仅限管理员或审计员');
      cand.status = 'rejected'; cand.reviewedAt = new Date().toISOString(); cand.reviewer = workspaceContext().actor;
      memoryAudit('拒绝自进化候选', cand.title); return cand;
    }
    const needsDual = cand.kind === 'skill_patch' || cand.kind === 'routing_hint';
    if (needsDual) {
      const signers = cand.signers ?? [];
      if (signers.some((sg) => sg.userId === identity?.id)) throw new Error('E_BAD_REQUEST: 同一人不可重复会签');
      if (cand.status === 'pending_review') {
        if (role !== 'admin') throw new Error('E_ADMIN_REQUIRED: 技能/路由候选首签仅限管理员');
        cand.signers = [...signers, { userId: identity?.id, name: workspaceContext().actor, role, signedAt: new Date().toISOString() }];
        cand.status = 'pending_countersign';
        cand.firstReviewer = workspaceContext().actor;
        memoryAudit('自进化首签', cand.title); return cand;
      }
      if (cand.status === 'pending_countersign') {
        if (role !== 'auditor' && role !== 'admin') throw new Error('E_ADMIN_REQUIRED: 会签仅限审计员或另一管理员');
        cand.signers = [...signers, { userId: identity?.id, name: workspaceContext().actor, role, signedAt: new Date().toISOString() }];
      } else throw new Error('E_BAD_REQUEST: 候选已审或已应用');
    } else {
      requireAdministrator('审核自进化候选');
      if (cand.status !== 'pending_review') throw new Error('E_BAD_REQUEST: 候选已审或已应用');
    }
    if (cand.kind === 'memory_promote') {
      const payload = (cand.payload ?? {}) as Record<string, any>;
      const now = new Date().toISOString();
      const record: MemoryRecord = {
        id: mockId('memory'), workspaceId: currentWorkspaceId, ownerId: identity?.id ?? 'u1',
        layer: 'working', scope: (payload.scope as MemoryRecord['scope']) ?? 'team',
        title: String(payload.title ?? cand.title), content: String(payload.content ?? cand.summary),
        classification: 'internal', sourceType: 'manual', sourceId: cand.conversationId ?? cand.id,
        correlationId: cand.correlationId ?? mockId('evolve_corr'), confidence: Number(payload.confidence ?? 0.9),
        status: 'active', createdAt: now, updatedAt: now,
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      };
      memoryRecords.unshift(record);
      cand.effect = { memoryId: record.id, layer: 'working' };
    } else if (cand.kind === 'routing_hint') {
      cand.effect = { routingPolicyId: mockId('rp'), status: 'draft' };
    } else if (cand.kind === 'skill_patch') {
      cand.effect = { skillDraftId: mockId('skill_draft'), status: 'draft' };
    }
    cand.status = 'approved'; cand.reviewedAt = new Date().toISOString(); cand.reviewer = workspaceContext().actor;
    memoryAudit('通过自进化候选', cand.title); return cand;
  }
  const feedbackRoute = path.match(/^\/api\/copilot\/conversations\/([^/]+)\/messages\/([^/]+)\/feedback$/);
  if (feedbackRoute && method === 'POST') {
    const [, , mid] = feedbackRoute;
    const body = (opts.body ?? {}) as { kind?: string; comment?: string; tags?: string[] };
    const kind = (body.kind ?? '').toLowerCase();
    if (kind !== 'like' && kind !== 'dislike' && kind !== 'none' && kind !== '') throw new Error('E_BAD_REQUEST: kind 仅支持 like / dislike / none');
    if (kind === 'none' || kind === '') return { ok: true, messageId: mid, feedback: null };
    const fb = { kind, comment: body.comment, tags: body.tags, ratedBy: workspaceContext().actor, ratedAt: new Date().toISOString() };
    let evolveCandidate: EvolveCandidate | undefined;
    if (kind === 'like' || kind === 'dislike') {
      evolveCandidate = {
        id: mockId('evolve'), workspaceId: currentWorkspaceId,
        kind: kind === 'like' ? 'memory_promote' : 'skill_patch',
        status: 'pending_review',
        title: kind === 'like' ? '点赞晋升候选' : '点踩修正候选',
        summary: body.comment || (kind === 'like' ? '用户点赞该回答' : '用户点踩，请审核提示词补丁'),
        messageId: mid, submittedAt: new Date().toISOString(), createdBy: workspaceContext().actor,
        feedbackKind: kind,
      };
      evolveCandidates.unshift(evolveCandidate);
      memoryAudit('反馈自进化', evolveCandidate.title);
    }
    return { ok: true, messageId: mid, feedback: fb, evolveCandidate };
  }

  if (path === '/api/scheduled-tasks' && method === 'GET') {
    return scheduleDomain.list().filter((item) => !item.workspaceId || item.workspaceId === currentWorkspaceId);
  }
  if (path === '/api/scheduled-tasks' && method === 'POST') {
    const body = (opts.body ?? {}) as Partial<ScheduledTask> & Pick<ScheduledTask, 'title'>;
    if (!String(body.title ?? '').trim()) throw new Error('定时任务标题必填');
    return scheduleDomain.create({ ...body, workspaceId: currentWorkspaceId, createdBy: identity?.id, owner: identity?.name ?? body.owner });
  }
  const scheduleRoute = path.match(/^\/api\/scheduled-tasks\/([^/]+)(?:\/(pause|resume|run|runs))?$/);
  if (scheduleRoute) {
    const [, id, action] = scheduleRoute;
    if (action === 'runs' && method === 'GET') return scheduleDomain.runs(id);
    if (!action && method === 'GET') return scheduleDomain.get(id);
    if (!action && method === 'PATCH') return scheduleDomain.patch(id, (opts.body ?? {}) as Partial<ScheduledTask>);
    if (!action && method === 'DELETE') return scheduleDomain.remove(id);
    if (action === 'pause' && method === 'POST') return scheduleDomain.patch(id, { enabled: false });
    if (action === 'resume' && method === 'POST') return scheduleDomain.patch(id, { enabled: true });
    if (action === 'run' && method === 'POST') {
      return scheduleDomain.run(id, (title) => taskDomain.create({ title, source: 'workflow', tags: ['定时任务'] }, { actor: identity?.name }));
    }
  }

  // 任务：所有写操作都经由受控任务领域，保证版本、审计和通知一致。
  const canReadTask = (task: ControlledTask) => !identity || isAdministrator || task.ownerId === identity.id || task.createdBy === identity.id || task.assignee === identity.name;
  const canChangeTask = (task: ControlledTask) => !identity || isAdministrator || task.ownerId === identity.id || task.createdBy === identity.id || task.assignee === identity.name;
  if (path === '/api/tasks' && method === 'GET') return taskDomain.list().filter(inCurrentWorkspace).filter(canReadTask);
  if (path === '/api/tasks' && method === 'POST') {
    const body = (opts.body ?? {}) as Partial<ControlledTask> & Pick<Task, 'title'>;
    if (body.workspaceId && body.workspaceId !== currentWorkspaceId) throw new Error('E_WORKSPACE_SCOPE: 不能向其他工作区创建任务');
    const task = taskDomain.create({ ...body, workspaceId: currentWorkspaceId, ownerId: identity?.id ?? body.ownerId ?? 'u1', environment: body.environment ?? 'sandbox', classification: body.classification ?? 'internal', createdBy: identity?.id ?? body.createdBy ?? 'u1', correlationId: body.correlationId ?? mockId('corr_task') }, { ...body, actor: identity?.name ?? (body as any).actor } as TaskActor);
    appendTaskDomainEvent(task);
    return task;
  }
  const taskRoute = path.match(/^\/api\/tasks\/([^/]+)(?:\/(transition|approve|takeover|retry|audit|comments))?$/);
  if (taskRoute) {
    const [, id, action] = taskRoute;
    const existing = taskDomain.get(id);
    if (!existing || !inCurrentWorkspace(existing) || !canReadTask(existing)) throw new Error('E_TASK_SCOPE: 无权访问该任务');
    if (!action && method === 'GET') return existing;
    if (action === 'audit' && method === 'GET') return taskDomain.audit(id);
    if (action === 'comments' && method === 'GET') return taskDomain.comments(id);
    if (action === 'comments' && method === 'POST') {
      if (!canChangeTask(existing)) throw new Error('E_TASK_OWNER_SCOPE');
      const text = String((opts.body as { body?: string } | undefined)?.body ?? '').trim();
      if (!text) throw new Error('留言内容必填');
      return taskDomain.comment(id, text, { actor: identity?.name });
    }
    const body = (opts.body ?? {}) as TaskActor & { status?: Task['status']; stage?: ControlledTask['lifecycleStage']; approved?: boolean };
    let task: ControlledTask | undefined;
    if (action === 'transition' && method === 'POST') { if (!canChangeTask(existing)) throw new Error('E_TASK_OWNER_SCOPE'); task = taskDomain.transition(id, body.stage ?? body.status ?? 'pending', { ...body, actor: identity?.name ?? body.actor }); }
    if (action === 'approve' && method === 'POST') { requireAdministrator('审批任务'); task = taskDomain.approve(id, { ...body, actor: identity?.name ?? body.actor }); }
    if (action === 'takeover' && method === 'POST') { requireAdministrator('人工接管任务'); task = taskDomain.takeover(id, { ...body, actor: identity?.name ?? body.actor }); }
    if (action === 'retry' && method === 'POST') { requireAdministrator('重试高风险任务'); task = taskDomain.retry(id, { ...body, actor: identity?.name ?? body.actor }); }
    if (task) {
      appendTaskDomainEvent(task);
      return task;
    }
  }

  // 智能体
  // 数字伙伴：业务岗位对象。其能力引用技术资产，但不复用 /api/agents 的技术语义。
  if (path === '/api/partner-templates' && method === 'GET') return mockDigitalPartnerTemplates.filter((item) => item.scope === 'organization' || item.workspaceId === currentWorkspaceId);
  if (path === '/api/partner-template-adoptions' && method === 'GET') return mockDigitalPartnerTemplateAdoptions.filter((item) => item.workspaceId === currentWorkspaceId);
  // 数字伙伴仅能从各能力中心已准入/已发布资产中选择，不能由前端手填名称。
  if (path === '/api/partner-capability-catalog' && method === 'GET') {
    const allModels = modelProviders.flatMap((provider) => provider.models.map((model) => ({ ...model, providerName: provider.name, providerStatus: provider.status, providerWorkspaceId: provider.workspaceId })));
    const routeOptions = routingPolicies
      .filter((policy) => policy.workspaceId === currentWorkspaceId && policy.status === 'published')
      .map((policy) => {
        const primary = allModels.find((m) => m.id === policy.primaryModelId);
        const routeName = (policy as { name?: string }).name?.trim() || `${policy.level} 路由`;
        return { id: policy.id, name: routeName, meta: `已发布策略 ${policy.level} · 主模型 ${primary?.name ?? policy.primaryModelId}` };
      });
    const providerModelOptions = modelProviders
      .filter((provider) => provider.workspaceId === currentWorkspaceId && (provider.status === 'active' || provider.status === 'standby'))
      .flatMap((provider) => provider.models
        .filter((model) => model.status === 'available' && (model.capabilities?.some((c) => /chat|reasoning/i.test(c)) ?? true))
        .map((model) => ({ id: model.id, name: model.name, meta: `对话模型 · ${provider.name} · ${model.cloudRegion}` })));
    const seen = new Set<string>();
    const models = [...routeOptions, ...providerModelOptions].filter((item) => {
      if (seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    });
    const knowledgeOptions = mockKnowledgePackages.filter(inCurrentWorkspace).filter((item) => item.status === 'published').map((item) => ({ id: item.id, name: item.name, meta: `${item.domain} · ${item.currentVersion.version}` }));
    const capabilityAssets = mockSkills.filter(inCurrentWorkspace).map(skillAsset).filter((item) => item.lifecycleStatus === 'enabled' || item.status === 'installed');
    const skillOptions = capabilityAssets.filter((item) => item.kind === 'skill').map((item) => ({ id: item.id, name: item.name, meta: `技能 · ${item.version}` }));
    const toolOptions = capabilityAssets.filter((item) => item.kind === 'tool' || item.kind === 'mcp').map((item) => ({ id: item.id, name: item.name, meta: item.kind === 'mcp' ? `MCP · ${item.version}` : `工具 · ${item.version}` }));
    const workflowSkillOptions = mockWorkflowSkills.filter((item) => item.status === 'published').map((item) => ({ id: item.id, name: item.name, meta: `流程技能 · ${item.sourceVersionId}` }));
    const workflowOptions = [
      ...workflowSkillOptions,
      ...mockWorkflowCatalog
        .filter((item) => item.status === 'active')
        .map((item) => ({ id: item.id, name: item.name, meta: `工作流 · ${item.nodes.length} 个节点` })),
    ];
    const channelOptions = [
      { id: 'ch-web', name: 'Web', meta: '渠道 · web' },
      ...mockChannels.filter((item) => item.enabled).map((item) => ({ id: item.id, name: item.name, meta: `渠道 · ${item.kind}` })),
    ];
    return { models, knowledge: knowledgeOptions, skills: skillOptions, tools: toolOptions, workflows: workflowOptions, channels: channelOptions };
  }
  if (path === '/api/partner-templates' && method === 'POST') {
    requireAdministrator('发布部门岗位模板');
    const body = (opts.body ?? {}) as Partial<DigitalPartnerTemplate>;
    if (!body.name?.trim() || !body.role?.trim() || !body.department?.trim()) throw new Error('E_DIGITAL_EMPLOYEE_TEMPLATE_REQUIRED');
    const template: DigitalPartnerTemplate = { id: mockId('partner_template'), name: body.name.trim(), role: body.role.trim(), department: body.department.trim(), description: body.description?.trim() || '待完善岗位模板说明。', serviceObject: body.serviceObject?.trim() || '内部用户', version: '0.1.0', risk: body.risk ?? 'low', responsibilities: body.responsibilities?.length ? body.responsibilities : ['待配置岗位职责'], prohibitedActions: body.prohibitedActions?.length ? body.prohibitedActions : ['待配置禁止行为'], capabilities: body.capabilities ?? { model: '企业通用路由 v2', knowledge: [], skills: [], tools: [], workflows: [], channels: ['Web'] }, memoryPolicy: body.memoryPolicy ?? { shortTermHours: 24, workingDays: 7, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, source: 'department', sourceName: `${body.department.trim()}共享模板`, status: 'review', scope: 'workspace', workspaceId: currentWorkspaceId, applicableEnvironments: body.applicableEnvironments ?? ['sandbox'], adoptionCount: 0, tags: body.tags ?? [], publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    mockDigitalPartnerTemplates.unshift(template); workspaceAudit(currentWorkspaceId, '发布部门岗位模板', template.name); return template;
  }
  const digitalPartnerTemplateRoute = path.match(/^\/api\/partner-templates\/([^/]+)(?:\/(adopt))?$/);
  if (digitalPartnerTemplateRoute) {
    const [, templateId, action] = digitalPartnerTemplateRoute;
    const template = mockDigitalPartnerTemplates.find((item) => item.id === templateId && (item.scope === 'organization' || item.workspaceId === currentWorkspaceId));
    if (!template) throw new Error('E_DIGITAL_EMPLOYEE_TEMPLATE_NOT_FOUND');
    if (!action && method === 'GET') return template;
    if (action === 'adopt' && method === 'POST') {
      if (!identity || identity.role === 'auditor') throw new Error('E_DIGITAL_EMPLOYEE_WRITE_FORBIDDEN');
      if (template.status === 'deprecated') throw new Error('E_DIGITAL_EMPLOYEE_TEMPLATE_DEPRECATED');
      const body = (opts.body ?? {}) as Partial<Pick<DigitalPartner, 'owner' | 'escalationOwner' | 'environment' | 'department' | 'name'>>;
      const employee: DigitalPartner = { id: mockId('digital_employee'), workspaceId: currentWorkspaceId, name: body.name?.trim() || template.name, role: template.role, department: body.department?.trim() || template.department, description: template.description, owner: body.owner?.trim() || identity.name, escalationOwner: body.escalationOwner?.trim() || '待指定', serviceObject: template.serviceObject, version: template.version, environment: body.environment ?? 'sandbox', lifecycle: 'draft', risk: template.risk, responsibilities: [...template.responsibilities], prohibitedActions: [...template.prohibitedActions], capabilities: { ...template.capabilities, knowledge: [...template.capabilities.knowledge], skills: [...template.capabilities.skills], tools: [...template.capabilities.tools], workflows: [...template.capabilities.workflows], channels: [...template.capabilities.channels] }, memoryPolicy: { ...template.memoryPolicy }, runtime: { calls24h: 0, successRate: 0, p95Ms: 0, costToday: 0, handoffs24h: 0, anomalies: 0 }, evaluation: { status: 'not_started' }, release: { status: 'not_released' }, templateId: template.id, templateVersion: template.version, updatedAt: new Date().toISOString() };
      mockDigitalPartners.unshift(employee); template.adoptionCount += 1; mockDigitalPartnerTemplateAdoptions.unshift({ id: mockId('partner_adoption'), templateId: template.id, templateVersion: template.version, employeeId: employee.id, workspaceId: currentWorkspaceId, adoptedBy: identity.name, status: 'draft', createdAt: new Date().toISOString() }); workspaceAudit(currentWorkspaceId, '采用岗位模板', `${template.name} · v${template.version}`); return employee;
    }
    if (!action && method === 'PATCH') {
      requireAdministrator('治理岗位模板');
      const body = (opts.body ?? {}) as Partial<Pick<DigitalPartnerTemplate, 'status' | 'version' | 'description' | 'tags'>>;
      if (body.status && !['certified', 'review', 'deprecated'].includes(body.status)) throw new Error('E_DIGITAL_EMPLOYEE_TEMPLATE_STATUS_INVALID');
      Object.assign(template, body, { updatedAt: new Date().toISOString() }); workspaceAudit(currentWorkspaceId, '治理岗位模板', `${template.name} · ${template.status}`); return template;
    }
  }
  if (path === '/api/partners' && method === 'GET') {
    const departmentOrder = ['研发部', '销售部', '市场部', '运营部', '人事部', '财务部', '信息技术部'];
    const isHead = (item: { id: string; name: string; role?: string }) => /-(manager|head)$/.test(item.id) || Boolean(item.role && /部负责人$|部经理$|负责人$|经理$|总监$|主管$/.test(item.role));
    return mockDigitalPartners
      .filter((item) => item.workspaceId === currentWorkspaceId)
      .slice()
      .sort((left, right) => {
        const headCompare = Number(isHead(right)) - Number(isHead(left));
        if (headCompare !== 0) return headCompare;
        const leftDept = departmentOrder.indexOf(left.department);
        const rightDept = departmentOrder.indexOf(right.department);
        const departmentCompare = (leftDept === -1 ? departmentOrder.length : leftDept) - (rightDept === -1 ? departmentOrder.length : rightDept);
        if (departmentCompare !== 0) return departmentCompare;
        return left.name.localeCompare(right.name, 'zh-CN');
      });
  }
  if (path === '/api/partners/overview' && method === 'GET') {
    const employees = mockDigitalPartners.filter((item) => item.workspaceId === currentWorkspaceId);
    return {
      total: employees.length,
      active: employees.filter((item) => item.lifecycle === 'active').length,
      pending: employees.filter((item) => item.release.status === 'pending_approval' || item.lifecycle === 'pending_approval').length,
      anomalies: employees.filter((item) => item.runtime.anomalies > 0 || item.lifecycle === 'quarantined').length,
      handoffAttention: employees.filter((item) => item.runtime.handoffs24h >= 10).length,
      costToday: Number(employees.reduce((sum, item) => sum + item.runtime.costToday, 0).toFixed(2)),
    };
  }
  if (path === '/api/partners' && method === 'POST') {
    if (!identity || identity.role === 'auditor') throw new Error('E_DIGITAL_EMPLOYEE_WRITE_FORBIDDEN');
    const body = (opts.body ?? {}) as Partial<DigitalPartner>;
    if (!body.name?.trim() || !body.role?.trim() || !body.department?.trim()) throw new Error('E_DIGITAL_EMPLOYEE_PROFILE_REQUIRED');
    const employee: DigitalPartner = {
      id: mockId('digital_employee'), workspaceId: currentWorkspaceId, name: body.name.trim(), role: body.role.trim(), department: body.department.trim(),
      description: body.description?.trim() || '待完善岗位职责说明。', owner: identity.name, escalationOwner: body.escalationOwner?.trim() || '待指定', serviceObject: body.serviceObject?.trim() || '内部用户', version: '0.1.0', environment: 'sandbox', lifecycle: 'draft', risk: body.risk ?? 'low',
      responsibilities: body.responsibilities?.length ? body.responsibilities : ['待配置岗位职责'], prohibitedActions: body.prohibitedActions?.length ? body.prohibitedActions : ['待配置禁止行为'],
      capabilities: body.capabilities ?? { model: '企业通用路由 v2', knowledge: [], skills: [], tools: [], workflows: [], channels: ['Web'] },
      memoryPolicy: body.memoryPolicy ?? { shortTermHours: 24, workingDays: 7, longTermCadence: 'daily', knowledgePromotion: 'approval_required' }, runtime: { calls24h: 0, successRate: 0, p95Ms: 0, costToday: 0, handoffs24h: 0, anomalies: 0 }, evaluation: { status: 'not_started' }, release: { status: 'not_released' }, updatedAt: new Date().toISOString(),
    };
    mockDigitalPartners.unshift(employee); workspaceAudit(currentWorkspaceId, '创建数字伙伴', `${employee.role} · ${employee.name}`); return employee;
  }
  const digitalPartnerConfigurationVersionsRoute = path.match(/^\/api\/partners\/([^/]+)\/configuration-versions(?:\/([^/]+)\/approve)?$/);
  if (digitalPartnerConfigurationVersionsRoute) {
    const [, employeeId, versionId] = digitalPartnerConfigurationVersionsRoute;
    const employee = mockDigitalPartners.find((item) => item.id === employeeId && item.workspaceId === currentWorkspaceId);
    if (!employee) throw new Error('E_DIGITAL_EMPLOYEE_NOT_FOUND');
    if (!versionId && method === 'GET') return mockDigitalPartnerConfigurationVersions.filter((item) => item.employeeId === employee.id);
    if (versionId && method === 'POST') {
      requireAdministrator('批准员工受控配置变更');
      const version = mockDigitalPartnerConfigurationVersions.find((item) => item.id === versionId && item.employeeId === employee.id);
      const draft = mockDigitalPartnerConfigurationDrafts.get(versionId);
      if (!version || !draft || version.status !== 'pending_approval') throw new Error('E_DIGITAL_EMPLOYEE_CONFIGURATION_CHANGE_NOT_FOUND');
      if (version.updatedById && identity && version.updatedById === identity.id) throw new Error('E_SOD_SELF_APPROVAL: 配置提交人不能批准自己的受控变更');
      if (!version.updatedById && identity && version.updatedBy === identity.name) throw new Error('E_SOD_SELF_APPROVAL: 配置提交人不能批准自己的受控变更');
      mockDigitalPartnerConfigurationVersions.filter((item) => item.employeeId === employee.id && item.status === 'current').forEach((item) => { item.status = 'superseded'; });
      applyDigitalPartnerConfiguration(employee, draft); version.status = 'current'; version.updatedAt = new Date().toISOString(); mockDigitalPartnerConfigurationDrafts.delete(versionId);
      workspaceAudit(currentWorkspaceId, '批准员工受控配置变更', `${employee.role} · ${employee.name} · ${version.version} · 批准人 ${identity?.name ?? '平台管理员'}`); return version;
    }
  }
  const digitalPartnerConfigurationRoute = path.match(/^\/api\/partners\/([^/]+)\/configuration$/);
  if (digitalPartnerConfigurationRoute && method === 'POST') {
    const employee = mockDigitalPartners.find((item) => item.id === digitalPartnerConfigurationRoute[1] && item.workspaceId === currentWorkspaceId);
    if (!employee) throw new Error('E_DIGITAL_EMPLOYEE_NOT_FOUND');
    if (!identity || identity.role === 'auditor') throw new Error('E_DIGITAL_EMPLOYEE_WRITE_FORBIDDEN');
    const body = (opts.body ?? {}) as DigitalPartnerConfigurationInput;
    const scope = body.scope ?? 'role';
    if (!body.profile?.name?.trim() || !body.profile?.role?.trim() || !body.profile?.department?.trim()) throw new Error('E_DIGITAL_EMPLOYEE_CONFIGURATION_REQUIRED');
    if (scope === 'capability' && !body.capabilities?.model?.trim()) throw new Error('E_DIGITAL_EMPLOYEE_CONFIGURATION_REQUIRED');
    const policy = body.boundary?.boundaryPolicy;
    if (!body.boundary?.responsibilities?.length || !policy?.responsibilities?.length || !policy.handoff?.triggers?.length || !policy.handoff?.approvers?.length) throw new Error('E_DIGITAL_EMPLOYEE_BOUNDARY_REQUIRED');
    if (scope === 'capability' && body.capabilities) {
      const boundCapabilities = new Map<string, Set<string>>([
        ['tool', new Set(body.capabilities.tools)], ['workflow', new Set(body.capabilities.workflows)], ['skill', new Set(body.capabilities.skills)],
      ]);
      const allowedModes = new Set(['recommend', 'approval_required', 'execute', 'prohibited']);
      const invalidCapability = policy.capabilityModes.some((item) => !allowedModes.has(item.mode) || !boundCapabilities.get(item.capabilityType)?.has(item.capabilityName));
      if (invalidCapability) throw new Error('E_DIGITAL_EMPLOYEE_BOUNDARY_CAPABILITY_INVALID');
    }
    if (!['internal', 'confidential', 'restricted'].includes(policy.dataClassification) || !policy.allowedEnvironments.length || !policy.allowedEnvironments.every((item) => ['sandbox', 'staging', 'production'].includes(item)) || policy.handoff.slaMinutes < 1) throw new Error('E_DIGITAL_EMPLOYEE_BOUNDARY_POLICY_INVALID');
    const changedFields = [
      JSON.stringify(employee.responsibilities) !== JSON.stringify(body.boundary.responsibilities) ? '岗位职责' : null,
      JSON.stringify(employee.boundaryPolicy) !== JSON.stringify(policy) ? '执行边界与升级审批' : null,
      JSON.stringify(employee.capabilities) !== JSON.stringify(body.capabilities ?? employee.capabilities) ? '能力装配' : null,
      JSON.stringify(employee.memoryPolicy) !== JSON.stringify(body.memoryPolicy) ? '记忆策略' : null,
      ['name', 'role', 'department', 'description', 'owner', 'escalationOwner', 'serviceObject', 'risk', 'environment'].some((key) => (employee as any)[key] !== (body.profile as any)[key]) ? '岗位档案' : null,
    ].filter(Boolean) as string[];
    // 岗位授权契约与能力装配均直接生效（历史 pending 版本仍可走 approve）。
    const requiresApproval = false;
    applyDigitalPartnerConfiguration(employee, body);
    workspaceAudit(currentWorkspaceId, '更新员工配置', `${employee.role} · ${employee.name}`);
    // 仅在最后步骤（release）提交时创建"配置版本"；中间步骤（role / capability）的保存
    // 不进版本流，避免每次小改都污染历史。
    if (scope === 'release') {
      const revisions = mockDigitalPartnerConfigurationVersions.filter((item) => item.employeeId === employee.id).length + 1;
      const version: DigitalPartnerConfigurationVersion = { id: mockId('partner_config'), employeeId: employee.id, version: `配置 v${revisions}`, status: 'current', changeSummary: '上岗定版', changedFields: changedFields.length ? changedFields : ['职责与边界'], updatedBy: identity.name, updatedById: identity.id, updatedAt: new Date().toISOString() };
      mockDigitalPartnerConfigurationVersions.filter((item) => item.employeeId === employee.id && item.status === 'current').forEach((item) => { item.status = 'superseded'; });
      mockDigitalPartnerConfigurationVersions.unshift(version);
      return { ...version, requiresApproval };
    }
    return { id: `${employee.id}-${Date.now()}`, version: null, requiresApproval };
  }
  const digitalPartnerRoute = path.match(/^\/api\/partners\/([^/]+)(?:\/(capabilities|boundary|memory-policy|evaluate|release|lifecycle|runtime|evidence)(?:\/(withdraw|reject))?)?$/);
  if (digitalPartnerRoute) {
    const [, employeeId, action, releaseAction] = digitalPartnerRoute;
    const employee = mockDigitalPartners.find((item) => item.id === employeeId && item.workspaceId === currentWorkspaceId);
    if (!employee) throw new Error('E_DIGITAL_EMPLOYEE_NOT_FOUND');
    if (!action && method === 'GET') return employee;
    if (action === 'runtime' && method === 'GET') return employee.runtime;
    if (action === 'evidence' && method === 'GET') return digitalPartnerEvidence(employee);
    if (!identity || identity.role === 'auditor') throw new Error('E_DIGITAL_EMPLOYEE_WRITE_FORBIDDEN');
    const body = (opts.body ?? {}) as any;
    if (!action && method === 'DELETE') {
      if (employee.release.status === 'released' || employee.lifecycle === 'active') {
        throw new Error('E_DIGITAL_PARTNER_PUBLISH_FORBIDDEN: 已上岗的数字伙伴不可删除');
      }
      const index = mockDigitalPartners.findIndex((item) => item.id === employee.id);
      if (index >= 0) mockDigitalPartners.splice(index, 1);
      for (let i = mockDigitalPartnerConfigurationVersions.length - 1; i >= 0; i -= 1) {
        if (mockDigitalPartnerConfigurationVersions[i].employeeId === employee.id) mockDigitalPartnerConfigurationVersions.splice(i, 1);
      }
      workspaceAudit(currentWorkspaceId, '删除数字伙伴', `${employee.role} · ${employee.name}`);
      return { id: employee.id, status: 'deleted' };
    }
    if (!action && method === 'PATCH') {
      const profile = ['name', 'role', 'department', 'description', 'owner', 'escalationOwner', 'serviceObject', 'risk', 'environment'];
      profile.forEach((key) => { if (body[key] !== undefined) (employee as any)[key] = body[key]; });
    }
    if ((action === 'capabilities' || action === 'boundary' || action === 'memory-policy') && method === 'PATCH') {
      throw new Error('E_DIGITAL_EMPLOYEE_USE_CONFIGURATION: 请通过配置版本接口提交变更，禁止直接 PATCH 能力/边界/记忆');
    }
    if (action === 'evaluate' && method === 'POST') {
      const incomplete = !employee.responsibilities.length || employee.responsibilities.includes('待配置岗位职责') || !employee.capabilities.model
        || (employee.capabilities.skills.length + employee.capabilities.tools.length + employee.capabilities.workflows.length) === 0;
      const forceFail = Boolean(body.forceFail);
      if (incomplete || forceFail) {
        employee.evaluation = { status: 'failed', score: Number((62 + Math.random() * 12).toFixed(1)), lastRunAt: new Date().toISOString() };
      } else {
        employee.evaluation = { status: 'passed', score: Number((91 + Math.random() * 7).toFixed(1)), lastRunAt: new Date().toISOString() };
        if (employee.lifecycle === 'draft') employee.lifecycle = 'testing';
      }
    }
    if (action === 'release' && method === 'POST' && releaseAction === 'withdraw') {
      if (employee.release.status !== 'pending_approval') throw new Error('E_DIGITAL_EMPLOYEE_RELEASE_NOT_PENDING: 仅待审批申请可撤回');
      if (!employee.release.requestedById || employee.release.requestedById !== identity.id) throw new Error('E_DIGITAL_EMPLOYEE_RELEASE_WITHDRAW_FORBIDDEN: 仅申请人可撤回上岗申请');
      employee.release = { status: 'not_released' };
      employee.lifecycle = employee.evaluation.status === 'passed' ? 'testing' : 'draft';
    } else if (action === 'release' && method === 'POST' && releaseAction === 'reject') {
      requireAdministrator('驳回上岗申请');
      if (employee.release.status !== 'pending_approval') throw new Error('E_DIGITAL_EMPLOYEE_RELEASE_NOT_PENDING: 仅待审批申请可驳回');
      if (employee.release.requestedById && employee.release.requestedById === identity.id) throw new Error('E_SOD_SELF_APPROVAL: 上岗申请人不能驳回自己的申请');
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      employee.release = {
        status: 'not_released',
        rejectedReason: reason || '未满足上岗门禁或需补充配置',
        rejectedBy: identity.name,
      };
      employee.lifecycle = 'testing';
    } else if (action === 'release' && method === 'POST') {
      if (!employee.owner?.trim() || !employee.escalationOwner?.trim() || employee.escalationOwner === '待指定' || !employee.serviceObject?.trim()) throw new Error('E_DIGITAL_EMPLOYEE_PROFILE_INCOMPLETE: 请先完善岗位负责人、接管人与服务对象');
      if (!employee.responsibilities.length || employee.responsibilities.includes('待配置岗位职责')) throw new Error('E_DIGITAL_EMPLOYEE_BOUNDARY_REQUIRED: 请先配置岗位职责边界');
      const capabilityCount = employee.capabilities.skills.length + employee.capabilities.tools.length + employee.capabilities.workflows.length;
      if (!employee.capabilities.model || capabilityCount === 0) throw new Error('E_DIGITAL_EMPLOYEE_CAPABILITY_REQUIRED: 请先装配已发布模型与至少一项技能/工具/流程技能');
      if (employee.evaluation.status !== 'passed') throw new Error('E_DIGITAL_EMPLOYEE_EVALUATION_REQUIRED: 质量评测未通过，无法申请上岗');
      if (employee.release.status === 'released' && employee.lifecycle === 'active') throw new Error('E_DIGITAL_EMPLOYEE_ALREADY_RELEASED: 员工已上岗');
      const now = new Date().toISOString();
      if (employee.environment === 'production' || employee.environment === 'staging') {
        if (identity.role === 'admin') {
          employee.lifecycle = 'active';
          employee.release = {
            status: 'released',
            releasedAt: now,
            requestedBy: identity.name,
            requestedById: identity.id,
            approver: identity.name,
            approverId: identity.id,
          };
        } else {
          employee.lifecycle = 'pending_approval';
          employee.release = {
            status: 'pending_approval',
            requestedBy: identity.name,
            requestedById: identity.id,
          };
        }
      } else {
        employee.lifecycle = 'active';
        employee.release = {
          status: 'released',
          releasedAt: now,
          requestedBy: identity.name,
          requestedById: identity.id,
        };
      }
      // 上岗定版：仅在最终通过 release 提交时创建一条"配置版本"，与中间保存解耦。
      // 沙箱环境直接上岗（无审批），也在这里生成；其他环境需后续 admin 确认后再补一条。
      if (employee.release.status === 'released') {
        const revisions = mockDigitalPartnerConfigurationVersions.filter((item) => item.employeeId === employee.id).length + 1;
        const version: DigitalPartnerConfigurationVersion = { id: mockId('partner_config'), employeeId: employee.id, version: `配置 v${revisions}`, status: 'current', changeSummary: '上岗定版', changedFields: ['岗位职责', '执行边界与升级审批', '能力装配'], updatedBy: identity.name, updatedById: identity.id, updatedAt: now };
        mockDigitalPartnerConfigurationVersions.filter((item) => item.employeeId === employee.id && item.status === 'current').forEach((item) => { item.status = 'superseded'; });
        mockDigitalPartnerConfigurationVersions.unshift(version);
      }
    }
    if (action === 'lifecycle' && method === 'POST') {
      const target = body.lifecycle as DigitalPartner['lifecycle'];
      if (!['draft', 'testing', 'active', 'paused', 'quarantined'].includes(target)) throw new Error('E_DIGITAL_EMPLOYEE_LIFECYCLE_INVALID');
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (target === 'active') {
        if (employee.release.status === 'released' && (employee.lifecycle === 'paused' || employee.lifecycle === 'quarantined')) {
          if (!body.confirmed) throw new Error('E_DIGITAL_EMPLOYEE_RESUME_CONFIRM_REQUIRED: 恢复运行前请确认异常已处置并保留证据');
          employee.opsControl = { lastAction: 'resumed', reason: reason || '确认异常已处置并保留证据', actor: identity.name, at: new Date().toISOString() };
        } else if (employee.release.status === 'pending_approval') {
          if (identity.role !== 'admin') {
            if (employee.release.requestedById && employee.release.requestedById === identity.id) {
              throw new Error('E_SOD_SELF_APPROVAL: 生产上岗须管理员确认，申请人不能自批');
            }
            if (employee.release.requestedBy && employee.release.requestedBy === identity.name) {
              throw new Error('E_SOD_SELF_APPROVAL: 生产上岗须管理员确认，申请人不能自批');
            }
          }
          employee.release = {
            status: 'released',
            releasedAt: new Date().toISOString(),
            requestedBy: employee.release.requestedBy,
            requestedById: employee.release.requestedById,
            approver: identity.name,
            approverId: identity.id,
          };
        } else {
          throw new Error('E_DIGITAL_EMPLOYEE_RELEASE_REQUIRED: 须先完成评测并申请上岗');
        }
      }
      if ((target === 'paused' || target === 'quarantined') && employee.lifecycle !== 'active' && employee.lifecycle !== 'paused') {
        throw new Error('E_DIGITAL_EMPLOYEE_LIFECYCLE_INVALID: 仅在岗或已暂停员工可进入暂停/隔离');
      }
      if (target === 'paused' || target === 'quarantined') {
        requireAdministrator(target === 'paused' ? '暂停数字伙伴' : '隔离数字伙伴');
        if (!reason) throw new Error('E_DIGITAL_EMPLOYEE_OPS_REASON_REQUIRED: 暂停/隔离须填写处置原因');
        employee.opsControl = { lastAction: target, reason, actor: identity.name, at: new Date().toISOString() };
      }
      if (target === 'quarantined') requireAdministrator('隔离数字伙伴');
      employee.lifecycle = target;
    }
    // 采用记录只作为模板溯源视图，始终镜像员工实例的生命周期，避免两处状态漂移。
    const adoption = employee.templateId ? mockDigitalPartnerTemplateAdoptions.find((item) => item.employeeId === employee.id) : undefined;
    if (adoption) adoption.status = employee.lifecycle;
    employee.updatedAt = new Date().toISOString(); workspaceAudit(currentWorkspaceId, `数字伙伴：${releaseAction ? `${action}/${releaseAction}` : (action ?? '更新')}`, `${employee.role} · ${employee.name}`); return employee;
  }
  const capabilityTarget = path.match(/^\/api\/(agents|workflows)\/([^/]+)\/capabilities(?:\/([^/]+))?$/);
  if (capabilityTarget) {
    const [, resource, targetId, bindingId] = capabilityTarget;
    const targetType = resource === 'agents' ? 'agent' as const : 'workflow' as const;
    if (method === 'GET') return mockCapabilityBindings.filter((binding) => binding.targetType === targetType && binding.targetId === targetId);
    if (method === 'POST') {
      const body = (opts.body ?? {}) as Partial<CapabilityBinding>;
      const capability = body.capabilityKind === 'workflow_skill' ? mockWorkflowSkills.find((item) => item.id === body.capabilityId) : mockSkills.find((item) => item.id === body.capabilityId);
      if (!capability) throw new Error('能力尚未安装或未发布');
      if (body.capabilityKind === 'workflow_skill' && (capability as WorkflowSkill).status !== 'published') throw new Error('工作流技能尚未发布');
      const binding: CapabilityBinding = { id: mockId('binding'), targetType, targetId, capabilityKind: body.capabilityKind ?? 'skill', capabilityId: body.capabilityId!, pinnedVersion: body.pinnedVersion ?? ('version' in capability ? capability.version : (capability as WorkflowSkill).sourceVersionId), status: body.status ?? 'active', createdBy: '当前用户', createdAt: new Date().toISOString(), auditId: mockId('audit') };
      mockCapabilityBindings.push(binding); appendControlPlaneAudit('skill', '绑定能力', `${targetType}:${targetId} → ${binding.capabilityId}`); return binding;
    }
    if (method === 'DELETE' && bindingId) { const index = mockCapabilityBindings.findIndex((binding) => binding.id === bindingId && binding.targetId === targetId); if (index < 0) throw new Error('能力绑定不存在'); const [removed] = mockCapabilityBindings.splice(index, 1); appendControlPlaneAudit('skill', '解绑能力', `${targetType}:${targetId} → ${removed.capabilityId}`); return removed; }
  }
  if (path === '/api/workflow-skills' && method === 'GET') return mockWorkflowSkills;
  const publishAsSkill = path.match(/^\/api\/workflows\/([^/]+)\/publish-as-skill$/);
  if (publishAsSkill && method === 'POST') {
    if (identity && !(identity.permissions.includes('workflow.write') || identity.permissions.includes('skill.write'))) {
      throw new Error('E_WORKFLOW_WRITE_FORBIDDEN: 缺少发布流程技能权限');
    }
    const workflowId = publishAsSkill[1];
    if (!workflowId?.trim()) throw new Error('E_WORKFLOW_REQUIRED: 必须指定来源工作流');
    const body = (opts.body ?? {}) as {
      version?: string;
      name?: string;
      description?: string;
      riskLevel?: WorkflowSkill['riskLevel'];
      validationPassed?: boolean;
      draftBlocked?: boolean;
    };
    if (body.draftBlocked) throw new Error('E_TEMPLATE_DEPENDENCY: 来源模板依赖未授权，禁止发布技能');
    if (!body.validationPassed) throw new Error('E_VALIDATION_REQUIRED: 请先完成运行前校验并通过后再发布技能');
    const version = body.version?.trim();
    if (!version) throw new Error('E_VERSION_REQUIRED: 必须指定来源流程版本');
    const name = body.name?.trim();
    if (!name) throw new Error('E_NAME_REQUIRED: 技能名称不能为空');
    const riskLevel: WorkflowSkill['riskLevel'] = body.riskLevel === 'low' || body.riskLevel === 'high' ? body.riskLevel : 'mid';
    // 中/高风险：调用时需审批；高风险且非管理员：先落草稿，待治理发布后再装配
    const approvalRequired = riskLevel !== 'low';
    const status: WorkflowSkill['status'] = riskLevel === 'high' && identity?.role === 'user' ? 'draft' : 'published';
    const existing = mockWorkflowSkills.find((item) => item.sourceWorkflowId === workflowId && item.sourceVersionId === version);
    if (existing) {
      existing.name = name;
      existing.description = body.description?.trim() || existing.description;
      existing.riskLevel = riskLevel;
      existing.approvalRequired = approvalRequired;
      existing.rollbackSupported = true;
      existing.status = status;
      appendControlPlaneAudit('skill', '更新工作流技能', `${existing.name} · ${workflowId}@${version}`);
      return existing;
    }
    const workflowSkill: WorkflowSkill = {
      id: mockId('workflow_skill'),
      sourceWorkflowId: workflowId,
      sourceVersionId: version,
      name,
      description: body.description?.trim() || '由受控工作流发布的可复用能力',
      riskLevel,
      approvalRequired,
      rollbackSupported: true,
      status,
    };
    mockWorkflowSkills.unshift(workflowSkill);
    appendControlPlaneAudit('skill', status === 'published' ? '发布工作流技能' : '提交工作流技能草稿', workflowSkill.name);
    return workflowSkill;
  }
  const promoteWorkflowSkill = path.match(/^\/api\/workflow-skills\/([^/]+)\/publish$/);
  if (promoteWorkflowSkill && method === 'POST') {
    requireAdministrator('发布流程技能草稿');
    const skill = mockWorkflowSkills.find((item) => item.id === promoteWorkflowSkill[1]);
    if (!skill) throw new Error('E_WORKFLOW_SKILL_NOT_FOUND: 流程技能不存在');
    skill.status = 'published';
    appendControlPlaneAudit('skill', '治理发布工作流技能', skill.name);
    return skill;
  }
  if (path === '/api/agents' && method === 'GET') return mockAgents.filter((agent) => inCurrentWorkspace(agent)).filter(canReadScopedResource);
  if (path === '/api/agents/imports' && method === 'GET') return mockAgentImports;
  if (path === '/api/agents/import' && method === 'POST') {
    const body = (opts.body ?? {}) as Record<string, any>;
    const importId = mockId('import');
    const agent = { id: mockId('agent'), name: body.name ?? '未命名导入智能体', category: body.category ?? 'AIOps', description: body.description ?? '', version: body.version ?? '0.1.0', status: 'available', lifecycleStatus: 'pending_review', source: body.source ?? '内部导入', rating: 0, installCount: 0, tools: body.tools ?? [], workspaceId: currentWorkspaceId, ownerId: identity?.id ?? 'u1', environment: 'sandbox', classification: 'internal', createdBy: identity?.id ?? 'u1', updatedAt: new Date().toISOString() } as Agent & Record<string, any>;
    mockAgents.unshift(agent);
    const record = { id: importId, agentId: agent.id, agentName: agent.name, source: agent.source, status: 'pending_review', submittedBy: '当前用户', submittedAt: new Date().toISOString(), checks: body.checks ?? [{ key: 'format', label: '配置格式', status: 'passed' }, { key: 'dependencies', label: '依赖检查', status: 'review' }, { key: 'risk', label: '风险扫描', status: 'review' }], mapping: body.mapping ?? { tools: [], mcp: [] }, risks: body.risks ?? [], audit: [{ id: mockId('audit'), action: 'IMPORT_SUBMIT', actor: '当前用户', time: new Date().toISOString(), result: '待审核' }] };
    mockAgentImports.unshift(record);
    return { ...agent, ...record };
  }
  const importAction = path.match(/^\/api\/agents\/imports\/([^/]+)(?:\/(approve|reject|audit))?$/);
  if (importAction) {
    const record = mockAgentImports.find((item) => item.id === importAction[1]);
    if (!record) return null;
    if (importAction[2] === 'audit' && method === 'GET') return record.audit;
    if ((importAction[2] === 'approve' || importAction[2] === 'reject') && method === 'POST') {
      requireAdministrator('审核智能体导入');
      record.status = importAction[2] === 'approve' ? 'approved' : 'rejected';
      record.audit.unshift({ id: mockId('audit'), action: importAction[2] === 'approve' ? 'IMPORT_APPROVE' : 'IMPORT_REJECT', actor: '当前用户', time: new Date().toISOString(), result: record.status });
      const agent = mockAgents.find((item) => item.id === record.agentId) as (Agent & Record<string, any>) | undefined;
      if (agent) agent.lifecycleStatus = record.status;
      return record;
    }
    if (method === 'GET') return record;
  }
  if (path === '/api/agents' && method === 'POST') {
    const body = (opts.body ?? {}) as Record<string, any>;
    const agent = { id: mockId('agent'), name: body.name ?? '未命名智能体', category: body.category ?? 'AIOps', description: body.description ?? '', version: '0.1.0', status: 'available', rating: 0, installCount: 0, tools: body.tools ?? [], workspaceId: currentWorkspaceId, ownerId: identity?.id ?? 'u1', environment: 'sandbox', lifecycleStatus: 'draft', classification: 'internal', createdBy: identity?.id ?? 'u1', updatedAt: new Date().toISOString() } as Agent;
    mockAgents.unshift(agent);
    return agent;
  }
  if (path === '/api/evaluations' && method === 'GET') return mockAgentRuntime.evaluations;
  if (path === '/api/evaluations' && method === 'POST') {
    const body = (opts.body ?? {}) as Record<string, any>;
    const evaluation = { id: mockId('eval'), status: 'baseline', accuracy: 0, recall: 0, p95Ms: 0, calls: 0, passedAt: new Date().toISOString(), ...body };
    mockAgentRuntime.evaluations.unshift(evaluation);
    return evaluation;
  }
  if (path === '/api/agents/alerts' && method === 'GET') return mockAgentRuntime.alerts.filter((item) => inCurrentWorkspace(mockAgents.find((agent) => agent.id === item.agentId) ?? { workspaceId: undefined }));
  if (path === '/api/agents/calls/live' && method === 'GET') return mockAgentRuntime.liveCalls.filter((item) => inCurrentWorkspace(mockAgents.find((agent) => agent.id === item.agentId) ?? { workspaceId: undefined }));
  if (path === '/api/agents/calls/live' && method === 'POST') {
    const call = { id: mockId('call'), ts: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), status: 'ok', ...((opts.body ?? {}) as Record<string, any>) };
    mockAgentRuntime.liveCalls.unshift(call);
    if (call.status === 'timeout' || call.status === 'error') mockAgentRuntime.alerts.unshift({ id: mockId('agent_alert'), agent: (call as any).agent ?? '智能体', agentId: (call as any).agentId, severity: call.status === 'timeout' ? 'warn' : 'error', type: 'latency', title: `运行${call.status === 'timeout' ? '超时' : '失败'}，需要关注`, ts: call.ts, acknowledged: false });
    return call;
  }
  const agentSkillBinding = path.match(/^\/api\/agents\/([^/]+)\/skills(?:\/([^/]+))?$/);
  if (agentSkillBinding) {
    const [, agentId, bindingSkillId] = agentSkillBinding;
    const agent = mockAgents.find((item) => item.id === agentId);
    if (!agent) throw new Error('智能体不存在');
    const bindings = mockAgentSkillBindings[agentId] ?? (mockAgentSkillBindings[agentId] = []);
    if (method === 'GET') return bindings;
    if (method === 'POST') {
      const body = (opts.body ?? {}) as { skillId?: string; approvalTicket?: string };
      const skill = mockSkills.find((item) => item.id === body.skillId);
      if (!skill) throw new Error('技能尚未安装到工作区，无法分配给智能体');
      if (agent.status !== 'installed') throw new Error('智能体尚未启用，无法安装技能');
      if (skill.riskLevel === 'high' && !body.approvalTicket) throw new Error('E_APPROVAL_REQUIRED: 高风险技能分配需要审批单号');
      if (bindings.some((binding) => binding.skillId === skill.id)) return bindings;
      bindings.push({ skillId: skill.id, skillName: skill.name, status: 'active', installedAt: new Date().toLocaleString('zh-CN') });
      const impact = mockSkillImpacts[skill.id] ?? { skillId: skill.id, agents: [], workflows: [], activeRuns: 0, uninstallAllowed: true };
      if (!impact.agents.includes(agent.name)) impact.agents.push(agent.name);
      impact.uninstallAllowed = false; impact.reason = `已分配给 ${impact.agents.length} 个智能体`;
      mockSkillImpacts[skill.id] = impact;
      appendControlPlaneAudit('skill', '分配技能到智能体', `${skill.name} → ${agent.name}`); return bindings;
    }
    if (method === 'DELETE' && bindingSkillId) {
      const index = bindings.findIndex((binding) => binding.skillId === bindingSkillId);
      if (index < 0) throw new Error('智能体未安装该技能');
      const [binding] = bindings.splice(index, 1); appendControlPlaneAudit('skill', '从智能体移除技能', `${binding.skillName} → ${agent.name}`); return binding;
    }
  }
  const agentPreflight = path.match(/^\/api\/agents\/([^/]+)\/publish-preflight$/);
  if (agentPreflight && method === 'GET') {
    const agent = mockAgents.find((item) => item.id === agentPreflight[1]);
    if (!agent || !inCurrentWorkspace(agent)) throw new Error('E_WORKSPACE_SCOPE: 无权读取其他工作区智能体');
    const evaluation = mockAgentRuntime.evaluations.find((item) => item.agentId === agent.id && ['champion', 'baseline'].includes(item.status));
    const bindings = mockAgentSkillBindings[agent.id] ?? [];
    const checks = [
      { key: 'configuration', label: '行为与工具配置', passed: (agent as any).configStatus === 'configured' || agent.status === 'installed' },
      { key: 'evaluation', label: '评测门槛', passed: Boolean(evaluation) },
      { key: 'bindings', label: '能力依赖绑定', passed: agent.tools.length > 0 || bindings.length > 0 },
      { key: 'approval', label: '发布审批', passed: agent.classification !== 'restricted' || (agent as any).approvalStatus === 'approved' },
    ];
    return { agentId: agent.id, ready: checks.every((check) => check.passed), checks, dependencies: { skills: bindings, tools: agent.tools }, correlationId: mockId('agent_preflight') };
  }
  const agentAction = path.match(/^\/api\/agents\/([^/]+)\/(install|uninstall|enable|disable|publish|config|audit|metrics|calls)$/);
  if (agentAction) {
    const [, agentId, action] = agentAction;
    const agent = mockAgents.find((item) => item.id === agentId);
    if (action === 'audit' && method === 'GET') return mockAgentRuntime.alerts.filter((item) => item.agentId === agentId);
    if (action === 'metrics' && method === 'GET') return { agentId, calls24h: mockAgentRuntime.liveCalls.filter((item) => item.agentId === agentId).length, successRate: 0.98, errorRate: 0.02, p95Ms: agent?.p95Ms ?? 0 };
    if (action === 'calls' && method === 'GET') return mockAgentRuntime.liveCalls.filter((item) => item.agentId === agentId);
    if (agent && (!inCurrentWorkspace(agent) || !canReadScopedResource(agent))) throw new Error('E_WORKSPACE_SCOPE: 无权操作其他工作区智能体');
    if (agent && method === 'POST') {
      if (!canChangeScopedResource(agent)) throw new Error('E_AGENT_OWNER_SCOPE: 仅可修改本人创建的智能体');
      if (action === 'install' || action === 'enable' || action === 'publish') agent.status = 'installed';
      if (action === 'uninstall' || action === 'disable') agent.status = 'available';
      return agent;
    }
  }
  const evaluationAction = path.match(/^\/api\/evaluations\/([^/]+)\/(run|stop|retry|report)$/);
  if (evaluationAction) {
    const evaluation = mockAgentRuntime.evaluations.find((item) => item.id === evaluationAction[1]);
    if (!evaluation) return null;
    if (evaluationAction[2] === 'report' && method === 'GET') return { ...evaluation, report: { passed: evaluation.accuracy >= 90, checks: ['准确率', '召回率', 'P95'] } };
    if (method === 'POST') { evaluation.status = evaluationAction[2] === 'stop' ? 'failed' : evaluationAction[2] === 'run' ? 'running' : 'baseline'; return evaluation; }
  }
  const alertAction = path.match(/^\/api\/agents\/alerts\/([^/]+)\/acknowledge$/);
  if (alertAction && method === 'POST') {
    const alert = mockAgentRuntime.alerts.find((item) => item.id === alertAction[1]);
    if (alert) alert.acknowledged = true;
    return alert ?? null;
  }
  if (path.startsWith('/api/agents/') && path.endsWith('/versions')) {
    const id = path.split('/')[3];
    return mockAgentVersions[id] ?? [];
  }
  if (path.startsWith('/api/agents/') && path.endsWith('/trend')) {
    const id = path.split('/')[3];
    return mockCallTrends[id] ?? [];
  }
  if (path === '/api/agents/rank') return mockAgentRank.filter((item) => inCurrentWorkspace(mockAgents.find((agent) => agent.id === item.id) ?? { workspaceId: undefined }));

  // 工作流
  if (path === '/api/workflows') return mockWorkflowCatalog.map((workflow) => ({ ...workflow, workspaceId: currentWorkspaceId, ownerId: 'u1', environment: 'production', lifecycleStatus: workflow.status, classification: 'internal', createdBy: 'u1', updatedAt: '2026-07-19T12:00:00.000Z' }));
  if (path === '/api/workflow-templates' && method === 'GET') {
    const origin = String((opts as any).query?.origin ?? '').toLowerCase();
    return mockWorkflowTemplates
      .filter((template) => {
        const source = (template as any).source ?? ((template as any).builtin === false ? 'personal' : 'platform');
        const builtin = (template as any).builtin !== false && source === 'platform';
        const isPersonal = source === 'personal' || (template as any).builtin === false;
        if (isPersonal) {
          const ws = (template as any).workspaceId;
          const ownerId = (template as any).ownerId;
          if (ws && ws !== currentWorkspaceId) return false;
          if (ownerId && ownerId !== (identity?.id ?? 'u1') && identity?.role !== 'admin') return false;
        }
        if (origin === 'platform' && isPersonal) return false;
        if (origin === 'personal' && !isPersonal) return false;
        return true;
      })
      .map((template) => {
        const source = (template as any).source ?? ((template as any).builtin === false ? 'personal' : 'platform');
        return {
          ...template,
          source,
          builtin: source === 'platform',
        };
      });
  }
  if (path === '/api/workflow-templates' && method === 'POST') {
    const body = (opts.body ?? {}) as Record<string, any>;
    const name = String(body.name ?? '').trim();
    if (!name) throw new Error('E_BAD_REQUEST: 模板名称不能为空');
    const graph = body.graph ?? { nodes: body.nodes ?? [], edges: body.edges ?? [] };
    const nodeCount = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
    const seq = Array.isArray(body.sequence) ? body.sequence : (graph.nodes ?? []).map((n: any) => n.kind ?? 'task');
    if (!nodeCount && !seq.length) throw new Error('E_BAD_REQUEST: 空画布不能保存为个人模板');
    const now = new Date().toISOString();
    const item: WorkflowTemplate = {
      id: mockId('wft-user'),
      name,
      description: String(body.description ?? '由当前画布另存的个人模板'),
      category: String(body.category ?? 'business'),
      department: String(body.department ?? 'it'),
      library: 'default',
      nodes: nodeCount || seq.length,
      installs: 0,
      rating: 0,
      version: String(body.version ?? '1.0.0'),
      owner: identity?.name ?? '业务构建者',
      ownerId: identity?.id ?? 'u1',
      workspaceId: currentWorkspaceId,
      verifiedAt: now.slice(0, 10),
      risk: (body.risk as any) ?? 'L2',
      health: '健康',
      successRate: 'Personal',
      audience: '本人 / 协作同事',
      dependencies: body.dependencies ?? [],
      dependencyStatus: body.dependencyStatus ?? [],
      blockers: [],
      sequence: seq as any,
      variables: body.variables ?? [],
      permissions: body.permissions ?? [],
      changelog: [{ version: '1.0.0', date: now.slice(0, 10), note: '个人创建' }],
      recentRuns: [],
      builtin: false,
      source: 'personal',
      certification: 'preview',
      graph,
    };
    mockWorkflowTemplates.unshift(item);
    return item;
  }
  const personalTplDelete = path.match(/^\/api\/workflow-templates\/([^/]+)$/);
  if (personalTplDelete && method === 'DELETE') {
    const id = decodeURIComponent(personalTplDelete[1]);
    const idx = mockWorkflowTemplates.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error('E_NOT_FOUND: 模板不存在');
    const item = mockWorkflowTemplates[idx] as any;
    const isPersonal = item.source === 'personal' || item.builtin === false;
    if (!isPersonal) throw new Error('E_ROLE_FORBIDDEN: 平台内置模板不可删除');
    if (item.ownerId && item.ownerId !== (identity?.id ?? 'u1') && identity?.role !== 'admin') {
      throw new Error('E_ROLE_FORBIDDEN: 仅可删除本人创建的个人模板');
    }
    mockWorkflowTemplates.splice(idx, 1);
    return { ok: true, id };
  }
  if (path === '/api/workflow-runs') return workflowControl.runs;
  if (path === '/api/workflow-kpi') return mockWorkflowKpi;
  if (path === '/api/workflows/generations' && method === 'GET') {
    return mockWorkflowGenerations.filter((item) => item.tenantId === 'tenant-acme' && item.workspaceId === currentWorkspaceId && item.ownerId === 'u1' && item.status !== 'expired');
  }
  if (path === '/api/workflows/orchestration-sessions' && method === 'GET') {
    const ownerId = identity?.id ?? 'u1';
    return mockOrchestrationSessions
      .filter((item) => item.tenantId === (identity?.tenantId ?? 'tenant-acme') && item.workspaceId === currentWorkspaceId && item.ownerId === ownerId)
      .map((item) => ({ ...item, documents: item.documents.map((doc) => ({ ...doc, content: undefined })) }));
  }
  if (path === '/api/workflows/orchestration-sessions' && method === 'POST') {
    const body = (opts.body ?? {}) as Record<string, any>;
    if (body.workspaceId && body.workspaceId !== currentWorkspaceId) throw new Error('E_WORKSPACE_SCOPE: 当前账号无权在该工作区创建编排会话');
    if (!ALLOWED_GENERATION_MODELS.has(String(body.model ?? '企业默认模型'))) throw new Error('当前工作区不允许使用该生成模型');
    const now = new Date().toISOString();
    const ownerId = identity?.id ?? 'u1';
    const session: OrchestrationSession = {
      id: mockId('orch'),
      title: String(body.title ?? '未命名编排会话').trim() || '未命名编排会话',
      status: 'drafting',
      workspaceId: currentWorkspaceId,
      tenantId: identity?.tenantId ?? 'tenant-acme',
      ownerId,
      model: String(body.model ?? '企业默认模型'),
      policyVersion: 'workflow-policy-v3',
      constraints: {
        riskLevel: body.constraints?.riskLevel ?? 'L2',
        requireApproval: body.constraints?.requireApproval !== false,
        requireAudit: true,
        requireRollback: body.constraints?.requireRollback !== false,
      },
      goal: String(body.goal ?? '').trim(),
      documents: [],
      messages: [{
        id: mockId('omsg'),
        role: 'system',
        content: '这是专家辅助编排会话：可上传 Markdown、补充描述，并随时一键生成草稿示例。澄清完全可选；结果不会自动执行、发布或覆盖线上流程。',
        createdAt: now,
        kind: 'chat',
      }],
      candidates: [],
      clarificationSkipped: false,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now,
      updatedAt: now,
    };
    mockOrchestrationSessions.unshift(session);
    workflowAudit(workflowControl, 'WORKFLOW_ORCH_SESSION_CREATE', session.id);
    return session;
  }
  const orchestrationSessionPath = path.match(/^\/api\/workflows\/orchestration-sessions\/([^/]+)(?:\/(documents|messages|generate|apply|discard|candidates))?$/);
  if (orchestrationSessionPath) {
    const session = mockOrchestrationSessions.find((item) => item.id === orchestrationSessionPath[1]);
    const ownerId = identity?.id ?? 'u1';
    if (!session || session.tenantId !== (identity?.tenantId ?? 'tenant-acme') || session.workspaceId !== currentWorkspaceId || session.ownerId !== ownerId) {
      throw new Error('E_WORKSPACE_SCOPE: 无权访问该编排会话');
    }
    const action = orchestrationSessionPath[2];
    if (!action && method === 'GET') return session;
    if (!action && method === 'PATCH') {
      const body = (opts.body ?? {}) as Record<string, any>;
      if (body.goal != null) session.goal = String(body.goal).trim().slice(0, 1000);
      if (body.title != null) session.title = String(body.title).trim() || session.title;
      if (body.model != null) {
        if (!ALLOWED_GENERATION_MODELS.has(String(body.model))) throw new Error('当前工作区不允许使用该生成模型');
        session.model = String(body.model);
      }
      if (body.constraints) {
        session.constraints = {
          riskLevel: body.constraints.riskLevel ?? session.constraints.riskLevel,
          requireApproval: body.constraints.requireApproval ?? session.constraints.requireApproval,
          requireAudit: true,
          requireRollback: body.constraints.requireRollback ?? session.constraints.requireRollback,
        };
      }
      session.updatedAt = new Date().toISOString();
      return session;
    }
    if (action === 'documents' && method === 'POST') {
      const body = (opts.body ?? {}) as { fileName?: string; content?: string; knowledgeDocId?: string };
      if (session.documents.length >= 3) throw new Error('单个编排会话最多引用 3 份文档');
      if (body.knowledgeDocId) {
        const knowledgeDoc = mockKnowledgeDocs.find((item) => item.id === body.knowledgeDocId);
        if (!knowledgeDoc || !inCurrentWorkspace(knowledgeDoc) || !canReadScopedResource(knowledgeDoc)) {
          throw new Error('E_WORKSPACE_SCOPE: 无权引用该知识文档');
        }
        if (knowledgeDoc.status !== 'ready') throw new Error('仅可引用已就绪的知识文档');
        const detail = knowledgeDocDetail(knowledgeDoc);
        const parsed = parseMarkdownDocument(`${knowledgeDoc.title}.md`, String(detail.content ?? `# ${knowledgeDoc.title}`), 'knowledge', knowledgeDoc.id);
        rejectUnsafeGenerationPrompt(parsed.content);
        const document: OrchestrationSessionDocument = { id: mockId('odoc'), createdAt: new Date().toISOString(), ...parsed };
        session.documents.push(document);
        session.messages.push({
          id: mockId('omsg'),
          role: 'assistant',
          content: `已引用知识中心「${document.title}」（${document.sections.length} 个章节）。可继续补充目标或一键生成示例。`,
          createdAt: new Date().toISOString(),
          kind: 'chat',
          status: 'completed',
        });
        session.updatedAt = new Date().toISOString();
        workflowAudit(workflowControl, 'WORKFLOW_ORCH_DOC_FROM_KB', `${session.id}:${document.id}:${knowledgeDoc.id}`);
        return { session, document };
      }
      const fileName = String(body.fileName ?? 'runbook.md');
      if (!/\.md$/i.test(fileName) && !/\.markdown$/i.test(fileName)) throw new Error('仅支持 Markdown（.md）文件');
      const content = String(body.content ?? '');
      if (!content.trim()) throw new Error('Markdown 内容不能为空');
      if (content.length > 80_000) throw new Error('单个 Markdown 不超过 80000 字符');
      rejectUnsafeGenerationPrompt(content);
      const parsed = parseMarkdownDocument(fileName, content, 'upload');
      const document: OrchestrationSessionDocument = { id: mockId('odoc'), createdAt: new Date().toISOString(), ...parsed };
      session.documents.push(document);
      session.messages.push({
        id: mockId('omsg'),
        role: 'assistant',
        content: `已解析「${document.title}」（${document.charCount} 字 / ${document.sections.length} 章节）。摘要：${document.summary}${document.headings.length ? `\n章节：${document.headings.slice(0, 5).join(' / ')}` : ''}\n可继续补充目标，或直接一键生成示例；也可将该文档沉淀到知识中心。`,
        createdAt: new Date().toISOString(),
        kind: 'chat',
        status: 'completed',
      });
      session.updatedAt = new Date().toISOString();
      workflowAudit(workflowControl, 'WORKFLOW_ORCH_DOC_UPLOAD', `${session.id}:${document.id}`);
      return { session, document };
    }
    if (action === 'messages' && method === 'POST') {
      const body = (opts.body ?? {}) as { content?: string; mode?: 'chat' | 'clarify'; stream?: boolean };
      const content = String(body.content ?? '').trim();
      if (!content || content.length < 2) throw new Error('请输入有效补充说明');
      rejectUnsafeGenerationPrompt(content);
      const mode = body.mode === 'clarify' ? 'clarify' : 'chat';
      const userMessage: OrchestrationSessionMessage = { id: mockId('omsg'), role: 'user', content, createdAt: new Date().toISOString(), kind: mode, status: 'completed' };
      session.messages.push(userMessage);
      if (!session.goal) session.goal = content.slice(0, 200);
      const modelResult = invokeOrchestrationModel(session, content, mode);
      const assistantMessage: OrchestrationSessionMessage = {
        id: mockId('omsg'),
        role: 'assistant',
        content: modelResult.content,
        createdAt: new Date().toISOString(),
        kind: mode,
        status: 'completed',
        streamChunks: modelResult.streamChunks,
        modelInvocation: modelResult.invocation,
      };
      session.messages.push(assistantMessage);
      session.updatedAt = new Date().toISOString();
      workflowAudit(workflowControl, 'WORKFLOW_ORCH_MESSAGE', `${session.id}:${mode}`);
      return { session, stream: { messageId: assistantMessage.id, chunks: modelResult.streamChunks, finalContent: modelResult.content } };
    }
    if (action === 'generate' && method === 'POST') {
      const body = (opts.body ?? {}) as { skipClarification?: boolean; note?: string; stream?: boolean };
      if (!session.goal && !session.documents.length && session.messages.filter((item) => item.role === 'user').length === 0) {
        throw new Error('请先填写业务目标或上传 Markdown');
      }
      if (body.skipClarification) session.clarificationSkipped = true;
      const note = String(body.note ?? '').trim();
      if (note) {
        rejectUnsafeGenerationPrompt(note);
        session.messages.push({ id: mockId('omsg'), role: 'user', content: note, createdAt: new Date().toISOString(), kind: 'generate', status: 'completed' });
        if (!session.goal) session.goal = note.slice(0, 200);
      }
      const modelResult = invokeOrchestrationModel(session, note || session.goal || 'generate', 'generate');
      const assistantMessage: OrchestrationSessionMessage = {
        id: mockId('omsg'),
        role: 'assistant',
        content: modelResult.content,
        createdAt: new Date().toISOString(),
        kind: 'generate',
        status: 'completed',
        streamChunks: modelResult.streamChunks,
        modelInvocation: modelResult.invocation,
      };
      session.messages.push(assistantMessage);
      const candidate = buildOrchestrationCandidate(session, assistantMessage.id);
      session.candidates.unshift(candidate);
      session.activeCandidateId = candidate.id;
      session.status = 'ready';
      session.updatedAt = new Date().toISOString();
      workflowAudit(workflowControl, 'WORKFLOW_ORCH_GENERATE', `${session.id}:${candidate.id}:${modelResult.invocation.promptDigest}`);
      return { session, candidate, stream: { messageId: assistantMessage.id, chunks: modelResult.streamChunks, finalContent: modelResult.content } };
    }
    if (action === 'apply' && method === 'POST') {
      const body = (opts.body ?? {}) as { candidateId?: string };
      if (session.status === 'applied' || session.status === 'discarded' || session.status === 'expired') throw new Error('该编排会话不可再次应用');
      if (new Date(session.expiresAt).getTime() < Date.now()) { session.status = 'expired'; throw new Error('编排会话已过期，请新建会话'); }
      const candidate = session.candidates.find((item) => item.id === (body.candidateId ?? session.activeCandidateId));
      if (!candidate) throw new Error('请先生成草稿示例');
      const revisionId = `rev_${mockId('wf')}`;
      const revisionNodes = JSON.parse(JSON.stringify(candidate.workflow.nodes));
      const revisionEdges = JSON.parse(JSON.stringify(candidate.workflow.edges));
      workflowGenerationRevisions.set(revisionId, { id: revisionId, generationId: session.id, nodes: revisionNodes, edges: revisionEdges, createdAt: new Date().toISOString() });
      workflowControl.versions.unshift(workflowVersionFromGraph({
        id: revisionId, label: `${revisionId} · AI 草稿`, time: '刚刚', desc: `AI 辅助编排会话 · ${session.id}`, status: 'draft',
        nodes: revisionNodes, edges: revisionEdges,
      }));
      session.status = 'applied';
      session.appliedRevisionId = revisionId;
      session.updatedAt = new Date().toISOString();
      workflowAudit(workflowControl, 'WORKFLOW_ORCH_APPLY', `${session.id}:${candidate.id}:${revisionId}`);
      return { ...session, revisionId, candidate };
    }
    if (action === 'discard' && method === 'POST') {
      session.status = 'discarded';
      session.updatedAt = new Date().toISOString();
      workflowAudit(workflowControl, 'WORKFLOW_ORCH_DISCARD', session.id);
      return session;
    }
  }
  const orchestrationCandidateAction = path.match(/^\/api\/workflows\/orchestration-sessions\/([^/]+)\/candidates\/([^/]+)\/(activate|patch)$/);
  if (orchestrationCandidateAction && method === 'POST') {
    const session = mockOrchestrationSessions.find((item) => item.id === orchestrationCandidateAction[1]);
    const ownerId = identity?.id ?? 'u1';
    if (!session || session.tenantId !== (identity?.tenantId ?? 'tenant-acme') || session.workspaceId !== currentWorkspaceId || session.ownerId !== ownerId) {
      throw new Error('E_WORKSPACE_SCOPE: 无权访问该编排会话');
    }
    const candidate = session.candidates.find((item) => item.id === orchestrationCandidateAction[2]);
    if (!candidate) throw new Error('草稿示例不存在');
    if (orchestrationCandidateAction[3] === 'activate') {
      session.activeCandidateId = candidate.id;
      session.updatedAt = new Date().toISOString();
      workflowAudit(workflowControl, 'WORKFLOW_ORCH_CANDIDATE_ACTIVATE', `${session.id}:${candidate.id}`);
      return session;
    }
    const body = (opts.body ?? {}) as { removeNodeId?: string; rename?: { nodeId: string; label: string }; move?: { nodeId: string; direction: 'up' | 'down' } };
    const patched = patchOrchestrationCandidate(candidate, body);
    const nextVersion = (session.candidates[0]?.version ?? candidate.version) + 1;
    const nextCandidate: OrchestrationCandidate = {
      ...candidate,
      id: mockId('cand'),
      version: nextVersion,
      label: `示例 v${nextVersion}`,
      createdAt: new Date().toISOString(),
      workflow: { nodes: patched.nodes, edges: patched.edges },
      changeSummary: patched.summary,
      qualityScore: Math.max(70, candidate.qualityScore - 1),
    };
    session.candidates.unshift(nextCandidate);
    session.activeCandidateId = nextCandidate.id;
    session.messages.push({
      id: mockId('omsg'),
      role: 'assistant',
      content: `已对 ${candidate.label} 做结构化微调并生成 ${nextCandidate.label}：\n${patched.summary.map((item) => `• ${item}`).join('\n')}`,
      createdAt: new Date().toISOString(),
      kind: 'patch',
      status: 'completed',
    });
    session.updatedAt = new Date().toISOString();
    workflowAudit(workflowControl, 'WORKFLOW_ORCH_CANDIDATE_PATCH', `${session.id}:${candidate.id}:${nextCandidate.id}`);
    return { session, candidate: nextCandidate };
  }
  const orchestrationRetrieve = path.match(/^\/api\/workflows\/orchestration-sessions\/([^/]+)\/retrieve-runbook$/);
  if (orchestrationRetrieve && method === 'POST') {
    const session = mockOrchestrationSessions.find((item) => item.id === orchestrationRetrieve[1]);
    const ownerId = identity?.id ?? 'u1';
    if (!session || session.tenantId !== (identity?.tenantId ?? 'tenant-acme') || session.workspaceId !== currentWorkspaceId || session.ownerId !== ownerId) {
      throw new Error('E_WORKSPACE_SCOPE: 无权访问该编排会话');
    }
    const body = (opts.body ?? {}) as { query?: string };
    const query = String(body.query ?? session.goal ?? '').trim() || 'Redis OOM';
    const hits = mockKnowledgeChunks
      .filter((chunk) => inCurrentWorkspace(chunk as any))
      .filter((chunk) => chunk.text.includes(query.slice(0, 4)) || /redis|oom|告警|证书|灰度/i.test(query) || chunk.score >= 0.7)
      .slice(0, 3)
      .map((chunk) => ({
        docId: chunk.docId,
        title: chunk.source,
        excerpt: chunk.text,
        score: chunk.score,
      }));
    session.lastRetrieve = { query, hits, at: new Date().toISOString() };
    const modelResult = invokeOrchestrationModel(session, query, 'retrieve');
    const assistantMessage: OrchestrationSessionMessage = {
      id: mockId('omsg'),
      role: 'assistant',
      content: modelResult.content,
      createdAt: new Date().toISOString(),
      kind: 'retrieve',
      status: 'completed',
      streamChunks: modelResult.streamChunks,
      modelInvocation: modelResult.invocation,
    };
    session.messages.push(assistantMessage);
    session.updatedAt = new Date().toISOString();
    workflowAudit(workflowControl, 'WORKFLOW_ORCH_RETRIEVE', `${session.id}:${hits.length}`);
    return { session, hits, stream: { messageId: assistantMessage.id, chunks: modelResult.streamChunks, finalContent: modelResult.content } };
  }
  const orchestrationProposeTemplate = path.match(/^\/api\/workflows\/orchestration-sessions\/([^/]+)\/propose-template$/);
  if (orchestrationProposeTemplate && method === 'POST') {
    const session = mockOrchestrationSessions.find((item) => item.id === orchestrationProposeTemplate[1]);
    const ownerId = identity?.id ?? 'u1';
    if (!session || session.tenantId !== (identity?.tenantId ?? 'tenant-acme') || session.workspaceId !== currentWorkspaceId || session.ownerId !== ownerId) {
      throw new Error('E_WORKSPACE_SCOPE: 无权访问该编排会话');
    }
    const candidate = session.candidates.find((item) => item.id === session.activeCandidateId) ?? session.candidates[0];
    if (!candidate) throw new Error('请先生成草稿示例再沉淀模版候选');
    if (session.templateCandidate?.status === 'pending_approval') throw new Error('已有待审批的模版候选，请等待治理完成');
    const body = (opts.body ?? {}) as { name?: string; description?: string };
    const templateCandidate: OrchestrationTemplateCandidate = {
      id: mockId('tplcand'),
      sessionId: session.id,
      candidateId: candidate.id,
      name: String(body.name ?? session.title ?? '编排会话模版候选').trim(),
      description: String(body.description ?? session.goal ?? candidate.changeSummary.join('；')).trim().slice(0, 240),
      status: 'pending_approval',
      requestedBy: identity?.name ?? '当前用户',
      requestedAt: new Date().toISOString(),
      workspaceId: currentWorkspaceId,
      sequence: candidate.workflow.nodes.map((node) => node.kind),
    };
    mockOrchestrationTemplateCandidates.unshift(templateCandidate);
    session.templateCandidate = templateCandidate;
    session.messages.push({
      id: mockId('omsg'),
      role: 'assistant',
      content: `已提交模版候选「${templateCandidate.name}」进入审批（pending_approval）。通过前不会进入模版库，也不会自动供数字伙伴装配。`,
      createdAt: new Date().toISOString(),
      kind: 'template',
      status: 'completed',
    });
    session.updatedAt = new Date().toISOString();
    workflowAudit(workflowControl, 'WORKFLOW_ORCH_TEMPLATE_PROPOSE', `${session.id}:${templateCandidate.id}`);
    return { session, templateCandidate };
  }
  const orchestrationDocDeposit = path.match(/^\/api\/workflows\/orchestration-sessions\/([^/]+)\/documents\/([^/]+)\/deposit-knowledge$/);
  if (orchestrationDocDeposit && method === 'POST') {
    const session = mockOrchestrationSessions.find((item) => item.id === orchestrationDocDeposit[1]);
    const ownerId = identity?.id ?? 'u1';
    if (!session || session.tenantId !== (identity?.tenantId ?? 'tenant-acme') || session.workspaceId !== currentWorkspaceId || session.ownerId !== ownerId) {
      throw new Error('E_WORKSPACE_SCOPE: 无权访问该编排会话');
    }
    const document = session.documents.find((item) => item.id === orchestrationDocDeposit[2]);
    if (!document) throw new Error('文档不存在');
    if (document.depositedKnowledgeDocId) {
      return { document, knowledgeDocId: document.depositedKnowledgeDocId, alreadyDeposited: true };
    }
    const knowledgeDoc: KnowledgeDoc = {
      id: mockId('knowledge_doc'),
      workspaceId: currentWorkspaceId,
      ownerId: identity?.id ?? 'u1',
      classification: 'internal',
      correlationId: mockId('knowledge_corr'),
      title: document.title,
      source: '编排会话沉淀',
      sizeKb: Math.max(1, Math.round(document.charCount / 1024)),
      chunks: 0,
      citeCount: 0,
      status: 'parsing',
      updatedAt: new Date().toISOString(),
    };
    mockKnowledgeDocs.unshift(knowledgeDoc);
    document.depositedKnowledgeDocId = knowledgeDoc.id;
    appendKnowledgeAudit('编排会话一键沉淀知识文档', knowledgeDoc.title);
    setTimeout(() => {
      knowledgeDoc.status = 'ready';
      knowledgeDoc.chunks = Math.max(8, Math.round(document.charCount / 400));
      knowledgeDoc.updatedAt = new Date().toISOString();
      appendKnowledgeAudit('沉淀文档解析与索引完成', knowledgeDoc.title);
    }, 1000);
    session.messages.push({
      id: mockId('omsg'),
      role: 'assistant',
      content: `已将「${document.title}」沉淀到知识中心（进入解析队列）。沉淀不会自动绑定生产检索权限，需在知识中心完成治理后再供数字伙伴引用。`,
      createdAt: new Date().toISOString(),
      kind: 'chat',
    });
    session.updatedAt = new Date().toISOString();
    workflowAudit(workflowControl, 'WORKFLOW_ORCH_KB_DEPOSIT', `${session.id}:${document.id}:${knowledgeDoc.id}`);
    return { document, knowledgeDoc, alreadyDeposited: false };
  }
  if (path === '/api/workflows/generate' && method === 'POST') {
    const body = (opts.body ?? {}) as Record<string, any>;
    const prompt = String(body.prompt ?? '').trim();
    const constraints = body.constraints ?? {};
    if (body.workspaceId && body.workspaceId !== currentWorkspaceId) throw new Error('E_WORKSPACE_SCOPE: 当前账号无权在该工作区生成工作流');
    if (!prompt || prompt.length < 8 || prompt.length > 1000) throw new Error('业务目标需为 8 至 1000 个字符');
    rejectUnsafeGenerationPrompt(prompt);
    if (!ALLOWED_GENERATION_MODELS.has(String(body.model))) throw new Error('当前工作区不允许使用该生成模型');
    const workflow = buildGeneratedWorkflow(prompt);
    const hasExternalWrite = workflow.nodes.some((node) => ['execute', 'http', 'mcp'].includes(node.kind));
    const dependencies = hasExternalWrite ? [{ type: 'tool' as const, name: '受控执行 Skill', status: 'available' as const }, { type: 'mcp' as const, name: 'kubernetes-mcp', status: 'missing' as const, reason: '当前工作区未授权写权限' }] : [{ type: 'agent' as const, name: '数字伙伴编排器', status: 'available' as const }];
    const generated: WorkflowGenerationRecord = {
      id: mockId('gen'),
      prompt,
      promptDigest: generationDigest(prompt),
      model: String(body.model),
      workspaceId: currentWorkspaceId,
      tenantId: 'tenant-acme',
      ownerId: 'u1',
      policyVersion: 'workflow-policy-v3',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      status: 'review_required',
      workflow,
      qualityScore: hasExternalWrite ? 82 : 90,
      requiresReview: true,
      checks: { structure: 'passed', dependencies: dependencies.some((dependency) => dependency.status === 'missing') ? 'review' : 'passed', risk: hasExternalWrite ? 'review' : 'passed' },
      dependencies,
      warnings: [
        '生成结果仅为可编辑草稿，不会自动执行、发布或覆盖线上流程',
        '审计留痕由工作区策略强制开启，需专家复核后才可应用',
        ...(hasExternalWrite ? ['高风险动作已补充双重审批与补偿回滚节点', '执行节点需要匹配工作区权限后才能试运行'] : []),
      ],
      risks: hasExternalWrite ? [{ level: constraints.riskLevel === 'L3' ? 'L3' : 'L2', node: '执行受控动作', text: '外部写入操作必须通过策略、双重审批、回滚和权限检查', requiresApproval: true }] : [],
    };
    mockWorkflowGenerations.unshift(generated);
    workflowAudit(workflowControl, 'WORKFLOW_GENERATE', `${generated.id}:${generated.promptDigest}`);
    return generated;
  }
  const generationAction = path.match(/^\/api\/workflows\/generations\/([^/]+)(?:\/(apply|discard))?$/);
  if (generationAction) {
    const record = mockWorkflowGenerations.find((item) => item.id === generationAction[1]);
    if (!record || record.tenantId !== 'tenant-acme' || record.workspaceId !== currentWorkspaceId || record.ownerId !== 'u1') throw new Error('E_WORKSPACE_SCOPE: 无权访问该生成记录');
    if (!generationAction[2] && method === 'GET') return record;
    if (generationAction[2] === 'discard' && method === 'POST') { record.status = 'discarded'; workflowAudit(workflowControl, 'WORKFLOW_GENERATION_DISCARD', record.id); return record; }
    if (generationAction[2] === 'apply' && method === 'POST') {
      if (record.status !== 'review_required' && record.status !== 'generated') throw new Error('该生成记录不可再次应用');
      if (new Date(record.expiresAt).getTime() < Date.now()) { record.status = 'expired'; throw new Error('生成记录已过期，请重新生成'); }
      const revisionId = `rev_${mockId('wf')}`;
      const revision = { id: revisionId, generationId: record.id, nodes: JSON.parse(JSON.stringify(record.workflow.nodes)), edges: JSON.parse(JSON.stringify(record.workflow.edges)), createdAt: new Date().toISOString() };
      workflowGenerationRevisions.set(revisionId, revision);
      workflowControl.versions.unshift(workflowVersionFromGraph({
        id: revisionId, label: `${revisionId} · AI 草稿`, time: '刚刚', desc: `AI 辅助编排 · ${record.promptDigest}`, status: 'draft',
        nodes: revision.nodes, edges: revision.edges,
      }));
      record.status = 'applied';
      record.revisionId = revisionId;
      workflowAudit(workflowControl, 'WORKFLOW_GENERATION_APPLY', `${record.id}:${revisionId}`);
      return { ...record, revisionId, revision };
    }
  }
  const workflowDetail = path.match(/^\/api\/workflows\/([^/]+)(?:\/(validate|run|audit|versions|publish|rollback|draft))?$/);
  if (workflowDetail && workflowDetail[1] !== 'generate' && workflowDetail[1] !== 'generations') {
    const action = workflowDetail[2];
    if (!action && method === 'GET') return workflowControl.draft;
    if (action === 'draft' && method === 'PUT') {
      const body = (opts.body ?? {}) as Record<string, any>;
      workflowControl.draft = { ...workflowControl.draft, ...body, workspaceId: currentWorkspaceId };
      const versionId = body.version ? String(body.version) : undefined;
      const revision = versionId ? workflowGenerationRevisions.get(versionId) : undefined;
      if (revision) {
        revision.nodes = JSON.parse(JSON.stringify(body.nodes ?? revision.nodes));
        revision.edges = JSON.parse(JSON.stringify(body.edges ?? revision.edges));
      }
      if (versionId) {
        const existing = workflowControl.versions.find((item) => item.id === versionId);
        if (existing) {
          if (existing.status === 'published') {
            throw new Error('E_WORKFLOW_VERSION_IMMUTABLE: 已发布版本不可覆盖，请另存为新草稿');
          }
          const graph = cloneWorkflowGraph(body.nodes ?? existing.nodes, body.edges ?? existing.edges);
          existing.nodes = graph.nodes;
          existing.edges = graph.edges;
          existing.nodeCount = graph.nodes.length;
          existing.edgeCount = graph.edges.length;
          existing.time = '刚刚';
          existing.desc = body.desc ?? existing.desc ?? '保存当前本地草稿';
          existing.evidenceMode = 'recorded';
        }
      }
      workflowAudit(workflowControl, 'WORKFLOW_SAVE', `${workflowDetail[1]}:${versionId ?? 'current-draft'}`);
      return workflowControl.draft;
    }
    if (action === 'validate' && method === 'POST') {
      const body = (opts.body ?? {}) as Record<string, any>;
      const revision = body.revisionId ? workflowGenerationRevisions.get(String(body.revisionId)) : undefined;
      if (body.revisionId && !revision) throw new Error('工作流修订版本不存在或无权访问');
      const draft = Array.isArray(body.nodes) && body.nodes.length
        ? { nodes: body.nodes, edges: body.edges ?? [] }
        : (revision ?? workflowControl.draft);
      const nodeKinds = (draft.nodes ?? []).map((node: any) => node.kind ?? node.data?.kind);
      const hasExternalWrite = nodeKinds.some((kind: string) => ['execute', 'http', 'mcp'].includes(kind));
      const hasApproval = nodeKinds.includes('approval');
      const hasAudit = nodeKinds.includes('audit');
      const hasRollback = nodeKinds.includes('compensate') || (draft.nodes ?? []).some((n: any) => /回滚|补偿/.test(String(n.label ?? n.data?.label ?? '')));
      const checks = {
        structure: draft.nodes?.length > 0 && draft.nodes.some((n: any) => ['trigger', 'schedule', 'event'].includes(n.kind ?? n.data?.kind)) ? 'passed' : 'failed',
        connections: draft.nodes?.every((n: any) => draft.nodes.length <= 1 || draft.edges?.some((e: any) => e.source === n.id || e.target === n.id)) ? 'passed' : 'failed',
        dependencies: hasExternalWrite ? 'review' : 'passed',
        permissions: hasExternalWrite ? 'review' : 'passed',
        risk: hasExternalWrite ? 'review' : 'passed',
        approval: !hasExternalWrite || hasApproval ? 'passed' : 'failed',
        audit: hasAudit ? 'passed' : (hasExternalWrite ? 'failed' : 'review'),
        rollback: !hasExternalWrite || hasRollback ? 'passed' : 'failed',
      };
      const passed = Object.values(checks).every((value) => value !== 'failed');
      const warnings = [
        ...(!hasExternalWrite || nodeKinds.includes('policy') ? [] : ['建议在外部写入前串联风险策略节点']),
        ...(Object.values(checks).some((value) => value === 'review') ? ['存在需复核项：依赖、权限或风险需人工确认后再生产执行'] : []),
        ...(Object.values(checks).some((value) => value === 'failed') ? ['存在结构门禁或治理项未通过，请先补齐审批、审计或回滚路径'] : []),
      ];
      workflowAudit(workflowControl, 'WORKFLOW_VALIDATE', workflowDetail[1], passed ? 'success' : 'failed');
      return { passed, revisionId: revision?.id ?? body.revisionId ?? null, checks, warnings };
    }
    if (action === 'run' && method === 'POST') {
      if (identity && !identity.permissions.includes('workflow.execute')) {
        throw new Error('E_WORKFLOW_EXECUTE_FORBIDDEN: 缺少工作流执行权限');
      }
      const body = (opts.body ?? {}) as Record<string, any>;
      const revision = body.version ? workflowGenerationRevisions.get(String(body.version)) : undefined;
      const runnableDraft = Array.isArray(body.nodes) && body.nodes.length
        ? { ...workflowControl.draft, nodes: body.nodes, edges: body.edges ?? [] }
        : (revision ?? workflowControl.draft);
      const nodeKinds = (runnableDraft.nodes ?? []).map((node: any) => node.kind ?? node.data?.kind);
      const hasExternalWrite = nodeKinds.some((kind: string) => ['execute', 'http', 'mcp'].includes(kind));
      const hasRollback = nodeKinds.includes('compensate') || (runnableDraft.nodes ?? []).some((n: any) => /回滚|补偿/.test(String(n.label ?? n.data?.label ?? '')));
      const hasFullGovernance = nodeKinds.includes('policy') && nodeKinds.includes('approval') && nodeKinds.includes('audit') && hasRollback;
      const hasSandboxGovernance = nodeKinds.includes('approval') && nodeKinds.includes('audit') && hasRollback;
      const sandboxTrial = body.mode !== 'production';
      if (!nodeKinds.some((kind: string) => ['trigger', 'schedule', 'event'].includes(kind))) throw new Error('工作流缺少触发节点，无法试运行');
      if (hasExternalWrite && !(sandboxTrial ? hasSandboxGovernance : hasFullGovernance)) {
        throw new Error(sandboxTrial
          ? '沙箱试运行仍需审批、审计与回滚路径'
          : '高风险动作缺少策略、审批、审计或补偿回滚，禁止试运行');
      }
      if (hasExternalWrite && !sandboxTrial) throw new Error('外部执行节点的依赖与权限尚未完成服务端授权，禁止生产试运行');
      const nodeSteps = buildRunNodeSteps(runnableDraft.nodes, { status: 'running' });
      const run: WorkflowRunRecord = {
        id: mockId('run'),
        workflowId: workflowDetail[1],
        workspaceId: currentWorkspaceId,
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        trigger: String(body.trigger ?? runnableDraft.name ?? workflowControl.draft.name ?? '工作流试运行'),
        status: 'running',
        duration: 0,
        steps: nodeSteps?.length ?? runnableDraft.nodes?.length ?? 0,
        who: identity?.name ?? '当前用户',
        revisionId: revision?.id ?? body.version ?? 'current-draft',
        correlationId: mockId('corr_run'),
        environment: sandboxTrial ? 'sandbox' : 'production',
        evidenceMode: 'recorded',
        nodeSteps,
        attempt: 1,
      };
      workflowControl.runs.unshift(run);
      workflowAudit(workflowControl, 'WORKFLOW_RUN', `${workflowDetail[1]}:${run.revisionId}:${run.id}`);
      return run;
    }
    if (action === 'versions' && method === 'GET') return workflowControl.versions.map((version) => ({
      ...version,
      nodes: cloneWorkflowGraph(version.nodes, version.edges).nodes,
      edges: cloneWorkflowGraph(version.nodes, version.edges).edges,
    }));
    if (action === 'versions' && method === 'POST') {
      if (identity && !identity.permissions.includes('workflow.write')) {
        throw new Error('E_WORKFLOW_WRITE_FORBIDDEN: 缺少工作流写权限');
      }
      const body = (opts.body ?? {}) as Record<string, any>;
      const nodes = Array.isArray(body.nodes) && body.nodes.length ? body.nodes : workflowControl.draft.nodes;
      const edges = Array.isArray(body.edges) ? body.edges : (workflowControl.draft.edges ?? []);
      if (!nodes?.length) throw new Error('E_WORKFLOW_VERSION_EMPTY: 空画布不能另存版本');
      const version = workflowVersionFromGraph({
        id: mockId('ver'),
        label: String(body.label ?? '').trim() || `草稿 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
        time: '刚刚',
        desc: String(body.desc ?? '从当前画布另存的草稿版本'),
        status: 'draft',
        parentVersionId: body.parentVersionId ? String(body.parentVersionId) : undefined,
        nodes,
        edges,
      });
      workflowControl.versions.unshift(version);
      workflowAudit(workflowControl, 'WORKFLOW_VERSION_SAVE', version.id);
      return version;
    }
    if (action === 'publish' && method === 'POST') {
      if (identity && !identity.permissions.includes('workflow.write')) {
        throw new Error('E_WORKFLOW_WRITE_FORBIDDEN: 缺少工作流写权限');
      }
      const body = (opts.body ?? {}) as Record<string, any>;
      const nodeKinds = (workflowControl.draft.nodes ?? []).map((node: any) => node.kind ?? node.data?.kind);
      const hasExternalWrite = nodeKinds.some((kind: string) => ['execute', 'http', 'mcp'].includes(kind));
      const hasRollback = nodeKinds.includes('compensate') || (workflowControl.draft.nodes ?? []).some((n: any) => /回滚|补偿/.test(String(n.label ?? n.data?.label ?? '')));
      const hasSandboxGovernance = nodeKinds.includes('approval') && nodeKinds.includes('audit') && hasRollback;
      if (hasExternalWrite && !hasSandboxGovernance) {
        throw new Error('高风险工作流缺少审批、审计或回滚路径，禁止发布');
      }
      if (hasExternalWrite && body.environment === 'production') {
        throw new Error('外部执行节点尚未完成依赖与权限授权，禁止发布到生产');
      }
      const published = workflowVersionFromGraph({
        id: mockId('pub'),
        label: String(body.label ?? '').trim() || `发布版 · ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
        time: '刚刚',
        desc: String(body.desc ?? `由 ${body.version ?? 'current-draft'} 发布`),
        status: 'published',
        publishedAt: new Date().toISOString(),
        parentVersionId: body.version ? String(body.version) : undefined,
        nodes: workflowControl.draft.nodes,
        edges: workflowControl.draft.edges ?? [],
      });
      workflowControl.versions.unshift(published);
      workflowControl.draft = { ...workflowControl.draft, status: 'published' };
      workflowAudit(workflowControl, 'WORKFLOW_PUBLISH', `${workflowDetail[1]}:${published.id}`);
      return { ...workflowControl.draft, publishedVersion: published };
    }
    if (action === 'rollback' && method === 'POST') {
      if (identity && !identity.permissions.includes('workflow.write')) {
        throw new Error('E_WORKFLOW_WRITE_FORBIDDEN: 缺少工作流写权限');
      }
      const body = (opts.body ?? {}) as Record<string, any>;
      const target = workflowControl.versions.find((item) => item.id === String(body.versionId ?? ''));
      if (!target) throw new Error('E_WORKFLOW_VERSION_NOT_FOUND: 版本不存在');
      if (!target.nodes?.length || target.evidenceMode === 'synthetic') {
        throw new Error('E_WORKFLOW_VERSION_NO_SNAPSHOT: 该版本无节点快照，无法回滚');
      }
      const graph = cloneWorkflowGraph(target.nodes, target.edges);
      workflowControl.draft = { ...workflowControl.draft, nodes: graph.nodes, edges: graph.edges, status: 'active' };
      const rolled = workflowVersionFromGraph({
        id: mockId('ver'),
        label: `回滚自 ${target.id}`,
        time: '刚刚',
        desc: `从 ${target.label} 回滚生成的草稿`,
        status: 'draft',
        parentVersionId: target.id,
        nodes: graph.nodes,
        edges: graph.edges,
      });
      workflowControl.versions.unshift(rolled);
      workflowAudit(workflowControl, 'WORKFLOW_ROLLBACK', `${target.id}→${rolled.id}`);
      return { draft: workflowControl.draft, version: rolled, restoredFrom: target.id };
    }
    if (action === 'audit' && method === 'GET') return workflowControl.audits;
  }
  const workflowRunAction = path.match(/^\/api\/workflows\/([^/]+)\/runs\/([^/]+)\/(retry|resume)$/);
  if (workflowRunAction && method === 'POST') {
    if (identity && !identity.permissions.includes('workflow.execute')) {
      throw new Error('E_WORKFLOW_EXECUTE_FORBIDDEN: 缺少工作流执行权限');
    }
    const run = workflowControl.runs.find((item) => item.id === workflowRunAction[2]) as WorkflowRunRecord | undefined;
    if (!run) throw new Error('E_WORKFLOW_RUN_NOT_FOUND: 运行记录不存在');
    if (workflowRunAction[1] !== run.workflowId && run.workflowId) {
      throw new Error('E_WORKFLOW_RUN_MISMATCH: 运行记录与工作流不匹配');
    }
    if (workflowRunAction[3] === 'resume' && run.status !== 'running') {
      throw new Error('E_WORKFLOW_RUN_NOT_RESUMABLE: 仅运行中的记录可继续');
    }
    if (workflowRunAction[3] === 'retry') {
      if (run.status !== 'failed') {
        throw new Error('E_WORKFLOW_RUN_NOT_RETRYABLE: 仅失败的运行记录可重试');
      }
      const attempt = (run.attempt ?? 1) + 1;
      const retryRun: WorkflowRunRecord = {
        ...run,
        id: mockId('run'),
        time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        status: 'running',
        duration: 0,
        error: undefined,
        correlationId: mockId('corr_run'),
        evidenceMode: run.nodeSteps?.length ? 'recorded' : 'synthetic',
        nodeSteps: run.nodeSteps?.length
          ? buildRunNodeSteps(run.nodeSteps.map((step) => ({ id: step.id, kind: step.kind, label: step.label })), { status: 'running' })
          : undefined,
        attempt,
        parentRunId: run.id,
        who: identity?.name ?? run.who,
      };
      workflowControl.runs.unshift(retryRun);
      workflowAudit(workflowControl, 'WORKFLOW_RUN_RETRY', `${retryRun.id}←${run.id}`);
      return retryRun;
    }
    run.status = 'running';
    workflowAudit(workflowControl, 'WORKFLOW_RUN_RESUME', run.id);
    return run;
  }
  if (path.match(/^\/api\/workflows\/[^/]+\/runs$/) && method === 'GET') return workflowControl.runs;

  // 知识运营工作台：所有写操作回写到同一份 mock 领域状态，便于前端验证完整交互链路。
  if (path === '/api/knowledge/docs' && method === 'GET') return mockKnowledgeDocs.filter(inCurrentWorkspace).filter(canReadScopedResource);
  if (path === '/api/knowledge/docs' && method === 'POST') {
    const body = (opts.body ?? {}) as { title?: string; source?: string; tags?: string; content?: string; fileName?: string; packageId?: string };
    if (!body.title?.trim()) throw new Error('文档标题不能为空');
    const content = String(body.content ?? '').trim();
    if (!content) throw new Error('文档正文不能为空，请上传 Markdown / 文本文件');
    const sizeKb = Math.max(1, Math.round(content.length / 1024));
    let packageId = body.packageId?.trim();
    if (packageId) {
      const target = mockKnowledgePackages.find((item) => item.id === packageId && inCurrentWorkspace(item));
      if (!target) throw new Error('目标知识包不存在');
    } else {
      const draft = mockKnowledgePackages.find((item) => inCurrentWorkspace(item) && (item.status === 'draft' || item.status === 'review'));
      if (draft) packageId = draft.id;
      else {
        const version = { id: mockId('knowledge_package_version'), version: 'v0.1', status: 'draft' as const, indexVersion: `idx-${Date.now()}`, qualityScore: 0, changeSummary: '初始草稿' };
        const created: KnowledgePackage = {
          id: mockId('knowledge_package'), workspaceId: currentWorkspaceId, ownerId: identity?.id ?? 'u1', environment: 'sandbox',
          name: '默认知识包', description: '自动创建的工作区知识包', domain: '通用', classification: 'internal',
          owner: identity?.name ?? '当前用户', status: 'draft', documentCount: 0, documentIds: [], consumers: 0,
          currentVersion: version, versions: [version],
        };
        mockKnowledgePackages.unshift(created);
        packageId = created.id;
      }
    }
    const doc: KnowledgeDoc = {
      id: mockId('knowledge_doc'),
      workspaceId: currentWorkspaceId,
      ownerId: identity?.id ?? 'u1',
      packageId,
      classification: 'internal',
      correlationId: mockId('knowledge_corr'),
      title: body.title.trim(),
      source: body.source ?? 'Runbook',
      sizeKb,
      chunks: 0,
      citeCount: 0,
      status: 'parsing',
      updatedAt: new Date().toISOString(),
    };
    knowledgeDocContents.set(doc.id, content);
    mockKnowledgeDocs.unshift(doc);
    const pkg = mockKnowledgePackages.find((item) => item.id === packageId);
    if (pkg) {
      const ids = [...(pkg.documentIds ?? [])];
      if (!ids.includes(doc.id)) ids.push(doc.id);
      pkg.documentIds = ids;
      pkg.documentCount = ids.length;
    }
    appendKnowledgeAudit('上传知识文档', doc.title);
    setTimeout(() => {
      doc.status = 'ready';
      doc.chunks = Math.max(1, Math.ceil(content.length / 400));
      doc.updatedAt = new Date().toISOString();
      appendKnowledgeAudit('文档解析与索引完成', doc.title);
    }, 1000);
    return doc;
  }
  if (path === '/api/knowledge/docs/review' && method === 'POST') {
    const body = (opts.body ?? {}) as { ids?: string[] };
    const ids = body.ids ?? [];
    if (!ids.length) throw new Error('请至少选择一项知识资产');
    appendKnowledgeAudit('发起知识复核', `${ids.length} 项资产`);
    return { ids, status: 'review_requested' };
  }
  const deleteKnowledgeDocsByIds = (ids: string[]) => {
    const want = new Set(ids.filter(Boolean));
    if (!want.size) throw new Error('请至少选择一项知识资产');
    const removed: KnowledgeDoc[] = [];
    for (let i = mockKnowledgeDocs.length - 1; i >= 0; i -= 1) {
      const doc = mockKnowledgeDocs[i];
      if (!want.has(doc.id) || !inCurrentWorkspace(doc)) continue;
      removed.push(doc);
      mockKnowledgeDocs.splice(i, 1);
      knowledgeDocContents.delete(doc.id);
    }
    if (!removed.length) throw new Error('文档不存在或不在当前工作区');
    for (const pkg of mockKnowledgePackages) {
      if (!pkg.documentIds?.length) continue;
      const next = pkg.documentIds.filter((id) => !want.has(id));
      if (next.length !== pkg.documentIds.length) {
        pkg.documentIds = next;
        pkg.documentCount = next.length;
      }
    }
    for (let i = mockKnowledgeChunks.length - 1; i >= 0; i -= 1) {
      if (want.has((mockKnowledgeChunks[i] as { docId?: string }).docId ?? '')) mockKnowledgeChunks.splice(i, 1);
    }
    for (let i = mockCitationTrace.length - 1; i >= 0; i -= 1) {
      if (want.has(mockCitationTrace[i].docId)) mockCitationTrace.splice(i, 1);
    }
    appendKnowledgeAudit('删除知识文档', removed.map((doc) => doc.title).join(','));
    return { deleted: removed.length, ids: removed.map((doc) => doc.id) };
  };
  if (path === '/api/knowledge/docs/delete' && method === 'POST') {
    const body = (opts.body ?? {}) as { ids?: string[] };
    return deleteKnowledgeDocsByIds(body.ids ?? []);
  }
  const knowledgeDetailPath = path.match(/^\/api\/knowledge\/doc\/([^/]+)$/);
  if (knowledgeDetailPath && method === 'GET') {
    const doc = mockKnowledgeDocs.find((item) => item.id === knowledgeDetailPath[1]);
    if (!doc || !inCurrentWorkspace(doc)) throw new Error('E_WORKSPACE_SCOPE: 无权读取其他工作区知识文档');
    return knowledgeDocDetail(doc);
  }
  if (knowledgeDetailPath && method === 'DELETE') {
    return deleteKnowledgeDocsByIds([knowledgeDetailPath[1]]);
  }
  if (path === '/api/knowledge/kb-list' && method === 'GET') return mockKbList;
  if (path === '/api/knowledge/kb-list' && method === 'POST') {
    const body = (opts.body ?? {}) as { key?: string; label?: string; source?: string; embedding?: string };
    if (!body.label?.trim()) throw new Error('知识库名称不能为空');
    const item = { key: body.key ?? mockId('kb'), label: body.label.trim(), source: body.source ?? 'Runbook', count: 0, embedding: body.embedding ?? 'BGE-M3' };
    mockKbList.push(item);
    appendKnowledgeAudit('创建知识库', item.label);
    return item;
  }
  if (path === '/api/knowledge/reindex' && method === 'POST') {
    const body = (opts.body ?? {}) as { kb?: string };
    const affected = mockKnowledgeDocs.filter((doc) => inCurrentWorkspace(doc) && doc.status !== 'failed');
    affected.forEach((doc) => { doc.status = 'indexing'; });
    appendKnowledgeAudit('启动索引重建', body.kb ?? '当前知识库');
    setTimeout(() => { affected.forEach((doc) => { doc.status = 'ready'; doc.updatedAt = new Date().toISOString(); }); appendKnowledgeAudit('索引重建完成', body.kb ?? '当前知识库'); }, 1200);
    return { status: 'indexing', affected: affected.length };
  }
  if (path === '/api/knowledge/search-history' && method === 'GET') return (mockSearchHistory as any[]).filter(inCurrentWorkspace);
  if (path === '/api/knowledge/citation-trace' && method === 'GET') return (mockCitationTrace as any[]).filter(inCurrentWorkspace);
  if (path === '/api/knowledge/eval' && method === 'GET') return mockEvalMetrics;
  if (path === '/api/knowledge/chunks/top' && method === 'GET') return (mockKnowledgeChunks as any[]).filter(inCurrentWorkspace);
  if (path === '/api/knowledge/retrieve' && method === 'POST') {
    const body = (opts.body ?? {}) as { query?: string; kb?: string };
    if (!body.query?.trim()) throw new Error('请输入检索问题');
    const query = body.query.trim();
    const normalized = query.toLowerCase();
    const workspaceChunks = (mockKnowledgeChunks as any[]).filter(inCurrentWorkspace);
    const results = workspaceChunks.filter((chunk) => `${chunk.source} ${chunk.text}`.toLowerCase().includes(normalized) || normalized.split(/\s+/).some((token) => token.length > 1 && `${chunk.source} ${chunk.text}`.toLowerCase().includes(token))).slice(0, 5);
    const resolved = (results.length ? results : workspaceChunks.slice(0, 4)).map((chunk, index) => ({ ...chunk, idx: index + 1, score: Math.min(.99, chunk.score + .01) }));
    (mockSearchHistory as any[]).unshift({ id: mockId('search'), workspaceId: currentWorkspaceId, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), query, kb: body.kb ?? 'Runbook', results: resolved.length, topScore: resolved[0]?.score ?? 0 });
    appendKnowledgeAudit('执行检索验证', query);
    return { results: resolved, metrics: mockEvalMetrics };
  }
  if (path === '/api/knowledge/chunks/rescore' && method === 'POST') {
    mockKnowledgeChunks.sort((a, b) => b.score - a.score).forEach((chunk, index) => { chunk.idx = index + 1; chunk.score = Math.min(.99, Math.max(.35, chunk.score + ((index % 2 ? -1 : 1) * .01))); });
    appendKnowledgeAudit('重新评估检索证据', 'Top-K Chunks');
    return mockKnowledgeChunks;
  }
  if (path === '/api/knowledge/sources' && method === 'GET') return (mockKnowledgeSources as any[]).filter(inCurrentWorkspace);
  if (path === '/api/knowledge/sources' && method === 'POST') {
    const body = (opts.body ?? {}) as Partial<KnowledgeSourceConnection> & { credentialHint?: string; syncNow?: boolean };
    if (!body.name?.trim()) throw new Error('数据源名称不能为空');
    const kind = body.kind ?? 'REST API';
    let endpoint = (body.endpoint ?? '').trim();
    if (kind === 'Webhook') {
      endpoint = `/hooks/knowledge/${currentWorkspaceId}/${mockId('wh')}`;
    } else if (!endpoint) {
      throw new Error('连接地址不能为空');
    }
    const source: KnowledgeSourceConnection = {
      id: mockId('knowledge_source'),
      name: body.name.trim(),
      kind,
      schedule: kind === 'Webhook' ? '事件推送' : (body.schedule ?? '每 1 小时'),
      endpoint,
      credentialHint: body.credentialHint?.trim() || undefined,
      lastSync: '尚未同步',
      documents: 0,
      status: 'attention',
    };
    Object.assign(source, { workspaceId: currentWorkspaceId });
    mockKnowledgeSources.unshift(source);
    appendKnowledgeAudit('接入知识数据源', source.name);
    return source;
  }
  const knowledgeSourceSync = path.match(/^\/api\/knowledge\/sources\/([^/]+)\/sync$/);
  if (knowledgeSourceSync && method === 'POST') {
    const source = mockKnowledgeSources.find((item) => item.id === knowledgeSourceSync[1]);
    if (!source || !inCurrentWorkspace(source as any)) throw new Error('E_WORKSPACE_SCOPE: 无权操作其他工作区数据源');
    source.status = 'healthy';
    source.lastSync = '刚刚';
    source.documents = Math.max(1, source.documents + 1);
    appendKnowledgeAudit('执行数据源同步', source.name);
    return source;
  }
  if (path === '/api/knowledge/governance' && method === 'GET') return mockKnowledgeGovernance;
  if (path === '/api/knowledge/governance' && method === 'PATCH') {
    const body = (opts.body ?? {}) as Partial<KnowledgeGovernancePolicy>;
    Object.assign(mockKnowledgeGovernance, body);
    appendKnowledgeAudit('更新知识治理策略', '知识运营工作台');
    return mockKnowledgeGovernance;
  }
  if (path === '/api/knowledge/audit' && method === 'GET') return mockKnowledgeAudit;

  // 知识包、加工、评测、图谱与消费者绑定：所有运行时绑定必须锁定已发布版本。
  if (path === '/api/knowledge/packages' && method === 'GET') return mockKnowledgePackages.filter(inCurrentWorkspace).filter(canReadScopedResource);
  if (path === '/api/knowledge/packages' && method === 'POST') {
    const body = (opts.body ?? {}) as Partial<KnowledgePackage>;
    if (!body.name?.trim()) throw new Error('知识包名称不能为空');
    const version = { id: mockId('knowledge_package_version'), version: 'v0.1', status: 'draft' as const, indexVersion: `idx-${Date.now()}`, qualityScore: 0, changeSummary: '首次创建，等待加工与评测' };
    const item: KnowledgePackage = {
      id: mockId('knowledge_package'), workspaceId: currentWorkspaceId, ownerId: identity?.id ?? 'u1', environment: 'sandbox',
      name: body.name.trim(), description: body.description?.trim() ?? '待补充知识包说明', domain: body.domain?.trim() ?? '通用',
      classification: body.classification ?? 'internal', owner: identity?.name ?? '当前用户', status: 'draft',
      documentCount: 0, documentIds: [], consumers: 0, currentVersion: version, versions: [version],
    };
    mockKnowledgePackages.unshift(item);
    appendKnowledgeAudit('创建知识包', item.name);
    return item;
  }
  const bumpMockPackageVersion = (version: string) => {
    const prefix = version.startsWith('v') || version.startsWith('V') ? version[0] : '';
    const body = prefix ? version.slice(1) : version;
    const parts = body.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.some((n) => Number.isNaN(n))) return `${prefix}${body || '0.1'}.1`;
    while (parts.length < 3) parts.push(0);
    parts[parts.length - 1] += 1;
    return `${prefix}${parts.join('.')}`;
  };
  const knowledgePackageAttach = path.match(/^\/api\/knowledge\/packages\/([^/]+)\/attach$/);
  if (knowledgePackageAttach && method === 'POST') {
    const item = mockKnowledgePackages.find((record) => record.id === knowledgePackageAttach[1]);
    if (!item || !inCurrentWorkspace(item)) throw new Error('E_WORKSPACE_SCOPE: 无权操作其他工作区知识包');
    const body = (opts.body ?? {}) as { docIds?: string[] };
    const ids = body.docIds ?? [];
    if (!ids.length) throw new Error('请至少选择一篇文档');
    const before = item.documentIds?.length ?? 0;
    const merged = [...(item.documentIds ?? [])];
    let matched = 0;
    ids.forEach((docId) => {
      const doc = mockKnowledgeDocs.find((record) => record.id === docId && inCurrentWorkspace(record));
      if (!doc) return;
      matched += 1;
      doc.packageId = item.id;
      if (!merged.includes(docId)) merged.push(docId);
    });
    if (!matched) throw new Error('未找到可纳管的工作区文档');
    item.documentIds = merged;
    item.documentCount = merged.length;
    if (item.status === 'published' && merged.length > before) item.status = 'review';
    appendKnowledgeAudit('纳管知识文档', `${item.name} · ${matched} 篇`);
    return item;
  }
  const knowledgePackagePublish = path.match(/^\/api\/knowledge\/packages\/([^/]+)\/publish$/);
  if (knowledgePackagePublish && method === 'POST') {
    const item = mockKnowledgePackages.find((record) => record.id === knowledgePackagePublish[1]);
    if (!item || !inCurrentWorkspace(item)) throw new Error('E_WORKSPACE_SCOPE: 无权操作其他工作区知识包');
    if (item.status === 'archived' || item.status === 'deprecated') throw new Error('已归档/废弃的知识包不可发布');
    const memberIds = item.documentIds?.length
      ? item.documentIds
      : mockKnowledgeDocs.filter((doc) => inCurrentWorkspace(doc) && doc.packageId === item.id).map((doc) => doc.id);
    item.documentIds = memberIds;
    item.documentCount = memberIds.length;
    if (!memberIds.length) throw new Error('知识包内无可发布文档，请先纳管并完成索引');
    const ready = mockKnowledgeDocs.filter((doc) => memberIds.includes(doc.id) && (doc.status === 'ready' || doc.status === 'published'));
    if (!ready.length) throw new Error('知识包内无可发布文档，请先纳管并完成索引');
    const latestEvaluation = mockKnowledgeEvaluations.find((evaluation) => evaluation.packageId === item.id);
    if (latestEvaluation?.status === 'failed') throw new Error('E_KNOWLEDGE_EVALUATION_FAILED');
    const prev = item.currentVersion;
    prev.status = 'deprecated';
    const verName = bumpMockPackageVersion(prev.version);
    const published = {
      id: mockId('knowledge_package_version'),
      version: verName,
      status: 'published' as const,
      publishedAt: new Date().toISOString(),
      indexVersion: `idx-${verName.replace(/[^\d]/g, '') || Date.now()}`,
      qualityScore: latestEvaluation ? Math.round(latestEvaluation.ndcg * 100) : prev.qualityScore || 90,
      changeSummary: prev.changeSummary || '已通过发布检查',
    };
    item.currentVersion = published;
    item.status = 'published';
    item.versions = [published, ...item.versions.map((version) => (version.id === prev.id ? prev : version))];
    ready.forEach((doc) => { if (doc.status === 'ready') doc.status = 'published'; });
    appendKnowledgeAudit('发布知识包版本', `${item.name} · ${published.version}`);
    return item;
  }
  const knowledgePackageProcess = path.match(/^\/api\/knowledge\/packages\/([^/]+)\/process$/);
  if (knowledgePackageProcess && method === 'POST') {
    const item = mockKnowledgePackages.find((record) => record.id === knowledgePackageProcess[1]);
    if (!item || !inCurrentWorkspace(item)) throw new Error('E_WORKSPACE_SCOPE: 无权操作其他工作区知识包');
    const memberCount = item.documentIds?.length ?? item.documentCount;
    if (!memberCount) throw new Error('知识包尚未纳管文档，无法启动加工');
    const body = (opts.body ?? {}) as { strategy?: KnowledgeProcessingJob['strategy'] };
    item.status = 'review';
    const job: KnowledgeProcessingJob = {
      id: mockId('knowledge_job'), packageId: item.id, source: item.name, strategy: body.strategy ?? 'semantic',
      status: 'running', documentCount: memberCount, chunkCount: 0, indexVersion: `idx-${Date.now()}`, startedAt: new Date().toISOString(),
    };
    mockKnowledgeProcessingJobs.unshift(job);
    appendKnowledgeAudit('启动知识加工', `${item.name} · ${job.strategy}`);
    return job;
  }
  const knowledgePackageDelete = path.match(/^\/api\/knowledge\/packages\/([^/]+)\/delete$/);
  if (knowledgePackageDelete && method === 'POST') {
    const index = mockKnowledgePackages.findIndex((record) => record.id === knowledgePackageDelete[1]);
    const item = index >= 0 ? mockKnowledgePackages[index] : undefined;
    if (!item || !inCurrentWorkspace(item)) throw new Error('E_WORKSPACE_SCOPE: 无权操作其他工作区知识包');
    if ((item.consumers ?? 0) > 0) throw new Error('知识包仍有运行时引用方，请先解除绑定再删除');
    if (mockKnowledgeBindings.some((binding) => binding.packageId === item.id && inCurrentWorkspace(binding))) {
      throw new Error('知识包仍有运行时绑定，请先解除绑定再删除');
    }
    mockKnowledgePackages.splice(index, 1);
    mockKnowledgeDocs.forEach((doc) => {
      if (doc.packageId === item.id) delete doc.packageId;
    });
    for (let i = mockKnowledgeProcessingJobs.length - 1; i >= 0; i -= 1) {
      if (mockKnowledgeProcessingJobs[i].packageId === item.id) mockKnowledgeProcessingJobs.splice(i, 1);
    }
    for (let i = mockKnowledgeProfiles.length - 1; i >= 0; i -= 1) {
      if (mockKnowledgeProfiles[i].packageId === item.id) mockKnowledgeProfiles.splice(i, 1);
    }
    for (let i = mockKnowledgeEvaluations.length - 1; i >= 0; i -= 1) {
      if (mockKnowledgeEvaluations[i].packageId === item.id) mockKnowledgeEvaluations.splice(i, 1);
    }
    appendKnowledgeAudit('删除知识包', item.name);
    return { id: item.id, deleted: true };
  }
  const knowledgeJobRetry = path.match(/^\/api\/knowledge\/processing-jobs\/([^/]+)\/retry$/);
  if (knowledgeJobRetry && method === 'POST') {
    const job = mockKnowledgeProcessingJobs.find((record) => record.id === knowledgeJobRetry[1]);
    if (!job) throw new Error('知识加工任务不存在');
    job.status = 'running'; job.error = undefined; job.startedAt = new Date().toISOString();
    appendKnowledgeAudit('重试知识加工', job.source);
    return job;
  }
  if (path === '/api/knowledge/processing-jobs' && method === 'GET') return mockKnowledgeProcessingJobs.filter((item) => knowledgePackageInCurrentWorkspace(item.packageId));
  if (path === '/api/knowledge/retrieval-profiles' && method === 'GET') return mockKnowledgeProfiles.filter((item) => knowledgePackageInCurrentWorkspace(item.packageId));
  if (path === '/api/knowledge/evaluations' && method === 'GET') return mockKnowledgeEvaluations.filter((item) => knowledgePackageInCurrentWorkspace(item.packageId));
  if (path === '/api/knowledge/evaluations/run' && method === 'POST') {
    const body = (opts.body ?? {}) as { packageId?: string; profileId?: string };
    const item = mockKnowledgePackages.find((record) => record.id === body.packageId);
    const profile = mockKnowledgeProfiles.find((record) => record.id === body.profileId) ?? mockKnowledgeProfiles.find((record) => record.packageId === body.packageId);
    if (!item || !profile) throw new Error('请选择知识包和检索配置');
    const evaluation: KnowledgeEvaluation = { id: mockId('knowledge_evaluation'), packageId: item.id, profileId: profile.id, baselineVersion: item.currentVersion.version, evaluatedVersion: item.currentVersion.version, recallAtK: .93, mrr: .88, ndcg: .90, citationAccuracy: .96, p95LatencyMs: 352, status: 'passed', evaluatedAt: new Date().toISOString() };
    mockKnowledgeEvaluations.unshift(evaluation);
    appendKnowledgeAudit('执行检索评测', `${item.name} · ${profile.name}`);
    return evaluation;
  }
  if (path === '/api/knowledge/graph/entities' && method === 'GET') return mockKnowledgeGraphEntities.filter((item) => inCurrentWorkspace(mockKnowledgeDocs.find((doc) => doc.id === item.sourceDocId) ?? { workspaceId: currentWorkspaceId }));
  if (path === '/api/knowledge/graph/relations' && method === 'GET') return mockKnowledgeGraphRelations.filter((item) => inCurrentWorkspace(mockKnowledgeDocs.find((doc) => doc.id === item.sourceDocId) ?? { workspaceId: currentWorkspaceId }));
  if (path === '/api/knowledge/bindings' && method === 'GET') return mockKnowledgeBindings.filter(inCurrentWorkspace);
  if (path === '/api/knowledge/bindings' && method === 'POST') {
    const body = (opts.body ?? {}) as Partial<KnowledgeConsumerBinding>;
    const item = mockKnowledgePackages.find((record) => record.id === body.packageId);
    if (!item || !inCurrentWorkspace(item)) throw new Error('E_WORKSPACE_SCOPE: 无权操作其他工作区知识包');
    if (item.status !== 'published' || item.currentVersion.status !== 'published') throw new Error('E_KNOWLEDGE_VERSION_NOT_PUBLISHED');
    if (!body.consumerId?.trim() || !body.consumerName?.trim() || !body.consumerType) throw new Error('引用方信息不完整');
    const profile = mockKnowledgeProfiles.find((record) => record.id === body.profileId && record.packageId === item.id) ?? mockKnowledgeProfiles.find((record) => record.packageId === item.id);
    if (!profile) throw new Error('知识包缺少可用检索配置');
    const binding: KnowledgeConsumerBinding = { id: mockId('knowledge_binding'), workspaceId: currentWorkspaceId, correlationId: mockId('knowledge_corr'), packageId: item.id, packageName: item.name, packageVersion: body.packageVersion ?? item.currentVersion.version, consumerType: body.consumerType, consumerId: body.consumerId, consumerName: body.consumerName, environment: body.environment ?? 'sandbox', profileId: profile.id, noResultPolicy: body.noResultPolicy ?? profile.noResultPolicy };
    mockKnowledgeBindings.unshift(binding); item.consumers += 1;
    appendKnowledgeAudit('绑定知识包引用', `${binding.consumerName} → ${item.name} ${binding.packageVersion}`);
    return binding;
  }

  // 技能：安装、运行、配置和权限统一写回同一个 Mock 领域，并产生日志。
  if (path === '/api/skills/governance/overview' && method === 'GET') {
    const health = mockSkillRuntimeHealth.filter((item) => inCurrentWorkspace(mockSkills.find((skill) => skill.id === item.skillId) ?? { workspaceId: undefined }));
    const incidents = mockSkillGovernanceIncidents.filter((item) => inCurrentWorkspace(mockSkills.find((skill) => skill.id === item.skillId) ?? { workspaceId: undefined }));
    const calls = health.reduce((total, item) => total + item.calls24h, 0);
    const weightedSuccess = calls ? health.reduce((total, item) => total + item.calls24h * item.successRate, 0) / calls : 1;
    return { calls24h: calls, successRate: Number(weightedSuccess.toFixed(2)), p95Ms: 220, abnormalSkills: health.filter((item) => item.status === 'attention' || item.status === 'incident').length, pendingActions: incidents.filter((item) => item.status === 'open').length };
  }
  if (path === '/api/skills/governance/health' && method === 'GET') return mockSkillRuntimeHealth.filter((item) => inCurrentWorkspace(mockSkills.find((skill) => skill.id === item.skillId) ?? { workspaceId: undefined }));
  if (path === '/api/skills/governance/incidents' && method === 'GET') return mockSkillGovernanceIncidents.filter((item) => inCurrentWorkspace(mockSkills.find((skill) => skill.id === item.skillId) ?? { workspaceId: undefined }));
  if (path === '/api/skills/governance/events' && method === 'GET') return mockSkillGovernanceEvents.filter((event) => inCurrentWorkspace(mockSkills.find((skill) => skill.name === event.skillName) ?? { workspaceId: undefined }));
  if (path === '/api/skills/governance/trends' && method === 'GET') return [{ time: '00:00', calls: 820, errorRate: .4, p95: 120 }, { time: '04:00', calls: 620, errorRate: .3, p95: 100 }, { time: '08:00', calls: 1480, errorRate: .8, p95: 180 }, { time: '12:00', calls: 2260, errorRate: 2.1, p95: 360 }, { time: '16:00', calls: 1880, errorRate: 1.2, p95: 240 }, { time: '20:00', calls: 1320, errorRate: .5, p95: 140 }];
  const governanceSkillAction = path.match(/^\/api\/skills\/([^/]+)\/(revalidate|isolate)$/);
  if (governanceSkillAction && method === 'POST') {
    const health = mockSkillRuntimeHealth.find((item) => item.skillId === governanceSkillAction[1]);
    if (!health) throw new Error('运行健康记录不存在');
    if (governanceSkillAction[2] === 'revalidate') { health.status = 'healthy'; health.errorRate = Math.min(health.errorRate, .2); health.successRate = Math.max(health.successRate, 99.8); health.updatedAt = '刚刚'; mockSkillGovernanceEvents.unshift({ id: mockId('gov_event'), time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), skillName: health.name, type: 'call', action: '重新验证通过', actor: '当前用户', result: 'success' }); return health; }
    health.status = 'quarantined'; health.updatedAt = '刚刚'; mockSkillGovernanceEvents.unshift({ id: mockId('gov_event'), time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), skillName: health.name, type: 'lifecycle', action: '隔离能力', actor: '当前用户', result: 'success' }); return health;
  }
  if (path === '/api/skills/governance/batch' && method === 'POST') { const body = (opts.body ?? {}) as { skillIds?: string[]; action?: 'revalidate' | 'pause' }; const requested = mockSkillRuntimeHealth.filter((item) => body.skillIds?.includes(item.skillId)); if (requested.some((item) => !inCurrentWorkspace(mockSkills.find((skill) => skill.id === item.skillId) ?? { workspaceId: undefined }))) throw new Error('E_WORKSPACE_SCOPE: 批量治理不能跨工作区操作技能'); const affected = requested.filter((item) => inCurrentWorkspace(mockSkills.find((skill) => skill.id === item.skillId) ?? { workspaceId: undefined })); affected.forEach((item) => { item.status = body.action === 'pause' ? 'paused' : 'healthy'; item.updatedAt = '刚刚'; }); appendControlPlaneAudit('skill', body.action === 'pause' ? '批量暂停技能' : '批量重新验证技能', `${affected.length} 项`); return affected; }
  if (path === '/api/skill-integrations' && method === 'GET') return mockSkillIntegrations;
  const integrationAction = path.match(/^\/api\/skill-integrations\/([^/]+)\/(test|discover|lifecycle)$/);
  if (integrationAction) {
    const integration = mockSkillIntegrations.find((item) => item.id === integrationAction[1]);
    if (!integration) throw new Error('接入任务不存在');
    const body = (opts.body ?? {}) as Partial<SkillIntegration>;
    if (integrationAction[2] === 'test' && method === 'POST') {
      const verifiedAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      if (!integration.skillId && integration.credentialRef?.startsWith('vault://skills/')) {
        integration.skillId = integration.credentialRef.split('/')[3];
      }
      if (integration.type === 'skill' && integration.skillId) {
        const linked = mockSkills.find((item) => item.id === integration.skillId);
        if (!linked) {
          integration.lastVerifiedAt = verifiedAt;
          integration.health = 'attention';
          integration.status = 'failed';
          integration.lastError = '关联技能不存在或已卸载';
          appendControlPlaneAudit('skill', '执行接入连通性验证', integration.name, 'failed');
          throw new Error(integration.lastError);
        }
        (linked as any).lastVerifiedAt = verifiedAt;
      }
      integration.lastVerifiedAt = verifiedAt;
      delete integration.lastError;
      integration.health = 'healthy';
      if (integration.status === 'validating' || integration.status === 'draft' || integration.status === 'failed') {
        integration.status = 'enabled';
      }
      appendControlPlaneAudit('skill', '执行接入连通性验证', integration.name, 'success');
      return integration;
    }
    if (integrationAction[2] === 'discover' && method === 'POST') { if (integration.status === 'failed') throw new Error(integration.lastError ?? '接入验证未通过'); integration.discoveredCapabilities = integration.discoveredCapabilities || (integration.type === 'mcp' ? 12 : integration.type === 'tool' ? 6 : 1); integration.status = integration.writeApprovalRequired && integration.environment === 'production' ? 'pending_approval' : 'enabled'; appendControlPlaneAudit('skill', '发现接入能力', integration.name); return integration; }
    if (integrationAction[2] === 'lifecycle' && method === 'PATCH') { Object.assign(integration, body); appendControlPlaneAudit('skill', '更新接入任务状态', `${integration.name}:${integration.status}`); return integration; }
  }
  if (path === '/api/skills' && method === 'GET') return mockSkills.filter(inCurrentWorkspace).map(skillAsset);
  if (path === '/api/skills/catalog' && method === 'GET') {
    const channel = String((opts as any).query?.channel ?? '');
    const releaseChannel = String((opts as any).query?.releaseChannel ?? '');
    const items = mockSkillCatalog.filter((item: any) => {
      const scope = item.visibilityScope ?? (item.workspaceId && !['w1'].includes(item.workspaceId) ? 'workspace' : 'global');
      if (scope === 'workspace' && item.workspaceId && item.workspaceId !== currentWorkspaceId) return false;
      if (scope === 'org' && item.workspaceId && item.workspaceId !== currentWorkspaceId) return false;
      if (channel && (item.channel ?? 'builtin') !== channel) return false;
      if (releaseChannel && (item.releaseChannel ?? 'stable') !== releaseChannel) return false;
      return true;
    }).map((item: any) => ({
      ...item,
      channel: item.channel ?? 'builtin',
      channelLabel: item.channel === 'registry' ? '企业 Registry' : item.channel === 'promoted' ? '工作区晋升' : '平台内置',
      syncedAt: item.syncedAt ?? '种子目录',
      visibilityScope: item.visibilityScope ?? 'global',
      releaseChannel: item.releaseChannel ?? 'stable',
    }));
    return {
      items,
      meta: {
        demoNotice: '平台内置条目用于冷启动；生产来源以 Registry 同步与工作区晋升为主。',
        channels: [
          { id: 'builtin', label: '平台内置' },
          { id: 'registry', label: '企业 Registry' },
          { id: 'promoted', label: '工作区晋升' },
        ],
        releaseChannels: ['stable', 'beta'],
      },
    };
  }
  if (path === '/api/skills/catalog/publish' && method === 'POST') {
    if (identity && !identity.permissions.includes('skill.write')) throw new Error('E_FORBIDDEN: 缺少 skill.write');
    const body = (opts.body ?? {}) as { skillId?: string; releaseChannel?: string; visibilityScope?: string; approvalTicket?: string };
    const skill = mockSkills.find((item) => item.id === body.skillId && (!item.workspaceId || inCurrentWorkspace(item)));
    if (!skill) throw new Error('工作区技能不存在，无法晋升上架');
    const scope = body.visibilityScope === 'global' || body.visibilityScope === 'org' ? body.visibilityScope : 'workspace';
    if ((skill.riskLevel === 'high' || scope !== 'workspace') && !body.approvalTicket?.trim()) {
      throw new Error('E_APPROVAL_REQUIRED: 晋升上架需要审批单号（高风险/全局可见/需复核）');
    }
    if (scope !== 'workspace') requireAdministrator('全局/组织晋升上架');
    const entry = {
      id: mockId('sc'), workspaceId: currentWorkspaceId,
      name: skill.name, kind: skill.kind, description: skill.description, version: skill.version,
      status: 'available' as const, rating: skill.rating, installCount: skill.installCount,
      riskLevel: skill.riskLevel, cacheable: skill.cacheable, publisher: skill.owner ?? '当前用户',
      signed: true, dependencies: [] as string[], license: '内部许可', lastScannedAt: '刚刚',
      vulnerabilityCount: 0, supportedEnvironments: ['测试', '生产'],
      channel: 'promoted', channelLabel: '工作区晋升', syncedAt: new Date().toISOString(),
      visibilityScope: scope, releaseChannel: body.releaseChannel === 'beta' ? 'beta' : 'stable',
      sourceSkillId: skill.id,
    };
    mockSkillCatalog.unshift(entry as any);
    appendControlPlaneAudit('skill', '晋升技能上架', `${skill.name}@${skill.version}`);
    return entry;
  }
  if (path === '/api/skills/catalog/sync' && method === 'POST') {
    if (identity && !identity.permissions.includes('skill.write')) throw new Error('E_FORBIDDEN: 缺少 skill.write');
    requireAdministrator('同步技能商店 Registry');
    const body = (opts.body ?? {}) as { items?: any[]; seedDemo?: boolean };
    let items = body.items ?? [];
    if (!items.length && body.seedDemo) {
      items = [{ name: 'registry-demo-cli', version: '1.0.0', description: '从企业 Registry 同步的演示技能', publisher: '企业能力商店', signed: true, vulnerabilityCount: 0, releaseChannel: 'stable', visibilityScope: 'global' }];
    }
    if (!items.length) throw new Error('请提供 items[] 或 seedDemo=true');
    const accepted: any[] = [];
    const rejected: any[] = [];
    for (const item of items) {
      if (item.signed === false) { rejected.push({ name: item.name, reason: '制品签名校验未通过，禁止安装' }); continue; }
      if ((item.vulnerabilityCount ?? 0) >= 3) { rejected.push({ name: item.name, reason: '存在高危漏洞（≥3），禁止安装' }); continue; }
      const entry = {
        id: mockId('sc'), workspaceId: currentWorkspaceId, name: item.name, kind: item.kind ?? 'skill',
        description: item.description ?? `Registry 同步 · ${item.name}`, version: item.version ?? '0.1.0',
        status: 'available' as const, rating: 4, installCount: 0, riskLevel: item.riskLevel ?? 'low',
        cacheable: false, publisher: item.publisher ?? '企业能力商店', signed: true, dependencies: [],
        license: item.license ?? '内部许可', lastScannedAt: '刚刚', vulnerabilityCount: item.vulnerabilityCount ?? 0,
        supportedEnvironments: ['测试', '生产'], channel: 'registry', channelLabel: '企业 Registry',
        syncedAt: new Date().toISOString(), visibilityScope: item.visibilityScope ?? 'global',
        releaseChannel: item.releaseChannel === 'beta' ? 'beta' : 'stable',
      };
      mockSkillCatalog.unshift(entry as any);
      accepted.push(entry);
    }
    appendControlPlaneAudit('skill', '同步技能商店 Registry', `${accepted.length} 接受/${rejected.length} 拒绝`);
    return { accepted, rejected, acceptedCount: accepted.length, rejectedCount: rejected.length, syncedAt: new Date().toISOString() };
  }
  if (path === '/api/skills/audit' && method === 'GET') return skillAuditEvents();
  if (path === '/api/mcp-connections' && method === 'POST') {
    evaluateZeroTrust({ resource: 'skill', action: 'connect', external: true });
    requireAdministrator('接入外部 MCP');
    const body = (opts.body ?? {}) as { name?: string; endpoint?: string; authMode?: string; protocol?: string };
    if (!body.name?.trim() || !/^https:\/\//.test(body.endpoint ?? '')) throw new Error('MCP 名称和 HTTPS 服务地址不能为空');
    const protocolRaw = String(body.protocol ?? 'mcp-streamable-http').toLowerCase();
    const protocol = protocolRaw === 'mcp-sse' || protocolRaw === 'sse'
      ? 'mcp-sse'
      : protocolRaw === 'mcp-stdio' || protocolRaw === 'stdio'
        ? 'mcp-stdio'
        : protocolRaw === 'mcp-streamable-http' || protocolRaw === 'streamable-http' || protocolRaw === 'streamable_http' || !body.protocol
          ? 'mcp-streamable-http'
          : '';
    if (!protocol) throw new Error('不支持的协议规范，可选：mcp-streamable-http / mcp-sse / mcp-stdio');
    if (protocol === 'mcp-stdio') throw new Error('远程 HTTPS 接入不支持 stdio，请选择 Streamable HTTP 或 SSE');
    const skill: Skill = { id: mockId('mcp'), name: body.name.trim(), kind: 'mcp', description: `MCP · ${body.endpoint}`, version: '1.0.0', status: 'installed', rating: 0, installCount: 0, riskLevel: 'mid', cacheable: false };
    Object.assign(skill, { protocol, authMode: body.authMode ?? 'OAuth' });
    mockSkills.unshift(skill); mockSkillPermissions[skill.id] = mockSkillPerms.map((item) => ({ ...item, skillId: skill.id })); mockSkillIntegrations.unshift({ id: mockId('integration'), name: skill.name, type: 'mcp', environment: 'test', status: 'validating', owner: '当前用户', endpoint: body.endpoint!, credentialRef: `vault://integrations/${skill.id}/oauth`, lastVerifiedAt: '刚刚', health: 'unknown', discoveredCapabilities: 0, writeApprovalRequired: true, allowedEgress: [new URL(body.endpoint!).host], protocol, authMode: body.authMode ?? 'OAuth' } as any); appendControlPlaneAudit('skill', '配置 MCP 并预检', `${skill.name}:${body.authMode ?? 'OAuth'}:${protocol}`); return skill;
  }
  if (path === '/api/tools' && method === 'POST') {
    evaluateZeroTrust({ resource: 'skill', action: 'connect', external: true });
    requireAdministrator('注册外部 Tool');
    const body = (opts.body ?? {}) as { name?: string; endpoint?: string; schema?: string };
    if (!body.name?.trim() || !/^https:\/\//.test(body.endpoint ?? '') || !body.schema?.trim()) throw new Error('Tool 名称、HTTPS 地址和 Schema 不能为空');
    let schema: any;
    try { schema = JSON.parse(body.schema); } catch { throw new Error('Tool Schema 必须是有效的 JSON 文件或 JSON 文本'); }
    const isOpenApi = typeof schema?.openapi === 'string' && typeof schema?.info === 'object' && typeof schema?.paths === 'object';
    const isJsonSchema = typeof schema?.$schema === 'string' && (typeof schema?.type === 'string' || typeof schema?.properties === 'object');
    if (!isOpenApi && !isJsonSchema) throw new Error('仅支持标准 OpenAPI 3.x 或 JSON Schema Draft 文档');
    const skill: Skill = { id: mockId('tool'), name: body.name.trim(), kind: 'tool', description: `Tool · ${body.endpoint}`, version: '1.0.0', status: 'installed', rating: 0, installCount: 0, riskLevel: 'mid', cacheable: false };
    mockSkills.unshift(skill); mockSkillPermissions[skill.id] = mockSkillPerms.map((item) => ({ ...item, skillId: skill.id })); mockSkillIntegrations.unshift({ id: mockId('integration'), name: skill.name, type: 'tool', environment: 'test', status: 'validating', owner: '当前用户', endpoint: body.endpoint!, credentialRef: `vault://integrations/${skill.id}/service-account`, lastVerifiedAt: '刚刚', health: 'unknown', discoveredCapabilities: 0, writeApprovalRequired: true, allowedEgress: [new URL(body.endpoint!).host] }); appendControlPlaneAudit('skill', '配置 Tool 并预检', skill.name); return skill;
  }
  if (path === '/api/skills' && method === 'POST') {
    const body = (opts.body ?? {}) as Partial<Skill>;
    if (!body.name?.trim() || !body.description?.trim()) throw new Error('技能名称和说明不能为空');
    const riskLevel = body.riskLevel ?? 'mid';
    const skill: Skill = { id: mockId('skill'), name: body.name.trim(), kind: body.kind ?? 'skill', description: body.description.trim(), version: body.version ?? '0.1.0', status: riskLevel === 'high' ? 'beta' : 'installed', rating: 0, installCount: 0, riskLevel, cacheable: Boolean(body.cacheable) };
    mockSkills.unshift(skill);
    mockSkillPermissions[skill.id] = mockSkillPerms.map((item) => ({ ...item, skillId: skill.id }));
    appendControlPlaneAudit('skill', '创建技能', skill.name); return skill;
  }
  if (path === '/api/skills/import' && method === 'POST') {
    const body = (opts.body ?? {}) as { items?: Array<Partial<Skill>> };
    const items = (body.items ?? []).filter((item) => item.name?.trim()).map((item) => {
      const riskLevel = item.riskLevel ?? 'mid';
      const skill: Skill = { id: mockId('skill'), name: item.name!.trim(), kind: item.kind ?? 'skill', description: item.description ?? `导入技能 · ${item.name}`, version: item.version ?? '0.1.0', status: riskLevel === 'high' ? 'beta' : 'installed', rating: 0, installCount: 0, riskLevel, cacheable: Boolean(item.cacheable) };
      mockSkills.unshift(skill);
      mockSkillPermissions[skill.id] = mockSkillPerms.map((permission) => ({ ...permission, skillId: skill.id }));
      mockSkillIntegrations.unshift({ id: mockId('integration'), name: skill.name, type: 'skill', environment: 'test', status: 'validating', owner: '当前用户', endpoint: `registry://import/${skill.name}:${skill.version}`, credentialRef: 'vault://registries/import-reader', lastVerifiedAt: '刚刚', health: 'unknown', discoveredCapabilities: 0, writeApprovalRequired: riskLevel === 'high', allowedEgress: ['registry.internal.example.com'] });
      return skill;
    });
    if (!items.length) throw new Error('未识别到可导入的技能');
    appendControlPlaneAudit('skill', '批量导入技能', `${items.length} 项`); return items;
  }
  if (path === '/api/skills/import-package' && method === 'POST') {
    const body = (opts.body ?? {}) as { fileName?: string; contentBase64?: string };
    if (!body.fileName || !body.contentBase64) throw new Error('请上传 .skill / .zip / .tgz 文件');
    const lower = body.fileName.toLowerCase();
    if (!lower.endsWith('.skill') && !lower.endsWith('.zip') && !lower.endsWith('.tgz') && !lower.endsWith('.tar.gz')) {
      throw new Error('仅支持 .skill / .zip / .tgz / .tar.gz');
    }
    // Mock：从文件名推导技能名，并标记为可执行包技能
    const base = body.fileName.replace(/\.(skill|zip|tgz|tar\.gz)$/i, '');
    const name = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'imported-skill';
    if (body.contentBase64.length > 14_000_000) throw new Error('技能包不能超过 10 MB');
    const skill: Skill = {
      id: mockId('skill'), name, kind: 'skill', workspaceId: currentWorkspaceId,
      description: `从技能包 ${body.fileName} 导入的 Agent Skill`,
      version: '0.1.0', status: 'installed', rating: 0, installCount: 0, riskLevel: 'mid',
      cacheable: false, source: 'package', hasScripts: true,
      packageFileName: body.fileName, scripts: ['scripts/main.py'], packageFiles: ['SKILL.md', 'scripts/main.py'],
    };
    mockSkills.unshift(skill);
    mockSkillPermissions[skill.id] = mockSkillPerms.map((permission) => ({ ...permission, skillId: skill.id }));
    mockSkillIntegrations.unshift({
      id: mockId('integration'), name: skill.name, type: 'skill', environment: 'test', status: 'enabled', owner: '当前用户',
      endpoint: `package://${skill.name}@${skill.version}`, credentialRef: `vault://skills/${skill.id}/runtime`,
      skillId: skill.id,
      lastVerifiedAt: '刚刚', health: 'healthy', discoveredCapabilities: 1, writeApprovalRequired: false, allowedEgress: [],
    });
    appendControlPlaneAudit('skill', '导入技能包', `${skill.name}@${skill.version}`);
    return skill;
  }
  const skillAction = path.match(/^\/api\/skills\/([^/]+)\/(install|uninstall|upgrade|test|runtime|permissions|impact|preflight|lifecycle|governance|upgrade-plan)$/);
  if (skillAction) {
    const [, id, action] = skillAction;
    const body = (opts.body ?? {}) as any;
    let skill = mockSkills.find((item) => item.id === id);
    const catalogSkill = mockSkillCatalog.find((item) => item.id === id);
    if (action === 'preflight' && method === 'POST') {
      const candidate = skill ?? catalogSkill;
      if (!candidate) throw new Error('技能或市场制品不存在');
      const missingDependency = (catalogSkill?.dependencies ?? []).filter((dependency) => dependency === 'jenkins-mcp').map((name) => ({ name, status: 'missing' as const }));
      const signed = catalogSkill?.signed ?? true;
      const vuln = catalogSkill?.vulnerabilityCount ?? 0;
      const publisher = catalogSkill?.publisher ?? '';
      const trusted = !catalogSkill || publisher === '企业能力商店' || publisher === 'SRE 平台组' || publisher === '安全运营组' || publisher === '流程平台组' || publisher === '消息平台组';
      const checks = [
        { label: '发布方信任', status: trusted ? 'passed' as const : 'review' as const },
        { label: '制品签名', status: signed ? 'passed' as const : 'failed' as const },
        { label: '漏洞扫描', status: vuln === 0 ? 'passed' as const : vuln >= 3 ? 'failed' as const : 'review' as const },
      ];
      let decision: SkillInstallPreflight['decision'] = 'approved';
      let reason: string | undefined;
      const requiresApproval = candidate.riskLevel === 'high' || !trusted || vuln > 0;
      if (missingDependency.length) { decision = 'blocked'; reason = '缺少受控 Jenkins 连接器，禁止安装'; }
      else if (!signed) { decision = 'blocked'; reason = '制品签名校验未通过，禁止安装'; }
      else if (vuln >= 3) { decision = 'blocked'; reason = '存在高危漏洞（≥3），禁止安装'; }
      else if (requiresApproval) { decision = 'review_required'; reason = !trusted ? '非受信发布方，需要安全负责人审批' : vuln > 0 ? '存在待修复漏洞，需要安全复核后安装' : '高风险能力需要安全负责人审批'; }
      const result: SkillInstallPreflight = { skillId: id, trustedPublisher: trusted, signatureValid: signed, dependencies: missingDependency, requiresApproval: decision === 'review_required', decision, reason, vulnerabilityCount: vuln, checks };
      appendControlPlaneAudit('skill', '安装预检', candidate.name, result.decision === 'blocked' ? 'failed' : 'success');
      return result;
    }
    if (action === 'install' && method === 'POST') {
      if (skill) return skill;
      const candidate = catalogSkill ?? body;
      const signed = catalogSkill?.signed ?? true;
      const vuln = catalogSkill?.vulnerabilityCount ?? 0;
      if (!signed) throw new Error('制品签名校验未通过，禁止安装');
      if (vuln >= 3) throw new Error('存在高危漏洞（≥3），禁止安装');
      const needsApproval = candidate.riskLevel === 'high' || vuln > 0 || (catalogSkill && catalogSkill.publisher !== '企业能力商店' && catalogSkill.publisher !== 'SRE 平台组' && catalogSkill.publisher !== '安全运营组' && catalogSkill.publisher !== '流程平台组' && catalogSkill.publisher !== '消息平台组');
      if (needsApproval && !body.approvalTicket) throw new Error('E_APPROVAL_REQUIRED: 高风险技能安装需要安全负责人审批');
      if ((catalogSkill?.dependencies ?? []).includes('jenkins-mcp')) throw new Error('E_DEPENDENCY_BLOCKED: 缺少受控 Jenkins 连接器');
      const installedSkill: Skill = { id: mockId('skill'), name: candidate.name ?? '未命名技能', kind: candidate.kind ?? 'skill', description: candidate.description ?? '', version: candidate.version ?? '0.1.0', status: 'installed', rating: candidate.rating ?? 0, installCount: candidate.installCount ?? 0, riskLevel: candidate.riskLevel ?? 'mid', cacheable: Boolean(candidate.cacheable) };
      Object.assign(installedSkill, { publisher: catalogSkill?.publisher, signed: catalogSkill?.signed, license: catalogSkill?.license, vulnerabilityCount: catalogSkill?.vulnerabilityCount, lastScannedAt: catalogSkill?.lastScannedAt });
      mockSkills.unshift(installedSkill);
      mockSkillPermissions[installedSkill.id] = mockSkillPerms.map((permission) => ({ ...permission, skillId: installedSkill.id }));
      appendControlPlaneAudit('skill', '安装技能', installedSkill.name); return installedSkill;
    }
    if (!skill) throw new Error('技能不存在');
    skill = skillAsset(skill);
    const impact = mockSkillImpacts[id] ?? { skillId: id, agents: [], workflows: [], activeRuns: 0, uninstallAllowed: true };
    if (action === 'impact' && method === 'GET') return impact;
    if (action === 'uninstall' && method === 'POST') {
      if ((impact.activeRuns ?? 0) > 0 && !body.force) throw new Error(`E_SKILL_IN_USE: ${impact.reason}`);
      if ((impact.activeRuns ?? 0) > 0 && !body.approvalTicket) throw new Error('E_APPROVAL_REQUIRED: 强制卸载必须提供审批单号');
      mockSkills.splice(mockSkills.indexOf(skill), 1); delete mockSkillPermissions[id]; delete mockSkillRuntime[id]; appendControlPlaneAudit('skill', (!impact.uninstallAllowed || body.force) ? '强制卸载技能' : '卸载技能', skill.name); return { id, status: 'uninstalled', impact };
    }
    if (action === 'lifecycle' && method === 'PATCH') { const next = body.lifecycleStatus; if (!['enabled', 'disabled', 'pending_approval', 'quarantined', 'deprecated'].includes(next)) throw new Error('不支持的技能生命周期状态'); skill.lifecycleStatus = next; Object.assign(mockSkills.find((item) => item.id === id)!, skill); appendControlPlaneAudit('skill', `更新技能状态为 ${next}`, skill.name); return skill; }
    if (action === 'governance' && method === 'GET') return skillGovernance(id);
    if (action === 'governance' && method === 'PATCH') { const policy = Object.assign(skillGovernance(id), body); appendControlPlaneAudit('skill', '更新运行治理策略', skill.name); return policy; }
    if (action === 'upgrade-plan' && method === 'POST') return { skillId: id, currentVersion: skill.version, targetVersion: body.targetVersion ?? skill.upgradeVersion ?? `${skill.version}-next`, checks: [{ label: '签名与供应链校验', status: 'passed' }, { label: '权限差异分析', status: skill.riskLevel === 'high' ? 'review' : 'passed' }, { label: '引用版本影响', status: impact.agents.length + impact.workflows.length ? 'review' : 'passed' }], impacted: impact, rollbackVersion: skill.version, approvalRequired: skill.riskLevel === 'high' || impact.agents.length + impact.workflows.length > 0 };
    if (action === 'upgrade' && method === 'POST') { const targetVersion = body.targetVersion ?? skill.upgradeVersion; if (!targetVersion) { const parts = skill.version.split('.').map(Number); skill.version = `${parts[0]}.${(parts[1] ?? 0) + 1}.${parts[2] ?? 0}`; } else skill.version = targetVersion; skill.hasUpdate = false; skill.upgradeVersion = undefined; Object.assign(mockSkills.find((item) => item.id === id)!, skill); appendControlPlaneAudit('skill', '升级技能', skill.name); return skill; }
    if (action === 'test' && method === 'POST') { const command = String(body.command ?? '').trim(); if (!command) throw new Error('请输入测试命令'); const blocked = /\b(rm\s+-rf|drop\s+database|force\s*push|--hard)\b/i.test(command); appendControlPlaneAudit('skill', blocked ? '策略拦截测试命令' : '执行沙箱测试', skill.name, blocked ? 'failed' : 'success'); return { command, status: blocked ? 'blocked' : 'success', output: blocked ? '⛔ 拒绝执行：高危命令已被策略拦截。' : `+OK\n${skill.name} v${skill.version} 已在受控沙箱中完成测试`, durationMs: blocked ? 5 : 80 }; }
    if (action === 'runtime' && method === 'GET') return mockSkillRuntime[id] ?? { cacheable: skill.cacheable, timeout: '30', retries: '1' };
    if (action === 'runtime' && method === 'PATCH') { mockSkillRuntime[id] = { ...(mockSkillRuntime[id] ?? { cacheable: skill.cacheable, timeout: '30', retries: '1' }), ...body }; appendControlPlaneAudit('skill', '更新运行配置', skill.name); return mockSkillRuntime[id]; }
    if (action === 'permissions' && method === 'GET') return mockSkillPermissions[id] ?? [];
    if (action === 'permissions' && method === 'PATCH') { const role = mockSkillPermissions[id]?.find((item) => item.role === body.role); if (!role) throw new Error('角色不存在'); Object.assign(role, { canCall: Boolean(body.canCall), canConfig: Boolean(body.canConfig) }); appendControlPlaneAudit('skill', '更新调用权限', `${skill.name}:${role.role}`); return role; }
  }
  if (path.startsWith('/api/skills/') && path.endsWith('/trace')) {
    const id = path.split('/')[3];
    return mockSkillExecTrace[id as keyof typeof mockSkillExecTrace] ?? null;
  }
  if (path.startsWith('/api/skills/') && path.endsWith('/versions')) {
    const id = path.split('/')[3];
    return mockSkillVersions[id as keyof typeof mockSkillVersions] ?? [];
  }
  if (path === '/api/skills/perms') return mockSkillPerms;

  // 模型控制面：以领域状态为唯一事实源。旧 P9 路径保留给历史页面，新增路径用于受控治理。
  if (path === '/api/model-providers/test-connection' && method === 'POST') {
    const context = requireModelWrite(opts, String((opts.body as any)?.workspaceId ?? opts.headers?.['x-workspace-id'] ?? 'w1'));
    const body = (opts.body ?? {}) as { protocol?: string; baseUrl?: string; apiKey?: string; credential?: string; providerId?: string };
    const hasCredential = Boolean(String(body.apiKey ?? body.credential ?? '').trim())
      || Boolean(body.providerId && modelProviders.some((item) => item.id === body.providerId && item.credentialRef));
    if (!String(body.baseUrl ?? '').trim() && !body.providerId) throw new Error('E_PROVIDER_TEST_URL: 请提供 Base URL 或已接入供应商');
    if (!hasCredential) throw new Error('E_PROVIDER_TEST_AUTH: 连通性测试需要 API Key 或已保存凭据');
    const latencyMs = 80 + Math.floor(Math.random() * 120);
    appendModelAudit(opts, '测试供应商连通性', body.protocol ?? body.baseUrl ?? 'draft', 'success', { reason: `probe ${latencyMs}ms` });
    return { status: 'healthy', latencyMs, suggestedProtocol: body.protocol, workspaceId: context.workspaceId };
  }
  if (path === '/api/model-providers/discover-models' && method === 'POST') {
    requireModelWrite(opts, (opts.body as any)?.workspaceId ?? 'w1');
    const body = (opts.body ?? {}) as any;
    const existing = body.providerId ? modelProviders.find((item) => item.id === String(body.providerId)) : undefined;
    const protocol = String(body.protocol ?? existing?.protocol ?? 'openai_compatible') as ModelConnectProtocol;
    const baseUrl = String(body.baseUrl ?? existing?.baseUrl ?? '').trim();
    if (!baseUrl) throw new Error('E_PROVIDER_DISCOVER_INVALID: 请先填写 API 请求地址');
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error('E_PROVIDER_DISCOVER_INVALID: API 请求地址格式无效');
    if (protocol !== 'ollama' && !String(body.apiKey ?? '').trim() && !existing) {
      throw new Error('E_PROVIDER_DISCOVER_AUTH: 拉取模型列表需要 API Key');
    }
    const catalogs: Record<ModelConnectProtocol, Array<{ id: string; name: string }>> = {
      openai_compatible: [
        { id: 'gpt-4o', name: 'gpt-4o' }, { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
        { id: 'gpt-4.1', name: 'gpt-4.1' }, { id: 'o3-mini', name: 'o3-mini' },
        { id: 'deepseek-chat', name: 'deepseek-chat' }, { id: 'deepseek-reasoner', name: 'deepseek-reasoner' },
      ],
      azure_openai: [
        { id: 'gpt-4o', name: 'gpt-4o' }, { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
        { id: 'gpt-35-turbo', name: 'gpt-35-turbo' }, { id: 'text-embedding-3-large', name: 'text-embedding-3-large' },
      ],
      anthropic: [
        { id: 'claude-sonnet-4-20250514', name: 'claude-sonnet-4-20250514' },
        { id: 'claude-opus-4-20250514', name: 'claude-opus-4-20250514' },
        { id: 'claude-haiku-4-20250514', name: 'claude-haiku-4-20250514' },
      ],
      dashscope: [
        { id: 'qwen-max', name: 'qwen-max' }, { id: 'qwen-plus', name: 'qwen-plus' },
        { id: 'qwen-turbo', name: 'qwen-turbo' }, { id: 'qwen2.5-72b-instruct', name: 'qwen2.5-72b-instruct' },
      ],
      ollama: [
        { id: 'qwen2.5:72b', name: 'qwen2.5:72b' }, { id: 'llama3.1:70b', name: 'llama3.1:70b' },
        { id: 'deepseek-r1:32b', name: 'deepseek-r1:32b' },
      ],
      custom: [
        { id: 'default', name: 'default' }, { id: 'chat', name: 'chat' }, { id: 'embeddings', name: 'embeddings' },
      ],
    };
    const models = catalogs[protocol] ?? catalogs.openai_compatible;
    appendModelAudit(opts, '拉取模型列表', baseUrl, 'success', { reason: `${protocol}:${models.length}` });
    return { protocol, baseUrl, models, fetchedAt: new Date().toISOString() };
  }
  if (path === '/api/model-providers' && method === 'GET') { const context = requireModelRead(opts); return modelProviders.filter((provider) => provider.workspaceId === context.workspaceId).map((provider) => ({ ...provider, models: provider.models.map((model) => ({ ...model })) })); }
  if (path === '/api/model-providers' && method === 'POST') {
    const body = (opts.body ?? {}) as any;
    const context = requireModelWrite(opts, body.workspaceId ?? 'w1');
    if (!body.name?.trim() || !body.model?.trim() || !body.credential?.trim()) {
      appendModelAudit(opts, '接入供应商', body.name ?? '未命名供应商', 'failed', { reason: '名称、模型和凭据引用必填' });
      throw new Error('E_PROVIDER_INVALID: 供应商名称、模型和凭据不能为空');
    }
    const providerId = mockId('model_provider');
    const region = String(body.region ?? 'global');
    const model: ModelProfile = {
      id: mockId('model'),
      providerId,
      name: body.model.trim(),
      cloudRegion: region,
      dataResidency: region.startsWith('cn-') || region === 'cn' ? 'cn' : 'global',
      capabilities: ['chat'],
      status: 'available',
      contextWindow: 32_000,
    };
    const provider: ModelProvider = {
      id: providerId,
      workspaceId: context.workspaceId,
      name: body.name.trim(),
      note: body.note ? String(body.note).trim() : undefined,
      protocol: body.protocol,
      tier: body.tier ?? 'connectable',
      baseUrl: body.baseUrl ? String(body.baseUrl).trim() : undefined,
      apiVersion: body.apiVersion ? String(body.apiVersion).trim() : undefined,
      organizationId: body.organizationId ? String(body.organizationId).trim() : undefined,
      deploymentName: body.deploymentName ? String(body.deploymentName).trim() : undefined,
      cloudRegion: model.cloudRegion,
      dataResidency: model.dataResidency,
      status: 'standby',
      credentialRef: `vault://model-providers/${providerId}/credential`,
      credentialMasked: '••••••••',
      models: [model],
    };
    modelProfiles.push(model);
    modelProviders.unshift(provider);
    appendModelAudit(opts, '接入供应商', provider.name, 'success', { reason: body.reason });
    return provider;
  }
  const modelProviderAction = path.match(/^\/api\/model-providers\/([^/]+)(?:\/(impact|test|disable))?$/);
  if (modelProviderAction) {
    const [, providerId, action] = modelProviderAction;
    const provider = modelProviders.find((item) => item.id === providerId);
    if (!provider) throw new Error('E_PROVIDER_NOT_FOUND: 供应商不存在');
    if (method === 'GET' && action === 'impact') { const context = requireModelRead(opts); if (provider.workspaceId !== context.workspaceId) throw new Error('E_WORKSPACE_SCOPE: 无权读取其他工作区模型资源'); return providerImpact(provider.id); }
    const body = (opts.body ?? {}) as any;
    requireModelWrite(opts, provider.workspaceId);
    if (method === 'POST' && action === 'test') {
      provider.lastVerifiedAt = new Date().toISOString();
      if (provider.status === 'standby' || provider.status === 'draft' || provider.status === 'offline') {
        provider.status = 'active';
      }
      provider.models.forEach((model) => { if (provider.status === 'active') model.status = 'available'; });
      appendModelAudit(opts, '验证供应商连通性', provider.name, 'success', { reason: body.reason });
      return { providerId: provider.id, status: 'healthy', providerStatus: provider.status, verifiedAt: provider.lastVerifiedAt };
    }
    if (method === 'PATCH' && !action) {
      if (!body.name?.trim() && !body.region && !body.tier && body.baseUrl == null && body.protocol == null && body.model == null && body.note == null && body.apiVersion == null && body.organizationId == null && body.deploymentName == null && !body.credential) {
        throw new Error('E_PROVIDER_INVALID: 请至少提供一项连接配置变更');
      }
      if (body.name?.trim()) provider.name = String(body.name).trim();
      if (body.note != null) provider.note = String(body.note).trim() || undefined;
      if (body.protocol) provider.protocol = body.protocol;
      if (body.tier) provider.tier = body.tier;
      if (body.baseUrl != null) provider.baseUrl = String(body.baseUrl).trim() || undefined;
      if (body.apiVersion != null) provider.apiVersion = String(body.apiVersion).trim() || undefined;
      if (body.organizationId != null) provider.organizationId = String(body.organizationId).trim() || undefined;
      if (body.deploymentName != null) provider.deploymentName = String(body.deploymentName).trim() || undefined;
      if (body.region) {
        provider.cloudRegion = String(body.region);
        provider.dataResidency = String(body.region).startsWith('cn-') || String(body.region) === 'cn' ? 'cn' : 'global';
        provider.models.forEach((model) => {
          model.cloudRegion = provider.cloudRegion;
          model.dataResidency = provider.dataResidency;
        });
      }
      if (body.model?.trim() && provider.models[0]) {
        provider.models[0].name = String(body.model).trim();
        provider.models[0].cloudRegion = provider.cloudRegion;
        provider.models[0].dataResidency = provider.dataResidency;
      }
      if (body.credential?.trim()) {
        provider.credentialMasked = '••••••••';
        provider.credentialRef = `vault://model-providers/${provider.id}/credential`;
        provider.status = provider.status === 'active' ? 'standby' : provider.status;
      }
      appendModelAudit(opts, '更新供应商资料', provider.name, 'success', { reason: body.reason });
      return provider;
    }
    if (method === 'POST' && action === 'disable') {
      provider.status = 'disabled';
      provider.models.forEach((model) => { model.status = 'unavailable'; });
      appendModelAudit(opts, '停用供应商', provider.name, 'success', { reason: body.reason });
      return provider;
    }
    if (method === 'DELETE' && !action) {
      const impact = providerImpact(provider.id);
      if (!impact.deletionAllowed) {
        appendModelAudit(opts, '删除供应商', provider.name, 'failed', { reason: impact.blockedReason });
        throw new Error(`E_PROVIDER_IN_USE: ${impact.blockedReason}`);
      }
      modelProviders.splice(modelProviders.indexOf(provider), 1);
      provider.models.forEach((model) => modelProfiles.splice(modelProfiles.indexOf(model), 1));
      appendModelAudit(opts, '删除供应商', provider.name, 'success', { reason: body.reason });
      return { id: provider.id, status: 'deleted' };
    }
  }
  if (path === '/api/model-routing/policies' && method === 'GET') { const context = requireModelRead(opts); return routingPolicies.filter((policy) => policy.workspaceId === context.workspaceId).map((policy) => ({ ...policy, fallbackModelIds: [...policy.fallbackModelIds], validationIssues: [...policy.validationIssues] })); }
  if (path === '/api/model-routing/policies' && method === 'POST') {
    const body = (opts.body ?? {}) as Partial<RoutingPolicyDraft>;
    const context = requireModelWrite(opts, body.workspaceId ?? 'w1');
    const policy: RoutingPolicyDraft = { id: mockId('route'), workspaceId: context.workspaceId, level: body.level ?? 'P3', primaryModelId: body.primaryModelId ?? '', fallbackModelIds: body.fallbackModelIds ?? [], dataScope: body.dataScope ?? 'internal', egressAllowed: Boolean(body.egressAllowed), budgetLimitUsd: body.budgetLimitUsd ?? 0, status: 'draft', validationIssues: [] };
    routingPolicies.unshift(policy);
    appendModelAudit(opts, '创建路由草稿', policy.level, 'success');
    return policy;
  }
  const policyAction = path.match(/^\/api\/model-routing\/policies\/([^/]+)(?:\/(draft|validate|publish|unpublish|versions|rollback))?$/);
  if (policyAction) {
    const [, policyId, action] = policyAction;
    const policy = routingPolicies.find((item) => item.id === policyId);
    if (!policy) throw new Error('E_POLICY_NOT_FOUND: 路由策略不存在');
    if (method === 'GET' && action === 'versions') { const context = requireModelRead(opts); if (policy.workspaceId !== context.workspaceId) throw new Error('E_WORKSPACE_SCOPE: 无权读取其他工作区路由版本'); return routingVersions.filter((version) => version.policyId === policy.id).map((version) => ({ ...version, snapshot: { ...version.snapshot, fallbackModelIds: [...version.snapshot.fallbackModelIds] } })); }
    const body = (opts.body ?? {}) as any;
    requireModelWrite(opts, policy.workspaceId);
    if (method === 'PATCH' && action === 'draft') {
      Object.assign(policy, { ...body, id: policy.id, workspaceId: policy.workspaceId, status: 'draft', validationIssues: [] });
      appendModelAudit(opts, '更新路由草稿', policy.level, 'success', { reason: body.reason });
      return policy;
    }
    if (method === 'POST' && action === 'validate') {
      policy.validationIssues = validateRoutingPolicy(policy);
      policy.status = policy.validationIssues.length ? 'draft' : 'ready';
      const result = policy.validationIssues.length ? 'failed' : 'success';
      appendModelAudit(opts, '校验路由草稿', policy.level, result, { reason: policy.validationIssues.join('；') || body.reason });
      return policy;
    }
    if (method === 'POST' && action === 'publish') {
      if (policy.status !== 'ready') {
        appendModelAudit(opts, '发布路由版本', policy.level, 'failed', { reason: '草稿尚未通过校验' });
        throw new Error('E_POLICY_NOT_READY: 草稿尚未通过校验，无法发布');
      }
      const version: RoutingPolicyVersion = { id: mockId('route_version'), policyId: policy.id, version: Math.max(0, ...routingVersions.filter((item) => item.policyId === policy.id).map((item) => item.version)) + 1, snapshot: { ...policy, fallbackModelIds: [...policy.fallbackModelIds], validationIssues: [] }, publishedAt: new Date().toISOString(), publishedBy: modelContext(opts).actor };
      routingVersions.unshift(version);
      policy.status = 'published';
      appendModelAudit(opts, '发布路由版本', policy.level, 'success', { reason: body.reason, policyVersion: version.id });
      return version;
    }
    if (method === 'POST' && action === 'unpublish') {
      if (policy.status !== 'published') {
        appendModelAudit(opts, '取消发布路由', policy.level, 'failed', { reason: '仅已发布路由可取消发布' });
        throw new Error('E_POLICY_NOT_PUBLISHED: 仅已发布路由可取消发布');
      }
      policy.status = 'draft';
      policy.validationIssues = [];
      appendModelAudit(opts, '取消发布路由', policy.level, 'success', { reason: body.reason });
      return { ...policy, fallbackModelIds: [...policy.fallbackModelIds], validationIssues: [...policy.validationIssues] };
    }
    if (method === 'POST' && action === 'rollback') {
      const target = routingVersions.find((version) => version.id === body.versionId && version.policyId === policy.id);
      if (!target) throw new Error('E_VERSION_NOT_FOUND: 路由版本不存在');
      const rollbackSnapshot: RoutingPolicyDraft = { ...target.snapshot, status: 'ready', fallbackModelIds: [...target.snapshot.fallbackModelIds], validationIssues: [] };
      const rollbackIssues = validateRoutingPolicy(rollbackSnapshot);
      if (rollbackIssues.length) {
        appendModelAudit(opts, '回滚路由版本', policy.level, 'failed', { reason: rollbackIssues.join('；'), policyVersion: target.id });
        throw new Error(`E_ROLLBACK_INVALID: ${rollbackIssues.join('；')}`);
      }
      const version: RoutingPolicyVersion = { id: mockId('route_version'), policyId: policy.id, version: Math.max(...routingVersions.filter((item) => item.policyId === policy.id).map((item) => item.version)) + 1, snapshot: { ...target.snapshot, status: 'published', fallbackModelIds: [...target.snapshot.fallbackModelIds], validationIssues: [] }, publishedAt: new Date().toISOString(), publishedBy: modelContext(opts).actor, rollbackOf: target.id };
      routingVersions.unshift(version);
      Object.assign(policy, version.snapshot);
      appendModelAudit(opts, '回滚路由版本', policy.level, 'success', { reason: body.reason, policyVersion: version.id });
      return version;
    }
  }
  if (path === '/api/model-routing/failover-tests' && method === 'POST') {
    const body = (opts.body ?? {}) as any;
    const policy = routingPolicies.find((item) => item.id === body.policyId);
    if (!policy) throw new Error('E_POLICY_NOT_FOUND: 路由策略不存在');
    requireModelWrite(opts, policy.workspaceId);
    if (!['sandbox', 'canary'].includes(body.scope)) throw new Error('E_DRILL_SCOPE_INVALID: 演练仅允许在 sandbox 或 canary 隔离范围执行');
    if (policy.status !== 'published') {
      appendModelAudit(opts, '执行隔离故障切换演练', policy.level, 'failed', { reason: '仅已发布路由可执行演练' });
      throw new Error('E_POLICY_NOT_PUBLISHED: 仅已发布路由可执行演练');
    }
    const drillIssues = validateRoutingPolicy(policy);
    if (drillIssues.length) {
      appendModelAudit(opts, '执行隔离故障切换演练', policy.level, 'failed', { reason: drillIssues.join('；') });
      throw new Error(`E_DRILL_INVALID: ${drillIssues.join('；')}`);
    }
    const fallback = policy.fallbackModelIds[0];
    if (!fallback) throw new Error('E_FALLBACK_INVALID: 当前策略没有可用降级链');
    const correlationId = mockId('drill');
    appendModelAudit(opts, '执行隔离故障切换演练', policy.level, 'success', { reason: body.reason, correlationId });
    return { id: mockId('failover'), policyId: policy.id, scope: body.scope, status: 'passed', fromModelId: policy.primaryModelId, toModelId: fallback, correlationId };
  }
  if (path === '/api/model-governance/overview' && method === 'GET') {
    const context = requireModelRead(opts);
    const providers = modelProviders.filter((provider) => provider.workspaceId === context.workspaceId);
    const policies = routingPolicies.filter((policy) => policy.workspaceId === context.workspaceId);
    const regionMap = new Map<string, number>();
    providers.forEach((provider) => regionMap.set(provider.cloudRegion, (regionMap.get(provider.cloudRegion) ?? 0) + 1));
    const publishedBudgetUsd = policies
      .filter((policy) => policy.status === 'published')
      .reduce((sum, policy) => sum + (policy.budgetLimitUsd || 0), 0);
    const draftBudgetUsd = policies
      .filter((policy) => policy.status === 'draft' || policy.status === 'ready')
      .reduce((sum, policy) => sum + (policy.budgetLimitUsd || 0), 0);
    const monthlyBudgetUsd = publishedBudgetUsd;
    const monthlySpendUsd = Math.round(monthlyBudgetUsd * 0.42);
    const budgetRisk = monthlyBudgetUsd <= 0 ? 'attention' : monthlySpendUsd / monthlyBudgetUsd > 0.85 ? 'critical' : monthlySpendUsd / monthlyBudgetUsd > 0.65 ? 'attention' : 'normal';
    const activeProviders = providers.filter((provider) => provider.status === 'active').length;
    return {
      activeProviders,
      standbyProviders: providers.filter((provider) => provider.status === 'standby').length,
      disabledProviders: providers.filter((provider) => provider.status === 'disabled').length,
      publishedRoutes: policies.filter((policy) => policy.status === 'published').length,
      draftRoutes: policies.filter((policy) => policy.status === 'draft' || policy.status === 'ready').length,
      budgetRisk,
      monthlyBudgetUsd,
      draftBudgetUsd,
      monthlySpendUsd,
      healthyShare: providers.length ? Math.round((activeProviders / providers.length) * 100) : 0,
      avgLatencyMs: 420,
      regionDistribution: Array.from(regionMap.entries()).map(([region, count]) => ({ region, count })),
      updatedAt: new Date().toISOString(),
    };
  }
  if (path === '/api/model-audit' && method === 'GET') {
    const context = requireModelRead(opts);
    const action = opts.query?.action ? String(opts.query.action) : '';
    return modelAuditEvents
      .filter((event) => event.workspaceId === context.workspaceId)
      .filter((event) => !action || action === 'all' || event.action.includes(action))
      .map((event) => ({ ...event }));
  }

  // 模型 Provider 与路由策略（历史 P9 API，仅兼容旧调用；新页面请使用 /api/model-*）
  if (path === '/api/providers' && method === 'GET') return mockProviders;
  if (path === '/api/providers' && method === 'POST') {
    const body = (opts.body ?? {}) as Partial<Provider> & { model?: string };
    if (!body.name?.trim() || !(body.model ?? body.models?.[0])?.trim()) throw new Error('Provider 名称和模型不能为空');
    const provider: Provider = { id: mockId('provider'), name: body.name.trim(), tier: body.tier ?? 'connectable', models: body.models ?? [body.model!.trim()], region: body.region ?? 'global', status: 'standby', monthlyTokens: 0, monthlyCostUsd: 0 };
    mockProviders.unshift(provider); appendControlPlaneAudit('model', '接入 Provider', provider.name); return provider;
  }
  const providerAction = path.match(/^\/api\/providers\/([^/]+)$/);
  if (providerAction && method === 'DELETE') { const index = mockProviders.findIndex((item) => item.id === providerAction[1]); if (index < 0) throw new Error('Provider 不存在'); const [removed] = mockProviders.splice(index, 1); appendControlPlaneAudit('model', '移除 Provider', removed.name); return removed; }
  if (path === '/api/provider-health') return mockProviderHealth;
  if (path === '/api/prompt-templates' && method === 'GET') return mockPromptTemplates;
  if (path === '/api/prompt-templates' && method === 'POST') { const body = (opts.body ?? {}) as any; if (!body.name?.trim() || !body.preview?.trim()) throw new Error('模板名称和内容不能为空'); const template = { id: mockId('prompt'), name: body.name.trim(), category: body.category ?? 'ops', preview: body.preview.trim(), uses: 0, rating: 0 }; mockPromptTemplates.unshift(template); appendControlPlaneAudit('model', '创建提示词模板', template.name); return template; }
  if (path === '/api/route-flow') return mockRouteFlow;
  if (path === '/api/export-routes') return mockExportRoutes;
  if (path === '/api/model-compare') return mockModelCompare;
  if (path === '/api/routes' && method === 'GET') return mockRoutes;
  if (path === '/api/routes' && method === 'PATCH') { const body = (opts.body ?? {}) as Partial<ModelRoute>; const route = mockRoutes.find((item) => item.level === body.level); if (!route) throw new Error('路由策略不存在'); Object.assign(route, body); appendControlPlaneAudit('model', '更新模型路由', route.level); return route; }
  if (path === '/api/model-failover-test' && method === 'POST') { const route = mockRoutes.find((item) => item.fallback1 && item.fallback1 !== '—') ?? mockRoutes[0]; appendControlPlaneAudit('model', '执行故障切换演练', route.level); return { level: route.level, from: route.primary, to: route.fallback1, reason: '模拟主 Provider 503 故障' }; }

  // 渠道控制面 P0/P1/P2
  if (path === '/api/channel-control/deployments' && method === 'GET') { const context = requireChannel(opts, 'channel.read'); return channelDeployments.filter((item) => item.workspaceId === context.workspaceId).map((item) => ({ ...item })); }
  if (path === '/api/channel-control/deployments' && method === 'POST') {
    const body = (opts.body ?? {}) as any; const context = requireChannel(opts, 'channel.write', body.workspaceId ?? 'w1');
    const kind = String(body.kind ?? '');
    const isFeishu = kind === 'feishu' || kind === 'lark';
    const isDingtalk = kind === 'dingtalk';
    const isWecom = kind === 'wecom';
    const isWeixin = kind === 'weixin' || kind === 'wechat';
    let appId = String(body.appId ?? body.app_id ?? '').trim();
    let appSecret = String(body.appSecret ?? body.app_secret ?? body.credential ?? '').trim();
    if (!body.name?.trim() || !kind) throw new Error('E_CHANNEL_DEPLOYMENT_INVALID: 名称和类型不能为空');
    if (kind === 'email' || kind === 'sms' || kind === 'phone') {
      throw new Error('E_CHANNEL_DEPLOYMENT_INVALID: 不支持邮件、短信、电话渠道');
    }
    if (isFeishu) {
      if (!appId && appSecret.includes(':')) {
        const i = appSecret.indexOf(':');
        appId = appSecret.slice(0, i);
        appSecret = appSecret.slice(i + 1);
      }
      if (!appId && appSecret) appId = 'cli_legacy';
      if (!appId || !appSecret) throw new Error('E_CHANNEL_DEPLOYMENT_INVALID: 飞书接入需要 appId 与 appSecret');
    } else if (isDingtalk) {
      const clientId = String(body.clientId ?? body.client_id ?? body.appId ?? '').trim();
      const clientSecret = String(body.clientSecret ?? body.client_secret ?? body.credential ?? '').trim();
      if (!clientId || !clientSecret) throw new Error('E_CHANNEL_DEPLOYMENT_INVALID: 钉钉接入需要 clientId 与 clientSecret');
    } else if (isWecom) {
      const mode = body.connectionMode === 'websocket' || body.mode === 'websocket' ? 'websocket' : 'webhook';
      if (mode === 'websocket') {
        if (!String(body.botId ?? body.bot_id ?? '').trim() || !String(body.botSecret ?? body.bot_secret ?? '').trim()) {
          throw new Error('E_CHANNEL_DEPLOYMENT_INVALID: 企微 websocket 需要 botId 与 botSecret');
        }
      } else if (!String(body.corpId ?? body.corp_id ?? '').trim() || !String(body.corpSecret ?? body.corp_secret ?? body.credential ?? '').trim() || !String(body.agentId ?? body.agent_id ?? '').trim()) {
        throw new Error('E_CHANNEL_DEPLOYMENT_INVALID: 企微自建应用需要 corpId/corpSecret/agentId');
      }
    } else if (isWeixin) {
      if (!String(body.token ?? body.credential ?? '').trim()) throw new Error('E_CHANNEL_DEPLOYMENT_INVALID: 个人微信需要 token');
    } else if (!String(body.credential ?? '').trim()) {
      throw new Error('E_CHANNEL_DEPLOYMENT_INVALID: 名称、类型和凭据不能为空');
    }
    const id = mockId('channel_deployment');
    const masked = isFeishu ? `••••${(appId || 'xxxx').slice(-4)}`
      : isDingtalk ? `••••${String(body.clientId ?? body.client_id ?? 'xxxx').slice(-4)}`
        : isWecom ? `••••${String(body.corpId ?? body.botId ?? 'xxxx').slice(-4)}`
          : isWeixin ? `••••${String(body.token ?? 'xxxx').slice(-4)}`
            : '••••••••';
    const feishuMode = (body.connectionMode === 'websocket' || body.connectionMode === 'long_connection' || body.connectionMode === 'ws')
      ? 'websocket' : (isFeishu ? 'webhook' : undefined);
    const webhookPath = (isFeishu && feishuMode === 'webhook') ? `/api/channel/feishu/events/${id}`
      : (isWecom && body.connectionMode !== 'websocket') ? `/api/channel/wecom/events/${id}`
        : (isDingtalk && body.connectionMode === 'webhook') ? `/api/channel/dingtalk/events/${id}`
          : undefined;
    const mode = isFeishu
      ? feishuMode
      : isDingtalk
        ? (body.connectionMode === 'webhook' ? 'webhook' : 'stream')
        : isWecom
          ? (body.connectionMode === 'websocket' || body.mode === 'websocket' ? 'websocket' : 'webhook')
          : isWeixin ? 'long_poll' : undefined;
    const deployment: ChannelDeployment = {
      id, workspaceId: context.workspaceId, name: body.name.trim(), kind: kind as ChannelKind,
      environment: body.environment ?? 'sandbox', status: 'draft',
      credentialRef: `vault://channel-deployments/${id}/credential`, credentialMasked: masked,
      owner: body.owner?.trim() || context.actor,
      ...(isFeishu ? {
        domain: String(body.domain || 'https://open.feishu.cn').trim(),
        appIdMasked: masked, connectionMode: mode as ChannelDeployment['connectionMode'],
        ...(webhookPath ? { webhookPath } : {}),
        hasEncryptKey: feishuMode === 'webhook' && Boolean(String(body.encryptKey ?? body.encrypt_key ?? '').trim()),
        hasVerificationToken: feishuMode === 'webhook' && Boolean(String(body.verificationToken ?? body.verification_token ?? '').trim()),
      } : {}),
      ...(isDingtalk ? {
        domain: String(body.domain || 'https://api.dingtalk.com').trim(),
        clientIdMasked: masked, robotCode: String(body.robotCode ?? body.robot_code ?? body.clientId ?? '').trim() || undefined,
        connectionMode: mode as ChannelDeployment['connectionMode'], webhookPath,
      } : {}),
      ...(isWecom ? {
        domain: String(body.apiBaseUrl ?? body.api_base_url ?? 'https://qyapi.weixin.qq.com').trim(),
        corpIdMasked: masked, agentId: String(body.agentId ?? body.agent_id ?? '').trim() || undefined,
        connectionMode: mode as ChannelDeployment['connectionMode'], webhookPath,
        hasCallbackToken: Boolean(String(body.callbackToken ?? '').trim()),
        hasCallbackAesKey: Boolean(String(body.callbackAesKey ?? '').trim()),
      } : {}),
      ...(isWeixin ? {
        domain: String(body.baseUrl ?? body.base_url ?? 'https://ilinkai.weixin.qq.com').trim(),
        tokenMasked: masked, accountId: String(body.accountId ?? '').trim() || undefined,
        connectionMode: 'long_poll',
      } : {}),
    };
    channelDeployments.unshift(deployment); appendChannelAudit(opts, '接入渠道部署', deployment.name, 'success', { reason: body.reason }); return deployment;
  }
  if (path === '/api/channel-control/inbound' && method === 'GET') {
    const context = requireChannel(opts, 'channel.read');
    return channelInbound.filter((item) => item.workspaceId === context.workspaceId);
  }
  const deploymentAction = path.match(/^\/api\/channel-control\/deployments\/([^/]+)(?:\/(verify|disable|impact))?$/);
  if (deploymentAction) {
    const [, id, action] = deploymentAction; const deployment = channelDeployments.find((item) => item.id === id); if (!deployment) throw new Error('E_CHANNEL_DEPLOYMENT_NOT_FOUND: 渠道部署不存在');
    if (method === 'GET' && action === 'impact') { requireChannel(opts, 'channel.read', deployment.workspaceId); const references = deliveryVersions.filter((version) => [version.snapshot.primaryDeploymentId, ...version.snapshot.fallbackDeploymentIds].includes(id)); return { deploymentId: id, deletionAllowed: references.length === 0, references: references.map((item) => item.id) }; }
    requireChannel(opts, 'channel.write', deployment.workspaceId); const body = (opts.body ?? {}) as any;
    if (method === 'POST' && action === 'verify') { deployment.lastVerifiedAt = new Date().toISOString(); deployment.status = 'active'; appendChannelAudit(opts, '验证渠道连通性', deployment.name, 'success', { reason: body.reason }); return deployment; }
    if (method === 'POST' && action === 'disable') { deployment.status = 'disabled'; appendChannelAudit(opts, '停用渠道部署', deployment.name, 'success', { reason: body.reason }); return deployment; }
    if (method === 'PATCH' && !action) {
      if (typeof body.name === 'string' && body.name.trim()) deployment.name = body.name.trim();
      if (body.environment === 'production' || body.environment === 'sandbox') deployment.environment = body.environment;
      if (typeof body.owner === 'string' && body.owner.trim()) deployment.owner = body.owner.trim();
      if (body.status === 'active' || body.status === 'disabled' || body.status === 'draft' || body.status === 'offline') deployment.status = body.status;
      if (typeof body.domain === 'string' && body.domain.trim()) deployment.domain = body.domain.trim();
      const nextMode = typeof body.connectionMode === 'string' ? String(body.connectionMode) : undefined;
      if (nextMode) {
        const normalized = (nextMode === 'ws' || nextMode === 'long_connection') ? 'websocket' : nextMode;
        deployment.connectionMode = normalized as ChannelDeployment['connectionMode'];
      }
      const kind = deployment.kind;
      const mode = deployment.connectionMode;
      if (kind === 'feishu') {
        if (typeof body.appId === 'string' && body.appId.trim()) deployment.appIdMasked = `••••${body.appId.trim().slice(-4)}`;
        if (typeof body.appSecret === 'string' && body.appSecret.trim()) deployment.credentialMasked = deployment.appIdMasked ?? deployment.credentialMasked;
        if (mode === 'webhook') {
          deployment.webhookPath = `/api/channel/feishu/events/${id}`;
          if (body.encryptKey !== undefined) deployment.hasEncryptKey = Boolean(String(body.encryptKey).trim());
          if (body.verificationToken !== undefined) deployment.hasVerificationToken = Boolean(String(body.verificationToken).trim());
        } else {
          delete deployment.webhookPath;
          delete deployment.webhookUrl;
          delete deployment.hasEncryptKey;
          delete deployment.hasVerificationToken;
        }
      } else if (kind === 'dingtalk') {
        if (typeof body.clientId === 'string' && body.clientId.trim()) {
          deployment.clientIdMasked = `••••${body.clientId.trim().slice(-4)}`;
          deployment.credentialMasked = deployment.clientIdMasked;
        }
        if (typeof body.robotCode === 'string') deployment.robotCode = body.robotCode.trim() || undefined;
        if (mode === 'webhook') deployment.webhookPath = `/api/channel/dingtalk/events/${id}`;
        else { delete deployment.webhookPath; delete deployment.webhookUrl; }
      } else if (kind === 'wecom') {
        if (mode === 'websocket') {
          if (typeof body.botId === 'string' && body.botId.trim()) {
            deployment.corpIdMasked = `••••${body.botId.trim().slice(-4)}`;
            deployment.credentialMasked = deployment.corpIdMasked;
          }
          delete deployment.webhookPath; delete deployment.webhookUrl;
        } else {
          if (typeof body.corpId === 'string' && body.corpId.trim()) {
            deployment.corpIdMasked = `••••${body.corpId.trim().slice(-4)}`;
            deployment.credentialMasked = deployment.corpIdMasked;
          }
          if (typeof body.agentId === 'string') deployment.agentId = body.agentId.trim() || undefined;
          deployment.webhookPath = `/api/channel/wecom/events/${id}`;
        }
      } else if (kind === 'weixin') {
        if (typeof body.token === 'string' && body.token.trim()) {
          deployment.tokenMasked = `••••${body.token.trim().slice(-4)}`;
          deployment.credentialMasked = deployment.tokenMasked;
        }
        if (typeof body.accountId === 'string') deployment.accountId = body.accountId.trim() || undefined;
      }
      appendChannelAudit(opts, '更新渠道部署', deployment.name, 'success', { reason: body.reason });
      return { ...deployment };
    }
    if (method === 'DELETE' && !action) { const referenced = deliveryVersions.some((version) => [version.snapshot.primaryDeploymentId, ...version.snapshot.fallbackDeploymentIds].includes(id)); if (referenced) { appendChannelAudit(opts, '删除渠道部署', deployment.name, 'failed', { reason: '渠道被已发布投递策略引用' }); throw new Error('E_CHANNEL_IN_USE: 渠道被已发布投递策略引用'); } channelDeployments.splice(channelDeployments.indexOf(deployment), 1); appendChannelAudit(opts, '删除渠道部署', deployment.name, 'success', { reason: body.reason }); return { id, status: 'deleted' }; }
  }
  if (path === '/api/channel-control/policies' && method === 'GET') { const context = requireChannel(opts, 'channel.read'); return deliveryPolicies.filter((item) => item.workspaceId === context.workspaceId).map((item) => ({ ...item, fallbackDeploymentIds: [...item.fallbackDeploymentIds], validationIssues: [...item.validationIssues] })); }
  const deliveryPolicyAction = path.match(/^\/api\/channel-control\/policies\/([^/]+)\/(draft|validate|publish|versions|rollback|simulate)$/);
  if (deliveryPolicyAction) {
    const [, id, action] = deliveryPolicyAction; const policy = deliveryPolicies.find((item) => item.id === id); if (!policy) throw new Error('E_DELIVERY_POLICY_NOT_FOUND: 投递策略不存在');
    if (method === 'GET' && action === 'versions') { requireChannel(opts, 'channel.read', policy.workspaceId); return deliveryVersions.filter((version) => version.policyId === id); }
    requireChannel(opts, 'channel.write', policy.workspaceId); const body = (opts.body ?? {}) as any;
    if (method === 'PATCH' && action === 'draft') { Object.assign(policy, { ...body, id: policy.id, workspaceId: policy.workspaceId, status: 'draft', validationIssues: [] }); appendChannelAudit(opts, '更新投递策略草稿', policy.eventType, 'success', { reason: body.reason }); return policy; }
    if (method === 'POST' && action === 'validate') { policy.validationIssues = validateDeliveryPolicy(policy); policy.status = policy.validationIssues.length ? 'draft' : 'ready'; appendChannelAudit(opts, '校验投递策略', policy.eventType, policy.validationIssues.length ? 'failed' : 'success', { reason: policy.validationIssues.join('；') || body.reason }); return policy; }
    if (method === 'POST' && action === 'publish') { if (policy.status !== 'ready') throw new Error('E_DELIVERY_POLICY_NOT_READY: 策略尚未通过校验'); const version: DeliveryPolicyVersion = { id: mockId('delivery_version'), policyId: policy.id, version: Math.max(0, ...deliveryVersions.filter((item) => item.policyId === id).map((item) => item.version)) + 1, snapshot: { ...policy, status: 'published', fallbackDeploymentIds: [...policy.fallbackDeploymentIds], validationIssues: [] }, publishedAt: new Date().toISOString(), publishedBy: channelContext(opts).actor }; deliveryVersions.unshift(version); policy.status = 'published'; appendChannelAudit(opts, '发布投递策略', policy.eventType, 'success', { reason: body.reason, policyVersion: version.id }); return version; }
    if (method === 'POST' && action === 'rollback') { const target = deliveryVersions.find((version) => version.id === body.versionId && version.policyId === id); if (!target) throw new Error('E_DELIVERY_VERSION_NOT_FOUND: 策略版本不存在'); const issues = validateDeliveryPolicy(target.snapshot); if (issues.length) throw new Error(`E_DELIVERY_ROLLBACK_INVALID: ${issues.join('；')}`); const version: DeliveryPolicyVersion = { id: mockId('delivery_version'), policyId: id, version: Math.max(...deliveryVersions.filter((item) => item.policyId === id).map((item) => item.version)) + 1, snapshot: { ...target.snapshot, status: 'published', fallbackDeploymentIds: [...target.snapshot.fallbackDeploymentIds] }, publishedAt: new Date().toISOString(), publishedBy: channelContext(opts).actor, rollbackOf: target.id }; deliveryVersions.unshift(version); Object.assign(policy, version.snapshot); appendChannelAudit(opts, '回滚投递策略', policy.eventType, 'success', { policyVersion: version.id, reason: body.reason }); return version; }
    if (method === 'POST' && action === 'simulate') { const issues = validateDeliveryPolicy(policy); return { policyId: id, scope: body.scope === 'canary' ? 'canary' : 'sandbox', status: issues.length ? 'blocked' : 'passed', issues, capacityRisk: policy.fallbackDeploymentIds.length ? 'normal' : 'attention' }; }
  }
  if (path === '/api/channel-control/deliveries' && method === 'POST') { const body = (opts.body ?? {}) as any; const policy = deliveryPolicies.find((item) => item.id === body.policyId); if (!policy) throw new Error('E_DELIVERY_POLICY_NOT_FOUND: 投递策略不存在'); requireChannel(opts, 'channel.write', policy.workspaceId); if (policy.status !== 'published') throw new Error('E_DELIVERY_POLICY_NOT_PUBLISHED: 仅已发布策略可以投递'); const failed = String(body.target ?? '').includes('fail'); const attempt: DeliveryAttempt = { id: mockId('delivery_attempt'), workspaceId: policy.workspaceId, policyId: policy.id, deploymentId: policy.primaryDeploymentId, targetMasked: maskTarget(String(body.target ?? '')), payloadSummary: String(body.content ?? '').slice(0, 24).replace(/[\w@.-]/g, '*'), status: failed ? 'dead_letter' : 'delivered', attempts: failed ? 3 : 1, correlationId: mockId('delivery_corr'), createdAt: new Date().toISOString() }; deliveryAttempts.unshift(attempt); appendChannelAudit(opts, failed ? '投递进入死信队列' : '投递消息', policy.eventType, failed ? 'failed' : 'success', { correlationId: attempt.correlationId }); return attempt; }
  if (path === '/api/channel-control/dead-letters' && method === 'GET') { const context = requireChannel(opts, 'channel.read'); return deliveryAttempts.filter((item) => item.workspaceId === context.workspaceId && item.status === 'dead_letter'); }
  const deadLetterReplay = path.match(/^\/api\/channel-control\/dead-letters\/([^/]+)\/replay$/);
  if (deadLetterReplay && method === 'POST') {
    const context = requireChannel(opts, 'channel.write');
    const attempt = deliveryAttempts.find((item) => item.id === deadLetterReplay[1] && item.workspaceId === context.workspaceId);
    if (!attempt) throw new Error('E_DEAD_LETTER_NOT_FOUND: 死信不存在');
    if (attempt.status !== 'dead_letter') throw new Error('E_DEAD_LETTER_STATE: 仅死信可重投');
    attempt.status = 'delivered';
    attempt.attempts += 1;
    appendChannelAudit(opts, '重投死信', attempt.targetMasked, 'success', { correlationId: attempt.correlationId });
    return { ...attempt };
  }
  if (path === '/api/channel-control/health' && method === 'GET') {
    const context = requireChannel(opts, 'channel.read');
    const dead = new Set(deliveryAttempts.filter((item) => item.workspaceId === context.workspaceId && item.status === 'dead_letter').map((item) => item.deploymentId));
    return channelDeployments.filter((item) => item.workspaceId === context.workspaceId).map((item) => {
      const errorCount24h = deliveryAttempts.filter((a) => a.deploymentId === item.id && a.status === 'dead_letter').length;
      const status = item.status !== 'active' ? 'offline' as const : dead.has(item.id) || errorCount24h > 0 ? 'attention' as const : 'healthy' as const;
      return {
        deploymentId: item.id,
        name: item.name,
        kind: item.kind,
        environment: item.environment,
        deployStatus: item.status,
        successRate: item.status === 'active' ? (status === 'attention' ? 97.2 : 99.4) : 0,
        p95Ms: item.status === 'active' ? 140 : 0,
        errorCount24h,
        status,
      };
    });
  }
  if (path === '/api/channel-control/audit' && method === 'GET') { const context = requireChannel(opts, 'channel.read'); return channelAuditEvents.filter((item) => item.workspaceId === context.workspaceId); }
  if (path === '/api/channel-control/overview' && method === 'GET') { const context = requireChannel(opts, 'channel.read'); return { activeDeployments: channelDeployments.filter((item) => item.workspaceId === context.workspaceId && item.status === 'active').length, publishedPolicies: deliveryPolicies.filter((item) => item.workspaceId === context.workspaceId && item.status === 'published').length, deadLetters: deliveryAttempts.filter((item) => item.workspaceId === context.workspaceId && item.status === 'dead_letter').length, capacityRisk: 'normal' }; }

  // 渠道：投递、策略、模板和黑名单均由 Mock 域持有。
  if (path === '/api/channels' && method === 'GET') return mockChannels;
  if (path === '/api/channels' && method === 'POST') { const body = (opts.body ?? {}) as Partial<Channel> & { kind?: string }; if (!body.name?.trim() || !body.kind) throw new Error('渠道名称和类型不能为空'); if (['email', 'sms', 'phone'].includes(String(body.kind))) throw new Error('E_CHANNEL_DEPLOYMENT_INVALID: 不支持邮件、短信、电话渠道'); const channel: Channel = { id: mockId('channel'), name: body.name.trim(), kind: body.kind as ChannelKind, enabled: true, monthlySent: 0, successRate: 1 }; mockChannels.unshift(channel); appendControlPlaneAudit('channel', '接入渠道', channel.name); return channel; }
  const channelAction = path.match(/^\/api\/channels\/([^/]+)(?:\/(toggle|test|config))?$/);
  if (channelAction) { const channel = mockChannels.find((item) => item.id === channelAction[1]); if (!channel) throw new Error('渠道不存在'); const action = channelAction[2]; const body = (opts.body ?? {}) as any; if (action === 'toggle' && method === 'PATCH') { channel.enabled = !channel.enabled; appendControlPlaneAudit('channel', channel.enabled ? '恢复渠道投递' : '暂停渠道投递', channel.name); return channel; } if (action === 'test' && method === 'POST') { if (!channel.enabled) throw new Error('渠道已暂停，无法发送测试消息'); if (!body.target?.trim() || !body.content?.trim()) throw new Error('接收对象和消息内容不能为空'); const message = { id: mockId('message'), time: new Date().toLocaleTimeString('zh-CN'), channel: channel.name, target: body.target.trim(), content: body.content.trim(), status: 'delivered' as const, tone: 'success' as const }; mockDomain.messages.unshift(message); appendControlPlaneAudit('channel', '发送测试消息', channel.name); return message; } if (action === 'config' && method === 'PATCH') { mockChannelConfig[channel.id] = { ...(mockChannelConfig[channel.id] ?? {}), ...body }; appendControlPlaneAudit('channel', '更新渠道配置', channel.name); return mockChannelConfig[channel.id]; } }
  if (path === '/api/channel-health') return mockChannelHealth;
  if (path === '/api/message-stream') return mockDomain.messages;
  if (path === '/api/channel-config') return mockChannelConfig;
  if (path === '/api/channel-templates' && method === 'GET') return mockChannelTemplates;
  if (path === '/api/channel-templates' && method === 'POST') { const body = (opts.body ?? {}) as any; if (!body.name?.trim()) throw new Error('模板名称不能为空'); const item = { id: mockId('template'), ...body, name: body.name.trim() }; mockChannelTemplates.unshift(item); appendControlPlaneAudit('channel', '创建消息模板', item.name); return item; }
  if (path === '/api/channel-blacklist' && method === 'GET') return mockChannelBlacklist;
  if (path === '/api/channel-blacklist' && method === 'POST') { const body = (opts.body ?? {}) as any; if (!body.value?.trim()) throw new Error('黑名单对象不能为空'); const item = { id: mockId('blacklist'), type: body.type ?? '用户', value: body.value.trim(), reason: body.reason ?? '手动添加', addedBy: '当前用户', expires: '永久' }; mockChannelBlacklist.unshift(item); appendControlPlaneAudit('channel', '加入黑名单', item.value); return item; }
  if (path === '/api/channel-languages' && method === 'GET') return mockChannelLanguages;
  if (path === '/api/channel-languages' && method === 'POST') { const body = (opts.body ?? {}) as any; if (!body.key?.trim() || !body.label?.trim()) throw new Error('语言代码和名称不能为空'); const item = { key: body.key.trim(), label: body.label.trim(), sample: body.sample ?? '' }; mockChannelLanguages.push(item); appendControlPlaneAudit('channel', '新增多语言模板', item.key); return item; }
  if (path === '/api/channel-routes' && method === 'GET') return mockChannelRoutes;
  if (path === '/api/control-plane-audit' && method === 'GET') return mockControlPlaneAudit;

  // 设置
  if (path === '/api/api-keys') return mockApiKeys;
  if (path === '/api/webhooks-config') return mockWebhooks;
  if (path === '/api/tenant/profile' && method === 'GET') {
    return mockTenantProfile;
  }
  if (path === '/api/tenant/profile' && method === 'PATCH') {
    requireAdministrator('更新组织资料');
    const body = (opts.body ?? {}) as { name?: string; region?: string; status?: string };
    if (body.name?.trim()) mockTenantProfile.name = body.name.trim();
    if (body.region?.trim()) mockTenantProfile.region = body.region.trim();
    if (body.status?.trim()) mockTenantProfile.status = body.status.trim();
    mockTenantProfile.updatedAt = new Date().toISOString();
    appendControlPlaneAudit('tenant', '更新组织资料', mockTenantProfile.name);
    return { ...mockTenantProfile };
  }
  if (path === '/api/backups' && method === 'GET') return mockBackups;
  if (path === '/api/backups' && method === 'POST') {
    requireAdministrator('申请备份');
    const body = (opts.body ?? {}) as { scope?: string };
    const item = {
      id: mockId('bk'),
      time: new Date().toISOString().replace('T', ' ').slice(0, 16),
      type: '手动',
      size: '—',
      duration: '—',
      status: 'pending_approval',
      scope: body.scope ?? 'full',
    };
    mockBackups.unshift(item);
    appendControlPlaneAudit('backup', '申请备份', item.scope);
    return item;
  }
  if (path === '/api/audit-stream') return mockDomain.audits;
  if (path === '/api/billing') return mockBilling;
  if (path === '/api/notification-channels' && method === 'GET') return mockNotificationChannels;
  if (path.startsWith('/api/notification-channels/') && method === 'PATCH') {
    requireAdministrator('更新通知渠道');
    const id = path.split('/')[3];
    const ch = mockNotificationChannels.find((item) => item.id === id);
    if (!ch) throw new Error('通知渠道不存在');
    const body = (opts.body ?? {}) as { enabled?: boolean; name?: string };
    if (typeof body.enabled === 'boolean') ch.enabled = body.enabled;
    if (body.name?.trim()) ch.name = body.name.trim();
    appendControlPlaneAudit('settings', '更新通知渠道', id);
    return ch;
  }

  // 会话
  if (path.startsWith('/api/conversations/') && !path.slice('/api/conversations/'.length).includes('/') && (opts.method ?? 'GET') === 'GET') {
    const id = path.split('/')[3];
    if (id === mockConversation.id) {
      if (!inCurrentWorkspace(mockConversation)) throw new Error('E_WORKSPACE_SCOPE: 无权读取其他工作区会话');
      return mockConversation;
    }
    const session = mockSessions.find((item) => item.id === id);
    if (session) {
      if (!inCurrentWorkspace(session)) throw new Error('E_WORKSPACE_SCOPE: 无权读取其他工作区会话');
      return {
        id: session.id,
        workspaceId: session.workspaceId,
        ownerId: session.ownerId,
        correlationId: session.correlationId,
        digitalPartnerId: session.digitalPartnerId,
        title: session.title,
        preview: session.preview,
        status: session.status,
        updatedAt: session.updatedAt,
        messages: [],
      };
    }
    throw new Error('E_NOT_FOUND: 会话不存在');
  }
  if (path === `/api/conversations/${mockConversation.id}/ex`) return mockConversationEx;
  if (path === '/api/sessions' && (!opts.method || opts.method === 'GET')) return mockSessions.filter(inCurrentWorkspace);
  if (path === '/api/sessions' && opts.method === 'POST') {
    const body = (opts.body ?? {}) as {
      title?: string;
      digitalPartnerId?: string;
      digitalPartnerName?: string;
      modelId?: string;
    };
    const id = mockId('sess');
    const conversationId = mockId('conv');
    const now = new Date().toISOString();
    const name = body.digitalPartnerName ?? '岗位专家';
    const session = {
      id,
      workspaceId: currentWorkspaceId,
      ownerId: mockIdentity(opts.headers)?.id ?? 'u1',
      correlationId: mockId('corr_session'),
      title: body.title ?? '新会话',
      preview: '暂无消息',
      agent: name,
      digitalPartnerId: body.digitalPartnerId,
      digitalPartnerName: name,
      conversationId,
      status: 'active' as const,
      modelId: body.modelId ?? 'sonnet-4',
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
    };
    mockSessions.unshift(session as unknown as (typeof mockSessions)[number]);
    return session;
  }
  const sessionPatch = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionPatch && method === 'PATCH') {
    const sessionId = sessionPatch[1];
    const index = mockSessions.findIndex((item) => item.id === sessionId && item.workspaceId === currentWorkspaceId);
    if (index < 0) throw new Error('E_NOT_FOUND: 会话不存在');
    const body = (opts.body ?? {}) as Record<string, unknown>;
    const current = mockSessions[index] as unknown as Record<string, unknown>;
    const next = { ...current, ...body, updatedAt: new Date().toISOString() };
    mockSessions[index] = next as (typeof mockSessions)[number];
    return next;
  }
  const sessionDelete = path.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionDelete && method === 'DELETE') {
    const sessionId = sessionDelete[1];
    const index = mockSessions.findIndex((item) => item.id === sessionId && item.workspaceId === currentWorkspaceId);
    if (index < 0) throw new Error('E_NOT_FOUND: 会话不存在');
    const [removed] = mockSessions.splice(index, 1);
    return { ok: true, id: removed.id, conversationId: (removed as { conversationId?: string }).conversationId };
  }
  const replayTurn = path.match(/^\/api\/copilot\/conversations\/([^/]+)\/turns\/([^/]+)\/replay$/);
  if (replayTurn && method === 'GET') {
    const correlationId = decodeURIComponent(replayTurn[2]);
    return {
      replay: true,
      correlationId,
      snapshot: {
        id: `snap-mock-${correlationId}`,
        correlationId,
        system: '只读复盘（Mock）',
        historyTurns: 1,
        memoryProvenance: [],
        ragHits: 0,
        toolRegistry: [],
        builtAt: new Date().toISOString(),
        employeeId: 'de-1',
        sessionMode: 'investigate',
      },
      events: [
        { type: 'stage', stage: 'policy', correlationId, text: 'ok' },
        { type: 'done', stage: 'done', correlationId, snapshotId: `snap-mock-${correlationId}` },
      ],
    };
  }
  const conversationDelete = path.match(/^\/api\/conversations\/([^/]+)$/);
  if (conversationDelete && method === 'DELETE') {
    const conversationId = conversationDelete[1];
    // remove linked sessions
    for (let i = mockSessions.length - 1; i >= 0; i -= 1) {
      const item = mockSessions[i] as { id: string; workspaceId: string; conversationId?: string };
      if (item.workspaceId === currentWorkspaceId && (item.conversationId === conversationId || item.id === conversationId)) {
        mockSessions.splice(i, 1);
      }
    }
    return { ok: true, id: conversationId };
  }
  if (path === '/api/slash-commands') return mockSlashCommands;
  if (path.startsWith('/api/agents/') && path.endsWith('/meta')) return mockAgentMeta;

  // 会话工作台写接口：用于演示“会话 → 任务/审批/执行 → 审计/通知”的闭环。
  if (path.startsWith('/api/conversations/') && path.endsWith('/tasks') && opts.method === 'POST') {
    const conversationId = path.split('/')[3];
    const body = (opts.body ?? {}) as {
      title?: string;
      priority?: string;
      assignee?: string;
      agentId?: string;
      digitalPartnerId?: string;
      workflowId?: string;
      correlationId?: string;
    };
    const employeeId = body.digitalPartnerId ?? body.agentId ?? 'de-sre';
    const task = taskDomain.create({
      title: body.title ?? '协同会话待办事项',
      description: `由专家协同会话 ${conversationId} 转出，可回会话继续双重审批与能力调用。`,
      priority: (body.priority as Task['priority']) ?? 'P1',
      assignee: body.assignee ?? '王昊',
      digitalPartnerId: employeeId,
      agentId: body.agentId ?? employeeId,
      progress: { done: 0, total: 3 },
      tags: ['会话转任务'],
      source: 'conversation',
      workspaceId: currentWorkspaceId,
      ownerId: 'u1',
      environment: 'production',
      classification: 'internal',
      createdBy: 'u1',
      correlationId: body.correlationId ?? `corr_conversation_${conversationId}`,
      links: { conversationId, workflowId: body.workflowId },
    }, { actor: '数字伙伴' });
    appendTaskDomainEvent(task);
    return task;
  }
  if (path.startsWith('/api/actions/') && path.endsWith('/approve') && opts.method === 'POST') {
    const actionId = path.split('/')[3];
    const body = (opts.body ?? {}) as { signerIndex?: number; conversationId?: string };
    const identity = mockIdentity(opts.headers);
    if (!identity) throw new Error('E_AUTH_REQUIRED: 请先登录后再签发');
    if (!body.conversationId) throw new Error('E_APPROVAL_SCOPE: 缺少会话 ID');
    // 权威演示会话 s1 需在工作区；客户端新建会话 id 以 s_ 开头；其余视为伪造范围
    const scopedOk =
      body.conversationId === mockConversation.id
        ? inCurrentWorkspace(mockConversation)
        : /^s_/.test(body.conversationId);
    if (!scopedOk) throw new Error('E_APPROVAL_SCOPE: 当前会话不在您的工作区范围内');

    // 优先从会话消息的审批席位派生策略，避免与 UI signers 分叉
    const conversationMessage =
      body.conversationId === mockConversation.id
        ? mockConversation.messages.find((message) => message.id === actionId)
        : undefined;
    const messageSigners = conversationMessage?.approvalRequest?.signers;
    const approvalPolicy = (messageSigners?.length
      ? messageSigners.map((signer) => ({
          userId: signer.userId,
          role: (signer.role === 'approver' ? 'admin' : signer.role === 'auditor' ? 'auditor' : 'user') as Role,
          label: signer.name,
          roleLabel: signer.role === 'auditor' ? '审计复核' : signer.role === 'operator' ? '执行复核' : '变更审批',
          alreadySigned: signer.signed,
        }))
      : [
          { userId: 'u2', role: 'user' as const, label: '王昊', roleLabel: '执行复核', alreadySigned: true },
          { userId: 'u1', role: 'admin' as const, label: '平台管理员', roleLabel: '变更审批', alreadySigned: false },
        ]);

    const signerIndex = Number(body.signerIndex);
    const expectedSigner = Number.isInteger(signerIndex) ? approvalPolicy[signerIndex] : undefined;
    if (!expectedSigner) throw new Error('E_APPROVAL_SIGNER: 无效的审批席位');
    if (identity.id !== expectedSigner.userId || identity.role !== expectedSigner.role) {
      throw new Error(`E_APPROVAL_ASSIGNEE: 仅待签人 ${expectedSigner.label}（${expectedSigner.roleLabel}）可签发`);
    }

    const existing = mockDomain.actions.get(actionId);
    const seededIndexes = approvalPolicy
      .map((signer, index) => (signer.alreadySigned ? index : -1))
      .filter((index) => index >= 0);
    const action = existing ?? {
      id: actionId,
      conversationId: body.conversationId,
      status: 'pending' as const,
      // 无消息席位上下文时，沿用演示约定：执行复核已完成，待变更审批签发
      approvedSignerIndexes: seededIndexes.length ? seededIndexes : [0],
    };
    const approvedSignerIndexes = [...(action.approvedSignerIndexes ?? [])];
    if (approvedSignerIndexes.includes(signerIndex)) throw new Error('E_APPROVAL_DUPLICATE: 当前审批席位已签发');
    if (signerIndex > 0 && !approvedSignerIndexes.includes(signerIndex - 1)) {
      throw new Error('E_APPROVAL_SEQUENCE: 请等待上一审批席位完成签发');
    }
    if (approvedSignerIndexes.some((index) => approvalPolicy[index]?.userId === identity.id)) {
      throw new Error('E_APPROVAL_SOD: 同一用户不得完成多个审批席位');
    }

    const signedAt = new Date().toISOString();
    const signatureHash = `sig_${actionId.slice(-6)}_${identity.id}_${Date.now().toString(36)}`;
    const nextIndexes = [...approvedSignerIndexes, signerIndex];
    const completed = nextIndexes.length >= approvalPolicy.length;
    const next = {
      ...action,
      status: (completed ? 'approved' : 'pending') as 'pending' | 'approved' | 'executed' | 'rejected',
      approvedSignerIndexes: nextIndexes,
    };
    mockDomain.actions.set(actionId, next);
    appendDomainEvent(completed ? '双重审批通过' : '双重审批签发', `${actionId} · ${identity.name}`);

    // 写回权威演示会话，避免 syncSession 再次拉取时冲掉本地签署进度
    if (conversationMessage?.approvalRequest) {
      const request = conversationMessage.approvalRequest;
      const signers = request.signers.map((signer, index) =>
        index === signerIndex
          ? { ...signer, signed: true, signedAt, signatureHash }
          : signer,
      );
      const signed = signers.filter((signer) => signer.signed).length;
      conversationMessage.approvalRequest = {
        ...request,
        signers,
        signed,
        decision: signed >= request.required ? 'approved' : 'pending',
        decidedAt: signed >= request.required ? signedAt : request.decidedAt,
      };
      mockConversation.updatedAt = signedAt;
    }

    return { ...next, signedAt, signatureHash, completed };
  }
  if (path.startsWith('/api/actions/') && path.endsWith('/execute') && opts.method === 'POST') {
    const actionId = path.split('/')[3];
    const body = (opts.body ?? {}) as { taskId?: string };
    const action = { ...(mockDomain.actions.get(actionId) ?? { id: actionId, conversationId: 'cv1', status: 'approved' as const }), taskId: body.taskId ?? mockDomain.actions.get(actionId)?.taskId };
    const task = action.taskId ? taskDomain.get(action.taskId) : undefined;
    const completedTask = task ? taskDomain.transition(task.id, 'completed', { actor: '数字伙伴', reason: '会话行动执行完成' }) : undefined;
    if (completedTask) appendTaskDomainEvent(completedTask);
    const next = { ...action, status: 'executed' as const };
    mockDomain.actions.set(actionId, next);
    appendDomainEvent('受控执行完成', completedTask?.code ?? actionId);

    const conversationMessage = mockConversation.messages.find((message) => message.id === actionId);
    if (conversationMessage) {
      conversationMessage.linkedTaskId = completedTask?.id ?? action.taskId;
      if (conversationMessage.approvalRequest?.decision === 'approved') {
        conversationMessage.toolCalls = [
          ...(conversationMessage.toolCalls ?? []),
          {
            id: mockId('t'),
            name: conversationMessage.approvalRequest.action,
            args: { resource: conversationMessage.approvalRequest.resource },
            result: `OK · 任务 ${completedTask?.code ?? actionId} 已回链`,
            status: 'success',
            durationMs: 48,
          },
        ];
      }
      mockConversation.updatedAt = new Date().toISOString();
    }
    return { ...next, task: completedTask };
  }
  if (path === '/api/mock/reset' && opts.method === 'POST') {
    taskDomain.reset();
    scheduleDomain.reset();
    mockDomain.audits.splice(0, mockDomain.audits.length, ...mockAuditStream);
    mockDomain.messages.splice(0, mockDomain.messages.length, ...mockMessageStream);
    mockDomain.actions.clear();
    return { ok: true };
  }

  // 登录
  if (path === '/api/auth/login') {
    const body = opts.body as { email?: string; password?: string } | undefined;
    if (body?.email && body.password) {
      const normalizedEmail = body.email.toLowerCase();
      const role: Role = normalizedEmail.startsWith('admin@') ? 'admin' : normalizedEmail.startsWith('audit@') ? 'auditor' : 'user';
      const token = role === 'admin' ? 'mock-admin-token' : role === 'auditor' ? 'mock-auditor-token' : 'mock-user-token';
      const identityForLogin = mockIdentity({ Authorization: `Bearer ${token}` })!;
      return {
        token,
        user: {
          ...identityForLogin,
          email: body.email,
        },
      };
    }
    throw new Error('缺少凭据');
  }

  return null;
}
