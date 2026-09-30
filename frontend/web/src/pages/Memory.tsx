import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive, AlertTriangle, ArrowRight, BrainCircuit, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ExternalLink,
  FileUp, History, Layers3, Search, ShieldCheck, Trash2, XCircle,
} from 'lucide-react';
import { Badge, Button, Input, toast } from '@qzda/web-ui';
import type { DigitalPartner, EvolveCandidate, MemoryAuditEvent, MemoryKnowledgeCandidate, MemoryLayer, MemoryPolicy, MemoryRecord, MemoryStatus } from '@qzda/web-types';
import { useApiMutation, useApiQuery } from '@/services/query';
import { ConfirmDialog, EmptyState, Modal, RoleReadonlyBanner } from '@/components/shared';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';
import { cn } from '@qzda/web-utils';
import { defaultMemoryTab, roleCanMutate, rolePageCopy } from '@/features/role-nav/role-nav';
import {
  MEMORY_PAGE_SIZE_KEY,
  MEMORY_PAGE_SIZE_OPTIONS,
  clampMemoryPage,
  memoryContentPreview,
  memoryPageCount,
  paginateItems,
  readMemoryPageSize,
  sortMemoryRecordsByRecency,
} from '@/features/memory/record-list';
import { dedupeMemoryAudits, memoryAuditReactKey } from '@/features/memory/audit-list';

type Tab = 'overview' | 'short_term' | 'working' | 'long_term' | 'candidates' | 'governance';
type StatusFilter = 'active' | 'all' | MemoryStatus;

const TABS: Array<{ key: Tab; labelKey: string; icon: typeof BrainCircuit }> = [
  { key: 'overview', labelKey: 'module.memory.tabs.overview', icon: BrainCircuit },
  { key: 'short_term', labelKey: 'module.memory.tabs.shortTerm', icon: Clock3 },
  { key: 'working', labelKey: 'module.memory.tabs.working', icon: Layers3 },
  { key: 'long_term', labelKey: 'module.memory.tabs.longTerm', icon: Archive },
  { key: 'candidates', labelKey: 'module.memory.tabs.candidates', icon: FileUp },
  { key: 'governance', labelKey: 'module.memory.tabs.governance', icon: ShieldCheck },
];

const LAYER: Record<MemoryLayer, { label: string; tone: 'brand' | 'warn' | 'success'; desc: string }> = {
  short_term: { label: '短期', tone: 'brand', desc: '单次会话上下文，按 TTL 自动清除' },
  working: { label: '工作', tone: 'warn', desc: '任务与工作流过程证据，随执行生命周期归档' },
  long_term: { label: '长期', tone: 'success', desc: '可复用经验，必须审核后才能转为知识' },
};

const CLASSIFICATION_LABEL: Record<MemoryRecord['classification'], string> = {
  internal: '内部',
  confidential: '机密',
  restricted: '受限',
};

const STATUS_LABEL: Record<MemoryStatus, string> = {
  active: '生效中',
  pending_review: '待审',
  expired: '已失效',
  revoked: '已撤销',
  promoted: '已晋升',
};

const SCOPE_LABEL: Record<MemoryRecord['scope'], string> = {
  user: '个人',
  team: '团队',
  workspace: '工作区',
  agent: '数字伙伴',
};

const SOURCE_LABEL: Record<MemoryRecord['sourceType'], string> = {
  conversation: '会话',
  task: '任务',
  workflow: '工作流',
  manual: '手工',
};

const LAYER_TAB: Record<MemoryLayer, Tab> = {
  short_term: 'short_term',
  working: 'working',
  long_term: 'long_term',
};

function sourcePath(record: MemoryRecord) {
  if (record.sourceType === 'task') return '/tasks';
  if (record.sourceType === 'workflow') return '/workflows';
  if (record.sourceType === 'conversation') return record.digitalPartnerId ? `/copilot?employeeId=${record.digitalPartnerId}` : '/copilot';
  return null;
}

