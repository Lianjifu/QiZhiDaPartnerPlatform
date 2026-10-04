/** M01 运营总览 — 首页 shell。809L Home.tsx → 8 个子组件 + 本 layout shell。
 *  负责：数据拉取、KPI/records/dayEvents 派生计算、三角色分支、日历周期 + 选中日 + tab 状态、管理员告警确认按钮。
 *  子组件：KpiTiles / PartnerSpotlight / FunctionalRail / AttentionPanel / RoiPanel / WorkRecordCalendar / PerDayDrillTable / RunDetailsSection / RoleReadonlyBanner。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@qzda/web-ui';
import {
  Activity, Bot, BookOpen, Check, CheckCircle2, HeartPulse, ListChecks,
  MessageSquare, Plus, RefreshCw, ShieldCheck, Target, TrendingUp, Users,
} from 'lucide-react';
import { cn } from '@qzda/web-utils';
import { PageSkeleton } from '@/components/PageSkeleton';
import { useAuthStore } from '@/stores/authStore';
import { roleCanMutate, rolePageCopy } from '@/features/role-nav/role-nav';
import { employeeHealthScore, taskSuccessRate, toDateKey } from './lib/home-metrics';
import { useHomeLiveData } from './hooks/useHomeLiveData';
import { useAcknowledgeAlert } from './hooks/useAcknowledgeAlert';
import { KpiTiles, type Kpi } from './components/KpiTiles';
import { PartnerSpotlight } from './components/PartnerSpotlight';
import { FunctionalRail, type ModuleEntry } from './components/FunctionalRail';
import { AttentionPanel, type PendingItem } from './components/AttentionPanel';
import { RoiPanel } from './components/RoiPanel';
import { WorkRecordCalendar, type DayScheduleEvent, type SelectDateOptions, type WorkRecordPeriod } from './components/WorkRecordCalendar';
import { PerDayDrillTable, type WorkRecord } from './components/PerDayDrillTable';
import { RunDetailsSection } from './components/RunDetailsSection';
import { RoleReadonlyBanner } from './components/RoleReadonlyBanner';

type RecordTab = 'all' | 'attention' | 'done';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return '凌晨好';
  if (h < 12) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function formatWhen(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const AUDITOR_SUGGESTION_PREFIXES = ['/audit-center', '/zero-trust', '/tasks', '/copilot', '/partners', '/workflows', '/knowledge', '/skills', '/memory', '/home'];

export default function HomePage() {
  const navigate = useNavigate();
  const greeting = getGreeting();
  const { user } = useAuthStore();
  const isAdministrator = user?.role === 'admin';
  const isAuditor = user?.role === 'auditor';
  const canMutate = roleCanMutate(user?.role);
  const homeCopy = rolePageCopy('home', user?.role);

  const { extra, employees, tasks, ops } = useHomeLiveData();
  const lTasks = tasks.isLoading;
  const lExtra = extra.isLoading;
  const lEmployees = employees.isLoading;
  const fetchingExtra = extra.isFetching;
  const refetchExtra = extra.refetch;

  const acknowledgeAlert = useAcknowledgeAlert();

  const allTasks = tasks.data ?? [];
  const extraData = extra.data as Record<string, any> | undefined;
  const employeesData = employees.data ?? [];

  const [period, setPeriod] = useState<WorkRecordPeriod>('day');
  const [recordTab, setRecordTab] = useState<RecordTab>('all');
  const [selectedDateKey, setSelectedDateKey] = useState(() => toDateKey(new Date()));
  const handleSelectDate = useCallback((dateKey: string, options?: SelectDateOptions) => {
    setSelectedDateKey(dateKey);
    if (options?.drillToDay) setPeriod('day');
  }, []);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [runtimeOpen, setRuntimeOpen] = useState(false);

  const allTaskList = allTasks;
  const inProgress = allTaskList.filter((t) => t.status === 'in_progress');
  const completed = allTaskList.filter((t) => t.status === 'completed');
  const review = allTaskList.filter((t) => t.status === 'review' || t.status === 'pending');

  const activeEmployees = useMemo(
    () => employeesData.filter((e) => e.lifecycle === 'active' || e.release?.status === 'released'),
    [employeesData],
  );
  const activeAgents = activeEmployees.length;
  const agentCount = employeesData.length;
  const healthScore = employeeHealthScore(activeAgents, agentCount);
  const taskTotal = allTaskList.length;
  const successRate = taskSuccessRate(completed.length, taskTotal);

  const visibleAlerts = ((extraData?.slaAlerts ?? []) as Array<{ id: string; acknowledged?: boolean; text: string; taskCode?: string; level?: string; assignee?: string; time?: string; source?: string }>).filter((a) => !a.acknowledged);
  const unreadNotifications = ((extraData?.notifications ?? []) as Array<{ unread?: boolean; id: string; text: string }>).filter((n) => n.unread && !readIds.has(n.id));
  const opsData = ops.data as Record<string, any> | undefined;
  const pendingItems: PendingItem[] = useMemo(() => {
    const fromOps = (opsData?.pending ?? []) as Array<{ id: string; title?: string; to?: string }>;
    if (fromOps.length) {
      return fromOps.map((item) => ({ id: item.id, title: item.title ?? item.id, to: item.to || '/tasks?risk=attention' }));
    }
    const fromAlerts = visibleAlerts.map((a) => ({ id: `alert-${a.id}`, title: a.text, to: `/tasks?task=${encodeURIComponent(a.taskCode ?? '')}&risk=attention` }));
    const fromReview = review.slice(0, 5).map((t) => ({ id: `task-${t.id}`, title: t.title, to: `/tasks?task=${encodeURIComponent(t.code)}` }));
    return [...fromAlerts, ...fromReview].slice(0, 6);
  }, [opsData?.pending, visibleAlerts, review]);

  const costSource = String(extraData?.costMonth?.source ?? '');
  const costUsed = costSource === 'usage-meters' ? Number(extraData?.costMonth?.used ?? 0) : 0;
  const costBudget = costSource === 'usage-meters' ? Number(extraData?.costMonth?.budget ?? 0) : 0;
  const costPct = costBudget > 0 ? Math.min(100, (costUsed / costBudget) * 100) : 0;
  const healthData = ((extraData?.operationalMetrics?.trend24h ?? []) as Array<{ time: string; tasks?: number; collab?: number; alerts?: number }>);
  const attentionCount = visibleAlerts.length + review.length;
  const todayCollab = Number(extraData?.operationalMetrics?.collabToday ?? 0);
  const tc = { done: completed.length, doing: inProgress.length, review: review.length, todo: allTaskList.filter((t) => t.status === 'pending').length };

  const featuredPool = useMemo(() => {
    const pool = activeEmployees.length ? activeEmployees : employeesData;
    return pool.slice(0, 4);
  }, [activeEmployees, employeesData]);
  const featured = featuredPool[0] ?? null;
  const featureStats = useMemo(() => {
    if (!featured) return { knowledge: 0, skills: 0, workflows: 0 };
    return {
      knowledge: featured.capabilities?.knowledge?.length ?? 0,
      skills: (featured.capabilities?.skills?.length ?? 0) + (featured.capabilities?.tools?.length ?? 0),
      workflows: featured.capabilities?.workflows?.length ?? 0,
    };
  }, [featured]);

  const modules: ModuleEntry[] = isAuditor
    ? [
        { title: '审计中心', desc: '证据流水与导出', to: '/audit-center', icon: ShieldCheck, tone: 'brand' },
        { title: '持续验证', desc: '策略与临时授权', to: '/zero-trust', icon: Activity, tone: 'info' },
        { title: '任务核查', desc: '放行与交接证据', to: '/tasks', icon: ListChecks, tone: 'warn' },
        { title: '协作记录', desc: '研判与人工审核', to: '/copilot', icon: MessageSquare, tone: 'success' },
      ]
    : [
        { title: '数字伙伴', desc: '岗位与能力装配', to: '/partners', icon: Bot, tone: 'brand' },
        { title: '专家协作', desc: '研判与受控执行', to: '/copilot', icon: MessageSquare, tone: 'info' },
        { title: '知识中心', desc: '知识包与内容交付', to: '/knowledge', icon: BookOpen, tone: 'success' },
        { title: '任务 SLA', desc: '派工与处置闭环', to: '/tasks', icon: ListChecks, tone: 'warn' },
      ];

  const kpis: Kpi[] = [
    { key: 'agents', label: '在岗专家', value: activeAgents, sub: agentCount ? `/ ${agentCount}` : undefined, icon: Users, tone: 'brand', to: '/partners' },
    { key: 'doing', label: '进行中', value: inProgress.length, icon: Activity, tone: 'info', to: '/tasks?status=in_progress' },
    { key: 'attention', label: '需关注', value: attentionCount, icon: Target, tone: attentionCount > 0 ? 'warn' : 'neutral', to: '/tasks?risk=attention' },
    { key: 'done', label: '已完成', value: completed.length, icon: CheckCircle2, tone: 'success', to: '/tasks?status=completed' },
    { key: 'success', label: '成功率', value: successRate == null ? '—' : `${successRate}%`, icon: TrendingUp, tone: 'success', to: '/tasks' },
    { key: 'health', label: '健康度', value: healthScore ?? '—', icon: HeartPulse, tone: 'info', to: '/partners?tab=operations' },
  ];

  const calendarSource = useMemo(() => ({
    tasks: allTaskList.map((t) => ({ updatedAt: t.updatedAt, createdAt: t.createdAt })),
    alerts: visibleAlerts.map((a) => ({ time: a.time })),
    todayCollab,
    trend: healthData,
  }), [allTaskList, visibleAlerts, todayCollab, healthData]);

  const dayEvents: DayScheduleEvent[] = useMemo(() => {
    const out: DayScheduleEvent[] = [];
    for (const t of allTaskList) {
      const raw = t.updatedAt ?? t.createdAt;
      const ts = Date.parse(raw);
      if (!Number.isFinite(ts)) continue;
      const d = new Date(ts);
      const done = t.status === 'completed';
      const attention = (t.slaRemainingMin ?? 999) < 60 || t.priority === 'P0' || t.status === 'review';
      out.push({
        id: `task-${t.id}`, kind: 'task', title: t.title, subtitle: t.digitalPartnerName ?? t.assignee,
        hour: d.getHours(), minute: d.getMinutes(), dateKey: toDateKey(d),
        to: `/tasks?task=${encodeURIComponent(t.code)}`, tone: done ? 'success' : attention ? 'error' : 'info',
      });
    }
    for (const alert of visibleAlerts) {
      const ts = Date.parse(String(alert.time ?? ''));
      if (!Number.isFinite(ts)) continue;
      const d = new Date(ts);
      out.push({
        id: `alert-${alert.id}`, kind: 'alert', title: alert.text, subtitle: alert.assignee ?? alert.taskCode,
        hour: d.getHours(), minute: d.getMinutes(), dateKey: toDateKey(d),
        to: `/tasks?task=${encodeURIComponent(alert.taskCode ?? '')}&risk=attention`, tone: alert.level === 'P0' ? 'error' : 'warn',
      });
    }
    if (todayCollab > 0) {
      const now = new Date();
      out.push({
        id: 'collab-today', kind: 'collab', title: `今日协作 ${todayCollab} 次`, subtitle: '专家协作会话',
        hour: now.getHours(), minute: 0, dateKey: toDateKey(now), to: '/copilot', tone: 'info',
      });
    }
    return out;
  }, [allTaskList, visibleAlerts, todayCollab]);

  useEffect(() => {
    if (period !== 'day' || dayEvents.length === 0) return;
    if (dayEvents.some((e) => e.dateKey === selectedDateKey)) return;
    if (selectedDateKey !== toDateKey(new Date())) return;
    const latest = [...dayEvents].sort((a, b) => `${b.dateKey}T${String(b.hour).padStart(2, '0')}`.localeCompare(`${a.dateKey}T${String(a.hour).padStart(2, '0')}`))[0];
    if (latest) setSelectedDateKey(latest.dateKey);
  }, [period, dayEvents, selectedDateKey]);

  const records = useMemo<WorkRecord[]>(() => {
    const out: WorkRecord[] = [];
    for (const t of allTaskList.slice(0, 24)) {
      const done = t.status === 'completed';
      const attention = (t.slaRemainingMin ?? 999) < 60 || t.priority === 'P0' || t.status === 'review';
      const raw = t.updatedAt ?? t.createdAt;
      const ts = Date.parse(raw);
      out.push({
        id: `task-${t.id}`, title: t.title,
        status: done ? '已完成' : attention ? '需关注' : t.status === 'in_progress' ? '进行中' : '待处理',
        statusTone: done ? 'success' : attention ? 'error' : t.status === 'in_progress' ? 'info' : 'neutral',
        attribution: t.digitalPartnerName ?? t.assignee ?? '—',
        time: formatWhen(raw),
        dateKey: Number.isFinite(ts) ? toDateKey(new Date(ts)) : undefined,
        to: `/tasks?task=${encodeURIComponent(t.code)}`, kind: 'task',
      });
    }
    for (const alert of visibleAlerts.slice(0, 12)) {
      const ts = Date.parse(String(alert.time ?? ''));
      out.push({
        id: `alert-${alert.id}`, title: alert.text, status: alert.level ?? '告警',
        statusTone: alert.level === 'P0' ? 'error' : 'warn',
        attribution: alert.assignee ?? alert.taskCode,
        time: formatWhen(alert.time) === '—' ? (alert.time ?? '—') : formatWhen(alert.time),
        dateKey: Number.isFinite(ts) ? toDateKey(new Date(ts)) : undefined,
        to: `/tasks?task=${encodeURIComponent(alert.taskCode ?? '')}&risk=attention`, kind: 'alert',
      });
    }
    return out;
  }, [allTaskList, visibleAlerts]);

  const filteredRecords = records.filter((r) => {
    if (r.dateKey && r.dateKey !== selectedDateKey) return false;
    if (recordTab === 'attention') return r.statusTone === 'error' || r.statusTone === 'warn';
    if (recordTab === 'done') return r.statusTone === 'success';
    return true;
  });

  const periodDateLabel = useMemo(() => {
    const d = new Date(`${selectedDateKey}T12:00:00`);
    if (Number.isNaN(d.getTime())) return new Date().toLocaleDateString('zh-CN');
    if (period === 'month') return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
    if (period === 'week') return `${d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 所在周`;
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' });
  }, [period, selectedDateKey]);

  const suggestions = ((extraData?.suggestion ?? []) as Array<{ id: string; to?: string; text: string; action: string; tone?: string }>).filter((s) => {
    if (!isAuditor) return true;
    const to = s.to ?? '';
    return AUDITOR_SUGGESTION_PREFIXES.some((prefix) => to === prefix || to.startsWith(`${prefix}?`) || to.startsWith(`${prefix}/`));
  });

  const handleMarkAllRead = useCallback(() => {
    setReadIds(new Set(((extraData?.notifications ?? []) as Array<{ id: string }>).map((n) => n.id)));
  }, [extraData]);

  if ((lTasks || lExtra || lEmployees) && tasks.data === undefined && extra.data === undefined && employees.data?.length === 0) {
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
          <button type="button" className="home-icon-btn" onClick={() => refetchExtra()} disabled={fetchingExtra} aria-label="刷新数据">
            <RefreshCw className={cn('h-3.5 w-3.5', fetchingExtra && 'animate-spin')} />
          </button>
          {isAuditor ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => navigate('/tasks')}><ListChecks className="h-3.5 w-3.5" />任务核查</Button>
              <Button size="sm" onClick={() => navigate('/audit-center')}><ShieldCheck className="h-3.5 w-3.5" />审计中心</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => navigate('/tasks')}><Plus className="h-3.5 w-3.5" />{user?.role === 'user' ? '我的待办' : '创建任务'}</Button>
              <Button size="sm" onClick={() => navigate('/copilot')}><MessageSquare className="h-3.5 w-3.5" />开始协作</Button>
            </>
          )}
        </div>
      </header>

      <RoleReadonlyBanner />

      <KpiTiles kpis={kpis} onNavigate={navigate} />

      <div className="home-desk">
        <div className="home-desk__main">
          <PartnerSpotlight
            featured={featured}
            featuredPool={featuredPool}
            totalEmployees={employeesData}
            isAuditor={isAuditor}
            featureStats={featureStats}
            onNavigate={navigate}
          />
          <FunctionalRail modules={modules} />
          <section className="home-mid">
            <AttentionPanel
              isAdministrator={isAdministrator}
              attentionCount={attentionCount}
              unreadNotifications={unreadNotifications}
              pendingItems={pendingItems}
              onMarkAllRead={handleMarkAllRead}
            />
            <RoiPanel
              costSource={costSource}
              costUsed={costUsed}
              costBudget={costBudget}
              costPct={costPct}
              tc={tc}
              successRate={successRate}
              healthScore={healthScore}
            />
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
            <button type="button" className="home-records__metric" onClick={() => navigate('/copilot')}><span>今日协作</span><strong>{todayCollab}</strong></button>
            <button type="button" className="home-records__metric" onClick={() => navigate('/tasks')}><span>任务总量</span><strong>{allTaskList.length}</strong></button>
            <button type="button" className="home-records__metric home-records__metric--good" onClick={() => setRecordTab('done')}><span>已完成</span><strong>{completed.length || tc.done}</strong></button>
            <button type="button" className="home-records__metric home-records__metric--bad" onClick={() => setRecordTab('attention')}><span>需关注</span><strong>{attentionCount}</strong></button>
          </div>

          <div className="home-records__period">
            <div className="home-segment" role="tablist" aria-label="时间范围">
              {([['day', '日'], ['week', '周'], ['month', '月']] as const).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={period === key}
                  className={cn('home-segment__item', period === key && 'is-active')}
                  onClick={() => setPeriod(key)}>{label}</button>
              ))}
            </div>
            <span className="home-records__date">{periodDateLabel}</span>
          </div>

          <WorkRecordCalendar period={period} source={calendarSource as never} selectedDateKey={selectedDateKey} onSelectDate={handleSelectDate} dayEvents={dayEvents} />

          <div className="home-segment home-records__tabs" role="tablist">
            {([['all', '全部'], ['attention', '需关注'], ['done', '已完成']] as const).map(([key, label]) => (
              <button key={key} type="button" role="tab"
                className={cn('home-segment__item', recordTab === key && 'is-active')}
                onClick={() => setRecordTab(key)}>{label}</button>
            ))}
          </div>

          <PerDayDrillTable filteredRecords={filteredRecords} />

          {canMutate && isAdministrator && visibleAlerts.some((a) => a.source !== 'task' && a.level !== 'P0') && (
            <div className="home-records__foot">
              <button type="button" className="home-link" disabled={acknowledgeAlert.isPending}
                onClick={() => {
                  const first = visibleAlerts.find((a) => a.level !== 'P0');
                  if (first) acknowledgeAlert.mutate({ alertId: first.id });
                }}>
                <Check className="h-3 w-3" />确认下一条非 P0 告警
              </button>
            </div>
          )}
        </aside>
      </div>

      <RunDetailsSection
        isAdministrator={isAdministrator}
        inProgress={inProgress}
        suggestions={suggestions}
        healthData={healthData as never}
        runtimeOpen={runtimeOpen}
        onToggleRuntime={setRuntimeOpen}
      />
    </div>
  );
}
