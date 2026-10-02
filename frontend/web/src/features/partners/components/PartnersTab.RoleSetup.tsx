/**
 * 数字伙伴岗位配置 Tab：
 *
 *  - `RoleSetupView` — 岗位契约工作台（KPI 卡 + 受契约未完整优先排序）
 *  - `RoleSetupListRow` — 行内展示档案 / 边界 / 记忆检查
 *
 * 共享 UI 原语（`WorkbenchIdentity` / `WorkbenchCheckStrip` / `WorkbenchListShell` /
 * `WorkbenchPagination` / `EmployeeAvatar`）来自 `PartnersShared`。
 */
import { useEffect, useMemo, useState } from 'react';
import type { DigitalPartner } from '@qzda/web-types';
import { Badge, Button, KpiCard } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { BriefcaseBusiness, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { CATALOG_PAGE_SIZE_OPTIONS, ModuleTab, WorkbenchIdentity, WorkbenchCheckStrip, WorkbenchListShell, WorkbenchPagination } from './PartnersShared';
import { compareRoleSetupEmployees, roleSetupCompleteness } from '@/features/partners/lib/partners';

const ROLE_SETUP_PAGE_SIZE_KEY = 'de.roleSetup.pageSize';

export function RoleSetupView({ employees, onSelect, onGoToModule }: { employees: DigitalPartner[]; onSelect: (id: string) => void; onGoToModule: (tab: ModuleTab) => void }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => readStoredRoleSetupPageSize());

  const roleSorted = useMemo(() => [...employees].sort(compareRoleSetupEmployees), [employees]);
  const kpis = useMemo(() => {
    let profilePending = 0;
    let boundaryPending = 0;
    let contractReady = 0;
    for (const item of roleSorted) {
      const completeness = roleSetupCompleteness(item);
      if (!completeness.profileOk) profilePending += 1;
      else if (!completeness.boundaryOk) boundaryPending += 1;
      if (completeness.ready) contractReady += 1;
    }
    return { profilePending, boundaryPending, contractReady };
  }, [roleSorted]);

  useEffect(() => { setPage(1); }, [pageSize, employees]);
  useEffect(() => { window.localStorage.setItem(ROLE_SETUP_PAGE_SIZE_KEY, String(pageSize)); }, [pageSize]);

  const pageCount = Math.max(1, Math.ceil(roleSorted.length / pageSize));
  const pageSafe = Math.min(page, pageCount);
  const pageItems = useMemo(
    () => roleSorted.slice((pageSafe - 1) * pageSize, pageSafe * pageSize),
    [roleSorted, pageSafe, pageSize],
  );

  return (
    <div className="space-y-3">
      <div className="de-employee-hint rounded-xl px-4 py-3 text-xs leading-5 text-[var(--text-secondary)]">
        岗位配置只维护授权契约；能力引用请到「能力装配」；评测上岗请到「上岗发布」。保存后立即生效。
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="de-employee-btn text-[11px]" onClick={() => onGoToModule('capabilities')}>能力装配</button>
          <button type="button" className="de-employee-btn text-[11px]" onClick={() => onGoToModule('release')}>上岗发布</button>
        </div>
      </div>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard label="待补档案" value={kpis.profilePending} sub="个" icon={BriefcaseBusiness} tone={kpis.profilePending ? 'warn' : 'success'} size="comfortable" />
        <KpiCard label="边界待完善" value={kpis.boundaryPending} sub="个" icon={ShieldAlert} tone={kpis.boundaryPending ? 'warn' : 'success'} size="comfortable" />
        <KpiCard label="契约完整" value={kpis.contractReady} sub="个" icon={CheckCircle2} tone="success" size="comfortable" />
      </section>
      <WorkbenchListShell
        title="岗位配置"
        description="按未完整优先排列；行内展示档案 / 边界 / 记忆检查，点击进入岗位授权契约工作台。"
        countLabel={`${roleSorted.length} 个岗位`}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
        pageSizeAriaLabel="岗位配置每页数量"
        columns={['岗位专家', '契约检查', '状态', '操作']}
        empty="暂无需要配置的员工"
        emptyIcon={BriefcaseBusiness}
        itemCount={pageItems.length}
        footer={pageCount > 1 ? (
          <WorkbenchPagination page={pageSafe} pageCount={pageCount} pageSize={pageSize} onPrev={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(pageCount, value + 1))} />
        ) : undefined}
      >
        {pageItems.map((employee) => (
          <RoleSetupListRow key={employee.id} employee={employee} onSelect={() => onSelect(employee.id)} />
        ))}
      </WorkbenchListShell>
    </div>
  );
}

export function RoleSetupListRow({ employee, onSelect }: { employee: DigitalPartner; onSelect: () => void }) {
  const completeness = roleSetupCompleteness(employee);
  const tone = completeness.label === '契约完整' ? 'success' : 'warn';
  return (
    <article className={cn('grid gap-3 px-5 py-4 transition-colors hover:bg-[var(--bg-hover)] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.15fr)_minmax(0,0.9fr)_auto] lg:items-center lg:gap-4', !completeness.ready && 'bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]')}>
      <WorkbenchIdentity employee={employee} onSelect={onSelect} metaLine={`负责人 ${employee.owner || '待指定'} · 接管 ${employee.escalationOwner || '待指定'}`} />
      <WorkbenchCheckStrip items={[
        { label: '档案', ok: completeness.profileOk },
        { label: '边界', ok: completeness.boundaryOk },
        { label: '记忆', ok: completeness.memoryOk },
      ]} />
      <div className="min-w-0">
        <Badge tone={tone}>{completeness.label}</Badge>
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-[var(--text-muted)]">
          {completeness.missing.length ? `缺：${completeness.missing.slice(0, 2).join('、')}` : '可进入能力装配'}
        </p>
      </div>
      <div className="flex lg:justify-end">
        <Button size="sm" variant="secondary" onClick={onSelect}>配置岗位</Button>
      </div>
    </article>
  );
}

function readStoredRoleSetupPageSize() {
  if (typeof window === 'undefined') return 8;
  const raw = Number(window.localStorage.getItem(ROLE_SETUP_PAGE_SIZE_KEY));
  return (CATALOG_PAGE_SIZE_OPTIONS as readonly number[]).includes(raw) ? raw : 8;
}