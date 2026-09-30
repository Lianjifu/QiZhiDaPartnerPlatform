import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { Badge, Button, KpiCard } from '@de/web-ui';
import { EmptyState, Modal, RoleReadonlyBanner } from '@/components/shared';
import { cn } from '@de/web-utils';
import { useT } from '@/i18n';
import type { DigitalEmployee, DigitalEmployeeBoundaryPolicy, DigitalEmployeeConfigurationVersion, DigitalEmployeeExecutionMode, DigitalEmployeeLifecycle, DigitalEmployeeResponsibility, DigitalEmployeeTemplate, DigitalEmployeeTemplateAdoption } from '@de/web-types';
import { DigitalEmployeeAvatar } from '@/components/DigitalEmployeeAvatar';
import { DepartmentTeamPanel } from '@/components/DepartmentTeamPanel';
import { roleCanMutate, rolePageCopy } from '@/features/role-nav/role-nav';
import { capabilityAssemblyCompleteness, compareCapabilityAssemblyEmployees, compareDigitalEmployees, compareOperationsEmployees, compareReleaseOnboardingEmployees, compareRoleSetupEmployees, DIGITAL_EMPLOYEE_DEPARTMENT_ORDER, employeePrimaryLabel, employeeSecondaryLabel, isDepartmentHead, OPERATIONS_HANDOFF_THRESHOLD, operationsHealth, releaseOnboardingCompleteness, roleSetupCompleteness, type OperationsHealthStage, type ReleaseOnboardingStage } from '@/lib/digital-employees';
import {
  ArrowUpRight, BriefcaseBusiness, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, Database,
  HeartPulse, Layers3, MessageSquare, Pause, Play, Plus,
  Route, Save, Search, ShieldAlert, ShieldCheck, Sparkles, UserRoundCheck, UsersRound,
  XCircle, Trash2,
} from 'lucide-react';

type ModuleTab = 'catalog' | 'roleSetup' | 'capabilities' | 'release' | 'operations';
type DetailTab = 'team' | 'profile' | 'boundary' | 'capabilities' | 'memory' | 'runtime' | 'evidence';

const CATALOG_PAGE_SIZE_OPTIONS = [4, 8, 12, 16, 24] as const;
const CATALOG_PAGE_SIZE_KEY = 'de.catalog.pageSize';
const CATALOG_DEFAULT_PAGE_SIZE = 8;
const ROLE_SETUP_PAGE_SIZE_KEY = 'de.roleSetup.pageSize';
const ROLE_SETUP_DEFAULT_PAGE_SIZE = 8;
const CAPABILITY_PAGE_SIZE_KEY = 'de.capabilities.pageSize';
const CAPABILITY_DEFAULT_PAGE_SIZE = 8;
const RELEASE_PAGE_SIZE_KEY = 'de.release.pageSize';
const RELEASE_DEFAULT_PAGE_SIZE = 8;
const OPERATIONS_PAGE_SIZE_KEY = 'de.operations.pageSize';
const OPERATIONS_DEFAULT_PAGE_SIZE = 8;
const PLAZA_PAGE_SIZE = 4;

function readStoredPageSize(key: string, fallback: number) {
  if (typeof window === 'undefined') return fallback;
  const raw = Number(window.localStorage.getItem(key));
  return (CATALOG_PAGE_SIZE_OPTIONS as readonly number[]).includes(raw) ? raw : fallback;
}

function readCatalogPageSize() {
  return readStoredPageSize(CATALOG_PAGE_SIZE_KEY, CATALOG_DEFAULT_PAGE_SIZE);
}

function readRoleSetupPageSize() {
  return readStoredPageSize(ROLE_SETUP_PAGE_SIZE_KEY, ROLE_SETUP_DEFAULT_PAGE_SIZE);
}

function readCapabilityPageSize() {
  return readStoredPageSize(CAPABILITY_PAGE_SIZE_KEY, CAPABILITY_DEFAULT_PAGE_SIZE);
}

function readReleasePageSize() {
  return readStoredPageSize(RELEASE_PAGE_SIZE_KEY, RELEASE_DEFAULT_PAGE_SIZE);
}

function readOperationsPageSize() {
  return readStoredPageSize(OPERATIONS_PAGE_SIZE_KEY, OPERATIONS_DEFAULT_PAGE_SIZE);
}

const tabs: Array<{ key: ModuleTab; labelKey: string; icon: typeof BriefcaseBusiness; description: string }> = [
  { key: 'catalog', labelKey: 'module.agents.tabs.catalog', icon: UsersRound, description: '按岗位与部门发现、筛选专家团队中的数字伙伴。' },
  { key: 'roleSetup', labelKey: 'module.agents.tabs.roleSetup', icon: BriefcaseBusiness, description: '维护岗位授权契约：档案、职责边界、人工接管与记忆策略。' },
  { key: 'capabilities', labelKey: 'module.agents.tabs.capabilities', icon: Layers3, description: '仅引用已发布的模型、知识、技能与流程技能。' },
  { key: 'release', labelKey: 'module.agents.tabs.release', icon: Route, description: '质量评测、上岗门禁与受控审批。' },
  { key: 'operations', labelKey: 'module.agents.tabs.operations', icon: HeartPulse, description: '在岗健康、人工交接与例外处置。' },
];

const lifecycleMeta: Record<DigitalEmployeeLifecycle, { label: string; tone: 'neutral' | 'success' | 'warn' | 'error' | 'info' }> = {
  draft: { label: '配置中', tone: 'neutral' }, testing: { label: '试运行', tone: 'info' }, pending_approval: { label: '待上岗审批', tone: 'warn' }, active: { label: '在岗', tone: 'success' }, paused: { label: '已暂停', tone: 'neutral' }, quarantined: { label: '已隔离', tone: 'error' },
};

const riskMeta = { low: { label: '低风险', tone: 'success' as const }, medium: { label: '中风险', tone: 'warn' as const }, high: { label: '高风险', tone: 'error' as const } };
const departmentOrder = DIGITAL_EMPLOYEE_DEPARTMENT_ORDER;

const catalogSegments = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '可协作', hint: '已上岗，可发起专家协同' },
  { key: 'onboarding', label: '待上岗', hint: '配置中或试运行' },
  { key: 'attention', label: '需关注', hint: '异常、暂停或隔离' },
] as const;

type CatalogSegment = (typeof catalogSegments)[number]['key'];

function matchesCatalogSegment(employee: DigitalEmployee, segment: CatalogSegment) {
  if (segment === 'all') return true;
  if (segment === 'active') return employee.lifecycle === 'active' && employee.runtime.anomalies === 0;
  if (segment === 'onboarding') return !['active', 'paused', 'quarantined'].includes(employee.lifecycle);
  return employee.lifecycle === 'paused' || employee.lifecycle === 'quarantined' || (employee.lifecycle === 'active' && employee.runtime.anomalies > 0);
}

function EmployeeAvatar({ employee, size = 40 }: { employee: DigitalEmployee; size?: number }) {
  return <DigitalEmployeeAvatar employee={employee} size={size} />;
}

function formatApiError(err: unknown, fallback: string) {
  if (err instanceof Error) return err.message.replace(/^E_[A-Z_]+:\s*/, '');
  return fallback;
}

function releaseRequestedBySelf(employee: DigitalEmployee, user?: { id?: string; name?: string } | null) {
  if (!user) return false;
  if (employee.release.requestedById && user.id && employee.release.requestedById === user.id) return true;
  if (employee.release.requestedBy && user.name && employee.release.requestedBy === user.name) return true;
  return false;
}

