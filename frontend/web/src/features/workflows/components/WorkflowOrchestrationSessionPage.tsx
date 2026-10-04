/**
 * AI 辅助编排会话页（独立全屏）。
 * 创建会话 → 生成草稿示例 → 写入隔离草稿供画布装配。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ReactFlowProvider } from 'reactflow';
import { ArrowLeft, RotateCcw, Sparkles, X } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import type { WorkflowNodeKind } from '@qzda/web-types';
import { getApiClient } from '@qzda/web-api';
import { useApiQuery } from '@/services/query';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import { WorkflowOrchestratorCanvas } from './WorkflowOrchestratorCanvas';
import { WorkflowOrchestratorRunPanel } from './WorkflowOrchestratorRunPanel';

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
  citations?: Array<{ docId: string; heading?: string; excerpt: string }>;
  patches?: Array<{ type: string; target: string; reason: string }>;
};

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
  constraints: SessionConstraints;
  warnings: string[];
  citations?: Array<{ docId: string; heading?: string; excerpt: string }>;
};

type TemplateCandidate = {
  id: string;
  templateId: string;
  name: string;
  description: string;
  matchScore: number;
  rationale: string;
};

type KnowledgeDocLite = { id: string; title: string; summary: string; tags?: string[] };

export const DEFAULT_GOAL = '由数字伙伴研判处置路径，经双重审批后执行受控恢复，写入审计并通知值班负责人';

export function dependencyTypeLabel(type: 'tool' | 'mcp' | 'agent') {
  if (type === 'tool') return 'Tool';
  if (type === 'mcp') return 'MCP';
  return '数字伙伴';
}

const ORCH = '/api/workflows/orchestration-sessions';

function toUiCandidate(raw: any, constraints: SessionConstraints): SessionCandidate {
  const wf = raw?.workflow ?? raw;
  const nodes = Array.isArray(wf?.nodes) ? wf.nodes : Array.isArray(raw?.nodes) ? raw.nodes : [];
  const edges = Array.isArray(wf?.edges) ? wf.edges : Array.isArray(raw?.edges) ? raw.edges : [];
  const summary = Array.isArray(raw?.changeSummary) ? raw.changeSummary.join('；') : String(raw?.summary ?? '');
  return {
    id: String(raw?.id ?? ''),
    label: String(raw?.label ?? '示例'),
    summary,
    createdAt: String(raw?.createdAt ?? new Date().toISOString()),
    nodes: nodes.map((n: any) => ({
      id: String(n.id),
      kind: n.kind,
      label: String(n.label ?? n.kind),
      description: n.description,
      position: n.position ?? { x: 80, y: 120 },
      sourceRef: n.sourceRef ? { docId: n.sourceRef.documentId ?? n.sourceRef.docId, heading: n.sourceRef.heading } : undefined,
    })),
    edges: edges.map((e: any, i: number) => ({ id: String(e.id ?? `e${i}`), source: String(e.source), target: String(e.target) })),
    risk: (raw?.risk ?? raw?.risks?.[0]?.level ?? constraints.riskLevel) as SessionConstraints['riskLevel'],
    constraints: raw?.constraints ?? constraints,
    warnings: Array.isArray(raw?.warnings) ? raw.warnings : [],
    citations: raw?.citations,
  };
}

function adoptPayload(raw: any, fallback: SessionConstraints) {
  const session = raw?.session ?? raw;
  const constraints = session?.constraints ?? fallback;
  const candidates = Array.isArray(session?.candidates) ? session.candidates.map((c: any) => toUiCandidate(c, constraints)) : [];
  const tplRaw = session?.templateCandidates ?? (session?.templateCandidate ? [session.templateCandidate] : []);
  return {
    session,
    goal: String(session?.goal ?? ''),
    constraints,
    documents: (Array.isArray(session?.documents) ? session.documents : []) as SessionDocument[],
    messages: (Array.isArray(session?.messages) ? session.messages : []) as SessionMessage[],
    candidates,
    templateCandidates: tplRaw.map((t: any) => ({
      id: String(t.id),
      templateId: String(t.templateId ?? t.id),
      name: String(t.name ?? '模版候选'),
      description: String(t.description ?? ''),
      matchScore: Number(t.matchScore ?? 0.8),
      rationale: String(t.rationale ?? t.description ?? ''),
    })) as TemplateCandidate[],
    selectedCandidateId: session?.activeCandidateId ?? session?.selectedCandidateId ?? candidates[0]?.id,
  };
}

export default function WorkflowOrchestrationSessionPage() {
  return (
    <ReactFlowProvider>
      <WorkflowOrchestrationSession />
    </ReactFlowProvider>
  );
}

function WorkflowOrchestrationSession() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId ?? 'w1');
  const userRole = useAuthStore((s) => s.user?.role);
  const canWrite = useAuthStore((s) => s.hasPermission('workflow.write'));

  const [draftDocuments, setDraftDocuments] = useState<SessionDocument[]>([]);
  const [messages2, setMessages2] = useState<SessionMessage[]>([]);
  const [candidates, setCandidates] = useState<SessionCandidate[]>([]);
  const [templateCandidates, setTemplateCandidates] = useState<TemplateCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | undefined>();
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [constraints, setConstraints] = useState<SessionConstraints>({ riskLevel: 'L2', requireApproval: true, requireAudit: true, requireRollback: true });
  const [splitPercent, setSplitPercent] = useState(45);
  const [busy, setBusy] = useState(false);
  const createInflightRef = useRef<string | null>(null);

  const { data: remoteSession } = useApiQuery<any>(
    ['orchestration-session', sessionId ?? 'new'],
    `${ORCH}/${sessionId ?? 'new'}`,
    undefined,
    { enabled: Boolean(sessionId) },
  );
  const { data: knowledgeDocsData } = useApiQuery<KnowledgeDocLite[] | { items?: KnowledgeDocLite[] }>(['orchestration-kb', currentWorkspaceId], '/api/knowledge/docs');
  const knowledgeDocs = Array.isArray(knowledgeDocsData) ? knowledgeDocsData : knowledgeDocsData?.items ?? [];

  const applyUi = useCallback((raw: any) => {
    const ui = adoptPayload(raw, { riskLevel: 'L2', requireApproval: true, requireAudit: true, requireRollback: true });
    setDraftDocuments(ui.documents);
    setMessages2(ui.messages);
    setCandidates(ui.candidates);
    setTemplateCandidates(ui.templateCandidates);
    setSelectedCandidateId(ui.selectedCandidateId);
    if (ui.goal) setGoal(ui.goal);
    setConstraints(ui.constraints);
    return ui;
  }, []);

  useEffect(() => {
    if (!remoteSession) return;
    applyUi(remoteSession);
  }, [remoteSession, applyUi]);

  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId;
    if (createInflightRef.current && createInflightRef.current !== 'pending') return createInflightRef.current;
    createInflightRef.current = 'pending';
    const created = await getApiClient().request<any>(ORCH, {
      method: 'POST',
      body: { title: 'AI 辅助编排会话', goal, workspaceId: currentWorkspaceId, model: '企业默认模型', constraints },
    });
    createInflightRef.current = created.id;
    applyUi(created);
    navigate(`/workflows/orchestration/${created.id}`, { replace: true });
    return created.id as string;
  }, [applyUi, constraints, currentWorkspaceId, goal, navigate, sessionId]);

  const onGenerate = useCallback(async (note?: string) => {
    if (!canWrite) return;
    const text = (note ?? goal).trim();
    if (!text) return;
    setBusy(true);
    try {
      const id = await ensureSession();
      if (text !== goal) setGoal(text);
      await getApiClient().request(`${ORCH}/${id}`, { method: 'PATCH', body: { goal: text, constraints } }).catch(() => undefined);
      const generated = await getApiClient().request<any>(`${ORCH}/${id}/generate`, {
        method: 'POST',
        body: { skipClarification: true, note: text },
      });
      const ui = applyUi(generated);
      const extra = generated?.candidate ? toUiCandidate(generated.candidate, ui.constraints) : null;
      if (extra) {
        setSelectedCandidateId(extra.id);
        setCandidates((prev) => prev.some((c) => c.id === extra.id) ? prev : [extra, ...prev]);
      }
    } catch (err) {
      setMessages2((prev) => [...prev, { id: `err_${Date.now()}`, role: 'system', content: err instanceof Error ? err.message : '生成失败', createdAt: new Date().toISOString(), kind: 'generate' }]);
    } finally {
      setBusy(false);
    }
  }, [applyUi, canWrite, ensureSession, goal]);

  const onSend = useCallback(async (text: string) => {
    if (!text.trim() || !canWrite) return;
    setBusy(true);
    try {
      const id = await ensureSession();
      applyUi(await getApiClient().request<any>(`${ORCH}/${id}/messages`, { method: 'POST', body: { content: text, mode: 'clarify' } }));
    } catch (err) {
      setMessages2((prev) => [...prev, { id: `err_${Date.now()}`, role: 'system', content: err instanceof Error ? err.message : '发送失败', createdAt: new Date().toISOString(), kind: 'chat' }]);
    } finally {
      setBusy(false);
    }
  }, [applyUi, canWrite, ensureSession]);

  const onReopen = useCallback(() => {
    createInflightRef.current = null;
    navigate('/workflows/orchestration', { replace: true });
    setCandidates([]);
    setMessages2([]);
    setSelectedCandidateId(undefined);
    setDraftDocuments([]);
    setGoal(DEFAULT_GOAL);
  }, [navigate]);

  const onApplyCandidate = useCallback(async (candidate: SessionCandidate) => {
    setSelectedCandidateId(candidate.id);
    const id = sessionId ?? createInflightRef.current;
    if (!id || id === 'pending') return;
    await getApiClient().request(`${ORCH}/${id}/candidates/${candidate.id}/activate`, { method: 'POST', body: {} }).catch(() => undefined);
  }, [sessionId]);

  const onCommitToCanvas = useCallback(async () => {
    if (!canWrite) return;
    const id = sessionId ?? createInflightRef.current;
    const candidate = candidates.find((c) => c.id === selectedCandidateId) ?? candidates[0];
    if (!id || id === 'pending' || !candidate) return;
    setBusy(true);
    try {
      const applied = await getApiClient().request<any>(`${ORCH}/${id}/apply`, { method: 'POST', body: { candidateId: candidate.id } });
      const wf = applied?.candidate?.workflow ?? applied?.candidate ?? candidate;
      navigate('/workflows/new', {
        state: {
          orchDraft: {
            revisionId: applied.revisionId ?? applied.appliedRevisionId,
            nodes: (wf.nodes ?? candidate.nodes).map((n: any) => ({
              id: n.id, type: 'custom', position: n.position ?? { x: 80, y: 120 },
              data: { kind: n.kind, label: n.label, desc: n.description },
            })),
            edges: (wf.edges ?? candidate.edges).map((e: any) => ({ id: e.id, source: e.source, target: e.target })),
            label: candidate.label,
          },
        },
      });
    } catch (err) {
      setMessages2((prev) => [...prev, { id: `err_${Date.now()}`, role: 'system', content: err instanceof Error ? err.message : '写入草稿失败', createdAt: new Date().toISOString(), kind: 'generate' }]);
    } finally {
      setBusy(false);
    }
  }, [canWrite, candidates, navigate, selectedCandidateId, sessionId]);

  const onUpdateMessage = useCallback((id: string, content: string) => {
    setMessages2((prev) => prev.map((m) => (m.id === id ? { ...m, content } : m)));
  }, []);

  const onSplitPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startPercent = splitPercent;
    const totalWidth = (e.currentTarget.parentElement?.getBoundingClientRect().width ?? window.innerWidth);
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(20, Math.min(80, startPercent + ((ev.clientX - startX) / totalWidth) * 100));
      setSplitPercent(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [splitPercent]);

  const onUploadDoc = useCallback(async (doc: SessionDocument) => {
    setDraftDocuments((prev) => [...prev, doc]);
    if (!canWrite) return;
    const id = await ensureSession();
    const uploaded = await getApiClient().request<any>(`${ORCH}/${id}/documents`, {
      method: 'POST',
      body: { fileName: doc.fileName || `${doc.title}.md`, content: doc.content || `# ${doc.title}\n` },
    });
    applyUi(uploaded);
  }, [applyUi, canWrite, ensureSession]);

  const onRemoveDoc = useCallback((docId: string) => {
    setDraftDocuments((prev) => prev.filter((d) => d.id !== docId));
  }, []);

  const onPickKnowledgeDoc = useCallback(async (doc: KnowledgeDocLite) => {
    if (!canWrite) return;
    const id = await ensureSession();
    applyUi(await getApiClient().request<any>(`${ORCH}/${id}/documents`, { method: 'POST', body: { knowledgeDocId: doc.id } }));
  }, [applyUi, canWrite, ensureSession]);

  const onCiteKnowledgeDoc = useCallback((docId: string) => {
    setMessages2((prev) => [...prev, { id: `cite_${Date.now()}`, role: 'system', content: `已引用知识文档 ${docId}`, createdAt: new Date().toISOString(), kind: 'retrieve' }]);
  }, []);

  const onRetrieveRunbook = useCallback(async (query: string) => {
    if (!query.trim()) return;
    const id = await ensureSession();
    applyUi(await getApiClient().request<any>(`${ORCH}/${id}/retrieve-runbook`, { method: 'POST', body: { query } }));
  }, [applyUi, ensureSession]);

  const onDepositKnowledge = useCallback(async (doc: SessionDocument) => {
    const id = sessionId ?? createInflightRef.current;
    if (!id || id === 'pending') return;
    applyUi(await getApiClient().request<any>(`${ORCH}/${id}/documents/${doc.id}/deposit-knowledge`, { method: 'POST', body: {} }));
  }, [applyUi, sessionId]);

  const onDepositTemplate = useCallback(async (tpl: TemplateCandidate) => {
    const id = sessionId ?? createInflightRef.current;
    if (!id || id === 'pending') return;
    applyUi(await getApiClient().request<any>(`${ORCH}/${id}/propose-template`, { method: 'POST', body: { name: tpl.name, description: tpl.rationale } }));
  }, [applyUi, sessionId]);

  return (
    <div className="wf-orch-session flex h-full min-h-0 flex-col" data-testid="wf-orch-session">
      <header className="wf-orch-session__header flex shrink-0 items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/workflows/new" className="wf-orch-session__back inline-flex items-center gap-1 text-xs">
            <ArrowLeft className="h-3.5 w-3.5" />返回流程编排
          </Link>
          <div className="wf-orch-session__icon grid h-8 w-8 shrink-0 place-items-center rounded-lg">
            <Sparkles className="h-4 w-4" />
          </div>
          <h1 className="truncate text-sm font-semibold text-[var(--text)]">AI 辅助编排会话</h1>
          <Badge tone="info">{sessionId ?? 'new'}</Badge>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={() => onGenerate()} disabled={!canWrite || busy || !goal.trim()}>{busy ? '生成中…' : '一键生成示例'}</Button>
          <Button size="sm" variant="outline" onClick={onCommitToCanvas} disabled={!canWrite || busy || candidates.length === 0}>写入隔离草稿</Button>
          <Button size="sm" variant="outline" onClick={onReopen}><RotateCcw className="h-3.5 w-3.5" />重新打开</Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/workflows/new')}><X className="h-3.5 w-3.5" />关闭</Button>
        </div>
      </header>
      <div className="wf-orch-session__body grid min-h-0 flex-1 overflow-hidden" style={{ gridTemplateColumns: `${splitPercent}% 10px minmax(0, 1fr)` }}>
        <div className="wf-orch-session__left h-full min-h-0 overflow-hidden">
          <WorkflowOrchestratorRunPanel
            goal={goal}
            onGoal={setGoal}
            constraints={constraints}
            onConstraints={setConstraints}
            documents={draftDocuments}
            onUploadDoc={onUploadDoc}
            onRemoveDoc={onRemoveDoc}
            onPickKnowledgeDoc={onPickKnowledgeDoc}
            onCiteKnowledgeDoc={onCiteKnowledgeDoc}
            onRetrieveRunbook={onRetrieveRunbook}
            onDepositKnowledge={onDepositKnowledge}
            knowledgeDocs={knowledgeDocs}
            messages={messages2}
            candidates={candidates}
            templateCandidates={templateCandidates}
            selectedCandidateId={selectedCandidateId}
            onSend={onSend}
            onUpdateMessage={onUpdateMessage}
            onApplyCandidate={onApplyCandidate}
            onDepositTemplate={onDepositTemplate}
            onGenerate={onGenerate}
            onCommitToCanvas={onCommitToCanvas}
            generating={busy}
            canWrite={canWrite}
            userRole={userRole}
          />
        </div>
        <div
          className="wf-orch-session__splitter bg-[var(--border)] cursor-col-resize"
          onPointerDown={onSplitPointerDown}
          role="separator"
          aria-orientation="vertical"
          aria-valuetext="拖动调整左右区域宽度"
          title="拖动调整左右区域宽度"
        />
        <div className="wf-orch-session__right h-full min-h-0 overflow-hidden">
          <WorkflowOrchestratorCanvas
            candidates={candidates}
            selectedCandidateId={selectedCandidateId}
            onSelectCandidate={setSelectedCandidateId}
          />
        </div>
      </div>
      <footer className="wf-orch-session__footer shrink-0 px-4 py-2 text-[11px] leading-5 text-[var(--text-muted)]">
        画布预览仅用于示例编排，确认后将以隔离草稿形式写入工作流编辑器，供数字伙伴装配。
      </footer>
    </div>
  );
}
