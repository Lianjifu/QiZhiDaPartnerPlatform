/**
 * 技能中心 · 目录（catalog）子页 · 工作区视图（M09 P1 拆分）。
 *
 * 由原 pages/Skills.tsx 「工作区启用清单」视图（L625-L963）+ 升级 / 批量升级 confirm 抽出。
 * 商店视图已抽到 ./SkillsTab.CatalogStore.tsx；技能详情 modal 在 ./SkillsDetailModal.tsx。
 */
import { useEffect, useMemo, useState } from 'react';
import { useApiMutation, useApiQuery } from '@/services/query';
import { Button, Input, KpiCard } from '@qzda/web-ui';
import {
  AlertTriangle, ArrowUpCircle, CheckCircle2, Eye, LayoutGrid, List,
  Play, Power, Search, Terminal, Wrench,
} from 'lucide-react';
import { cn } from '@qzda/web-utils';
import type { Skill, SkillLifecycleStatus, SkillRuntimeHealth } from '@qzda/web-types';
import { ConfirmDialog, EmptyState } from '@/components/shared';
import { KIND_META, KIND_PROFILE, buildHealthBySkillId, buildReferenceBySkillId, enrichSkillRow, type SkillRow } from './SkillsShared';
import { SkillsDetailModal } from './SkillsDetailModal';

const EMPTY_SKILLS: Skill[] = [];
const EMPTY_HEALTH: SkillRuntimeHealth[] = [];
const PAGE_SIZE = 10;

function dedupeSkillsById<T extends { id: string }>(skills: T[]): T[] {
  const seen = new Map<string, T>();
  for (const skill of skills) seen.set(skill.id, skill);
  return Array.from(seen.values());
}

