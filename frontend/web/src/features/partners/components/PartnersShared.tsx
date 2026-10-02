/**
 * 数字伙伴页面共享：常量、类型、辅助函数与小型 UI 原语。
 *
 *  - `lifecycleMeta` / `riskMeta` / 选项数组
 *  - `formatApiError` / `releaseRequestedBySelf` / `preservedCapabilities` / `gateLabel` / `employeeTags`
 *  - `EmployeeAvatar` / `Metric` / `EmptyState` / `WorkbenchIdentity` / `WorkbenchCheckStrip`
 *  - `WorkbenchListShell` / `WorkbenchPagination`
 */
import type { DigitalPartner, DigitalPartnerLifecycle } from '@qzda/web-types';
import { Badge } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { ChevronLeft, ChevronRight, CheckCircle2, Layers3, XCircle } from 'lucide-react';
import { Button } from '@qzda/web-ui';
import { DigitalPartnerAvatar } from './DigitalPartnerAvatar';
import {
  employeePrimaryLabel,
  employeeSecondaryLabel,
  isDepartmentHead,
  type OperationsHealthStage,
  type ReleaseOnboardingStage,
} from '../lib/partners';

export type ModuleTab = 'catalog' | 'roleSetup' | 'capabilities' | 'release' | 'operations';

export const lifecycleMeta: Record<DigitalPartnerLifecycle, { label: string; tone: 'neutral' | 'success' | 'warn' | 'error' | 'info' }> = {
  draft: { label: '配置中', tone: 'neutral' },
  testing: { label: '试运行', tone: 'info' },
  pending_approval: { label: '待上岗审批', tone: 'warn' },
  active: { label: '在岗', tone: 'success' },
  paused: { label: '已暂停', tone: 'neutral' },
  quarantined: { label: '已隔离', tone: 'error' },
};

export const riskMeta: {
  low: { label: string; tone: 'success' };
  medium: { label: string; tone: 'warn' };
  high: { label: string; tone: 'error' };
} = {
  low: { label: '低风险', tone: 'success' },
  medium: { label: '中风险', tone: 'warn' },
  high: { label: '高风险', tone: 'error' },
};

export const executionModeOptions: Array<['recommend' | 'approval_required' | 'execute' | 'prohibited', string]> = [
  ['recommend', '仅建议'],
  ['approval_required', '需双重审批后执行'],
  ['execute', '可执行'],
  ['prohibited', '禁止'],
];

export const environmentOptions = [['sandbox', '沙箱'], ['staging', '预发'], ['production', '生产']] as const;

export const CATALOG_PAGE_SIZE_OPTIONS = [4, 8, 12, 16, 24] as const;
export const DEFAULT_PAGE_SIZE = 8;

export function readStoredPageSize(key: string, fallback = DEFAULT_PAGE_SIZE) {
  if (typeof window === 'undefined') return fallback;
  const raw = Number(window.localStorage.getItem(key));
  return (CATALOG_PAGE_SIZE_OPTIONS as readonly number[]).includes(raw) ? raw : fallback;
}

export type CatalogSegmentKey = 'all' | 'active' | 'onboarding' | 'attention';

export const catalogSegments: Array<{ key: CatalogSegmentKey; label: string; hint?: string }> = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '可协作', hint: '已上岗，可发起专家协同' },
  { key: 'onboarding', label: '待上岗', hint: '配置中或试运行' },
  { key: 'attention', label: '需关注', hint: '异常、暂停或隔离' },
];

export function matchesCatalogSegment(employee: DigitalPartner, segment: CatalogSegmentKey) {
  if (segment === 'all') return true;
  if (segment === 'active') return employee.lifecycle === 'active' && employee.runtime.anomalies === 0;
  if (segment === 'onboarding') return !['active', 'paused', 'quarantined'].includes(employee.lifecycle);
  return employee.lifecycle === 'paused' || employee.lifecycle === 'quarantined' || (employee.lifecycle === 'active' && employee.runtime.anomalies > 0);
}

export function formatApiError(err: unknown, fallback: string) {
  if (err instanceof Error) return err.message.replace(/^E_[A-Z_]+:\s*/, '');
  return fallback;
}

export function releaseRequestedBySelf(employee: DigitalPartner, user?: { id?: string; name?: string } | null) {
  if (!user) return false;
  if (employee.release.requestedById && user.id && employee.release.requestedById === user.id) return true;
  if (employee.release.requestedBy && user.name && employee.release.requestedBy === user.name) return true;
  return false;
}

export function preservedCapabilities(employee: DigitalPartner): DigitalPartner['capabilities'] {
  return {
    agentId: employee.capabilities.agentId,
    model: employee.capabilities.model,
    knowledge: [...employee.capabilities.knowledge],
    skills: [...employee.capabilities.skills],
    tools: [...employee.capabilities.tools],
    workflows: [...employee.capabilities.workflows],
    channels: [...employee.capabilities.channels],
    cognitive: employee.capabilities.cognitive
      ? { ...employee.capabilities.cognitive }
      : undefined,
  };
}

