/**
 * AI 辅助编排会话页（独立全屏）
 * P0: 上传 MD / 多轮修正 / 生成示例 / 沉淀知识 / 隔离草稿
 * P1: 流式回复、候选版本切换、结构化 patch、章节引用
 * P2: 引用知识文档、Runbook 检索工具、模版候选审批
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  AlertTriangle, ArrowLeft, Bell, BookPlus, ChevronDown, ChevronUp, Clock, Cpu, Database,
  FileText, GitBranch, Library, Loader2, PlayCircle, RefreshCw, RotateCcw, Search, Send,
  ShieldCheck, Sparkles, Trash2, Upload, Layers, Webhook, Wrench,
} from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { WorkflowNodeKind } from '@qzda/web-types';
import { getApiClient } from '@qzda/web-api';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';

const PREVIEW_NODE_ICONS: Record<string, any> = {
  trigger: PlayCircle, schedule: Clock, event: Bell,
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

const previewNodeTypes = { custom: PreviewFlowNode };

type SessionConstraints = {
  riskLevel: 'L1' | 'L2' | 'L3';
  requireApproval: boolean;
  requireAudit: boolean;
  requireRollback: boolean;
};

type DocSection = { id: string; heading: string; level: number; excerpt: string };

type SessionDocument = {
  id: string;
  fileName: string;
  title: string;
  content?: string;
  contentHash: string;
  charCount: number;
  summary: string;
  headings: string[];
  sections?: DocSection[];
  source?: 'upload' | 'knowledge';
  knowledgeDocId?: string;
  depositedKnowledgeDocId?: string;
  createdAt: string;
};

type SessionMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  kind?: 'chat' | 'clarify' | 'generate' | 'patch' | 'retrieve' | 'template';
  status?: 'streaming' | 'completed';
  streamChunks?: string[];
  modelInvocation?: {
    provider: string;
    model: string;
    mode: string;
    latencyMs: number;
    promptDigest: string;
    toolsUsed?: Array<{ name: string; input: string; output: string }>;
  };
};

type WorkflowNode = {
  id: string;
  kind: string;
  label: string;
  description?: string;
  position?: { x: number; y: number };
  sourceRef?: { documentId: string; heading: string; excerpt?: string };
};

type SessionCandidate = {
  id: string;
  version: number;
  label: string;
  createdAt: string;
  workflow: { nodes: WorkflowNode[]; edges: Array<{ id: string; source: string; target: string }> };
  checks: { structure: 'passed' | 'review'; dependencies: 'passed' | 'review'; risk: 'passed' | 'review' };
  dependencies: Array<{ type: 'tool' | 'mcp' | 'agent'; name: string; status: 'available' | 'missing'; reason?: string }>;
  risks: Array<{ level: string; node: string; text: string }>;
  warnings: string[];
  qualityScore: number;
  requiresReview: boolean;
  changeSummary: string[];
};

type TemplateCandidate = {
  id: string;
  name: string;
  description: string;
  status: 'pending_approval' | 'approved' | 'rejected';
  requestedAt: string;
};

type OrchestrationSession = {
  id: string;
  title: string;
  status: 'drafting' | 'ready' | 'applied' | 'discarded' | 'expired';
  model: string;
  policyVersion: string;
  constraints: SessionConstraints;
  goal: string;
  documents: SessionDocument[];
  messages: SessionMessage[];
  candidates: SessionCandidate[];
  activeCandidateId?: string;
  appliedRevisionId?: string;
  templateCandidate?: TemplateCandidate;
  lastRetrieve?: { query: string; hits: Array<{ docId: string; title: string; excerpt: string; score: number }>; at: string };
  clarificationSkipped: boolean;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

type StreamPayload = { messageId: string; chunks: string[]; finalContent: string };
type KnowledgeDocLite = { id: string; title: string; source: string; status: string; updatedAt: string };

const DEFAULT_GOAL = '当生产 Redis 触发 OOM 告警时，由工作伙伴研判处置路径，经双重审批后执行受控恢复，写入审计并通知值班负责人';

function dependencyTypeLabel(type: SessionCandidate['dependencies'][number]['type']) {
  if (type === 'agent') return '数字伙伴';
  if (type === 'mcp') return 'MCP';
  return '工具';
}

/** mock 会原地修改会话对象；写入 React state 前必须断开引用，否则右侧候选不会刷新。 */
function adoptSession(next: OrchestrationSession): OrchestrationSession {
  return {
    ...next,
    constraints: { ...next.constraints },
    documents: next.documents.map((doc) => ({ ...doc, headings: [...(doc.headings ?? [])], sections: doc.sections?.map((section) => ({ ...section })) })),
    messages: next.messages.map((message) => ({
      ...message,
      streamChunks: message.streamChunks ? [...message.streamChunks] : undefined,
      modelInvocation: message.modelInvocation
        ? { ...message.modelInvocation, toolsUsed: message.modelInvocation.toolsUsed?.map((tool) => ({ ...tool })) }
        : undefined,
    })),
    candidates: next.candidates.map((candidate) => ({
      ...candidate,
      changeSummary: [...candidate.changeSummary],
      warnings: [...candidate.warnings],
      risks: candidate.risks.map((risk) => ({ ...risk })),
      dependencies: candidate.dependencies.map((dep) => ({ ...dep })),
      checks: { ...candidate.checks },
      workflow: {
        nodes: candidate.workflow.nodes.map((node) => ({
          ...node,
          position: node.position ? { ...node.position } : undefined,
          sourceRef: node.sourceRef ? { ...node.sourceRef } : undefined,
        })),
        edges: candidate.workflow.edges.map((edge) => ({ ...edge })),
      },
    })),
    templateCandidate: next.templateCandidate ? { ...next.templateCandidate } : undefined,
    lastRetrieve: next.lastRetrieve
      ? { ...next.lastRetrieve, hits: next.lastRetrieve.hits.map((hit) => ({ ...hit })) }
      : undefined,
  };
}

