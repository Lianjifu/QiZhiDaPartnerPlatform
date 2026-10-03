/**
 * 技能中心 · 页面 shell（M09 P1 拆分）。
 *
 * 负责：
 *   - 顶部 hero（图标 / 标题 / 副标题 / 工作区徽标 / 只读徽标 / CTA 按钮）
 *   - operation notice（统一通知条）+ 类型筛选状态（typeFilters）
 *   - Tab 路由：workspace → SkillsTab.Catalog · store → SkillsTab.CatalogStore ·
 *     platformTools → SkillsTab.PlatformTools · workflowSkills → WorkflowSkillList ·
 *     integration → SkillsTab.Integration · governance → SkillsTab.Governance
 *
 * 不持有业务态；每个子页自管。状态提升到本页：tab、operationNotice、typeFilters。
 *
 * 默认导出（App.tsx lazy import 兼容）。
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button } from '@qzda/web-ui';
import {
  Cpu, GitBranch, Network, RefreshCw, ShieldCheck, Sparkles, Upload, Wrench,
} from 'lucide-react';
import { cn } from '@qzda/web-utils';
import type { Skill, WorkflowSkill } from '@qzda/web-types';
import { useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useT } from '@/i18n';
import { RoleReadonlyBanner } from '@/components/shared';
import {
  defaultSkillsTab, roleCanMutate, rolePageCopy, visibleSkillsTabs,
} from '@/features/role-nav/role-nav';
import { SkillsTabCatalog } from './SkillsTab.Catalog';
import { CatalogStoreView } from './SkillsTab.CatalogStore';
import { PlatformToolsWorkspace } from './SkillsTab.PlatformTools';
import { WorkflowSkillList, PackInstallPanel } from './SkillsTab.Packages';
import { IntegrationWorkspace } from './SkillsTab.Integration';
import { GovernanceWorkspace } from './SkillsTab.Governance';
import type { SkillCenterTab, SkillRow } from './SkillsShared';

const VALID_TABS: SkillCenterTab[] = ['workspace', 'store', 'platformTools', 'workflowSkills', 'integration', 'governance'];
const EMPTY_WORKFLOW_SKILLS: WorkflowSkill[] = [];

function resolveTab(raw: string | null, roleDefault: SkillCenterTab): SkillCenterTab {
  if (raw === 'atomic') return 'workspace';
  if (raw && VALID_TABS.includes(raw as SkillCenterTab)) return raw as SkillCenterTab;
  return roleDefault;
}

export default function SkillsPage() {
  const { t } = useT();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const pageCopy = rolePageCopy('skills', user?.role);
  const allowedTabs = visibleSkillsTabs(user?.role);
  const canWrite = Boolean(user?.permissions.includes('skill.write')) && roleCanMutate(user?.role);
  const currentWorkspace = useWorkspaceStore((state) => state.current);
  const workspaceName = currentWorkspace?.name ?? 'ACME 生产';
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTabRaw = searchParams.get('tab');
  const [tab, setTab] = useState<SkillCenterTab>(() => {
    const preferred = defaultSkillsTab(user?.role);
    const resolved = resolveTab(initialTabRaw, preferred);
    return allowedTabs.includes(resolved) ? resolved : preferred;
  });
  const [typeFilters, setTypeFilters] = useState<Record<'workspace' | 'store' | 'integration' | 'governance', 'all' | Skill['kind']>>({
    workspace: initialTabRaw === 'atomic' ? 'skill' : 'all', store: 'all', integration: 'all', governance: 'all',
  });
  const [operationNotice, setOperationNotice] = useState<string | null>(null);

  const { data: governanceHealthData } = useApiQuery<any[]>(
    ['skills', 'governance', 'health'],
    '/api/skills/governance/health',
    undefined,
    { enabled: tab === 'workspace' || tab === 'governance' },
  );
  const attentionCount = (governanceHealthData ?? []).filter((h: any) => h.status === 'attention' || h.status === 'incident').length;

  const { data: workflowSkillsData } = useApiQuery<WorkflowSkill[]>(['workflow-skills'], '/api/workflow-skills');
  const workflowSkills = workflowSkillsData ?? EMPTY_WORKFLOW_SKILLS;

  useEffect(() => {
    const nextRaw = searchParams.get('tab');
    const preferred = defaultSkillsTab(user?.role);
    const allowed = visibleSkillsTabs(user?.role);
    if (nextRaw === 'atomic') {
      setTypeFilters((filters) => ({ ...filters, workspace: 'skill' }));
      const params = new URLSearchParams(searchParams);
      params.delete('tab');
      setSearchParams(params, { replace: true });
      setTab('workspace');
      return;
    }
    const next = resolveTab(nextRaw, preferred);
    const resolved = allowed.includes(next) ? next : preferred;
    setTab((current) => (current === resolved ? current : resolved));
  }, [searchParams, setSearchParams, user?.role]);

  const selectTab = (next: SkillCenterTab) => {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'workspace') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const skillTabs = [
    { key: 'workspace' as const, labelKey: 'module.skills.tabs.workspace' as const, label: '技能资产', icon: Wrench, count: null },
    { key: 'store' as const, labelKey: 'module.skills.tabs.store' as const, label: '技能商店', icon: Sparkles, count: null },
    { key: 'platformTools' as const, labelKey: 'module.skills.tabs.platformTools' as const, label: '平台工具', icon: Cpu, count: 26 },
    { key: 'workflowSkills' as const, labelKey: 'module.skills.tabs.workflowSkills', icon: GitBranch, count: workflowSkills.length },
    { key: 'integration' as const, labelKey: 'module.skills.tabs.integration', icon: Network, count: null },
    { key: 'governance' as const, labelKey: 'module.skills.tabs.governance', icon: ShieldCheck, count: attentionCount },
  ].filter((item) => allowedTabs.includes(item.key));

  const tabSummary: Record<SkillCenterTab, string> = {
    workspace: t('module.skills.summary.workspace'),
    store: t('module.skills.summary.store'),
    integration: t('module.skills.summary.integration'),
    governance: t('module.skills.summary.governance'),
    workflowSkills: t('module.skills.summary.workflowSkills'),
    platformTools: '平台工具与运行时工具（通用岗位包）',
  };

  return (
    <div className="de-employee-page h-full min-w-0 overflow-y-auto overscroll-contain bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5">
      <div className="space-y-3">
        <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
          <div className="flex items-start justify-between gap-4 px-4 py-3.5 md:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg">
                  <Wrench className="h-4 w-4" />
                </div>
                <h1 className="text-base font-semibold text-[var(--text)]">{pageCopy.title}</h1>
              </div>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{pageCopy.subtitle}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Badge tone="info">{workspaceName}</Badge>
              {!canWrite && <Badge tone="neutral">只读</Badge>}
              {canWrite && (
                <>
                  <button type="button" className="de-employee-btn de-employee-btn--primary" onClick={() => selectTab('integration')}>
                    <Upload className="h-3.5 w-3.5" />{t('module.skills.cta.connect')}
                  </button>
                  <button type="button" className="de-employee-btn" onClick={() => selectTab('store')}>
                    <Sparkles className="h-3.5 w-3.5" />{t('module.skills.cta.store')}
                  </button>
                </>
              )}
            </div>
          </div>
          {operationNotice && (
            <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--text-secondary)] md:mx-5">
              <span>{operationNotice}</span>
              <button type="button" onClick={() => setOperationNotice(null)} className="text-[var(--brand)]">知道了</button>
            </div>
          )}
          {tab !== 'workflowSkills' && tab !== 'integration' && tab !== 'governance' && (
            <p className="px-4 pb-2 text-xs text-[var(--text-muted)] md:px-5">{tabSummary[tab]}</p>
          )}
          {tab === 'platformTools' && (
            <p className="px-4 pb-2 text-xs text-[var(--text-muted)] md:px-5">{tabSummary[tab]}</p>
          )}
          <div className="px-4 md:px-5"><RoleReadonlyBanner className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]" /></div>
          <div className="de-employee-tabs flex overflow-x-auto px-3" role="tablist" aria-label="技能中心分区">
            {skillTabs.map((item) => {
              const TabIcon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key}
                  onClick={() => selectTab(item.key)}
                  className={cn('de-employee-tab flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs transition-colors', tab === item.key && 'is-active')}
                >
                  <TabIcon className="h-3.5 w-3.5" />
                  {('label' in item && item.label) ? item.label : t(item.labelKey)}
                  {item.count != null && <Badge tone={(item.key as SkillCenterTab) === 'workspace' ? 'brand' : (item.key as SkillCenterTab) === 'workflowSkills' ? 'purple' : 'neutral'} className="ml-1">{item.count}</Badge>}
                </button>
              );
            })}
          </div>
        </section>

        <div className="pb-4">
          {tab === 'workspace' && (
            <SkillsTabCatalog
              canWrite={canWrite}
              onNotice={setOperationNotice}
              initialTypeFilter={typeFilters.workspace}
              onTypeFilterChange={(next) => setTypeFilters((filters) => ({ ...filters, workspace: next }))}
            />
          )}
          {tab === 'store' && (
            <section className="de-employee-shell rounded-xl bg-[var(--surface-1)] p-4 md:p-5">
              <StoreTabWithBridge
                canWrite={canWrite}
                isAdmin={isAdmin}
                onNotice={setOperationNotice}
                initialTypeFilter={typeFilters.store}
                onTypeFilterChange={(next) => setTypeFilters((filters) => ({ ...filters, store: next }))}
              />
            </section>
          )}
          {tab === 'platformTools' && (
            <section className="de-employee-shell rounded-xl bg-[var(--surface-1)] p-4 md:p-5">
              <PlatformToolsWorkspace />
            </section>
          )}
          {tab === 'workflowSkills' && (
            <section className="de-employee-shell rounded-xl bg-[var(--surface-1)] p-4 md:p-5">
              <WorkflowSkillList canWrite={canWrite} onNotice={(msg) => setOperationNotice(msg)} />
              <div className="mt-4 border-t border-[var(--border)] pt-4">
                <PackInstallPanel onInstalled={(msg) => setOperationNotice(msg)} />
              </div>
            </section>
          )}
          {tab === 'integration' && (
            <section className="de-employee-shell rounded-xl bg-[var(--surface-1)] p-4 md:p-5">
              <IntegrationWorkspace canWrite={canWrite} onImport={() => setOperationNotice('请通过工作区配置中的「能力接入」完成导入。')} onMcp={() => setOperationNotice('请通过工作区配置中的「MCP 接入」配置。')} onTool={() => setOperationNotice('请通过工作区配置中的「Tool 接入」配置。')} />
            </section>
          )}
          {tab === 'governance' && (
            <section className="de-employee-shell rounded-xl bg-[var(--surface-1)] p-4 md:p-5">
              <GovernanceWorkspace canWrite={canWrite} onOpenSkill={(id) => setOperationNotice(`请切换到「技能资产」查看技能 ${id} 详情。`)} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** 商店视图：bridges external catalog store view with shell-level installedRows state. */
function StoreTabWithBridge({
  canWrite, isAdmin, onNotice, initialTypeFilter, onTypeFilterChange,
}: {
  canWrite: boolean;
  isAdmin: boolean;
  onNotice: (msg: string) => void;
  initialTypeFilter: 'all' | Skill['kind'];
  onTypeFilterChange: (next: 'all' | Skill['kind']) => void;
}) {
  const [installedRows, setInstalledRows] = useState<SkillRow[]>([]);
  const [storePage, setStorePage] = useState(1);
  return (
    <CatalogStoreView
      installedRows={installedRows}
      setInstalledRows={setInstalledRows}
      canWrite={canWrite}
      isAdmin={isAdmin}
      onNotice={onNotice}
      initialStorePage={storePage}
      initialStoreSearchQ=""
      initialStoreRiskFilter="all"
      initialStoreChannelFilter="all"
      initialStoreReleaseFilter="all"
      initialCertifiedOnly={false}
      initialTypeFilter={initialTypeFilter}
      onTypeFilterChange={onTypeFilterChange}
      onStorePageChange={setStorePage}
    />
  );
}
