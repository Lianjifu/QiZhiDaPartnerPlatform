/**
 * M01 运营总览 mock 路由 — 从 `mock.ts` 拆出，集中所有 `/api/home/*` 与 `/api/operations/overview` 的
 * live-aggregate 实现。这些 handler 闭包访问的是 `mock.ts` 的私有表（mockDigitalPartners / mockTasks
 * 等），所以仍然留在 `packages/api` 内（不能下沉到 web 避免循环依赖）。
 *
 * `dispatchM01Handler` 接收 mock 层的 runtime context（数据表 + 闭包 helper），按顺序调用本文件的
 * handler 列表，返回首个非 undefined 值。
 */
import { buildHomeExtraLive, buildOpsOverviewLive } from './m01-builders';
import type { HomeExtraLive } from './home-live-aggregate';

export interface M01Identity {
  role?: 'user' | 'admin' | 'auditor';
  workspaceId?: string;
  workspaceIds?: string[];
  tenantId?: string;
  name?: string;
  id?: string;
  permissions?: string[];
}

export interface M01Context {
  /** 工作区过滤后的 live-aggregate（已叠加 homeAlertAcknowledgements） */
  homeExtraLiveFor: (workspaceId: string) => HomeExtraLive;
  /** mock 层身份解析 */
  mockIdentity: (headers?: Record<string, string>) => M01Identity | null;
  /** mock 层当前工作区上下文 */
  workspaceContext: () => { workspaceId: string; actor: string; canWrite: boolean };
  /** mock 层需要的私有表 */
  mockReleaseApprovals: Array<{ workspaceId?: string; status: string }>;
  deliveryAttempts: Array<{ workspaceId?: string; status: string }>;
  mockDigitalPartners: Array<{ workspaceId?: string; lifecycle: string; [k: string]: unknown }>;
  mockUsageMeters: Array<{ workspaceId?: string; usd?: number; budgetUsd?: number; units?: number }>;
  mockBackups: Array<{ workspaceId?: string; status: string; [k: string]: unknown }>;
  homeAlertAcknowledgements: Map<string, { acknowledgedAt: string; acknowledgedBy: string; acknowledgementNote: string }>;
  appendDomainEvent: (action: string, target: string, result?: 'success' | 'failed') => void;
  /** mock 任务域，用于 /api/operations/overview 聚合 */
  taskDomain: { list: () => Array<Record<string, unknown>> };
}

type Handler = (
  ctx: M01Context,
  path: string,
  method: string,
  identity: M01Identity | null,
  workspaceId: string,
  body: unknown,
) => unknown;