function preservedCapabilities(employee: DigitalEmployee): DigitalEmployee['capabilities'] {
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

function mergeUniqueNames(...groups: string[][]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const name of group) {
      const key = name.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

function autoBindRuntimeNames(catalog: DigitalEmployeeCapabilityCatalog) {
  return (catalog.runtimeTools ?? [])
    .filter((item) => item.autoBind !== false && (item.availability ?? 'default') !== 'opt_in')
    .map((item) => item.name);
}

function mergeBuiltinToolBindings(catalog: DigitalEmployeeCapabilityCatalog, tools: string[]) {
  const platform = (catalog.platformTools ?? []).map((item) => item.name);
  const runtimeDefault = autoBindRuntimeNames(catalog);
  const allRuntime = new Set((catalog.runtimeTools ?? []).map((item) => item.name));
  const optionalRuntime = (catalog.runtimeTools ?? [])
    .filter((item) => (item.availability ?? 'default') === 'opt_in' || item.autoBind === false)
    .map((item) => item.name);
  const enterprise = tools.filter((name) => !platform.includes(name) && !allRuntime.has(name));
  const selectedOptional = tools.filter((name) => optionalRuntime.includes(name));
  return mergeUniqueNames(platform, runtimeDefault, enterprise, selectedOptional);
}

function isBuiltinPlatformOrRuntimeTool(catalog: DigitalEmployeeCapabilityCatalog | undefined, name: string) {
  if (!catalog) return false;
  return (catalog.platformTools ?? []).some((item) => item.name === name)
    || (catalog.runtimeTools ?? []).some((item) => item.name === name);
}

function defaultToolExecutionMode(catalog: DigitalEmployeeCapabilityCatalog | undefined, name: string): DigitalEmployeeExecutionMode {
  return isBuiltinPlatformOrRuntimeTool(catalog, name) ? 'execute' : 'approval_required';
}

function normalizeBuiltinToolMode(
  catalog: DigitalEmployeeCapabilityCatalog | undefined,
  capabilityType: 'tool' | 'workflow' | 'skill',
  capabilityName: string,
  mode: DigitalEmployeeExecutionMode,
): DigitalEmployeeExecutionMode {
  if (capabilityType !== 'tool' || !isBuiltinPlatformOrRuntimeTool(catalog, capabilityName)) return mode;
  return mode === 'approval_required' || mode === 'recommend' ? 'execute' : mode;
}

function gateLabel(employee: DigitalEmployee) {
  if (employee.lifecycle === 'quarantined' || (employee.lifecycle === 'active' && employee.runtime.anomalies > 0)) return '需关注';
  if (employee.lifecycle === 'active') return '可协作';
  if (employee.release.status === 'pending_approval') return '待确认上岗';
  if (employee.evaluation.status === 'passed') return `评测 ${employee.evaluation.score ?? '—'} · 可申请上岗`;
  if (employee.evaluation.status === 'failed') return '评测未通过';
  if (employee.lifecycle === 'paused') return '已暂停';
  if (employee.runtime.anomalies > 0) return '需关注';
  return '配置与评测中';
}

function employeeTags(employee: DigitalEmployee) {
  return [...employee.capabilities.skills, ...employee.capabilities.knowledge, ...employee.capabilities.workflows].slice(0, 3);
}

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5"><div className="text-[11px] text-[var(--text-muted)]">{label}</div><div className="mt-1 text-sm font-semibold tabular-nums text-[var(--text)]">{value}{sub && <span className="ml-1 text-[11px] font-normal text-[var(--text-muted)]">{sub}</span>}</div></div>;
}

export default function DigitalEmployees() {
  const { t } = useT();
  const user = useAuthStore((state) => state.user);
  const canMutate = roleCanMutate(user?.role);
  const pageCopy = rolePageCopy('agents', user?.role);
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<ModuleTab>('catalog');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('全部部门');
  const [lifecycle, setLifecycle] = useState('全部状态');
  const [catalogSegment, setCatalogSegment] = useState<CatalogSegment>('all');
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogPageSize, setCatalogPageSize] = useState(readCatalogPageSize);
  const [roleSetupPage, setRoleSetupPage] = useState(1);
  const [roleSetupPageSize, setRoleSetupPageSize] = useState(readRoleSetupPageSize);
  const [capabilityPage, setCapabilityPage] = useState(1);
  const [capabilityPageSize, setCapabilityPageSize] = useState(readCapabilityPageSize);
  const { data: employees = [], isLoading } = useApiQuery<DigitalEmployee[]>(['digital-employees'], '/api/digital-employees');
  const { data: overview } = useApiQuery<{ total: number; active: number; pending: number; anomalies: number; costToday: number }>(['digital-employees', 'overview'], '/api/digital-employees/overview');
  const createEmployee = useApiMutation<DigitalEmployee, Partial<DigitalEmployee>>('/api/digital-employees', { onSuccess: (employee) => { setCreateOpen(false); setSelectedId(employee.id); } });

  useEffect(() => {
    const employeeId = searchParams.get('employeeId') ?? searchParams.get('id');
    if (employeeId) setSelectedId(employeeId);
    const tabParam = searchParams.get('tab');
    if (tabParam && (['catalog', 'roleSetup', 'capabilities', 'release', 'operations'] as const).includes(tabParam as ModuleTab)) {
      setTab(tabParam as ModuleTab);
    }
  }, [searchParams]);

  const selected = employees.find((employee) => employee.id === selectedId) ?? null;
  const departments = useMemo(() => {
    const present = Array.from(new Set(employees.map((employee) => employee.department)));
    const ordered = departmentOrder.filter((item) => present.includes(item));
    const rest = present.filter((item) => !departmentOrder.includes(item)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return ['全部部门', ...ordered, ...rest];
  }, [employees]);
  const orderedEmployees = useMemo(() => [...employees].sort(compareDigitalEmployees), [employees]);
  const filtered = useMemo(() => employees.filter((employee) => {
    const matchesText = !query || [employee.name, employee.role, employee.department, employee.owner].join(' ').toLowerCase().includes(query.toLowerCase());
    return matchesText && (department === '全部部门' || employee.department === department) && (lifecycle === '全部状态' || lifecycleMeta[employee.lifecycle].label === lifecycle);
  }).sort(compareDigitalEmployees), [employees, query, department, lifecycle]);

  const catalogSegmentCounts = useMemo(() => ({
    all: filtered.length,
    active: filtered.filter((item) => matchesCatalogSegment(item, 'active')).length,
    onboarding: filtered.filter((item) => matchesCatalogSegment(item, 'onboarding')).length,
    attention: filtered.filter((item) => matchesCatalogSegment(item, 'attention')).length,
  }), [filtered]);

  const catalogItems = useMemo(
    () => filtered.filter((item) => matchesCatalogSegment(item, catalogSegment)),
    [filtered, catalogSegment],
  );

  const roleSorted = useMemo(() => [...filtered].sort(compareRoleSetupEmployees), [filtered]);
  const roleSetupKpis = useMemo(() => {
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

  const capabilitySorted = useMemo(() => [...filtered].sort(compareCapabilityAssemblyEmployees), [filtered]);
  const capabilityKpis = useMemo(() => {
    let noModel = 0;
    let noAssets = 0;
    let ready = 0;
    for (const item of capabilitySorted) {
      const completeness = capabilityAssemblyCompleteness(item);
      if (!completeness.modelOk) noModel += 1;
      else if (!completeness.assetsOk) noAssets += 1;
      if (completeness.ready) ready += 1;
    }
    return { noModel, noAssets, ready };
  }, [capabilitySorted]);

  useEffect(() => { setCatalogPage(1); }, [query, department, lifecycle, catalogPageSize, catalogSegment]);
  useEffect(() => { window.localStorage.setItem(CATALOG_PAGE_SIZE_KEY, String(catalogPageSize)); }, [catalogPageSize]);
  useEffect(() => { setRoleSetupPage(1); }, [query, department, lifecycle, roleSetupPageSize]);
  useEffect(() => { window.localStorage.setItem(ROLE_SETUP_PAGE_SIZE_KEY, String(roleSetupPageSize)); }, [roleSetupPageSize]);
  useEffect(() => { setCapabilityPage(1); }, [query, department, lifecycle, capabilityPageSize]);
  useEffect(() => { window.localStorage.setItem(CAPABILITY_PAGE_SIZE_KEY, String(capabilityPageSize)); }, [capabilityPageSize]);

  const catalogPageCount = Math.max(1, Math.ceil(catalogItems.length / catalogPageSize));
  const catalogPageSafe = Math.min(catalogPage, catalogPageCount);
  const catalogPageItems = useMemo(
    () => catalogItems.slice((catalogPageSafe - 1) * catalogPageSize, catalogPageSafe * catalogPageSize),
    [catalogItems, catalogPageSafe, catalogPageSize],
  );

  const roleSetupPageCount = Math.max(1, Math.ceil(roleSorted.length / roleSetupPageSize));
  const roleSetupPageSafe = Math.min(roleSetupPage, roleSetupPageCount);
  const roleSetupPageItems = useMemo(
    () => roleSorted.slice((roleSetupPageSafe - 1) * roleSetupPageSize, roleSetupPageSafe * roleSetupPageSize),
    [roleSorted, roleSetupPageSafe, roleSetupPageSize],
  );

  const capabilityPageCount = Math.max(1, Math.ceil(capabilitySorted.length / capabilityPageSize));
  const capabilityPageSafe = Math.min(capabilityPage, capabilityPageCount);
  const capabilityPageItems = useMemo(
    () => capabilitySorted.slice((capabilityPageSafe - 1) * capabilityPageSize, capabilityPageSafe * capabilityPageSize),
    [capabilitySorted, capabilityPageSafe, capabilityPageSize],
  );

  return (
    <div className="de-employee-page h-full min-w-0 overflow-y-auto bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5">
      <div className="space-y-3">
        <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
          <div className="flex items-start justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg"><BriefcaseBusiness className="h-4 w-4" /></div>
                <h1 className="text-base font-semibold text-[var(--text)]">{pageCopy.title}</h1>
              </div>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{pageCopy.subtitle}</p>
            </div>
            {canMutate && (
              <div className="flex shrink-0 gap-2">
                <button type="button" className="de-employee-btn" onClick={() => { setTab('catalog'); setTemplateOpen(true); }}><Sparkles className="h-3.5 w-3.5" />从岗位蓝图创建</button>
                <button type="button" className="de-employee-btn de-employee-btn--primary" onClick={() => { setTab('catalog'); setCreateOpen(true); }}><Plus className="h-3.5 w-3.5" />新建数字伙伴</button>
              </div>
            )}
          </div>
          <div className="px-5"><RoleReadonlyBanner className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]" /></div>
          <div className="de-employee-tabs flex overflow-x-auto px-3" role="tablist" aria-label="数字伙伴功能">
            {tabs.map((item) => {
              const TabIcon = item.icon;
              return (
                <button type="button" key={item.key} onClick={() => setTab(item.key)} className={cn('de-employee-tab flex shrink-0 items-center gap-1.5 px-3 py-3 text-xs transition-colors', tab === item.key && 'is-active')}>
                  <TabIcon className="h-3.5 w-3.5" />{t(item.labelKey)}
                </button>
              );
            })}
          </div>
        </section>

        {tab === 'catalog' && <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="在册专家" value={overview?.total ?? 0} sub="个" icon={UsersRound} tone="brand" size="comfortable" />
            <KpiCard label="已上岗" value={overview?.active ?? 0} sub="个" icon={CheckCircle2} tone="success" size="comfortable" />
            <KpiCard label="待上岗审批" value={overview?.pending ?? 0} sub="个" icon={Clock3} tone="warn" size="comfortable" />
            <KpiCard label="运行异常" value={overview?.anomalies ?? 0} sub="个" icon={ShieldAlert} tone={(overview?.anomalies ?? 0) > 0 ? 'warn' : 'success'} size="comfortable" />
          </section>
          <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ boxShadow: 'var(--saas-divider)' }}>
              <div className="relative min-w-[210px] flex-1"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--brand)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索专家、岗位、部门或负责人" className="de-employee-input h-9 w-full rounded-lg bg-[var(--bg)] pl-8 pr-3 text-xs outline-none" /></div>
              <select value={lifecycle} onChange={(event) => setLifecycle(event.target.value)} className="de-employee-input h-9 rounded-lg bg-[var(--bg)] px-2 text-xs text-[var(--text-secondary)]">{['全部状态', ...Object.values(lifecycleMeta).map((item) => item.label)].map((item) => <option key={item}>{item}</option>)}</select>
            </div>
            <div className="flex gap-1 overflow-x-auto px-4 py-2.5" style={{ boxShadow: 'var(--saas-divider)' }}>{departments.map((item) => <button type="button" key={item} onClick={() => setDepartment(item)} className={cn('de-employee-chip shrink-0 rounded-md px-3 py-1.5 text-xs transition-colors', department === item && 'is-active')}>{item}</button>)}</div>
            <div className="flex gap-1 overflow-x-auto px-4 py-2.5" style={{ boxShadow: 'var(--saas-divider)' }} role="tablist" aria-label="专家目录分类">
              {catalogSegments.map((segment) => (
                <button
                  type="button"
                  key={segment.key}
                  role="tab"
                  aria-selected={catalogSegment === segment.key}
                  title={'hint' in segment ? segment.hint : undefined}
                  onClick={() => setCatalogSegment(segment.key)}
                  className={cn('de-employee-chip shrink-0 rounded-md px-3 py-1.5 text-xs transition-colors', catalogSegment === segment.key && 'is-active')}
                >
                  {segment.label}
                  <span className="ml-1.5 tabular-nums text-[10px] opacity-70">{catalogSegmentCounts[segment.key]}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4">
              <div>
                <h2 className="text-sm font-semibold">专家目录</h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {catalogSegment === 'all'
                    ? '按岗位与部门发现可协作的数字伙伴；上岗门禁在「上岗发布」中推进。'
                    : (catalogSegments.find((item) => item.key === catalogSegment) as { hint?: string } | undefined)?.hint ?? '按分类浏览数字伙伴。'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  每页
                  <select
                    value={catalogPageSize}
                    onChange={(event) => setCatalogPageSize(Number(event.target.value))}
                    className="de-employee-input h-8 rounded-lg bg-[var(--bg)] px-2 text-xs text-[var(--text-secondary)]"
                    aria-label="每页展示数量"
                  >
                    {CATALOG_PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} 个</option>)}
                  </select>
                </label>
                <span className="text-xs text-[var(--text-muted)]">{catalogItems.length} 位专家</span>
              </div>
            </div>
            {isLoading ? <div className="p-8 text-center text-xs text-[var(--text-muted)]">正在载入数字伙伴…</div> : catalogItems.length === 0 ? <EmptyState icon={BriefcaseBusiness} title="没有匹配的数字伙伴" description="调整筛选或分类条件，或新建岗位数字伙伴。" /> : (
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {catalogPageItems.map((employee) => <EmployeeCard key={employee.id} employee={employee} onSelect={() => setSelectedId(employee.id)} />)}
                </div>
                {catalogPageCount > 1 && (
                  <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                    <span className="text-[11px] text-[var(--text-muted)]">第 {catalogPageSafe} / {catalogPageCount} 页 · 每页 {catalogPageSize} 个</span>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="secondary" disabled={catalogPageSafe <= 1} onClick={() => setCatalogPage((page) => Math.max(1, page - 1))}><ChevronLeft className="h-3.5 w-3.5" />上一页</Button>
                      <Button size="sm" variant="secondary" disabled={catalogPageSafe >= catalogPageCount} onClick={() => setCatalogPage((page) => Math.min(catalogPageCount, page + 1))}>下一页<ChevronRight className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
          <Modal open={templateOpen} onClose={() => setTemplateOpen(false)} title="从岗位蓝图创建" description="采用经治理验证的岗位模板，在当前工作区创建数字伙伴；仍需完善配置、完成评测后即可申请上岗。" size="xl"><EmployeePlaza employees={employees} onCreate={() => setCreateOpen(true)} onAdopt={(employeeId) => { setTemplateOpen(false); setSelectedId(employeeId); }} onClose={() => setTemplateOpen(false)} /></Modal>
        </>}

        {tab === 'roleSetup' && (
          <div className="space-y-3">
            <div className="de-employee-hint rounded-xl px-4 py-3 text-xs leading-5 text-[var(--text-secondary)]">
              岗位配置只维护授权契约；能力引用请到「能力装配」；评测上岗请到「上岗发布」。保存后立即生效。
            </div>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <KpiCard label="待补档案" value={roleSetupKpis.profilePending} sub="个" icon={BriefcaseBusiness} tone={roleSetupKpis.profilePending ? 'warn' : 'success'} size="comfortable" />
              <KpiCard label="边界待完善" value={roleSetupKpis.boundaryPending} sub="个" icon={ShieldAlert} tone={roleSetupKpis.boundaryPending ? 'warn' : 'success'} size="comfortable" />
              <KpiCard label="契约完整" value={roleSetupKpis.contractReady} sub="个" icon={CheckCircle2} tone="success" size="comfortable" />
            </section>
            <WorkbenchListShell
              title="岗位配置"
              description="按未完整优先排列；行内展示档案 / 边界 / 记忆检查，点击进入岗位授权契约工作台。"
              countLabel={`${roleSorted.length} 个岗位`}
              pageSize={roleSetupPageSize}
              onPageSizeChange={setRoleSetupPageSize}
              pageSizeAriaLabel="岗位配置每页数量"
              columns={['岗位专家', '契约检查', '状态', '操作']}
              empty="暂无需要配置的员工"
              emptyIcon={BriefcaseBusiness}
              itemCount={roleSetupPageItems.length}
              footer={roleSetupPageCount > 1 ? (
                <WorkbenchPagination page={roleSetupPageSafe} pageCount={roleSetupPageCount} pageSize={roleSetupPageSize} onPrev={() => setRoleSetupPage((page) => Math.max(1, page - 1))} onNext={() => setRoleSetupPage((page) => Math.min(roleSetupPageCount, page + 1))} />
              ) : undefined}
            >
              {roleSetupPageItems.map((employee) => (
                <RoleSetupListRow key={employee.id} employee={employee} onSelect={() => setSelectedId(employee.id)} />
              ))}
            </WorkbenchListShell>
          </div>
        )}

        {tab === 'capabilities' && (
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
              <KpiCard label="未绑模型" value={capabilityKpis.noModel} sub="个" icon={Layers3} tone={capabilityKpis.noModel ? 'warn' : 'success'} size="comfortable" />
              <KpiCard label="缺执行能力" value={capabilityKpis.noAssets} sub="个" icon={ShieldAlert} tone={capabilityKpis.noAssets ? 'warn' : 'success'} size="comfortable" />
              <KpiCard label="装配完整" value={capabilityKpis.ready} sub="个" icon={CheckCircle2} tone="success" size="comfortable" />
            </section>
            <WorkbenchListShell
              title="能力装配"
              description="按未完整优先排列；行内展示模型 / 执行能力 / 授权检查，点击进入受控装配工作台。"
              countLabel={`${capabilitySorted.length} 个岗位`}
              pageSize={capabilityPageSize}
              onPageSizeChange={setCapabilityPageSize}
              pageSizeAriaLabel="能力装配每页数量"
              columns={['岗位专家', '装配检查', '状态', '操作']}
              empty="暂无员工可装配"
              emptyIcon={Layers3}
              itemCount={capabilityPageItems.length}
              footer={capabilityPageCount > 1 ? (
                <WorkbenchPagination page={capabilityPageSafe} pageCount={capabilityPageCount} pageSize={capabilityPageSize} onPrev={() => setCapabilityPage((page) => Math.max(1, page - 1))} onNext={() => setCapabilityPage((page) => Math.min(capabilityPageCount, page + 1))} />
              ) : undefined}
            >
              {capabilityPageItems.map((employee) => (
                <CapabilityListRow key={employee.id} employee={employee} onSelect={() => setSelectedId(employee.id)} />
              ))}
            </WorkbenchListShell>
          </div>
        )}

        {tab === 'release' && <OnboardingManagementView employees={orderedEmployees} onSelect={setSelectedId} onGoToModule={setTab} />}
        {tab === 'operations' && <OperationsView employees={orderedEmployees} onSelect={setSelectedId} onGoToModule={setTab} />}
      </div>
      <EmployeeDetailModal employee={selected} context={tab} onClose={() => setSelectedId(null)} onGoToModule={setTab} />
      <CreateEmployeeModal open={createOpen} onClose={() => setCreateOpen(false)} loading={createEmployee.isPending} onCreate={(input) => createEmployee.mutate(input)} />
    </div>
  );
}

function EmployeeCard({ employee, onSelect }: { employee: DigitalEmployee; onSelect: () => void }) {
  const navigate = useNavigate();
  const meta = lifecycleMeta[employee.lifecycle];
  const tags = employeeTags(employee);
  const gate = gateLabel(employee);
  return (
    <article className="de-employee-card group relative overflow-hidden rounded-xl bg-[var(--surface-1)] p-4 text-left">
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <EmployeeAvatar employee={employee} size={44} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <div className="truncate text-sm font-semibold text-[var(--text)]">{employeePrimaryLabel(employee)}</div>
                {employee.lifecycle === 'active' && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--success)]" title="在岗" />}
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-muted)]">{employeeSecondaryLabel(employee)}</div>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--brand)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {isDepartmentHead(employee) && <Badge tone="info">部门负责人</Badge>}
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <Badge tone={riskMeta[employee.risk].tone}>{riskMeta[employee.risk].label}</Badge>
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-secondary)]">{isDepartmentHead(employee) ? '可调度本部门专家，并可发起跨部门协办。' : gate}</p>
        {tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{tags.map((tag) => <span key={tag} className="max-w-[110px] truncate rounded px-2 py-0.5 text-[10px] text-[var(--text-muted)]" style={{ boxShadow: 'var(--saas-ring)' }}>{tag}</span>)}</div>}
      </button>
      {employee.lifecycle === 'active' && (
        <div className="mt-3 flex justify-end gap-2 pt-3" style={{ boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--brand) 14%, transparent)' }}>
          {isDepartmentHead(employee) && (
            <button type="button" className="de-employee-btn" onClick={(event) => { event.stopPropagation(); onSelect(); }}>
              <UsersRound className="h-3.5 w-3.5" />班组调度
            </button>
          )}
          <button type="button" className="de-employee-btn de-employee-btn--primary" onClick={(event) => { event.stopPropagation(); navigate(`/copilot?employeeId=${employee.id}`); }}>
            <MessageSquare className="h-3.5 w-3.5" />发起协作
          </button>
        </div>
      )}
    </article>
  );
}