export default function WorkflowOrchestrationSessionPage() {
  const navigate = useNavigate();
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId ?? 'w1');
  const canWrite = useAuthStore((state) => state.user?.permissions?.includes('workflow.write') ?? true);

  const [session, setSession] = useState<OrchestrationSession | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [goalDraft, setGoalDraft] = useState(DEFAULT_GOAL);
  const [composer, setComposer] = useState('');
  const [model, setModel] = useState('企业默认模型');
  const [constraints, setConstraints] = useState<SessionConstraints>({
    riskLevel: 'L2',
    requireApproval: true,
    requireAudit: true,
    requireRollback: true,
  });
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' | 'info' } | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState<Record<string, string>>({});
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [selectedPreviewNodeId, setSelectedPreviewNodeId] = useState<string | null>(null);
  const [leftPaneRatio, setLeftPaneRatio] = useState(() => {
    if (typeof window === 'undefined') return 0.46;
    const saved = Number(window.localStorage.getItem('orch-session-left-ratio'));
    return Number.isFinite(saved) && saved >= 0.28 && saved <= 0.72 ? saved : 0.46;
  });
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const createInflightRef = useRef<Promise<OrchestrationSession> | null>(null);
  const streamTimersRef = useRef<number[]>([]);

  const showToast = useCallback((msg: string, tone: 'success' | 'error' | 'info' = 'info') => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 2400);
  }, []);

  const playStream = useCallback((stream?: StreamPayload) => {
    if (!stream?.chunks?.length) return;
    streamTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    streamTimersRef.current = [];
    setStreamingText((prev) => ({ ...prev, [stream.messageId]: '' }));
    let acc = '';
    stream.chunks.forEach((chunk, index) => {
      const timer = window.setTimeout(() => {
        acc += chunk;
        setStreamingText((prev) => ({ ...prev, [stream.messageId]: acc }));
        if (index === stream.chunks.length - 1) {
          setStreamingText((prev) => {
            const next = { ...prev };
            delete next[stream.messageId];
            return next;
          });
        }
      }, 80 * (index + 1));
      streamTimersRef.current.push(timer);
    });
  }, []);

  useEffect(() => () => {
    streamTimersRef.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const { data: remoteSession, isLoading: loadingRemote, isError: remoteError, error: remoteQueryError } = useApiQuery<OrchestrationSession>(
    ['orchestration-session', routeSessionId],
    `/api/workflows/orchestration-sessions/${routeSessionId}`,
    undefined,
    { enabled: Boolean(routeSessionId), retry: 1 },
  );

  const { data: knowledgeDocs = [] } = useApiQuery<KnowledgeDocLite[]>(['knowledge-docs-orch'], '/api/knowledge/docs');

  const createSessionApi = useApiMutation<OrchestrationSession, {
    title: string;
    goal: string;
    model: string;
    workspaceId: string;
    constraints: SessionConstraints;
  }>('/api/workflows/orchestration-sessions');

  const patchSessionApi = useApiMutation<OrchestrationSession, Record<string, unknown>>(
    () => `/api/workflows/orchestration-sessions/${session?.id}`,
    undefined,
    'PATCH',
  );

  const uploadDocumentApi = useApiMutation<{ session: OrchestrationSession; document: SessionDocument }, { fileName?: string; content?: string; knowledgeDocId?: string }>(
    () => `/api/workflows/orchestration-sessions/${session?.id}/documents`,
  );

  const sendMessageApi = useApiMutation<{ session: OrchestrationSession; stream: StreamPayload }, { content: string; mode?: 'chat' | 'clarify'; stream?: boolean }>(
    () => `/api/workflows/orchestration-sessions/${session?.id}/messages`,
  );

  const generateApi = useApiMutation<{ session: OrchestrationSession; stream: StreamPayload }, { skipClarification?: boolean; note?: string; stream?: boolean }>(
    () => `/api/workflows/orchestration-sessions/${session?.id}/generate`,
  );

  const applyApi = useApiMutation<OrchestrationSession & { revisionId: string }, { candidateId?: string }>(
    () => `/api/workflows/orchestration-sessions/${session?.id}/apply`,
  );

  const discardApi = useApiMutation<OrchestrationSession, Record<string, never>>(
    () => `/api/workflows/orchestration-sessions/${session?.id}/discard`,
  );

  const depositApi = useApiMutation<{ knowledgeDoc: { id: string; title: string }; alreadyDeposited?: boolean }, { documentId: string }>(
    (vars) => `/api/workflows/orchestration-sessions/${session?.id}/documents/${vars.documentId}/deposit-knowledge`,
  );

  const activateCandidateApi = useApiMutation<OrchestrationSession, { candidateId: string }>(
    (vars) => `/api/workflows/orchestration-sessions/${session?.id}/candidates/${vars.candidateId}/activate`,
  );

  const patchCandidateApi = useApiMutation<{ session: OrchestrationSession }, { candidateId: string; removeNodeId?: string; rename?: { nodeId: string; label: string }; move?: { nodeId: string; direction: 'up' | 'down' } }>(
    (vars) => `/api/workflows/orchestration-sessions/${session?.id}/candidates/${vars.candidateId}/patch`,
  );

  const retrieveApi = useApiMutation<{ session: OrchestrationSession; stream: StreamPayload }, { query?: string }>(
    () => `/api/workflows/orchestration-sessions/${session?.id}/retrieve-runbook`,
  );

  const proposeTemplateApi = useApiMutation<{ session: OrchestrationSession; templateCandidate: TemplateCandidate }, { name?: string; description?: string }>(
    () => `/api/workflows/orchestration-sessions/${session?.id}/propose-template`,
  );

  useEffect(() => {
    if (routeSessionId) return;
    let cancelled = false;
    const run = async () => {
      try {
        if (!createInflightRef.current) {
          createInflightRef.current = createSessionApi.mutateAsync({
            title: 'AI 辅助编排会话',
            goal: DEFAULT_GOAL,
            model: '企业默认模型',
            workspaceId: currentWorkspaceId,
            constraints: { riskLevel: 'L2', requireApproval: true, requireAudit: true, requireRollback: true },
          }).catch((error) => {
            createInflightRef.current = null;
            throw error;
          });
        }
        const created = await createInflightRef.current;
        if (cancelled) return;
        setSession(adoptSession(created));
        setBootstrapError(null);
        setBootstrapping(false);
        navigate(`/workflows/orchestration/${created.id}`, { replace: true });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : '创建编排会话失败';
        setBootstrapError(message);
        setBootstrapping(false);
        showToast(message, 'error');
      }
    };
    void run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSessionId, currentWorkspaceId, navigate, showToast]);

  useEffect(() => {
    if (!routeSessionId) return;
    if (remoteSession) {
      setSession(adoptSession(remoteSession));
      setGoalDraft(remoteSession.goal || DEFAULT_GOAL);
      setModel(remoteSession.model);
      setConstraints(remoteSession.constraints);
      setBootstrapError(null);
      setBootstrapping(false);
      return;
    }
    if (!loadingRemote && remoteError) {
      const message = remoteQueryError instanceof Error ? remoteQueryError.message : '无法加载编排会话';
      setBootstrapError(message);
      setBootstrapping(false);
    }
  }, [routeSessionId, remoteSession, loadingRemote, remoteError, remoteQueryError]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages.length, streamingText]);

  const activeCandidate = useMemo(() => {
    if (!session?.candidates?.length) return null;
    return session.candidates.find((item) => item.id === session.activeCandidateId) ?? session.candidates[0] ?? null;
  }, [session?.activeCandidateId, session?.candidates, session?.updatedAt]);

  useEffect(() => {
    setSelectedPreviewNodeId(null);
    setEditingNodeId(null);
  }, [activeCandidate?.id]);

  const previewFlow = useMemo(() => {
    if (!activeCandidate) return { nodes: [] as Node[], edges: [] as Edge[] };
    const nodes: Node[] = activeCandidate.workflow.nodes.map((node, index) => ({
      id: node.id,
      type: 'custom',
      position: node.position ?? { x: 40 + (index % 4) * 200, y: 48 + Math.floor(index / 4) * 120 },
      data: {
        kind: node.kind as WorkflowNodeKind,
        label: node.label,
        desc: node.description,
        sourceRef: node.sourceRef,
      },
      selected: node.id === selectedPreviewNodeId,
    }));
    const edges: Edge[] = activeCandidate.workflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      style: { stroke: 'var(--border-strong)', strokeWidth: 1.5 },
    }));
    return { nodes, edges };
  }, [activeCandidate, selectedPreviewNodeId]);

  const selectedPreviewNode = useMemo(
    () => activeCandidate?.workflow.nodes.find((node) => node.id === selectedPreviewNodeId) ?? null,
    [activeCandidate, selectedPreviewNodeId],
  );

  const onPreviewNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedPreviewNodeId(node.id);
    setEditingNodeId(null);
  }, []);

  const onSplitPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setIsDraggingSplit(true);
    event.currentTarget.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      const next = (moveEvent.clientX - rect.left) / rect.width;
      const clamped = Math.min(0.72, Math.max(0.28, next));
      setLeftPaneRatio(clamped);
    };
    const onUp = (upEvent: PointerEvent) => {
      setIsDraggingSplit(false);
      try { event.currentTarget.releasePointerCapture(upEvent.pointerId); } catch { /* ignore */ }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLeftPaneRatio((current) => {
        window.localStorage.setItem('orch-session-left-ratio', String(current));
        return current;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  const readyKnowledgeDocs = useMemo(
    () => knowledgeDocs.filter((doc) => doc.status === 'ready' && !session?.documents.some((item) => item.knowledgeDocId === doc.id)),
    [knowledgeDocs, session?.documents],
  );

  const busy = uploadDocumentApi.isPending || sendMessageApi.isPending || generateApi.isPending || applyApi.isPending
    || depositApi.isPending || activateCandidateApi.isPending || patchCandidateApi.isPending || retrieveApi.isPending || proposeTemplateApi.isPending;

  const syncGoal = useCallback(async () => {
    if (!session || !canWrite) return;
    const next = goalDraft.trim();
    if (next === session.goal && model === session.model
      && constraints.requireApproval === session.constraints.requireApproval
      && constraints.requireRollback === session.constraints.requireRollback
      && constraints.riskLevel === session.constraints.riskLevel) return;
    const updated = await patchSessionApi.mutateAsync({ goal: next, model, constraints });
    setSession(adoptSession(updated));
  }, [canWrite, constraints, goalDraft, model, patchSessionApi, session]);

  const onUploadMarkdown = useCallback(async (file: File | null) => {
    if (!file || !session || !canWrite) return;
    if (!/\.md$/i.test(file.name) && !/\.markdown$/i.test(file.name)) {
      showToast('仅支持 Markdown（.md）文件', 'error');
      return;
    }
    const content = await file.text();
    try {
      const result = await uploadDocumentApi.mutateAsync({ fileName: file.name, content });
      setSession(adoptSession(result.session));
      showToast(`已解析 ${result.document.title}`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '上传失败', 'error');
    }
  }, [canWrite, session, showToast, uploadDocumentApi]);

  const onAttachKnowledge = useCallback(async (knowledgeDocId: string) => {
    if (!session || !canWrite) return;
    try {
      const result = await uploadDocumentApi.mutateAsync({ knowledgeDocId });
      setSession(adoptSession(result.session));
      setKbPickerOpen(false);
      showToast(`已引用知识文档 ${result.document.title}`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '引用失败', 'error');
    }
  }, [canWrite, session, showToast, uploadDocumentApi]);

  const onSend = useCallback(async (mode: 'chat' | 'clarify' = 'chat') => {
    if (!session || !canWrite || !composer.trim()) return;
    await syncGoal();
    try {
      const result = await sendMessageApi.mutateAsync({ content: composer.trim(), mode, stream: true });
      setSession(adoptSession(result.session));
      setComposer('');
      playStream(result.stream);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '发送失败', 'error');
    }
  }, [canWrite, composer, playStream, sendMessageApi, session, showToast, syncGoal]);

  const onGenerate = useCallback(async (skipClarification: boolean) => {
    if (!session || !canWrite) return;
    await syncGoal();
    try {
      const result = await generateApi.mutateAsync({ skipClarification, note: composer.trim() || undefined, stream: true });
      setSession(adoptSession(result.session));
      setComposer('');
      playStream(result.stream);
      showToast('已生成可编辑草稿示例，请专家复核', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '生成失败', 'error');
    }
  }, [canWrite, composer, generateApi, playStream, session, showToast, syncGoal]);

  const onRetrieve = useCallback(async () => {
    if (!session || !canWrite) return;
    await syncGoal();
    try {
      const result = await retrieveApi.mutateAsync({ query: goalDraft.trim() || session.goal });
      setSession(adoptSession(result.session));
      playStream(result.stream);
      showToast('已完成 Runbook 检索', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '检索失败', 'error');
    }
  }, [canWrite, goalDraft, playStream, retrieveApi, session, showToast, syncGoal]);

  const onDeposit = useCallback(async (documentId: string) => {
    if (!session || !canWrite) return;
    try {
      const result = await depositApi.mutateAsync({ documentId });
      const refreshed = await getApiClient().request<OrchestrationSession>(`/api/workflows/orchestration-sessions/${session.id}`);
      setSession(adoptSession(refreshed));
      showToast(result.alreadyDeposited ? '该文档已沉淀过知识中心' : `已沉淀「${result.knowledgeDoc.title}」到知识中心`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '沉淀失败', 'error');
    }
  }, [canWrite, depositApi, session, showToast]);

  const onActivateCandidate = useCallback(async (candidateId: string) => {
    if (!session || !canWrite) return;
    try {
      const updated = await activateCandidateApi.mutateAsync({ candidateId });
      setSession(adoptSession(updated));
    } catch (error) {
      showToast(error instanceof Error ? error.message : '切换失败', 'error');
    }
  }, [activateCandidateApi, canWrite, session, showToast]);

  const onPatchCandidate = useCallback(async (patch: { removeNodeId?: string; rename?: { nodeId: string; label: string }; move?: { nodeId: string; direction: 'up' | 'down' } }) => {
    if (!session || !canWrite || !activeCandidate) return;
    try {
      const result = await patchCandidateApi.mutateAsync({ candidateId: activeCandidate.id, ...patch });
      setSession(adoptSession(result.session));
      setEditingNodeId(null);
      showToast('已生成新的草稿示例版本', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '调整失败', 'error');
    }
  }, [activeCandidate, canWrite, patchCandidateApi, session, showToast]);

  const onProposeTemplate = useCallback(async () => {
    if (!session || !canWrite || !activeCandidate) return;
    try {
      const result = await proposeTemplateApi.mutateAsync({
        name: `${session.title || '编排会话'} · 模版候选`,
        description: session.goal,
      });
      setSession(adoptSession(result.session));
      showToast('已提交模版候选，等待审批', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '提交失败', 'error');
    }
  }, [activeCandidate, canWrite, proposeTemplateApi, session, showToast]);

  const onApply = useCallback(async () => {
    if (!session || !canWrite || !activeCandidate) return;
    try {
      const applied = await applyApi.mutateAsync({ candidateId: activeCandidate.id });
      setSession(adoptSession(applied));
      showToast(`已创建隔离草稿 ${applied.revisionId}，专家复核后可发布为流程技能供数字伙伴装配`, 'success');
      navigate('/workflows');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '应用失败', 'error');
    }
  }, [activeCandidate, applyApi, canWrite, navigate, session, showToast]);

  const onDiscard = useCallback(async () => {
    if (!session) return;
    if (!window.confirm('确定放弃当前编排会话？未应用的草稿示例将不可再应用。')) return;
    await discardApi.mutateAsync({});
    navigate('/workflows');
  }, [discardApi, navigate, session]);

  if (bootstrapping || (routeSessionId && loadingRemote && !session)) {
    return (
      <div className="grid h-full place-items-center text-sm text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />正在打开编排会话…</span>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="grid h-full place-items-center gap-3 px-6 text-center text-sm">
        <div className="text-[var(--text)]">{bootstrapError ?? '编排会话不可用'}</div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={() => navigate('/workflows')}>返回工作流</Button>
          <Button
            variant="primary"
            onClick={() => {
              createInflightRef.current = null;
              setBootstrapError(null);
              setBootstrapping(true);
              navigate('/workflows/orchestration', { replace: true });
            }}
          >
            重新打开
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      {toast && (
        <div className={cn(
          'fixed right-4 top-20 z-50 rounded-lg px-3 py-2 text-xs shadow-lg',
          toast.tone === 'success' && 'bg-[var(--success)] text-white',
          toast.tone === 'error' && 'bg-[var(--danger)] text-white',
          toast.tone === 'info' && 'bg-[var(--info)] text-white',
        )}
        >
          {toast.msg}
        </div>
      )}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 md:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/workflows" className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
              <ArrowLeft className="h-3.5 w-3.5" />工作流
            </Link>
            <span className="text-[var(--text-muted)]">/</span>
            <h1 className="text-sm font-semibold text-[var(--text)]">AI 辅助编排会话</h1>
            <Badge tone={session.status === 'ready' ? 'success' : 'neutral'} className="text-[10px]">{session.status === 'ready' ? '示例已就绪' : '起草中'}</Badge>
            {session.templateCandidate && <Badge tone="warn" className="text-[10px]">模版候选 · {session.templateCandidate.status === 'pending_approval' ? '待审批' : session.templateCandidate.status}</Badge>}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
            澄清完全可选 · 流式模型回复 · 章节引用 · Runbook 检索 · 模版候选需审批；不会自动执行、发布或覆盖线上流程。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void onProposeTemplate()} disabled={!canWrite || busy || !activeCandidate || session.templateCandidate?.status === 'pending_approval'}>
            <Layers className="h-3.5 w-3.5" />沉淀模版候选
          </Button>
          <Button size="sm" variant="ghost" onClick={onDiscard} disabled={busy}>放弃会话</Button>
          <Button size="sm" variant="primary" onClick={onApply} disabled={!canWrite || busy || !activeCandidate || session.status === 'applied'}>
            创建隔离草稿
          </Button>
        </div>
      </header>

      <div
        ref={splitContainerRef}
        className={cn('flex min-h-0 flex-1 flex-col lg:flex-row', isDraggingSplit && 'select-none')}
        style={{ ['--orch-left-pane' as string]: `${Math.round(leftPaneRatio * 1000) / 10}%` }}
      >
        <section className="flex min-h-0 min-w-0 flex-col border-b border-[var(--border)] w-full lg:w-[var(--orch-left-pane)] lg:border-b-0">
          <div className="shrink-0 space-y-3 border-b border-[var(--border)] p-4">
            <label className="block text-xs font-semibold text-[var(--text)]">
              业务目标
              <textarea
                value={goalDraft}
                onChange={(event) => setGoalDraft(event.target.value)}
                onBlur={() => { void syncGoal(); }}
                rows={3}
                disabled={!canWrite || busy}
                className="mt-1.5 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm leading-6 text-[var(--text)] outline-none focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_var(--brand-light)]"
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-[var(--text-secondary)]">
                风险等级
                <select
                  value={constraints.riskLevel}
                  onChange={(event) => setConstraints((prev) => ({ ...prev, riskLevel: event.target.value as SessionConstraints['riskLevel'] }))}
                  onBlur={() => { void syncGoal(); }}
                  className="mt-1 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs"
                >
                  <option value="L1">L1 · 低风险</option>
                  <option value="L2">L2 · 受控操作</option>
                  <option value="L3">L3 · 高风险</option>
                </select>
              </label>
              <label className="text-xs text-[var(--text-secondary)]">
                生成模型
                <select
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  onBlur={() => { void syncGoal(); }}
                  className="mt-1 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs"
                >
                  <option>企业默认模型</option>
                  <option>Qwen-Enterprise</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setConstraints((prev) => ({ ...prev, requireApproval: !prev.requireApproval }))} className={cn('rounded-md border px-2.5 py-1.5 text-[11px]', constraints.requireApproval ? 'border-[var(--brand)] bg-[var(--brand-light)] text-[var(--brand)]' : 'border-[var(--border)] text-[var(--text-muted)]')}>需要双重审批</button>
              <button type="button" onClick={() => setConstraints((prev) => ({ ...prev, requireRollback: !prev.requireRollback }))} className={cn('rounded-md border px-2.5 py-1.5 text-[11px]', constraints.requireRollback ? 'border-[var(--brand)] bg-[var(--brand-light)] text-[var(--brand)]' : 'border-[var(--border)] text-[var(--text-muted)]')}>支持回滚</button>
              <span className="inline-flex items-center gap-1 rounded-md border border-[var(--success)]/30 bg-[var(--success-bg)] px-2.5 py-1.5 text-[11px] text-[var(--success)]"><ShieldCheck className="h-3.5 w-3.5" />审计留痕（策略强制）</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileInputRef} type="file" accept=".md,.markdown,text/markdown" className="hidden" onChange={(event) => { void onUploadMarkdown(event.target.files?.[0] ?? null); event.target.value = ''; }} />
              <Button size="sm" variant="outline" disabled={!canWrite || busy} onClick={() => fileInputRef.current?.click()}><Upload className="h-3.5 w-3.5" />上传 Markdown</Button>
              <Button size="sm" variant="outline" disabled={!canWrite || busy} onClick={() => setKbPickerOpen((open) => !open)}><Library className="h-3.5 w-3.5" />引用知识文档</Button>
              <Button size="sm" variant="outline" disabled={!canWrite || busy} onClick={() => void onRetrieve()}><Search className="h-3.5 w-3.5" />Runbook 检索</Button>
              <Button size="sm" variant="primary" disabled={!canWrite || busy} onClick={() => void onGenerate(true)}><Sparkles className="h-3.5 w-3.5" />一键生成示例</Button>
            </div>
            {kbPickerOpen && (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-2">
                {readyKnowledgeDocs.length === 0 ? (
                  <div className="px-2 py-3 text-[11px] text-[var(--text-muted)]">当前工作区暂无更多可引用的就绪知识文档</div>
                ) : readyKnowledgeDocs.map((doc) => (
                  <button key={doc.id} type="button" className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--bg-hover)]" onClick={() => void onAttachKnowledge(doc.id)}>
                    <span className="truncate text-[var(--text-secondary)]">{doc.title}</span>
                    <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{doc.source}</span>
                  </button>
                ))}
              </div>
            )}
            {session.documents.length > 0 && (
              <div className="space-y-2">
                {session.documents.map((doc) => (
                  <div key={doc.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text)]">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
                          <span className="truncate">{doc.title}</span>
                          <Badge tone="neutral" className="text-[10px]">{doc.source === 'knowledge' ? '知识中心' : '上传'}</Badge>
                        </div>
                        <div className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">{doc.summary}</div>
                        {(doc.sections?.length || doc.headings?.length) ? (
                          <div className="mt-1 text-[10px] text-[var(--text-muted)]">章节 · {(doc.sections ?? doc.headings.map((heading) => ({ heading }))).slice(0, 4).map((section) => ('heading' in section ? section.heading : section)).join(' / ')}</div>
                        ) : null}
                      </div>
                      {doc.source !== 'knowledge' && (
                        <Button size="sm" variant="ghost" className="shrink-0" disabled={!canWrite || busy} onClick={() => void onDeposit(doc.id)}>
                          <BookPlus className="h-3.5 w-3.5" />{doc.depositedKnowledgeDocId ? '已沉淀' : '沉淀知识中心'}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {session.lastRetrieve && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
                最近检索「{session.lastRetrieve.query}」· 命中 {session.lastRetrieve.hits.length} 条
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {session.messages.map((message) => {
              const display = streamingText[message.id] ?? message.content;
              return (
                <div
                  key={message.id}
                  className={cn(
                    'max-w-[92%] rounded-lg px-3 py-2 text-xs leading-5',
                    message.role === 'user' && 'ml-auto bg-[var(--brand)] text-white',
                    message.role === 'assistant' && 'bg-[var(--surface-1)] text-[var(--text-secondary)] ring-1 ring-[var(--border)]',
                    message.role === 'system' && 'mx-auto bg-[var(--info-bg)] text-[var(--info)]',
                  )}
                >
                  <div className="whitespace-pre-wrap">{display}{streamingText[message.id] != null ? '▍' : ''}</div>
                  {message.modelInvocation && (
                    <div className="mt-1.5 space-y-1 text-[10px] opacity-80">
                      <div>模型 · {message.modelInvocation.model} · {message.modelInvocation.latencyMs}ms · {message.modelInvocation.promptDigest.slice(0, 18)}</div>
                      {message.modelInvocation.toolsUsed?.map((tool) => (
                        <div key={`${tool.name}-${tool.input}`}>工具 · {tool.name}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>

          <div className="shrink-0 border-t border-[var(--border)] p-4">
            <div className="flex gap-2">
              <textarea
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                rows={2}
                placeholder="补充触发条件、审批、回滚或通知对象；也可先点「一键生成示例」"
                disabled={!canWrite || busy}
                className="min-h-[64px] flex-1 resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void onSend('chat');
                  }
                }}
              />
              <div className="flex flex-col gap-2">
                <Button size="sm" variant="outline" disabled={!canWrite || busy || !composer.trim()} onClick={() => void onSend('clarify')}>可选澄清</Button>
                <Button size="sm" variant="primary" disabled={!canWrite || busy || !composer.trim()} onClick={() => void onSend('chat')}><Send className="h-3.5 w-3.5" />发送</Button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!canWrite || busy} onClick={() => void onGenerate(false)}>按对话更新示例</Button>
            </div>
          </div>
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整左右区域宽度"
          aria-valuemin={28}
          aria-valuemax={72}
          aria-valuenow={Math.round(leftPaneRatio * 100)}
          tabIndex={0}
          onPointerDown={onSplitPointerDown}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              setLeftPaneRatio((current) => {
                const next = Math.max(0.28, current - 0.02);
                window.localStorage.setItem('orch-session-left-ratio', String(next));
                return next;
              });
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              setLeftPaneRatio((current) => {
                const next = Math.min(0.72, current + 0.02);
                window.localStorage.setItem('orch-session-left-ratio', String(next));
                return next;
              });
            }
          }}
          className={cn(
            'group relative hidden w-1.5 shrink-0 cursor-col-resize touch-none items-stretch justify-center lg:flex',
            'bg-[var(--border)] hover:bg-[var(--brand)]/40',
            isDraggingSplit && 'bg-[var(--brand)]',
          )}
        >
          <span className="absolute inset-y-0 -left-1 -right-1" />
          <span className={cn(
            'my-auto h-10 w-1 rounded-full bg-[var(--text-muted)]/35 transition-colors',
            'group-hover:bg-[var(--brand)]',
            isDraggingSplit && 'bg-[var(--brand)]',
          )}
          />
        </div>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-elevated)]">
          {!activeCandidate ? (
            <div className="grid flex-1 place-items-center px-6 py-16 text-center">
              <div>
                <Sparkles className="mx-auto h-8 w-8 text-[var(--brand)]" />
                <div className="mt-3 text-sm font-semibold text-[var(--text)]">草稿示例区</div>
                <p className="mt-2 max-w-sm text-xs leading-5 text-[var(--text-muted)]">
                  生成后将以与编排画布相同的节点样式展示，可点选节点微调后再创建隔离草稿。
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="shrink-0 space-y-2 border-b border-[var(--border)] bg-[var(--surface-1)] px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text)]">{activeCandidate.label} · 画布预览</div>
                    <div className="mt-1 text-[11px] text-[var(--text-muted)]">模型 · {session.model} · 策略 · {session.policyVersion} · {activeCandidate.workflow.nodes.length} 节点 / {activeCandidate.workflow.edges.length} 连线</div>
                    {session.clarificationSkipped && <div className="mt-1 text-[10px] text-[var(--warning)]">已跳过澄清，直接生成示例</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-xl font-semibold text-[var(--brand)]">{activeCandidate.qualityScore}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">质量评分</div>
                    </div>
                  </div>
                </div>
                {session.candidates.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {session.candidates.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => void onActivateCandidate(candidate.id)}
                        className={cn(
                          'rounded-md border px-2.5 py-1 text-[11px]',
                          candidate.id === activeCandidate.id
                            ? 'border-[var(--brand)] bg-[var(--brand-light)] text-[var(--brand)]'
                            : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]',
                        )}
                      >
                        {candidate.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-3">
                  {([['structure', '结构校验'], ['dependencies', '依赖检查'], ['risk', '风险扫描']] as const).map(([key, label]) => (
                    <div key={key} className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5">
                      <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
                      <div className={cn('text-[11px] font-semibold', activeCandidate.checks[key] === 'passed' ? 'text-[var(--success)]' : 'text-[var(--warning)]')}>
                        {activeCandidate.checks[key] === 'passed' ? '通过' : '需要专家复核'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative min-h-0 flex-1">
                <ReactFlowProvider>
                  <ReactFlow
                    key={activeCandidate.id}
                    nodes={previewFlow.nodes}
                    edges={previewFlow.edges}
                    nodeTypes={previewNodeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.2 }}
                    proOptions={{ hideAttribution: true }}
                    onNodeClick={onPreviewNodeClick}
                    onPaneClick={() => { setSelectedPreviewNodeId(null); setEditingNodeId(null); }}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable
                    panOnDrag
                    zoomOnScroll
                    minZoom={0.35}
                    maxZoom={1.6}
                    defaultEdgeOptions={{ type: 'smoothstep' }}
                  >
                    <Background gap={20} size={1} color="var(--border-strong)" />
                    <Controls position="bottom-right" showInteractive={false} />
                    <MiniMap
                      position="top-right"
                      nodeColor={(node) => PREVIEW_NODE_COLORS[String((node.data as any)?.kind)] ?? '#3b82f6'}
                      maskColor="rgba(15,21,37,0.55)"
                      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
                    />
                  </ReactFlow>
                </ReactFlowProvider>
              </div>

              <div className="shrink-0 space-y-2 border-t border-[var(--border)] bg-[var(--surface-1)] px-4 py-3">
                {selectedPreviewNode ? (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {editingNodeId === selectedPreviewNode.id ? (
                          <div className="flex gap-1">
                            <input value={editingLabel} onChange={(event) => setEditingLabel(event.target.value)} className="h-8 flex-1 rounded border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs" />
                            <Button size="sm" variant="primary" onClick={() => void onPatchCandidate({ rename: { nodeId: selectedPreviewNode.id, label: editingLabel } })}>保存</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingNodeId(null)}>取消</Button>
                          </div>
                        ) : (
                          <button type="button" className="text-left text-sm font-semibold text-[var(--text)] hover:underline" onClick={() => { setEditingNodeId(selectedPreviewNode.id); setEditingLabel(selectedPreviewNode.label); }}>
                            {selectedPreviewNode.label}
                          </button>
                        )}
                        <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                          {selectedPreviewNode.kind}
                          {selectedPreviewNode.sourceRef ? ` · 依据 § ${selectedPreviewNode.sourceRef.heading}` : ''}
                        </div>
                        {selectedPreviewNode.description && <div className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">{selectedPreviewNode.description}</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button size="sm" variant="ghost" disabled={!canWrite || busy} onClick={() => void onPatchCandidate({ move: { nodeId: selectedPreviewNode.id, direction: 'up' } })} aria-label="上移"><ChevronUp className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" disabled={!canWrite || busy} onClick={() => void onPatchCandidate({ move: { nodeId: selectedPreviewNode.id, direction: 'down' } })} aria-label="下移"><ChevronDown className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" disabled={!canWrite || busy || ['approval', 'audit'].includes(selectedPreviewNode.kind)} onClick={() => void onPatchCandidate({ removeNodeId: selectedPreviewNode.id })} aria-label="删除"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-[var(--text-muted)]">点击画布节点可重命名、调整顺序或删除（审批/审计节点受保护）。</div>
                )}

                <div className="flex flex-wrap gap-2">
                  {activeCandidate.dependencies.map((dep) => (
                    <Badge key={`${dep.type}-${dep.name}`} tone={dep.status === 'available' ? 'success' : 'warn'} className="text-[10px]">
                      {dependencyTypeLabel(dep.type)} · {dep.name}
                    </Badge>
                  ))}
                </div>

                {activeCandidate.risks.length > 0 && (
                  <div className="rounded-md border border-[var(--warning)]/30 bg-[var(--warning-bg)] px-3 py-2">
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--warning)]"><AlertTriangle className="h-3.5 w-3.5" />风险提示</div>
                    {activeCandidate.risks.map((risk) => (
                      <div key={`${risk.node}-${risk.text}`} className="text-[11px] leading-5 text-[var(--text-secondary)]">{risk.level} · {risk.text}</div>
                    ))}
                  </div>
                )}

                <div className="flex items-start gap-2 rounded-md bg-[var(--info-bg)] px-3 py-2 text-[11px] text-[var(--info)]">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  画布预览仅用于示例编排；应用隔离草稿后仍须专家配置、校验并发布流程技能，供数字伙伴装配。
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
