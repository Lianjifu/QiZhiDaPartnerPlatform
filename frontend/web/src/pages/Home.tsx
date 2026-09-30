/**
 * 运营总览 — 现代 SaaS 运营台：页头 / KPI / 专家亮点 / 工作记录
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApiMutation, useApiQuery } from '@/services/query';
import { Badge, Button, Avatar } from '@de/web-ui';
import { PageSkeleton } from '@/components/PageSkeleton';
import { DigitalEmployeeAvatar } from '@/components/DigitalEmployeeAvatar';
import {
  Activity, ArrowRight, BellRing, BookOpen, Bot, Brain,
  Check, CheckCircle2, ChevronDown, ChevronRight, Clock, HeartPulse,
  Inbox, Lightbulb, ListChecks, MessageSquare, Plus, RefreshCw,
  ShieldCheck, Target, TrendingUp, Users,
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { cn } from '@de/web-utils';
import type { DigitalEmployee, Task } from '@de/web-types';
import { EmptyState, RoleReadonlyBanner } from '@/components/shared';
import { useAuthStore } from '@/stores/authStore';
import { employeePrimaryLabel, employeeSecondaryLabel } from '@/lib/digital-employees';
import { roleCanMutate, rolePageCopy } from '@/features/role-nav/role-nav';
import { employeeHealthScore, taskSuccessRate, toDateKey } from '@/features/home/home-metrics';
import { WorkRecordCalendar, type DayScheduleEvent, type SelectDateOptions, type WorkRecordPeriod } from '@/features/home/WorkRecordCalendar';

const AUDITOR_SUGGESTION_PREFIXES = ['/audit-center', '/zero-trust', '/tasks', '/copilot', '/partners', '/workflows', '/knowledge', '/skills', '/memory', '/home'];

type Period = WorkRecordPeriod;
type RecordTab = 'all' | 'attention' | 'done';

type WorkRecord = {
  id: string;
  title: string;
  status: string;
  statusTone: 'success' | 'error' | 'warn' | 'info' | 'neutral';
  attribution?: string;
  time: string;
  dateKey?: string;
  to: string;
  kind: 'task' | 'activity' | 'alert';
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return '凌晨好';
  if (h < 12) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function useCountdown(targetSec: number) {
  const [sec, setSec] = useState(targetSec);
  useEffect(() => { setSec(targetSec); }, [targetSec]);
  useEffect(() => {
    const id = setInterval(() => setSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return {
    text: h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
    raw: sec,
  };
}

function formatWhen(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function Home() {
  const navigate = useNavigate();
  const greeting = getGreeting();
  const { user } = useAuthStore();
  const isAdministrator = user?.role === 'admin';
  const isAuditor = user?.role === 'auditor';
  const canMutate = roleCanMutate(user?.role);
  const homeCopy = rolePageCopy('home', user?.role);

  const { data: tasks, isLoading: lTasks } = useApiQuery<Task[]>(['home', 'tasks'], '/api/tasks');
  const { data: extra, isLoading: lExtra, isFetching: fetchingExtra, refetch: refetchExtra } = useApiQuery<any>(['home', 'extra'], '/api/home/extra');
  const { data: employees = [], isLoading: lEmployees } = useApiQuery<DigitalEmployee[]>(['digital-employees'], '/api/digital-employees');
  const { data: operations } = useApiQuery<any>(['operations', 'overview'], '/api/operations/overview');
  /** Compact aggregate; kept for parity checks / future widgets (lists remain display source of truth). */
  useApiQuery<any>(['home', 'kpis'], '/api/home/kpis');

  const [period, setPeriod] = useState<Period>('day');
  const [recordTab, setRecordTab] = useState<RecordTab>('all');
  const [selectedDateKey, setSelectedDateKey] = useState(() => toDateKey(new Date()));
  const handleSelectDate = useCallback((dateKey: string, options?: SelectDateOptions) => {
    setSelectedDateKey(dateKey);
    if (options?.drillToDay) setPeriod('day');
  }, []);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [runtimeOpen, setRuntimeOpen] = useState(false);

  const acknowledgeAlert = useApiMutation<{ id: string }, { id: string; note: string }>(
    ({ id }) => `/api/home/alerts/${id}/acknowledge`,
    { onSuccess: () => refetchExtra() },
  );

  const allTasks = tasks ?? [];
  const inProgress = allTasks.filter((t) => t.status === 'in_progress');
  const completed = allTasks.filter((t) => t.status === 'completed');
  const review = allTasks.filter((t) => t.status === 'review' || t.status === 'pending');
  const todoTasks = allTasks.filter((t) => t.status === 'pending');

  /** KPI 与列表同源：员工/任务以列表 API 为准，extra 仅补充告警/成本/趋势桶 */
  const activeEmployees = useMemo(
    () => employees.filter((e) => e.lifecycle === 'active' || e.release?.status === 'released'),
    [employees],
  );
  const activeAgents = activeEmployees.length;
  const agentCount = employees.length;
  const healthScore = employeeHealthScore(activeAgents, agentCount);
  const taskTotal = allTasks.length;
  const successRate = taskSuccessRate(completed.length, taskTotal);

  const visibleAlerts = (extra?.slaAlerts ?? []).filter((a: { acknowledged?: boolean }) => !a.acknowledged);
  const unreadNotifications = (extra?.notifications ?? []).filter(
    (n: { unread?: boolean; id: string }) => n.unread && !readIds.has(n.id),
  );
  const pendingItems = useMemo(() => {
    const fromOps = (operations?.pending ?? []) as Array<{ id: string; title?: string; to?: string; level?: string }>;
    if (fromOps.length) {
      return fromOps.map((item) => ({
        id: item.id,
        title: item.title ?? item.id,
        to: item.to || '/tasks?risk=attention',
      }));
    }
    const fromAlerts = visibleAlerts.map((a: { id: string; text: string; taskCode?: string }) => ({
      id: `alert-${a.id}`,
      title: a.text,
      to: `/tasks?task=${encodeURIComponent(a.taskCode ?? '')}&risk=attention`,
    }));
    const fromReview = review.slice(0, 5).map((t) => ({
      id: `task-${t.id}`,
      title: t.title,
      to: `/tasks?task=${encodeURIComponent(t.code)}`,
    }));
    return [...fromAlerts, ...fromReview].slice(0, 6);
  }, [operations?.pending, visibleAlerts, review]);

  const costSource = String(extra?.costMonth?.source ?? '');
  const costUsed = costSource === 'usage-meters' ? Number(extra?.costMonth?.used ?? 0) : 0;
  const costBudget = costSource === 'usage-meters' ? Number(extra?.costMonth?.budget ?? 0) : 0;
  const costPct = costBudget > 0 ? Math.min(100, (costUsed / costBudget) * 100) : 0;
  const healthData = (extra?.operationalMetrics?.trend24h ?? []) as Array<{
    time: string; tasks?: number; collab?: number; alerts?: number;
  }>;
  const attentionCount = visibleAlerts.length + review.length;
  const todayCollab = Number(extra?.operationalMetrics?.collabToday ?? 0);
  const tc = {
    done: completed.length,
    doing: inProgress.length,
    review: review.length,
    todo: todoTasks.length,
  };

  const featuredPool = useMemo(() => {
    const pool = activeEmployees.length ? activeEmployees : employees;
    return pool.slice(0, 4);
  }, [activeEmployees, employees]);
  const featured = featuredPool[0] ?? null;

  const featureStats = useMemo(() => {
    const knowledge = featured?.capabilities?.knowledge?.length ?? 0;
    const skills = (featured?.capabilities?.skills?.length ?? 0) + (featured?.capabilities?.tools?.length ?? 0);
    const workflows = featured?.capabilities?.workflows?.length ?? 0;
    return { knowledge, skills, workflows };
  }, [featured]);

  const modules = isAuditor
    ? [
        { title: '审计中心', desc: '证据流水与导出', to: '/audit-center', icon: ShieldCheck, tone: 'brand' as const },
        { title: '持续验证', desc: '策略与临时授权', to: '/zero-trust', icon: Activity, tone: 'info' as const },
        { title: '任务核查', desc: '放行与交接证据', to: '/tasks', icon: ListChecks, tone: 'warn' as const },
        { title: '协作记录', desc: '研判与人工审核', to: '/copilot', icon: MessageSquare, tone: 'success' as const },
      ]
    : [
        { title: '工作伙伴', desc: '岗位与能力装配', to: '/partners', icon: Bot, tone: 'brand' as const },
        { title: '专家协作', desc: '研判与受控执行', to: '/copilot', icon: MessageSquare, tone: 'info' as const },
        { title: '知识记忆', desc: '检索与跨会话', to: '/knowledge', icon: BookOpen, tone: 'success' as const },
        { title: '任务 SLA', desc: '派工与处置闭环', to: '/tasks', icon: ListChecks, tone: 'warn' as const },
      ];

  const kpis = [
    {
      key: 'agents',
      label: '在岗专家',
      value: activeAgents,
      sub: agentCount ? `/ ${agentCount}` : undefined,
      icon: Users,
      tone: 'brand' as const,
      to: '/partners',
    },
    {
      key: 'doing',
      label: '进行中',
      value: inProgress.length,
      icon: Activity,
      tone: 'info' as const,
      to: '/tasks?status=in_progress',
    },
    {
      key: 'attention',
      label: '需关注',
      value: attentionCount,
      icon: Target,
      tone: attentionCount > 0 ? ('warn' as const) : ('neutral' as const),
      to: '/tasks?risk=attention',
    },
    {
      key: 'done',
      label: '已完成',
      value: completed.length,
      icon: CheckCircle2,
      tone: 'success' as const,
      to: '/tasks?status=completed',
    },
    {
      key: 'success',
      label: '成功率',
      value: successRate == null ? '—' : `${successRate}%`,
      icon: TrendingUp,
      tone: 'success' as const,
      to: '/tasks',
    },
    {
      key: 'health',
      label: '健康度',
      value: healthScore ?? '—',
      icon: HeartPulse,
      tone: 'info' as const,
      to: '/partners?tab=operations',
    },
  ];

  const calendarSource = useMemo(() => ({
    tasks: allTasks,
    alerts: visibleAlerts.map((a: { time?: string }) => ({ time: a.time })),
    todayCollab,
    trend: healthData,
  }), [allTasks, visibleAlerts, todayCollab, healthData]);

  const dayEvents = useMemo((): DayScheduleEvent[] => {
    const out: DayScheduleEvent[] = [];
    for (const t of allTasks) {
      const raw = t.updatedAt ?? t.createdAt;
      const ts = Date.parse(raw);
      if (!Number.isFinite(ts)) continue;
      const d = new Date(ts);
      const done = t.status === 'completed';
      const attention = (t.slaRemainingMin ?? 999) < 60 || t.priority === 'P0' || t.status === 'review';
      out.push({
        id: `task-${t.id}`,
        kind: 'task',
        title: t.title,
        subtitle: t.digitalEmployeeName ?? t.assignee,
        hour: d.getHours(),
        minute: d.getMinutes(),
        dateKey: toDateKey(d),
        to: `/tasks?task=${encodeURIComponent(t.code)}`,
        tone: done ? 'success' : attention ? 'error' : 'info',
      });
    }
    for (const alert of visibleAlerts) {
      const ts = Date.parse(String(alert.time ?? ''));
      if (!Number.isFinite(ts)) continue;
      const d = new Date(ts);
      out.push({
        id: `alert-${alert.id}`,
        kind: 'alert',
        title: alert.text,
        subtitle: alert.assignee ?? alert.taskCode,
        hour: d.getHours(),
        minute: d.getMinutes(),
        dateKey: toDateKey(d),
        to: `/tasks?task=${encodeURIComponent(alert.taskCode ?? '')}&risk=attention`,
        tone: alert.level === 'P0' ? 'error' : 'warn',
      });
    }
    if (todayCollab > 0) {
      const now = new Date();
      out.push({
        id: 'collab-today',
        kind: 'collab',
        title: `今日协作 ${todayCollab} 次`,
        subtitle: '专家协作会话',
        hour: now.getHours(),
        minute: 0,
        dateKey: toDateKey(now),
        to: '/copilot',
        tone: 'info',
      });
    }
    return out;
  }, [allTasks, visibleAlerts, todayCollab]);

  /** 打开「日」且今天无事件时，落到最近有活动的一天；用户手动换日则不抢焦点 */
  useEffect(() => {
    if (period !== 'day' || dayEvents.length === 0) return;
    if (dayEvents.some((e) => e.dateKey === selectedDateKey)) return;
    if (selectedDateKey !== toDateKey(new Date())) return;
    const latest = [...dayEvents].sort((a, b) => `${b.dateKey}T${String(b.hour).padStart(2, '0')}`.localeCompare(`${a.dateKey}T${String(a.hour).padStart(2, '0')}`))[0];
    if (latest) setSelectedDateKey(latest.dateKey);
  }, [period, dayEvents, selectedDateKey]);

  const records = useMemo(() => {
    const out: WorkRecord[] = [];
    for (const t of allTasks.slice(0, 24)) {
      const done = t.status === 'completed';
      const attention = (t.slaRemainingMin ?? 999) < 60 || t.priority === 'P0' || t.status === 'review';
      const raw = t.updatedAt ?? t.createdAt;
      const ts = Date.parse(raw);
      out.push({
        id: `task-${t.id}`,
        title: t.title,
        status: done ? '已完成' : attention ? '需关注' : t.status === 'in_progress' ? '进行中' : '待处理',
        statusTone: done ? 'success' : attention ? 'error' : t.status === 'in_progress' ? 'info' : 'neutral',
        attribution: t.digitalEmployeeName ?? t.assignee ?? '—',
        time: formatWhen(raw),
        dateKey: Number.isFinite(ts) ? toDateKey(new Date(ts)) : undefined,
        to: `/tasks?task=${encodeURIComponent(t.code)}`,
        kind: 'task',
      });
    }
    for (const alert of visibleAlerts.slice(0, 12)) {
      const ts = Date.parse(String(alert.time ?? ''));
      out.push({
        id: `alert-${alert.id}`,
        title: alert.text,
        status: alert.level ?? '告警',
        statusTone: alert.level === 'P0' ? 'error' : 'warn',
        attribution: alert.assignee ?? alert.taskCode,
        time: formatWhen(alert.time) === '—' ? (alert.time ?? '—') : formatWhen(alert.time),
        dateKey: Number.isFinite(ts) ? toDateKey(new Date(ts)) : undefined,
        to: `/tasks?task=${encodeURIComponent(alert.taskCode ?? '')}&risk=attention`,
        kind: 'alert',
      });
    }
    return out;
  }, [allTasks, visibleAlerts]);

  const filteredRecords = records.filter((r) => {
    if (r.dateKey && r.dateKey !== selectedDateKey) return false;
    if (recordTab === 'attention') return r.statusTone === 'error' || r.statusTone === 'warn';
    if (recordTab === 'done') return r.statusTone === 'success';
    return true;
  });

  const periodDateLabel = useMemo(() => {
    const d = new Date(`${selectedDateKey}T12:00:00`);
    if (Number.isNaN(d.getTime())) return new Date().toLocaleDateString('zh-CN');
    if (period === 'month') {
      return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
    }
    if (period === 'week') {
      return `${d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 所在周`;
    }
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' });
  }, [period, selectedDateKey]);

  const suggestions = (extra?.suggestion ?? []).filter((s: { to?: string }) => {
    if (!isAuditor) return true;
    const to = s.to ?? '';
    return AUDITOR_SUGGESTION_PREFIXES.some((prefix) => to === prefix || to.startsWith(`${prefix}?`) || to.startsWith(`${prefix}/`));
  });

  const chartTheme = {
    grid: 'var(--chart-grid)',
    tooltipBackground: 'var(--surface-1)',
    tooltipBorder: 'var(--border)',
    tooltipText: 'var(--text)',
  };

  if ((lTasks || lExtra || lEmployees) && tasks === undefined && extra === undefined && employees.length === 0) {
    return <PageSkeleton />;
  }

  return (
    <div className="de-employee-page home-page h-full min-w-0 overflow-y-auto bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5">
      <header className="home-header">
        <div className="home-header__copy">
          <p className="home-header__eyebrow">{greeting}，{user?.name ?? '用户'}</p>
          <h1 className="home-header__title">{homeCopy.title}</h1>
          <p className="home-header__subtitle">{homeCopy.subtitle}</p>
        </div>
        <div className="home-header__actions">
          <button
            type="button"
            className="home-icon-btn"
            onClick={() => refetchExtra()}
            disabled={fetchingExtra}
            aria-label="刷新数据"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', fetchingExtra && 'animate-spin')} />
          </button>
          {isAuditor ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => navigate('/tasks')}>
                <ListChecks className="h-3.5 w-3.5" />任务核查
              </Button>
              <Button size="sm" onClick={() => navigate('/audit-center')}>
                <ShieldCheck className="h-3.5 w-3.5" />审计中心
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => navigate('/tasks')}>
                <Plus className="h-3.5 w-3.5" />{user?.role === 'user' ? '我的待办' : '创建任务'}
              </Button>
              <Button size="sm" onClick={() => navigate('/copilot')}>
                <MessageSquare className="h-3.5 w-3.5" />开始协作
              </Button>
            </>
          )}
        </div>
      </header>

      <RoleReadonlyBanner className="mb-3 flex items-start gap-2 rounded-xl bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]" />

      <section className="home-kpis" aria-label="运营指标">
        {kpis.map((kpi) => (
          <button
            key={kpi.key}
            type="button"
            className={cn('home-kpi', `home-kpi--${kpi.tone}`)}
            onClick={() => navigate(kpi.to)}
          >
            <span className="home-kpi__icon"><kpi.icon className="h-4 w-4" /></span>
            <span className="home-kpi__body">
              <span>{kpi.label}</span>
              <strong>
                {kpi.value}
                {kpi.sub && <small>{kpi.sub}</small>}
              </strong>
            </span>
          </button>
        ))}
      </section>

      <div className="home-desk">
        <div className="home-desk__main">
          <section className="home-spotlight de-employee-shell">
            {featured ? (
              <>
                <div className="home-spotlight__head">
                  <div className="home-spotlight__identity">
                    <DigitalEmployeeAvatar employee={featured} size={52} />
                    <div className="min-w-0">
                      <p className="home-spotlight__label">数字伙伴 · 今日焦点</p>
                      <h2 className="home-spotlight__name">{employeePrimaryLabel(featured)}</h2>
                      <p className="home-spotlight__meta">{employeeSecondaryLabel(featured)} · {featured.department}</p>
                    </div>
                  </div>
                  <div className="home-spotlight__cta">
                    {featured.lifecycle === 'active' && <Badge tone="success" className="text-[10px]">在岗</Badge>}
                    <Button size="sm" variant="secondary" onClick={() => navigate(`/partners?employeeId=${featured.id}`)}>
                      档案 <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                    {!isAuditor && (
                      <Button size="sm" onClick={() => navigate(`/copilot?employee=${featured.id}`)}>
                        <MessageSquare className="h-3.5 w-3.5" />协作
                      </Button>
                    )}
                  </div>
                </div>

                <div className="home-spotlight__chips">
                  {(featured.responsibilities ?? []).slice(0, 3).map((item) => (
                    <span key={item} className="home-chip">{item}</span>
                  ))}
                </div>

                <div className="home-spotlight__stats">
                  <div><span>知识</span><strong>{featureStats.knowledge}</strong></div>
                  <div><span>技能/工具</span><strong>{featureStats.skills}</strong></div>
                  <div><span>流程</span><strong>{featureStats.workflows}</strong></div>
                  <div><span>24h 调用</span><strong>{featured.runtime?.calls24h ?? 0}</strong></div>
                </div>

                {featuredPool.length > 1 && (
                  <div className="home-spotlight__team">
                    <span className="home-spotlight__team-label">在岗团队</span>
                    <div className="home-spotlight__avatars">
                      {featuredPool.map((emp) => (
                        <button
                          key={emp.id}
                          type="button"
                          className={cn('home-spotlight__avatar', emp.id === featured.id && 'is-active')}
                          title={employeePrimaryLabel(emp)}
                          onClick={() => navigate(`/partners?employeeId=${emp.id}`)}
                        >
                          <DigitalEmployeeAvatar employee={emp} size={28} rounded="full" />
                        </button>
                      ))}
                      {employees.length > featuredPool.length && (
                        <Link to="/partners" className="home-spotlight__more">+{employees.length - featuredPool.length}</Link>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <EmptyState
                icon={Bot}
                title="尚未装配数字伙伴"
                description="先创建或从上岗模板引入岗位，运营总览将展示在岗专家"
                action={<Link to="/partners" className="text-xs text-[var(--brand)] hover:underline">打开数字伙伴</Link>}
              />
            )}
          </section>

          <nav className="home-rail" aria-label="功能入口">
            {modules.map((mod) => (
              <Link key={mod.to} to={mod.to} className={cn('home-rail__item', `home-rail__item--${mod.tone}`)}>
                <span className="home-rail__icon"><mod.icon className="h-4 w-4" /></span>
                <span className="home-rail__copy">
                  <strong>{mod.title}</strong>
                  <span>{mod.desc}</span>
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-35" />
              </Link>
            ))}
          </nav>

          <section className="home-mid">
            <div className="home-panel de-employee-shell">
              <div className="home-panel__head">
                <div className="flex items-center gap-2 min-w-0">
                  <Inbox className="h-4 w-4 shrink-0 text-[var(--brand)]" />
                  <h3>{isAdministrator ? '需要关注' : '我的待办'}</h3>
                  {attentionCount > 0 && <Badge tone="error">{attentionCount}</Badge>}
                </div>
                <Link to="/tasks?risk=attention" className="home-link">全部</Link>
              </div>
              {unreadNotifications.length > 0 && (
                <div className="home-notice">
                  <BellRing className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
                  <span className="min-w-0 flex-1 truncate">{unreadNotifications[0]?.text}</span>
                  <button
                    type="button"
                    className="home-link"
                    onClick={() => setReadIds(new Set((extra?.notifications ?? []).map((n: { id: string }) => n.id)))}
                  >
                    已读
                  </button>
                </div>
              )}
              <div className="home-pending">
                {pendingItems.slice(0, 5).map((item) => (
                  <Link key={item.id} to={item.to} className="home-pending__row">
                    <span className="home-pending__dot" />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  </Link>
                ))}
                {pendingItems.length === 0 && (
                  <p className="home-empty">当前没有待处理事项</p>
                )}
              </div>
            </div>

            <div className="home-panel de-employee-shell">
              <div className="home-panel__head">
                <h3>投入产出</h3>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {costSource === 'usage-meters' ? '本月计量' : '暂无计量'}
                </span>
              </div>
              <div className="home-roi">
                <div className="home-roi__value">
                  <strong>{costUsed > 0 ? `¥${costUsed}` : '—'}</strong>
                  <span>{costBudget > 0 ? `/ ¥${costBudget}` : ''}</span>
                </div>
                {costBudget > 0 && costUsed > 0 ? (
                  <div className="home-roi__bar" aria-hidden>
                    <div style={{ width: `${costPct}%` }} />
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-[var(--text-muted)]">仅展示 UsageMeters 实计量；无计量数据时不显示金额。</p>
                )}
                <div className="home-roi__grid">
                  <div><span>完成</span><strong>{tc.done}</strong></div>
                  <div><span>成功率</span><strong>{successRate == null ? '—' : `${Math.round(successRate)}%`}</strong></div>
                  <div><span>健康度</span><strong>{healthScore ?? '—'}</strong></div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <aside className="home-records de-employee-shell">
          <div className="home-records__head">
            <div>
              <h2>工作记录</h2>
              <p>协作、任务与告警的运行痕迹</p>
            </div>
          </div>

          <div className="home-records__metrics">
            <button type="button" className="home-records__metric" onClick={() => navigate('/copilot')}>
              <span>今日协作</span><strong>{todayCollab}</strong>
            </button>
            <button type="button" className="home-records__metric" onClick={() => navigate('/tasks')}>
              <span>任务总量</span><strong>{allTasks.length}</strong>
            </button>
            <button type="button" className="home-records__metric home-records__metric--good" onClick={() => setRecordTab('done')}>
              <span>已完成</span><strong>{completed.length || tc.done}</strong>
            </button>
            <button type="button" className="home-records__metric home-records__metric--bad" onClick={() => setRecordTab('attention')}>
              <span>需关注</span><strong>{attentionCount}</strong>
            </button>
          </div>

          <div className="home-records__period">
            <div className="home-segment" role="tablist" aria-label="时间范围">
              {([['day', '日'], ['week', '周'], ['month', '月']] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={period === key}
                  className={cn('home-segment__item', period === key && 'is-active')}
                  onClick={() => setPeriod(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="home-records__date">{periodDateLabel}</span>
          </div>

          <WorkRecordCalendar
            period={period}
            source={calendarSource}
            selectedDateKey={selectedDateKey}
            onSelectDate={handleSelectDate}
            dayEvents={dayEvents}
          />

          <div className="home-segment home-records__tabs" role="tablist">
            {([['all', '全部'], ['attention', '需关注'], ['done', '已完成']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                className={cn('home-segment__item', recordTab === key && 'is-active')}
                onClick={() => setRecordTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="home-records__table">
            <div className="home-records__thead">
              <span>记录</span><span>状态</span><span>归因</span><span>时间</span>
            </div>
            {filteredRecords.length === 0 ? (
              <div className="home-empty">当前筛选下暂无记录</div>
            ) : filteredRecords.slice(0, 10).map((row) => (
              <Link key={row.id} to={row.to} className="home-records__row">
                <span className="home-records__title">{row.title}</span>
                <Badge tone={row.statusTone} className="text-[9px]">{row.status}</Badge>
                <span className="truncate text-[var(--text-muted)]">{row.attribution}</span>
                <span className="tabular-nums text-[var(--text-muted)]">{row.time}</span>
              </Link>
            ))}
          </div>

          {canMutate && isAdministrator && visibleAlerts.some((a: { source?: string; level?: string }) => a.source !== 'task' && a.level !== 'P0') && (
            <div className="home-records__foot">
              <button
                type="button"
                className="home-link"
                disabled={acknowledgeAlert.isPending}
                onClick={() => {
                  const first = visibleAlerts.find((a: { level?: string }) => a.level !== 'P0');
                  if (first) acknowledgeAlert.mutate({ id: first.id, note: '已确认，待进入任务处置。' });
                }}
              >
                <Check className="h-3 w-3" />确认下一条非 P0 告警
              </button>
            </div>
          )}
        </aside>
      </div>

      <details
        className="home-runtime de-employee-shell"
        open={runtimeOpen}
        onToggle={(e) => setRuntimeOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>
          <span className="inline-flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            运行细节
            <span className="font-normal text-[var(--text-muted)]">
              24h 趋势 · 进行中任务{isAdministrator ? ' · 建议' : ''}
            </span>
          </span>
          <ChevronDown className={cn('h-4 w-4 text-[var(--text-muted)] transition-transform', runtimeOpen && 'rotate-180')} />
        </summary>
        <div className="home-runtime__body">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="list-card">
              <div className="list-card__header">
                <div className="list-card__title"><Clock className="h-4 w-4" />进行中任务</div>
                <Link to="/tasks" className="chart-card__action">全部</Link>
              </div>
              <div className="space-y-2 p-3 pt-0">
                {inProgress.length === 0 ? (
                  <EmptyState icon={CheckCircle2} title="没有进行中的任务" />
                ) : inProgress.slice(0, 4).map((t) => <InProgressTask key={t.id} t={t} />)}
              </div>
            </div>
            <div className="chart-card">
              <div className="list-card__header">
                <div className="list-card__title"><Activity className="h-4 w-4" />24h 健康趋势</div>
              </div>
              {healthData.length === 0 ? (
                <EmptyState icon={Brain} title="暂无趋势数据" />
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={healthData}>
                    <defs>
                      <linearGradient id="home-health" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-success)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--chart-success)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                    <XAxis dataKey="time" hide />
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip contentStyle={{ background: chartTheme.tooltipBackground, border: `1px solid ${chartTheme.tooltipBorder}`, color: chartTheme.tooltipText, borderRadius: 6, fontSize: 11 }} />
                    <Area type="monotone" dataKey="health" stroke="var(--chart-success)" strokeWidth={1.8} fill="url(#home-health)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          {isAdministrator && suggestions.length > 0 && (
            <div className="list-card mt-3">
              <div className="list-card__header">
                <div className="list-card__title"><Lightbulb className="h-3.5 w-3.5 text-[var(--warning)]" />智能建议</div>
              </div>
              <div className="space-y-2 p-3 pt-0">
                {suggestions.slice(0, 4).map((s: any) => (
                  <Link key={s.id} to={s.to} className="suggestion-item">
                    <div className="suggestion-item__icon suggestion-item__icon--info"><Lightbulb className="h-3.5 w-3.5" /></div>
                    <div className="suggestion-item__body">
                      <div className="suggestion-item__text">{s.text}</div>
                      <span className="suggestion-item__action">{s.action}<ArrowRight className="h-3 w-3" /></span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function InProgressTask({ t }: { t: Task }) {
  const slaSec = (t.slaRemainingMin ?? 60) * 60;
  const sla = useCountdown(slaSec);
  const pct = Math.round((t.progress.done / Math.max(1, t.progress.total)) * 100);
  const slaWarn = sla.raw < 60 * 60;
  const slaError = sla.raw < 30 * 60;
  return (
    <Link
      to={`/tasks?task=${encodeURIComponent(t.code)}`}
      className={cn(
        'task-list__item block transition-colors hover:border-[var(--brand)]',
        slaError ? 'task-tile--danger' : slaWarn ? 'task-tile--warning' : 'task-tile--success',
      )}
    >
      <div className="task-list__header">
        <span className="task-list__id">{t.code}</span>
        <Badge tone={t.priority === 'P0' ? 'error' : t.priority === 'P1' ? 'warn' : 'neutral'} className="text-[10px]">{t.priority}</Badge>
      </div>
      <div className="task-list__title">{t.title}</div>
      <div className="task-list__meta">
        <Avatar name={t.assignee ?? t.digitalEmployeeName ?? '?'} size={18} />
        {t.digitalEmployeeName && (
          <span className="task-list__meta-item"><Bot className="h-3 w-3 text-[var(--brand)]" />{t.digitalEmployeeName}</span>
        )}
        <span className={cn('task-list__meta-item ml-auto font-mono', slaError ? 'text-[var(--danger)]' : slaWarn ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]')}>
          <Clock className="h-3 w-3" />{sla.text}
        </span>
      </div>
      <div className="task-list__progress">
        <div className="task-list__progress-bar"><div className="task-list__progress-fill" style={{ width: `${pct}%` }} /></div>
        <div className="task-list__progress-text">{t.progress.done}/{t.progress.total} · {pct}%</div>
      </div>
    </Link>
  );
}
