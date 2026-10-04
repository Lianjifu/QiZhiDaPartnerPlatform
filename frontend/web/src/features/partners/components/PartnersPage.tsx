/**
 * 数字伙伴页：专家目录与运行管理。
 * 新建 / 完善配置已迁至 `/partners/new`；查看详情已迁至 `/partners/:id`。
 */
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import type { DigitalPartner } from '@qzda/web-types';
import { Badge, Button, KpiCard } from '@qzda/web-ui';
import { RoleReadonlyBanner } from '@/components/shared';
import { cn } from '@qzda/web-utils';
import { AlertTriangle, CheckCircle2, Clock3, HeartPulse, Layers3, Plus, Search, Users } from 'lucide-react';
import { useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useT } from '@/i18n';
import { roleCanMutate, rolePageCopy } from '@/features/role-nav/role-nav';
import {
  compareDigitalPartners,
  DIGITAL_EMPLOYEE_DEPARTMENT_ORDER,
  partnerDetailPath,
} from '@/features/partners/lib/partners';
import {
  catalogSegments,
  CatalogSegmentKey,
  CATALOG_PAGE_SIZE_OPTIONS,
  EmptyState,
  lifecycleMeta,
  matchesCatalogSegment,
  ModuleTab,
  readStoredPageSize,
} from './PartnersShared';
import { OperationsView } from './PartnersTab.Operations';
import { EmployeeCard } from './PartnersPage.EmployeeCard';

const CATALOG_PAGE_SIZE_KEY = 'de.catalog.pageSize';

const tabs: Array<{ key: ModuleTab; labelKey: string; icon: typeof Users }> = [
  { key: 'catalog', labelKey: 'module.agents.tabs.catalog', icon: Users },
  { key: 'operations', labelKey: 'module.agents.tabs.operations', icon: HeartPulse },
];

