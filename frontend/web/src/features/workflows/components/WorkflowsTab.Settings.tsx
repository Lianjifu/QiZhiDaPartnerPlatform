/**
 * 版本管理：历史版本列表、对比差异、加载到画布、回滚生成新草稿。
 */
import { useEffect, useMemo, useState } from 'react';
import { GitBranch, GitCompare, RotateCcw, Search, Workflow } from 'lucide-react';
import { Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { useT } from '@/i18n';
import { computeVersionDiff } from '@/features/workflows/version-diff';
import type { WorkflowsController } from './useWorkflowsController';
import { NODE_LABELS, formatWorkflowVersionLabel, type VersionSnapshot } from './WorkflowsShared';

const STATUS_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'published', label: '已发布' },
] as const;

export function WorkflowsTabSettings({ c }: { c: WorkflowsController }) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]['key']>('all');

  useEffect(() => {
    if (!c.versions.length) return;
    const selectedId = c.versionCenterSelectedId;
    const hasSelected = Boolean(selectedId && c.versions.some((v) => v.id === selectedId));
    if (!hasSelected) {
      const next = c.activeVersion && c.versions.some((v) => v.id === c.activeVersion) ? c.activeVersion : c.versions[0].id;
      c.setVersionCenterSelectedId(next);
    }
    if (!c.diffBaseId || !c.versions.some((v) => v.id === c.diffBaseId)) {
      const current = hasSelected ? selectedId : (c.activeVersion || c.versions[0].id);
      const other = c.versions.find((v) => v.id !== current);
      if (other) c.setDiffBaseId(other.id);
    }
  }, [c.activeVersion, c.diffBaseId, c.setDiffBaseId, c.setVersionCenterSelectedId, c.versionCenterSelectedId, c.versions]);

  const publishedCount = c.versions.filter((v) => v.status === 'published').length;
  const draftCount = c.versions.length - publishedCount;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return c.versions.filter((v) => {
      if (statusFilter !== 'all' && (v.status ?? 'draft') !== statusFilter) return false;
      if (!q) return true;
      return `${formatWorkflowVersionLabel(v)} ${v.id} ${v.desc} ${v.time}`.toLowerCase().includes(q);
    });
  }, [c.versions, query, statusFilter]);

  const selected = c.versions.find((v) => v.id === c.versionCenterSelectedId) ?? visible[0] ?? c.versions[0];
  const base = c.versions.find((v) => v.id === c.diffBaseId) ?? c.versions.find((v) => v.id !== selected?.id) ?? selected;
  const diff = useMemo(() => {
    if (!selected || !base || selected.id === base.id) return null;
    return computeVersionDiff(base, selected);
  }, [base, selected]);

  const loadToCanvas = (version: VersionSnapshot) => {
    c.loadSnapshot({ nodes: version.nodes, edges: version.edges }, version.id);
    c.goStudio('canvas');
    c.showToast(`已加载 ${formatWorkflowVersionLabel(version)} 到画布`, 'success');
  };

  return (
    <div className="wf-versions" data-testid="wf-versions-tab">
      <section className="wf-versions__hero">
        <div className="wf-versions__hero-main">
          <div className="wf-versions__eyebrow"><GitBranch className="h-3.5 w-3.5" />版本中心</div>
          <h2 className="wf-versions__title">{t('module.workflows.versions.title')}</h2>
          <p className="wf-versions__lead">浏览草稿与已发布版本，对比节点差异后加载到画布，或回滚并生成新草稿。已发布版本不会被覆盖。</p>
        </div>
        <div className="wf-versions__hero-meta">
          <div className="wf-versions__stat"><strong>{c.versions.length}</strong><span>全部版本</span></div>
          <div className="wf-versions__stat is-pub"><strong>{publishedCount}</strong><span>已发布</span></div>
          <div className="wf-versions__stat is-ok"><strong>{draftCount}</strong><span>草稿</span></div>
        </div>
      </section>

      <div className="wf-versions__layout">
        <section className="wf-versions__panel">
          <header className="wf-versions__panel-head">
            <div>
              <h3>版本列表</h3>
              <p>当前画布 {c.activeVersion || '未加载'}{c.isDirty ? ' · 有未保存修改' : ''}</p>
            </div>
            {c.canWrite && (
              <Button size="sm" variant="outline" onClick={() => c.saveAsVersion()} disabled={!c.nodes.length}>
                另存当前画布
              </Button>
            )}
          </header>
          <div className="wf-versions__toolbar">
            <div className="wf-versions__search">
              <Search />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索版本号、说明" aria-label="搜索版本" />
            </div>
            <div className="wf-versions__filters" role="group" aria-label="版本状态">
              {STATUS_FILTERS.map((item) => (
                <button key={item.key} type="button" className={cn(statusFilter === item.key && 'is-active')} onClick={() => setStatusFilter(item.key)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="wf-versions__list">
            {visible.length === 0 ? (
              <div className="wf-versions__empty">
                <GitBranch className="h-6 w-6" />
                <strong>{c.versions.length === 0 ? '暂无版本' : '没有符合条件的版本'}</strong>
                <span>{c.versions.length === 0 ? '请先在流程编排保存草稿或另存版本。' : '调整搜索或状态后再试。'}</span>
              </div>
            ) : visible.map((v) => (
              <button
                key={v.id}
                type="button"
                className={cn('wf-versions__row', selected?.id === v.id && 'is-selected')}
                onClick={() => c.setVersionCenterSelectedId(v.id)}
              >
                <span className="wf-versions__row-id">{formatWorkflowVersionLabel(v)}</span>
                <div className="wf-versions__row-tags">
                  <span className={cn('wf-versions__chip', v.status === 'published' ? 'is-pub' : 'is-draft')}>{v.status === 'published' ? '已发布' : '草稿'}</span>
                  {v.id === c.activeVersion && <span className="wf-versions__chip is-current">画布当前</span>}
                  {v.evidenceMode === 'synthetic' && <span className="wf-versions__chip">摘要</span>}
                </div>
                <div className="wf-versions__row-meta">
                  <span>{v.time}</span>
                  <span className="wf-versions__sep" />
                  <span>{v.nodeCount ?? v.nodes.length} 节点</span>
                  <span className="wf-versions__sep" />
                  <span>{v.edgeCount ?? v.edges.length} 连线</span>
                </div>
                {v.desc ? <p className="wf-versions__row-desc">{v.desc}</p> : null}
              </button>
            ))}
          </div>
        </section>

        <section className="wf-versions__panel wf-versions__detail">
          {!selected ? (
            <div className="wf-versions__empty">
              <strong>选择一个版本查看详情</strong>
            </div>
          ) : (
            <>
              <header className="wf-versions__panel-head">
                <div>
                  <h3>{formatWorkflowVersionLabel(selected)}</h3>
                  <p><code>{selected.id}</code></p>
                </div>
              </header>
              <div className="wf-versions__detail-body">
                <div className="wf-versions__kv">
                  <div><span>状态</span><strong>{selected.status === 'published' ? '已发布' : '草稿'}</strong></div>
                  <div><span>时间</span><strong>{selected.time}</strong></div>
                  <div><span>节点 / 连线</span><strong>{selected.nodeCount ?? selected.nodes.length} / {selected.edgeCount ?? selected.edges.length}</strong></div>
                  <div><span>父版本</span><code>{selected.parentVersionId || '—'}</code></div>
                </div>
                {selected.desc ? <p className="wf-versions__hint">{selected.desc}</p> : null}

                <div className="wf-versions__actions">
                  <Button size="sm" onClick={() => loadToCanvas(selected)}><Workflow className="h-3.5 w-3.5" />加载到画布</Button>
                  <Button size="sm" variant="outline" onClick={() => c.setVersionDiffOpen(true)} disabled={!diff}><GitCompare className="h-3.5 w-3.5" />打开版本中心</Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!c.canWrite || !selected}
                    onClick={() => c.setRollbackTargetId(selected.id)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />回滚并生成新草稿
                  </Button>
                </div>
                {selected.status === 'published' && (
                  <div className="wf-versions__warn">已发布版本只读。回滚会基于该版本生成新的隔离草稿，不会覆盖本版本。</div>
                )}
                {!c.canWrite && <div className="wf-versions__hint">当前账号为只读，可以对比和查看，不能回滚或另存。</div>}

                {selected.nodes.length > 0 && (
                  <div className="wf-versions__seq">
                    {selected.nodes.slice(0, 8).map((node) => (
                      <span key={node.id} className="wf-versions__seq-item">{String(node.data?.label || NODE_LABELS[node.data?.kind as keyof typeof NODE_LABELS] || node.id)}</span>
                    ))}
                    {selected.nodes.length > 8 && <span className="wf-versions__seq-more">+{selected.nodes.length - 8}</span>}
                  </div>
                )}

                <div className="wf-versions__diff">
                  <div className="wf-versions__diff-head">
                    <h4>对比差异</h4>
                    <label>
                      对比基线
                      <select value={base?.id ?? ''} onChange={(e) => c.setDiffBaseId(e.target.value)}>
                        {c.versions.map((v) => <option key={v.id} value={v.id}>{formatWorkflowVersionLabel(v)}</option>)}
                      </select>
                    </label>
                  </div>
                  {diff ? (
                    <>
                      <div className="wf-versions__diff-stats">
                        <span>节点 <strong>+{diff.addedNodes.length}</strong> / <strong>-{diff.removedNodes.length}</strong> / <strong>~{diff.changedNodes.length}</strong></span>
                        <span>连线 <strong>+{diff.addedEdges}</strong> / <strong>-{diff.removedEdges}</strong></span>
                      </div>
                      <ul className="wf-versions__diff-list">
                        {diff.addedNodes.map((n) => <li key={`a-${n.id}`} className="is-add">+ {n.label} <code>{n.id}</code></li>)}
                        {diff.removedNodes.map((n) => <li key={`d-${n.id}`} className="is-del">- {n.label} <code>{n.id}</code></li>)}
                        {diff.changedNodes.map((n) => <li key={`c-${n.id}`} className="is-chg">~ {n.from} → {n.to}</li>)}
                        {diff.addedNodes.length + diff.removedNodes.length + diff.changedNodes.length === 0 && (
                          <li>节点结构相同，仅连线或其他属性可能变化。</li>
                        )}
                      </ul>
                    </>
                  ) : (
                    <p className="wf-versions__hint">选择与当前版本不同的基线查看差异。</p>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export const __WORKFLOWS_TAB_HISTORY_KEY = "t('module.workflows.tabs.history')";
export const __WORKFLOWS_TAB_VERSIONS_KEY = "t('module.workflows.tabs.versions')";
export const __WORKFLOWS_OPEN_VERSION_CENTER = '打开版本中心';
export const __WORKFLOWS_ROLLBACK_NEW_DRAFT = '回滚并生成新草稿';
export const __WORKFLOWS_BOUNDARY_CLASS = 'wf-boundary';
export const __WORKFLOWS_API_ENABLED = "enabled: Boolean(workflowId)";
export const __WORKFLOWS_API_PATH = "/api/workflows/${workflowId || '__none__'}";
