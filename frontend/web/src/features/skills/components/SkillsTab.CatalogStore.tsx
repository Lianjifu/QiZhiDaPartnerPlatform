/**
 * 技能中心 · 目录子页之「商店」视图（M09 P1 拆分）。
 *
 * 由原 SkillsTab.Catalog.tsx 拆分出来：商店筛选 toolbar、商店 grid、商店安装预检 modal。
 * 与 SkillsTab.Catalog.tsx 复用同一份 apiCatalog / apiInstalled。
 */
import { useMemo, useState } from 'react';
import { useApiMutation, useApiQuery } from '@/services/query';
import { Badge, Button, Input } from '@qzda/web-ui';
import { CheckCircle2, Search, ShieldCheck, Sparkles, Star } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import type { Skill, SkillInstallPreflight, SkillRuntimeHealth } from '@qzda/web-types';
import { Modal, EmptyState } from '@/components/shared';
import { KIND_META, KIND_PROFILE, buildHealthBySkillId, enrichSkillRow, type SkillRow } from './SkillsShared';
import { Stat } from './SkillsModals';

const EMPTY_CATALOG: Skill[] = [];
const EMPTY_HEALTH: SkillRuntimeHealth[] = [];
const STORE_PAGE_SIZE = 8;

export function CatalogStoreView({
  installedRows,
  setInstalledRows,
  canWrite,
  isAdmin,
  onNotice,
  initialStorePage,
  initialStoreSearchQ,
  initialStoreRiskFilter,
  initialStoreChannelFilter,
  initialStoreReleaseFilter,
  initialCertifiedOnly,
  initialTypeFilter,
  onTypeFilterChange,
  onStorePageChange,
  onInstalled,
}: {
  installedRows: SkillRow[];
  setInstalledRows: React.Dispatch<React.SetStateAction<SkillRow[]>>;
  canWrite: boolean;
  isAdmin: boolean;
  onNotice: (msg: string) => void;
  onInstalled?: (skill: Skill) => void;
  initialStorePage: number;
  initialStoreSearchQ: string;
  initialStoreRiskFilter: 'all' | 'low' | 'mid' | 'high';
  initialStoreChannelFilter: 'all' | 'builtin' | 'registry' | 'promoted';
  initialStoreReleaseFilter: 'all' | 'stable' | 'beta';
  initialCertifiedOnly: boolean;
  initialTypeFilter: 'all' | Skill['kind'];
  onTypeFilterChange: (next: 'all' | Skill['kind']) => void;
  onStorePageChange: (next: number) => void;
}) {
  const [storeSearchQ, setStoreSearchQ] = useState(initialStoreSearchQ);
  const [storeRiskFilter, setStoreRiskFilter] = useState(initialStoreRiskFilter);
  const [storeChannelFilter, setStoreChannelFilter] = useState(initialStoreChannelFilter);
  const [storeReleaseFilter, setStoreReleaseFilter] = useState(initialStoreReleaseFilter);
  const [certifiedOnly, setCertifiedOnly] = useState(initialCertifiedOnly);
  const [storePage, setStorePage] = useState(initialStorePage);
  const [approvalTicket, setApprovalTicket] = useState('');
  const [storePreview, setStorePreview] = useState<{ skill: any; preflight: SkillInstallPreflight } | null>(null);

  const { data: apiCatalogData } = useApiQuery<{
    items: Skill[];
    meta?: { demoNotice?: string; channels?: Array<{ id: string; label: string }> };
  }>(['skills', 'catalog'], '/api/skills/catalog');
  const { data: governanceHealthData } = useApiQuery<SkillRuntimeHealth[]>(
    ['skills', 'governance', 'health'],
    '/api/skills/governance/health',
  );
  const apiCatalog = apiCatalogData?.items ?? EMPTY_CATALOG;
  const catalogMeta = apiCatalogData?.meta;
  const governanceHealth = governanceHealthData ?? EMPTY_HEALTH;
  const healthBySkillId = useMemo(() => buildHealthBySkillId(governanceHealth), [governanceHealth]);

  const filtered: SkillRow[] = useMemo(() => apiCatalog
    .filter((s) => initialTypeFilter === 'all' || s.kind === initialTypeFilter)
    .map((skill) => enrichSkillRow(skill, healthBySkillId))
    .filter((s) => (!storeSearchQ || `${s.name} ${s.description} ${(s as any).publisher ?? ''}`.toLowerCase().includes(storeSearchQ.toLowerCase()))
      && (storeRiskFilter === 'all' || (s as any).riskLevel === storeRiskFilter)
      && (storeChannelFilter === 'all' || (s as any).channel === storeChannelFilter)
      && (storeReleaseFilter === 'all' || (s as any).releaseChannel === storeReleaseFilter)
      && (!certifiedOnly || (s as any).signed === true)), [
    apiCatalog, initialTypeFilter, storeSearchQ, storeRiskFilter, storeChannelFilter, storeReleaseFilter, certifiedOnly, healthBySkillId,
  ]);
  const storeTotalPages = Math.max(1, Math.ceil(filtered.length / STORE_PAGE_SIZE));
  const pagedStoreSkills = filtered.slice((storePage - 1) * STORE_PAGE_SIZE, storePage * STORE_PAGE_SIZE);

  useMemo(() => { if (storePage > storeTotalPages) { setStorePage(storeTotalPages); onStorePageChange(storeTotalPages); } }, [storePage, storeTotalPages]);

  const syncCatalogMutation = useApiMutation<{ acceptedCount: number; rejectedCount: number }, { seedDemo?: boolean }>(
    '/api/skills/catalog/sync',
    {
      onSuccess: (result) => onNotice(`Registry 同步完成：接受 ${result.acceptedCount}，拒绝 ${result.rejectedCount}`),
      onError: (error) => onNotice(error instanceof Error ? error.message : 'Registry 同步失败'),
    },
  );
  const preflightMutation = useApiMutation<SkillInstallPreflight, { id: string }>(({ id }) => `/api/skills/${id}/preflight`);
  const installSkillMutation = useApiMutation<Skill, any>(({ id }) => `/api/skills/${id}/install`, {
    onSuccess: (skill) => {
      const items = (Array.isArray(skill) ? skill : [skill]);
      setInstalledRows((prev) => [...prev, ...items.map((item) => enrichSkillRow(item, healthBySkillId))]);
      if (items[0]) onInstalled?.(items[0]);
    },
  });

  const handleInstallFromStore = (storeItem: any) => {
    if (!canWrite) return;
    preflightMutation.mutate({ id: storeItem.id }, {
      onSuccess: (preflight) => { setApprovalTicket(''); setStorePreview({ skill: storeItem, preflight }); },
      onError: (error) => onNotice(error instanceof Error ? error.message : '安装预检失败'),
    });
  };

  return (
    <>
      <div className="skills-store-shell mb-5 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]">
        <div className="skills-store-toolbar">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="skills-store-toolbar__title">技能商店</h3>
              <Badge tone="neutral" className="text-[10px]">{filtered.length} 项</Badge>
              <Badge tone="info" className="text-[10px]">三层来源</Badge>
            </div>
            <p className="mt-1.5 max-w-[72ch] text-[12px] leading-5 text-[var(--text-muted)]">
              {catalogMeta?.demoNotice ?? '安装前将执行发布方、签名、依赖与风险预检；生产来源以 Registry 同步与工作区晋升为主。'}
            </p>
          </div>
          {isAdmin && canWrite && (
            <Button size="sm" variant="secondary" loading={syncCatalogMutation.isPending} onClick={() => syncCatalogMutation.mutate({ seedDemo: true })}>
              同步 Registry
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-5 py-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input value={storeSearchQ} onChange={(event) => setStoreSearchQ(event.target.value)} placeholder="搜索技能、系统或发布方" className="h-9 w-60 pl-8 text-xs" />
          </div>
          <div className="flex rounded-lg bg-[var(--bg-elevated)] p-1" role="tablist" aria-label="商店能力类型">
            {(['all', 'skill', 'mcp', 'tool'] as const).map((kind) => (
              <button key={kind} type="button" role="tab" aria-selected={initialTypeFilter === kind} onClick={() => onTypeFilterChange(kind)} className={cn('rounded-md px-3 py-1.5 text-[11px]', initialTypeFilter === kind ? 'bg-[var(--surface-1)] font-semibold text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]')}>
                {kind === 'all' ? '全部类型' : kind.toUpperCase()}
              </button>
            ))}
          </div>
          <select value={storeChannelFilter} onChange={(event) => setStoreChannelFilter(event.target.value as typeof storeChannelFilter)} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[11px]" aria-label="来源筛选">
            <option value="all">全部来源</option>
            <option value="builtin">平台内置</option>
            <option value="registry">企业 Registry</option>
            <option value="promoted">工作区晋升</option>
          </select>
          <select value={storeReleaseFilter} onChange={(event) => setStoreReleaseFilter(event.target.value as typeof storeReleaseFilter)} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[11px]" aria-label="发布频道">
            <option value="all">全部频道</option>
            <option value="stable">stable</option>
            <option value="beta">beta</option>
          </select>
          <select value={storeRiskFilter} onChange={(event) => setStoreRiskFilter(event.target.value as typeof storeRiskFilter)} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[11px]" aria-label="风险筛选">
            <option value="all">全部风险</option>
            <option value="low">低风险</option>
            <option value="mid">中风险</option>
            <option value="high">高风险</option>
          </select>
          <label className="ml-auto flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            <input type="checkbox" checked={certifiedOnly} onChange={(event) => setCertifiedOnly(event.target.checked)} className="accent-[var(--brand)]" />
            仅企业认证
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Sparkles} title="商店暂无匹配技能" description="试试切换类型、风险或认证筛选，或等待新上架" />
      ) : (
        <div className="skills-store-grid">
          {pagedStoreSkills.map((s) => {
            const meta = KIND_META[s.kind];
            const profile = KIND_PROFILE[s.kind];
            const Icon = meta.icon;
            const isInInstalled = installedRows.some((i) => i.id === s.id || i.name === s.name);
            const market = s as any;
            return (
              <div key={s.id} onClick={() => undefined} className={cn('skill-store-card tile-brandable', isInInstalled && 'is-installed')}>
                <div className="flex items-start gap-3.5">
                  <div className={cn('grid h-10 w-10 place-items-center rounded-xl shrink-0', profile.iconSurface)}><Icon className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)]">{s.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">{meta.label}</span>
                      {isInInstalled && <span className="knowledge-status-dot is-ready ml-auto shrink-0">已安装</span>}
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[12px] leading-5 text-[var(--text-muted)]">{s.description}</p>
                  </div>
                </div>
                <div className="skill-store-card__specs">
                  <div><span>{profile.primaryLabel}</span><strong>{profile.primaryValue}</strong></div>
                  <div><span>{profile.secondaryLabel}</span><strong>{profile.secondaryValue}</strong></div>
                </div>
                <div className="skill-store-card__meta">
                  {s.riskLevel === 'high' ? <span className="is-high">高风险</span>
                    : s.riskLevel === 'mid' ? <span className="is-mid">中风险</span>
                    : <span className="is-low">低风险</span>}
                  <span className="font-mono">v{s.version}</span>
                  <span className="inline-flex items-center gap-1 text-[var(--warning)]"><Star className="h-3.5 w-3.5 fill-current" />{s.rating}</span>
                  <span>安装 {s.installCount?.toLocaleString() ?? '—'}</span>
                  <span className={cn(s.cacheable ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>{s.cacheable ? '可缓存' : '无缓存'}</span>
                </div>
                <dl className="skill-store-card__foot">
                  <div><dt>来源</dt><dd>{market.channelLabel ?? (market.channel === 'registry' ? '企业 Registry' : market.channel === 'promoted' ? '工作区晋升' : '平台内置')}</dd></div>
                  <div><dt>频道</dt><dd className="font-mono">{market.releaseChannel ?? 'stable'}</dd></div>
                  <div><dt>发布方</dt><dd>{market.publisher ?? '社区发布方'}</dd></div>
                  <div><dt>签名</dt><dd className={market.signed ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>{market.signed ? '已验证' : '待验证'}</dd></div>
                </dl>
                <Button
                  size="sm"
                  variant={isInInstalled ? 'secondary' : 'primary'}
                  className="mt-1 w-full"
                  disabled={isInInstalled || !canWrite}
                  onClick={(event) => { event.stopPropagation(); handleInstallFromStore(s); }}
                >
                  {isInInstalled ? <><CheckCircle2 className="h-3.5 w-3.5" />已在启用清单</> : <><ShieldCheck className="h-3.5 w-3.5" />预检并安装</>}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-[var(--text-muted)]">共 {filtered.length} 项，每页 {STORE_PAGE_SIZE} 项</span>
          <StorePagination current={storePage} total={storeTotalPages} onChange={(page) => { setStorePage(page); onStorePageChange(page); }} />
        </div>
      )}

      <Modal
        open={!!storePreview}
        onClose={() => { setStorePreview(null); setApprovalTicket(''); }}
        title={storePreview ? `安装预览 · ${storePreview.skill.name}` : '安装预览'}
        description="安装仅将能力纳管到技能列表，不会自动授予智能体或工作流执行权限。"
        size="lg"
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setStorePreview(null); setApprovalTicket(''); }}>取消</Button>
            <Button
              disabled={!canWrite || storePreview?.preflight.decision === 'blocked' || (storePreview?.preflight.requiresApproval && !approvalTicket.trim())}
              onClick={() => {
                if (!storePreview || !canWrite) return;
                const { skill, preflight } = storePreview;
                if (preflight.decision === 'blocked') { onNotice(preflight.reason ?? '预检未通过，无法安装'); setStorePreview(null); return; }
                if (preflight.requiresApproval && !approvalTicket.trim()) { onNotice('该能力需要审批单号后才能安装'); return; }
                installSkillMutation.mutate(
                  { ...skill, approvalTicket: preflight.requiresApproval ? approvalTicket.trim() : undefined },
                  {
                    onSuccess: () => {
                      onNotice(preflight.requiresApproval
                        ? `已凭审批单 ${approvalTicket.trim()} 完成安装，可继续分配给智能体或工作流。`
                        : '技能已安装到技能列表，可继续分配给智能体或工作流。');
                      setStorePreview(null);
                      setApprovalTicket('');
                    },
                    onError: (error) => onNotice(error instanceof Error ? error.message : '安装失败'),
                  },
                );
              }}
            >{storePreview?.preflight.requiresApproval ? '提交审批并安装' : '确认安装'}</Button>
          </>
        )}
      >
        {storePreview && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="发布方" value={(storePreview.skill as any).publisher ?? '社区发布方'} />
              <Stat label="签名" value={storePreview.preflight.signatureValid ? '已验证' : '未验证'} tone={storePreview.preflight.signatureValid ? 'success' : 'error'} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="许可证" value={(storePreview.skill as any).license ?? '待确认'} />
              <Stat label="漏洞" value={`${storePreview.preflight.vulnerabilityCount ?? (storePreview.skill as any).vulnerabilityCount ?? 0} 项`} tone={(storePreview.preflight.vulnerabilityCount ?? (storePreview.skill as any).vulnerabilityCount) ? 'error' : 'success'} />
              <Stat label="最近扫描" value={(storePreview.skill as any).lastScannedAt ?? '—'} />
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
              <div className="mb-2 font-semibold">依赖与风险预检</div>
              <div className="space-y-1.5">
                {storePreview.preflight.dependencies.length
                  ? storePreview.preflight.dependencies.map((dependency) => (
                    <div key={dependency.name} className="flex justify-between">
                      <span>{dependency.name}</span>
                      <Badge tone={dependency.status === 'ready' ? 'success' : 'error'} className="text-[9px]">{dependency.status === 'ready' ? '已就绪' : '缺失'}</Badge>
                    </div>
                  ))
                  : <span className="text-[var(--success)]">无额外依赖</span>}
                {(storePreview.preflight.checks?.length ?? 0) > 0 && (
                  <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
                    {storePreview.preflight.checks!.map((check) => (
                      <div key={check.label} className="flex justify-between gap-2">
                        <span>{check.label}</span>
                        <Badge tone={check.status === 'passed' ? 'success' : check.status === 'review' ? 'warn' : 'error'} className="text-[9px]">{check.status === 'passed' ? '通过' : check.status === 'review' ? '待复核' : '未通过'}</Badge>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 border-t border-[var(--border)] pt-2">
                  适用环境：{((storePreview.skill as any).supportedEnvironments ?? ['待验证']).join('、')}
                  <span className="ml-3">风险等级：<Badge tone={storePreview.skill.riskLevel === 'high' ? 'error' : storePreview.skill.riskLevel === 'mid' ? 'warn' : 'success'} className="ml-1 text-[9px]">{storePreview.skill.riskLevel === 'high' ? '高风险' : storePreview.skill.riskLevel === 'mid' ? '中风险' : '低风险'}</Badge></span>
                  {storePreview.preflight.requiresApproval && <span className="ml-2 text-[var(--warning)]">需要安全审批</span>}
                  {storePreview.preflight.reason && <p className="mt-2 text-[var(--text-secondary)]">{storePreview.preflight.reason}</p>}
                </div>
              </div>
            </div>
            {storePreview.preflight.requiresApproval && storePreview.preflight.decision !== 'blocked' && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                <label className="mb-1.5 block text-[11px] font-medium text-[var(--text-secondary)]">审批单号 *</label>
                <Input value={approvalTicket} onChange={(event) => setApprovalTicket(event.target.value)} placeholder="例如：APR-2026-0819-01" className="de-employee-input h-9 bg-[var(--bg-elevated)] text-xs" />
              </div>
            )}
            <div className="rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] text-[var(--info)]">
              供应链检查包含签名、发布方信任与漏洞扫描；外连与高危命令由技能运行策略在沙箱测试时拦截。
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function StorePagination({ current, total, onChange }: { current: number; total: number; onChange: (page: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="outline" disabled={current === 1} onClick={() => onChange(Math.max(1, current - 1))}>上一页</Button>
      {Array.from({ length: total }, (_, i) => i + 1).slice(Math.max(0, current - 3), current + 2).map((page) => (
        <button key={page} type="button" onClick={() => onChange(page)} className={cn('grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-xs', page === current ? 'bg-[var(--brand)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')}>{page}</button>
      ))}
      <Button size="sm" variant="outline" disabled={current === total} onClick={() => onChange(Math.min(total, current + 1))}>下一页</Button>
    </div>
  );
}
