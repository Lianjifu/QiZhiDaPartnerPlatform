/**
 * MemoryPage — 记忆中心路由壳:tab 切换 + KPI + 详情 Modal + 9 query / 7 mutation。
 * M07 P1 拆分原因:原 pages/Memory.tsx 单文件 1043L,主壳 + Tab 拆分后治理。
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Archive, BrainCircuit, Clock3, FileUp, Layers3, ShieldCheck } from 'lucide-react';
import { toast } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { ConfirmDialog, Modal, RoleReadonlyBanner } from '@/components/shared';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';
import { defaultMemoryTab, roleCanMutate, rolePageCopy } from '@/features/role-nav/role-nav';
import { dedupeMemoryAudits } from '@/features/memory/audit-list';
import type {
  DigitalPartner,
  EvolveCandidate,
  MemoryAuditEvent,
  MemoryKnowledgeCandidate,
  MemoryLayer,
  MemoryPolicy,
  MemoryRecord,
  MemoryStatus,
} from '@qzda/web-types';
import { MemoryTabCandidates } from './MemoryTab.Candidates';
import { MemoryTabGovernance } from './MemoryTab.Governance';
import { MemoryTabOverview } from './MemoryTab.Overview';
import { MemoryTabRecords } from './MemoryTab.Records';
import { MemoryStatusFilter, MemoryTabKey, MEMORY_TABS, memoryCapacityRatio } from './MemoryShared';
import { MemoryDetail } from './MemoryDetail';

export default function MemoryPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const canMutate = roleCanMutate(user?.role) && isAdmin;
  const pageCopy = rolePageCopy('memory', user?.role);
  const memoryDefault = defaultMemoryTab(user?.role);
  const [tab, setTab] = useState<MemoryTabKey>(() => (memoryDefault === 'governance' ? 'governance' : 'overview'));
  const [query, setQuery] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<MemoryStatusFilter>('active');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ type: 'expire' | 'delete'; id: string; title: string } | null>(null);

  const overview = useApiQuery<{ totals?: { shortTerm?: number; working?: number; longTerm?: number; pendingCandidates?: number }; policy?: MemoryPolicy }>(
    ['memory', 'overview'],
    '/api/memory/overview',
  );
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
  const review = useApiMutation<MemoryKnowledgeCandidate, { id: string; action: 'approve' | 'reject' }>(
    ({ id, action }) => `/api/memory/candidates/${id}/${action}`,
  );
  const evolveReview = useApiMutation<EvolveCandidate, { id: string; action: 'approve' | 'reject' }>(
    ({ id, action }) => `/api/evolve/candidates/${id}/${action}`,
  );
  const updatePolicy = useApiMutation<MemoryPolicy, Partial<MemoryPolicy>>('/api/memory/policy', undefined, 'PATCH');
  const runRefinement = useApiMutation<
    { scheduledFor: string; workingCreated: number; longCreated: number; candidatesCreated: number },
    Record<string, never>
  >('/api/memory/refinement/run');
  const runDream = useApiMutation<{ applied: number }, Record<string, never>>('/api/evolve/dream/run');

  const employeeMap = useMemo(() => {
    const map = new Map<string, DigitalPartner>();
    (employees.data ?? []).forEach((item) => map.set(item.id, item));
    return map;
  }, [employees.data]);

  const visible = useMemo(
    () =>
      (records.data ?? []).filter((record) => {
        const matchesQuery = !query.trim()
          || `${record.title} ${record.content} ${record.correlationId}`.toLowerCase().includes(query.trim().toLowerCase());
        const layer = tab === 'short_term' ? 'short_term' : tab === 'working' ? 'working' : tab === 'long_term' ? 'long_term' : undefined;
        const matchesLayer = !layer || record.layer === layer;
        const matchesEmployee = employeeFilter === 'all' || record.digitalPartnerId === employeeFilter;
        const matchesStatus = statusFilter === 'all' || record.status === statusFilter;
        return matchesQuery && matchesLayer && matchesEmployee && matchesStatus;
      }),
    [records.data, query, tab, employeeFilter, statusFilter],
  );

  const detail = (records.data ?? []).find((record) => record.id === detailId) ?? null;
  const selectedEmployee = employeeFilter === 'all' ? undefined : employeeMap.get(employeeFilter);
  const report = (error: unknown) => toast.error(error instanceof Error ? error.message : '记忆操作失败');
  const visibleTabs = MEMORY_TABS.filter((item) => {
    if (user?.role === 'auditor') return item.key === 'governance' || item.key === 'overview' || item.key === 'long_term';
    return isAdmin || item.key !== 'governance';
  });
  const activePolicy = overview.data?.policy ?? policy.data;
  const ratio = memoryCapacityRatio(activePolicy);
  const showCapacityWarn = ratio >= 0.8;
  const showKpis = tab !== 'governance';

  const openLayer = (next: MemoryTabKey) => {
    setTab(next);
    if (next === 'short_term' || next === 'working' || next === 'long_term') setStatusFilter('active');
  };

  const kpis: Array<{ key: MemoryTabKey; label: string; value: number; icon: typeof Clock3; tone: string }> = [
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
          <div className="px-4 pt-1 md:px-5">
            <RoleReadonlyBanner className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]" />
          </div>
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
            <MemoryTabOverview
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
          {(['short_term', 'working', 'long_term'] as MemoryTabKey[]).includes(tab) && (
            <MemoryTabRecords
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
              onCandidate={
                canMutate
                  ? (id) =>
                      candidate.mutate(
                        { id },
                        {
                          onSuccess: () => {
                            toast.success('已提交知识候选，等待审核');
                            setTab('candidates');
                          },
                          onError: report,
                        },
                      )
                  : undefined
              }
              canMutate={canMutate}
            />
          )}
          {tab === 'candidates' && (
            <MemoryTabCandidates
              items={candidates.data ?? []}
              records={records.data ?? []}
              employeeMap={employeeMap}
              canReview={canMutate}
              onReview={(id, action) =>
                review.mutate(
                  { id, action },
                  {
                    onSuccess: (item) => {
                      if (action === 'approve' && item.knowledgePackageId) {
                        toast.success(`已创建知识包草稿：${item.knowledgePackageId}`);
                        navigate(`/knowledge?package=${item.knowledgePackageId}&view=packages`);
                      } else {
                        toast.success(action === 'approve' ? '已创建知识包草稿' : '候选已拒绝');
                      }
                    },
                    onError: report,
                  },
                )
              }
            />
          )}
          {tab === 'governance' && (
            <MemoryTabGovernance
              policy={policy.data}
              audit={auditItems}
              evolveItems={evolveCands.data ?? []}
              canMutate={canMutate}
              onUpdate={(patch) =>
                updatePolicy.mutate(patch, {
                  onSuccess: () => toast.success('记忆策略已更新并写入审计'),
                  onError: report,
                })
              }
              onRun={() =>
                runRefinement.mutate(
                  {},
                  {
                    onSuccess: (result) =>
                      toast.success(`渐进提炼完成：工作 ${result.workingCreated}，长期 ${result.longCreated}，候选 ${result.candidatesCreated}`),
                    onError: report,
                  },
                )
              }
              onDream={() =>
                runDream.mutate(
                  {},
                  {
                    onSuccess: (result) => toast.success(`Dream 压缩完成：${result.applied} 个会话`),
                    onError: report,
                  },
                )
              }
              onEvolveReview={(id, action) =>
                evolveReview.mutate(
                  { id, action },
                  {
                    onSuccess: (cand) => {
                      if (action === 'reject') toast.success('自进化候选已拒绝');
                      else if (cand.status === 'pending_countersign') toast.success('已首签，等待审计员会签');
                      else toast.success('自进化候选已通过（仅草稿/工作记忆）');
                    },
                    onError: report,
                  },
                )
              }
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
            onExpire={() => {
              setDetailId(null);
              setConfirm({ type: 'expire', id: detail.id, title: detail.title });
            }}
            onDelete={() => {
              setDetailId(null);
              setConfirm({ type: 'delete', id: detail.id, title: detail.title });
            }}
            onCandidate={() => {
              setDetailId(null);
              candidate.mutate(
                { id: detail.id },
                {
                  onSuccess: () => {
                    toast.success('已提交知识候选，等待审核');
                    setTab('candidates');
                  },
                  onError: report,
                },
              );
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