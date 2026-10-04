/**
 * 工作流程目录：流程模版。编排 / 运行 / 发布 / 版本在 /workflows/new。
 */
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Workflow } from 'lucide-react';
import { Badge } from '@qzda/web-ui';
import { RoleReadonlyBanner } from '@/components/shared';
import { rolePageCopy } from '@/features/role-nav/role-nav';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { WorkflowsController } from './useWorkflowsController';
import { useWorkflowsController } from './useWorkflowsController';
import { WorkflowsTabList } from './WorkflowsTab.List';
import { WorkflowsModals } from './WorkflowsModals';

export function WorkflowsPage() {
  const c = useWorkflowsController();
  return <WorkflowsPageShell controller={c} />;
}

function WorkflowsPageShell({ controller: c }: { controller: WorkflowsController }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const pageCopy = rolePageCopy('workflows', user?.role);
  const workspaceName = useWorkspaceStore((state) => state.current?.name ?? '当前工作区');

  useEffect(() => {
    if (params.get('tab') === 'history') {
      navigate('/workflows/new?step=history', { replace: true });
      return;
    }
    c.setTab('templates');
  }, [c.setTab, navigate, params]);

  return (
    <div className="wf-page de-employee-page flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5" data-testid="page-workflows">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <section className="de-employee-shell shrink-0 overflow-hidden rounded-xl bg-[var(--surface-1)]">
          <div className="flex items-start justify-between gap-4 px-4 py-3.5 md:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg">
                  <Workflow className="h-4 w-4" />
                </div>
                <h1 className="text-base font-semibold text-[var(--text)]">{pageCopy.title}</h1>
              </div>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{pageCopy.subtitle}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Badge tone="info">{workspaceName}</Badge>
              {!c.canWrite && <Badge tone="neutral">只读</Badge>}
              <button
                type="button"
                className="de-employee-btn de-employee-btn--primary"
                onClick={() => navigate('/workflows/new')}
              >
                <Plus className="h-3.5 w-3.5" />
                新建工作流程
              </button>
            </div>
          </div>
          <div className="px-4 md:px-5">
            <RoleReadonlyBanner className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]" />
          </div>
        </section>

        <div className="wf-page__body min-h-0 flex-1 overflow-hidden">
          <div className="h-full min-h-0 overflow-y-auto">
            <WorkflowsTabList c={c} />
          </div>
        </div>
      </div>
      <WorkflowsModals c={c} />
    </div>
  );
}

export default WorkflowsPage;
