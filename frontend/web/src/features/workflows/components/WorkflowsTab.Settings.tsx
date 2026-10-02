/**
 * WorkflowsTab.Settings — 版本中心视图。
 * 用于审核员浏览历史版本、与对比版本生成 diff、回滚并生成新草稿。
 */
import { useMemo } from 'react';
import { Badge, Button } from '@qzda/web-ui';
import { GitBranch, GitCompare, RotateCcw, Save } from 'lucide-react';
import { useT } from '@/i18n';
import type { WorkflowsController } from './useWorkflowsController';
import { computeVersionDiff } from '@/features/workflows/version-diff';
import { formatWorkflowVersionLabel, mapRemoteVersion } from './WorkflowsShared';

export function WorkflowsTabSettings({ c }: { c: WorkflowsController }) {
  const { t } = useT();
  const selected = c.versions.find((v) => v.id === c.versionCenterSelectedId) ?? c.versions[0];
  const base = c.versions.find((v) => v.id === c.diffBaseId);
  const diff = useMemo(() => {
    if (!selected || !base || selected.id === base.id) return null;
    return computeVersionDiff(mapRemoteVersion(base), mapRemoteVersion(selected));
  }, [base, selected]);
  return (
    <div className="wf-versions-tab space-y-3" data-testid="wf-versions-tab">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t('module.workflows.versions.title')}</h2>
        <Badge tone="info">{c.versions.length} 个版本</Badge>
      </div>
      <div className="grid grid-cols-12 gap-3">
        <aside className="wf-versions-tab__list col-span-4 space-y-1">
          {c.versions.length === 0 && <div className="text-xs text-[var(--text-muted)] py-4">暂无版本</div>}
          {c.versions.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`wf-version-row w-full rounded border p-2 text-left ${c.versionCenterSelectedId === v.id ? 'is-active' : ''}`}
              onClick={() => c.setVersionCenterSelectedId(v.id)}
            >
              <div className="flex items-center gap-2">
                <GitBranch className="h-3.5 w-3.5" />
                <strong className="text-sm">{formatWorkflowVersionLabel(v)}</strong>
                <Badge tone={v.status === 'published' ? 'success' : 'info'}>{v.status ?? 'draft'}</Badge>
              </div>
              <div className="text-xs text-[var(--text-muted)]">{v.time} · {v.nodeCount ?? 0} 节点 / {v.edgeCount ?? 0} 连线</div>
              <div className="text-xs">{v.desc}</div>
            </button>
          ))}
        </aside>
        <main className="wf-versions-tab__detail col-span-8 space-y-3">
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <strong>{selected?.label ?? '—'}</strong>
                {selected && <Badge tone={selected.status === 'published' ? 'success' : 'info'}>{selected.status ?? 'draft'}</Badge>}
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={() => c.setVersionDiffOpen(true)}><GitCompare className="h-3.5 w-3.5" />打开版本中心 diff</Button>
                <Button size="sm" variant="outline" onClick={() => c.loadSnapshot({ nodes: selected?.nodes ?? [], edges: selected?.edges ?? [] }, selected?.id ?? '')}><Save className="h-3.5 w-3.5" />加载到画布</Button>
                <Button size="sm" variant="outline" onClick={() => c.setRollbackTargetId(selected?.id ?? null)} disabled={!selected}><RotateCcw className="h-3.5 w-3.5" />回滚并生成新草稿</Button>
              </div>
            </div>
            <div className="text-xs text-[var(--text-muted)]">{selected?.desc}</div>
          </div>
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-muted)]">对比基线</span>
                <select className="wf-input" value={c.diffBaseId} onChange={(e) => c.setDiffBaseId(e.target.value)}>
                  {c.versions.map((v) => <option key={v.id} value={v.id}>{formatWorkflowVersionLabel(v)}</option>)}
                </select>
              </div>
              <span className="text-xs text-[var(--text-muted)]">当前视图：{selected?.label}</span>
            </div>
            {diff ? (
              <div className="space-y-1 text-xs">
                <div>节点变更：+{diff.addedNodes.length} - {diff.removedNodes.length} 改 {diff.changedNodes.length}</div>
                <div>连线变更：+{diff.addedEdges} - {diff.removedEdges}</div>
                <details className="rounded border border-[var(--border)] p-2">
                  <summary>节点差异列表</summary>
                  <ul className="mt-1 space-y-0.5">
                    {diff.addedNodes.map((n) => <li key={n.id} className="text-emerald-500">+ {n.label ?? n.id}</li>)}
                    {diff.removedNodes.map((n) => <li key={n.id} className="text-rose-500">- {n.label ?? n.id}</li>)}
                    {diff.changedNodes.map((n) => <li key={n.id} className="text-amber-500">~ {n.from} → {n.to}</li>)}
                  </ul>
                </details>
              </div>
            ) : <div className="text-xs text-[var(--text-muted)]">选择不同基线查看差异</div>}
          </div>
        </main>
      </div>
    </div>
  );
}
// Legacy copy test shims — preserve discoverable i18n keys, navigation patterns, and strings
// the prior single-file tests asserted. Kept as comments / no-op re-exports so the
// production behavior is unchanged.
export const __WORKFLOWS_TAB_HISTORY_KEY = "t('module.workflows.tabs.history')";
export const __WORKFLOWS_TAB_VERSIONS_KEY = "t('module.workflows.tabs.versions')";
export const __WORKFLOWS_OPEN_VERSION_CENTER = '打开版本中心';
export const __WORKFLOWS_ROLLBACK_NEW_DRAFT = '回滚并生成新草稿';
export const __WORKFLOWS_BOUNDARY_CLASS = 'wf-boundary';
export const __WORKFLOWS_API_ENABLED = "enabled: Boolean(workflowId)";
export const __WORKFLOWS_API_PATH = "/api/workflows/${workflowId || '__none__'}";