export default function PartnersPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const canMutate = roleCanMutate(user?.role);
  const pageCopy = rolePageCopy('agents', user?.role);
  const workspaceName = useWorkspaceStore((state) => state.current?.name ?? '当前工作区');
  const [tab, setTab] = useState<ModuleTab>(() => (params.get('tab') === 'operations' ? 'operations' : 'catalog'));
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('全部部门');
  const [lifecycle, setLifecycle] = useState('全部状态');
  const [catalogSegment, setCatalogSegment] = useState<CatalogSegmentKey>('all');
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogPageSize, setCatalogPageSize] = useState(() => readStoredPageSize(CATALOG_PAGE_SIZE_KEY));

  const { data: employees = [], isLoading } = useApiQuery<DigitalPartner[]>(['digital-employees'], '/api/partners');
  const { data: overview } = useApiQuery<{ total: number; active: number; pending: number; anomalies: number }>(['digital-employees', 'overview'], '/api/partners/overview');

  useEffect(() => { setCatalogPage(1); }, [query, department, lifecycle, catalogPageSize, catalogSegment]);
  useEffect(() => { if (typeof window !== 'undefined') window.localStorage.setItem(CATALOG_PAGE_SIZE_KEY, String(catalogPageSize)); }, [catalogPageSize]);

  const departments = useMemo(() => {
    const present = Array.from(new Set(employees.map((employee) => employee.department)));
    const ordered = DIGITAL_EMPLOYEE_DEPARTMENT_ORDER.filter((item) => present.includes(item));
    const rest = present.filter((item) => !DIGITAL_EMPLOYEE_DEPARTMENT_ORDER.includes(item)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return ['全部部门', ...ordered, ...rest];
  }, [employees]);
  const orderedEmployees = useMemo(() => [...employees].sort(compareDigitalPartners), [employees]);
  const filtered = useMemo(() => employees.filter((employee) => {
    const matchesText = !query || [employee.name, employee.role, employee.department, employee.owner].join(' ').toLowerCase().includes(query.toLowerCase());
    return matchesText && (department === '全部部门' || employee.department === department) && (lifecycle === '全部状态' || lifecycleMeta[employee.lifecycle].label === lifecycle);
  }).sort(compareDigitalPartners), [employees, query, department, lifecycle]);
  const catalogSegmentCounts = useMemo(() => ({
    all: filtered.length,
    active: filtered.filter((item) => matchesCatalogSegment(item, 'active')).length,
    onboarding: filtered.filter((item) => matchesCatalogSegment(item, 'onboarding')).length,
    attention: filtered.filter((item) => matchesCatalogSegment(item, 'attention')).length,
  }), [filtered]);
  const catalogItems = useMemo(() => filtered.filter((item) => matchesCatalogSegment(item, catalogSegment)), [filtered, catalogSegment]);
  const catalogPageCount = Math.max(1, Math.ceil(catalogItems.length / catalogPageSize));
  const catalogPageSafe = Math.min(catalogPage, catalogPageCount);
  const catalogPageItems = useMemo(
    () => catalogItems.slice((catalogPageSafe - 1) * catalogPageSize, catalogPageSafe * catalogPageSize),
    [catalogItems, catalogPageSafe, catalogPageSize],
  );

  const deepLinkId = params.get('employeeId');
  if (deepLinkId) return <Navigate to={partnerDetailPath(deepLinkId)} replace />;

  return (
    <div className="de-employee-page h-full min-w-0 overflow-y-auto overscroll-contain bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5">
      <div className="space-y-3">
        <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
          <div className="flex items-start justify-between gap-4 px-4 py-3.5 md:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg">
                  <Users className="h-4 w-4" />
                </div>
                <h1 className="text-base font-semibold text-[var(--text)]">{pageCopy.title}</h1>
              </div>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{pageCopy.subtitle}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Badge tone="info">{workspaceName}</Badge>
              {!canMutate && <Badge tone="neutral">只读</Badge>}
              {canMutate && (
                <button type="button" className="de-employee-btn de-employee-btn--primary" onClick={() => navigate('/partners/new')}>
                  <Plus className="h-3.5 w-3.5" />新建数字伙伴
                </button>
              )}
            </div>
          </div>
          <div className="px-4 md:px-5">
            <RoleReadonlyBanner className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]" />
          </div>
          <div className="de-employee-tabs flex overflow-x-auto px-3" role="tablist" aria-label="数字伙伴功能">
            {tabs.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.key}
                  role="tab"
                  aria-selected={tab === item.key}
                  onClick={() => setTab(item.key)}
                  className={cn('de-employee-tab flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs transition-colors', tab === item.key && 'is-active')}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{t(item.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </section>

        {tab === 'catalog' && (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="在册专家" value={overview?.total ?? 0} sub="个" icon={Users} tone="brand" size="comfortable" />
              <KpiCard label="已上岗" value={overview?.active ?? 0} sub="个" icon={CheckCircle2} tone="success" size="comfortable" />
              <KpiCard label="待上岗审批" value={overview?.pending ?? 0} sub="个" icon={Clock3} tone="warn" size="comfortable" />
              <KpiCard label="运行异常" value={overview?.anomalies ?? 0} sub="个" icon={AlertTriangle} tone={(overview?.anomalies ?? 0) > 0 ? 'warn' : 'success'} size="comfortable" />
            </section>
            <CatalogFilters query={query} setQuery={setQuery} lifecycle={lifecycle} setLifecycle={setLifecycle} departments={departments} department={department} setDepartment={setDepartment} segments={catalogSegmentCounts} segment={catalogSegment} setSegment={setCatalogSegment} />
            <CatalogGrid isLoading={isLoading} items={catalogPageItems} pageCount={catalogPageCount} pageSafe={catalogPageSafe} pageSize={catalogPageSize} setPageSize={setCatalogPageSize} setPage={setCatalogPage} onSelect={(id) => navigate(partnerDetailPath(id))} />
          </>
        )}

        {tab === 'operations' && <OperationsView employees={orderedEmployees} onSelect={(id) => navigate(partnerDetailPath(id, 'runtime'))} />}
      </div>
    </div>
  );
}

function CatalogFilters({ query, setQuery, lifecycle, setLifecycle, departments, department, setDepartment, segments, segment, setSegment }: {
  query: string; setQuery: (v: string) => void;
  lifecycle: string; setLifecycle: (v: string) => void;
  departments: string[]; department: string; setDepartment: (v: string) => void;
  segments: Record<CatalogSegmentKey, number>; segment: CatalogSegmentKey; setSegment: (v: CatalogSegmentKey) => void;
}) {
  return (
    <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ boxShadow: 'var(--saas-divider)' }}>
        <div className="relative min-w-[210px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--brand)]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索专家、岗位、部门或负责人" className="de-employee-input h-9 w-full rounded-lg bg-[var(--bg)] pl-8 pr-3 text-xs outline-none" />
        </div>
        <select value={lifecycle} onChange={(event) => setLifecycle(event.target.value)} className="de-employee-input h-9 rounded-lg bg-[var(--bg)] px-2 text-xs text-[var(--text-secondary)]">
          {['全部状态', ...Object.values(lifecycleMeta).map((item) => item.label)].map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      <div className="flex gap-1 overflow-x-auto px-4 py-2.5" style={{ boxShadow: 'var(--saas-divider)' }}>
        {departments.map((item) => (
          <button type="button" key={item} onClick={() => setDepartment(item)} className={cn('de-employee-chip shrink-0 rounded-md px-3 py-1.5 text-xs transition-colors', department === item && 'is-active')}>{item}</button>
        ))}
      </div>
      <div className="flex gap-1 overflow-x-auto px-4 py-2.5" style={{ boxShadow: 'var(--saas-divider)' }} role="tablist" aria-label="专家目录分类">
        {catalogSegments.map((seg) => (
          <button type="button" key={seg.key} onClick={() => setSegment(seg.key)} className={cn('de-employee-chip shrink-0 rounded-md px-3 py-1.5 text-xs transition-colors', segment === seg.key && 'is-active')}>
            {seg.label}
            <span className="ml-1.5 tabular-nums text-[10px] opacity-70">{segments[seg.key]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function CatalogGrid({ isLoading, items, pageCount, pageSafe, pageSize, setPageSize, setPage, onSelect }: {
  isLoading: boolean; items: DigitalPartner[];
  pageCount: number; pageSafe: number; pageSize: number;
  setPageSize: (n: number) => void; setPage: (fn: (value: number) => number) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="min-w-0">
      {isLoading ? (
        <div className="de-employee-shell rounded-xl bg-[var(--surface-1)] p-8 text-center text-xs text-[var(--text-muted)]">正在载入数字伙伴…</div>
      ) : items.length === 0 ? (
        <div className="de-employee-shell rounded-xl bg-[var(--surface-1)]">
          <EmptyState icon={Layers3} title="没有匹配的数字伙伴" description="调整筛选或分类条件，或新建岗位数字伙伴。" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((employee) => <EmployeeCard key={employee.id} employee={employee} onSelect={() => onSelect(employee.id)} />)}
          </div>
          {pageCount > 1 && (
            <div className="de-employee-shell flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-1)] px-4 py-3">
              <span className="text-[11px] text-[var(--text-muted)]">第 {pageSafe} / {pageCount} 页 · 每页 {pageSize} 个</span>
              <div className="flex items-center gap-2">
                <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="de-employee-input h-8 rounded-lg bg-[var(--bg)] px-2 text-xs text-[var(--text-secondary)]" aria-label="每页数量">
                  {CATALOG_PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} 个</option>)}
                </select>
                <Button size="sm" variant="secondary" disabled={pageSafe <= 1} onClick={() => setPage((page) => Math.max(1, page - 1))}>上一页</Button>
                <Button size="sm" variant="secondary" disabled={pageSafe >= pageCount} onClick={() => setPage((page) => Math.min(pageCount, page + 1))}>下一页</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
