/**
 * 数字伙伴页（企智搭 · 数字伙伴平台 · 数字伙伴）：
 *
 *  - 页面 shell：标题、Tab 路由、过滤器、分类、KPI、catalog grid、分页控制
 *  - 委托给各 Tab 视图组件：Plaza / RoleSetup / Capability / Release / Operations
 *  - `PartnerDetailShell` —— catalog → 多 Tab 详情 / roleSetup & capabilities → 工作台 / release & operations → 上下文详情
 *  - `CreateEmployeeModal` —— 新建数字伙伴
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DigitalPartner } from '@qzda/web-types';
import { Badge, Button, KpiCard } from '@qzda/web-ui';
import { Modal, RoleReadonlyBanner } from '@/components/shared';
import { cn } from '@qzda/web-utils';
import { AlertTriangle, CheckCircle2, Clock3, Layers3, Users } from 'lucide-react';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';
import { roleCanMutate, rolePageCopy } from '@/features/role-nav/role-nav';
import {
  compareDigitalPartners,
  DIGITAL_EMPLOYEE_DEPARTMENT_ORDER,
  employeePrimaryLabel,
  employeeSecondaryLabel,
  isDepartmentHead,
} from '@/features/partners/lib/partners';
import {
  catalogSegments,
  CatalogSegmentKey,
  CATALOG_PAGE_SIZE_OPTIONS,
  EmployeeAvatar,
  EmptyState,
  lifecycleMeta,
  matchesCatalogSegment,
  ModuleTab,
  readStoredPageSize,
  riskMeta,
} from './PartnersShared';
import { EmployeePlaza } from './PartnersTab.Plaza';
import { RoleSetupView } from './PartnersTab.RoleSetup';
import { CapabilitiesView } from './PartnersTab.Capability';
import { OnboardingManagementView } from './PartnersTab.Release';
import { OperationsView } from './PartnersTab.Operations';
import { ContextualEmployeeDetail } from './PartnersTab.Detail';
import { EmployeeConfigurationWorkbench } from './PartnersTab.Onboarding';
import { DepartmentTeamPanel } from '@/components/DepartmentTeamPanel';
import { CapabilityContent, MemoryContent, ProfileContent, RuntimeContent, StructuredBoundaryContent } from './PartnersDetail.Panels';
import { EmployeeCard } from './PartnersPage.EmployeeCard';

const CATALOG_PAGE_SIZE_KEY = 'de.catalog.pageSize';

type DetailTab = 'team' | 'profile' | 'boundary' | 'capabilities' | 'memory' | 'runtime' | 'evidence';

const tabs: Array<{ key: ModuleTab; labelKey: string }> = [
  { key: 'catalog', labelKey: 'module.agents.tabs.catalog' },
  { key: 'roleSetup', labelKey: 'module.agents.tabs.roleSetup' },
  { key: 'capabilities', labelKey: 'module.agents.tabs.capabilities' },
  { key: 'release', labelKey: 'module.agents.tabs.release' },
  { key: 'operations', labelKey: 'module.agents.tabs.operations' },
];

export default function PartnersPage() {
  const { t } = useT();
  const user = useAuthStore((state) => state.user);
  const canMutate = roleCanMutate(user?.role);
  const pageCopy = rolePageCopy('agents', user?.role);
  const [tab, setTab] = useState<ModuleTab>('catalog');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('全部部门');
  const [lifecycle, setLifecycle] = useState('全部状态');
  const [catalogSegment, setCatalogSegment] = useState<CatalogSegmentKey>('all');
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogPageSize, setCatalogPageSize] = useState(() => readStoredPageSize(CATALOG_PAGE_SIZE_KEY));

  const { data: employees = [], isLoading } = useApiQuery<DigitalPartner[]>(['digital-employees'], '/api/partners');
  const { data: overview } = useApiQuery<{ total: number; active: number; pending: number; anomalies: number }>(['digital-employees', 'overview'], '/api/partners/overview');
  const createEmployee = useApiMutation<DigitalPartner, Partial<DigitalPartner>>('/api/partners', { onSuccess: (employee) => { setCreateOpen(false); setSelectedId(employee.id); } });

  useEffect(() => { setCatalogPage(1); }, [query, department, lifecycle, catalogPageSize, catalogSegment]);
  useEffect(() => { if (typeof window !== 'undefined') window.localStorage.setItem(CATALOG_PAGE_SIZE_KEY, String(catalogPageSize)); }, [catalogPageSize]);

  const selected = employees.find((employee) => employee.id === selectedId) ?? null;
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

  return (
    <div className="de-employee-page h-full min-w-0 overflow-y-auto bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5">
      <div className="space-y-3">
        <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
          <div className="flex items-start justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg"><span>📋</span></div>
                <h1 className="text-base font-semibold text-[var(--text)]">{pageCopy.title}</h1>
              </div>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{pageCopy.subtitle}</p>
            </div>
            {canMutate && (
              <div className="flex shrink-0 gap-2">
                <button type="button" className="de-employee-btn" onClick={() => { setTab('catalog'); setTemplateOpen(true); }}>✦ 从岗位蓝图创建</button>
                <button type="button" className="de-employee-btn de-employee-btn--primary" onClick={() => { setTab('catalog'); setCreateOpen(true); }}>＋ 新建数字伙伴</button>
              </div>
            )}
          </div>
          <div className="px-5"><RoleReadonlyBanner className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]" /></div>
          <div className="de-employee-tabs flex overflow-x-auto px-3" role="tablist" aria-label="数字伙伴功能">
            {tabs.map((item) => (
              <button type="button" key={item.key} onClick={() => setTab(item.key)} className={cn('de-employee-tab flex shrink-0 items-center gap-1.5 px-3 py-3 text-xs transition-colors', tab === item.key && 'is-active')}>
                <span>{t(item.labelKey)}</span>
              </button>
            ))}
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
            <CatalogGrid isLoading={isLoading} items={catalogPageItems} pageCount={catalogPageCount} pageSafe={catalogPageSafe} pageSize={catalogPageSize} setPageSize={setCatalogPageSize} setPage={setCatalogPage} onSelect={(id) => setSelectedId(id)} />
            {templateOpen && (
              <Modal open={templateOpen} onClose={() => setTemplateOpen(false)} title="从岗位蓝图创建" description="采用经治理验证的岗位模板，在当前工作区创建数字伙伴；仍需完善配置、完成评测后即可申请上岗。" size="xl">
                <EmployeePlaza employees={employees} onCreate={() => setCreateOpen(true)} onAdopt={(employeeId) => { setTemplateOpen(false); setSelectedId(employeeId); }} onClose={() => setTemplateOpen(false)} />
              </Modal>
            )}
          </>
        )}

        {tab === 'roleSetup' && <RoleSetupView employees={orderedEmployees} onSelect={setSelectedId} onGoToModule={setTab} />}
        {tab === 'capabilities' && <CapabilitiesView employees={orderedEmployees} onSelect={setSelectedId} onGoToModule={setTab} />}
        {tab === 'release' && <OnboardingManagementView employees={orderedEmployees} onSelect={setSelectedId} onGoToModule={setTab} />}
        {tab === 'operations' && <OperationsView employees={orderedEmployees} onSelect={setSelectedId} onGoToModule={setTab} />}
      </div>
      <PartnerDetailShell employee={selected} context={tab} onClose={() => setSelectedId(null)} onGoToModule={setTab} />
      <CreateEmployeeModal open={createOpen} onClose={() => setCreateOpen(false)} loading={createEmployee.isPending} onCreate={(input) => createEmployee.mutate(input)} />
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
          <span className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--brand)]">🔍</span>
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
    <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
      {isLoading ? (
        <div className="p-8 text-center text-xs text-[var(--text-muted)]">正在载入数字伙伴…</div>
      ) : items.length === 0 ? (
        <EmptyState icon={Layers3} title="没有匹配的数字伙伴" description="调整筛选或分类条件，或新建岗位数字伙伴。" />
      ) : (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((employee) => <EmployeeCard key={employee.id} employee={employee} onSelect={() => onSelect(employee.id)} />)}
          </div>
          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
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

function PartnerDetailShell({ employee, context, onClose, onGoToModule }: { employee: DigitalPartner | null; context: ModuleTab; onClose: () => void; onGoToModule?: (tab: ModuleTab) => void }) {
  if (!employee) return null;
  if (context === 'release' || context === 'operations') return <ContextualEmployeeDetail employee={employee} context={context} onClose={onClose} onGoToModule={onGoToModule} />;
  if (context === 'roleSetup') return <EmployeeConfigurationWorkbench employee={employee} open mode="role" onClose={onClose} initialSection="profile" />;
  if (context === 'capabilities') return <EmployeeConfigurationWorkbench employee={employee} open mode="capability" onClose={onClose} initialSection="profile" />;
  return <CatalogDetailModal employee={employee} onClose={onClose} />;
}

function CatalogDetailModal({ employee, onClose }: { employee: DigitalPartner; onClose: () => void }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<DetailTab>(() => isDepartmentHead(employee) ? 'team' : 'profile');
  const head = isDepartmentHead(employee);
  const detailTabs: Array<{ key: DetailTab; label: string }> = [
    ...(head ? [{ key: 'team' as const, label: '部门班组' }] : []),
    { key: 'profile', label: '档案与岗位' },
    { key: 'boundary', label: '职责与边界' },
    { key: 'capabilities', label: '能力装配' },
    { key: 'memory', label: '记忆与上下文' },
    { key: 'runtime', label: '运行观测' },
    { key: 'evidence', label: '审计证据' },
  ];
  const { data: evidence = [] } = useApiQuery<Array<{ id: string; time: string; actor: string; action: string; target: string; result: string }>>(['digital-employee', employee.id, 'evidence'], `/api/partners/${employee.id}/evidence`);
  const nextStepHint = employee.release.status === 'pending_approval'
    ? '下一步：上岗发布 · 确认上岗'
    : employee.evaluation.status !== 'passed'
      ? '下一步：上岗发布 · 执行评测'
      : employee.release.status !== 'released' ? '下一步：上岗发布 · 申请上岗' : null;
  const actions = (
    <>
      {employee.lifecycle === 'active' && <Button size="sm" onClick={() => navigate(`/copilot?employeeId=${employee.id}`)}>👥 发起协作</Button>}
      {head && employee.lifecycle === 'active' && <Button size="sm" variant="secondary" onClick={() => setTab('team')}>班组调度</Button>}
      <Button size="sm" variant="secondary" onClick={() => navigate(`/tasks?task=${encodeURIComponent(employeePrimaryLabel(employee))}`)}>相关任务</Button>
      {nextStepHint && <span className="hidden text-[11px] text-[var(--text-muted)] sm:inline">{nextStepHint}</span>}
      <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
    </>
  );
  const renderContent = (): ReactNode => {
    switch (tab) {
      case 'team': return head ? <DepartmentTeamPanel head={employee} /> : <ProfileContent employee={employee} />;
      case 'profile': return <ProfileContent employee={employee} />;
      case 'boundary': return <StructuredBoundaryContent employee={employee} />;
      case 'capabilities': return <CapabilityContent employee={employee} />;
      case 'memory': return <MemoryContent employee={employee} />;
      case 'runtime': return <RuntimeContent employee={employee} />;
      case 'evidence':
        return (
          <div className="space-y-3">
            {evidence.map((event) => (
              <div key={event.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
                <div className="text-sm font-medium">{event.action}</div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">{event.target}</div>
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">{event.actor} · {new Date(event.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</div>
              </div>
            ))}
          </div>
        );
    }
  };
  return (
    <Modal open onClose={onClose} title={`员工详情 · ${employeePrimaryLabel(employee)}`} description={`${employeeSecondaryLabel(employee)} · 岗位版本 ${employee.version}`} size="xl" footer={actions}>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 items-center gap-3">
            <EmployeeAvatar employee={employee} size={56} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-[var(--text)]">{employeePrimaryLabel(employee)}</h2>
                {head && <Badge tone="info">部门负责人</Badge>}
                <Badge tone={lifecycleMeta[employee.lifecycle].tone}>{lifecycleMeta[employee.lifecycle].label}</Badge>
                <Badge tone={riskMeta[employee.risk].tone}>{riskMeta[employee.risk].label}</Badge>
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">{employeeSecondaryLabel(employee)}</p>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">服务 {employee.serviceObject} · 岗位负责人 {employee.owner}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-7 gap-y-2 text-xs">
            <span>
              <span className="block text-[11px] text-[var(--text-muted)]">运行环境</span>
              <strong className="mt-0.5 block font-medium">{employee.environment === 'production' ? '生产环境' : employee.environment === 'staging' ? '预发环境' : '沙箱环境'}</strong>
            </span>
            <span>
              <span className="block text-[11px] text-[var(--text-muted)]">质量评测</span>
              <strong className="mt-0.5 block font-medium">{employee.evaluation.score ?? '待评测'}{employee.evaluation.score ? ' 分' : ''}</strong>
            </span>
          </div>
        </div>
      </section>
      <div className="mt-5 grid gap-5 md:grid-cols-[164px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto border-b border-[var(--border)] pb-3 md:flex-col md:border-b-0 md:border-r md:pb-0 md:pr-4" aria-label="员工详情导航">
          {detailTabs.map((item) => (
            <button type="button" key={item.key} onClick={() => setTab(item.key)} className={cn('shrink-0 rounded-lg px-3 py-2.5 text-left text-xs transition-colors', tab === item.key ? 'bg-[var(--brand-light)] font-semibold text-[var(--brand)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]')}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="min-h-[330px] min-w-0">{renderContent()}</div>
      </div>
    </Modal>
  );
}

function CreateEmployeeModal({ open, onClose, loading, onCreate }: { open: boolean; onClose: () => void; loading: boolean; onCreate: (input: Partial<DigitalPartner>) => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [department, setDepartment] = useState('');
  const [description, setDescription] = useState('');
  const submit = () => {
    if (!name.trim() || !role.trim() || !department.trim()) return;
    onCreate({ name, role, department, description, risk: 'low', responsibilities: ['待配置岗位职责'], prohibitedActions: ['待配置禁止行为'] });
  };
  return (
    <Modal open={open} onClose={onClose} title="新建数字伙伴" description="填写花名与岗位信息即可创建。创建后进入「配置中」，请继续完善授权契约与能力装配，完成评测后再申请上岗。" size="md" footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button loading={loading} disabled={!name.trim() || !role.trim() || !department.trim()} onClick={submit}>创建数字伙伴</Button></>}>
      <div className="grid gap-4">
        <CreateField label="员工名称（花名）" value={name} onChange={setName} placeholder="例如：听潮" required />
        <CreateField label="岗位名称" value={role} onChange={setRole} placeholder="例如：安全事件分析专员" required />
        <CreateField label="所属部门" value={department} onChange={setDepartment} placeholder="例如：信息技术部" required />
        <label className="grid gap-1.5 text-xs font-medium">岗位说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="说明服务对象、业务目标与人工升级条件。" className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-normal outline-none focus:border-[var(--brand)]" /></label>
        <p className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] leading-5 text-[var(--text-muted)]">下一步建议：岗位配置 → 能力装配 → 质量评测 → 申请上岗。</p>
      </div>
    </Modal>
  );
}

function CreateField({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; required?: boolean }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {label}{required && <span className="ml-1 text-[var(--danger)]">*</span>}
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-xs font-normal outline-none focus:border-[var(--brand)]" />
    </label>
  );
}
