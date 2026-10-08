/**
 * 数字伙伴上岗发布 Tab：
 *
 *  - `OnboardingManagementView` — 上岗门禁 + 受控审批工作台（KPI + 行内门禁检查）
 *  - `ReleaseListRow` — 行内展示契约 / 能力 / 评测 / 审批 4 项门禁
 *
 * 共享 UI 原语（`WorkbenchIdentity` / `WorkbenchCheckStrip` / `WorkbenchListShell` /
 * `WorkbenchPagination`）来自 `PartnersShared`。
 */
import { useEffect, useMemo, useState } from 'react';
import type { DigitalPartner } from '@qzda/web-types';
import { Badge, Button, KpiCard } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { CheckCircle2, ClipboardCheck, Clock3, Route, XCircle } from 'lucide-react';
import { CATALOG_PAGE_SIZE_OPTIONS, ModuleTab, WorkbenchIdentity, WorkbenchCheckStrip, WorkbenchListShell, WorkbenchPagination } from './PartnersShared';
import { compareReleaseOnboardingEmployees, releaseOnboardingCompleteness, type ReleaseOnboardingStage } from '@/features/partners/lib/partners';
import { usePartnerBuiltinToolNames } from '../hooks/usePartnerBuiltinToolNames';

const RELEASE_PAGE_SIZE_KEY = 'de.release.pageSize';

export function OnboardingManagementView({ employees, onSelect, onGoToModule }: { employees: DigitalPartner[]; onSelect: (id: string) => void; onGoToModule: (tab: ModuleTab) => void }) {
  const builtinToolNames = usePartnerBuiltinToolNames();
  type ReleaseSegment = 'all' | ReleaseOnboardingStage;
  const [segment, setSegment] = useState<ReleaseSegment>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => readStoredReleasePageSize());

  const queue = useMemo(
    () => employees.filter((item) => item.release.status !== 'released').sort(compareReleaseOnboardingEmployees),
    [employees],
  );

  const counts = useMemo(() => {
    const next = { all: queue.length, pending_eval: 0, eval_failed: 0, ready_to_request: 0, pending_approval: 0, released: 0 };
    for (const item of queue) {
      const stage = releaseOnboardingCompleteness(item, builtinToolNames).stage;
      if (stage !== 'released') next[stage] += 1;
    }
    return next;
  }, [queue]);

  const segments: Array<{ key: ReleaseSegment; label: string }> = [
    { key: 'all', label: '全部待办' },
    { key: 'pending_eval', label: '待评测' },
    { key: 'eval_failed', label: '评测未通过' },
    { key: 'ready_to_request', label: '可申请上岗' },
    { key: 'pending_approval', label: '待确认上岗' },
  ];

  const filtered = useMemo(
    () => (segment === 'all' ? queue : queue.filter((item) => releaseOnboardingCompleteness(item, builtinToolNames).stage === segment)),
    [queue, segment],
  );

  useEffect(() => { setPage(1); }, [segment, pageSize, employees]);
  useEffect(() => { window.localStorage.setItem(RELEASE_PAGE_SIZE_KEY, String(pageSize)); }, [pageSize]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, pageCount);
  const pageItems = useMemo(
    () => filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize),
    [filtered, pageSafe, pageSize],
  );

  return (
    <div className="space-y-3">
      <div className="de-employee-hint rounded-xl px-4 py-3 text-xs leading-5 text-[var(--text-secondary)]">
        上岗发布只做质量评测与上岗生效；岗位档案请到「岗位配置」，能力引用请到「能力装配」。
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="de-employee-btn text-[11px]" onClick={() => onGoToModule('roleSetup')}>岗位配置</button>
          <button type="button" className="de-employee-btn text-[11px]" onClick={() => onGoToModule('capabilities')}>能力装配</button>
        </div>
      </div>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button type="button" className="text-left" onClick={() => setSegment('pending_eval')} aria-pressed={segment === 'pending_eval'}>
          <KpiCard label="待评测" value={counts.pending_eval} sub="个" icon={ClipboardCheck} tone={counts.pending_eval ? 'neutral' : 'success'} size="comfortable" />
        </button>
        <button type="button" className="text-left" onClick={() => setSegment('eval_failed')} aria-pressed={segment === 'eval_failed'}>
          <KpiCard label="评测未通过" value={counts.eval_failed} sub="个" icon={XCircle} tone={counts.eval_failed ? 'warn' : 'success'} size="comfortable" />
        </button>
        <button type="button" className="text-left" onClick={() => setSegment('ready_to_request')} aria-pressed={segment === 'ready_to_request'}>
          <KpiCard label="可申请上岗" value={counts.ready_to_request} sub="个" icon={CheckCircle2} tone="success" size="comfortable" />
        </button>
        <button type="button" className="text-left" onClick={() => setSegment('pending_approval')} aria-pressed={segment === 'pending_approval'}>
          <KpiCard label="待确认上岗" value={counts.pending_approval} sub="个" icon={Clock3} tone={counts.pending_approval ? 'warn' : 'success'} size="comfortable" />
        </button>
      </section>
      <WorkbenchListShell
        title="上岗发布"
        description="按「配置完成 → 质量评测 → 申请上岗」推进；条件满足后即可上岗，行内展示门禁检查。"
        countLabel={`${filtered.length} 个待办`}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
        pageSizeAriaLabel="上岗发布每页数量"
        columns={['岗位专家', '上岗门禁', '状态', '操作']}
        toolbar={(
          <div className="flex gap-1 overflow-x-auto px-4 py-2.5" style={{ boxShadow: 'var(--saas-divider)' }} role="tablist" aria-label="上岗阶段">
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
        )}
        empty={segment === 'all' ? '所有员工均已完成上岗' : '当前分段暂无员工'}
        emptyIcon={Route}
        itemCount={pageItems.length}
        footer={pageCount > 1 ? (
          <WorkbenchPagination page={pageSafe} pageCount={pageCount} pageSize={pageSize} onPrev={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(pageCount, value + 1))} />
        ) : undefined}
      >
        {pageItems.map((employee) => (
          <ReleaseListRow key={employee.id} employee={employee} onSelect={() => onSelect(employee.id)} />
        ))}
      </WorkbenchListShell>
    </div>
  );
}

