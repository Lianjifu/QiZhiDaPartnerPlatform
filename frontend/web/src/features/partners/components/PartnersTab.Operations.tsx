/**
 * 数字伙伴运行管理 Tab：
 *
 *  - `OperationsView` — 在岗健康分段列表 + 受控启停/隔离
 *  - `OperationsListRow` — 单行展示（24h 运行指标 + 健康状态 + 处置动作）
 *  - `OperationsMetric` — 运行指标小卡
 *  - `OperationsDisposeModal` — 暂停 / 隔离 / 恢复运行确认弹窗
 */
import { useEffect, useMemo, useState } from 'react';
import type { DigitalPartner, DigitalPartnerLifecycle } from '@qzda/web-types';
import { Badge, Button, KpiCard } from '@qzda/web-ui';
import { Modal } from '@/components/shared';
import { cn } from '@qzda/web-utils';
import { useApiMutation } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { roleCanMutate } from '@/features/role-nav/role-nav';
import { compareOperationsEmployees, employeePrimaryLabel, employeeSecondaryLabel, isDepartmentHead, OPERATIONS_HANDOFF_THRESHOLD, operationsHealth, type OperationsHealthStage } from '@/features/partners/lib/partners';
import {
  CATALOG_PAGE_SIZE_OPTIONS,
  EmployeeAvatar,
  EmptyState,
  lifecycleMeta,
} from './PartnersShared';
import {
  ChevronLeft,
  ChevronRight,
  HeartPulse,
  Pause,
  ShieldAlert,
  UserRoundCheck,
} from 'lucide-react';

const OPERATIONS_PAGE_SIZE_KEY = 'de.operations.pageSize';
const OPERATIONS_DEFAULT_PAGE_SIZE = 8;

function readStoredPageSize(key: string, fallback: number) {
  if (typeof window === 'undefined') return fallback;
  const raw = Number(window.localStorage.getItem(key));
  return (CATALOG_PAGE_SIZE_OPTIONS as readonly number[]).includes(raw) ? raw : fallback;
}

function readOperationsPageSize() {
  return readStoredPageSize(OPERATIONS_PAGE_SIZE_KEY, OPERATIONS_DEFAULT_PAGE_SIZE);
}

