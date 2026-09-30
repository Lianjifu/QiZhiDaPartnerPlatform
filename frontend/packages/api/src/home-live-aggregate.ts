/**
 * Mock 运营总览 live-aggregate — 对齐 backend ops_aggregate.go 语义。
 * 仅从工作区实体派生 KPI/告警/建议；禁止演示种子充数。
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

function hourSlot(iso: string | undefined, now: Date, buckets: number): number {
  if (!iso) return -1;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return -1;
  const hoursAgo = (now.getTime() - t) / 3_600_000;
  if (hoursAgo < 0 || hoursAgo >= buckets) return -1;
  return buckets - 1 - Math.floor(hoursAgo);
}

function isSameLocalDay(iso: string | undefined, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function employeeHealthScore(active: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((active / total) * 100);
}

export function buildHomeExtraLive(input: {
  workspaceId: string;
  tasks: AggregateTask[];
  employees: AggregateEmployee[];
  sessions: AggregateSession[];
  members?: AggregateMember[];
  usageMeters?: UsageMeter[];
  now?: Date;
}): HomeExtraLive {
  const now = input.now ?? new Date();
  const ws = input.workspaceId;
  const tasks = input.tasks.filter((t) => !t.workspaceId || t.workspaceId === ws);
  const employees = input.employees.filter((e) => !e.workspaceId || e.workspaceId === ws);
  const sessions = input.sessions.filter((s) => !s.workspaceId || s.workspaceId === ws);

  let done = 0;
  let doing = 0;
  let review = 0;
  let todo = 0;
  const hourTasks = Array.from({ length: 12 }, () => 0);
  const hourCollab = Array.from({ length: 12 }, () => 0);
  const hourAlerts = Array.from({ length: 12 }, () => 0);
  const activities: HomeExtraLive['recentActivities'] = [];

  for (const t of tasks) {
    const st = t.status;
    if (st === 'completed' || st === 'archived') done += 1;
    else if (st === 'in_progress') doing += 1;
    else if (st === 'review') review += 1;
    else todo += 1;

    const title = t.title || t.code;
    const actor = t.digitalPartnerName || t.assignee || '系统';
    let tone: HomeExtraLive['recentActivities'][number]['tone'] = 'info';
    if (st === 'completed' || st === 'archived') tone = 'success';
    else if (st === 'review') tone = 'warning';

    activities.push({
      id: `act-task-${t.id}`,
      type: `task.${st}`,
      tone,
      text: title,
      actor,
      resource: t.code,
      time: t.updatedAt ?? t.createdAt ?? '',
      to: `/tasks?task=${encodeURIComponent(t.code)}`,
    });
    const slot = hourSlot(t.updatedAt ?? t.createdAt, now, 12);
    if (slot >= 0) hourTasks[slot] += 1;
  }

  activities.sort((a, b) => String(b.time).localeCompare(String(a.time)));
  const recentActivities = activities.slice(0, 20);

  let healthy = 0;
  let warning = 0;
  let offline = 0;
  let calls = 0;
  for (const e of employees) {
    if (e.lifecycle === 'active' || e.lifecycle === 'published') healthy += 1;
    else if (e.lifecycle === 'paused' || e.lifecycle === 'quarantined') warning += 1;
    else offline += 1;
    calls += Number(e.runtime?.calls24h ?? 0);
  }
  const totalAgents = healthy + warning + offline;
  const healthScore = employeeHealthScore(healthy, totalAgents);

  const slaAlerts: HomeExtraLive['slaAlerts'] = [];
  const notifications: HomeExtraLive['notifications'] = [];
  for (const t of tasks) {
    const st = t.status;
    const risk = t.sla?.risk ?? '';
    const prio = t.priority ?? '';
    const needsAttention =
      st === 'review'
      || risk === 'critical'
      || risk === 'overdue'
      || risk === 'warning'
      || (prio === 'P0' && st !== 'completed' && st !== 'archived');
    if (!needsAttention) continue;
    const title = t.title || t.code;
    const level = prio || risk || 'P2';
    const updated = t.updatedAt ?? t.createdAt ?? '';
    slaAlerts.push({
      id: `task-alert-${t.id}`,
      level,
      text: title,
      time: updated,
      assignee: t.digitalPartnerName || t.assignee || '—',
      taskCode: t.code,
      workspaceId: ws,
      source: 'task',
    });
    const slot = hourSlot(updated, now, 12);
    if (slot >= 0) hourAlerts[slot] += 1;
    notifications.push({
      id: `n-task-${t.id}`,
      tone: 'warn',
      icon: 'AlertTriangle',
      text: title,
      detail: t.code,
      time: updated,
      unread: true,
    });
  }

  let collabToday = 0;
  for (const sess of sessions) {
    const updated = sess.updatedAt ?? sess.createdAt;
    if (isSameLocalDay(updated, now)) collabToday += 1;
    const slot = hourSlot(updated, now, 12);
    if (slot >= 0) hourCollab[slot] += 1;
  }

  const open = doing + review + todo;
  const taskSuccessRate = open + done > 0 ? Math.round((done / (open + done)) * 100) : null;

  let hasTrendSignal = false;
  const trend24h = Array.from({ length: 12 }, (_, i) => {
    if (hourTasks[i] + hourCollab[i] + hourAlerts[i] > 0) hasTrendSignal = true;
    const labelDate = new Date(now.getTime() - (11 - i) * 3_600_000);
    const hh = String(labelDate.getHours()).padStart(2, '0');
    const mm = String(labelDate.getMinutes()).padStart(2, '0');
    return {
      time: `${hh}:${mm}`,
      tasks: hourTasks[i],
      collab: hourCollab[i],
      alerts: hourAlerts[i],
      health: healthScore,
      taskRate: hourTasks[i],
      apiP95: null as null,
    };
  });

  const meters = (input.usageMeters ?? []).filter((m) => !m.workspaceId || m.workspaceId === ws);
  let costUsed = 0;
  let costBudget = 0;
  let costSource: 'usage-meters' | 'none' = 'none';
  if (meters.length > 0) {
    costSource = 'usage-meters';
    for (const m of meters) {
      costUsed += Number(m.usd ?? 0);
      costBudget += Number(m.budgetUsd ?? 0);
    }
  }

  const suggestion: HomeExtraLive['suggestion'] = [];
  if (review > 0) {
    suggestion.push({
      id: 'sg-review',
      tone: 'warn',
      text: '有待复核任务，建议尽快完成人工确认。',
      action: '打开任务中心',
      to: '/tasks?status=review',
    });
  }
  if (slaAlerts.length > 0) {
    suggestion.push({
      id: 'sg-alert',
      tone: 'warn',
      text: '存在需关注任务（复核/SLA/P0），请进入任务处置。',
      action: '查看任务',
      to: '/tasks?risk=attention',
    });
  }
  if (healthy > 0) {
    suggestion.push({
      id: 'sg-collab',
      tone: 'info',
      text: '在岗数字伙伴可发起专家协作。',
      action: '开始协作',
      to: '/copilot',
    });
  } else if (totalAgents === 0) {
    suggestion.push({
      id: 'sg-onboard',
      tone: 'info',
      text: '当前工作区尚未装配数字伙伴。',
      action: '打开工作伙伴',
      to: '/partners',
    });
  }

  const roleCounts = new Map<string, number>();
  for (const e of employees) {
    const key = e.role || '未命名岗位';
    roleCounts.set(key, (roleCounts.get(key) ?? 0) + 1);
  }

  const teamMembers = (input.members ?? []).map((member) => ({
    id: member.id,
    name: member.name,
    role: member.role,
    online: Boolean(member.lastActive && /刚刚|min|分钟/.test(member.lastActive)),
  }));

  return {
    workspaceId: ws,
    generatedAt: now.toISOString(),
    source: 'live-aggregate',
    healthTrend24h: hasTrendSignal ? trend24h.map((row) => row.health) : [],
    teamMembers,
    recentActivities,
    agentCallSummary: { total: calls, healthy, warning, offline },
    notifications,
    agent7dTrend: {},
    taskCompletion: { done, doing, review, todo },
    slaAlerts,
    operationalMetrics: {
      taskSuccessRate,
      activeAgents: healthy,
      healthScore,
      apiP95: null,
      taskRate: doing,
      collabToday,
      tokenUsage: { total: '—', input: '—', output: '—' },
      trend24h: hasTrendSignal ? trend24h : [],
    },
    costMonth: { used: costUsed, budget: costBudget, daily: [], source: costSource },
    roleDistribution: [...roleCounts.entries()].map(([role, count]) => ({ role, count })),
    suggestion,
    quickLinks: [
      { label: '工作伙伴', to: '/partners', icon: 'Bot', desc: '岗位装配与上岗' },
      { label: '专家协作', to: '/copilot', icon: 'MessageSquare', desc: '研判与受控执行' },
      { label: '任务中心', to: '/tasks', icon: 'ListChecks', desc: '派工与处置闭环' },
    ],
    kpiDetails: {},
  };
}

export function buildOpsOverviewLive(input: {
  workspaceId: string;
  tasks: AggregateTask[];
  employees: AggregateEmployee[];
  deadLetterCount?: number;
  pendingApprovals?: number;
  pendingBackups?: number;
  usageUnits?: number;
  now?: Date;
}) {
  const ws = input.workspaceId;
  const tasks = input.tasks.filter((t) => !t.workspaceId || t.workspaceId === ws);
  const employees = input.employees.filter((e) => !e.workspaceId || e.workspaceId === ws);

  let activeDE = 0;
  let pendingDE = 0;
  for (const e of employees) {
    if (e.lifecycle === 'active' || e.lifecycle === 'published') activeDE += 1;
    else if (e.lifecycle === 'pending_approval' || e.lifecycle === 'draft') pendingDE += 1;
  }

  let openTasks = 0;
  let riskTasks = 0;
  const pending: Array<{ id: string; title: string; level: string; to: string; kind?: string }> = [];
  for (const t of tasks) {
    const st = t.status;
    if (st !== 'completed' && st !== 'archived') openTasks += 1;
    const risk = t.sla?.risk ?? '';
    if (risk && risk !== 'none') riskTasks += 1;
    if (st === 'review' || st === 'pending' || risk === 'critical' || risk === 'overdue' || risk === 'warning') {
      pending.push({
        id: `task-${t.id}`,
        title: t.title || t.code,
        level: t.priority || risk || 'P2',
        to: `/tasks?task=${encodeURIComponent(t.code)}`,
        kind: 'task',
      });
    }
  }

  return {
    workspaceId: ws,
    generatedAt: (input.now ?? new Date()).toISOString(),
    source: 'live-aggregate' as const,
    digitalPartners: { active: activeDE, pending: pendingDE },
    tasks: { open: openTasks, risk: riskTasks },
    channels: { deadLetters: input.deadLetterCount ?? 0 },
    governance: {
      pendingApprovals: input.pendingApprovals ?? 0,
      pendingBackups: input.pendingBackups ?? 0,
    },
    usage: { recentUnits: input.usageUnits ?? 0 },
    pending: pending.slice(0, 8),
    health: {
      taskSuccessRate: tasks.length
        ? Math.round((tasks.filter((t) => t.status === 'completed' || t.lifecycleStage === 'completed').length / tasks.length) * 100)
        : 0,
      activeAgents: activeDE,
      score: employeeHealthScore(activeDE, activeDE + pendingDE),
      deadLetters: input.deadLetterCount ?? 0,
    },
  };
}

/** 能力装配展示名 → 能力目录真实名（模型路由 / 知识包 / 技能 / 工具 / 流程 / 渠道） */
export const CAPABILITY_NAME_ALIASES: Record<string, string> = {
  // 模型路由（对齐 /api/partner-capability-catalog 已发布策略名）
  '企业通用路由 v2': 'P0 路由',
  '受限数据路由 v1': 'P2 路由',
  // 知识包
  运行手册库: '生产故障处置知识包',
  故障知识库: '生产故障处置知识包',
  变更规范库: '生产故障处置知识包',
  告警规则库: '生产故障处置知识包',
  发布运行手册: '生产故障处置知识包',
  IT服务知识库: '生产故障处置知识包',
  'IT 服务知识库': '生产故障处置知识包',
  安全运行手册: '安全漏洞处置知识包',
  威胁情报库: '安全漏洞处置知识包',
  漏洞处置规范: '安全漏洞处置知识包',
  资产风险基线: '生产资产与依赖知识包',
  容量规划规范: '生产资产与依赖知识包',
  性能基线库: '生产资产与依赖知识包',
  // 技能 / 工具
  日志检索: 'loki-query',
  告警分析: 'prometheus',
  告警研判: 'prometheus',
  工单分诊: 'customer-ticket-tool',
  资产查询: 'cmdb-tool',
  变更风险评估: 'itsm-change-tool',
  发布风险评估: 'release-control-tool',
  指标分析: 'prometheus',
  容量评估: 'prometheus',
  漏洞研判: 'es-query',
  资产匹配: 'cmdb-tool',
  威胁狩猎: 'es-query',
  基线核查: 'cmdb-tool',
  证据汇总: 'jira-tool',
  态势汇总: 'prometheus',
  风险评估: 'itsm-change-tool',
  终端诊断: 'cmdb-tool',
  访问核验: 'cmdb-tool',
  权限分析: 'jira-tool',
  服务分诊: 'customer-ticket-tool',
  配置核验: 'jira-tool',
  事件分派: 'notification-tool',
  Prometheus: 'prometheus',
  Loki: 'loki-query',
  CMDB: 'cmdb-tool',
  Jira: 'jira-tool',
  Grafana: 'prometheus',
  事件中心: 'notification-tool',
  SIEM: 'es-query',
  EDR: 'es-query',
  // 流程技能
  生产故障处置流: '生产故障处置流程技能',
  告警响应协同流: '生产故障处置流程技能',
  生产变更协同流: '生产变更协同流程技能',
  生产发布保障流: '生产变更协同流程技能',
  容量评估协同流: '生产故障处置流程技能',
  IT服务请求流: '生产故障处置流程技能',
  'IT 服务请求流': '生产故障处置流程技能',
  安全事件响应流: '生产变更协同流程技能',
  漏洞响应协同流: '生产变更协同流程技能',
  威胁调查协同流: '生产变更协同流程技能',
  安全合规核查流: '生产变更协同流程技能',
  信息技术部态势协同流: '生产故障处置流程技能',
};