export function gateLabel(employee: DigitalPartner) {
  if (employee.lifecycle === 'quarantined' || (employee.lifecycle === 'active' && employee.runtime.anomalies > 0)) return '需关注';
  if (employee.lifecycle === 'active') return '可协作';
  if (employee.release.status === 'pending_approval') return '待确认上岗';
  if (employee.evaluation.status === 'passed') return `评测 ${employee.evaluation.score ?? '—'} · 可申请上岗`;
  if (employee.evaluation.status === 'failed') return '评测未通过';
  if (employee.lifecycle === 'paused') return '已暂停';
  if (employee.runtime.anomalies > 0) return '需关注';
  return '配置与评测中';
}

export function employeeTags(employee: DigitalPartner) {
  return [...employee.capabilities.skills, ...employee.capabilities.knowledge, ...employee.capabilities.workflows].slice(0, 3);
}

/** 共享部门头像容器。 */
export function EmployeeAvatar({ employee, size = 40 }: { employee: DigitalPartner; size?: number }) {
  return <DigitalPartnerAvatar employee={employee} size={size} />;
}

/** 共享指标卡。 */
export function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums text-[var(--text)]">
        {value}
        {sub && <span className="ml-1 text-[11px] font-normal text-[var(--text-muted)]">{sub}</span>}
      </div>
    </div>
  );
}

/** 共享勾选状态条（契约 / 评测等）。 */
export function WorkbenchCheckStrip({ items }: { items: Array<{ label: string; ok: boolean }> }) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2">
      {items.map((item) => (
        <span
          key={item.label}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium',
            item.ok ? 'bg-[var(--success-bg)] text-[var(--success)]' : 'bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] text-[var(--warning)]',
          )}
        >
          {item.ok ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <XCircle className="h-3 w-3 shrink-0" />}
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** 共享列表 shell（岗位配置 / 能力装配 / 上岗发布）。 */
export function WorkbenchListShell({
  title,
  description,
  countLabel,
  pageSize,
  onPageSizeChange,
  pageSizeAriaLabel,
  columns,
  toolbar,
  children,
  empty,
  emptyIcon: EmptyIcon = Layers3,
  footer,
  itemCount,
}: {
  title: string;
  description: string;
  countLabel: string;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  pageSizeAriaLabel: string;
  columns: [string, string, string, string];
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  empty: string;
  emptyIcon?: typeof Layers3;
  footer?: React.ReactNode;
  itemCount: number;
}) {
  return (
    <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
      <div className="flex flex-wrap items-end justify-between gap-3 px-5 py-4" style={{ boxShadow: 'var(--saas-divider)' }}>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            每页
            <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className="de-employee-input h-8 rounded-lg bg-[var(--bg)] px-2 text-xs text-[var(--text-secondary)]" aria-label={pageSizeAriaLabel}>
              {[8, 12, 16, 24].map((size) => <option key={size} value={size}>{size} 个</option>)}
            </select>
          </label>
          <span className="text-xs text-[var(--text-muted)]">{countLabel}</span>
        </div>
      </div>
      {toolbar}
      {itemCount > 0 ? (
        <>
          <div className="hidden border-b border-[var(--border)] bg-[var(--bg-elevated)] px-5 py-2 text-[11px] font-medium text-[var(--text-muted)] lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.15fr)_minmax(0,0.9fr)_auto] lg:gap-4">
            {columns.map((column) => <span key={column} className={column === '操作' ? 'text-right' : undefined}>{column}</span>)}
          </div>
          <div className="divide-y divide-[var(--border)]">{children}</div>
          {footer}
        </>
      ) : <EmptyState icon={EmptyIcon} title={empty} />}
    </section>
  );
}

/** 共享列表翻页。 */
export function WorkbenchPagination({ page, pageCount, pageSize, onPrev, onNext }: { page: number; pageCount: number; pageSize: number; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3" style={{ boxShadow: 'inset 0 1px 0 rgba(15,23,42,0.06)' }}>
      <span className="text-[11px] text-[var(--text-muted)]">第 {page} / {pageCount} 页 · 每页 {pageSize} 个</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={onPrev}><ChevronLeft className="h-3.5 w-3.5" />上一页</Button>
        <Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={onNext}>下一页<ChevronRight className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

/** 通用空态。 */
export function EmptyState({ icon: Icon, title, description }: { icon: typeof Layers3; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-xs text-[var(--text-muted)]">
      <Icon className="h-6 w-6 opacity-60" />
      <p className="font-medium text-[var(--text-secondary)]">{title}</p>
      {description && <p>{description}</p>}
    </div>
  );
}

/** WorkbenchIdentity 行 identity cell。 */
export function WorkbenchIdentity({ employee, onSelect, metaLine }: { employee: DigitalPartner; onSelect: () => void; metaLine?: string }) {
  return (
    <button type="button" onClick={onSelect} className="flex min-w-0 items-center gap-3 text-left">
      <EmployeeAvatar employee={employee} size={40} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-[var(--text)]">{employeePrimaryLabel(employee)}</span>
          {isDepartmentHead(employee) && <Badge tone="info">部门负责人</Badge>}
          <Badge tone={lifecycleMeta[employee.lifecycle].tone}>{lifecycleMeta[employee.lifecycle].label}</Badge>
        </div>
        <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{employeeSecondaryLabel(employee)}</p>
        {metaLine && <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{metaLine}</p>}
      </div>
    </button>
  );
}

/** 占位导出（防止 Onboarding/Capability 互相依赖的边缘）。 */
export const _OperationsHealthStage = (s: OperationsHealthStage) => s;
export const _ReleaseOnboardingStage = (s: ReleaseOnboardingStage) => s;
