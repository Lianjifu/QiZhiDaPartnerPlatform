/**
 * 知识中心页面壳：路由分发到 KnowledgeTab.* 模块（按 M07 P1 决策）。
 *
 * 拆分原因：原 pages/Knowledge.tsx 1298L，按 D1 决策拆为 8 个子文件（1 shell +
 * 1 controller + 5 tab + 1 modal + 1 shared）；本文件聚焦壳层：标题 / 工作区
 * tab 路由 / 角色与只读横幅 / 资产区分流 + 全部弹层入口。
 */
import { Suspense } from 'react';
import { Activity, BookOpen, Boxes, FileText, Layers, Network, Plus, Search, ShieldCheck, Upload } from 'lucide-react';
import type { ComponentType } from 'react';
import { Badge, Button, KpiCard } from '@qzda/web-ui';
import { RoleReadonlyBanner } from '@/components/shared';
import { cn } from '@qzda/web-utils';
import { useT } from '@/i18n';
import { useKnowledgeController } from './useKnowledgeController';
import { KnowledgeTabDocs } from './KnowledgeTab.Docs';
import { KnowledgeTabPackages } from './KnowledgeTab.Packages';
import { KnowledgeTabJobs } from './KnowledgeTab.Jobs';
import { KnowledgeTabEval } from './KnowledgeTab.Eval';
import { KnowledgeTabGovernance } from './KnowledgeTab.Governance';
import { KnowledgeModals } from './KnowledgeModals';
import {
  formatHealthLatencySub, formatHealthPercent,
} from '@/features/knowledge/knowledge-ui';

const WORKSPACES: Array<{
  key: ReturnType<typeof useKnowledgeController>['workspace'];
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { key: 'assets', labelKey: 'module.knowledge.tabs.assets', icon: FileText },
  { key: 'processing', labelKey: 'module.knowledge.tabs.processing', icon: Layers },
  { key: 'retrieval', labelKey: 'module.knowledge.tabs.retrieval', icon: Search },
  { key: 'graph', labelKey: 'module.knowledge.tabs.graph', icon: Network },
  { key: 'governance', labelKey: 'module.knowledge.tabs.governance', icon: ShieldCheck },
];

export function KnowledgePage() {
  const { t } = useT();
  const c = useKnowledgeController();
  return <KnowledgePageShell c={c} t={t} />;
}

function KnowledgePageShell({ c, t }: { c: ReturnType<typeof useKnowledgeController>; t: (key: string, fallback?: string) => string }) {
  const visibleWorkspaces = WORKSPACES.filter((item) => c.allowedTabs.includes(item.key));
  const showAssetsHeader = c.workspace === 'assets';
  return (
    <div className="knowledge-page de-employee-page h-full min-w-0 overflow-y-auto overscroll-contain bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5">
      <div className="space-y-3">
        <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
          <div className="flex items-start justify-between gap-4 px-4 py-3.5 md:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg">
                  <BookOpen className="h-4 w-4" />
                </div>
                <h1 className="text-base font-semibold text-[var(--text)]">{c.pageCopy.title}</h1>
              </div>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{c.pageCopy.subtitle}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Badge tone="info">{c.workspaceName}</Badge>
              {!c.canWrite && <Badge tone="neutral">只读</Badge>}
            </div>
          </div>
          <div className="px-4 pt-1 md:px-5"><RoleReadonlyBanner className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]" /></div>
          <div className="de-employee-tabs flex overflow-x-auto px-3" role="tablist" aria-label="知识运营分区">
            {visibleWorkspaces.map(({ key, labelKey, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={c.workspace === key}
                onClick={() => c.setWorkspace(key)}
                className={cn('de-employee-tab flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs transition-colors', c.workspace === key && 'is-active')}
              >
                <Icon className="h-3.5 w-3.5" />{t(labelKey)}
              </button>
            ))}
          </div>
        </section>

        {showAssetsHeader && <AssetsKpiGrid c={c} />}

        <Suspense fallback={null}>
          {c.workspace === 'assets' && c.assetsView === 'docs' && (
            <>
              <AssetsHeader c={c} />
              <KnowledgeTabDocs c={c} />
            </>
          )}
          {c.workspace === 'assets' && c.assetsView === 'packages' && (
            <>
              <AssetsHeader c={c} />
              <KnowledgeTabPackages c={c} />
            </>
          )}
          {c.workspace === 'processing' && <KnowledgeTabJobs c={c} />}
          {c.workspace === 'retrieval' && <KnowledgeTabEval c={c} />}
          {c.workspace === 'graph' && <KnowledgeTabEval c={c} />}
          {c.workspace === 'governance' && <KnowledgeTabGovernance c={c} />}
        </Suspense>
      </div>

      <KnowledgeModals c={c} />
    </div>
  );
}

/** 资产区 KPI 卡（仅在 assets workspace 显示）。 */
function AssetsKpiGrid({ c }: { c: ReturnType<typeof useKnowledgeController> }) {
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard label="受管文档" value={c.docs.length} sub="项" icon={FileText} tone="brand" size="comfortable" />
      <KpiCard label="待处理索引" value={c.pendingIndexCount} sub="项" icon={Layers} tone={c.pendingIndexCount > 0 ? 'warn' : 'neutral'} size="comfortable" />
      <KpiCard label="检索健康度" value={formatHealthPercent(c.normalizedEvalMetrics)} sub={formatHealthLatencySub(c.normalizedEvalMetrics)} icon={Activity} tone={c.normalizedEvalMetrics?.recall != null ? 'success' : 'neutral'} size="comfortable" />
      <KpiCard label="智能体引用" value={c.citationTrace.reduce((total: number, item: any) => total + (item.citeCount ?? item.count ?? 0), 0)} sub="次" icon={ShieldCheck} tone="neutral" size="comfortable" />
    </section>
  );
}

/** 资产区分流：docs / packages 段控件 + 右侧操作按钮（上传内容 / 新建知识包）。 */
function AssetsHeader({ c }: { c: ReturnType<typeof useKnowledgeController> }) {
  return (
    <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-5" style={{ boxShadow: 'var(--saas-divider)' }}>
        <div className="knowledge-assets-segment" role="tablist" aria-label="知识资产视图">
          <button
            type="button"
            role="tab"
            aria-selected={c.assetsView === 'docs'}
            className={cn(c.assetsView === 'docs' && 'is-active')}
            onClick={() => c.setAssetsView('docs')}
          >
            <FileText className="h-3.5 w-3.5" />
            内容文档
            <span className="knowledge-assets-segment__count">{c.docs.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={c.assetsView === 'packages'}
            className={cn(c.assetsView === 'packages' && 'is-active')}
            onClick={() => c.setAssetsView('packages')}
          >
            <Boxes className="h-3.5 w-3.5" />
            知识包
            <span className="knowledge-assets-segment__count">{c.knowledgePackages.length}</span>
          </button>
        </div>
        {c.assetsView === 'docs' ? (
          c.canWrite && (
            <Button size="sm" onClick={() => c.setActiveModal('upload')}>
              <Upload className="h-3.5 w-3.5" />上传内容
            </Button>
          )
        ) : (
          c.canWrite && (
            <Button size="sm" variant="secondary" onClick={() => c.setActiveModal('newPackage')}>
              <Plus className="h-3.5 w-3.5" />新建知识包
            </Button>
          )
        )}
      </div>
    </section>
  );
}

export default KnowledgePage;