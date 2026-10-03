/**
 * 知识中心 · 检索验证 + 图谱 tab（M07 P1 拆分）。
 *
 * 同时承载 retrieval（评测 / 检索验证 / 评测门禁）与 graph（实体 + 关系）两个
 * workspace；两个 workspace 共享一些布局与评测渲染，沿用 M07 既有的样式类。
 *
 * - KnowledgeGraphCanvas：内部组件，包含 ReactFlow 节点 / 边 / 关系证据区
 * - EvalForm + EvalQualityCards + EvalPipeline：retrieval 视图
 */
import { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, RotateCcw, Search } from 'lucide-react';
import ReactFlow, { Background, Controls, Handle, MarkerType, Position, useEdgesState, useNodesState, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { Badge, Button, Input } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import {
  formatEvalMs, formatEvalPercent,
} from '@/features/knowledge/knowledge-ui';
import { EvidenceResultList } from './ChunkEvidence';
import { EvalCard, MetricCell, PIPELINE } from './KnowledgeShared';
import type { KnowledgeController } from './useKnowledgeController';

export function KnowledgeTabEval({ c }: { c: KnowledgeController }) {
  if (c.workspace === 'graph') {
    return (
      <main className="de-employee-shell knowledge-workspace overflow-hidden rounded-xl bg-[var(--surface-1)] p-3 md:p-4">
        <div className="knowledge-workspace-heading">
          <div>
            <div className="text-sm font-semibold">图谱与关联</div>
            <p>从原始文档中抽取实体与关系，为影响分析和混合召回提供可回溯的业务上下文。</p>
          </div>
          <Badge tone="brand">证据溯源已启用</Badge>
        </div>
        <KnowledgeGraphCanvas
          entities={c.graphEntities}
          relations={c.graphRelations}
          selectedEntityId={c.selectedGraphEntityId}
          onSelect={(id) => {
            c.setSelectedGraphEntityId(id);
            const entity = c.graphEntities.find((item) => item.id === id);
            if (entity) c.setGovernanceNotice(`实体「${entity.name}」来自文档 ${entity.sourceDocId} · ${entity.sourceVersion}。`);
          }}
        />
      </main>
    );
  }

  return <RetrievalWorkspace c={c} />;
}

function RetrievalWorkspace({ c }: { c: KnowledgeController }) {
  const searchResults = c.retrieveResults;
  const hasQuery = Boolean(c.testQuery.trim());
  const visibleChunks = hasQuery ? searchResults : c.topChunks.slice(0, 4);

  return (
    <main className="de-employee-shell knowledge-workspace overflow-hidden rounded-xl bg-[var(--surface-1)] p-3 md:p-4">
      <div className="knowledge-workspace-heading">
        <div>
          <div className="text-sm font-semibold">检索验证台</div>
          <p>验证数字伙伴在真实问题下的证据覆盖、相关度与响应性能。</p>
        </div>
        <Badge tone="success"><CheckCircle2 className="mr-1 h-3 w-3" />检索服务可用</Badge>
      </div>

      <div className="knowledge-retrieval-query mt-4">
        <Search className="h-4 w-4 shrink-0 text-[var(--brand)]" />
        <Input
          placeholder="输入业务问题，例如：Redis OOM 如何安全处置？"
          value={c.testQuery}
          onChange={(event) => c.setTestQuery(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && c.testQuery.trim() && c.retrieveMutation.mutate({ query: c.testQuery, kb: 'all' })}
          className="border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
        />
        <Button
          size="sm"
          disabled={!c.testQuery.trim() || c.retrieveMutation.isPending}
          onClick={() => c.retrieveMutation.mutate({ query: c.testQuery, kb: 'all' })}
        >
          {c.retrieveMutation.isPending ? '验证中…' : '执行验证'}
        </Button>
      </div>

      <div className="knowledge-retrieval-layout mt-4">
        <section className="knowledge-retrieval-results">
          <div className="knowledge-section-title">
            <Search className="h-3.5 w-3.5 text-[var(--brand)]" />
            证据结果
            <Badge tone="neutral">{hasQuery ? searchResults.length : c.topChunks.length} 条</Badge>
          </div>
          <div className="mt-4">
            <EvidenceResultList
              chunks={visibleChunks}
              emptyHint={hasQuery ? '未命中证据，请换一种问法或先完善知识包内容。' : '输入问题并执行验证，或查看下方默认 Top 证据。'}
              onOpen={c.setChunkDrawer}
            />
          </div>
        </section>

        <section className="knowledge-retrieval-health">
          <div className="knowledge-section-title"><Activity className="h-3.5 w-3.5 text-[var(--brand)]" />质量与性能</div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <EvalCard label="召回率" value={formatEvalPercent(c.normalizedEvalMetrics?.recall)} tone="success" />
            <EvalCard label="准确率" value={formatEvalPercent(c.normalizedEvalMetrics?.precision)} tone="info" />
            <EvalCard label="P95 延迟" value={formatEvalMs(c.normalizedEvalMetrics?.p95Latency)} tone="primary" />
            <EvalCard label="缓存命中" value={formatEvalPercent(c.normalizedEvalMetrics?.hitRate)} tone="purple" />
          </div>
          {c.canWrite && (
            <button type="button" className="knowledge-text-action mt-4" onClick={c.handleRescore}>
              <RotateCcw className="h-3 w-3" />重新评分并查看差异
            </button>
          )}
        </section>
      </div>

      <div className="knowledge-pipeline mt-3" aria-label="检索链路说明">
        {PIPELINE.map((stage, index) => (
          <div key={stage.key} className="knowledge-pipeline__stage is-static">
            <span className="knowledge-pipeline__step">{index + 1}</span>
            <stage.icon className="h-3.5 w-3.5 text-[var(--brand)]" />
            <strong>{stage.label}</strong>
            <small>{stage.capability}</small>
          </div>
        ))}
      </div>

      <EvaluationGate c={c} />
    </main>
  );
}

function EvaluationGate({ c }: { c: KnowledgeController }) {
  const targetPackage = c.knowledgePackages.find((item) => item.status === 'published') ?? c.knowledgePackages[0];
  const profile = c.retrievalProfiles.find((item) => item.packageId === targetPackage?.id);

  return (
    <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 md:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4 text-[var(--brand)]" />评测与发布门禁
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            以标准问题集验证混合召回、重排质量、引用正确性与延迟，再决定是否发布版本。
          </p>
        </div>
        {c.canWrite && (
          <Button
            size="sm"
            variant="secondary"
            disabled={!targetPackage || c.evaluationMutation.isPending}
            onClick={() => {
              if (targetPackage && profile) c.evaluationMutation.mutate({ packageId: targetPackage.id, profileId: profile.id });
            }}
          >
            <Activity className="h-3.5 w-3.5" />运行评测
          </Button>
        )}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {c.evaluations.slice(0, 2).map((item) => {
          const pkg = c.knowledgePackages.find((record) => record.id === item.packageId);
          return (
            <article key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">{pkg?.name ?? item.packageId}</span>
                <Badge tone={item.status === 'passed' ? 'success' : item.status === 'needs_review' ? 'warn' : 'error'}>
                  {item.status === 'passed' ? '通过' : item.status === 'needs_review' ? '需复核' : '未通过'}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-5 gap-2 text-[10px]">
                <MetricCell label="Recall@K" value={`${(item.recallAtK * 100).toFixed(0)}%`} />
                <MetricCell label="MRR" value={item.mrr.toFixed(2)} />
                <MetricCell label="nDCG" value={item.ndcg.toFixed(2)} />
                <MetricCell label="引用正确" value={`${(item.citationAccuracy * 100).toFixed(0)}%`} />
                <MetricCell label="P95" value={`${item.p95LatencyMs}ms`} />
              </div>
              <div className="mt-3 border-t border-[var(--border)] pt-2 text-[10px] text-[var(--text-muted)]">
                {item.baselineVersion} → {item.evaluatedVersion} · {new Date(item.evaluatedAt).toLocaleString('zh-CN')}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ========== 知识图谱画布（ReactFlow 实现，原 KnowledgeGraphCanvas 同款） ========== */

type GraphEntityLike = import('@qzda/web-types').KnowledgeGraphEntity;
type GraphRelationLike = import('@qzda/web-types').KnowledgeGraphRelation;

const GRAPH_NODE_POSITIONS: Record<string, [number, number]> = {
  'kge-api': [135, 96], 'kge-redis': [368, 125], 'kge-runbook': [600, 96], 'kge-owner': [604, 268], 'kge-cve': [138, 266],
};

const KNOWLEDGE_GRAPH_NODE_TYPES = { knowledgeGraph: KnowledgeGraphNode };

function KnowledgeGraphCanvas({ entities, relations, selectedEntityId, onSelect }: {
  entities: GraphEntityLike[];
  relations: GraphRelationLike[];
  selectedEntityId: string | null;
  onSelect: (id: string) => void;
}) {
  const [activeType, setActiveType] = useState<GraphEntityLike['type'] | 'all'>('all');
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const visibleEntities = activeType === 'all' ? entities : entities.filter((entity) => entity.type === activeType);
  const entityIds = new Set(visibleEntities.map((entity) => entity.id));
  const visibleRelations = relations.filter((relation) => entityIds.has(relation.fromId) && entityIds.has(relation.toId));
  const selectedRelation = relations.find((relation) => relation.id === selectedRelationId);

  useEffect(() => {
    if (!selectedEntityId) return;
    const related = relations.find((relation) => relation.fromId === selectedEntityId || relation.toId === selectedEntityId);
    setSelectedRelationId(related?.id ?? null);
  }, [selectedEntityId, relations]);

  const typeOptions: Array<{ key: GraphEntityLike['type'] | 'all'; label: string }> = [
    { key: 'all', label: '全部实体' },
    { key: 'service', label: '服务' },
    { key: 'asset', label: '资产' },
    { key: 'runbook', label: 'Runbook' },
    { key: 'vulnerability', label: '漏洞' },
    { key: 'owner', label: '责任团队' },
  ];
  const relationFrom = selectedRelation ? entities.find((entity) => entity.id === selectedRelation.fromId) : null;
  const relationTo = selectedRelation ? entities.find((entity) => entity.id === selectedRelation.toId) : null;

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-2">
        <div className="flex flex-wrap gap-1">
          {typeOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => { setActiveType(option.key); setSelectedRelationId(null); }}
              className={cn('rounded-md px-2.5 py-1.5 text-[11px] transition-colors', activeType === option.key ? 'bg-[var(--surface-1)] font-semibold text-[var(--brand)] shadow-[0_1px_2px_rgba(15,23,42,.06)]' : 'text-[var(--text-muted)] hover:bg-[var(--surface-1)]')}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-[var(--text-muted)]">显示 {visibleEntities.length} 个实体 / {visibleRelations.length} 条关系</span>
      </div>

      <KnowledgeGraphCanvasStatic entities={visibleEntities} relations={visibleRelations} selectedEntityId={selectedEntityId} onSelect={onSelect} />

      <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold">关系证据</div>
          <span className="text-[10px] text-[var(--text-muted)]">点击关系查看来源</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {visibleRelations.map((relation) => (
            <button
              key={relation.id}
              type="button"
              onClick={() => setSelectedRelationId(relation.id)}
              className={cn('rounded-md border px-2.5 py-1.5 text-[11px] transition-colors', selectedRelationId === relation.id ? 'border-[var(--brand)]/30 bg-[var(--brand-light)] text-[var(--brand)]' : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--brand)]/30')}
            >
              <span>{entities.find((entity) => entity.id === relation.fromId)?.name}</span>
              <span className="mx-1 text-[var(--text-muted)]">{relation.type}</span>
              <span>{entities.find((entity) => entity.id === relation.toId)?.name}</span>
            </button>
          ))}
        </div>
        {selectedRelation && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-[11px]">
            <strong>{relationFrom?.name} → {relationTo?.name}</strong>
            <span className="text-[var(--text-muted)]">关系：{selectedRelation.type}</span>
            <span className="text-[var(--text-muted)]">来源：{selectedRelation.sourceDocId} · {selectedRelation.sourceVersion}</span>
            <span className="font-mono text-[var(--success)]">置信度 {(selectedRelation.confidence * 100).toFixed(0)}%</span>
          </div>
        )}
      </section>
    </>
  );
}

function KnowledgeGraphCanvasStatic({ entities, relations, selectedEntityId, onSelect }: {
  entities: GraphEntityLike[];
  relations: GraphRelationLike[];
  selectedEntityId: string | null;
  onSelect: (id: string) => void;
}) {
  const initialNodes = useMemo<Node[]>(() => entities.map((entity, index) => {
    const [x, y] = GRAPH_NODE_POSITIONS[entity.id] ?? [80 + (index % 4) * 180, 50 + Math.floor(index / 4) * 130];
    return { id: entity.id, type: 'knowledgeGraph', position: { x, y }, data: { entity } };
  }), [entities]);
  const initialEdges = useMemo<Edge[]>(() => relations.map((relation) => ({
    id: relation.id,
    source: relation.fromId,
    target: relation.toId,
    label: relation.type,
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
    style: { stroke: '#94a3b8', strokeWidth: 1.5 },
    labelStyle: { fill: '#64748b', fontSize: 10 },
    labelBgStyle: { fill: 'var(--surface-1)', fillOpacity: 1 },
    updatable: true,
  })), [relations]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => { setNodes(initialNodes); }, [initialNodes, setNodes]);
  useEffect(() => { setEdges(initialEdges); }, [initialEdges, setEdges]);

  return (
    <div className="knowledge-reactflow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={KNOWLEDGE_GRAPH_NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onSelect(node.id)}
        nodesDraggable
        edgesUpdatable
        elementsSelectable
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={.55}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} size={1} color="#e2e8f0" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function KnowledgeGraphNode({ data, selected }: { data: { entity: GraphEntityLike }; selected: boolean }) {
  const { entity } = data;
  const palette = entity.type === 'asset'
    ? ['#eef2ff', '#818cf8', '#4f46e5']
    : entity.type === 'service'
      ? ['#eff6ff', '#60a5fa', '#2563eb']
      : entity.type === 'runbook'
        ? ['#ecfdf5', '#34d399', '#047857']
        : entity.type === 'vulnerability'
          ? ['#fff7ed', '#fb923c', '#c2410c']
          : ['#f5f3ff', '#a78bfa', '#7c3aed'];
  return (
    <>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-[var(--brand)]" />
      <div
        className="min-w-[130px] rounded-[10px] border px-3 py-2"
        style={{
          borderColor: selected ? '#4f46e5' : palette[1],
          borderWidth: selected ? 2 : 1,
          background: palette[0],
          boxShadow: selected ? '0 0 0 3px rgba(79,70,229,.12)' : '0 1px 2px rgba(15,23,42,.05)',
        }}
      >
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-white/80 text-[10px] font-bold" style={{ color: palette[2] }}>
            {entity.type.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <strong className="block truncate text-[11px] text-[var(--text)]">{entity.name}</strong>
            <small className="block text-[9px] text-[var(--text-muted)]">{entity.type} · {(entity.confidence * 100).toFixed(0)}%</small>
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-[var(--brand)]" />
    </>
  );
}