/** 渠道展示名 → 渠道目录名（与工具别名隔离，避免「事件中心」被映射成工具） */
export const CHANNEL_NAME_ALIASES: Record<string, string> = {
  企业微信: '企业微信',
  Web: 'Web',
  飞书: '飞书',
  事件中心: '飞书',
};

export function normalizeCapabilityName(name: string): string {
  return CAPABILITY_NAME_ALIASES[name] ?? name;
}

export function normalizeChannelName(name: string): string {
  return CHANNEL_NAME_ALIASES[name] ?? name;
}

export function normalizeEmployeeCapabilities<T extends {
  skills?: string[];
  tools?: string[];
  workflows?: string[];
  channels?: string[];
  knowledge?: string[];
  model?: string;
  agentId?: string;
}>(capabilities: T): T {
  const uniq = (values: string[] | undefined, map = normalizeCapabilityName) =>
    [...new Set((values ?? []).map(map).filter(Boolean))];
  return {
    ...capabilities,
    model: capabilities.model ? normalizeCapabilityName(capabilities.model) : capabilities.model,
    skills: uniq(capabilities.skills),
    tools: uniq(capabilities.tools),
    workflows: uniq(capabilities.workflows),
    channels: uniq(capabilities.channels, normalizeChannelName),
    knowledge: uniq(capabilities.knowledge),
  };
}
