/**
 * 数字伙伴能力装配 Tab：
 *
 *  - `CapabilitiesView` — 能力装配工作台（KPI + 行内模型 / 装配检查）
 *  - `CapabilityListRow` — 行内展示模型 / 执行能力 / 授权检查
 *
 * 受控装配编辑器（`LinkedAssetPicker` / `CapabilityAssemblySelector` / `syncCapabilityModes`）见
 * `PartnersTab.Capability.Assembly`。
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DigitalPartner } from '@qzda/web-types';
import { Badge, Button, KpiCard } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { Layers3, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { CATALOG_PAGE_SIZE_OPTIONS, ModuleTab, WorkbenchIdentity, WorkbenchCheckStrip, WorkbenchListShell, WorkbenchPagination } from './PartnersShared';
import { capabilityAssemblyCompleteness, compareCapabilityAssemblyEmployees, roleSetupCompleteness } from '@/features/partners/lib/partners';
import { usePartnerBuiltinToolNames } from '../hooks/usePartnerBuiltinToolNames';

const CAPABILITY_PAGE_SIZE_KEY = 'de.capabilities.pageSize';

export function CapabilitiesView({ employees, onSelect, onGoToModule }: { employees: DigitalPartner[]; onSelect: (id: string) => void; onGoToModule: (tab: ModuleTab) => void }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => readStoredCapabilityPageSize());

  const builtinToolNames = usePartnerBuiltinToolNames();
  const capabilitySorted = useMemo(
    () => [...employees].sort((left, right) => compareCapabilityAssemblyEmployees(left, right, builtinToolNames)),
    [employees, builtinToolNames],
  );
  const kpis = useMemo(() => {
    let noModel = 0;
    let noAssets = 0;
    let ready = 0;
    for (const item of capabilitySorted) {
      const completeness = capabilityAssemblyCompleteness(item, builtinToolNames);
      if (!completeness.modelOk) noModel += 1;
      else if (!completeness.assetsOk) noAssets += 1;
      if (completeness.ready) ready += 1;
    }
    return { noModel, noAssets, ready };
  }, [capabilitySorted, builtinToolNames]);

  useEffect(() => { setPage(1); }, [pageSize, employees]);
  useEffect(() => { window.localStorage.setItem(CAPABILITY_PAGE_SIZE_KEY, String(pageSize)); }, [pageSize]);

  const pageCount = Math.max(1, Math.ceil(capabilitySorted.length / pageSize));
  const pageSafe = Math.min(page, pageCount);
  const pageItems = useMemo(
    () => capabilitySorted.slice((pageSafe - 1) * pageSize, pageSafe * pageSize),
    [capabilitySorted, pageSafe, pageSize],
  );

  return (
    <div className="space-y-3">
      <div className="de-employee-hint rounded-xl px-4 py-3 text-xs leading-5 text-[var(--text-secondary)]">
        能力装配只引用各中心已发布资产，并设置执行授权模式；岗位职责请到「岗位配置」，评测上岗请到「上岗发布」。
        <div className="mt-2 flex flex-wrap gap-2">
          <Link to="/workflows" className="de-employee-btn text-[11px]">工作流程</Link>
          <Link to="/skills" className="de-employee-btn text-[11px]">技能中心</Link>
          <Link to="/models" className="de-employee-btn text-[11px]">模型服务</Link>
          <Link to="/knowledge" className="de-employee-btn text-[11px]">知识中心</Link>
        </div>
      </div>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard label="未绑模型" value={kpis.noModel} sub="个" icon={Layers3} tone={kpis.noModel ? 'warn' : 'success'} size="comfortable" />
        <KpiCard label="缺执行能力" value={kpis.noAssets} sub="个" icon={ShieldAlert} tone={kpis.noAssets ? 'warn' : 'success'} size="comfortable" />
        <KpiCard label="装配完整" value={kpis.ready} sub="个" icon={CheckCircle2} tone="success" size="comfortable" />
      </section>
      <WorkbenchListShell
        title="能力装配"
        description="按未完整优先排列；行内展示模型 / 执行能力 / 授权检查，点击进入受控装配工作台。"
        countLabel={`${capabilitySorted.length} 个岗位`}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
        pageSizeAriaLabel="能力装配每页数量"
        columns={['岗位专家', '装配检查', '状态', '操作']}
        empty="暂无员工可装配"
        emptyIcon={Layers3}
        itemCount={pageItems.length}
        footer={pageCount > 1 ? (
          <WorkbenchPagination page={pageSafe} pageCount={pageCount} pageSize={pageSize} onPrev={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(pageCount, value + 1))} />
        ) : undefined}
      >
        {pageItems.map((employee) => (
          <CapabilityListRow key={employee.id} employee={employee} onSelect={() => onSelect(employee.id)} />
        ))}
      </WorkbenchListShell>
    </div>
  );
}

export function CapabilityListRow({ employee, onSelect }: { employee: DigitalPartner; onSelect: () => void }) {
  const builtinToolNames = usePartnerBuiltinToolNames();
  const completeness = capabilityAssemblyCompleteness(employee, builtinToolNames);
  const contractReady = roleSetupCompleteness(employee).ready;
  const tone = completeness.label === '装配完整' ? 'success' : 'warn';
  return (
    <article className={cn('grid gap-3 px-5 py-4 transition-colors hover:bg-[var(--bg-hover)] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.15fr)_minmax(0,0.9fr)_auto] lg:items-center lg:gap-4', !completeness.ready && 'bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]')}>
      <WorkbenchIdentity employee={employee} onSelect={onSelect} metaLine={employee.capabilities.model ? `模型 ${employee.capabilities.model}` : '尚未绑定模型路由'} />
      <WorkbenchCheckStrip items={[
        { label: '模型', ok: completeness.modelOk },
        { label: '执行能力', ok: completeness.assetsOk },
        { label: '授权', ok: completeness.modesOk },
      ]} />
      <div className="min-w-0">
        <Badge tone={tone}>{completeness.label}</Badge>
        {!contractReady && <p className="mt-1.5 text-[11px] text-[var(--warning)]">岗位契约未完整</p>}
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-[var(--text-muted)]">
          {completeness.missing.length ? `缺：${completeness.missing.slice(0, 2).join('、')}` : `${completeness.boundCount} 项已引用`}
        </p>
      </div>
      <div className="flex lg:justify-end">
        <Button size="sm" variant="secondary" onClick={onSelect}>打开装配</Button>
      </div>
    </article>
  );
}

function readStoredCapabilityPageSize() {
  if (typeof window === 'undefined') return 8;
  const raw = Number(window.localStorage.getItem(CAPABILITY_PAGE_SIZE_KEY));
  return (CATALOG_PAGE_SIZE_OPTIONS as readonly number[]).includes(raw) ? raw : 8;
}