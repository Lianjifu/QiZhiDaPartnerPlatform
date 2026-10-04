/**
 * 流程模板编排详情：只读查看模板画布，可核对版本并创建隔离草稿。
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, MarkerType } from 'reactflow';
import 'reactflow/dist/style.css';
import { ArrowLeft, ArrowRight, GitCompare } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { Drawer } from '@/components/shared';
import { useApiQuery } from '@/services/query';
import { roleCanMutate } from '@/features/role-nav/role-nav';
import { useAuthStore } from '@/stores/authStore';
import { ALL_WORKFLOW_TEMPLATES, isTemplateReusable } from '@/features/workflows/department-templates';
import { normalizeTemplateAsset } from './workflow-template-helpers';
import {
  NODE_DESCS,
  NODE_LABELS,
  categoryLabel,
  nodeTypes,
  templateSnapshot,
  type WorkflowTemplateAsset,
} from './WorkflowsShared';

export default function WorkflowTemplatePreviewPage() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const canWrite = roleCanMutate(useAuthStore((s) => s.user?.role));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [versionOpen, setVersionOpen] = useState(false);

  const { data: templateAssets, isLoading } = useApiQuery<Array<Partial<WorkflowTemplateAsset> & { id: string; name: string }>>(
    ['workflow-templates'],
    '/api/workflow-templates',
  );

  const template = useMemo(() => {
    const raw = (templateAssets ?? []).find((item) => item.id === id)
      ?? ALL_WORKFLOW_TEMPLATES.find((item) => item.id === id);
    return raw ? normalizeTemplateAsset(raw) : null;
  }, [id, templateAssets]);

  const snap = useMemo(() => (template ? templateSnapshot(template) : { nodes: [], edges: [] }), [template]);
  const rfNodes = useMemo(
    () => snap.nodes.map((node) => ({ ...node, selected: node.id === selectedId })),
    [snap.nodes, selectedId],
  );
  const rfEdges = useMemo(
    () => snap.edges.map((edge) => ({
      ...edge,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
      style: { stroke: '#94a3b8', strokeWidth: 1.2 },
    })),
    [snap.edges],
  );
  const selected = snap.nodes.find((node) => node.id === selectedId) ?? null;
  const reusable = template ? isTemplateReusable(template) : false;
  const logs = [...(template?.changelog ?? [])].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));

  if (!isLoading && !template) {
    return (
      <div className="wf-tpl-preview">
        <header className="wf-tpl-preview__top">
          <Link to="/workflows" className="wf-tpl-preview__back"><ArrowLeft className="h-3.5 w-3.5" />返回流程模版</Link>
          <h1>未找到该流程模板</h1>
        </header>
      </div>
    );
  }

  if (!template) {
    return <div className="wf-tpl-preview"><p className="px-1 py-8 text-sm text-[var(--text-muted)]">正在载入流程编排…</p></div>;
  }

  return (
    <div className="wf-tpl-preview" data-testid="wf-template-preview">
      <header className="wf-tpl-preview__top">
        <div className="min-w-0">
          <Link to="/workflows" className="wf-tpl-preview__back">
            <ArrowLeft className="h-3.5 w-3.5" />返回流程模版
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1>{template.name}</h1>
            <Badge tone="neutral">v{template.version}</Badge>
            <Badge tone={reusable ? 'success' : 'warn'}>{reusable ? '可使用' : '需授权'}</Badge>
            {template.library === 'advanced' && <Badge tone="info">IT 高级库</Badge>}
          </div>
          <p>{categoryLabel(template.category, template.departmentLabel)} · {template.nodes} 个节点 · 风险 {template.risk}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setVersionOpen(true)}>
            <GitCompare className="h-3.5 w-3.5" />版本
          </Button>
          <Button disabled={!canWrite} onClick={() => navigate(`/workflows/new?use=${encodeURIComponent(template.id)}`)}>
            使用模板<ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="wf-tpl-preview__body">
        <section className="wf-tpl-preview__canvas" aria-label="流程编排画布">
          <ReactFlowProvider>
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              fitView
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              panOnDrag
              zoomOnScroll
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_, node) => setSelectedId(node.id)}
              onPaneClick={() => setSelectedId(null)}
            >
              <Background gap={18} size={1} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable />
            </ReactFlow>
          </ReactFlowProvider>
        </section>

        <aside className="wf-tpl-preview__rail">
          <h2>编排说明</h2>
          <p>{template.description || '该模板定义了一条可发布为流程技能的受控编排路径。'}</p>
          <dl>
            <div><dt>适用对象</dt><dd>{template.audience}</dd></div>
            <div><dt>维护方</dt><dd>{template.owner}</dd></div>
            <div><dt>当前版本</dt><dd>v{template.version}</dd></div>
            <div><dt>核验</dt><dd>{template.verifiedAt || '—'}</dd></div>
          </dl>
          {template.connectors?.length > 0 && (
            <section>
              <h3>连接与能力</h3>
              <ul>
                {template.connectors.map((slot) => (
                  <li key={slot.slot}>{slot.label} · {slot.slot}{slot.required ? ' · 必选' : ''}</li>
                ))}
              </ul>
            </section>
          )}
          {selected && (
            <section>
              <h3>当前节点</h3>
              <strong>{selected.data?.label}</strong>
              <em>{NODE_LABELS[selected.data?.kind as keyof typeof NODE_LABELS] ?? selected.data?.kind}</em>
              <p>{NODE_DESCS[selected.data?.kind as keyof typeof NODE_DESCS] ?? '模板节点'}</p>
            </section>
          )}
          <section>
            <h3>依赖与授权</h3>
            <ul>
              {template.dependencyStatus.length === 0 && <li>无额外依赖</li>}
              {template.dependencyStatus.map((item) => (
                <li key={item.name} className={item.status === 'ready' ? 'is-ok' : 'is-bad'}>
                  {item.status === 'ready' ? '已授权' : '未授权'} · {item.name}
                  {item.reason ? `（${item.reason}）` : ''}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <Drawer
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        width={480}
        title={`模板版本 · ${template.name}`}
        description={`当前目录版本 v${template.version}`}
        footer={(
          <div className="wf-tpl-drawer__foot">
            <Button variant="outline" onClick={() => setVersionOpen(false)}>关闭</Button>
            <Button disabled={!canWrite} onClick={() => navigate(`/workflows/new?use=${encodeURIComponent(template.id)}`)}>
              使用此版本
            </Button>
          </div>
        )}
      >
        <div className="wf-tpl-drawer" data-testid="wf-template-versions">
          <p className="wf-tpl-drawer__hint">版本记录用于核对变更说明。使用模板会按当前目录版本创建隔离草稿，不会覆盖已发布流程。</p>
          <section>
            <h4>版本记录</h4>
            {logs.length === 0 ? <p className="wf-tpl-drawer__hint">暂无变更说明。</p> : (
              <ol className="wf-tpl-drawer__log">
                {logs.map((item) => (
                  <li key={`${item.version}-${item.date}`}>
                    <strong>v{item.version}</strong>
                    <span>{item.date}</span>
                    <p>{item.note}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </Drawer>
    </div>
  );
}
