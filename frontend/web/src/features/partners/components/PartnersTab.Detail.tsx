/**
 * 数字伙伴详情 + 运行处置：
 *
 *  - `ContextualEmployeeDetail` — 上岗发布（context='release'）/ 运行管理（context='operations'）详情。
 *  - `OperationsDisposeModal` — 暂停 / 隔离 / 恢复运行确认弹窗。
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DigitalPartner, DigitalPartnerConfigurationVersion, DigitalPartnerLifecycle } from '@qzda/web-types';
import { Badge, Button } from '@qzda/web-ui';
import { Modal } from '@/components/shared';
import { cn } from '@qzda/web-utils';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import {
  operationsHealth,
  releaseOnboardingCompleteness,
} from '@/features/partners/lib/partners';
import {
  formatApiError,
  lifecycleMeta,
  Metric,
  ModuleTab,
  releaseRequestedBySelf,
  EmployeeAvatar,
  riskMeta,
} from './PartnersShared';
import {
  CheckCircle2,
  ClipboardCheck,
  HeartPulse,
  MessageSquare,
  Pause,
  Play,
  Route,
  ShieldAlert,
} from 'lucide-react';

/** `ContextualEmployeeDetail` — 上岗发布 / 运行管理详情。 */
export function ContextualEmployeeDetail({ employee, context, onClose, onGoToModule, layout = 'modal' }: { employee: DigitalPartner; context: 'release' | 'operations'; onClose: () => void; onGoToModule?: (tab: ModuleTab) => void; layout?: 'modal' | 'inline' }) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const [message, setMessage] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [disposeLifecycle, setDisposeLifecycle] = useState<'paused' | 'quarantined' | 'active' | null>(null);

  const { data: evidence = [] } = useApiQuery<Array<{ id: string; time: string; actor: string; action: string; target: string; result: string }>>(['digital-employee', employee.id, 'evidence'], `/api/partners/${employee.id}/evidence`);
  const { data: configurationVersions = [] } = useApiQuery<DigitalPartnerConfigurationVersion[]>(
    ['digital-employee', employee.id, 'configuration-versions'],
    `/api/partners/${employee.id}/configuration-versions`,
    undefined,
    { enabled: context === 'release' },
  );

  const evaluate = useApiMutation<DigitalPartner, Record<string, never>>(() => `/api/partners/${employee.id}/evaluate`, {
    invalidateKeys: [['digital-employees'], ['digital-employee', employee.id]],
    onSuccess: (result) => setMessage(result.evaluation.status === 'passed' ? '评测已通过，可作为上岗门禁依据。' : '评测未通过，请按门禁缺失项补齐后复测。'),
    onError: (err) => setMessage(err instanceof Error ? err.message : '评测失败'),
  });
  const release = useApiMutation<DigitalPartner, Record<string, never>>(() => `/api/partners/${employee.id}/release`, {
    invalidateKeys: [['digital-employees'], ['digital-employee', employee.id]],
    onSuccess: () => setMessage('已完成上岗，员工可进入运行协作。'),
    onError: (err) => setMessage(err instanceof Error ? err.message : '上岗失败'),
  });
  const withdraw = useApiMutation<DigitalPartner, Record<string, never>>(() => `/api/partners/${employee.id}/release/withdraw`, {
    invalidateKeys: [['digital-employees'], ['digital-employee', employee.id]],
    onSuccess: () => setMessage('已撤回历史申请，可在补齐后重新申请上岗。'),
    onError: (err) => setMessage(err instanceof Error ? err.message : '撤回失败'),
  });
  const reject = useApiMutation<DigitalPartner, { reason: string }>(() => `/api/partners/${employee.id}/release/reject`, {
    invalidateKeys: [['digital-employees'], ['digital-employee', employee.id]],
    onSuccess: () => { setMessage('已驳回历史申请。'); setRejectReason(''); },
    onError: (err) => setMessage(err instanceof Error ? err.message : '驳回失败'),
  });
  const transition = useApiMutation<DigitalPartner, { lifecycle: DigitalPartnerLifecycle; reason?: string; confirmed?: boolean }>(() => `/api/partners/${employee.id}/lifecycle`, {
    invalidateKeys: [['digital-employees'], ['digital-employee', employee.id]],
    onSuccess: (_, input) => setMessage(input.lifecycle === 'active' ? (employee.release.status === 'pending_approval' ? '已确认上岗。' : '已恢复运行。') : input.lifecycle === 'paused' ? '已暂停员工运行。' : input.lifecycle === 'quarantined' ? '已隔离员工运行。' : '状态已更新。'),
    onError: (err) => setMessage(formatApiError(err, '状态变更失败')),
  });

  const meta = context === 'release' ? { title: '上岗发布详情', description: '集中处理质量评测与上岗门禁。' } : { title: '运行管理详情', description: '仅展示岗位服务健康、人工交接与运行处置；不可修改岗位或能力。' };
  const selfRequested = releaseRequestedBySelf(employee, user);
  const canConfirmRelease = employee.release.status === 'pending_approval' && (!selfRequested || isAdmin);
  const completeness = releaseOnboardingCompleteness(employee);
  const health = operationsHealth(employee);
  const releaseGate = completeness.gates;

  const releaseActions = (
    <>
      {employee.release.status === 'not_released' && employee.evaluation.status !== 'passed' && completeness.configReady && (
        <Button size="sm" variant="secondary" loading={evaluate.isPending} onClick={() => evaluate.mutate({})}><ClipboardCheck className="h-3.5 w-3.5" />{employee.evaluation.status === 'failed' ? '重新评测' : '执行评测'}</Button>
      )}
      {employee.release.status === 'not_released' && employee.evaluation.status !== 'passed' && !completeness.configReady && (
        <span className="text-[11px] text-[var(--text-muted)]">请先补齐岗位契约与能力装配</span>
      )}
      {employee.evaluation.status === 'passed' && employee.release.status === 'not_released' && (
        <Button size="sm" loading={release.isPending} onClick={() => release.mutate({})}><Route className="h-3.5 w-3.5" />申请上岗</Button>
      )}
      {canConfirmRelease && (
        <Button size="sm" loading={transition.isPending} onClick={() => transition.mutate({ lifecycle: 'active' })}><CheckCircle2 className="h-3.5 w-3.5" />确认上岗</Button>
      )}
      {employee.release.status === 'pending_approval' && selfRequested && !isAdmin && (
        <Button size="sm" variant="secondary" loading={withdraw.isPending} onClick={() => withdraw.mutate({})}>{employee.release.requestedBy ? '撤回申请' : '撤回'}</Button>
      )}
      {employee.release.status === 'pending_approval' && isAdmin && !selfRequested && (
        <Button size="sm" variant="secondary" loading={reject.isPending} onClick={() => reject.mutate({ reason: rejectReason || '未满足上岗门禁或需补充配置' })}>驳回</Button>
      )}
      {layout !== 'inline' && <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>}
    </>
  );

  const operationsActions = (
    <>
      {employee.lifecycle === 'active' && <Button size="sm" onClick={() => navigate(`/copilot?employeeId=${employee.id}`)}><MessageSquare className="h-3.5 w-3.5" />发起协作</Button>}
      {isAdmin && employee.lifecycle === 'active' && <Button size="sm" variant="secondary" onClick={() => setDisposeLifecycle('paused')}><Pause className="h-3.5 w-3.5" />暂停运行</Button>}
      {isAdmin && employee.lifecycle === 'active' && <Button size="sm" variant="secondary" onClick={() => setDisposeLifecycle('quarantined')}><ShieldAlert className="h-3.5 w-3.5" />隔离</Button>}
      {isAdmin && (employee.lifecycle === 'paused' || employee.lifecycle === 'quarantined') && employee.release.status === 'released' && <Button size="sm" onClick={() => setDisposeLifecycle('active')}><Play className="h-3.5 w-3.5" />恢复运行</Button>}
      <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
    </>
  );

  const panel = (
          <div className="space-y-5">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="flex min-w-0 items-center gap-3">
                <EmployeeAvatar employee={employee} size={54} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">{employee.role || employee.name}</h2>
                    <Badge tone={lifecycleMeta[employee.lifecycle].tone}>{lifecycleMeta[employee.lifecycle].label}</Badge>
                    <Badge tone={riskMeta[employee.risk].tone}>{riskMeta[employee.risk].label}</Badge>
                    {context === 'release' && <Badge tone={completeness.stage === 'ready_to_request' ? 'success' : completeness.stage === 'pending_eval' ? 'neutral' : 'warn'}>{completeness.label}</Badge>}
                    {context === 'operations' && <Badge tone={health.stage === 'stable' ? 'success' : health.stage === 'quarantined' ? 'error' : 'warn'}>{health.label}</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{employee.department} · 服务 {employee.serviceObject}</p>
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">岗位负责人 {employee.owner} · 人工接管 {employee.escalationOwner}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-7 gap-y-2 text-xs">
                <span><span className="block text-[11px] text-[var(--text-muted)]">运行环境</span><strong className="mt-0.5 block font-medium">{employee.environment === 'production' ? '生产环境' : employee.environment === 'staging' ? '预发环境' : '沙箱环境'}</strong></span>
                {context === 'release'
                  ? <span><span className="block text-[11px] text-[var(--text-muted)]">质量评测</span><strong className="mt-0.5 block font-medium">{employee.evaluation.status === 'failed' ? '未通过' : employee.evaluation.score ?? '待评测'}{employee.evaluation.score ? ' 分' : ''}{employee.evaluation.mock ? <span className="ml-1 rounded bg-[var(--warning-light)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--warning)]">演示</span> : null}</strong></span>
                  : <span><span className="block text-[11px] text-[var(--text-muted)]">人工接管</span><strong className="mt-0.5 block font-medium">{employee.escalationOwner || '待指定'}</strong></span>}
              </div>
            </div>
          </section>
          {message && <p role="status" className="rounded-lg border border-[var(--brand)]/25 bg-[var(--brand-light)] px-3 py-2 text-xs text-[var(--text-secondary)]">{message}</p>}
          {employee.release.rejectedReason && employee.release.status === 'not_released' && context === 'release' && (
            <p role="status" className="rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-light)] px-3 py-2 text-xs text-[var(--text-secondary)]">
              最近驳回：{employee.release.rejectedReason}{employee.release.rejectedBy ? ` · ${employee.release.rejectedBy}` : ''}
            </p>
          )}
          {context === 'release' && (
            <section className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold">质量与上岗门禁</h3>
                <p className="mt-1 text-xs text-[var(--text-muted)]">缺岗位契约、未完成能力装配或评测未过时不可上岗；三项均满足后即可申请上岗。</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {releaseGate.map((gate) => (
                  <div key={gate.key} className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">{gate.label}</span>
                      <Badge tone={gate.passed ? 'success' : 'warn'}>{gate.passed ? '已满足' : '待处理'}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-[var(--text-secondary)]">{gate.detail}</p>
                    {!gate.passed && gate.fixTab && onGoToModule && (
                      <button type="button" className="mt-2 text-[11px] font-medium text-[var(--brand)]" onClick={() => { if (layout !== 'inline') onClose(); onGoToModule(gate.fixTab!); }}>
                        前往{gate.fixTab === 'roleSetup' ? '岗位配置' : '能力装配'} →
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {employee.evaluation.status === 'failed' && (
                <div className="rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-light)] px-3 py-2.5 text-xs leading-5 text-[var(--text-secondary)]">
                  评测未通过{employee.evaluation.score ? `（${employee.evaluation.score} 分）` : ''}。
                  {!completeness.contractOk && ' 请先完善岗位契约。'}
                  {completeness.contractOk && !completeness.capabilityOk && ' 请先完成能力装配。'}
                  {completeness.configReady && ' 配置已齐，可直接复测。'}
                </div>
              )}
              {employee.release.status === 'pending_approval' && (
                <div className={cn(
                  'rounded-lg border px-3 py-2.5 text-xs leading-5',
                  selfRequested && !isAdmin ? 'border-[var(--info)]/30 bg-[var(--info-bg)] text-[var(--text-secondary)]' : 'border-[var(--success)]/30 bg-[var(--success-bg)] text-[var(--text-secondary)]',
                )}>
                  {selfRequested && !isAdmin
                    ? '生产上岗须由管理员确认；您是申请人，不能自批。可撤回申请后请管理员确认，或等待管理员处理。'
                    : selfRequested && isAdmin
                      ? '您是管理员，可直接确认上岗。'
                      : `待确认上岗${employee.release.requestedBy ? ` · 申请人 ${employee.release.requestedBy}` : ''}。请核对门禁后点击「确认上岗」。`}
                </div>
              )}
              {employee.release.status === 'pending_approval' && isAdmin && !selfRequested && (
                <label className="grid gap-1.5 text-xs font-medium">
                  驳回原因（可选）
                  <input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="例如：职责边界仍不完整，请补齐后重提" className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-xs font-normal outline-none focus:border-[var(--brand)]" />
                </label>
              )}
            </section>
          )}
          {context === 'operations' && (
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold">运行健康与处置</h3>
                <p className="mt-1 text-xs text-[var(--text-muted)]">仅提供业务运行观测和受控启停/隔离，不允许在运行场景修改岗位、能力或记忆策略。交接偏高阈值 ≥ 10 次 / 24h。</p>
              </div>
              <div className={cn('rounded-lg border p-3 text-xs leading-5', health.attention ? 'border-[var(--warning)]/40 bg-[var(--warning-light)] text-[var(--text-secondary)]' : 'border-[var(--success)]/30 bg-[var(--success-bg)] text-[var(--text-secondary)]')}>
                <HeartPulse className="mr-1 inline h-3.5 w-3.5" />
                {health.summary}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="24 小时调用" value={employee.runtime.calls24h} />
                <Metric label="成功率" value={employee.runtime.calls24h > 0 ? `${(employee.runtime.successRate * 100).toFixed(1)}%` : '—'} />
                <Metric label="P95 延迟" value={employee.runtime.p95Ms || '—'} sub={employee.runtime.p95Ms ? 'ms' : undefined} />
                <Metric label="今日成本" value={`¥${Number(employee.runtime.costToday || 0).toFixed(2)}`} />
                <Metric label="人工交接" value={employee.runtime.handoffs24h} sub="次" />
                <Metric label="异常信号" value={employee.runtime.anomalies} sub="项" />
              </div>
              {health.signals.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold">异常与关注项</h4>
                  {health.signals.map((signal) => (
                    <div key={signal.key} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{signal.label}</span>
                        <Badge tone={signal.severity === 'error' ? 'error' : signal.severity === 'warn' ? 'warn' : 'neutral'}>{signal.severity === 'error' ? '优先' : signal.severity === 'warn' ? '关注' : '状态'}</Badge>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-5 text-[var(--text-muted)]">{signal.detail}</p>
                    </div>
                  ))}
                </div>
              )}
              {employee.opsControl?.reason && (
                <p className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                  最近处置：{employee.opsControl.lastAction === 'paused' ? '暂停' : employee.opsControl.lastAction === 'quarantined' ? '隔离' : '恢复'}
                  · {employee.opsControl.reason}
                  {employee.opsControl.actor ? ` · ${employee.opsControl.actor}` : ''}
                </p>
              )}
            </section>
          )}
          {context === 'release' && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">上岗定版</h3>
              <p className="text-[11px] text-[var(--text-muted)]">中间步骤保存不进版本流；只有上岗提交才记录一次"配置版本"，作为运行期可回溯快照。</p>
              {configurationVersions.length
                ? (
                  <ul className="space-y-2">
                    {configurationVersions.slice(0, 5).map((version) => (
                      <li key={version.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <div className="font-medium">{version.version}</div>
                          <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{version.changeSummary}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge tone={version.status === 'current' ? 'success' : version.status === 'pending_approval' ? 'warn' : 'neutral'}>{version.status === 'current' ? '当前在岗' : version.status === 'pending_approval' ? '待审批' : '历史'}</Badge>
                          <span className="text-[10px] text-[var(--text-muted)]">{version.updatedBy} · {new Date(version.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
                : <p className="text-xs text-[var(--text-muted)]">暂无上岗定版记录。申请并确认上岗后将在此展示当前在岗版本。</p>}
            </section>
          )}
          <section className="space-y-3">
            {evidence.length
              ? evidence.map((event) => (
                <div key={event.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
                  <div className="text-sm font-medium">{event.action}</div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">{event.target}</div>
                  <div className="mt-1 text-[11px] text-[var(--text-muted)]">{event.actor} · {new Date(event.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</div>
                </div>
              ))
              : <p className="text-xs text-[var(--text-muted)]">暂无证据记录。</p>}
          </section>
        </div>
  );

  return (
    <>
      {layout === 'inline' ? (
        <div className="space-y-4">
          {panel}
          <div className="flex flex-wrap justify-end gap-2">{context === 'release' ? releaseActions : operationsActions}</div>
        </div>
      ) : (
        <Modal open onClose={onClose} title={`${meta.title} · ${employee.name}`} description={`${employee.department} · 岗位版本 ${employee.version} · ${meta.description}`} size="xl" footer={context === 'release' ? releaseActions : operationsActions}>
          {panel}
        </Modal>
      )}
      {disposeLifecycle && (
        <OperationsDisposeModal
          employee={employee}
          targetLifecycle={disposeLifecycle}
          loading={transition.isPending}
          onClose={() => setDisposeLifecycle(null)}
          onConfirm={(input) => {
            transition.mutate(
              { lifecycle: disposeLifecycle, reason: input.reason, confirmed: input.confirmed },
              { onSuccess: () => setDisposeLifecycle(null) },
            );
          }}
        />
      )}
    </>
  );
}

/** `OperationsDisposeModal` — 暂停 / 隔离 / 恢复运行确认弹窗。 */
export function OperationsDisposeModal({ employee, targetLifecycle, loading, onClose, onConfirm }: { employee: DigitalPartner; targetLifecycle: 'paused' | 'quarantined' | 'active'; loading: boolean; onClose: () => void; onConfirm: (input: { reason: string; confirmed: boolean }) => void }) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const meta = {
    paused: { title: '暂停运行', tone: 'warn' as const, summary: '暂停后不再响应业务请求；恢复运行前请确认处置完成。' },
    quarantined: { title: '隔离运行', tone: 'error' as const, summary: '隔离视为事故处置动作；恢复前必须保留审计证据并由管理员复核。' },
    active: { title: '恢复运行', tone: 'success' as const, summary: '恢复后重新纳入服务路由；如问题未处置，建议先执行质量评测。' },
  }[targetLifecycle];
  return (
    <Modal open onClose={onClose} title={`${meta.title} · ${employee.name}`} description="处置动作会写入审计证据；高风险动作须二次确认。" size="md" footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button variant={meta.tone === 'error' ? 'danger' : 'secondary'} loading={loading} disabled={!confirmed || !reason.trim()} onClick={() => onConfirm({ reason, confirmed })}>{meta.title}</Button></>}>
      <div className="space-y-4">
        <p className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-light)] px-3 py-2.5 text-xs leading-5 text-[var(--text-secondary)]">{meta.summary}</p>
        <label className="grid gap-1.5 text-xs font-medium">处置原因（必填）<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="例如：监测到生产环境异常交接偏高 12 次 / 24h" className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-normal outline-none focus:border-[var(--brand)]" /></label>
        <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我已确认处置依据并知悉处置动作将记入审计证据。</label>
      </div>
    </Modal>
  );
}