function formatTime(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatFullTime(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN');
}

function capacityRatio(policy?: Pick<MemoryPolicy, 'usedCapacity' | 'longTermCapacity'>) {
  const capacity = policy?.longTermCapacity ?? 0;
  if (!capacity) return 0;
  return (policy?.usedCapacity ?? 0) / capacity;
}

export default function Memory() {
  const { t } = useT();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const canMutate = roleCanMutate(user?.role) && isAdmin;
  const pageCopy = rolePageCopy('memory', user?.role);
  const memoryDefault = defaultMemoryTab(user?.role);
  const [tab, setTab] = useState<Tab>(() => (memoryDefault === 'governance' ? 'governance' : 'overview'));
  const [query, setQuery] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ type: 'expire' | 'delete'; id: string; title: string } | null>(null);

  const overview = useApiQuery<any>(['memory', 'overview'], '/api/memory/overview');
  const records = useApiQuery<MemoryRecord[]>(['memory', 'records'], '/api/memory/records');
  const candidates = useApiQuery<MemoryKnowledgeCandidate[]>(['memory', 'candidates'], '/api/memory/candidates');
  const evolveCands = useApiQuery<EvolveCandidate[]>(['evolve', 'candidates'], '/api/evolve/candidates');
  const policy = useApiQuery<MemoryPolicy>(['memory', 'policy'], '/api/memory/policy');
  const audit = useApiQuery<MemoryAuditEvent[]>(['memory', 'audit'], '/api/memory/audit');
  const auditItems = useMemo(() => dedupeMemoryAudits(audit.data ?? []), [audit.data]);
  const employees = useApiQuery<DigitalPartner[]>(['digital-employees'], '/api/partners');

  const expire = useApiMutation<MemoryRecord, { id: string }>(({ id }) => `/api/memory/records/${id}/expire`);
  const remove = useApiMutation<{ id: string }, { id: string }>(({ id }) => `/api/memory/records/${id}`, undefined, 'DELETE');
  const candidate = useApiMutation<MemoryKnowledgeCandidate, { id: string }>(({ id }) => `/api/memory/records/${id}/candidate`);
  const review = useApiMutation<MemoryKnowledgeCandidate, { id: string; action: 'approve' | 'reject' }>(({ id, action }) => `/api/memory/candidates/${id}/${action}`);
  const evolveReview = useApiMutation<EvolveCandidate, { id: string; action: 'approve' | 'reject' }>(({ id, action }) => `/api/evolve/candidates/${id}/${action}`);
  const updatePolicy = useApiMutation<MemoryPolicy, Partial<MemoryPolicy>>('/api/memory/policy', undefined, 'PATCH');
  const runRefinement = useApiMutation<{ scheduledFor: string; workingCreated: number; longCreated: number; candidatesCreated: number }, Record<string, never>>('/api/memory/refinement/run');
  const runDream = useApiMutation<{ applied: number }, Record<string, never>>('/api/evolve/dream/run');

  const employeeMap = useMemo(() => {
    const map = new Map<string, DigitalPartner>();
    (employees.data ?? []).forEach((item) => map.set(item.id, item));
    return map;
  }, [employees.data]);

  const visible = useMemo(() => (records.data ?? []).filter((record) => {
    const matchesQuery = !query.trim() || `${record.title} ${record.content} ${record.correlationId}`.toLowerCase().includes(query.trim().toLowerCase());
    const layer = tab === 'short_term' ? 'short_term' : tab === 'working' ? 'working' : tab === 'long_term' ? 'long_term' : undefined;
    const matchesLayer = !layer || record.layer === layer;
    const matchesEmployee = employeeFilter === 'all' || record.digitalPartnerId === employeeFilter;
    const matchesStatus = statusFilter === 'all' || record.status === statusFilter;
    return matchesQuery && matchesLayer && matchesEmployee && matchesStatus;
  }), [records.data, query, tab, employeeFilter, statusFilter]);

  const detail = (records.data ?? []).find((record) => record.id === detailId) ?? null;
  const selectedEmployee = employeeFilter === 'all' ? undefined : employeeMap.get(employeeFilter);
  const report = (error: unknown) => toast.error(error instanceof Error ? error.message : '记忆操作失败');
  const visibleTabs = TABS.filter((item) => {
    if (user?.role === 'auditor') return item.key === 'governance' || item.key === 'overview' || item.key === 'long_term';
    return isAdmin || item.key !== 'governance';
  });
  const activePolicy = overview.data?.policy ?? policy.data;
  const ratio = capacityRatio(activePolicy);
  const showCapacityWarn = ratio >= 0.8;
  const showKpis = tab !== 'governance';

  const openLayer = (next: Tab) => {
    setTab(next);
    if (next === 'short_term' || next === 'working' || next === 'long_term') setStatusFilter('active');
  };

  const kpis: Array<{ key: Tab; label: string; value: number; icon: typeof Clock3; tone: string }> = [
    { key: 'short_term', label: '短期记忆', value: overview.data?.totals?.shortTerm ?? 0, icon: Clock3, tone: 'brand' },
    { key: 'working', label: '工作记忆', value: overview.data?.totals?.working ?? 0, icon: Layers3, tone: 'warn' },
    { key: 'long_term', label: '长期记忆', value: overview.data?.totals?.longTerm ?? 0, icon: Archive, tone: 'success' },
    { key: 'candidates', label: '知识候选待审', value: overview.data?.totals?.pendingCandidates ?? 0, icon: FileUp, tone: 'warn' },
  ];

  return (
    <div className="de-employee-page memory-page h-full min-w-0 overflow-y-auto bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5">
      <div className="memory-page__stack">
        <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
          <div className="flex items-start justify-between gap-4 px-4 py-3.5 md:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg">
                  <BrainCircuit className="h-4 w-4" />
                </div>
                <h1 className="text-base font-semibold text-[var(--text)]">{pageCopy.title}</h1>
              </div>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{pageCopy.subtitle}</p>
            </div>
            <div className="memory-guardrail shrink-0">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>{t('module.memory.guardrail')}</span>
            </div>
          </div>
          <div className="px-4 pt-1 md:px-5"><RoleReadonlyBanner className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]" /></div>
          <div className="de-employee-tabs flex overflow-x-auto px-3" role="tablist" aria-label={pageCopy.title}>
            {visibleTabs.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                onClick={() => openLayer(item.key)}
                className={cn('de-employee-tab flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs transition-colors', tab === item.key && 'is-active')}
              >
                <item.icon className="h-3.5 w-3.5" />{t(item.labelKey)}
              </button>
            ))}
          </div>
        </section>

        {showCapacityWarn && (
          <div className="memory-alert">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>长期记忆容量已使用 {Math.round(ratio * 100)}%（{activePolicy?.usedCapacity ?? 0} / {activePolicy?.longTermCapacity ?? 0}）。请优先提炼或清理低价值条目。</span>
          </div>
        )}

        {showKpis && (
          <section className="memory-kpis" aria-label="记忆摘要">
            {kpis.map((item) => (
              <button
                key={item.key}
                type="button"
                className={cn('memory-kpi', `memory-kpi--${item.tone}`, tab === item.key && 'is-active')}
                onClick={() => openLayer(item.key)}
              >
                <span className="memory-kpi__icon"><item.icon className="h-4 w-4" /></span>
                <span className="memory-kpi__body">
                  <span>{item.label}</span>
                  <strong>{item.value}<small>条</small></strong>
                </span>
              </button>
            ))}
          </section>
        )}

        <section className="de-employee-shell memory-workspace overflow-hidden rounded-xl bg-[var(--surface-1)]">
          {tab === 'overview' && (
            <Overview
              records={records.data ?? []}
              policy={activePolicy}
              audit={auditItems}
              employees={employees.data ?? []}
              employeeFilter={employeeFilter}
              selectedEmployee={selectedEmployee}
              onOpen={openLayer}
              onEmployeeFilter={setEmployeeFilter}
            />
          )}
          {(['short_term', 'working', 'long_term'] as Tab[]).includes(tab) && (
            <RecordList
              records={visible}
              layer={tab as MemoryLayer}
              query={query}
              statusFilter={statusFilter}
              employeeFilter={employeeFilter}
              employees={employees.data ?? []}
              employeeMap={employeeMap}
              onQuery={setQuery}
              onStatusFilter={setStatusFilter}
              onEmployeeFilter={setEmployeeFilter}
              onOpenDetail={setDetailId}
              onExpire={canMutate ? (id, title) => setConfirm({ type: 'expire', id, title }) : undefined}
              onDelete={canMutate ? (id, title) => setConfirm({ type: 'delete', id, title }) : undefined}
              onCandidate={canMutate ? (id) => candidate.mutate({ id }, { onSuccess: () => { toast.success('已提交知识候选，等待审核'); setTab('candidates'); }, onError: report }) : undefined}
              canMutate={canMutate}
            />
          )}
          {tab === 'candidates' && (
            <Candidates
              items={candidates.data ?? []}
              records={records.data ?? []}
              employeeMap={employeeMap}
              canReview={canMutate}
              onReview={(id, action) => review.mutate({ id, action }, {
                onSuccess: (item) => {
                  if (action === 'approve' && item.knowledgePackageId) {
                    toast.success(`已创建知识包草稿：${item.knowledgePackageId}`);
                    navigate(`/knowledge?package=${item.knowledgePackageId}&view=packages`);
                  } else {
                    toast.success(action === 'approve' ? '已创建知识包草稿' : '候选已拒绝');
                  }
                },
                onError: report,
              })}
            />
          )}
          {tab === 'governance' && (
            <GovernanceProgressive
              policy={policy.data}
              audit={auditItems}
              evolveItems={evolveCands.data ?? []}
              canMutate={canMutate}
              onUpdate={(patch) => updatePolicy.mutate(patch, { onSuccess: () => toast.success('记忆策略已更新并写入审计'), onError: report })}
              onRun={() => runRefinement.mutate({}, { onSuccess: (result) => toast.success(`渐进提炼完成：工作 ${result.workingCreated}，长期 ${result.longCreated}，候选 ${result.candidatesCreated}`), onError: report })}
              onDream={() => runDream.mutate({}, {
                onSuccess: (result) => toast.success(`Dream 压缩完成：${result.applied} 个会话`),
                onError: report,
              })}
              onEvolveReview={(id, action) => evolveReview.mutate({ id, action }, {
                onSuccess: (cand) => {
                  if (action === 'reject') toast.success('自进化候选已拒绝');
                  else if (cand.status === 'pending_countersign') toast.success('已首签，等待审计员会签');
                  else toast.success('自进化候选已通过（仅草稿/工作记忆）');
                },
                onError: report,
              })}
              running={runRefinement.isPending}
              dreaming={runDream.isPending}
            />
          )}
        </section>
      </div>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetailId(null)}
        title={detail?.title ?? '记忆详情'}
        description="查看来源链路、密级、过期与数字伙伴归属；运行记忆不等于权威知识。"
        size="lg"
      >
        {detail && (
          <MemoryDetail
            record={detail}
            employee={detail.digitalPartnerId ? employeeMap.get(detail.digitalPartnerId) : undefined}
            canMutate={canMutate}
            onClose={() => setDetailId(null)}
            onExpire={() => { setDetailId(null); setConfirm({ type: 'expire', id: detail.id, title: detail.title }); }}
            onDelete={() => { setDetailId(null); setConfirm({ type: 'delete', id: detail.id, title: detail.title }); }}
            onCandidate={() => {
              setDetailId(null);
              candidate.mutate({ id: detail.id }, { onSuccess: () => { toast.success('已提交知识候选，等待审核'); setTab('candidates'); }, onError: report });
            }}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        tone={confirm?.type === 'delete' ? 'danger' : 'default'}
        title={confirm?.type === 'delete' ? '删除记忆？' : '使记忆失效？'}
        description={confirm ? `「${confirm.title}」将被${confirm.type === 'delete' ? '撤销并保留审计痕迹' : '标记为失效并停止参与提炼'}。` : undefined}
        confirmText={confirm?.type === 'delete' ? '删除' : '失效'}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.type === 'expire') {
            expire.mutate({ id: confirm.id }, { onSuccess: () => toast.success('记忆已失效'), onError: report });
          } else {
            remove.mutate({ id: confirm.id }, { onSuccess: () => toast.success('记忆已删除'), onError: report });
          }
        }}
      />
    </div>
  );
}