const handlers: Handler[] = [
  // GET /api/home/kpis
  (ctx, path, method, _identity, requestedWorkspaceId) => {
    if (path !== '/api/home/kpis' || method !== 'GET') return undefined;
    const extra = ctx.homeExtraLiveFor(requestedWorkspaceId);
    return {
      activeDigitalPartners: extra.operationalMetrics.activeAgents,
      openTasks: extra.taskCompletion.doing + extra.taskCompletion.review + extra.taskCompletion.todo,
      riskTasks: extra.slaAlerts.length,
      pendingApprovals: ctx.mockReleaseApprovals.filter((item: { workspaceId?: string; status: string }) => item.workspaceId === requestedWorkspaceId && item.status === 'pending').length,
      deadLetters: ctx.deliveryAttempts.filter((item: { workspaceId?: string; status: string }) => item.workspaceId === requestedWorkspaceId && item.status === 'dead_letter').length,
      generatedAt: extra.generatedAt,
      source: 'live-aggregate' as const,
    };
  },

  // GET /api/home/events | /api/home/extra | /api/home/team
  (ctx, path, method, _identity, requestedWorkspaceId) => {
    const extra = ctx.homeExtraLiveFor(requestedWorkspaceId);
    if (path === '/api/home/events' && method === 'GET') return extra.recentActivities;
    if (path === '/api/home/extra' && method === 'GET') return extra;
    if (path === '/api/home/team' && method === 'GET') return extra.teamMembers;
    return undefined;
  },

  // POST /api/home/alerts/:id/acknowledge
  (ctx, path, method, identity, requestedWorkspaceId, body) => {
    const m = path.match(/^\/api\/home\/alerts\/([^/]+)\/acknowledge$/);
    if (!m || method !== 'POST') return undefined;
    if (identity?.role !== 'admin') throw new Error('E_ROLE_FORBIDDEN: 仅管理员可确认运营告警');
    const alertId = m[1];
    const alert = ctx.homeExtraLiveFor(requestedWorkspaceId).slaAlerts.find((item) => item.id === alertId);
    if (!alert) throw new Error('E_HOME_ALERT_NOT_FOUND: 告警不存在或不属于当前工作区');
    const note = String((body as { note?: string } | undefined)?.note ?? '').trim();
    if (alert.level === 'P0' && !note) throw new Error('E_ACK_NOTE_REQUIRED: P0 告警确认必须记录处置说明');
    const acknowledgement = {
      acknowledgedAt: new Date().toISOString(),
      acknowledgedBy: identity.name ?? 'unknown',
      acknowledgementNote: note || '已确认，待进入任务处置。',
    };
    ctx.homeAlertAcknowledgements.set(`${requestedWorkspaceId}:${alertId}`, acknowledgement);
    ctx.appendDomainEvent('确认 SLA 告警', alert.taskCode, 'success');
    return { id: alertId, ...acknowledgement };
  },

  // GET /api/home/alerts
  (ctx, path, method, _identity, requestedWorkspaceId) => {
    if (path !== '/api/home/alerts' || method !== 'GET') return undefined;
    return ctx.homeExtraLiveFor(requestedWorkspaceId).slaAlerts.map((alert: { id: string; level: string; text: string; assignee: string; taskCode: string; acknowledged?: boolean }) => ({
      id: alert.id,
      severity: alert.level,
      tone: alert.level === 'P0' ? 'danger' as const : alert.level === 'P1' ? 'warning' as const : 'info' as const,
      title: `${alert.level} · ${alert.text}`,
      meta: `${alert.assignee} · ${alert.taskCode}`,
      taskCode: alert.taskCode,
      acknowledged: alert.acknowledged,
    }));
  },

  // GET /api/operations/overview
  (ctx, path, method) => {
    if (path !== '/api/operations/overview' || method !== 'GET') return undefined;
    const currentWorkspaceId = ctx.workspaceContext().workspaceId;
    const deadLetters = ctx.deliveryAttempts.filter((item) => item.workspaceId === currentWorkspaceId && item.status === 'dead_letter');
    const pendingApprovals = ctx.mockReleaseApprovals.filter((item) => item.workspaceId === currentWorkspaceId && item.status === 'pending').length;
    const pendingBackups = ctx.mockBackups.filter((item) => (item.workspaceId === currentWorkspaceId || !item.workspaceId) && item.status === 'pending_approval').length;
    return buildOpsOverviewLive({
      workspaceId: currentWorkspaceId,
      tasks: ctx.taskDomain.list().filter((task) => !task.workspaceId || task.workspaceId === currentWorkspaceId) as never,
      employees: ctx.mockDigitalPartners.filter((item) => item.workspaceId === currentWorkspaceId) as never,
      deadLetterCount: deadLetters.length,
      pendingApprovals,
      pendingBackups,
      usageUnits: ctx.mockUsageMeters.filter((item) => item.workspaceId === currentWorkspaceId).reduce((sum, item) => sum + (item.units ?? 0), 0),
    });
  },
];

export function dispatchM01Handler(
  ctx: M01Context,
  path: string,
  method: string,
  identity: M01Identity | null,
  workspaceId: string,
  body: unknown,
): unknown {
  for (const h of handlers) {
    const result = h(ctx, path, method, identity, workspaceId, body);
    if (result !== undefined) return result;
  }
  return undefined;
}
