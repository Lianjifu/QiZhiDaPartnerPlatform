/**
 * WorkflowOrchestratorCanvas — AI 辅助编排会话右侧画布。
 * M06 P1 拆分原因：原 pages/WorkflowOrchestrationSession.tsx 单文件 1057L。
 */
import { useMemo } from 'react';
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, MarkerType } from 'reactflow';
import 'reactflow/dist/style.css';
import { Bell, Cpu, Database, FileText, GitBranch, PlayCircle, RefreshCw, RotateCcw, ShieldCheck, Webhook, Wrench } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import type { WorkflowNodeKind } from '@qzda/web-types';

type WorkflowNode = {
  id: string;
  kind: WorkflowNodeKind | string;
  label: string;
  description?: string;
  position: { x: number; y: number };
  sourceRef?: { docId: string; heading?: string };
};

type SessionCandidate = {
  id: string;
  label: string;
  summary: string;
  createdAt: string;
  nodes: WorkflowNode[];
  edges: Array<{ id: string; source: string; target: string }>;
  risk: 'L1' | 'L2' | 'L3';
  constraints: { riskLevel: 'L1' | 'L2' | 'L3'; requireApproval: boolean; requireAudit: boolean; requireRollback: boolean };
  warnings: string[];
  citations?: Array<{ docId: string; heading?: string; excerpt: string }>;
};

const PREVIEW_NODE_ICONS: Record<string, any> = {
  trigger: PlayCircle, schedule: PlayCircle, event: Bell,
  retrieve: Database, transform: Wrench,
  decision: Cpu, condition: GitBranch, approval: ShieldCheck, policy: ShieldCheck,
  branch: GitBranch, parallel: GitBranch,
  execute: Wrench, http: Webhook, mcp: Cpu, task: FileText,
  retry: RefreshCw, compensate: RotateCcw, audit: FileText, notify: Bell,
};

const PREVIEW_NODE_COLORS: Record<string, string> = {
  trigger: '#3b82f6', schedule: '#3b82f6', event: '#3b82f6',
  retrieve: '#10b981', transform: '#10b981',
  decision: '#8b5cf6', condition: '#8b5cf6', approval: '#f59e0b', policy: '#f59e0b',
  branch: '#06b6d4', parallel: '#06b6d4',
  execute: '#ef4444', http: '#ef4444', mcp: '#ef4444', task: '#ef4444',
  retry: '#f59e0b', compensate: '#f59e0b', audit: '#64748b', notify: '#38bdf8',
};

export const previewNodeTypes = { custom: PreviewFlowNode };

function PreviewFlowNode({ data, selected }: { data: any; selected?: boolean }) {
  const kind = String(data.kind ?? 'task');
  const Icon = PREVIEW_NODE_ICONS[kind] ?? Wrench;
  const color = PREVIEW_NODE_COLORS[kind] ?? '#3b82f6';
  return (
    <div
      className={cn(
        'workflow-node relative min-w-[140px] rounded-md border-2 bg-[var(--surface-1)] px-3 py-2 text-center shadow-sm transition-all',
        selected && 'ring-2 ring-[var(--brand)]',
      )}
      style={{ borderColor: color }}
      title={data.desc || data.sourceRef?.heading || undefined}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-[var(--bg)]" style={{ background: color, left: -7 }} />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-[var(--bg)]" style={{ background: color, right: -7 }} />
      <Icon className="mx-auto h-3.5 w-3.5" style={{ color }} />
      <div className="workflow-node__kind mt-0.5 text-[10px] uppercase tracking-wide opacity-70">{kind}</div>
      <div className="workflow-node__label text-xs font-semibold text-[var(--text)]">{data.label || kind}</div>
      {data.sourceRef?.heading && (
        <div className="mt-1 truncate text-[9px] text-[var(--text-muted)]">§ {data.sourceRef.heading}</div>
      )}
    </div>
  );
}

export function WorkflowOrchestratorCanvas({
  candidates,
  selectedCandidateId,
  onSelectCandidate,
}: {
  candidates: SessionCandidate[];
  selectedCandidateId: string | undefined;
  onSelectCandidate: (id: string) => void;
}) {
  const selected = candidates.find((c) => c.id === selectedCandidateId) ?? candidates[candidates.length - 1];
  const rfNodes = useMemo(
    () => (selected?.nodes ?? []).map((n) => ({ id: n.id, type: 'custom', position: n.position, data: { kind: n.kind, label: n.label, desc: n.description, sourceRef: n.sourceRef } })),
    [selected],
  );
  const rfEdges = useMemo(
    () => (selected?.edges ?? []).map((e) => ({ id: e.id, source: e.source, target: e.target, markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' } })),
    [selected],
  );

  return (
    <div className="wf-orch-canvas flex flex-col h-full" data-testid="wf-orch-canvas">
      <div className="wf-orch-canvas__tabs flex items-center gap-1 border-b border-[var(--border)] px-2 py-1">
        <span className="text-xs text-[var(--text-muted)]">候选版本：</span>
        {candidates.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`wf-tab text-xs ${selectedCandidateId === c.id ? 'is-active' : ''}`}
            onClick={() => onSelectCandidate(c.id)}
          >
            {c.label} · {c.risk}
          </button>
        ))}
        {!candidates.length && <span className="text-xs text-[var(--text-muted)]">尚无候选，发送目标生成</span>}
      </div>
      <div className="wf-orch-canvas__graph flex-1 min-h-0">
        {selected ? (
          <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={previewNodeTypes} fitView>
            <Background gap={16} />
            <MiniMap pannable />
            <Controls />
          </ReactFlow>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">画布预览仅用于示例编排，请先在左侧发送目标</div>
        )}
      </div>
      <div className="wf-orch-canvas__detail border-t border-[var(--border)] px-2 py-1 text-xs">
        {selected ? (
          <>
              <div><span className="text-[var(--text-muted)]">版本：</span>{selected.label}</div>
              <div className="text-[var(--text-muted)]">{selected.summary}</div>
              {selected.warnings.length > 0 && <div className="text-amber-500">警告 {selected.warnings.length} 项</div>}
              {selected.citations?.length ? <div className="text-emerald-500">已引用 {selected.citations.length} 处文档章节</div> : null}
            </>
          ) : null}
      </div>
    </div>
  );
}