export function OperationsView({ employees, onSelect }: { employees: DigitalPartner[]; onSelect: (id: string) => void }) {
  type OpsSegment = 'all' | OperationsHealthStage;
  const [segment, setSegment] = useState<OpsSegment>('needs_attention');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(readOperationsPageSize);
  const [dispose, setDispose] = useState<{ employee: DigitalPartner; lifecycle: 'paused' | 'quarantined' | 'active' } | null>(null);
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const transition = useApiMutation<DigitalPartner, { id: string; lifecycle: DigitalPartnerLifecycle; reason?: string; confirmed?: boolean }>(({ id }) => `/api/partners/${id}/lifecycle`);

  const queue = useMemo(
    () => employees.filter((item) => ['active', 'paused', 'quarantined'].includes(item.lifecycle)).sort(compareOperationsEmployees),
    [employees],
  );

  const counts = useMemo(() => {
    const next = { all: queue.length, needs_attention: 0, high_handoff: 0, paused: 0, quarantined: 0, stable: 0 };
    for (const item of queue) next[operationsHealth(item).stage] += 1;
    return next;
  }, [queue]);

  const segments: Array<{ key: OpsSegment; label: string }> = [
    { key: 'all', label: '全部在岗' },
    { key: 'needs_attention', label: '需处置异常' },
    { key: 'high_handoff', label: '交接偏高' },
    { key: 'paused', label: '已暂停' },
    { key: 'quarantined', label: '已隔离' },
    { key: 'stable', label: '运行稳定' },
  ];

  const filtered = useMemo(
    () => (segment === 'all' ? queue : queue.filter((item) => operationsHealth(item).stage === segment)),
    [queue, segment],
  );

  useEffect(() => { setPage(1); }, [segment, pageSize, employees]);
  useEffect(() => { window.localStorage.setItem(OPERATIONS_PAGE_SIZE_KEY, String(pageSize)); }, [pageSize]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, pageCount);
  const pageItems = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const controlledCount = counts.paused + counts.quarantined;

  return (
    <div className="space-y-3">
      <div className="de-employee-hint rounded-xl px-4 py-3 text-xs leading-5 text-[var(--text-secondary)]">
        运行管理只做在岗健康观测与受控启停/隔离。岗位档案、能力引用请进入专家详情，或从「继续配置」进入分步向导。交接偏高阈值：≥ {OPERATIONS_HANDOFF_THRESHOLD} 次 / 24h。
      </div>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button type="button" className="text-left" onClick={() => setSegment('all')} aria-pressed={segment === 'all'}>
          <KpiCard label="在岗运行" value={counts.stable + counts.needs_attention + counts.high_handoff} sub="个" icon={HeartPulse} tone="success" size="comfortable" />
        </button>
        <button type="button" className="text-left" onClick={() => setSegment('needs_attention')} aria-pressed={segment === 'needs_attention'}>
          <KpiCard label="需处置异常" value={counts.needs_attention} sub="个" icon={ShieldAlert} tone={counts.needs_attention ? 'warn' : 'success'} size="comfortable" />
        </button>
        <button type="button" className="text-left" onClick={() => setSegment('high_handoff')} aria-pressed={segment === 'high_handoff'}>
          <KpiCard label="交接偏高" value={counts.high_handoff} sub="个" icon={UserRoundCheck} tone={counts.high_handoff ? 'warn' : 'success'} size="comfortable" />
        </button>
        <button type="button" className="text-left" onClick={() => setSegment(counts.quarantined ? 'quarantined' : 'paused')} aria-pressed={segment === 'paused' || segment === 'quarantined'}>
          <KpiCard label="暂停 / 隔离" value={controlledCount} sub="个" icon={Pause} tone={controlledCount ? 'warn' : 'success'} size="comfortable" />
        </button>
      </section>

      <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 py-4" style={{ boxShadow: 'var(--saas-divider)' }}>
          <div>
            <h2 className="text-sm font-semibold">运行管理</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">按「需处置 → 交接偏高 → 暂停/隔离 → 稳定」优先；行内展示运行指标，处置动作与详情分离。</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              每页
              <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="de-employee-input h-8 rounded-lg bg-[var(--bg)] px-2 text-xs text-[var(--text-secondary)]" aria-label="运行管理每页数量">
                {CATALOG_PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} 个</option>)}
              </select>
            </label>
            <span className="text-xs text-[var(--text-muted)]">{filtered.length} 个专家</span>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto px-4 py-2.5" style={{ boxShadow: 'var(--saas-divider)' }} role="tablist" aria-label="运行健康阶段">
          {segments.map((item) => (
            <button
              type="button"
              key={item.key}
              role="tab"
              aria-selected={segment === item.key}
              onClick={() => setSegment(item.key)}
              className={cn('de-employee-chip shrink-0 rounded-md px-3 py-1.5 text-xs transition-colors', segment === item.key && 'is-active')}
            >
              {item.label}
              <span className="ml-1.5 tabular-nums text-[10px] opacity-70">{counts[item.key]}</span>
            </button>
          ))}
        </div>

        {pageItems.length ? (
          <>
            <div className="hidden border-b border-[var(--border)] bg-[var(--bg-elevated)] px-5 py-2 text-[11px] font-medium text-[var(--text-muted)] lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,0.95fr)_auto] lg:gap-4">
              <span>在岗专家</span>
              <span>近 24h 运行</span>
              <span>健康状态</span>
              <span className="text-right">操作</span>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {pageItems.map((employee) => (
                <OperationsListRow
                  key={employee.id}
                  employee={employee}
                  isAdmin={isAdmin}
                  onSelect={() => onSelect(employee.id)}
                  onDispose={(lifecycle) => setDispose({ employee, lifecycle })}
                />
              ))}
            </div>
            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-3 px-5 py-3" style={{ boxShadow: 'inset 0 1px 0 rgba(15,23,42,0.06)' }}>
                <span className="text-[11px] text-[var(--text-muted)]">第 {pageSafe} / {pageCount} 页 · 每页 {pageSize} 个</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" disabled={pageSafe <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-3.5 w-3.5" />上一页</Button>
                  <Button size="sm" variant="secondary" disabled={pageSafe >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>下一页<ChevronRight className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <EmptyState icon={HeartPulse} title={segment === 'all' ? '完成上岗后，在岗专家会出现在此' : '当前分段暂无在岗专家'} />
        )}
      </section>

      {dispose && (
        <OperationsDisposeModal
          employee={dispose.employee}
          targetLifecycle={dispose.lifecycle}
          loading={transition.isPending}
          onClose={() => setDispose(null)}
          onConfirm={(input) => {
            transition.mutate(
              { id: dispose.employee.id, lifecycle: dispose.lifecycle, reason: input.reason, confirmed: input.confirmed },
              { onSuccess: () => setDispose(null) },
            );
          }}
        />
      )}
    </div>
  );
}