export function ReleaseListRow({ employee, onSelect }: { employee: DigitalPartner; onSelect: () => void }) {
  const builtinToolNames = usePartnerBuiltinToolNames();
  const completeness = releaseOnboardingCompleteness(employee, builtinToolNames);
  const tone = completeness.stage === 'ready_to_request' || completeness.stage === 'released'
    ? 'success'
    : completeness.stage === 'pending_approval' || completeness.stage === 'eval_failed'
      ? 'warn'
      : 'neutral';
  return (
    <article className={cn('grid gap-3 px-5 py-4 transition-colors hover:bg-[var(--bg-hover)] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.15fr)_minmax(0,0.9fr)_auto] lg:items-center lg:gap-4', completeness.stage !== 'ready_to_request' && 'bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]')}>
      <WorkbenchIdentity
        employee={employee}
        onSelect={onSelect}
        metaLine={employee.evaluation.score != null ? `评测 ${employee.evaluation.score} 分 · ${employee.evaluation.status === 'passed' ? '已通过' : employee.evaluation.status === 'failed' ? '未通过' : '进行中'}${employee.evaluation.mock ? '（演示）' : ''}` : '尚未评测'}
      />
      <WorkbenchCheckStrip items={[
        { label: '契约', ok: completeness.contractOk },
        { label: '能力', ok: completeness.capabilityOk },
        { label: '评测', ok: completeness.evaluationOk },
        { label: '审批', ok: completeness.approvalOk },
      ]} />
      <div className="min-w-0">
        <Badge tone={tone}>{completeness.label}</Badge>
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-[var(--text-muted)]">
          {completeness.missing.length ? `缺：${completeness.missing.slice(0, 2).join('、')}` : '门禁已齐，可继续处置'}
        </p>
      </div>
      <div className="flex lg:justify-end">
        <Button size="sm" variant="secondary" onClick={onSelect}>查看门禁</Button>
      </div>
    </article>
  );
}

function readStoredReleasePageSize() {
  if (typeof window === 'undefined') return 8;
  const raw = Number(window.localStorage.getItem(RELEASE_PAGE_SIZE_KEY));
  return (CATALOG_PAGE_SIZE_OPTIONS as readonly number[]).includes(raw) ? raw : 8;
}