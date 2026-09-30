import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ClipboardList, Gavel, History, MessagesSquare, Pause, Play, RotateCcw, ShieldCheck, UserRound } from 'lucide-react';
import type { ControlledTask, TaskAuditEvent, TaskLifecycleStage } from '@qzda/web-types';
import { Badge, Input } from '@qzda/web-ui';
import { useApiMutation, useApiQuery } from '@/services/query';
import { conversationHref, employeeLabel, getPrimaryAction, getStageMeta, nextStepLabel, riskLabel, sourceLabel, dispatchKindLabel, assistStatusLabel, normalizeControlledTask } from './task-ui';
import { roleCanMutate } from '@/features/role-nav/role-nav';
import { useAuthStore } from '@/stores/authStore';

type Tab = 'overview' | 'execution' | 'governance' | 'audit';
type Props = { task: ControlledTask; onPendingChange: (pending: boolean) => void };

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'execution', label: '执行' },
  { key: 'governance', label: '治理' },
  { key: 'audit', label: '审计' },
];

function time(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function TaskLifecycleDrawer({ task: summary, onPendingChange }: Props) {
  const user = useAuthStore((state) => state.user);
  const canMutate = roleCanMutate(user?.role);
  const isAdmin = user?.role === 'admin' && canMutate;
  const actor = user?.name ?? '当前用户';
  const [tab, setTab] = useState<Tab>(() => (canMutate ? 'overview' : 'audit'));
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState<'approve' | 'reject' | 'takeover' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const { data: remoteTask, error: taskError, refetch: refetchTask } = useApiQuery<ControlledTask>(['controlled-task', summary.id], `/api/tasks/${summary.id}`, undefined, { refetchInterval: 5_000 });
  const task = useMemo(() => normalizeControlledTask(remoteTask ?? summary), [remoteTask, summary]);
  const { data: auditRaw, error: auditError, refetch: refetchAudit } = useApiQuery<TaskAuditEvent[]>(['controlled-task-audit', summary.id], `/api/tasks/${summary.id}/audit`, undefined, { refetchInterval: 5_000 });
  const audit = auditRaw ?? task.auditEvents ?? [];
  const mutationOptions = {
    onError: (error: unknown) => {
      const msg = error instanceof Error ? error.message : '操作失败，请重试。';
      setActionError(msg.includes('版本冲突') || msg.includes('E_TASK_VERSION') ? '任务已被他人更新，请刷新后重试。' : msg);
      void refetchTask();
    },
  };
  const transition = useApiMutation<ControlledTask, { id: string; stage: TaskLifecycleStage; actor: string; version?: number }>(({ id }) => `/api/tasks/${id}/transition`, mutationOptions);
  const approve = useApiMutation<ControlledTask, { id: string; actor: string; approved: boolean; reason: string; version?: number }>(({ id }) => `/api/tasks/${id}/approve`, mutationOptions);
  const takeover = useApiMutation<ControlledTask, { id: string; actor: string; reason: string; version?: number }>(({ id }) => `/api/tasks/${id}/takeover`, mutationOptions);
  const retry = useApiMutation<ControlledTask, { id: string; actor: string; reason: string; version?: number }>(({ id }) => `/api/tasks/${id}/retry`, mutationOptions);
  const pending = transition.isPending || approve.isPending || takeover.isPending || retry.isPending;

  useEffect(() => onPendingChange(pending), [onPendingChange, pending]);
  useEffect(() => () => onPendingChange(false), [onPendingChange]);

  const primary = getPrimaryAction(task.lifecycleStage, task.sla.risk);
  const withVersion = <T extends Record<string, unknown>>(payload: T) => ({ ...payload, version: task.version });
  const requestRetry = (reason: string) => {
    const request = () => retry.mutate(withVersion({ id: task.id, actor, reason }));
    setRetryAction(() => request);
    request();
  };
  const requestTransition = (stage: TaskLifecycleStage) => {
    const request = () => transition.mutate(withVersion({ id: task.id, stage, actor }));
    setRetryAction(() => request);
    request();
  };
  const requestApproval = (approved: boolean, actionReason: string) => {
    const request = () => approve.mutate(withVersion({ id: task.id, actor, approved, reason: actionReason }));
    setRetryAction(() => request);
    request();
  };
  const requestTakeover = (actionReason: string) => {
    const request = () => takeover.mutate(withVersion({ id: task.id, actor, reason: actionReason }));
    setRetryAction(() => request);
    request();
  };
  const runPrimary = () => {
    if (!canMutate) return;
    setActionError(null);
    if (primary.key === 'retry') return requestRetry('请求重试协同');
    if (primary.key === 'takeover') return setConfirming('takeover');
    const stage: TaskLifecycleStage | null = primary.key === 'start' ? 'running' : primary.key === 'pause' ? 'human_action' : primary.key === 'archive' ? 'archived' : null;
    if (stage) requestTransition(stage);
  };
  const confirmAction = () => {
    if (!canMutate || !confirming || !reason.trim()) return;
    setActionError(null);
    if (confirming === 'takeover') requestTakeover(reason.trim());
    else requestApproval(confirming === 'approve', reason.trim());
    setConfirming(null);
    setReason('');
  };
  const auditEvents = useMemo(() => [...audit].sort((a, b) => b.at.localeCompare(a.at)), [audit]);
  const sessionHref = conversationHref(task);
  const stageTone = getStageMeta(task.lifecycleStage).tone;

  return <div className="task-lifecycle-drawer">
    <div className="task-drawer-toolbar">
      <div className="task-drawer-badges">
        <Badge tone={task.priority === 'P0' ? 'error' : task.priority === 'P1' ? 'warn' : 'neutral'}>{task.priority}</Badge>
        <Badge tone={stageTone}>{getStageMeta(task.lifecycleStage).label}</Badge>
      </div>
      {sessionHref && <a className="task-session-link" href={sessionHref}><MessagesSquare size={14} />打开关联会话</a>}
    </div>

    <nav className="task-drawer-tabs" aria-label="任务详情">
      {TABS.map((item) => (
        <button key={item.key} type="button" className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}>{item.label}</button>
      ))}
    </nav>

    <div className="task-drawer-scroll">
      {taskError && <QueryError message="无法加载任务详情" error={taskError} onRetry={() => refetchTask()} />}
      {auditError && <QueryError message="无法加载审计记录" error={auditError} onRetry={() => refetchAudit()} />}
      {actionError && <div className="task-drawer-error" role="alert"><AlertCircle size={15} />{actionError}<button type="button" onClick={() => retryAction?.()} disabled={pending || !retryAction}>重试</button></div>}
      {tab === 'overview' && <Overview task={task} />}
      {tab === 'execution' && <Execution task={task} />}
      {tab === 'governance' && <Governance task={task} pending={pending} canManage={isAdmin} canMutate={canMutate} onApprove={() => setConfirming('approve')} onReject={() => setConfirming('reject')} onTakeover={() => setConfirming('takeover')} onRetry={() => requestRetry('治理页请求重试')} />}
      {tab === 'audit' && <Audit events={auditEvents} />}
      {confirming && canMutate && <section className="task-confirm" aria-label="确认操作">
        <strong>{confirming === 'approve' ? '确认双重审批放行' : confirming === 'reject' ? '确认拒绝任务' : '确认专家接管'}</strong>
        <p>{confirming === 'reject' ? '拒绝原因会写入不可变审计记录。' : confirming === 'approve' ? '任务域放行将记入审计；高风险写操作仍以会话双重审批为准。' : '请填写接管原因，系统会记录操作者和时间。'}</p>
        <Input autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="请输入原因" />
        <div>
          <button type="button" className="task-saas-btn" disabled={pending} onClick={() => { setConfirming(null); setReason(''); }}>取消</button>
          <button type="button" className="task-saas-btn task-saas-btn--primary" disabled={pending || !reason.trim()} onClick={confirmAction}>{pending ? '提交中…' : '确认'}</button>
        </div>
      </section>}
    </div>

    {canMutate ? (
      <div className="task-drawer-primary">
        <button type="button" className="task-saas-btn task-saas-btn--primary" disabled={pending || primary.key === 'human_action'} onClick={runPrimary}>
          {primary.key === 'retry' && <RotateCcw size={15} />}
          {primary.key === 'start' && <Play size={15} />}
          {primary.key === 'pause' && <Pause size={15} />}
          {pending ? '处理中…' : primary.label}
        </button>
      </div>
    ) : (
      <div className="task-drawer-primary">
        <p className="task-governance-muted" style={{ margin: 0 }}>审计角色只读核查，不执行任务处置。</p>
      </div>
    )}
  </div>;
}

