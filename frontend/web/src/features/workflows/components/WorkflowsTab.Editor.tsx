/**
 * WorkflowsTab.Editor — 工作流画布 tab。
 * M06 P1 拆分：原 pages/Workflows.tsx 单文件 4479L，按 D1 决策拆出此模块。
 */
import { useCallback, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, ReactFlowProvider, type NodeMouseHandler } from 'reactflow';
import 'reactflow/dist/style.css';
import { AlertTriangle, Box, Pencil, Bug, Eye, Search, ShieldCheck, Sparkles, Undo as UndoIcon, Redo as RedoIcon, Save, FileJson, Trash2, RefreshCw, History as HistoryIcon, ChevronRight } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { Drawer } from '@/components/shared';
import type { WorkflowsController } from './useWorkflowsController';
import {
  NODE_COLORS, NODE_DESCS, NODE_ICONS, NODE_LABELS, NODE_LIBRARY_GROUPS,
  NODE_LIBRARY_META, Field, Section, nodeTypes, recommendedNodeKinds,
  StructureIssue, WorkflowLifecycleStrip, type WorkflowNodeKind,
} from './WorkflowsShared';

type Props = { c: WorkflowsController };

export function WorkflowsTabEditor({ c }: Props) {
  const [libraryView, setLibraryView] = useState<'recommended' | 'all'>('recommended');
  const [mobilePanelOpen, setMobilePanelOpen] = useState<'library' | 'inspector' | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'overview' | 'debug' | 'properties'>('overview');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const selectedLibraryKind = c.selectedNode?.data?.kind as WorkflowNodeKind | undefined;
  const recommendedLibrary = useMemo(() => recommendedNodeKinds(selectedLibraryKind).filter((kind) => c.filteredLibrary.includes(kind)), [c.filteredLibrary, selectedLibraryKind]);
  const visibleLibrary = libraryView === 'recommended' ? recommendedLibrary : c.filteredLibrary;
  const visibleLibraryGroups = useMemo(
    () => NODE_LIBRARY_GROUPS
      .map((group) => ({ ...group, kinds: group.kinds.filter((kind) => visibleLibrary.includes(kind)) }))
      .filter((group) => group.kinds.length > 0),
    [visibleLibrary],
  );
  const handleNodeClick: NodeMouseHandler = useCallback((event, node) => {
    c.onNodeClick(event, node);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) setMobilePanelOpen('inspector');
  }, [c]);
  const activeLabel = c.versions.find((version) => version.id === c.activeVersion)?.label || c.activeVersion || '—';
  return (
    <div className="wf-editor flex h-full min-h-0 min-w-0 flex-col" data-testid="wf-editor">
      <div className="wf-editor__toolbar flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-1)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => c.setVersionMenuOpen(true)} aria-label="切换或管理当前画布版本">
            <HistoryIcon className="h-3.5 w-3.5" />
            <span className="text-[10px] font-semibold opacity-80">当前版本</span>
            <span className="font-mono">{activeLabel}</span>
            <ChevronRight className="h-3.5 w-3.5 rotate-90" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => c.setNodeLibraryOpen(!c.nodeLibraryOpen)}>
            <Box className="h-3.5 w-3.5" />
            {c.nodeLibraryOpen ? '收起节点库' : '节点库'}
          </Button>
          <Button size="sm" variant="ghost" onClick={c.openAIGenerator} disabled={!c.canWrite}>
            <Sparkles className="h-3.5 w-3.5" />AI 辅助
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 md:ml-auto">
          <Button size="sm" variant={c.isDirty ? 'primary' : 'secondary'} onClick={c.saveCanvas} disabled={!c.canWrite || !c.isDirty}>
            <Save className="h-3.5 w-3.5" />{c.isDirty ? '保存草稿' : '已保存'}
          </Button>
          <Button size="sm" variant="secondary" onClick={c.runWorkflow} disabled={!c.canExecute || c.validateWorkflowApi.isPending || c.isDirty || !!c.draftGate?.blocked}>
            运行试验
          </Button>
          <Button size="sm" variant="ghost" onClick={c.undo} disabled={c.historyRef.current.idx <= 0}><UndoIcon className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="ghost" onClick={c.redo}><RedoIcon className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="ghost" onClick={() => c.clearCanvas()}><Trash2 className="h-3.5 w-3.5" />清空画布</Button>
          <Button size="sm" variant="ghost" onClick={() => c.resetCanvas()}><RefreshCw className="h-3.5 w-3.5" />重置</Button>
          <Button size="sm" variant="ghost" onClick={() => c.exportWorkflow()}><FileJson className="h-3.5 w-3.5" />导出</Button>
        </div>
      </div>

      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] leading-5 text-[var(--text-muted)]">
        本页用于编排受控处置流程草稿。版本治理请点「当前版本」进入抽屉 / 版本中心；完成后请到「发布技能」发布为流程技能，供数字伙伴能力装配；本页不直接发起专家协作上岗。
        {c.structureIssues.filter((item) => item.severity === 'failed').length > 0 && (
          <span className="ml-2 text-amber-500">结构门禁：{c.structureIssues.filter((i) => i.severity === 'failed').map((i) => i.message).join('；')}</span>
        )}
      </div>

      <div className="wf-editor__lifecycle">
        <WorkflowLifecycleStrip highlight="version" />
      </div>

      <div className={cn('wf-editor__body grid flex-1 min-h-0 gap-2', c.nodeLibraryOpen ? 'grid-cols-[minmax(0,1fr)_minmax(0,3fr)_minmax(0,1fr)]' : 'grid-cols-[minmax(0,3fr)_minmax(0,1fr)]')}>
        {c.nodeLibraryOpen && (
          <aside className="wf-editor__library min-h-0 h-full overflow-y-auto" aria-label="节点库">
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-1)]">
              <div className="border-b border-[var(--border)] p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <span className="grid h-6 w-6 place-items-center rounded-lg bg-blue-50 text-blue-600"><Box className="h-3.5 w-3.5" /></span>
                  节点库
                  <span className="ml-auto text-[10px] font-normal text-[var(--text-muted)]">点击或拖拽添加</span>
                </div>
                <div className="relative mt-2">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input value={c.librarySearchQ} onChange={(e) => c.setLibrarySearchQ(e.target.value)} placeholder="搜索节点、能力或系统" className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] pl-8 pr-2 text-[11px] outline-none focus:border-[var(--brand)]" />
                </div>
                <div className="mt-2 flex items-center gap-1 rounded-lg bg-[var(--bg-elevated)] p-1">
                  {(['recommended', 'all'] as const).map((view) => (
                    <button key={view} type="button" onClick={() => setLibraryView(view)} className={cn('flex-1 rounded-md px-2 py-1 text-[10px] font-medium', libraryView === view ? 'bg-[var(--surface-1)] text-[var(--brand)]' : 'text-[var(--text-muted)]')}>
                      {view === 'recommended' ? '推荐下一步' : '全部节点'}
                    </button>
                  ))}
                </div>
                {libraryView === 'recommended' && (
                  <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
                    {selectedLibraryKind ? `基于「${NODE_LABELS[selectedLibraryKind]}」推荐可接入节点` : '从触发器或常用能力开始搭建流程'}
                  </p>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
                {visibleLibraryGroups.length > 0 ? (
                  <div className="space-y-3">
                    {visibleLibraryGroups.map((group) => (
                      <section key={group.id}>
                        <div className="mb-1.5 flex items-center gap-2 px-0.5">
                          <span className="text-[10px] font-semibold">{group.label}</span>
                          <span className="truncate text-[9px] text-[var(--text-muted)]">{group.desc}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {group.kinds.map((kind) => {
                            const Icon = NODE_ICONS[kind];
                            const color = NODE_COLORS[kind];
                            const meta = NODE_LIBRARY_META[kind];
                            return (
                              <button
                                key={kind}
                                draggable
                                onDragStart={(e) => { e.dataTransfer.setData('application/wf-node', kind); c.setDraggedKind(kind); }}
                                onDragEnd={() => c.setDraggedKind(null)}
                                onClick={() => c.addNode(kind)}
                                title={NODE_DESCS[kind]}
                                className="flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2 text-left hover:border-[var(--brand)]"
                              >
                                <span className="flex items-center gap-1.5">
                                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md" style={{ backgroundColor: `${color}1a`, color }}><Icon className="h-3.5 w-3.5" /></span>
                                  <span className="truncate text-[10px] font-semibold">{NODE_LABELS[kind]}</span>
                                </span>
                                <span className="line-clamp-2 text-[9px] leading-[13px] text-[var(--text-muted)]">{NODE_DESCS[kind]}</span>
                                {meta.badge && <Badge tone={meta.risk === 'sensitive' ? 'warn' : meta.risk === 'review' ? 'info' : 'neutral'}>{meta.badge}</Badge>}
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : <div className="grid min-h-28 place-items-center px-5 text-center text-[11px] text-[var(--text-muted)]">未找到匹配节点</div>}
              </div>
            </div>
          </aside>
        )}
        <div className="wf-editor__canvas-wrapper min-h-0 h-full relative" ref={c.wrapperRef} onDragOver={c.handleDragOver} onDrop={c.handleDrop}>
          <ReactFlowProvider>
            <ReactFlow
              ref={c.reactFlowRef}
              nodes={c.rfNodes}
              edges={c.rfEdges}
              nodeTypes={nodeTypes}
              fitView
              style={{ width: '100%', height: '100%' }}
              onNodeClick={handleNodeClick}
              onNodeContextMenu={c.onNodeContextMenu}
              onNodesChange={c.onNodesChange}
              onConnect={c.onConnect}
              onEdgeDoubleClick={(_, edge) => c.deleteEdge(edge.id)}
            >
              <Background gap={20} size={1} />
              <Controls position="bottom-right" showInteractive={false} />
              <MiniMap
                position="top-right"
                nodeColor={(n) => NODE_COLORS[(n.data as any)?.kind as WorkflowNodeKind] ?? '#3b82f6'}
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
              />
            </ReactFlow>
          </ReactFlowProvider>
          {c.draggedKind && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-blue-50 border-2 border-dashed border-blue-300 z-10">
              <div className="rounded-md bg-[var(--surface-1)] border border-[var(--brand)] px-4 py-2 text-sm font-semibold text-[var(--brand)] shadow-lg">释放鼠标添加到画布 · {NODE_LABELS[c.draggedKind]}</div>
            </div>
          )}
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]/95 px-2.5 py-1.5 text-[10px] shadow-md backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
            <span>编排草稿</span>
            <span className="font-mono font-semibold">{c.selectedNode ? (c.selectedNode.data?.label || c.selectedNode.id) : '未选中节点'}</span>
            <span className="text-[var(--text-muted)]">{c.isDirty ? '待保存' : '已同步'}</span>
          </div>
          <div className="absolute top-3 left-3 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)]/95 px-2 py-1 text-[10px] shadow-md backdrop-blur">
            <Search className="h-3 w-3" />
            <input value={c.canvasSearchQ} onChange={(e) => c.setCanvasSearchQ(e.target.value)} placeholder="定位节点" className="bg-transparent outline-none w-32" />
            {c.searchMatch && <button onClick={() => c.focusNode(c.searchMatch!.id)} className="rounded bg-[var(--brand)] px-1.5 py-0.5 text-[9px] text-white">跳转</button>}
          </div>
        </div>
        <aside className="wf-editor__inspector min-h-0 h-full overflow-y-auto">
          {c.selectedNode ? (
            <NodeInspector selectedNode={c.selectedNode} c={c} tab={inspectorTab} setTab={setInspectorTab} />
          ) : (
            <InfoPanel c={c} />
          )}
        </aside>
      </div>

      <Drawer open={c.versionMenuOpen} onClose={() => c.setVersionMenuOpen(false)} title="当前版本" description={`画布 ${activeLabel} · 切换仅影响草稿；另存 / 发布 / 回滚请在版本中心完成`}>
        <div className="space-y-2">
          {c.versions.map((version) => (
            <button key={version.id} type="button" onClick={() => { c.loadSnapshot(version, version.id); c.setVersionMenuOpen(false); c.showToast(`已加载 ${version.label}`, 'info'); }} className={cn('flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left', version.id === c.activeVersion ? 'border-[var(--brand)] bg-blue-50' : 'border-[var(--border)]')}>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-sm font-semibold">{version.label}</span>
                  {version.id === c.activeVersion && <Badge tone="success">当前</Badge>}
                  <Badge tone={version.status === 'published' ? 'info' : 'neutral'}>{version.status === 'published' ? '已发布' : '草稿'}</Badge>
                </span>
                <span className="mt-1 block text-[11px] text-[var(--text-muted)]">{version.time}</span>
                <span className="block truncate text-xs">{version.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => { c.setVersionMenuOpen(false); c.setTab('versions'); }}>打开版本中心</Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => c.setRollbackTargetId(c.activeVersion)} disabled={!c.canWrite}>回滚并生成新草稿</Button>
        </div>
      </Drawer>
    </div>
  );
}

function NodeInspector({ selectedNode, c, tab, setTab }: { selectedNode: import('reactflow').Node; c: WorkflowsController; tab: 'overview' | 'debug' | 'properties'; setTab: (v: 'overview' | 'debug' | 'properties') => void }) {
  return (
    <aside className="wf-inspector space-y-2">
      <div className="flex items-center gap-1 mb-2">
        <InspectorTab id="overview" Icon={Eye} setTab={setTab} current={tab} label="概览" />
        <InspectorTab id="debug" Icon={Bug} setTab={setTab} current={tab} label="调试" />
        <InspectorTab id="properties" Icon={Pencil} setTab={setTab} current={tab} label="属性" />
      </div>
      {tab === 'overview' && <NodeOverview selectedNode={selectedNode} />}
      {tab === 'debug' && <DebugPanel selectedNode={selectedNode} />}
      {tab === 'properties' && <PropertiesPanel selectedNode={selectedNode} c={c} />}
    </aside>
  );
}

function InspectorTab({ id, Icon, setTab, current, label }: { id: string; Icon: any; setTab: (v: any) => void; current: string; label: string }) {
  return (
    <button type="button" className={cn('wf-inspector__tab flex items-center gap-1 px-2 py-1 text-xs rounded', current === id ? 'bg-[var(--brand-light)] text-[var(--brand)]' : 'text-[var(--text-muted)]')} onClick={() => setTab(id)}>
      <Icon className="h-3.5 w-3.5" />{label}
    </button>
  );
}

function InfoPanel({ c }: { c: WorkflowsController }) {
  return (
    <aside className="wf-info-panel space-y-2">
      <h3 className="text-sm font-semibold">画布概览</h3>
      <Section title="基础信息">
        <Field label="节点数"><span>{c.nodes.length}</span></Field>
        <Field label="连线数"><span>{c.edges.length}</span></Field>
      </Section>
      <Section title="结构门禁">
        <ul className="text-xs space-y-1">
          {c.structureIssues.length === 0 && <li className="text-emerald-500">通过</li>}
          {c.structureIssues.map((issue) => (
            <li key={issue.code} className={cn(issue.severity === 'failed' ? 'text-rose-500' : 'text-amber-500')}>{issue.message}</li>
          ))}
        </ul>
      </Section>
    </aside>
  );
}

function NodeOverview({ selectedNode }: { selectedNode: import('reactflow').Node }) {
  const kind = selectedNode.data.kind as WorkflowNodeKind;
  const Icon = NODE_ICONS[kind];
  const color = NODE_COLORS[kind];
  return (
    <Section title="节点概览">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color }} />
        <strong>{selectedNode.data.label}</strong>
      </div>
      <Field label="节点 ID"><code>{selectedNode.id}</code></Field>
      <Field label="类型"><code>{selectedNode.data.kind}</code></Field>
      {selectedNode.data.desc && <Field label="说明"><p className="text-xs">{selectedNode.data.desc}</p></Field>}
      {selectedNode.data.note && <Field label="备注"><Badge tone="warn">{selectedNode.data.note}</Badge></Field>}
    </Section>
  );
}

function DebugPanel({ selectedNode }: { selectedNode: import('reactflow').Node }) {
  return (
    <Section title="模拟重跑">
      <p className="text-xs text-[var(--text-muted)]">模拟重跑仅展示节点级入参/出参，不会创建执行记录或审计留痕。</p>
      <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
        <Field label="节点 ID"><code>{selectedNode.id}</code></Field>
        <Field label="入参样例"><code>{'{ alertId, severity }'}</code></Field>
        <Field label="审批超时（秒）"><code>{String((selectedNode.data.approvalTimeoutSec ?? 300) as number)}</code></Field>
        <Field label="已纳管 Skill 调用"><code>{String(Boolean(selectedNode.data.skillInvokeId))}</code></Field>
      </div>
      <Button size="sm" variant="outline" className="mt-2 w-full" disabled>仅本地模拟，不会创建执行记录或审计留痕</Button>
    </Section>
  );
}

function PropertiesPanel({ selectedNode, c }: { selectedNode: import('reactflow').Node; c: WorkflowsController }) {
  return (
    <div className="space-y-2">
      <Section title="节点标签">
        <input className="wf-input w-full" value={selectedNode.data.label ?? ''} onChange={(e) => c.updateNodeLabel(selectedNode.id, e.target.value)} disabled={!c.canWrite} />
      </Section>
      <Section title="节点说明">
        <textarea className="wf-textarea w-full" rows={3} value={selectedNode.data.desc ?? ''} onChange={(e) => c.updateNodeDescription(selectedNode.id, e.target.value)} disabled={!c.canWrite} />
      </Section>
      <Section title="节点备注">
        <input className="wf-input w-full" value={selectedNode.data.note ?? ''} onChange={(e) => c.updateNodeNote(selectedNode.id, e.target.value)} disabled={!c.canWrite} />
      </Section>
      <Section title="节点操作">
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => c.duplicateNode(selectedNode.id)} disabled={!c.canWrite}>复制</Button>
          <Button size="sm" variant="outline" onClick={() => c.disableNode(selectedNode.id)} disabled={!c.canWrite}>{selectedNode.data.disabled ? '启用' : '禁用'}</Button>
          <Button size="sm" variant="outline" onClick={() => c.deleteNode(selectedNode.id)} disabled={!c.canWrite}>删除</Button>
        </div>
      </Section>
    </div>
  );
}

function StructureIssuesDisplay({ issues }: { issues: StructureIssue[] }) {
  if (!issues.length) return <Badge tone="success"><ShieldCheck className="h-3 w-3" />结构门禁 · 通过</Badge>;
  return (
    <div className="flex flex-wrap gap-2">
      {issues.filter((i) => i.severity === 'failed').length > 0 && <Badge tone="error"><AlertTriangle className="h-3 w-3" />{issues.filter((i) => i.severity === 'failed').length} 项阻断</Badge>}
      {issues.filter((i) => i.severity === 'review').map((i) => (
        <Badge key={i.code} tone="warn"><ShieldCheck className="h-3 w-3" />{i.message}</Badge>
      ))}
    </div>
  );
}