function OperationsListRow({ employee, isAdmin, onSelect, onDispose }: { employee: DigitalPartner; isAdmin: boolean; onSelect: () => void; onDispose: (lifecycle: 'paused' | 'quarantined' | 'active') => void }) {
  const health = operationsHealth(employee);
  const tone = health.stage === 'stable' ? 'success' : health.stage === 'quarantined' ? 'error' : 'warn';
  const signalHint = health.signals[0]?.label ?? (health.missing[0] ?? '指标正常');
  return (
    <article
      className={cn(
        'grid gap-3 px-5 py-4 transition-colors hover:bg-[var(--bg-hover)] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,0.95fr)_auto] lg:items-center lg:gap-4',
        health.attention && 'bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]',
      )}
    >
      <button type="button" onClick={onSelect} className="flex min-w-0 items-center gap-3 text-left">
        <EmployeeAvatar employee={employee} size={40} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-[var(--text)]">{employeePrimaryLabel(employee)}</span>
            {isDepartmentHead(employee) && <Badge tone="info">部门负责人</Badge>}
            <Badge tone={lifecycleMeta[employee.lifecycle].tone}>{lifecycleMeta[employee.lifecycle].label}</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{employeeSecondaryLabel(employee)}</p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">接管 {employee.escalationOwner || '待指定'}</p>
        </div>
      </button>

      <div className="grid grid-cols-4 gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2">
        <OperationsMetric label="调用" value={employee.runtime.calls24h} />
        <OperationsMetric label="成功率" value={employee.runtime.calls24h > 0 ? `${(employee.runtime.successRate * 100).toFixed(0)}%` : '—'} />
        <OperationsMetric label="交接" value={employee.runtime.handoffs24h} emphasize={employee.runtime.handoffs24h >= OPERATIONS_HANDOFF_THRESHOLD} />
        <OperationsMetric label="异常" value={employee.runtime.anomalies} emphasize={employee.runtime.anomalies > 0} />
      </div>

      <div className="min-w-0">
        <Badge tone={tone}>{health.label}</Badge>
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-[var(--text-muted)]">{signalHint}</p>
        <p className="mt-1 hidden text-[11px] text-[var(--text-secondary)] sm:block lg:hidden">{health.summary}</p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
        <Button size="sm" variant="secondary" onClick={onSelect}>{health.attention ? '查看处置' : '运行摘要'}</Button>
        {isAdmin && employee.lifecycle === 'active' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => onDispose('paused')}>暂停</Button>
            <Button size="sm" variant="ghost" onClick={() => onDispose('quarantined')}>隔离</Button>
          </>
        )}
        {isAdmin && (employee.lifecycle === 'paused' || employee.lifecycle === 'quarantined') && employee.release.status === 'released' && (
          <Button size="sm" onClick={() => onDispose('active')}>恢复</Button>
        )}
      </div>
    </article>
  );
}

function OperationsMetric({ label, value, emphasize }: { label: string; value: string | number; emphasize?: boolean }) {
  return (
    <div className="min-w-0 text-center">
      <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
      <div className={cn('mt-0.5 truncate text-xs font-semibold tabular-nums', emphasize ? 'text-[var(--warning)]' : 'text-[var(--text)]')}>{value}</div>
    </div>
  );
}

function OperationsDisposeModal({ employee, targetLifecycle, loading, onClose, onConfirm }: { employee: DigitalPartner; targetLifecycle: 'paused' | 'quarantined' | 'active'; loading: boolean; onClose: () => void; onConfirm: (input: { reason: string; confirmed?: boolean }) => void }) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const isResume = targetLifecycle === 'active';
  const title = targetLifecycle === 'paused' ? '暂停运行' : targetLifecycle === 'quarantined' ? '隔离运行' : '恢复运行';
  const description = isResume
    ? `确认恢复「${employeePrimaryLabel(employee)}」前，请确认异常已处置并保留审计证据。`
    : `将对「${employeePrimaryLabel(employee)}」执行${title}，须填写处置原因并记入审计证据。`;
  const canSubmit = isResume ? confirmed : reason.trim().length > 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={description}
      size="md"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            loading={loading}
            disabled={!canSubmit}
            onClick={() => onConfirm({ reason: reason.trim(), confirmed: isResume ? confirmed : undefined })}
          >
            确认{title}
          </Button>
        </>
      )}
    >
      <div className="grid gap-4">
        <p className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-xs leading-5 text-[var(--text-muted)]">
          人工接管人 {employee.escalationOwner || '待指定'} · 岗位负责人 {employee.owner}
          {employee.opsControl?.reason ? ` · 上次处置：${employee.opsControl.reason}` : ''}
        </p>
        {!isResume && (
          <label className="grid gap-1.5 text-xs font-medium">
            处置原因<span className="ml-1 text-[var(--danger)]">*</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={targetLifecycle === 'quarantined' ? '例如：连续越权尝试，隔离待安全复核' : '例如：成功率下降，暂停待值班复核'}
              className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-xs font-normal outline-none focus:border-[var(--brand)]"
            />
          </label>
        )}
        {isResume && (
          <label className="flex items-start gap-2 text-xs leading-5 text-[var(--text-secondary)]">
            <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>已确认异常处置完成，并保留相关审计证据；恢复后仍按岗位授权契约执行人工接管与审批要求。</span>
          </label>
        )}
        {isResume && (
          <label className="grid gap-1.5 text-xs font-medium">
            恢复说明（可选）
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：失败样本已复核，值班已签收"
              className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-xs font-normal outline-none focus:border-[var(--brand)]"
            />
          </label>
        )}
      </div>
    </Modal>
  );
}
