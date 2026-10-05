/**
 * 技能中心目录：技能资产 + 运行治理。接入与详情走独立页面。
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge } from '@qzda/web-ui';
import { ShieldCheck, Upload, Wrench } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import { useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useT } from '@/i18n';
import { RoleReadonlyBanner } from '@/components/shared';
import {
  defaultSkillsTab, roleCanMutate, rolePageCopy, visibleSkillsTabs,
} from '@/features/role-nav/role-nav';
import { SkillsTabCatalog } from './SkillsTab.Catalog';
import { GovernanceWorkspace } from './SkillsTab.Governance';
import type { CatalogTypeFilter, SkillCenterTab } from './SkillsShared';

const CATALOG_TABS: SkillCenterTab[] = ['workspace', 'governance'];
const LEGACY_TAB_REDIRECT: Record<string, string> = {
  store: '/skills/new?source=store',
  platformTools: '/skills?filter=builtin',
  integration: '/skills/new',
  workflowSkills: '/workflows',
};

function parseCatalogFilter(raw: string | null): CatalogTypeFilter {
  if (raw === 'builtin' || raw === 'skill' || raw === 'mcp' || raw === 'tool') return raw;
  return 'all';
}

function resolveTab(raw: string | null, roleDefault: SkillCenterTab): SkillCenterTab {
  if (raw === 'atomic') return 'workspace';
  if (raw && CATALOG_TABS.includes(raw as SkillCenterTab)) return raw as SkillCenterTab;
  return roleDefault;
}

export default function SkillsPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
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
  const [typeFilters, setTypeFilters] = useState<Record<'workspace' | 'governance', CatalogTypeFilter>>({
    workspace: searchParams.get('filter') === 'builtin' || initialTabRaw === 'platformTools' ? 'builtin' : initialTabRaw === 'atomic' ? 'skill' : parseCatalogFilter(searchParams.get('filter')),
    governance: 'all',
  });
  const [operationNotice, setOperationNotice] = useState<string | null>(null);

  const { data: governanceHealthData } = useApiQuery<any[]>(
    ['skills', 'governance', 'health'],
    '/api/skills/governance/health',
    undefined,
    { enabled: tab === 'workspace' || tab === 'governance' },
  );
  const attentionCount = (governanceHealthData ?? []).filter((h: any) => h.status === 'attention' || h.status === 'incident').length;

  useEffect(() => {
    const nextRaw = searchParams.get('tab');
    if (nextRaw && LEGACY_TAB_REDIRECT[nextRaw]) {
      navigate(LEGACY_TAB_REDIRECT[nextRaw], { replace: true });
      return;
    }
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
    const filter = parseCatalogFilter(searchParams.get('filter'));
    setTypeFilters((current) => (current.workspace === filter ? current : { ...current, workspace: filter }));
  }, [searchParams, setSearchParams, user?.role, navigate]);

  const selectTab = (next: SkillCenterTab) => {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'workspace') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const skillTabs = [
    { key: 'workspace' as const, label: '技能资产', icon: Wrench, count: null as number | null },
    { key: 'governance' as const, label: '运行治理', icon: ShieldCheck, count: attentionCount },
  ].filter((item) => allowedTabs.includes(item.key));

  return (
    <div className="de-employee-page h-full min-w-0 overflow-y-auto overscroll-contain bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5" data-testid="page-skills">
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
                <button type="button" className="de-employee-btn de-employee-btn--primary" onClick={() => navigate('/skills/new')}>
                  <Upload className="h-3.5 w-3.5" />{t('module.skills.cta.connect')}
                </button>
              )}
            </div>
          </div>
          {operationNotice && (
            <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-bg)] px-3 py-2 text-xs text-[var(--text-secondary)] md:mx-5">
              <span>{operationNotice}</span>
              <button type="button" onClick={() => setOperationNotice(null)} className="text-[var(--brand)]">知道了</button>
            </div>
          )}
          <p className="px-4 pb-2 text-xs text-[var(--text-muted)] md:px-5">
            {tab === 'governance' ? t('module.skills.summary.governance') : t('module.skills.summary.workspace')}
          </p>
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
                  {item.label}
                  {item.count != null && <Badge tone="neutral" className="ml-1">{item.count}</Badge>}
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
              onTypeFilterChange={(next) => {
                setTypeFilters((filters) => ({ ...filters, workspace: next }));
                const params = new URLSearchParams(searchParams);
                if (next === 'all') params.delete('filter');
                else params.set('filter', next);
                setSearchParams(params, { replace: true });
              }}
            />
          )}
          {tab === 'governance' && (
            <section className="de-employee-shell rounded-xl bg-[var(--surface-1)] p-4 md:p-5">
              <GovernanceWorkspace canWrite={canWrite} onOpenSkill={(id) => navigate(`/skills/${id}?step=runtime`)} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