function Overview({
  records,
  policy,
  audit,
  employees,
  employeeFilter,
  selectedEmployee,
  onOpen,
  onEmployeeFilter,
}: {
  records: MemoryRecord[];
  policy?: MemoryPolicy;
  audit: MemoryAuditEvent[];
  employees: DigitalPartner[];
  employeeFilter: string;
  selectedEmployee?: DigitalPartner;
  onOpen: (tab: Tab) => void;
  onEmployeeFilter: (value: string) => void;
}) {
  const scoped = employeeFilter === 'all' ? records : records.filter((record) => record.digitalPartnerId === employeeFilter);
  const ratio = Math.min(1, capacityRatio(policy));
  const layers = (['short_term', 'working', 'long_term'] as MemoryLayer[]).map((layer) => ({
    layer,
    ...LAYER[layer],
    count: scoped.filter((record) => record.layer === layer && record.status === 'active').length,
  }));

  return (
    <div className="memory-overview">
      <div className="memory-section-head">
        <div>
          <h2>记忆生命周期</h2>
          <p>短期会话 → 工作证据 → 长期经验 → 知识候选；岗位策略可与工作区默认值对照。</p>
        </div>
        <select
          value={employeeFilter}
          onChange={(event) => onEmployeeFilter(event.target.value)}
          className="memory-select"
          aria-label="按数字伙伴筛选"
        >
          <option value="all">全部数字伙伴</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>{employee.name} · {employee.role}</option>
          ))}
        </select>
      </div>

      {selectedEmployee && (
        <div className="memory-employee-banner">
          <div>
            <strong>{selectedEmployee.name}</strong>
            <span>
              岗位策略：短期 {selectedEmployee.memoryPolicy.shortTermHours}h · 工作 {selectedEmployee.memoryPolicy.workingDays} 天 ·
              提炼 {selectedEmployee.memoryPolicy.longTermCadence === 'daily' ? '每日' : '每周'} ·
              转知识 {selectedEmployee.memoryPolicy.knowledgePromotion === 'approval_required' ? '需审核' : '关闭'}
            </span>
          </div>
          <Link to={`/partners?employeeId=${selectedEmployee.id}`} className="memory-text-link">
            打开岗位契约 <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}

      <div className="memory-lifecycle">
        {layers.map((item, index) => (
          <div key={item.layer} className="memory-lifecycle__item">
            <button type="button" className={cn('memory-lifecycle__card', `is-${item.tone}`)} onClick={() => onOpen(LAYER_TAB[item.layer])}>
              <div className="memory-lifecycle__top">
                <Badge tone={item.tone}>{item.label}</Badge>
                <strong>{item.count}</strong>
              </div>
              <p>{item.desc}</p>
            </button>
            {index < layers.length - 1 && <ArrowRight className="memory-lifecycle__arrow" />}
          </div>
        ))}
        <div className="memory-lifecycle__item">
          <button type="button" className="memory-lifecycle__card is-warn" onClick={() => onOpen('candidates')}>
            <div className="memory-lifecycle__top">
              <Badge tone="warn">候选</Badge>
              <ArrowRight className="h-3.5 w-3.5 text-[var(--brand)]" />
            </div>
            <p>审核通过后进入知识中心草稿，不直接成为权威知识。</p>
          </button>
        </div>
      </div>

      <div className="memory-overview__grid">
        <section className="memory-panel">
          <div className="memory-panel__head">
            <h3><ShieldCheck className="h-4 w-4 text-[var(--brand)]" />当前工作区策略</h3>
            <p>默认 TTL、审批与容量边界，适用于本工作区全部数字伙伴。</p>
          </div>
          <div className="memory-policy-grid">
            <div className="memory-policy-stat">
              <span>短期保留</span>
              <strong>{policy?.shortTermTtlHours ?? 24}<small>小时</small></strong>
            </div>
            <div className="memory-policy-stat">
              <span>工作记忆保留</span>
              <strong>{policy?.workingMemoryTtlDays ?? 30}<small>天</small></strong>
            </div>
            <div className="memory-policy-stat">
              <span>长期写入审批</span>
              <strong className={policy?.longTermWriteApproval ? 'text-[var(--success)]' : ''}>{policy?.longTermWriteApproval ? '已启用' : '未启用'}</strong>
            </div>
            <div className="memory-policy-stat memory-policy-stat--wide">
              <div className="flex items-center justify-between gap-2">
                <span>长期容量</span>
                <strong>{policy?.usedCapacity ?? 0} / {policy?.longTermCapacity ?? 0}</strong>
              </div>
              <div className="memory-capacity-track" aria-hidden>
                <div className="memory-capacity-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
              </div>
            </div>
          </div>
          {selectedEmployee && (
            <p className="memory-policy-note">
              工作区默认 {policy?.shortTermTtlHours ?? 24}h / {policy?.workingMemoryTtlDays ?? 30} 天；
              {selectedEmployee.name} 岗位为 {selectedEmployee.memoryPolicy.shortTermHours}h / {selectedEmployee.memoryPolicy.workingDays} 天。
            </p>
          )}
        </section>

        <section className="memory-panel">
          <div className="memory-panel__head">
            <h3><History className="h-4 w-4 text-[var(--brand)]" />最近记忆变更</h3>
            <button type="button" className="memory-text-link" onClick={() => onOpen('governance')}>策略审计</button>
          </div>
          {audit.length ? (
            <div className="memory-audit-list">
              {audit.slice(0, 4).map((event, index) => (
                <div key={memoryAuditReactKey(event, index)} className="memory-audit-item">
                  <div>
                    <strong>{event.action}</strong>
                    <p>{event.target}</p>
                  </div>
                  <time>{formatTime(event.time)}</time>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={History} title="暂无记忆审计事件" />
          )}
        </section>
      </div>
    </div>
  );
}

function MemoryPagination({
  page,
  pageCount,
  pageSize,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="memory-pagination" role="navigation" aria-label="记忆列表分页">
      <span className="memory-pagination__meta">
        第 {page} / {pageCount} 页 · 显示 {from}-{to} / 共 {total} 条
      </span>
      <div className="memory-pagination__actions">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={onPrev}>
          <ChevronLeft className="h-3.5 w-3.5" />上一页
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={onNext}>
          下一页<ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function RecordList({
  records,
  layer,
  query,
  statusFilter,
  employeeFilter,
  employees,
  employeeMap,
  onQuery,
  onStatusFilter,
  onEmployeeFilter,
  onOpenDetail,
  onExpire,
  onDelete,
  onCandidate,
  canMutate = false,
}: {
  records: MemoryRecord[];
  layer: MemoryLayer;
  query: string;
  statusFilter: StatusFilter;
  employeeFilter: string;
  employees: DigitalPartner[];
  employeeMap: Map<string, DigitalPartner>;
  onQuery: (value: string) => void;
  onStatusFilter: (value: StatusFilter) => void;
  onEmployeeFilter: (value: string) => void;
  onOpenDetail: (id: string) => void;
  onExpire?: (id: string, title: string) => void;
  onDelete?: (id: string, title: string) => void;
  onCandidate?: (id: string) => void;
  canMutate?: boolean;
}) {
  const meta = LAYER[layer];
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => readMemoryPageSize(typeof window !== 'undefined' ? window.localStorage : null));
  const sorted = useMemo(() => sortMemoryRecordsByRecency(records), [records]);
  const pageCount = memoryPageCount(sorted.length, pageSize);
  const pageSafe = clampMemoryPage(page, pageCount);
  const pageItems = useMemo(() => paginateItems(sorted, pageSafe, pageSize), [sorted, pageSafe, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, employeeFilter, layer, pageSize]);

  useEffect(() => {
    if (page !== pageSafe) setPage(pageSafe);
  }, [page, pageSafe]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MEMORY_PAGE_SIZE_KEY, String(pageSize));
    } catch {
      /* ignore */
    }
  }, [pageSize]);

  return (
    <div className="memory-list">
      <div className="memory-section-head">
        <div>
          <h2>{meta.label}记忆 · {records.length} 条</h2>
          <p>按工作区隔离；默认仅展示生效中记录，可按数字伙伴与状态筛选。</p>
        </div>
        <div className="memory-toolbar">
          <select value={employeeFilter} onChange={(event) => onEmployeeFilter(event.target.value)} className="memory-select" aria-label="数字伙伴">
            <option value="all">全部数字伙伴</option>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => onStatusFilter(event.target.value as StatusFilter)} className="memory-select" aria-label="状态">
            <option value="active">生效中</option>
            <option value="pending_review">待审</option>
            <option value="expired">已失效</option>
            <option value="revoked">已撤销</option>
            <option value="promoted">已晋升</option>
            <option value="all">全部状态</option>
          </select>
          <label className="memory-select memory-select--inline">
            <span>每页</span>
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              aria-label="每页条数"
            >
              {MEMORY_PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size} 条</option>
              ))}
            </select>
          </label>
          <label className="memory-search">
            <Search className="h-3.5 w-3.5" />
            <Input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="检索标题、内容或关联 ID" className="h-9 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0" />
          </label>
        </div>
      </div>

      {records.length ? (
        <>
          <div className="memory-record-list">
            {pageItems.map((record) => {
              const employee = record.digitalPartnerId ? employeeMap.get(record.digitalPartnerId) : undefined;
              const href = sourcePath(record);
              const preview = memoryContentPreview(record.content);
              return (
                <article key={record.id} className={cn('memory-record', `is-${meta.tone}`)}>
                  <div className="memory-record__main">
                    <button type="button" className="memory-record__body" onClick={() => onOpenDetail(record.id)}>
                      <div className="memory-record__title">
                        <strong>{record.title}</strong>
                        <div className="memory-record__badges">
                          <Badge tone={meta.tone}>{Math.round(record.confidence * 100)}% 置信</Badge>
                          <Badge tone={record.classification === 'restricted' ? 'warn' : 'neutral'}>{CLASSIFICATION_LABEL[record.classification]}</Badge>
                          <Badge tone={record.status === 'active' ? 'success' : record.status === 'pending_review' ? 'warn' : 'neutral'}>{STATUS_LABEL[record.status]}</Badge>
                        </div>
                      </div>
                      {preview.kind === 'dialog' ? (
                        <div className="memory-record__preview">
                          {preview.lines.map((line) => (
                            <p key={`${record.id}-${line.role}`}>
                              <span className="memory-record__role">{line.role}</span>
                              {line.text}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="memory-record__snippet">{preview.text}</p>
                      )}
                      <span className="memory-record__more">查看全部</span>
                    </button>
                    <div className="memory-record__actions">
                      {href && (
                        <button type="button" className="memory-action" onClick={() => navigate(href)}>
                          <ExternalLink className="h-3.5 w-3.5" />回溯
                        </button>
                      )}
                      {canMutate && layer === 'long_term' && record.status === 'active' && onCandidate && (
                        <button type="button" className="memory-action memory-action--primary" onClick={() => onCandidate(record.id)}>
                          <FileUp className="h-3.5 w-3.5" />提炼
                        </button>
                      )}
                      {canMutate && record.status === 'active' && onExpire && (
                        <button type="button" className="memory-action" onClick={() => onExpire(record.id, record.title)}>
                          <Clock3 className="h-3.5 w-3.5" />失效
                        </button>
                      )}
                      {canMutate && onDelete && (
                        <button type="button" className="memory-action memory-action--danger" onClick={() => onDelete(record.id, record.title)}>
                          <Trash2 className="h-3.5 w-3.5" />删除
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="memory-record__meta">
                    <span>{employee ? `${employee.name} · ${employee.role}` : '未绑定数字伙伴'}</span>
                    <span>范围 {SCOPE_LABEL[record.scope]}</span>
                    <span title={formatFullTime(record.updatedAt || record.createdAt)}>{formatTime(record.updatedAt || record.createdAt)}</span>
                    {record.expiresAt && <span title={formatFullTime(record.expiresAt)}>过期 {formatTime(record.expiresAt)}</span>}
                    <span className="font-mono" title={`${SOURCE_LABEL[record.sourceType]}:${record.sourceId}`}>
                      {SOURCE_LABEL[record.sourceType]}:{record.sourceId}
                    </span>
                    <span className="font-mono memory-record__corr" title={record.correlationId}>{record.correlationId}</span>
                  </div>
                </article>
              );
            })}
          </div>
          <MemoryPagination
            page={pageSafe}
            pageCount={pageCount}
            pageSize={pageSize}
            total={sorted.length}
            onPrev={() => setPage((value) => Math.max(1, value - 1))}
            onNext={() => setPage((value) => Math.min(pageCount, value + 1))}
          />
        </>
      ) : (
        <div className="memory-empty">
          <EmptyState icon={Archive} title="没有匹配的记忆" description="记录将在会话、任务或工作流的受控执行中形成；可切换状态或数字伙伴筛选。" />
        </div>
      )}
    </div>
  );
}

function MemoryDetail({
  record,
  employee,
  canMutate = false,
  onClose,
  onExpire,
  onDelete,
  onCandidate,
}: {
  record: MemoryRecord;
  employee?: DigitalPartner;
  canMutate?: boolean;
  onClose: () => void;
  onExpire: () => void;
  onDelete: () => void;
  onCandidate: () => void;
}) {
  const href = sourcePath(record);
  const navigate = useNavigate();
  return (
    <div className="memory-detail">
      <div className="flex flex-wrap gap-2">
        <Badge tone={LAYER[record.layer].tone}>{LAYER[record.layer].label}</Badge>
        <Badge tone="neutral">{CLASSIFICATION_LABEL[record.classification]}</Badge>
        <Badge tone={record.status === 'active' ? 'success' : 'warn'}>{STATUS_LABEL[record.status]}</Badge>
        <Badge tone="brand">{Math.round(record.confidence * 100)}% 置信</Badge>
      </div>
      <p className="memory-detail__content">{record.content}</p>
      <dl className="memory-detail__grid">
        <Row label="数字伙伴" value={employee ? `${employee.name} · ${employee.role}` : '未绑定'} />
        <Row label="作用域" value={SCOPE_LABEL[record.scope]} />
        <Row label="来源类型" value={SOURCE_LABEL[record.sourceType]} />
        <Row label="来源 ID" value={record.sourceId} />
        <Row label="关联链路" value={record.correlationId} />
        <Row label="过期时间" value={formatFullTime(record.expiresAt)} />
        <Row label="创建时间" value={formatFullTime(record.createdAt)} />
        <Row label="更新时间" value={formatFullTime(record.updatedAt)} />
      </dl>
      <div className="flex flex-wrap gap-2">
        {employee && <Button size="sm" variant="secondary" onClick={() => navigate(`/partners?employeeId=${employee.id}`)}>查看岗位契约</Button>}
        {href && <Button size="sm" variant="secondary" onClick={() => navigate(href)}>打开来源</Button>}
        {canMutate && record.layer === 'long_term' && record.status === 'active' && (
          <Button size="sm" onClick={onCandidate}><FileUp className="h-3 w-3" />提炼为知识候选</Button>
        )}
        {canMutate && record.status === 'active' && <Button size="sm" variant="ghost" onClick={onExpire}>失效</Button>}
        {canMutate && <Button size="sm" variant="ghost" onClick={onDelete}>删除</Button>}
        <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
      </div>
    </div>
  );
}

function Candidates({
  items,
  records,
  employeeMap,
  canReview,
  onReview,
}: {
  items: MemoryKnowledgeCandidate[];
  records: MemoryRecord[];
  employeeMap: Map<string, DigitalPartner>;
  canReview: boolean;
  onReview: (id: string, action: 'approve' | 'reject') => void;
}) {
  const navigate = useNavigate();
  const pending = items.filter((item) => item.status === 'pending_review').length;
  return (
    <div className="memory-list">
      <div className="memory-section-head">
        <div>
          <h2>知识候选 · {pending} 待审</h2>
          <p>普通用户可提交候选；审核通过后创建知识包草稿并跳转知识中心。</p>
        </div>
      </div>
      {items.length ? (
        <div className="memory-record-list">
          {items.map((item) => {
            const source = records.find((record) => record.id === item.memoryId);
            const employee = source?.digitalPartnerId ? employeeMap.get(source.digitalPartnerId) : undefined;
            return (
              <article key={item.id} className="memory-record is-warn">
                <div className="memory-record__main">
                  <div className="memory-record__body">
                    <div className="memory-record__title">
                      <strong>{item.title}</strong>
                      <Badge tone={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'neutral' : 'warn'}>
                        {item.status === 'pending_review' ? '待审核' : item.status === 'approved' ? '已通过' : '已拒绝'}
                      </Badge>
                    </div>
                    <p>{item.summary}</p>
                  </div>
                  <div className="memory-record__actions">
                    {item.status === 'approved' && item.knowledgePackageId && (
                      <button type="button" className="memory-action memory-action--primary" onClick={() => navigate(`/knowledge?package=${item.knowledgePackageId}&view=packages`)}>
                        <ExternalLink className="h-3.5 w-3.5" />打开草稿
                      </button>
                    )}
                    {canReview && item.status === 'pending_review' && (
                      <>
                        <button type="button" className="memory-action memory-action--primary" onClick={() => onReview(item.id, 'approve')}>
                          <CheckCircle2 className="h-3.5 w-3.5" />通过
                        </button>
                        <button type="button" className="memory-action memory-action--danger" onClick={() => onReview(item.id, 'reject')}>
                          <XCircle className="h-3.5 w-3.5" />拒绝
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="memory-record__meta">
                  {employee && <span>{employee.name} · {employee.role}</span>}
                  <span>{CLASSIFICATION_LABEL[item.classification]}</span>
                  <span className="font-mono">来源 {item.sourceCorrelationId}</span>
                  <span>提交 {formatFullTime(item.submittedAt)}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="memory-empty">
          <EmptyState icon={FileUp} title="暂无待审核知识候选" description="从长期记忆提炼后将在此等待事实校验与责任人审核。" />
        </div>
      )}
    </div>
  );
}

function PolicyToggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('memory-switch', checked && 'is-on')}
    >
      <span />
    </button>
  );
}

function GovernanceProgressive({
  policy,
  audit,
  evolveItems = [],
  canMutate = false,
  onUpdate,
  onRun,
  onDream,
  onEvolveReview,
  running,
  dreaming,
}: {
  policy?: MemoryPolicy;
  audit: MemoryAuditEvent[];
  evolveItems?: EvolveCandidate[];
  canMutate?: boolean;
  onUpdate: (patch: Partial<MemoryPolicy>) => void;
  onRun: () => void;
  onDream?: () => void;
  onEvolveReview?: (id: string, action: 'approve' | 'reject') => void;
  running: boolean;
  dreaming?: boolean;
}) {
  const [time, setTime] = useState(policy?.dailyRefinementTime ?? '02:00');
  const [confidence, setConfidence] = useState(String(policy?.minimumConfidence ?? .85));
  const stages = [
    { key: 'shortToWorkingEnabled' as const, label: '短期 → 工作', desc: '会话结束后归纳上下文，作为任务与交接的可追溯工作记忆。' },
    { key: 'workingToLongEnabled' as const, label: '工作 → 长期', desc: '每日筛选达到置信阈值的任务经验，沉淀为可复用长期记忆。' },
    { key: 'longToKnowledgeEnabled' as const, label: '长期 → 知识候选', desc: '每日提炼长期记忆为待审核候选，审核后才创建知识包草稿。' },
  ];
  const kindLabel: Record<EvolveCandidate['kind'], string> = {
    memory_promote: '记忆晋升',
    skill_patch: '技能补丁',
    routing_hint: '路由草稿',
    dream: 'Dream 压缩',
  };
  const pendingEvolve = evolveItems.filter((item) => item.status === 'pending_review' || item.status === 'pending_countersign');

  return (
    <div className="memory-governance">
      <section className="memory-panel">
        <div className="memory-panel__head">
          <div>
            <h3>自进化候选（审核前不改生产）</h3>
            <p>回合偏好、点赞点踩与路由建议仅生成候选；通过后写入工作记忆或草稿，不会直接 published 路由/技能。</p>
          </div>
          {canMutate && onDream && (
            <Button size="sm" variant="secondary" loading={dreaming} onClick={onDream}>运行 Dream</Button>
          )}
        </div>
        {evolveItems.length ? (
          <div className="memory-audit-list">
            {evolveItems.slice(0, 20).map((item) => (
              <div key={item.id} className="memory-audit-item">
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.summary}</p>
                  <span className="font-mono">
                    {kindLabel[item.kind] ?? item.kind} · {item.status}
                    {item.correlationId ? ` · ${item.correlationId}` : ''}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <time>{formatFullTime(item.submittedAt)}</time>
                  {canMutate && (item.status === 'pending_review' || item.status === 'pending_countersign') && onEvolveReview && (
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => onEvolveReview(item.id, 'approve')}>
                        {item.status === 'pending_countersign' ? '会签通过' : (item.kind === 'skill_patch' || item.kind === 'routing_hint' ? '首签' : '通过')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => onEvolveReview(item.id, 'reject')}>拒绝</Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={BrainCircuit} title="暂无自进化候选" description="会话偏好、点踩反馈或多专家回合后会出现待审项。" />
        )}
        {pendingEvolve.length > 0 && (
          <p className="mt-2 text-xs text-[var(--text-muted)]">待审 {pendingEvolve.length} 条</p>
        )}
      </section>

      <section className="memory-panel">
        <div className="memory-panel__head">
          <div>
            <h3>每日渐进提炼策略</h3>
            <p>{canMutate ? '生产环境由调度器按策略运行；此处触发一次提炼演练并写入审计。' : '只读核查调度策略与提炼链路；审计角色不可改写或演练。'}</p>
          </div>
          {canMutate && <Button size="sm" loading={running} onClick={onRun}>立即演练</Button>}
        </div>
        <div className="memory-stage-list">
          {stages.map((stage) => (
            <div key={stage.key} className="memory-stage">
              <div>
                <strong>{stage.label}</strong>
                <p>{stage.desc}</p>
              </div>
              {canMutate ? (
                <PolicyToggle checked={policy?.[stage.key] ?? true} onChange={(value) => onUpdate({ [stage.key]: value })} label={stage.label} />
              ) : (
                <Badge tone={policy?.[stage.key] ?? true ? 'success' : 'neutral'}>{policy?.[stage.key] ?? true ? '已启用' : '已关闭'}</Badge>
              )}
            </div>
          ))}
        </div>
        {canMutate ? (
          <>
            <div className="memory-gov-fields">
              <label>每日运行时间
                <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="mt-1.5 h-9 text-xs" />
              </label>
              <label>最低置信度
                <Input type="number" min="0" max="1" step="0.05" value={confidence} onChange={(event) => setConfidence(event.target.value)} className="mt-1.5 h-9 text-xs" />
              </label>
            </div>
            <div className="memory-gov-toggles">
              <label>
                <span>长期写入需审核</span>
                <PolicyToggle checked={policy?.longTermWriteApproval ?? true} onChange={(value) => onUpdate({ longTermWriteApproval: value })} label="长期写入需审核" />
              </label>
              <label>
                <span>敏感数据脱敏</span>
                <PolicyToggle checked={policy?.sensitiveDataMasking ?? true} onChange={(value) => onUpdate({ sensitiveDataMasking: value })} label="敏感数据脱敏" />
              </label>
            </div>
            <Button className="mt-4" size="sm" onClick={() => onUpdate({ dailyRefinementTime: time, minimumConfidence: Number(confidence) })}>
              保存调度策略
            </Button>
          </>
        ) : (
          <dl className="memory-detail__grid mt-3">
            <Row label="每日运行时间" value={policy?.dailyRefinementTime ?? '02:00'} />
            <Row label="最低置信度" value={String(policy?.minimumConfidence ?? 0.85)} />
            <Row label="长期写入需审核" value={policy?.longTermWriteApproval ?? true ? '是' : '否'} />
            <Row label="敏感数据脱敏" value={policy?.sensitiveDataMasking ?? true ? '是' : '否'} />
          </dl>
        )}
      </section>

      <section className="memory-panel">
        <div className="memory-panel__head">
          <h3><History className="h-4 w-4" />记忆审计</h3>
        </div>
        {audit.length ? (
          <div className="memory-audit-list memory-audit-list--tall">
            {audit.map((event, index) => (
              <div key={memoryAuditReactKey(event, index)} className="memory-audit-item">
                <div>
                  <strong>{event.action}</strong>
                  <p>{event.target}</p>
                  <span className="font-mono">{event.actor} · {event.correlationId}</span>
                </div>
                <time>{formatFullTime(event.time)}</time>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={History} title="暂无记忆审计事件" />
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="memory-kv">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