function EmployeePlaza({ employees, onCreate, onAdopt, onClose }: { employees: DigitalEmployee[]; onCreate: () => void; onAdopt: (employeeId: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('全部部门');
  const [source, setSource] = useState<'all' | 'platform' | 'department'>('all');
  const [publishOpen, setPublishOpen] = useState(false);
  const [page, setPage] = useState(1);
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const canMutate = roleCanMutate(useAuthStore((state) => state.user?.role));
  const { data: templates = [] } = useApiQuery<DigitalEmployeeTemplate[]>(['digital-employee-templates'], '/api/digital-employee-templates');
  const { data: adoptions = [] } = useApiQuery<DigitalEmployeeTemplateAdoption[]>(['digital-employee-template-adoptions'], '/api/digital-employee-template-adoptions');
  const adopt = useApiMutation<DigitalEmployee, { templateId: string }>((input) => `/api/digital-employee-templates/${input.templateId}/adopt`, { onSuccess: (employee) => onAdopt(employee.id) });
  const govern = useApiMutation<DigitalEmployeeTemplate, { id: string; status: 'certified' | 'deprecated' }>((input) => `/api/digital-employee-templates/${input.id}`, undefined, 'PATCH');
  const departments = useMemo(() => {
    const present = Array.from(new Set(templates.map((item) => item.department)));
    const ordered = departmentOrder.filter((item) => present.includes(item));
    const rest = present.filter((item) => !departmentOrder.includes(item)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return ['全部部门', ...ordered, ...rest];
  }, [templates]);
  const filtered = useMemo(
    () => templates.filter((item) => (department === '全部部门' || item.department === department) && (source === 'all' || item.source === source) && (!query || [item.name, item.role, item.department, ...item.tags].join(' ').toLowerCase().includes(query.toLowerCase()))),
    [templates, department, source, query],
  );
  useEffect(() => { setPage(1); }, [query, department, source]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PLAZA_PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const pageItems = filtered.slice((pageSafe - 1) * PLAZA_PAGE_SIZE, pageSafe * PLAZA_PAGE_SIZE);
  const statusLabel = (status: DigitalEmployeeTemplate['status']): readonly [string, 'success' | 'warn' | 'neutral'] => (
    status === 'certified' ? ['已认证', 'success'] : status === 'review' ? ['待认证', 'warn'] : ['已弃用', 'neutral']
  );
  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-xl bg-[var(--surface-1)]" style={{ boxShadow: 'var(--saas-ring), var(--saas-elev-1)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg"><Sparkles className="h-4 w-4" /></div>
              <h3 className="text-base font-semibold">岗位蓝图</h3>
            </div>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">采用已认证蓝图创建数字伙伴；仍需配置、评测后申请上岗。步骤：选蓝图 → 创建员工 → 完善门禁。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && canMutate && <Button size="sm" variant="secondary" onClick={() => setPublishOpen(true)}><Plus className="h-3.5 w-3.5" />发布部门蓝图</Button>}
            {canMutate && <Button size="sm" variant="secondary" onClick={onCreate}><Plus className="h-3.5 w-3.5" />新建自定义员工</Button>}
            <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--bg)] px-5 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--brand)]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索岗位、部门或能力标签" className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] pl-8 pr-3 text-xs outline-none focus:border-[var(--brand)]" />
          </div>
          <select value={source} onChange={(event) => setSource(event.target.value as typeof source)} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs">
            <option value="all">全部来源</option>
            <option value="platform">平台认证</option>
            <option value="department">部门共享</option>
          </select>
        </div>
        <div className="flex gap-1 overflow-x-auto border-t border-[var(--border)] px-5 py-2.5">
          {departments.map((item) => (
            <button type="button" key={item} onClick={() => setDepartment(item)} className={cn('shrink-0 rounded-md px-3 py-1.5 text-xs', department === item ? 'bg-[var(--brand-light)] font-semibold text-[var(--brand)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]')}>{item}</button>
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">可采用蓝图</h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{filtered.length} 个蓝图 · 每页 {PLAZA_PAGE_SIZE} 个 · 认证蓝图可直接采用</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {pageItems.map((template) => {
            const [label, tone] = statusLabel(template.status);
            return (
              <article key={template.id} className="flex min-h-[285px] flex-col rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <DigitalEmployeeAvatar employee={{ id: template.id, name: template.name, department: template.department }} size={40} />
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-semibold">{template.name}</h4>
                      <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{template.role}</p>
                    </div>
                  </div>
                  <Badge tone={tone}>{label}</Badge>
                </div>
                <p className="mt-3 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">{template.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone="neutral">{template.department}</Badge>
                  <Badge tone={riskMeta[template.risk].tone}>{riskMeta[template.risk].label}</Badge>
                  <Badge tone="info">v{template.version}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {template.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded bg-[var(--surface-1)] px-2 py-1 text-[11px] text-[var(--text-muted)]">{tag}</span>)}
                </div>
                <div className="mt-auto grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--text-muted)]">
                  <span>质量 {template.evaluationScore ?? '—'} 分</span>
                  <span className="text-right">已采用 {template.adoptionCount} 次</span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {canMutate && <Button size="sm" className="flex-1" disabled={template.status === 'deprecated'} loading={adopt.isPending && adopt.variables?.templateId === template.id} onClick={() => adopt.mutate({ templateId: template.id })}>采用并创建</Button>}
                  {isAdmin && canMutate && template.source === 'department' && template.status !== 'deprecated' && (
                    <Button size="sm" variant="secondary" loading={govern.isPending && govern.variables?.id === template.id} onClick={() => govern.mutate({ id: template.id, status: template.status === 'review' ? 'certified' : 'deprecated' })}>
                      {template.status === 'review' ? '认证' : '下架'}
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {pageCount > 1 && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
            <span className="text-[11px] text-[var(--text-muted)]">第 {pageSafe} / {pageCount} 页</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={pageSafe <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-3.5 w-3.5" />上一页</Button>
              <Button size="sm" variant="secondary" disabled={pageSafe >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>下一页<ChevronRight className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        )}
      </section>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h3 className="text-sm font-semibold">采用记录</h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">保留蓝图来源和版本；实例后续评测、上岗与审计独立执行。</p>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {adoptions.length ? adoptions.map((item) => {
            const template = templates.find((candidate) => candidate.id === item.templateId);
            const employee = employees.find((candidate) => candidate.id === item.employeeId);
            return (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <DigitalEmployeeAvatar employee={{ id: template?.id ?? item.templateId, name: template?.name ?? item.templateId, department: template?.department }} size={32} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{template?.name ?? item.templateId}</div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">蓝图 v{item.templateVersion} · 采用人 {item.adoptedBy} · 员工 {employee?.name ?? '已归档'}</div>
                  </div>
                </div>
                <Badge tone={lifecycleMeta[item.status].tone}>{lifecycleMeta[item.status].label}</Badge>
              </div>
            );
          }) : <div className="px-5 py-8 text-center text-xs text-[var(--text-muted)]">尚未采用岗位蓝图</div>}
        </div>
      </section>
      <PublishDepartmentTemplateModal open={publishOpen} onClose={() => setPublishOpen(false)} />
    </div>
  );
}

function PublishDepartmentTemplateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [department, setDepartment] = useState('');
  const [serviceObject, setServiceObject] = useState('');
  const [description, setDescription] = useState('');
  const [risk, setRisk] = useState<DigitalEmployee['risk']>('low');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const publish = useApiMutation<DigitalEmployeeTemplate, Partial<DigitalEmployeeTemplate>>('/api/digital-employee-templates', {
    onSuccess: () => { setError(null); onClose(); },
    onError: (reason) => setError(reason instanceof Error ? reason.message : '模板发布失败，请稍后重试。'),
  });
  const submit = () => {
    if (!name.trim() || !role.trim() || !department.trim()) return;
    publish.mutate({ name, role, department, serviceObject, description, risk, tags: tags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean) });
  };
  return <Modal open={open} onClose={onClose} title="发布部门蓝图" description="蓝图仅在当前工作区共享，发布后进入待认证状态；不会直接创建或上岗数字伙伴。" size="md" footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button loading={publish.isPending} disabled={!name.trim() || !role.trim() || !department.trim()} onClick={submit}>提交认证</Button></>}><div className="grid gap-4"><div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-xs leading-5 text-[var(--text-muted)]">蓝图承载岗位边界与默认能力；模型、知识、技能、工作流和渠道仍须在各自中心完成治理与发布。</div><div className="grid gap-3 sm:grid-cols-2"><Field label="蓝图名称" value={name} onChange={setName} placeholder="例如：变更风险分析专员" required /><Field label="岗位角色" value={role} onChange={setRole} placeholder="例如：变更影响评估" required /><Field label="所属部门" value={department} onChange={setDepartment} placeholder="例如：信息技术部" required /><Field label="服务对象" value={serviceObject} onChange={setServiceObject} placeholder="例如：应用交付团队" /><SelectField label="风险等级" value={risk} onChange={(value) => setRisk(value as DigitalEmployee['risk'])} options={[['low', '低风险'], ['medium', '中风险'], ['high', '高风险']]} /><Field label="能力标签" value={tags} onChange={setTags} placeholder="例如：变更、风险评估" /></div><label className="grid gap-1.5 text-xs font-medium">岗位说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="说明岗位服务目标、默认职责与需要人工介入的边界。" className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-normal outline-none focus:border-[var(--brand)]" /></label>{error && <p role="alert" className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-light)] px-3 py-2 text-xs text-[var(--danger)]">{error}</p>}</div></Modal>;
}

function OnboardingManagementView({ employees, onSelect, onGoToModule }: { employees: DigitalEmployee[]; onSelect: (id: string) => void; onGoToModule: (tab: ModuleTab) => void }) {
  type ReleaseSegment = 'all' | ReleaseOnboardingStage;
  const [segment, setSegment] = useState<ReleaseSegment>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(readReleasePageSize);

  const queue = useMemo(
    () => employees.filter((item) => item.release.status !== 'released').sort(compareReleaseOnboardingEmployees),
    [employees],
  );

  const counts = useMemo(() => {
    const next = { all: queue.length, pending_eval: 0, eval_failed: 0, ready_to_request: 0, pending_approval: 0, released: 0 };
    for (const item of queue) {
      const stage = releaseOnboardingCompleteness(item).stage;
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
    () => (segment === 'all' ? queue : queue.filter((item) => releaseOnboardingCompleteness(item).stage === segment)),
    [queue, segment],
  );

  useEffect(() => { setPage(1); }, [segment, pageSize, employees]);
  useEffect(() => { window.localStorage.setItem(RELEASE_PAGE_SIZE_KEY, String(pageSize)); }, [pageSize]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(page, pageCount);
  const pageItems = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

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

function OperationsView({ employees, onSelect, onGoToModule }: { employees: DigitalEmployee[]; onSelect: (id: string) => void; onGoToModule: (tab: ModuleTab) => void }) {
  type OpsSegment = 'all' | OperationsHealthStage;
  const [segment, setSegment] = useState<OpsSegment>('needs_attention');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(readOperationsPageSize);
  const [dispose, setDispose] = useState<{ employee: DigitalEmployee; lifecycle: 'paused' | 'quarantined' | 'active' } | null>(null);
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const transition = useApiMutation<DigitalEmployee, { id: string; lifecycle: DigitalEmployeeLifecycle; reason?: string; confirmed?: boolean }>(({ id }) => `/api/digital-employees/${id}/lifecycle`);

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
        运行管理只做在岗健康观测与受控启停/隔离；岗位档案请到「岗位配置」，能力引用请到「能力装配」。交接偏高阈值：≥ {OPERATIONS_HANDOFF_THRESHOLD} 次 / 24h。
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="de-employee-btn text-[11px]" onClick={() => onGoToModule('roleSetup')}>岗位配置</button>
          <button type="button" className="de-employee-btn text-[11px]" onClick={() => onGoToModule('capabilities')}>能力装配</button>
        </div>
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

function OperationsListRow({
  employee,
  isAdmin,
  onSelect,
  onDispose,
}: {
  employee: DigitalEmployee;
  isAdmin: boolean;
  onSelect: () => void;
  onDispose: (lifecycle: 'paused' | 'quarantined' | 'active') => void;
}) {
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

function OperationsDisposeModal({
  employee,
  targetLifecycle,
  loading,
  onClose,
  onConfirm,
}: {
  employee: DigitalEmployee;
  targetLifecycle: 'paused' | 'quarantined' | 'active';
  loading: boolean;
  onClose: () => void;
  onConfirm: (input: { reason: string; confirmed?: boolean }) => void;
}) {
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

function WorkbenchListShell({
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
  emptyIcon: EmptyIcon = BriefcaseBusiness,
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
  toolbar?: ReactNode;
  children: ReactNode;
  empty: string;
  emptyIcon?: typeof BriefcaseBusiness;
  footer?: ReactNode;
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
              {CATALOG_PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size} 个</option>)}
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

function WorkbenchPagination({ page, pageCount, pageSize, onPrev, onNext }: { page: number; pageCount: number; pageSize: number; onPrev: () => void; onNext: () => void }) {
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

function WorkbenchIdentity({ employee, onSelect, metaLine }: { employee: DigitalEmployee; onSelect: () => void; metaLine?: string }) {
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

function WorkbenchCheckStrip({ items }: { items: Array<{ label: string; ok: boolean }> }) {
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

function RoleSetupListRow({ employee, onSelect }: { employee: DigitalEmployee; onSelect: () => void }) {
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

function CapabilityListRow({ employee, onSelect }: { employee: DigitalEmployee; onSelect: () => void }) {
  const completeness = capabilityAssemblyCompleteness(employee);
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

function ReleaseListRow({ employee, onSelect }: { employee: DigitalEmployee; onSelect: () => void }) {
  const completeness = releaseOnboardingCompleteness(employee);
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
        metaLine={employee.evaluation.score != null ? `评测 ${employee.evaluation.score} 分 · ${employee.evaluation.status === 'passed' ? '已通过' : employee.evaluation.status === 'failed' ? '未通过' : '进行中'}` : '尚未评测'}
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

type EmployeeConfigurationInput = {
  /** capability = 能力装配（直接生效）；role = 岗位授权契约（在岗/生产/高风险仍需审批） */
  scope?: 'capability' | 'role';
  profile: Pick<DigitalEmployee, 'name' | 'role' | 'department' | 'description' | 'owner' | 'escalationOwner' | 'serviceObject' | 'risk' | 'environment'>;
  boundary: Pick<DigitalEmployee, 'responsibilities' | 'prohibitedActions' | 'handoffPolicy' | 'boundaryPolicy'>;
  capabilities: DigitalEmployee['capabilities'];
  memoryPolicy: DigitalEmployee['memoryPolicy'];
};
type EmployeeConfigurationResult = DigitalEmployeeConfigurationVersion & { requiresApproval: boolean };
type EmployeeConfigurationSection = 'profile' | 'boundary' | 'capabilities' | 'memory';
type CapabilityCatalogOption = { id: string; name: string; meta: string; removable?: boolean; builtin?: boolean; autoBind?: boolean; availability?: string };
type DigitalEmployeeCapabilityCatalog = {
  models: CapabilityCatalogOption[];
  knowledge: CapabilityCatalogOption[];
  skills: CapabilityCatalogOption[];
  tools: CapabilityCatalogOption[];
  workflows: CapabilityCatalogOption[];
  channels: CapabilityCatalogOption[];
  platformTools?: CapabilityCatalogOption[];
  runtimeTools?: CapabilityCatalogOption[];
};

const executionModeOptions: Array<[DigitalEmployeeExecutionMode, string]> = [['recommend', '仅建议'], ['approval_required', '需双重审批后执行'], ['execute', '可执行'], ['prohibited', '禁止']];
const environmentOptions = [['sandbox', '沙箱'], ['staging', '预发'], ['production', '生产']] as const;

function resolveBoundaryPolicy(employee: DigitalEmployee): DigitalEmployeeBoundaryPolicy {
  const stored = employee.boundaryPolicy;
  const storedIsComplete =
    !!stored &&
    Array.isArray(stored.responsibilities) &&
    Array.isArray(stored.capabilityModes) &&
    Array.isArray(stored.allowedEnvironments) &&
    !!stored.handoff &&
    Array.isArray(stored.handoff.triggers) &&
    Array.isArray(stored.handoff.approvers) &&
    Array.isArray(stored.handoff.notificationChannels);
  if (storedIsComplete) {
    return {
      ...stored,
      responsibilities: stored.responsibilities.map((item) => ({ ...item, deliverables: [...(item.deliverables ?? [])] })),
      capabilityModes: stored.capabilityModes.map((item) => ({ ...item })),
      allowedEnvironments: [...stored.allowedEnvironments],
      handoff: { ...stored.handoff, triggers: [...stored.handoff.triggers], approvers: [...stored.handoff.approvers], notificationChannels: [...stored.handoff.notificationChannels] },
    };
  }
  return {
    responsibilities: employee.responsibilities.map((title, index) => ({ id: `${employee.id}-responsibility-${index}`, title, objective: '在岗位授权范围内形成可复核的业务结果。', trigger: '收到工作请求或命中服务事件', deliverables: ['处理结论与处置证据'], evidenceRequired: true })),
    capabilityModes: [
      ...employee.capabilities.tools.map((capabilityName) => ({ capabilityType: 'tool' as const, capabilityName, mode: 'approval_required' as DigitalEmployeeExecutionMode })),
      ...employee.capabilities.workflows.map((capabilityName) => ({ capabilityType: 'workflow' as const, capabilityName, mode: 'approval_required' as DigitalEmployeeExecutionMode })),
      ...employee.capabilities.skills.map((capabilityName) => ({ capabilityType: 'skill' as const, capabilityName, mode: 'recommend' as DigitalEmployeeExecutionMode })),
    ],
    dataClassification: employee.risk === 'high' ? 'restricted' : 'confidential',
    allowedEnvironments: [employee.environment],
    handoff: { triggers: employee.handoffPolicy?.triggers?.length ? [...employee.handoffPolicy.triggers] : ['命中禁止行为', '需要业务判断'], approvers: [employee.escalationOwner], notificationChannels: [...employee.capabilities.channels], slaMinutes: employee.risk === 'high' ? 15 : 30 },
  };
}

function BoundaryPolicyEditor({ policy, capabilities, onChange, mode = 'role' }: { policy: DigitalEmployeeBoundaryPolicy; capabilities: DigitalEmployee['capabilities']; onChange: (policy: DigitalEmployeeBoundaryPolicy) => void; mode?: 'role' | 'capability' }) {
  const updateResponsibility = (index: number, patch: Partial<DigitalEmployeeResponsibility>) => onChange({ ...policy, responsibilities: policy.responsibilities.map((item, current) => current === index ? { ...item, ...patch } : item) });
  const setHandoff = (key: keyof DigitalEmployeeBoundaryPolicy['handoff'], value: string[] | number) => onChange({ ...policy, handoff: { ...policy.handoff, [key]: value } });
  const rows = [
    ...capabilities.tools.map((capabilityName) => ({ capabilityType: 'tool' as const, capabilityName, label: '工具' })),
    ...capabilities.workflows.map((capabilityName) => ({ capabilityType: 'workflow' as const, capabilityName, label: '工作流' })),
    ...capabilities.skills.map((capabilityName) => ({ capabilityType: 'skill' as const, capabilityName, label: '技能' })),
  ];
  const setCapabilityMode = (capabilityType: 'tool' | 'workflow' | 'skill', capabilityName: string, modeValue: DigitalEmployeeExecutionMode) => {
    const exists = policy.capabilityModes.some((item) => item.capabilityType === capabilityType && item.capabilityName === capabilityName);
    onChange({ ...policy, capabilityModes: exists ? policy.capabilityModes.map((item) => item.capabilityType === capabilityType && item.capabilityName === capabilityName ? { ...item, mode: modeValue } : item) : [...policy.capabilityModes, { capabilityType, capabilityName, mode: modeValue }] });
  };
  const modeOf = (capabilityType: 'tool' | 'workflow' | 'skill', capabilityName: string) => policy.capabilityModes.find((item) => item.capabilityType === capabilityType && item.capabilityName === capabilityName)?.mode ?? 'recommend';
  const setEnvironment = (environment: DigitalEmployeeBoundaryPolicy['allowedEnvironments'][number], checked: boolean) => onChange({ ...policy, allowedEnvironments: checked ? [...new Set([...policy.allowedEnvironments, environment])] : policy.allowedEnvironments.filter((item) => item !== environment) });
  const addResponsibility = () => onChange({ ...policy, responsibilities: [...policy.responsibilities, { id: `responsibility-${Date.now()}`, title: '未命名岗位职责', objective: '', trigger: '', deliverables: [], evidenceRequired: true }] });
  const updateArrayItem = (key: 'triggers' | 'approvers' | 'notificationChannels', index: number, value: string) => setHandoff(key, policy.handoff[key].map((item, current) => current === index ? value : item));
  const addArrayItem = (key: 'triggers' | 'approvers' | 'notificationChannels', placeholder: string) => setHandoff(key, [...policy.handoff[key], placeholder]);

  if (mode === 'capability') {
    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5">
          <div>
            <h3 className="text-sm font-semibold">执行边界（能力授权模式）</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">仅可对当前已装配的工具、工作流和技能授予执行模式；能力本体仍由各中心独立治理。岗位职责请到「岗位配置」维护。</p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <div className="min-w-[540px] divide-y divide-[var(--border)] text-xs">
              <div className="grid grid-cols-[minmax(180px,1fr)_92px_150px] gap-3 px-2 pb-2 text-[11px] text-[var(--text-muted)]"><span>已绑定能力</span><span>类型</span><span>授权模式</span></div>
              {rows.map((row) => (
                <div key={`${row.capabilityType}-${row.capabilityName}`} className="grid grid-cols-[minmax(180px,1fr)_92px_150px] items-center gap-3 px-2 py-2.5">
                  <span className="truncate font-medium">{row.capabilityName}</span>
                  <Badge tone="info">{row.label}</Badge>
                  <select value={modeOf(row.capabilityType, row.capabilityName)} onChange={(event) => setCapabilityMode(row.capabilityType, row.capabilityName, event.target.value as DigitalEmployeeExecutionMode)} className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs outline-none focus:border-[var(--brand)]">
                    {executionModeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
              ))}
              {!rows.length && <p className="px-2 py-3 text-xs text-[var(--text-muted)]">请先在上方引用至少一项工具、工作流或技能。</p>}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">岗位职责</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">每项职责需说明目标、触发条件与可复核交付，构成岗位授权的业务契约。</p>
          </div>
          <Button size="sm" variant="secondary" onClick={addResponsibility}><Plus className="h-3.5 w-3.5" />新增职责</Button>
        </div>
        <div className="mt-3 space-y-3">
          {policy.responsibilities.map((item, index) => (
            <article key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[var(--brand)]">职责 {String(index + 1).padStart(2, '0')}</span>
                {policy.responsibilities.length > 1 && (
                  <button type="button" onClick={() => onChange({ ...policy, responsibilities: policy.responsibilities.filter((_, current) => current !== index) })} className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--danger-light)] hover:text-[var(--danger)]" aria-label={`删除职责 ${item.title}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="职责名称" value={item.title} onChange={(value) => updateResponsibility(index, { title: value })} placeholder="例如：运行态势汇总" required />
                <Field label="业务目标" value={item.objective} onChange={(value) => updateResponsibility(index, { objective: value })} placeholder="例如：形成风险优先级建议" required />
                <Field label="触发条件" value={item.trigger} onChange={(value) => updateResponsibility(index, { trigger: value })} placeholder="例如：每日 09:00 / 重大事件" required />
                <Field label="交付与证据" value={item.deliverables.join('、')} onChange={(value) => updateResponsibility(index, { deliverables: value.split('、').map((entry) => entry.trim()).filter(Boolean) })} placeholder="例如：态势摘要、风险清单" />
                <label className="flex items-center gap-2 text-xs font-medium sm:col-span-2"><input type="checkbox" checked={item.evidenceRequired} onChange={(event) => updateResponsibility(index, { evidenceRequired: event.target.checked })} />要求留存处置证据</label>
              </div>
            </article>
          ))}
        </div>
      </section>
      <div className="rounded-lg border border-[var(--brand)]/20 bg-[var(--brand-light)] px-3 py-2.5 text-xs leading-5 text-[var(--text-secondary)]">
        能力授权模式（工具/技能/工作流执行边界）请到「能力装配」维护；此处只定义岗位职责与人工接管契约。
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5">
          <h3 className="text-sm font-semibold">升级与审批</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">命中触发条件后中止自主执行，通知接管人并保留审批、交接证据。</p>
          <div className="mt-3 space-y-2">
            {([['triggers', '接管触发条件', '例如：置信度不足'] as const, ['approvers', '接管负责人', '例如：值班经理'] as const, ['notificationChannels', '通知渠道', '例如：事件中心'] as const]).map(([key, label, placeholder]) => (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-medium">{label}</span>
                  <button type="button" onClick={() => addArrayItem(key, placeholder)} className="text-[11px] text-[var(--brand)]">+ 添加</button>
                </div>
                {policy.handoff[key].map((value, index) => (
                  <div key={`${key}-${index}`} className="mb-1.5 flex gap-1.5">
                    <input value={value} onChange={(event) => updateArrayItem(key, index, event.target.value)} placeholder={placeholder} className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs outline-none focus:border-[var(--brand)]" />
                    {policy.handoff[key].length > 1 && <button type="button" onClick={() => setHandoff(key, policy.handoff[key].filter((_, current) => current !== index))} className="rounded-md px-2 text-[var(--text-muted)] hover:bg-[var(--danger-light)] hover:text-[var(--danger)]">×</button>}
                  </div>
                ))}
              </div>
            ))}
            <NumberField label="接管 SLA" value={policy.handoff.slaMinutes} suffix="分钟" onChange={(value) => setHandoff('slaMinutes', value)} />
          </div>
        </section>
        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5">
          <h3 className="text-sm font-semibold">数据与范围</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">仅声明此岗位策略允许使用的数据级别和运行环境，不替代零信任、数据权限策略。</p>
          <div className="mt-3 grid gap-3">
            <SelectField label="最高数据分类" value={policy.dataClassification} onChange={(value) => onChange({ ...policy, dataClassification: value as DigitalEmployeeBoundaryPolicy['dataClassification'] })} options={[['internal', '内部'], ['confidential', '敏感'], ['restricted', '受限']]} />
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium">允许运行环境</legend>
              <div className="flex flex-wrap gap-3">
                {environmentOptions.map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    <input type="checkbox" checked={policy.allowedEnvironments.includes(value)} onChange={(event) => setEnvironment(value, event.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </section>
      </div>
    </div>
  );
}

function ContextualEmployeeDetail({ employee, context, onClose, onGoToModule }: { employee: DigitalEmployee; context: 'release' | 'operations'; onClose: () => void; onGoToModule?: (tab: ModuleTab) => void }) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const [message, setMessage] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [disposeLifecycle, setDisposeLifecycle] = useState<'paused' | 'quarantined' | 'active' | null>(null);
  const { data: evidence = [] } = useApiQuery<Array<{ id: string; time: string; actor: string; action: string; target: string; result: string }>>(['digital-employee', employee.id, 'evidence'], `/api/digital-employees/${employee.id}/evidence`);
  const evaluate = useApiMutation<DigitalEmployee, Record<string, never>>(() => `/api/digital-employees/${employee.id}/evaluate`, {
    onSuccess: (result) => setMessage(result.evaluation.status === 'passed' ? '评测已通过，可作为上岗门禁依据。' : '评测未通过，请按门禁缺失项补齐后复测。'),
    onError: (err) => setMessage(err instanceof Error ? err.message : '评测失败'),
  });
  const release = useApiMutation<DigitalEmployee, Record<string, never>>(() => `/api/digital-employees/${employee.id}/release`, {
    onSuccess: () => setMessage('已完成上岗，员工可进入运行协作。'),
    onError: (err) => setMessage(err instanceof Error ? err.message : '上岗失败'),
  });
  const withdraw = useApiMutation<DigitalEmployee, Record<string, never>>(() => `/api/digital-employees/${employee.id}/release/withdraw`, {
    onSuccess: () => setMessage('已撤回历史申请，可在补齐后重新申请上岗。'),
    onError: (err) => setMessage(err instanceof Error ? err.message : '撤回失败'),
  });
  const reject = useApiMutation<DigitalEmployee, { reason: string }>(() => `/api/digital-employees/${employee.id}/release/reject`, {
    onSuccess: () => { setMessage('已驳回历史申请。'); setRejectReason(''); },
    onError: (err) => setMessage(err instanceof Error ? err.message : '驳回失败'),
  });
  const transition = useApiMutation<DigitalEmployee, { lifecycle: DigitalEmployeeLifecycle; reason?: string; confirmed?: boolean }>(() => `/api/digital-employees/${employee.id}/lifecycle`, {
    invalidateKeys: [['digital-employees'], ['digital-employee', employee.id]],
    onSuccess: (_, input) => setMessage(input.lifecycle === 'active' ? (employee.release.status === 'pending_approval' ? '已确认上岗。' : '已恢复运行。') : input.lifecycle === 'paused' ? '已暂停员工运行。' : input.lifecycle === 'quarantined' ? '已隔离员工运行。' : '状态已更新。'),
    onError: (err) => setMessage(formatApiError(err, '状态变更失败')),
  });
  const meta = context === 'release'
    ? { title: '上岗发布详情', description: '集中处理质量评测与上岗门禁。' }
    : { title: '运行管理详情', description: '仅展示岗位服务健康、人工交接与运行处置；不可修改岗位或能力。' };
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
        <Button size="sm" variant="secondary" loading={withdraw.isPending} onClick={() => withdraw.mutate({})}>撤回申请</Button>
      )}
      {employee.release.status === 'pending_approval' && isAdmin && !selfRequested && (
        <Button size="sm" variant="secondary" loading={reject.isPending} onClick={() => reject.mutate({ reason: rejectReason || '未满足上岗门禁或需补充配置' })}>驳回</Button>
      )}
      <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
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
  return (
    <>
    <Modal open onClose={onClose} title={`${meta.title} · ${employeePrimaryLabel(employee)}`} description={`${employeeSecondaryLabel(employee)} · 岗位版本 ${employee.version} · ${meta.description}`} size="xl" footer={context === 'release' ? releaseActions : operationsActions}>
      <div className="space-y-5">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex min-w-0 items-center gap-3">
              <EmployeeAvatar employee={employee} size={54} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">{employeePrimaryLabel(employee)}</h2>
                  <Badge tone={lifecycleMeta[employee.lifecycle].tone}>{lifecycleMeta[employee.lifecycle].label}</Badge>
                  <Badge tone={riskMeta[employee.risk].tone}>{riskMeta[employee.risk].label}</Badge>
                  {context === 'release' && <Badge tone={completeness.stage === 'ready_to_request' ? 'success' : completeness.stage === 'pending_eval' ? 'neutral' : 'warn'}>{completeness.label}</Badge>}
                  {context === 'operations' && <Badge tone={health.stage === 'stable' ? 'success' : health.stage === 'quarantined' ? 'error' : 'warn'}>{health.label}</Badge>}
                </div>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">{employeeSecondaryLabel(employee)} · 服务 {employee.serviceObject}</p>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">岗位负责人 {employee.owner} · 人工接管 {employee.escalationOwner}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-7 gap-y-2 text-xs">
              <span><span className="block text-[11px] text-[var(--text-muted)]">运行环境</span><strong className="mt-0.5 block font-medium">{employee.environment === 'production' ? '生产环境' : employee.environment === 'staging' ? '预发环境' : '沙箱环境'}</strong></span>
              {context === 'release' ? (
                <span><span className="block text-[11px] text-[var(--text-muted)]">质量评测</span><strong className="mt-0.5 block font-medium">{employee.evaluation.status === 'failed' ? '未通过' : employee.evaluation.score ?? '待评测'}{employee.evaluation.score ? ' 分' : ''}</strong></span>
              ) : (
                <span><span className="block text-[11px] text-[var(--text-muted)]">人工接管</span><strong className="mt-0.5 block font-medium">{employee.escalationOwner || '待指定'}</strong></span>
              )}
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
                    <button
                      type="button"
                      className="mt-2 text-[11px] font-medium text-[var(--brand)]"
                      onClick={() => { onClose(); onGoToModule(gate.fixTab!); }}
                    >
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
                selfRequested && !isAdmin
                  ? 'border-[var(--info)]/30 bg-[var(--info-bg)] text-[var(--text-secondary)]'
                  : 'border-[var(--success)]/30 bg-[var(--success-bg)] text-[var(--text-secondary)]',
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
            <div className="grid gap-2 sm:grid-cols-2">
              <BoundaryList icon={ClipboardCheck} tone="text-[var(--brand)]" title="评测覆盖" values={['岗位任务正确性', '职责与边界遵循', '能力调用可控性', '人工接管可达性']} />
              <BoundaryList icon={ShieldCheck} tone="text-[var(--success)]" title="当前评测依据" values={[`岗位版本 ${employee.version}`, `已绑定能力 ${employee.capabilities.skills.length + employee.capabilities.tools.length + employee.capabilities.workflows.length} 项`]} />
            </div>
          </section>
        )}
        {context === 'operations' && (
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">运行健康与处置</h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">仅提供业务运行观测和受控启停/隔离，不允许在运行场景修改岗位、能力或记忆策略。交接偏高阈值 ≥ {OPERATIONS_HANDOFF_THRESHOLD} 次 / 24h。</p>
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
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">审计证据</h3>
          {evidence.length ? evidence.map((event) => (
            <div key={event.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
              <div className="text-sm font-medium">{event.action}</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">{event.target}</div>
              <div className="mt-1 text-[11px] text-[var(--text-muted)]">{event.actor} · {new Date(event.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</div>
            </div>
          )) : <p className="text-xs text-[var(--text-muted)]">暂无证据记录。</p>}
        </section>
      </div>
    </Modal>
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

function EmployeeDetailModal({ employee, context, onClose, onGoToModule }: { employee: DigitalEmployee | null; context: ModuleTab; onClose: () => void; onGoToModule?: (tab: ModuleTab) => void }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<DetailTab>('profile');
  const { data: evidence = [] } = useApiQuery<Array<{ id: string; time: string; actor: string; action: string; target: string; result: string }>>(['digital-employee', employee?.id, 'evidence'], `/api/digital-employees/${employee?.id}/evidence`, undefined, { enabled: Boolean(employee) && context === 'catalog' });
  useEffect(() => {
    if (!employee) return;
    if (context === 'roleSetup' || context === 'capabilities') return;
    if (isDepartmentHead(employee) && context === 'catalog') setTab('team');
    else setTab('profile');
  }, [employee, context]);
  if (!employee) return null;
  if (context === 'release' || context === 'operations') return <ContextualEmployeeDetail employee={employee} context={context} onClose={onClose} onGoToModule={onGoToModule} />;
  // 岗位配置 / 能力装配：选中后直达工作台，关闭即回列表。
  if (context === 'roleSetup') {
    return <EmployeeConfigurationWorkbench employee={employee} open mode="role" onClose={onClose} initialSection="profile" />;
  }
  if (context === 'capabilities') {
    return <EmployeeConfigurationWorkbench employee={employee} open mode="capability" onClose={onClose} initialSection="capabilities" />;
  }
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
  const nextStepHint = employee.release.status === 'pending_approval'
    ? '下一步：上岗发布 · 确认上岗'
    : employee.evaluation.status !== 'passed'
      ? '下一步：上岗发布 · 执行评测'
      : employee.release.status !== 'released'
        ? '下一步：上岗发布 · 申请上岗'
        : null;
  const actions = (
    <>
      {employee.lifecycle === 'active' && <Button size="sm" onClick={() => navigate(`/copilot?employeeId=${employee.id}`)}><MessageSquare className="h-3.5 w-3.5" />发起协作</Button>}
      {head && employee.lifecycle === 'active' && context === 'catalog' && <Button size="sm" variant="secondary" onClick={() => setTab('team')}>班组调度</Button>}
      {context === 'catalog' && <Button size="sm" variant="secondary" onClick={() => navigate(`/tasks?task=${encodeURIComponent(employeePrimaryLabel(employee))}`)}>相关任务</Button>}
      {context === 'catalog' && nextStepHint && <span className="hidden text-[11px] text-[var(--text-muted)] sm:inline">{nextStepHint}</span>}
      <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
    </>
  );
  return <><Modal open onClose={onClose} title={`员工详情 · ${employeePrimaryLabel(employee)}`} description={`${employeeSecondaryLabel(employee)} · 岗位版本 ${employee.version}`} size="xl" footer={actions}><section className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-5 py-4"><div className="flex flex-wrap items-start justify-between gap-5"><div className="flex min-w-0 items-center gap-3"><EmployeeAvatar employee={employee} size={56} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold text-[var(--text)]">{employeePrimaryLabel(employee)}</h2>{head && <Badge tone="info">部门负责人</Badge>}<Badge tone={lifecycleMeta[employee.lifecycle].tone}>{lifecycleMeta[employee.lifecycle].label}</Badge><Badge tone={riskMeta[employee.risk].tone}>{riskMeta[employee.risk].label}</Badge></div><p className="mt-1 text-xs text-[var(--text-secondary)]">{employeeSecondaryLabel(employee)}</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">服务 {employee.serviceObject} · 岗位负责人 {employee.owner}</p></div></div><div className="grid grid-cols-2 gap-x-7 gap-y-2 text-xs"><span><span className="block text-[11px] text-[var(--text-muted)]">运行环境</span><strong className="mt-0.5 block font-medium">{employee.environment === 'production' ? '生产环境' : employee.environment === 'staging' ? '预发环境' : '沙箱环境'}</strong></span><span><span className="block text-[11px] text-[var(--text-muted)]">质量评测</span><strong className="mt-0.5 block font-medium">{employee.evaluation.score ?? '待评测'}{employee.evaluation.score ? ' 分' : ''}</strong></span></div></div></section><div className="mt-5 grid gap-5 md:grid-cols-[164px_minmax(0,1fr)]"><nav className="flex gap-1 overflow-x-auto border-b border-[var(--border)] pb-3 md:flex-col md:border-b-0 md:border-r md:pb-0 md:pr-4" aria-label="员工详情导航">{detailTabs.map((item) => <button type="button" key={item.key} onClick={() => setTab(item.key)} className={cn('shrink-0 rounded-lg px-3 py-2.5 text-left text-xs transition-colors', tab === item.key ? 'bg-[var(--brand-light)] font-semibold text-[var(--brand)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]')}>{item.label}</button>)}</nav><div className="min-h-[330px] min-w-0">{tab === 'team' && head && <DepartmentTeamPanel head={employee} />}
{tab === 'profile' && <ProfileContent employee={employee} />}
{tab === 'boundary' && <StructuredBoundaryContent employee={employee} />}
{tab === 'capabilities' && <CapabilityContent employee={employee} />}
{tab === 'memory' && <MemoryContent employee={employee} />}
{tab === 'runtime' && <RuntimeContent employee={employee} />}
{tab === 'evidence' && <div className="space-y-3">{evidence.map((event) => <div key={event.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3"><div className="text-sm font-medium">{event.action}</div><div className="mt-1 text-xs text-[var(--text-secondary)]">{event.target}</div><div className="mt-1 text-[11px] text-[var(--text-muted)]">{event.actor} · {new Date(event.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</div></div>)}</div>}</div></div></Modal></>;
}

function EmployeeConfigurationWorkbench({ employee, open, onClose, initialSection = 'profile', mode = 'role' }: { employee: DigitalEmployee; open: boolean; onClose: () => void; initialSection?: EmployeeConfigurationSection; mode?: 'role' | 'capability' }) {
  const [section, setSection] = useState<EmployeeConfigurationSection>(initialSection);
  const [profile, setProfile] = useState({ name: employee.name, role: employee.role, department: employee.department, description: employee.description, owner: employee.owner, escalationOwner: employee.escalationOwner, serviceObject: employee.serviceObject, risk: employee.risk, environment: employee.environment });
  const [boundaryPolicy, setBoundaryPolicy] = useState<DigitalEmployeeBoundaryPolicy>(() => resolveBoundaryPolicy(employee));
  const [capabilities, setCapabilities] = useState({ ...employee.capabilities, knowledge: employee.capabilities.knowledge.join('\n'), skills: employee.capabilities.skills.join('\n'), tools: employee.capabilities.tools.join('\n'), workflows: employee.capabilities.workflows.join('\n'), channels: employee.capabilities.channels.join('\n') });
  const [memory, setMemory] = useState({ ...employee.memoryPolicy });
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const canMutate = roleCanMutate(user?.role);
  const { data: versions = [] } = useApiQuery<DigitalEmployeeConfigurationVersion[]>(['digital-employee', employee.id, 'configuration-versions'], `/api/digital-employees/${employee.id}/configuration-versions`, undefined, { enabled: open });
  const { data: capabilityCatalog } = useApiQuery<DigitalEmployeeCapabilityCatalog>(['digital-employee-capability-catalog'], '/api/digital-employee-capability-catalog', undefined, { enabled: open });
  const closeAfterSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useApiMutation<EmployeeConfigurationResult, EmployeeConfigurationInput>(() => `/api/digital-employees/${employee.id}/configuration`, {
    invalidateKeys: [['digital-employees'], ['digital-employee', employee.id], ['digital-employee', employee.id, 'configuration-versions']],
    onSuccess: (result) => {
      setFeedback({
        kind: 'success',
        text: mode === 'capability'
          ? `${result.version} 能力装配已保存并生效。`
          : employee.release.status === 'released' || employee.lifecycle === 'active'
            ? `${result.version} 岗位授权契约已保存并生效。`
            : `${result.version} 已保存，可继续执行评测与上岗流程。`,
      });
      if (closeAfterSaveRef.current) clearTimeout(closeAfterSaveRef.current);
      closeAfterSaveRef.current = setTimeout(() => {
        closeAfterSaveRef.current = null;
        onClose();
      }, 600);
    },
    onError: (err) => setFeedback({ kind: 'error', text: formatApiError(err, '保存未完成，请检查必填项与岗位边界。') }),
  });
  const approve = useApiMutation<DigitalEmployeeConfigurationVersion, { versionId: string }>(({ versionId }) => `/api/digital-employees/${employee.id}/configuration-versions/${versionId}/approve`);
  const lines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);
  const syncFormFromEmployee = () => {
    setProfile({ name: employee.name, role: employee.role, department: employee.department, description: employee.description, owner: employee.owner, escalationOwner: employee.escalationOwner, serviceObject: employee.serviceObject, risk: employee.risk, environment: employee.environment });
    setBoundaryPolicy(resolveBoundaryPolicy(employee));
    setCapabilities({ ...employee.capabilities, knowledge: employee.capabilities.knowledge.join('\n'), skills: employee.capabilities.skills.join('\n'), tools: employee.capabilities.tools.join('\n'), workflows: employee.capabilities.workflows.join('\n'), channels: employee.capabilities.channels.join('\n') });
    setMemory({ ...employee.memoryPolicy });
  };
  useEffect(() => {
    if (!open) {
      if (closeAfterSaveRef.current) {
        clearTimeout(closeAfterSaveRef.current);
        closeAfterSaveRef.current = null;
      }
      setFeedback(null);
      return;
    }
    setSection(initialSection);
    setFeedback(null);
    syncFormFromEmployee();
  }, [open, employee.id, initialSection]);
  useEffect(() => () => {
    if (closeAfterSaveRef.current) clearTimeout(closeAfterSaveRef.current);
  }, []);
  const capabilityCount = lines(capabilities.skills).length + lines(capabilities.tools).length + lines(capabilities.workflows).length;
  const boundExecutable = [
    ...lines(capabilities.skills).map((capabilityName) => ({ capabilityType: 'skill' as const, capabilityName })),
    ...lines(capabilities.tools).map((capabilityName) => ({ capabilityType: 'tool' as const, capabilityName })),
    ...lines(capabilities.workflows).map((capabilityName) => ({ capabilityType: 'workflow' as const, capabilityName })),
  ];
  const modesComplete = boundExecutable.every((item) => boundaryPolicy.capabilityModes.some((mode) => mode.capabilityType === item.capabilityType && mode.capabilityName === item.capabilityName));
  const roleBlocking = [
    !profile.name.trim() && '员工名称',
    !profile.role.trim() && '岗位名称',
    !profile.department.trim() && '所属部门',
    !boundaryPolicy.responsibilities.length && '至少一项岗位职责',
    boundaryPolicy.responsibilities.some((item) => !item.title.trim() || !item.objective.trim() || !item.trigger.trim()) && '完整的职责目标与触发条件',
    !boundaryPolicy.handoff.triggers.some(Boolean) && '至少一项接管触发条件',
    !boundaryPolicy.handoff.approvers.some(Boolean) && '至少一名接管负责人',
    !boundaryPolicy.allowedEnvironments.length && '至少一个运行环境',
  ].filter(Boolean) as string[];
  const capabilityBlocking = [
    !capabilities.model.trim() && '模型路由',
    !capabilityCount && '至少一项技能/工具/工作流',
    capabilityCount > 0 && !modesComplete && '执行授权模式',
  ].filter(Boolean) as string[];
  const blocking = mode === 'capability' ? capabilityBlocking : roleBlocking;
  const roleContractReady = roleSetupCompleteness(employee).ready;
  const alreadyOnDuty = employee.release.status === 'released' || employee.lifecycle === 'active';
  const submit = () => {
    if (blocking.length) { setFeedback({ kind: 'error', text: `请补齐：${blocking.join('、')}` }); return; }
    const capabilityTools = mode === 'capability' && capabilityCatalog
      ? mergeBuiltinToolBindings(capabilityCatalog, lines(capabilities.tools))
      : lines(capabilities.tools);
    const nextCapabilities = mode === 'capability'
      ? { agentId: capabilities.agentId || undefined, model: capabilities.model, knowledge: lines(capabilities.knowledge), skills: lines(capabilities.skills), tools: capabilityTools, workflows: lines(capabilities.workflows), channels: lines(capabilities.channels) }
      : preservedCapabilities(employee);
    const syncedModes = mode === 'capability'
      ? boundExecutable.map((item) => boundaryPolicy.capabilityModes.find((modeItem) => modeItem.capabilityType === item.capabilityType && modeItem.capabilityName === item.capabilityName) ?? {
        ...item,
        mode: item.capabilityType === 'skill'
          ? 'recommend' as const
          : item.capabilityType === 'tool'
            ? defaultToolExecutionMode(capabilityCatalog, item.capabilityName)
            : 'approval_required' as const,
      })
      : boundaryPolicy.capabilityModes;
    const normalizedPolicy = {
      ...boundaryPolicy,
      capabilityModes: syncedModes,
      responsibilities: boundaryPolicy.responsibilities.map((item) => ({ ...item, title: item.title.trim(), objective: item.objective.trim(), trigger: item.trigger.trim(), deliverables: item.deliverables.filter(Boolean) })),
      handoff: {
        ...boundaryPolicy.handoff,
        triggers: boundaryPolicy.handoff.triggers.map((item) => item.trim()).filter(Boolean),
        approvers: boundaryPolicy.handoff.approvers.map((item) => item.trim()).filter(Boolean),
        notificationChannels: boundaryPolicy.handoff.notificationChannels.map((item) => item.trim()).filter(Boolean),
      },
    };
    const nextProfile = mode === 'capability'
      ? { name: employee.name, role: employee.role, department: employee.department, description: employee.description, owner: employee.owner, escalationOwner: employee.escalationOwner, serviceObject: employee.serviceObject, risk: employee.risk, environment: employee.environment }
      : profile;
    const nextMemory = mode === 'capability' ? employee.memoryPolicy : memory;
    save.mutate({
      scope: mode,
      profile: nextProfile,
      boundary: {
        responsibilities: normalizedPolicy.responsibilities.map((item) => item.title),
        prohibitedActions: normalizedPolicy.capabilityModes.filter((item) => item.mode === 'prohibited').map((item) => `禁止使用：${item.capabilityName}`),
        handoffPolicy: { triggers: normalizedPolicy.handoff.triggers, approvalRequiredFor: normalizedPolicy.capabilityModes.filter((item) => item.mode === 'approval_required').map((item) => item.capabilityName) },
        boundaryPolicy: normalizedPolicy,
      },
      capabilities: nextCapabilities,
      memoryPolicy: nextMemory,
    });
  };
  const nav: Array<{ key: EmployeeConfigurationSection; label: string; note: string }> = mode === 'capability'
    ? []
    : [{ key: 'profile', label: '岗位档案', note: '身份与责任' }, { key: 'boundary', label: '职责与边界', note: '可做与不可做' }, { key: 'memory', label: '记忆策略', note: '三层沉淀策略' }];
  const pendingVersion = versions.find((item) => item.status === 'pending_approval');
  const workbenchTitle = mode === 'capability' ? '受控能力装配' : '配置岗位授权契约';
  const workbenchDescription = mode === 'capability'
    ? '引用已发布模型与能力资产，并为技能/工具/流程设置执行授权；保存后立即生效。岗位职责请到「岗位配置」。'
    : '维护岗位档案、职责边界、人工接管与记忆策略；能力引用请到「能力装配」。保存后立即生效。';
  const validationAside = (
    <aside className="space-y-3 lg:w-[220px] lg:shrink-0">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
        <h3 className="text-xs font-semibold">配置校验</h3>
        <div className="mt-3 space-y-2 text-[11px]">
          {blocking.length
            ? blocking.map((item) => <div key={item} className="flex gap-1.5 text-[var(--danger)]"><XCircle className="mt-0.5 h-3 w-3 shrink-0" />待补齐：{item}</div>)
            : <div className="flex gap-1.5 text-[var(--success)]"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />必填配置已完整</div>}
          <div className="flex gap-1.5 text-[var(--text-secondary)]"><ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-[var(--brand)]" />可保存当前配置</div>
        </div>
      </section>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
        <h3 className="text-xs font-semibold">配置版本</h3>
        <div className="mt-3 space-y-3">
          {versions.slice(0, 3).map((version) => (
            <div key={version.id} className="text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{version.version}</span>
                <Badge tone={version.status === 'current' ? 'success' : version.status === 'pending_approval' ? 'warn' : 'neutral'}>{version.status === 'current' ? '当前' : version.status === 'pending_approval' ? '待审批' : '已替代'}</Badge>
              </div>
              <p className="mt-1 leading-4 text-[var(--text-muted)]">{version.changeSummary}</p>
              {version.status === 'pending_approval' && isAdmin && canMutate && version.updatedById !== user?.id && version.updatedBy !== user?.name && <Button size="sm" className="mt-2 w-full" loading={approve.isPending && approve.variables?.versionId === version.id} onClick={() => approve.mutate({ versionId: version.id })}>批准并生效</Button>}
              {version.status === 'pending_approval' && isAdmin && canMutate && (version.updatedById === user?.id || version.updatedBy === user?.name) && <p className="mt-2 text-[10px] text-[var(--text-muted)]">您是提交人，须由另一名管理员批准</p>}
            </div>
          ))}
          {!versions.length && <p className="text-[11px] text-[var(--text-muted)]">正在读取配置版本…</p>}
        </div>
      </section>
      {pendingVersion && <p className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-light)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)]">存在待审批配置 {pendingVersion.version}，批准前当前岗位不会改变。</p>}
    </aside>
  );
  return (
    <Modal open={open} onClose={onClose} title={workbenchTitle} description={canMutate ? workbenchDescription : '只读核查岗位契约与能力装配证据，不提交变更。'} size="xl" footer={canMutate ? <><Button variant="ghost" onClick={onClose}>取消</Button><Button loading={save.isPending} disabled={Boolean(blocking.length)} onClick={submit}><Save className="h-3.5 w-3.5" />保存配置</Button></> : <Button variant="ghost" onClick={onClose}>关闭</Button>}>
      <div className="space-y-4">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--bg-elevated)] px-4 py-3" style={{ boxShadow: 'var(--saas-ring)' }}>
          <div className="flex min-w-0 items-center gap-3">
            <EmployeeAvatar employee={employee} size={40} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">{employeePrimaryLabel(employee)}</h2>
                <Badge tone={lifecycleMeta[employee.lifecycle].tone}>{lifecycleMeta[employee.lifecycle].label}</Badge>
                <Badge tone={riskMeta[profile.risk].tone}>{riskMeta[profile.risk].label}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{employeeSecondaryLabel(employee)} · {versions.find((item) => item.status === 'current')?.version ?? '配置 v1'}</p>
            </div>
          </div>
          <div className="rounded-lg bg-[var(--success-bg)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)]" style={{ boxShadow: 'var(--saas-ring)' }}>
            {mode === 'capability' ? '能力装配可直接保存生效' : alreadyOnDuty ? '岗位授权契约保存后立即生效' : '配置可保存，上岗前仍需完成评测'}
          </div>
        </section>
        {mode === 'capability' && !roleContractReady && (
          <p role="status" className="rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-light)] px-3 py-2 text-xs text-[var(--text-secondary)]">
            岗位授权契约尚未完整，可先装配能力；上岗评测前请到「岗位配置」补齐档案与职责。
          </p>
        )}
        {feedback && (
          <p
            role="status"
            className={cn(
              'rounded-lg border px-3 py-2 text-xs',
              feedback.kind === 'success'
                ? 'border-[var(--success)]/35 bg-[var(--success-bg)] text-[var(--text-secondary)]'
                : 'border-[var(--danger)]/35 bg-[var(--danger-light)] text-[var(--text-secondary)]',
            )}
          >
            {feedback.text}
          </p>
        )}
        {mode === 'capability' ? (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <main className="min-w-0 flex-1">
              <CapabilityAssemblySelector
                catalog={capabilityCatalog}
                capabilities={{ agentId: capabilities.agentId || undefined, model: capabilities.model, knowledge: lines(capabilities.knowledge), skills: lines(capabilities.skills), tools: lines(capabilities.tools), workflows: lines(capabilities.workflows), channels: lines(capabilities.channels) }}
                policy={boundaryPolicy}
                onChangeCapabilities={(next) => setCapabilities({ ...next, knowledge: next.knowledge.join('\n'), skills: next.skills.join('\n'), tools: next.tools.join('\n'), workflows: next.workflows.join('\n'), channels: next.channels.join('\n') })}
                onChangePolicy={setBoundaryPolicy}
              />
            </main>
            {validationAside}
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[164px_minmax(0,1fr)_220px]">
            <aside>
              <p className="mb-2 px-3 text-[11px] font-medium text-[var(--text-muted)]">配置分区</p>
              <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="员工配置导航">
                {nav.map((item) => (
                  <button type="button" key={item.key} onClick={() => setSection(item.key)} className={cn('shrink-0 rounded-lg px-3 py-2.5 text-left transition-colors', section === item.key ? 'bg-[var(--brand-light)] text-[var(--brand)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')}>
                    <span className="block text-xs font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-[10px] opacity-75">{item.note}</span>
                  </button>
                ))}
              </nav>
            </aside>
            <main className="min-w-0 border-y border-[var(--border)] py-1 lg:border-y-0 lg:border-x lg:px-5">
              {section === 'profile' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold">岗位档案</h3>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">明确岗位身份、责任归属和服务范围；生产环境与高风险调整会进入受控变更。</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="员工名称（花名）" value={profile.name} onChange={(value) => setProfile({ ...profile, name: value })} placeholder="例如：北辰" required />
                    <Field label="岗位名称" value={profile.role} onChange={(value) => setProfile({ ...profile, role: value })} placeholder="例如：信息技术部负责人" required />
                    <Field label="所属部门" value={profile.department} onChange={(value) => setProfile({ ...profile, department: value })} placeholder="例如：信息技术部" required />
                    <Field label="岗位负责人" value={profile.owner} onChange={(value) => setProfile({ ...profile, owner: value })} placeholder="明确业务责任人" />
                    <Field label="人工接管负责人" value={profile.escalationOwner} onChange={(value) => setProfile({ ...profile, escalationOwner: value })} placeholder="异常或越权时的接管人" />
                    <Field label="服务对象" value={profile.serviceObject} onChange={(value) => setProfile({ ...profile, serviceObject: value })} placeholder="例如：生产业务系统" />
                    <SelectField label="风险等级" value={profile.risk} onChange={(value) => setProfile({ ...profile, risk: value as DigitalEmployee['risk'] })} options={[['low', '低风险'], ['medium', '中风险'], ['high', '高风险']]} />
                    <SelectField label="运行环境" value={profile.environment} onChange={(value) => setProfile({ ...profile, environment: value as DigitalEmployee['environment'] })} options={[['sandbox', '沙箱环境'], ['staging', '预发环境'], ['production', '生产环境']]} />
                    <label className="grid gap-1.5 text-xs font-medium sm:col-span-2">岗位说明<textarea value={profile.description} onChange={(event) => setProfile({ ...profile, description: event.target.value })} rows={4} placeholder="说明服务目标、覆盖范围与人工介入边界。" className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-normal leading-5 outline-none focus:border-[var(--brand)]" /></label>
                  </div>
                </div>
              )}
              {section === 'boundary' && <BoundaryPolicyEditor policy={boundaryPolicy} capabilities={{ agentId: capabilities.agentId || undefined, model: capabilities.model, knowledge: lines(capabilities.knowledge), skills: lines(capabilities.skills), tools: lines(capabilities.tools), workflows: lines(capabilities.workflows), channels: lines(capabilities.channels) }} onChange={setBoundaryPolicy} mode="role" />}
              {section === 'memory' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold">三层记忆策略</h3>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">短期记忆支撑当前会话，工作记忆支撑岗位协作，长期记忆仅可通过审核沉淀为知识候选。</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <NumberField label="短期记忆保留" value={memory.shortTermHours} suffix="小时" onChange={(value) => setMemory({ ...memory, shortTermHours: value })} />
                    <NumberField label="工作记忆保留" value={memory.workingDays} suffix="天" onChange={(value) => setMemory({ ...memory, workingDays: value })} />
                    <SelectField label="长期记忆提炼" value={memory.longTermCadence} onChange={(value) => setMemory({ ...memory, longTermCadence: value as DigitalEmployee['memoryPolicy']['longTermCadence'] })} options={[['daily', '每日提炼'], ['weekly', '每周提炼']]} />
                    <SelectField label="转知识策略" value={memory.knowledgePromotion} onChange={(value) => setMemory({ ...memory, knowledgePromotion: value as DigitalEmployee['memoryPolicy']['knowledgePromotion'] })} options={[['approval_required', '审核后转知识'], ['disabled', '不转知识']]} />
                  </div>
                  <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-light)] p-3 text-xs leading-5 text-[var(--text-secondary)]"><Database className="mr-1 inline h-3.5 w-3.5 text-[var(--warning)]" />长期记忆不会直接成为企业知识；通过内容审核后，才进入知识中心的权威资产目录。</div>
                </div>
              )}
            </main>
            {validationAside}
          </div>
        )}
      </div>
    </Modal>
  );
}

function LinkedAssetPicker({ label, hint, options, values, onChange, capabilityType, modeOf, onModeChange, compact, emptyHint, readonly }: {
  label: string;
  hint: string;
  options: CapabilityCatalogOption[];
  values: string[];
  onChange: (values: string[]) => void;
  capabilityType?: 'tool' | 'workflow' | 'skill';
  modeOf?: (name: string) => DigitalEmployeeExecutionMode;
  onModeChange?: (name: string, mode: DigitalEmployeeExecutionMode) => void;
  compact?: boolean;
  emptyHint?: string;
  readonly?: boolean;
}) {
  const [filter, setFilter] = useState('');
  const displayValues = readonly ? options.map((item) => item.name) : values;
  const available = readonly ? [] : options.filter((item) => !values.includes(item.name) && (!filter.trim() || `${item.name} ${item.meta}`.toLowerCase().includes(filter.trim().toLowerCase())));
  const remove = (name: string) => {
    const option = options.find((item) => item.name === name);
    if (readonly || option?.removable === false) return;
    onChange(values.filter((item) => item !== name));
  };
  const withMode = Boolean(capabilityType && modeOf && onModeChange);
  return (
    <section className={cn('rounded-xl border border-[var(--border)] bg-[var(--bg)]', compact ? 'p-3' : 'p-3.5')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold">{label}</h3>
            <span className="text-[10px] tabular-nums text-[var(--text-muted)]">{displayValues.length}</span>
            {readonly && <Badge tone="neutral">内置</Badge>}
          </div>
          {!compact && <p className="mt-0.5 text-[11px] leading-4 text-[var(--text-muted)]">{hint}</p>}
        </div>
        {!readonly && (
          <div className="flex items-center gap-1.5">
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="搜索"
              className="h-8 w-[108px] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs outline-none focus:border-[var(--brand)]"
              aria-label={`搜索${label}`}
            />
            <select
              aria-label={`添加${label}`}
              value=""
              disabled={!available.length}
              onChange={(event) => {
                const selected = event.target.value;
                if (selected) {
                  onChange([...values, selected]);
                  setFilter('');
                }
              }}
              className="h-8 max-w-[160px] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs outline-none focus:border-[var(--brand)] disabled:opacity-50"
            >
              <option value="">{available.length ? '+ 添加' : '无可选资产'}</option>
              {available.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className={cn('mt-2.5 space-y-1.5', !displayValues.length && 'min-h-0')}>
        {displayValues.length ? displayValues.map((value) => {
          const option = options.find((item) => item.name === value);
          return (
            <div key={value} className="flex items-center gap-2 rounded-lg bg-[var(--surface-1)] px-2.5 py-2" style={{ boxShadow: 'var(--saas-ring)' }}>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{value}</span>
                {!compact && <span className="block truncate text-[10px] text-[var(--text-muted)]">{option?.meta ?? '历史已绑定资产（目录中已不存在）'}</span>}
              </div>
              {withMode && modeOf && onModeChange && (
                <select
                  value={modeOf(value)}
                  onChange={(event) => onModeChange(value, event.target.value as DigitalEmployeeExecutionMode)}
                  className="h-7 max-w-[148px] shrink-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[11px] outline-none focus:border-[var(--brand)]"
                  aria-label={`${value} 授权模式`}
                >
                  {executionModeOptions.map(([modeValue, modeLabel]) => <option key={modeValue} value={modeValue}>{modeLabel}</option>)}
                </select>
              )}
              {!readonly && option?.removable !== false && (
                <button type="button" onClick={() => remove(value)} className="shrink-0 rounded-md px-1 text-xs text-[var(--text-muted)] hover:bg-[var(--danger-light)] hover:text-[var(--danger)]" aria-label={`移除 ${value}`}>×</button>
              )}
            </div>
          );
        }) : (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-2.5 py-2 text-[11px] text-[var(--text-muted)]">
            {options.length ? '尚未选择' : (emptyHint ?? '暂无可选资产')}
          </p>
        )}
      </div>
    </section>
  );
}

function syncCapabilityModes(
  policy: DigitalEmployeeBoundaryPolicy,
  capabilities: DigitalEmployee['capabilities'],
  catalog?: DigitalEmployeeCapabilityCatalog,
): DigitalEmployeeBoundaryPolicy {
  const bound = [
    ...capabilities.skills.map((capabilityName) => ({ capabilityType: 'skill' as const, capabilityName, fallback: 'recommend' as DigitalEmployeeExecutionMode })),
    ...capabilities.tools.map((capabilityName) => ({ capabilityType: 'tool' as const, capabilityName, fallback: defaultToolExecutionMode(catalog, capabilityName) })),
    ...capabilities.workflows.map((capabilityName) => ({ capabilityType: 'workflow' as const, capabilityName, fallback: 'approval_required' as DigitalEmployeeExecutionMode })),
  ];
  return {
    ...policy,
    capabilityModes: bound.map((item) => {
      const existing = policy.capabilityModes.find((mode) => mode.capabilityType === item.capabilityType && mode.capabilityName === item.capabilityName);
      if (existing) {
        return {
          ...existing,
          mode: normalizeBuiltinToolMode(catalog, item.capabilityType, item.capabilityName, existing.mode),
        };
      }
      return { capabilityType: item.capabilityType, capabilityName: item.capabilityName, mode: item.fallback };
    }),
  };
}

function CapabilityAssemblySelector({ catalog, capabilities, policy, onChangeCapabilities, onChangePolicy }: {
  catalog?: DigitalEmployeeCapabilityCatalog;
  capabilities: DigitalEmployee['capabilities'];
  policy: DigitalEmployeeBoundaryPolicy;
  onChangeCapabilities: (capabilities: DigitalEmployee['capabilities']) => void;
  onChangePolicy: (policy: DigitalEmployeeBoundaryPolicy) => void;
}) {
  const seededCatalogRef = useRef('');
  const updateAssets = (key: 'knowledge' | 'skills' | 'tools' | 'workflows' | 'channels', values: string[]) => {
    const next = { ...capabilities, [key]: values };
    onChangeCapabilities(next);
    if (key === 'skills' || key === 'tools' || key === 'workflows') onChangePolicy(syncCapabilityModes(policy, next, catalog));
  };
  useEffect(() => {
    if (!catalog) return;
    const signature = JSON.stringify({
      platform: (catalog.platformTools ?? []).map((item) => item.name),
      runtime: autoBindRuntimeNames(catalog),
    });
    if (seededCatalogRef.current === signature) return;
    seededCatalogRef.current = signature;
    const merged = mergeBuiltinToolBindings(catalog, capabilities.tools);
    const next = { ...capabilities, tools: merged };
    if (merged.join('\0') !== capabilities.tools.join('\0')) {
      onChangeCapabilities(next);
    }
    onChangePolicy(syncCapabilityModes(policy, next, catalog));
  // 仅在能力目录加载/变更时补齐内置绑定，避免与用户编辑循环触发
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);
  const modeOf = (capabilityType: 'tool' | 'workflow' | 'skill', capabilityName: string) => {
    const existing = policy.capabilityModes.find((item) => item.capabilityType === capabilityType && item.capabilityName === capabilityName)?.mode;
    if (existing) return existing;
    if (capabilityType === 'skill') return 'recommend';
    if (capabilityType === 'tool') return defaultToolExecutionMode(catalog, capabilityName);
    return 'approval_required';
  };
  const setMode = (capabilityType: 'tool' | 'workflow' | 'skill', capabilityName: string, mode: DigitalEmployeeExecutionMode) => {
    const exists = policy.capabilityModes.some((item) => item.capabilityType === capabilityType && item.capabilityName === capabilityName);
    onChangePolicy({
      ...policy,
      capabilityModes: exists
        ? policy.capabilityModes.map((item) => item.capabilityType === capabilityType && item.capabilityName === capabilityName ? { ...item, mode } : item)
        : [...policy.capabilityModes, { capabilityType, capabilityName, mode }],
    });
  };
  const modelOptions = catalog?.models ?? [];
  const modelInCatalog = modelOptions.some((item) => item.name === capabilities.model);
  const platformTools = catalog?.platformTools ?? [];
  const runtimeTools = catalog?.runtimeTools ?? [];
  const defaultRuntimeTools = runtimeTools.filter((item) => item.autoBind !== false && (item.availability ?? 'default') !== 'opt_in');
  const optionalRuntimeTools = runtimeTools.filter((item) => (item.availability ?? 'default') === 'opt_in' || item.autoBind === false);
  const platformNames = new Set(platformTools.map((item) => item.name));
  const runtimeNames = new Set(runtimeTools.map((item) => item.name));
  const executableCount = capabilities.skills.length + capabilities.tools.length + capabilities.workflows.length;
  const catalogEmpty = Boolean(catalog) && modelOptions.length === 0 && (catalog?.skills.length ?? 0) === 0 && (catalog?.tools.length ?? 0) === 0 && (catalog?.workflows.length ?? 0) === 0;
  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            模型路由 <span className="text-[var(--danger)]">*</span>
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">可选已发布路由策略，或当前工作区已激活供应商的可用对话模型</p>
        </div>
        <select
          value={capabilities.model}
          onChange={(event) => onChangeCapabilities({ ...capabilities, model: event.target.value })}
          className="h-9 min-w-[260px] max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs outline-none focus:border-[var(--brand)]"
        >
          {!capabilities.model && <option value="">请选择已发布路由或对话模型</option>}
          {capabilities.model && !modelInCatalog && (
            <option value={capabilities.model}>{capabilities.model}（历史绑定，建议改选目录中的路由）</option>
          )}
          {modelOptions.map((item) => (
            <option key={`${item.id}:${item.name}`} value={item.name} title={item.meta}>
              {item.meta.startsWith('已发布') ? `${item.name} · ${item.meta}` : `${item.name} · ${item.meta}`}
            </option>
          ))}
        </select>
        {capabilities.agentId && (
          <span className="w-full text-[11px] text-[var(--text-muted)] sm:w-auto sm:border-l sm:border-[var(--border)] sm:pl-3">
            运行时已绑定（内部）
          </span>
        )}
      </section>

      {!catalog && <div className="rounded-xl px-3 py-8 text-center text-xs text-[var(--text-muted)]" style={{ boxShadow: 'var(--saas-ring)' }}>正在同步各能力中心的可选资产…</div>}

      {catalogEmpty && (
        <div className="rounded-xl border border-dashed border-[var(--warning)]/40 bg-[var(--warning-bg)]/40 px-3.5 py-3 text-[11px] leading-5 text-[var(--text-secondary)]">
          当前工作区暂无已发布可装配资产。请先在「模型服务」发布路由并激活供应商，在「技能中心 / 工作流程 / 知识中心 / 消息渠道」发布对应资产后返回刷新。
        </div>
      )}

      {catalog && (
        <>
          <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3.5 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">认知思路模型</h3>
                <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                  对话中自动选用逻辑思考 / 问题解决 / 创意决策骨架；可关闭或设部门偏好。
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={capabilities.cognitive?.enabled !== false}
                  onChange={(event) => onChangeCapabilities({
                    ...capabilities,
                    cognitive: {
                      enabled: event.target.checked,
                      defaultPack: capabilities.cognitive?.defaultPack ?? 'base-cognitive-v1',
                      allowOverride: capabilities.cognitive?.allowOverride ?? true,
                      maxFrameworksPerTurn: capabilities.cognitive?.maxFrameworksPerTurn ?? 2,
                      preferredFramework: capabilities.cognitive?.preferredFramework,
                    },
                  })}
                />
                启用
              </label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)] sm:col-span-2">
                <input
                  type="checkbox"
                  checked={capabilities.cognitive?.showNarrative !== false}
                  disabled={capabilities.cognitive?.enabled === false}
                  onChange={(event) => onChangeCapabilities({
                    ...capabilities,
                    cognitive: {
                      enabled: capabilities.cognitive?.enabled !== false,
                      defaultPack: capabilities.cognitive?.defaultPack ?? 'base-cognitive-v1',
                      allowOverride: capabilities.cognitive?.allowOverride ?? true,
                      maxFrameworksPerTurn: capabilities.cognitive?.maxFrameworksPerTurn ?? 2,
                      preferredFramework: capabilities.cognitive?.preferredFramework,
                      showNarrative: event.target.checked,
                    },
                  })}
                />
                展示三阶段思考叙事（意图理解 → 任务规划 → 工具执行）
              </label>
              <label className="grid gap-1.5 text-xs font-medium">
                默认偏好框架
                <select
                  value={capabilities.cognitive?.preferredFramework ?? ''}
                  disabled={capabilities.cognitive?.enabled === false}
                  onChange={(event) => onChangeCapabilities({
                    ...capabilities,
                    cognitive: {
                      enabled: capabilities.cognitive?.enabled !== false,
                      defaultPack: capabilities.cognitive?.defaultPack ?? 'base-cognitive-v1',
                      allowOverride: capabilities.cognitive?.allowOverride ?? true,
                      maxFrameworksPerTurn: capabilities.cognitive?.maxFrameworksPerTurn ?? 2,
                      preferredFramework: event.target.value || undefined,
                    },
                  })}
                  className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs font-normal outline-none focus:border-[var(--brand)] disabled:opacity-50"
                >
                  <option value="">自动（按问题信号）</option>
                  <option value="logic">逻辑思考分析</option>
                  <option value="problem">问题解决分析</option>
                  <option value="creative">创意决策分析</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-medium">
                每回合最多框架数
                <select
                  value={String(capabilities.cognitive?.maxFrameworksPerTurn ?? 2)}
                  disabled={capabilities.cognitive?.enabled === false}
                  onChange={(event) => onChangeCapabilities({
                    ...capabilities,
                    cognitive: {
                      enabled: capabilities.cognitive?.enabled !== false,
                      defaultPack: capabilities.cognitive?.defaultPack ?? 'base-cognitive-v1',
                      allowOverride: capabilities.cognitive?.allowOverride ?? true,
                      maxFrameworksPerTurn: Number(event.target.value) || 2,
                      preferredFramework: capabilities.cognitive?.preferredFramework,
                    },
                  })}
                  className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs font-normal outline-none focus:border-[var(--brand)] disabled:opacity-50"
                >
                  <option value="1">1（仅主框架）</option>
                  <option value="2">2（主 + 辅）</option>
                </select>
              </label>
            </div>
          </section>

          <section className="space-y-2.5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">执行能力</h3>
                <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">仅列出已启用技能/工具与已发布流程 · 已绑 {executableCount} 项</p>
              </div>
            </div>
            <div className="space-y-2.5">
              <LinkedAssetPicker label="技能" hint="" options={catalog.skills} values={capabilities.skills} onChange={(values) => updateAssets('skills', values)} capabilityType="skill" modeOf={(name) => modeOf('skill', name)} onModeChange={(name, mode) => setMode('skill', name, mode)} emptyHint="技能中心暂无已启用技能" />
              <LinkedAssetPicker label="企业工具 / MCP" hint="" options={catalog.tools} values={capabilities.tools.filter((n) => !platformNames.has(n) && !runtimeNames.has(n))} onChange={(values) => {
                const platform = capabilities.tools.filter((n) => platformNames.has(n));
                const runtime = capabilities.tools.filter((n) => runtimeNames.has(n));
                updateAssets('tools', [...platform, ...runtime, ...values]);
              }} capabilityType="tool" modeOf={(name) => modeOf('tool', name)} onModeChange={(name, mode) => setMode('tool', name, mode)} emptyHint="暂无已启用工具 / MCP" />
              {platformTools.length > 0 && (
                <LinkedAssetPicker label="平台工具" hint="内置 · 默认全员可用" options={platformTools} values={capabilities.tools.filter((n) => platformNames.has(n))} onChange={(values) => {
                  const enterprise = capabilities.tools.filter((n) => !platformNames.has(n) && !runtimeNames.has(n));
                  const runtime = capabilities.tools.filter((n) => runtimeNames.has(n));
                  updateAssets('tools', [...values, ...runtime, ...enterprise]);
                }} capabilityType="tool" modeOf={(name) => modeOf('tool', name)} onModeChange={(name, mode) => setMode('tool', name, mode)} emptyHint="—" readonly />
              )}
              {defaultRuntimeTools.length > 0 && (
                <LinkedAssetPicker label="运行时工具" hint="内置 · 文件、搜索、任务与 MCP 等" options={defaultRuntimeTools} values={capabilities.tools.filter((n) => defaultRuntimeTools.some((item) => item.name === n))} onChange={(values) => {
                  const platform = capabilities.tools.filter((n) => platformNames.has(n));
                  const enterprise = capabilities.tools.filter((n) => !platformNames.has(n) && !runtimeNames.has(n));
                  const optional = capabilities.tools.filter((n) => optionalRuntimeTools.some((item) => item.name === n));
                  updateAssets('tools', [...platform, ...values, ...optional, ...enterprise]);
                }} capabilityType="tool" modeOf={(name) => modeOf('tool', name)} onModeChange={(name, mode) => setMode('tool', name, mode)} emptyHint="—" readonly />
              )}
              {optionalRuntimeTools.length > 0 && (
                <LinkedAssetPicker label="可选运行时工具" hint="按需启用" options={optionalRuntimeTools} values={capabilities.tools.filter((n) => optionalRuntimeTools.some((item) => item.name === n))} onChange={(values) => {
                  const platform = capabilities.tools.filter((n) => platformNames.has(n));
                  const runtimeDefault = capabilities.tools.filter((n) => defaultRuntimeTools.some((item) => item.name === n));
                  const enterprise = capabilities.tools.filter((n) => !platformNames.has(n) && !runtimeNames.has(n));
                  updateAssets('tools', [...platform, ...runtimeDefault, ...values, ...enterprise]);
                }} capabilityType="tool" modeOf={(name) => modeOf('tool', name)} onModeChange={(name, mode) => setMode('tool', name, mode)} emptyHint="—" />
              )}
              <LinkedAssetPicker label="流程技能与工作流" hint="" options={catalog.workflows} values={capabilities.workflows} onChange={(values) => updateAssets('workflows', values)} capabilityType="workflow" modeOf={(name) => modeOf('workflow', name)} onModeChange={(name, mode) => setMode('workflow', name, mode)} emptyHint="请先在工作流程中心发布流程技能" />
            </div>
          </section>

          <section className="space-y-2.5">
            <div>
              <h3 className="text-sm font-semibold">上下文资产</h3>
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">知识与渠道为引用，不设执行授权</p>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <LinkedAssetPicker label="知识" hint="" options={catalog.knowledge} values={capabilities.knowledge} onChange={(values) => updateAssets('knowledge', values)} compact emptyHint="请先发布知识包" />
              <LinkedAssetPicker label="渠道" hint="" options={catalog.channels} values={capabilities.channels} onChange={(values) => updateAssets('channels', values)} compact emptyHint="请先启用消息渠道" />
            </div>
          </section>
        </>
      )}

      <p className="text-[11px] leading-4 text-[var(--text-muted)]">
        仅可选择各能力中心已发布/已启用资产；能力装配保存后立即生效。技能执行授权仍可按项设为「需双重审批后执行」。
      </p>
    </div>
  );
}

function ProfileContent({ employee }: { employee: DigitalEmployee }) {
  return <div className="space-y-4"><div><h3 className="text-sm font-semibold">岗位档案</h3><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">数字伙伴以岗位责任服务业务对象，不以底层模型或技术组件作为业务身份。</p></div><div className="grid grid-cols-2 gap-3"><Metric label="花名" value={employee.name} /><Metric label="岗位名称" value={employee.role} /><Metric label="所属部门" value={employee.department} /><Metric label="岗位负责人" value={employee.owner} /><Metric label="服务对象" value={employee.serviceObject} /><Metric label="人工接管负责人" value={employee.escalationOwner} /><Metric label="运行环境" value={employee.environment === 'production' ? '生产' : employee.environment === 'staging' ? '预发' : '沙箱'} /><Metric label="风险等级" value={riskMeta[employee.risk].label} /></div><div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4 text-xs leading-6 text-[var(--text-secondary)]">{employee.description}</div></div>;
}
function StructuredBoundaryContent({ employee }: { employee: DigitalEmployee }) {
  const policy = resolveBoundaryPolicy(employee);
  const modeLabel = Object.fromEntries(executionModeOptions);
  return <div className="space-y-4"><div><h3 className="text-sm font-semibold">岗位授权契约</h3><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">职责、执行授权、人工接管和数据范围作为同一份可审计策略展示。</p></div><div className="space-y-2">{policy.responsibilities.map((item) => <article key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{item.title}</span>{item.evidenceRequired && <Badge tone="success">留存证据</Badge>}</div><dl className="mt-2 grid gap-2 text-xs sm:grid-cols-3"><div><dt className="text-[11px] text-[var(--text-muted)]">目标</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{item.objective}</dd></div><div><dt className="text-[11px] text-[var(--text-muted)]">触发</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{item.trigger}</dd></div><div><dt className="text-[11px] text-[var(--text-muted)]">交付</dt><dd className="mt-0.5 text-[var(--text-secondary)]">{item.deliverables.join('、') || '—'}</dd></div></dl></article>)}</div><section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3"><h3 className="text-xs font-semibold">执行边界</h3><div className="mt-2 flex flex-wrap gap-1.5">{policy.capabilityModes.map((item) => <Badge key={`${item.capabilityType}-${item.capabilityName}`} tone={item.mode === 'execute' ? 'success' : item.mode === 'prohibited' ? 'error' : item.mode === 'approval_required' ? 'warn' : 'info'}>{item.capabilityName} · {modeLabel[item.mode]}</Badge>)}</div></section><div className="grid gap-3 sm:grid-cols-2"><BoundaryList icon={UserRoundCheck} tone="text-[var(--brand)]" title={`人工接管 · SLA ${policy.handoff.slaMinutes} 分钟`} values={[...policy.handoff.triggers, `接管人：${policy.handoff.approvers.join('、')}`]} /><BoundaryList icon={ShieldCheck} tone="text-[var(--warning)]" title="数据与范围" values={[`数据分类：${policy.dataClassification === 'internal' ? '内部' : policy.dataClassification === 'confidential' ? '敏感' : '受限'}`, `运行环境：${policy.allowedEnvironments.map((item) => item === 'production' ? '生产' : item === 'staging' ? '预发' : '沙箱').join('、')}`]} /></div></div>;
}
function BoundaryList({ icon: Icon, tone, title, values }: { icon: typeof CheckCircle2; tone: string; title: string; values: string[] }) { return <div><h3 className="mb-2 text-sm font-semibold">{title}</h3><div className="space-y-2">{values.map((value) => <div key={value} className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-xs text-[var(--text-secondary)]"><Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', tone)} />{value}</div>)}</div></div>; }
function CapabilityContent({ employee }: { employee: DigitalEmployee }) {
  const rows = [
    { label: '模型', values: [employee.capabilities.model] },
    { label: '知识', values: employee.capabilities.knowledge },
    { label: '技能', values: employee.capabilities.skills },
    { label: '工具', values: employee.capabilities.tools },
    { label: '工作流', values: employee.capabilities.workflows },
    { label: '渠道', values: employee.capabilities.channels },
  ];
  const cog = employee.capabilities.cognitive;
  const cogLabel = cog?.enabled === false
    ? '已关闭'
    : `已启用 · 偏好 ${cog?.preferredFramework === 'problem' ? '问题解决' : cog?.preferredFramework === 'creative' ? '创意决策' : cog?.preferredFramework === 'logic' ? '逻辑思考' : '自动'} · 最多 ${cog?.maxFrameworksPerTurn ?? 2} 框架`;
  return <div className="space-y-3"><p className="text-xs leading-5 text-[var(--text-muted)]">仅绑定工作区内已发布、经治理批准的能力版本。能力本体仍由模型、知识、技能、工作流和渠道中心独立治理。</p>{employee.capabilities.agentId && <p className="rounded-lg px-3 py-2 text-[11px] text-[var(--text-muted)]" style={{ boxShadow: 'var(--saas-ring)' }}>执行运行时已绑定（内部），不作为对外岗位身份。</p>}<div className="rounded-lg bg-[var(--bg)] p-3" style={{ boxShadow: 'var(--saas-ring)' }}><div className="text-xs font-semibold">认知思路模型</div><div className="mt-2 text-xs text-[var(--text-secondary)]">{cogLabel}</div></div>{rows.map((row) => <div key={row.label} className="rounded-lg bg-[var(--bg)] p-3" style={{ boxShadow: 'var(--saas-ring)' }}><div className="text-xs font-semibold">{row.label}</div><div className="mt-2 flex flex-wrap gap-1.5">{row.values.length ? row.values.map((value) => <Badge key={value} tone="neutral">{value}</Badge>) : <span className="text-xs text-[var(--text-muted)]">未绑定</span>}</div></div>)}</div>;
}
function MemoryContent({ employee }: { employee: DigitalEmployee }) { const policy = employee.memoryPolicy; return <div className="space-y-4"><div><h3 className="text-sm font-semibold">三层记忆策略</h3><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">会话短期记忆、岗位工作记忆和经审核的长期记忆彼此分层，长期记忆不会自动成为企业知识。</p></div><div className="grid grid-cols-2 gap-3"><Metric label="短期记忆" value={policy.shortTermHours} sub="小时" /><Metric label="工作记忆" value={policy.workingDays} sub="天" /><Metric label="长期提炼" value={policy.longTermCadence === 'daily' ? '每日' : '每周'} /><Metric label="转知识" value={policy.knowledgePromotion === 'approval_required' ? '需审核' : '已关闭'} /></div><div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs leading-5 text-[var(--text-secondary)]"><Database className="mr-1 inline h-3.5 w-3.5 text-[var(--brand)]" />长期记忆按策略提炼为知识候选，审核通过后才进入知识中心的权威资产目录。</div></div>; }
function RuntimeContent({ employee }: { employee: DigitalEmployee }) { const runtime = employee.runtime; return <div className="space-y-4"><div className="grid grid-cols-2 gap-3"><Metric label="24 小时调用" value={runtime.calls24h} /><Metric label="成功率" value={runtime.calls24h > 0 ? `${(runtime.successRate * 100).toFixed(1)}%` : '—'} /><Metric label="P95 延迟" value={runtime.p95Ms || '—'} sub={runtime.p95Ms ? 'ms' : undefined} /><Metric label="今日成本" value={`¥${Number(runtime.costToday || 0).toFixed(2)}`} /><Metric label="人工交接" value={runtime.handoffs24h} sub="次" /><Metric label="异常信号" value={runtime.anomalies} sub="项" /></div><div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs leading-5 text-[var(--text-secondary)]"><HeartPulse className="mr-1 inline h-3.5 w-3.5 text-[var(--success)]" />运行运营聚焦业务服务质量；模型、工具与渠道的深度技术指标分别在其所属控制面查看。</div></div>; }

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) { return <label className="grid gap-1.5 text-xs font-medium">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-xs font-normal outline-none focus:border-[var(--brand)]">{options.map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select></label>; }
function TextAreaField({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint: string }) { return <label className="grid gap-1.5 text-xs font-medium">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-normal leading-5 outline-none focus:border-[var(--brand)]" /><span className="font-normal leading-5 text-[var(--text-muted)]">{hint}</span></label>; }
function NumberField({ label, value, suffix, onChange }: { label: string; value: number; suffix: string; onChange: (value: number) => void }) { return <label className="grid gap-1.5 text-xs font-medium">{label}<div className="flex h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)]"><input type="number" min={1} value={value} onChange={(event) => onChange(Math.max(1, Number(event.target.value) || 1))} className="min-w-0 flex-1 bg-transparent px-3 text-xs font-normal outline-none" /><span className="flex items-center pr-3 text-xs text-[var(--text-muted)]">{suffix}</span></div></label>; }

function CreateEmployeeModal({ open, onClose, loading, onCreate }: { open: boolean; onClose: () => void; loading: boolean; onCreate: (input: Partial<DigitalEmployee>) => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [department, setDepartment] = useState('');
  const [description, setDescription] = useState('');
  const submit = () => {
    if (!name.trim() || !role.trim() || !department.trim()) return;
    onCreate({
      name,
      role,
      department,
      description,
      risk: 'low',
      responsibilities: ['待配置岗位职责'],
      prohibitedActions: ['待配置禁止行为'],
    });
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建数字伙伴"
      description="填写花名与岗位信息即可创建。创建后进入「配置中」，请继续完善授权契约与能力装配，完成评测后再申请上岗。"
      size="md"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button loading={loading} disabled={!name.trim() || !role.trim() || !department.trim()} onClick={submit}>
            创建数字伙伴
          </Button>
        </>
      )}
    >
      <div className="grid gap-4">
        <Field label="员工名称（花名）" value={name} onChange={setName} placeholder="例如：听潮" required />
        <Field label="岗位名称" value={role} onChange={setRole} placeholder="例如：安全事件分析专员" required />
        <Field label="所属部门" value={department} onChange={setDepartment} placeholder="例如：信息技术部" required />
        <label className="grid gap-1.5 text-xs font-medium">
          岗位说明
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            placeholder="说明服务对象、业务目标与人工升级条件。"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-normal outline-none focus:border-[var(--brand)]"
          />
        </label>
        <p className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] leading-5 text-[var(--text-muted)]">
          下一步建议：岗位配置 → 能力装配 → 质量评测 → 申请上岗。
        </p>
      </div>
    </Modal>
  );
}
function Field({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; required?: boolean }) { return <label className="grid gap-1.5 text-xs font-medium">{label}{required && <span className="ml-1 text-[var(--danger)]">*</span>}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-xs font-normal outline-none focus:border-[var(--brand)]" /></label>; }
