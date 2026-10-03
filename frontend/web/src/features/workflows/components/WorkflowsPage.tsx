/**
 * 工作流页面壳：路由分发到 WorkflowsTab.* 模块（按 M06 P1 决策）。
 */
import { Suspense } from 'react';
import { Tabs } from '@qzda/web-ui';
import { useT } from '@/i18n';
import { visibleWorkflowTabs } from '@/features/role-nav/role-nav';
import type { TabKey } from './WorkflowsShared';
import type { WorkflowsController } from './useWorkflowsController';
import { useWorkflowsController } from './useWorkflowsController';
import { WorkflowsTabEditor } from './WorkflowsTab.Editor';
import { WorkflowsTabList } from './WorkflowsTab.List';
import { WorkflowsTabRuns } from './WorkflowsTab.Runs';
import { WorkflowsTabSkills } from './WorkflowsTab.Skills';
import { WorkflowsTabSettings } from './WorkflowsTab.Settings';
import { WorkflowsTabGeneration } from './WorkflowsTab.Generation';
import { WorkflowsModals } from './WorkflowsModals';

type TT = (key: string, fallback?: string) => string;

export function WorkflowsPage() {
  const { t } = useT();
  const c = useWorkflowsController();
  return <WorkflowsPageShell controller={c} t={t} />;
}

function WorkflowsPageShell({ controller: c, t }: { controller: WorkflowsController; t: TT }) {
  const visibleTabs = c.workflowTabs ?? visibleWorkflowTabs(undefined);
  return (
    <div className="wf-page flex h-full min-h-0 flex-col gap-3 p-4" data-testid="page-workflows">
      <header className="wf-page__header flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text)]">{t('module.workflows.title')}</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{t('module.workflows.subtitle')}</p>
        </div>
        <WorkflowsHeaderActions c={c} t={t} />
      </header>
      <Tabs
        items={visibleTabs.map((tabKey) => ({
          key: tabKey,
          label: t(`module.workflows.tabs.${tabKey}`),
        }))}
        value={c.tab}
        onChange={(v) => c.setTab(v as TabKey)}
        className="wf-page__tabs"
      />
      <div className="wf-page__body flex-1 min-h-0 overflow-hidden">
        <Suspense fallback={null}>
          {c.tab === 'canvas' && <WorkflowsTabEditor c={c} />}
          {c.tab === 'templates' && <WorkflowsTabList c={c} />}
          {c.tab === 'publishSkill' && <WorkflowsTabSkills c={c} />}
          {c.tab === 'history' && <WorkflowsTabRuns c={c} />}
          {c.tab === 'versions' && <WorkflowsTabSettings c={c} />}
        </Suspense>
      </div>
      <WorkflowsTabGeneration c={c} />
      <WorkflowsModals c={c} />
    </div>
  );
}

function WorkflowsHeaderActions({ c, t }: { c: WorkflowsController; t: TT }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="wf-btn-secondary"
        onClick={() => c.openAIGenerator()}
        disabled={!c.canWrite}
        title={t('module.workflows.aiOrchestrationHint')}
      >
        {t('module.workflows.aiOrchestration')}
      </button>
      <button
        type="button"
        className="wf-btn-primary"
        onClick={() => c.runWorkflow()}
        disabled={!c.canExecute}
      >
        {t('module.workflows.runDraft')}
      </button>
    </div>
  );
}

export default WorkflowsPage;