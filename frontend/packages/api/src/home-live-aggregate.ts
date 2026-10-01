/**
 * Mock 运营总览 live-aggregate — 类型契约层。
 *
 * 仅声明 M01（运营总览）相关的 TS 类型，字段与 backend `internal/server/ops_aggregate.go` 的
 * live-aggregate 输出一一对应。运行时构建函数（buildHomeExtraLive / buildOpsOverviewLive）
 * 与别名映射（CAPABILITY_NAME_ALIASES / CHANNEL_NAME_ALIASES / normalize*）已迁移到
 * `./m01-builders.ts` —— 它们是 mock 层与 FE 共享的实现细节，必须留在 `packages/api`
 * 以便 mockHandler 调用并避免 web ↔ api 的循环依赖。
 *
 * 不要把本文件当作 FE mirror；FE 端通过 `@/features/operations-overview/types`
 * 或 `@qzda/web-api` 间接引用。
 */

export type AggregateTask = {
  id: string;
  code: string;
  title: string;
  status: string;
  priority?: string;
  assignee?: string;
  digitalPartnerName?: string;
  workspaceId?: string;
  updatedAt?: string;
  createdAt?: string;
  sla?: { risk?: string; remainingMin?: number };
  lifecycleStage?: string;
  governance?: { approvalStatus?: string };
};

export type AggregateEmployee = {
  id: string;
  workspaceId?: string;
  lifecycle: string;
  name?: string;
  role?: string;
  owner?: string;
  runtime?: { calls24h?: number };
};

export type AggregateSession = {
  id: string;
  workspaceId?: string;
  updatedAt?: string;
  createdAt?: string;
};

export type AggregateMember = { id: string; name: string; role: string; lastActive?: string };

export type UsageMeter = { workspaceId?: string; usd?: number; units?: number; budgetUsd?: number };

export type HomeExtraLive = {
  workspaceId: string;
  generatedAt: string;
  source: 'live-aggregate';
  healthTrend24h: number[];
  teamMembers: { id: string; name: string; role: string; online: boolean }[];
  recentActivities: {
    id: string;
    type: string;
    tone: 'success' | 'warning' | 'info' | 'danger';
    text: string;
    actor: string;
    resource: string;
    time: string;
    to?: string;
  }[];
  agentCallSummary: { total: number; healthy: number; warning: number; offline: number };
  notifications: {
    id: string;
    tone: 'info' | 'warn' | 'success' | 'error';
    icon: string;
    text: string;
    detail?: string;
    time: string;
    unread: boolean;
  }[];
  agent7dTrend: Record<string, number[]>;
  taskCompletion: { done: number; doing: number; review: number; todo: number };
  slaAlerts: {
    id: string;
    level: string;
    text: string;
    time: string;
    assignee: string;
    taskCode: string;
    workspaceId?: string;
    source: 'task';
    acknowledged?: boolean;
  }[];
  operationalMetrics: {
    taskSuccessRate: number | null;
    activeAgents: number;
    healthScore: number;
    apiP95: null;
    taskRate: number;
    collabToday: number;
    tokenUsage: { total: string; input: string; output: string };
    trend24h: { time: string; tasks: number; collab: number; alerts: number; health: number; taskRate: number; apiP95: null }[];
  };
  costMonth: { used: number; budget: number; daily: number[]; source: 'usage-meters' | 'none' };
  roleDistribution: { role: string; count: number }[];
  suggestion: { id: string; tone: 'success' | 'warn' | 'info'; text: string; action: string; to: string }[];
  quickLinks: { label: string; to: string; icon: string; desc?: string }[];
  kpiDetails: Record<string, never>;
};

/** @deprecated 兼容旧 `mockHomeExtra: HomeExtra`；运行时由 buildHomeExtraLive 聚合 */
export type HomeExtra = HomeExtraLive;

/** Re-export builders for callers that historically imported from `./home-live-aggregate`. */
export {
  buildHomeExtraLive,
  buildOpsOverviewLive,
  CAPABILITY_NAME_ALIASES,
  CHANNEL_NAME_ALIASES,
  normalizeCapabilityName,
  normalizeChannelName,
  normalizeEmployeeCapabilities,
} from './m01-builders';
