/**
 * AI 辅助编排会话页（独立全屏）。
 * M06 P1 拆分原因：原 pages/WorkflowOrchestrationSession.tsx 单文件 1057L
 * 按计划拆为 Page + Canvas + RunPanel 三个组件。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ReactFlowProvider } from 'reactflow';
import { AlertTriangle, BookPlus, ChevronDown, ChevronUp, FileText, Loader2, RefreshCw, Send, Sparkles, Trash2, Upload } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { WorkflowNodeKind } from '@qzda/web-types';
import { useApiMutation, useApiQuery } from '@/services/query';
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

type OrchestrationSession = {
  id: string;
  title: string;
  goal: string;
  createdAt: string;
  updatedAt: string;
  status: 'draft' | 'generating' | 'review_required' | 'applied' | 'closed';
  constraints: SessionConstraints;
  documents: SessionDocument[];
  messages: SessionMessage[];
  candidates: SessionCandidate[];
  templateCandidates?: TemplateCandidate[];
  selectedCandidateId?: string;
  workflowRevisionId?: string;
};

type StreamPayload = { chunk?: string; done?: boolean; error?: string };

type KnowledgeDocLite = { id: string; title: string; summary: string; tags: string[] };

export const DEFAULT_GOAL = '由数字伙伴研判处置路径，经双重审批后执行受控恢复，写入审计并通知值班负责人';

export function dependencyTypeLabel(type: 'tool' | 'mcp' | 'agent') {
  if (type === 'tool') return 'Tool';
  if (type === 'mcp') return 'MCP';
  return '数字伙伴';
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
  const [depositedIds, setDepositedIds] = useState<string[]>([]);
  const createInflightRef = useRef<string | null>(null);

  const { data: remoteSession } = useApiQuery<OrchestrationSession>(
    ['orchestration-session', sessionId ?? 'new'],
    `/api/orchestration-sessions/${sessionId ?? 'new'}`,
    undefined,
    { enabled: Boolean(sessionId) },
  );
  const { data: knowledgeDocsData } = useApiQuery<KnowledgeDocLite[]>(['orchestration-kb', currentWorkspaceId], '/api/knowledge/docs');
  const knowledgeDocs = knowledgeDocsData ?? [];

  useEffect(() => {
    if (!remoteSession) return;
    setGoal(remoteSession.goal);
    setConstraints(remoteSession.constraints);
    setMessages2(remoteSession.messages);
    setCandidates(remoteSession.candidates);
    setTemplateCandidates(remoteSession.templateCandidates ?? []);
    setSelectedCandidateId(remoteSession.selectedCandidateId);
    setDraftDocuments(remoteSession.documents);
  }, [remoteSession]);

  const adoptSession = useCallback((s: OrchestrationSession) => {
    setDraftDocuments(s.documents);
    setMessages2(s.messages);
    setCandidates(s.candidates);
    setTemplateCandidates(s.templateCandidates ?? []);
    setSelectedCandidateId(s.selectedCandidateId);
    setGoal(s.goal);
    setConstraints(s.constraints);
  }, []);

  const generateApi = useApiMutation<OrchestrationSession, { goal: string; constraints: SessionConstraints; documents: SessionDocument[] }>(
    '/api/orchestration-sessions/generate',
    {
      onSuccess: (s) => {
        adoptSession(s);
        createInflightRef.current = null;
      },
      onError: () => { createInflightRef.current = null; },
    },
  );

  const onSend = useCallback((text: string, attachments?: SessionDocument[]) => {
    if (!text.trim()) return;
    createInflightRef.current = text;
    generateApi.mutate({ goal: text, constraints, documents: attachments ?? draftDocuments });
  }, [constraints, draftDocuments, generateApi]);

  const onReopen = useCallback(() => {
    createInflightRef.current = null;
  }, []);

  const onApplyCandidate = useCallback(async (candidate: SessionCandidate) => {
    setSelectedCandidateId(candidate.id);
    setMessages2((prev) => [...prev, { id: `m_${Date.now()}`, role: 'system', content: `已选中版本「${candidate.label}」`, createdAt: new Date().toISOString(), kind: 'template' }]);
  }, []);

  const onUpdateMessage = useCallback((id: string, content: string) => {
    setMessages2((prev) => prev.map((m) => (m.id === id ? { ...m, content } : m)));
  }, []);

  const onSplitPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startPercent = splitPercent;
    const totalWidth = (e.currentTarget.parentElement?.getBoundingClientRect().width ?? window.innerWidth);
    const onMove = (ev: PointerEvent) => {
      const delta = ((ev.clientX - startX) / totalWidth) * 100;
      const next = Math.max(20, Math.min(80, startPercent + delta));
      setSplitPercent(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [splitPercent]);

  const onUploadDoc = useCallback((doc: SessionDocument) => {
    setDraftDocuments((prev) => [...prev, doc]);
  }, []);

  const onRemoveDoc = useCallback((docId: string) => {
    setDraftDocuments((prev) => prev.filter((d) => d.id !== docId));
  }, []);

  const onPickKnowledgeDoc = useCallback((doc: KnowledgeDocLite) => {
    setDraftDocuments((prev) => [...prev, {
      id: `kd_${Date.now()}`, fileName: doc.title, title: doc.title, contentHash: 'remote',
      charCount: 0, summary: doc.summary, headings: [], knowledgeDocId: doc.id, source: 'knowledge', createdAt: new Date().toISOString(),
    }]);
  }, []);

  const onCiteKnowledgeDoc = useCallback((docId: string) => {
    setMessages2((prev) => [...prev, { id: `cite_${Date.now()}`, role: 'system', content: `已引用知识文档 ${docId}`, createdAt: new Date().toISOString(), kind: 'retrieve' }]);
  }, []);

  const onRetrieveRunbook = useCallback((query: string) => {
    setMessages2((prev) => [...prev, { id: `rb_${Date.now()}`, role: 'system', content: `Runbook 检索：${query}`, createdAt: new Date().toISOString(), kind: 'retrieve' }]);
  }, []);

  const onDepositKnowledge = useCallback((doc: SessionDocument) => {
    setDepositedIds((prev) => [...prev, doc.id]);
    setDraftDocuments((prev) => prev.map((d) => d.id === doc.id ? { ...d, depositedKnowledgeDocId: `dep_${d.id}` } : d));
  }, []);

  const onDepositTemplate = useCallback((tpl: TemplateCandidate) => {
    setMessages2((prev) => [...prev, { id: `tpl_${Date.now()}`, role: 'system', content: `已沉淀模版候选「${tpl.name}」`, createdAt: new Date().toISOString(), kind: 'template' }]);
  }, []);

  return (
    <div className="wf-orch-session flex flex-col h-screen min-h-0" data-testid="wf-orch-session">
      <header className="wf-orch-session__header flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
        <div className="flex items-center gap-2">
          <Link to="/workflows" className="text-xs text-[var(--text-muted)]">← 返回工作流</Link>
          <h1 className="text-base font-semibold">AI 辅助编排会话</h1>
          <Badge tone="info">{sessionId ?? 'new'}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onReopen}>重新打开</Button>
          <Button variant="outline" onClick={() => navigate('/workflows')}>关闭</Button>
        </div>
      </header>
      <div className="wf-orch-session__body grid grid-cols-12 flex-1 min-h-0 overflow-hidden" style={{ gridTemplateColumns: `${splitPercent}% 8px 1fr` }}>
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
      <footer className="border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--text-muted)]">
        画布预览仅用于示例编排，确认后将以隔离草稿形式写入工作流编辑器，供数字伙伴装配。
      </footer>
    </div>
  );
}