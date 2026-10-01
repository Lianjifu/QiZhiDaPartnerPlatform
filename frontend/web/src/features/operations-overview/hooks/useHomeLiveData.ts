/**
 * M01 运营总览数据 hook — 集中所有 Home 页使用的 useApiQuery 调用。
 *
 * 触发 5 个 endpoint：
 *  - GET /api/home/extra      → HomeExtraLive (含 KPI / 告警 / 趋势 / 协作)
 *  - GET /api/home/kpis       → compact KPI（保持调用以同步触发 parity check）
 *  - GET /api/operations/overview → 跨资产 compact 视图
 *  - GET /api/home/events     → 首页事件流
 *  - GET /api/home/team       → team 成员
 *  - GET /api/home/alerts     → SLA 告警列表（admin ack 用）
 *
 * 任一子请求失败不阻塞其他请求；任一 loading 由 HomePage 汇总判断。
 */
import { useApiQuery } from '@/services/query';
import type { DigitalPartner, Task } from '@qzda/web-types';
import type { HomeExtraLive, AggregateEmployee } from '../types';

export type HomeKPIs = {
  activeDigitalPartners: number;
  openTasks: number;
  riskTasks: number;
  pendingApprovals: number;
  deadLetters: number;
  generatedAt: string;
  source: 'live-aggregate';
};

export type HomeEvents = HomeExtraLive['recentActivities'];

export type HomeTeam = HomeExtraLive['teamMembers'];

export type HomeAlert = {
  id: string;
  severity: string;
  tone: 'danger' | 'warning' | 'info';
  title: string;
  meta: string;
  taskCode: string;
  acknowledged?: boolean;
};

export type OpsOverview = ReturnType<typeof import('@qzda/web-api').buildOpsOverviewLive> extends infer T ? T : never;

export function useHomeLiveData() {
  const extra = useApiQuery<HomeExtraLive>(['home', 'extra'], '/api/home/extra');
  const kpis = useApiQuery<HomeKPIs>(['home', 'kpis'], '/api/home/kpis');
  const ops = useApiQuery<OpsOverview>(['operations', 'overview'], '/api/operations/overview');
  const events = useApiQuery<HomeEvents>(['home', 'events'], '/api/home/events');
  const team = useApiQuery<HomeTeam>(['home', 'team'], '/api/home/team');
  const alerts = useApiQuery<HomeAlert[]>(['home', 'alerts'], '/api/home/alerts');
  // 列表 API 也走 useApiQuery 共享缓存，保持 Home 页单一渲染源。
  const tasks = useApiQuery<Task[]>(['home', 'tasks'], '/api/tasks');
  const employees = useApiQuery<DigitalPartner[]>(['digital-employees'], '/api/partners');
  return { extra, kpis, ops, events, team, alerts, tasks, employees };
}

export type HomeLiveData = ReturnType<typeof useHomeLiveData>;

// Re-export AggregateEmployee for callers that need the type alongside.
export type { AggregateEmployee };