export function SkillsTabCatalog({
  canWrite,
  onNotice,
  initialTypeFilter,
  onTypeFilterChange,
}: {
  canWrite: boolean;
  onNotice: (msg: string) => void;
  initialTypeFilter: 'all' | Skill['kind'];
  onTypeFilterChange: (next: 'all' | Skill['kind']) => void;
}) {
  const [installedRows, setInstalledRows] = useState<SkillRow[]>([]);
  const [searchQ, setSearchQ] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState<'all' | SkillLifecycleStatus>('all');
  const [workspaceFocus, setWorkspaceFocus] = useState<'all' | 'enabled' | 'pending' | 'upgradeable' | 'attention'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');
  const [currentPage, setCurrentPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [activeId, setActiveId] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'access' | 'versions' | 'runtime'>('overview');
  const [batchConfirm, setBatchConfirm] = useState<null | 'upgrade'>(null);
  const [upgradePlan, setUpgradePlan] = useState<any | null>(null);

  const { data: apiInstalledData } = useApiQuery<Skill[]>(['skills'], '/api/skills');
  const { data: governanceHealthData } = useApiQuery<SkillRuntimeHealth[]>(
    ['skills', 'governance', 'health'],
    '/api/skills/governance/health',
  );
  const apiInstalled = apiInstalledData ?? EMPTY_SKILLS;
  const governanceHealth = governanceHealthData ?? EMPTY_HEALTH;
  const healthBySkillId = useMemo(() => buildHealthBySkillId(governanceHealth), [governanceHealth]);
  const referenceBySkillId = useMemo(() => buildReferenceBySkillId(governanceHealth), [governanceHealth]);
  const attentionSkillIds = useMemo(
    () => new Set(governanceHealth.filter((h) => h.status === 'attention' || h.status === 'incident').map((h) => h.skillId)),
    [governanceHealth],
  );

  useEffect(() => {
    if (apiInstalledData == null) return;
    setInstalledRows(dedupeSkillsById(apiInstalledData.map((skill) => enrichSkillRow(skill, healthBySkillId))));
  }, [apiInstalledData, healthBySkillId]);

  const lifecycleMutation = useApiMutation<Skill, { id: string; lifecycleStatus: SkillLifecycleStatus }>(
    ({ id }) => `/api/skills/${id}/lifecycle`,
    {
      onSuccess: (skill) => {
        setInstalledRows((prev) => prev.map((item) => item.id === skill.id ? enrichSkillRow({ ...item, ...skill }, healthBySkillId) : item));
        onNotice(`已将「${skill.name}」更新为 ${skill.lifecycleStatus === 'enabled' ? '启用' : skill.lifecycleStatus === 'disabled' ? '暂停' : skill.lifecycleStatus}`);
      },
      onError: (error) => onNotice(error instanceof Error ? error.message : '更新技能状态失败'),
    },
    'PATCH',
  );
  const uninstallSkillMutation = useApiMutation<any, { id: string }>(({ id }) => `/api/skills/${id}/uninstall`);
  const upgradeSkillMutation = useApiMutation<Skill, { id: string }>(({ id }) => `/api/skills/${id}/upgrade`, {
    onSuccess: (skill) => {
      setInstalledRows((prev) => prev.map((item) => item.id === skill.id ? enrichSkillRow({ ...item, ...skill }, healthBySkillId) : item));
      onNotice(`已完成 ${skill.name} 的版本升级，可在审计中查看预检与引用影响。`);
    },
    onError: (error) => onNotice(error instanceof Error ? error.message : '升级失败'),
  });
  const upgradePlanMutation = useApiMutation<any, { id: string; targetVersion?: string }>(({ id }) => `/api/skills/${id}/upgrade-plan`, {
    onError: (error) => onNotice(error instanceof Error ? error.message : '无法生成升级预检'),
  });

  const filtered = useMemo(() => installedRows
    .filter((s) => initialTypeFilter === 'all' || s.kind === initialTypeFilter)
    .filter((s) => lifecycleFilter === 'all' || s.lifecycleStatus === lifecycleFilter)
    .filter((s) => {
      if (workspaceFocus === 'all') return true;
      if (workspaceFocus === 'enabled') return (s.lifecycleStatus ?? 'enabled') === 'enabled';
      if (workspaceFocus === 'pending') return s.lifecycleStatus === 'pending_approval';
      if (workspaceFocus === 'upgradeable') return Boolean(s.hasUpdate);
      return attentionSkillIds.has(s.id);
    })
    .filter((s) => !searchQ || s.name.toLowerCase().includes(searchQ.toLowerCase()) || (s.description ?? '').toLowerCase().includes(searchQ.toLowerCase())),
    [installedRows, initialTypeFilter, lifecycleFilter, workspaceFocus, searchQ, attentionSkillIds]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedSkills = useMemo(() => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [filtered, currentPage]);
  useEffect(() => { setCurrentPage(1); }, [initialTypeFilter, lifecycleFilter, workspaceFocus, searchQ]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);

  const enabledCount = useMemo(() => installedRows.filter((s) => (s.lifecycleStatus ?? 'enabled') === 'enabled').length, [installedRows]);
  const pendingApprovalCount = useMemo(() => installedRows.filter((s) => s.lifecycleStatus === 'pending_approval').length, [installedRows]);
  const upgradeableCount = useMemo(() => installedRows.filter((s) => s.hasUpdate).length, [installedRows]);
  const attentionCount = useMemo(() => governanceHealth.filter((h) => h.status === 'attention' || h.status === 'incident').length, [governanceHealth]);

  const openSkillDetails = (id: string) => { setActiveId(id); setShowDetails(true); setDetailTab('overview'); };

  const handleUninstall = (active: SkillRow) => {
    if (!canWrite) return;
    uninstallSkillMutation.mutate({ id: active.id }, {
      onSuccess: () => {
        setInstalledRows((prev) => prev.filter((s) => s.id !== active.id));
        setActiveId(null);
        setShowDetails(false);
        onNotice(`已卸载「${active.name}」`);
      },
      onError: (error) => onNotice(error instanceof Error ? error.message : '卸载失败，请查看影响分析'),
    });
  };

  const handleBatchUpgrade = () => {
    if (!canWrite) return;
    selected.forEach((id) => upgradeSkillMutation.mutate({ id }));
    setSelected(new Set());
    setBatchConfirm(null);
  };

  const openUpgradePlan = (skill: SkillRow) => {
    if (!canWrite) return;
    setActiveId(skill.id);
    upgradePlanMutation.mutate({ id: skill.id, targetVersion: skill.upgradeVersion }, {
      onSuccess: (plan) => { setUpgradePlan(plan); setShowDetails(false); setBatchConfirm(null); },
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  return (
    <div className="space-y-3">
      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {([
          { key: 'enabled' as const, label: '已启用', value: enabledCount, icon: CheckCircle2, tone: 'success' as const },
          { key: 'pending' as const, label: '待审批', value: pendingApprovalCount, icon: Power, tone: 'warn' as const },
          { key: 'upgradeable' as const, label: '可升级', value: upgradeableCount, icon: ArrowUpCircle, tone: 'brand' as const },
          { key: 'attention' as const, label: '需关注', value: attentionCount, icon: AlertTriangle, tone: attentionCount ? 'warn' as const : 'neutral' as const },
        ]).map((item) => (
          <button key={item.key} type="button" className={cn('skills-kpi-chip text-left', workspaceFocus === item.key && 'is-active')} onClick={() => { setWorkspaceFocus((prev) => (prev === item.key ? 'all' : item.key)); setLifecycleFilter('all'); }}>
            <KpiCard label={item.label} value={item.value} sub="项" icon={item.icon} tone={item.tone} size="compact" className="border-0 bg-transparent p-0 shadow-none" />
          </button>
        ))}
      </section>

      <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 md:px-5" style={{ boxShadow: 'var(--saas-divider)' }}>
          <div className="knowledge-assets-segment" role="tablist" aria-label="能力类型筛选">
            {(['all', 'skill', 'mcp', 'tool'] as const).map((kind) => (
              <button key={kind} type="button" role="tab" aria-selected={initialTypeFilter === kind} className={cn(initialTypeFilter === kind && 'is-active')} onClick={() => onTypeFilterChange(kind)}>
                {kind === 'all' ? '全部' : kind === 'skill' ? 'Skill' : kind === 'mcp' ? 'MCP' : 'Tool'}
                <span className="knowledge-assets-segment__count">
                  {kind === 'all' ? installedRows.length : installedRows.filter((s) => s.kind === kind).length}
                </span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-muted)]" />
              <Input value={searchQ} onChange={(event) => setSearchQ(event.target.value)} placeholder="搜索技能..." className="de-employee-input h-8 w-44 bg-[var(--bg)] pl-7 text-xs md:w-52" />
            </div>
            <select value={lifecycleFilter} onChange={(event) => { setLifecycleFilter(event.target.value as typeof lifecycleFilter); setWorkspaceFocus('all'); }} className="de-employee-input h-8 rounded-lg bg-[var(--bg)] px-2 text-[11px] text-[var(--text-secondary)]">
              <option value="all">全部状态</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已暂停</option>
              <option value="pending_approval">待审批</option>
              <option value="quarantined">已隔离</option>
              <option value="deprecated">已废弃</option>
            </select>
            <div className="flex overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg)]">
              <button type="button" aria-label="列表视图" onClick={() => setViewMode('list')} className={cn('grid h-8 w-8 place-items-center', viewMode === 'list' ? 'bg-[var(--brand-light)] text-[var(--brand)]' : 'text-[var(--text-muted)]')}><List className="h-3.5 w-3.5" /></button>
              <button type="button" aria-label="卡片视图" onClick={() => setViewMode('cards')} className={cn('grid h-8 w-8 place-items-center', viewMode === 'cards' ? 'bg-[var(--brand-light)] text-[var(--brand)]' : 'text-[var(--text-muted)]')}><LayoutGrid className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>

        {viewMode === 'list' ? (
          <CatalogListView
            rows={pagedSkills}
            referenceBySkillId={referenceBySkillId}
            selected={selected}
            toggleSelect={toggleSelect}
            onOpen={openSkillDetails}
            canWrite={canWrite}
            onLifecycleToggle={(skill, lifecycle) => lifecycleMutation.mutate({ id: skill.id, lifecycleStatus: lifecycle === 'enabled' ? 'disabled' : 'enabled' })}
            onUpgradeClick={openUpgradePlan}
            emptyState={<div className="p-8"><EmptyState icon={Wrench} title="没有匹配的技能资产" description="调整筛选条件或清除搜索后重试" /></div>}
          />
        ) : filtered.length === 0 ? (
          <div className="p-8"><EmptyState icon={Wrench} title="没有匹配的技能" description="尝试清除搜索或切换分类" /></div>
        ) : (
          <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 md:p-4 xl:grid-cols-3 2xl:grid-cols-4">
            {pagedSkills.map((s) => (
              <CatalogCardView key={s.id} row={s} onOpen={openSkillDetails} selected={selected} toggleSelect={toggleSelect} />
            ))}
          </div>
        )}
      </section>

      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs md:px-5" style={{ boxShadow: 'var(--saas-divider)' }}>
          <span className="text-[var(--text-muted)]">共 {filtered.length} 项，每页 {PAGE_SIZE} 项{workspaceFocus !== 'all' ? ' · 已按摘要筛选' : ''}</span>
          <Pagination current={currentPage} total={totalPages} onChange={setCurrentPage} />
        </div>
      )}

      <ConfirmDialog
        open={!!upgradePlan}
        onClose={() => { setUpgradePlan(null); setActiveId(null); }}
        onConfirm={() => {
          if (!activeId) return;
          upgradeSkillMutation.mutate({ id: activeId });
          setUpgradePlan(null);
        }}
        title={`升级 ${installedRows.find((s) => s.id === activeId)?.name ?? ''}？`}
        description={`将从 v${upgradePlan?.currentVersion ?? ''} 升级至 v${upgradePlan?.targetVersion ?? ''}。预检：${(upgradePlan?.checks ?? []).map((check: any) => `${check.label}${check.status === 'passed' ? '通过' : '需复核'}`).join('、') || '待生成'}；可回滚至 v${upgradePlan?.rollbackVersion ?? ''}。`}
        confirmText="确认升级"
      />

      <ConfirmDialog
        open={batchConfirm === 'upgrade'}
        onClose={() => setBatchConfirm(null)}
        onConfirm={handleBatchUpgrade}
        title={`批量升级 ${selected.size} 项`}
        description="将对选中技能执行 minor 版本升级。生产环境请在维护窗口操作。"
        confirmText="开始升级"
      />

      <SkillsDetailModal
        activeId={activeId}
        showDetails={showDetails}
        onClose={() => { setShowDetails(false); setActiveId(null); }}
        installedRows={installedRows}
        detailTab={detailTab}
        setDetailTab={setDetailTab}
        canWrite={canWrite}
        onUninstall={handleUninstall}
        onInstallOpen={() => onNotice('请切换到「技能商店」完成安装。')}
        onNotice={onNotice}
      />
    </div>
  );
}

function Pagination({ current, total, onChange }: { current: number; total: number; onChange: (page: number) => void }) {
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

function CatalogListView({ rows, referenceBySkillId, selected, toggleSelect, onOpen, canWrite, onLifecycleToggle, onUpgradeClick, emptyState }: {
  rows: SkillRow[];
  referenceBySkillId: Map<string, number>;
  selected: Set<string>;
  toggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
  canWrite: boolean;
  onLifecycleToggle: (skill: SkillRow, lifecycle: SkillLifecycleStatus) => void;
  onUpgradeClick: (skill: SkillRow) => void;
  emptyState: React.ReactNode;
}) {
  if (rows.length === 0) return <>{emptyState}</>;
  return (
    <div className="skills-inventory-table">
      <div className="skills-inventory-table__head">
        <span /><span>技能资产</span><span>状态</span><span>来源 / 责任</span><span>版本</span><span>引用</span><span>最近验证</span><span className="text-right">操作</span>
      </div>
      {rows.map((skill) => {
        const meta = KIND_META[skill.kind];
        const refCount = referenceBySkillId.get(skill.id) ?? 0;
        const referenced = refCount > 0;
        const lifecycle = skill.lifecycleStatus ?? 'enabled';
        const lifecycleLabel = lifecycle === 'enabled' ? '已启用' : lifecycle === 'disabled' ? '已暂停' : lifecycle === 'pending_approval' ? '待审批' : lifecycle === 'quarantined' ? '已隔离' : '已废弃';
        const statusClass = lifecycle === 'enabled' ? 'is-ready' : lifecycle === 'quarantined' || lifecycle === 'pending_approval' ? 'is-failed' : 'is-indexing';
        const riskLabel = skill.riskLevel === 'high' ? '高风险' : skill.riskLevel === 'mid' ? '中风险' : '低风险';
        return (
          <div key={skill.id} className="skills-inventory-table__row" onClick={() => onOpen(skill.id)} role="button" tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && onOpen(skill.id)}>
            <span className="flex items-center">
              <input aria-label={`选择 ${skill.name}`} type="checkbox" checked={selected.has(skill.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleSelect(skill.id)} className="accent-[var(--brand)]" />
            </span>
            <span className="min-w-0">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[var(--brand-light)] text-[var(--brand)]"><meta.icon className="h-3.5 w-3.5" /></span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <strong className="truncate text-[12px] text-[var(--text)]">{skill.name}</strong>
                    <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{meta.label}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">{skill.description}</span>
                </span>
              </span>
            </span>
            <span>
              <span className={cn('knowledge-status-dot', statusClass)}>{lifecycleLabel}</span>
              <span className={cn('mt-1 block text-[10px]', skill.riskLevel === 'high' ? 'text-[var(--danger)]' : skill.riskLevel === 'mid' ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]')}>{riskLabel}</span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[11px] text-[var(--text)]">{skill.source === 'market' ? '技能商店' : skill.source === 'mcp' ? 'MCP 接入' : skill.source === 'tool' ? 'Tool 接入' : '导入'}</span>
              <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">{skill.owner ?? '未分配'}</span>
            </span>
            <span className="font-mono text-[11px]">v{skill.version}{skill.hasUpdate && <span className="ml-1 text-[10px] font-sans text-[var(--warning)]">可升级</span>}</span>
            <span>
              <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(skill.id); }} className={cn('skills-ref-link', referenced && 'is-active')}>{referenced ? `${refCount} 处` : '未引用'}</button>
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">{skill.lastVerifiedAt ?? '尚未验证'}</span>
            <span className="justify-self-end">
              {canWrite ? (
                <span className="flex items-center gap-1">
                  <button type="button" className="knowledge-row-action" onClick={(event) => { event.stopPropagation(); onLifecycleToggle(skill, lifecycle as SkillLifecycleStatus); }}>
                    {lifecycle === 'enabled' ? <><Power className="h-3.5 w-3.5" />暂停</> : <><Play className="h-3.5 w-3.5" />启用</>}
                  </button>
                  {skill.hasUpdate && (
                    <button type="button" className="knowledge-row-action" onClick={(event) => { event.stopPropagation(); onUpgradeClick(skill); }}>
                      <ArrowUpCircle className="h-3.5 w-3.5" />升级
                    </button>
                  )}
                </span>
              ) : <span className="text-[10px] text-[var(--text-muted)]">只读</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CatalogCardView({ row, onOpen, selected, toggleSelect }: { row: SkillRow; onOpen: (id: string) => void; selected: Set<string>; toggleSelect: (id: string) => void }) {
  const meta = KIND_META[row.kind];
  const profile = KIND_PROFILE[row.kind];
  const Icon = meta.icon;
  return (
    <div onClick={() => onOpen(row.id)} className={cn('skill-catalog-card tile-brandable relative flex min-h-[220px] flex-col gap-3 rounded-xl border border-l-[3px] border-[var(--border)] bg-[var(--bg)] p-4 text-left cursor-pointer', profile.rail)}>
      <input type="checkbox" checked={selected.has(row.id)} onChange={(event) => { event.stopPropagation(); toggleSelect(row.id); }} onClick={(event) => event.stopPropagation()} className="accent-[var(--brand)] absolute top-3 right-3" />
      <div className="flex items-start gap-2 pr-5">
        <div className={cn('grid h-9 w-9 place-items-center rounded-lg shrink-0', profile.iconSurface)}><Icon className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold">{row.name}</span><span className="font-mono text-[10px] text-[var(--text-muted)]">{meta.label}</span></div>
          <div className="mt-1 truncate text-[11px] text-[var(--text-muted)]">v{row.version} · {profile.caption}</div>
        </div>
      </div>
      <p className="line-clamp-2 text-[12px] leading-5 text-[var(--text-secondary)]">{row.description}</p>
      <div className="mt-auto flex items-center justify-between gap-2 text-[10px] text-[var(--text-muted)]">
        <span>{row.riskLevel === 'high' ? '高风险' : row.riskLevel === 'mid' ? '中风险' : '低风险'} · {row.calls}</span>
        <span className="inline-flex gap-1">
          <Button size="sm" variant="secondary" onClick={(event) => { event.stopPropagation(); onOpen(row.id); }}><Terminal className="h-3 w-3" />测试</Button>
          <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onOpen(row.id); }}><Eye className="h-3 w-3" />详情</Button>
        </span>
      </div>
    </div>
  );
}