function QueryError({ message, error, onRetry }: { message: string; error: unknown; onRetry: () => void }) {
  return <div className="task-drawer-error" role="alert"><AlertCircle size={15} />{message}：{error instanceof Error ? error.message : '请求失败'}<button type="button" onClick={onRetry}>重试</button></div>;
}

function PropList({ rows }: { rows: [string, string][] }) {
  return <dl className="task-drawer-props">{rows.map(([label, value]) => <div key={label} className="task-drawer-prop"><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function Overview({ task }: { task: ControlledTask }) {
  const rows: [string, string][] = [
    ['当前阶段', getStageMeta(task.lifecycleStage).label],
    ['负责人', task.assignee ?? '未分派'],
    ['在岗专家', employeeLabel(task)],
    ['来源', sourceLabel(task.source)],
    ...(task.dispatchKind ? [
      ['调度方式', dispatchKindLabel(task.dispatchKind)] as [string, string],
      ['调度负责人', task.coordinatorName ?? task.coordinatorId ?? '—'] as [string, string],
      ['协办状态', assistStatusLabel(task.assistStatus)] as [string, string],
    ] : []),
    ...(task.collaboratorNames?.length ? [['协办专家', task.collaboratorNames.join('、')] as [string, string]] : []),
    ['关联会话', task.links?.conversationId ?? '无'],
    ['进度', `${task.progress?.done ?? 0}/${task.progress?.total ?? 1}`],
    ['SLA', task.sla?.remainingMin === undefined ? '未设 SLA' : task.sla.remainingMin < 0 ? `已超时 ${Math.abs(task.sla.remainingMin)} 分钟` : `剩余 ${task.sla.remainingMin} 分钟`],
    ['风险', riskLabel(task.sla?.risk ?? 'none')],
  ];
  return <section className="task-drawer-section">
    <div className="task-drawer-summary"><p>{task.description ?? '未提供任务描述。'}</p></div>
    <PropList rows={rows} />
  </section>;
}

function Execution({ task }: { task: ControlledTask }) {
  return <section className="task-drawer-section">
    <h3><ClipboardList size={15} />执行状态</h3>
    <PropList rows={[
      ['运行 ID', task.execution?.runId ?? '尚未启动'],
      ['当前步骤', nextStepLabel(task)],
      ['重试次数', String(task.execution?.retryCount ?? 0)],
      ['状态', task.execution?.paused ? '已暂停' : '执行可继续'],
    ]} />
    {task.execution?.error && <div className="task-execution-error"><AlertCircle size={16} /><span><strong>执行错误</strong>{task.execution.error}</span></div>}
  </section>;
}

function Governance({ task, pending, canManage, canMutate, onApprove, onReject, onTakeover, onRetry }: { task: ControlledTask; pending: boolean; canManage: boolean; canMutate: boolean; onApprove: () => void; onReject: () => void; onTakeover: () => void; onRetry: () => void }) {
  const approval = task.governance?.approvalStatus === 'pending' ? '待双重审批' : task.governance?.approvalStatus === 'approved' ? '已批准' : task.governance?.approvalStatus === 'rejected' ? '已拒绝' : '无需审批';
  return <section className="task-drawer-section">
    <h3><Gavel size={15} />治理控制</h3>
    <p className="task-governance-hint">高风险写操作以会话双重审批为准；此处为任务域放行与专家接管。</p>
    <PropList rows={[
      ['双重审批', `${approval}${task.governance?.approvalRequired ? '（必需）' : ''}`],
      ['策略', task.governance?.policyBlocked ? '策略拦截' : '策略允许'],
      ['专家接管', task.governance?.takeoverBy ? `${task.governance.takeoverBy}：${task.governance.takeoverReason ?? '未说明'}` : '未接管'],
    ]} />
    {!canMutate ? <p className="task-governance-muted">审计角色只读核查治理状态，不执行放行、接管或重试。</p> : canManage ? <>
      {task.governance?.approvalStatus === 'pending' && <div className="task-governance-actions">
        <button type="button" className="task-saas-btn task-saas-btn--primary" disabled={pending} onClick={onApprove}><ShieldCheck size={15} />{task.dispatchKind === 'assist' ? '接受协办' : '确认放行'}</button>
        <button type="button" className="task-saas-btn" disabled={pending} onClick={onReject}>{task.dispatchKind === 'assist' ? '拒绝协办' : '拒绝'}</button>
      </div>}
      {(task.sla?.risk === 'failed' || task.lifecycleStage === 'risk') && <div className="task-governance-actions">
        <button type="button" className="task-saas-btn" disabled={pending} onClick={onTakeover}><UserRound size={15} />专家接管</button>
        <button type="button" className="task-saas-btn task-saas-btn--primary" disabled={pending} onClick={onRetry}><RotateCcw size={15} />重试协同</button>
      </div>}
    </> : <p className="task-governance-muted">双重审批放行、专家接管与高风险重试由管理员处理。</p>}
  </section>;
}

function Audit({ events }: { events: TaskAuditEvent[] }) {
  return <section className="task-drawer-section">
    <h3><History size={15} />时间审计</h3>
    <ol className="task-audit-list">{events.map((event) => <li key={event.id}><Badge tone={event.tone === 'error' ? 'error' : event.tone === 'warn' ? 'warn' : event.tone === 'success' ? 'success' : 'neutral'}>{event.action}</Badge><span>{event.detail ?? '无附加说明'}</span><small>{time(event.at)} · {event.actor}</small></li>)}</ol>
    {events.length === 0 && <p className="task-governance-muted">暂无审计事件。</p>}
  </section>;
}
