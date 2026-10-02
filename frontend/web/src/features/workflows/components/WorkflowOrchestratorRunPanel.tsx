/**
 * WorkflowOrchestratorRunPanel — AI 辅助编排会话左侧运行面板。
 * M06 P1 拆分原因：原 pages/WorkflowOrchestrationSession.tsx 单文件 1057L。
 */
import { useState } from 'react';
import { Badge, Button } from '@qzda/web-ui';
import { AlertTriangle, BookPlus, ChevronDown, ChevronUp, FileText, Loader2, RefreshCw, Send, Sparkles, Trash2, Upload } from 'lucide-react';
import type { Role } from '@qzda/web-types';
import { cn } from '@qzda/web-utils';
import type { WorkflowNodeKind } from '@qzda/web-types';

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
  modelInvocation?: { provider: string; model: string; mode: string; latencyMs: number; promptDigest: string; toolsUsed?: Array<{ name: string; input: string; output: string }> };
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

type KnowledgeDocLite = { id: string; title: string; summary: string; tags: string[] };

const EXAMPLE_PROMPTS = [
  '由数字伙伴研判处置路径，经双重审批后执行受控恢复，写入审计并通知值班负责人',
  '处理工单分发：解析需求、调用知识检索、由数字伙伴研判是否升级、超时则转入人工审批',
  '每日合规扫描：拉取合规要求、扫描运行手册、生成整改建议清单并通知合规负责人',
];

export function WorkflowOrchestratorRunPanel({
  goal, onGoal, constraints, onConstraints,
  documents, onUploadDoc, onRemoveDoc, onPickKnowledgeDoc, onCiteKnowledgeDoc, onRetrieveRunbook, onDepositKnowledge,
  knowledgeDocs, messages, candidates, templateCandidates, selectedCandidateId,
  onSend, onUpdateMessage, onApplyCandidate, onDepositTemplate, canWrite, userRole,
}: {
  goal: string;
  onGoal: (v: string) => void;
  constraints: SessionConstraints;
  onConstraints: (v: SessionConstraints) => void;
  documents: SessionDocument[];
  onUploadDoc: (doc: SessionDocument) => void;
  onRemoveDoc: (docId: string) => void;
  onPickKnowledgeDoc: (doc: KnowledgeDocLite) => void;
  onCiteKnowledgeDoc: (docId: string) => void;
  onRetrieveRunbook: (query: string) => void;
  onDepositKnowledge: (doc: SessionDocument) => void;
  knowledgeDocs: KnowledgeDocLite[];
  messages: SessionMessage[];
  candidates: SessionCandidate[];
  templateCandidates: TemplateCandidate[];
  selectedCandidateId: string | undefined;
  onSend: (text: string, attachments?: SessionDocument[]) => void;
  onUpdateMessage: (id: string, content: string) => void;
  onApplyCandidate: (c: SessionCandidate) => Promise<void> | void;
  onDepositTemplate: (tpl: TemplateCandidate) => void;
  canWrite: boolean;
  userRole: Role | undefined | null;
}) {
  const [composer, setComposer] = useState('');
  const [kbSearch, setKbSearch] = useState('');
  const [runbookQuery, setRunbookQuery] = useState('');
  const [showDocs, setShowDocs] = useState(true);

  const handleSend = () => {
    if (!composer.trim()) return;
    onSend(composer.trim(), documents);
    setComposer('');
  };

  const filteredKb = knowledgeDocs.filter((k) => !kbSearch || k.title.includes(kbSearch) || k.tags.some((t) => t.includes(kbSearch)));

  return (
    <div className="wf-orch-run-panel flex flex-col h-full">
      <header className="border-b border-[var(--border)] px-2 py-1.5">
        <h2 className="text-sm font-semibold">AI 辅助编排会话</h2>
        <p className="text-xs text-[var(--text-muted)]">澄清完全可选：你写多写少都可以，模型会按需追问</p>
      </header>

      <section className="border-b border-[var(--border)] px-2 py-1.5 space-y-1">
        <div className="text-xs text-[var(--text-muted)]">业务目标</div>
        <textarea
          rows={3}
          className="wf-textarea w-full"
          value={goal}
          onChange={(e) => onGoal(e.target.value)}
          disabled={!canWrite}
        />
        <div className="flex flex-wrap gap-1">
          {EXAMPLE_PROMPTS.map((ex) => (
            <button key={ex} type="button" className="wf-chip" onClick={() => onGoal(ex)}>一键生成示例</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1 pt-1">
          <CheckRow label="要求双重审批" value={constraints.requireApproval} onChange={(v) => onConstraints({ ...constraints, requireApproval: v })} />
          <CheckRow label="要求审计留痕" value={constraints.requireAudit} onChange={(v) => onConstraints({ ...constraints, requireAudit: v })} />
          <CheckRow label="要求补偿回滚" value={constraints.requireRollback} onChange={(v) => onConstraints({ ...constraints, requireRollback: v })} />
          <RiskRow value={constraints.riskLevel} onChange={(v) => onConstraints({ ...constraints, riskLevel: v })} />
        </div>
      </section>

      <section className="border-b border-[var(--border)] px-2 py-1.5">
        <div className="flex items-center justify-between">
          <div className="text-xs text-[var(--text-muted)]">关联文档（{documents.length}）</div>
          <button type="button" onClick={() => setShowDocs((s) => !s)} className="text-xs">{showDocs ? <ChevronUp className="h-3 w-3 inline" /> : <ChevronDown className="h-3 w-3 inline" />}</button>
        </div>
        {showDocs && (
          <div className="mt-1 space-y-1">
            {documents.map((doc) => (
              <div key={doc.id} className={cn('rounded border border-[var(--border)] p-1.5 text-xs', doc.depositedKnowledgeDocId && 'is-deposited')}>
                <div className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  <strong className="truncate">{doc.title}</strong>
                  {doc.source === 'knowledge' && <Badge tone="info">引用知识文档</Badge>}
                  {doc.depositedKnowledgeDocId && <Badge tone="success">已沉淀知识中心</Badge>}
                  <button type="button" className="ml-auto" onClick={() => onRemoveDoc(doc.id)}><Trash2 className="h-3 w-3" /></button>
                </div>
                <p className="text-[var(--text-muted)] line-clamp-2">{doc.summary}</p>
                <div className="flex items-center gap-1 pt-0.5">
                  <button type="button" className="wf-chip" onClick={() => onDepositKnowledge(doc)}><BookPlus className="h-3 w-3 inline mr-0.5" />沉淀知识中心</button>
                  <button type="button" className="wf-chip" onClick={() => onCiteKnowledgeDoc(doc.id)}>引用知识文档</button>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-1">
              <label className="wf-btn-ghost cursor-pointer">
                <Upload className="h-3.5 w-3.5" />上传 MD
                <input
                  type="file"
                  className="hidden"
                  accept=".md,.markdown,.txt"
                  onChange={(e) => {
                    const file = e.target.files?.[0]; if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      onUploadDoc({
                        id: `doc_${Date.now()}`, fileName: file.name, title: file.name, content: String(reader.result ?? ''),
                        contentHash: `h_${Date.now()}`, charCount: String(reader.result ?? '').length, summary: '',
                        headings: [], sections: [], source: 'upload', createdAt: new Date().toISOString(),
                      });
                    };
                    reader.readAsText(file);
                  }}
                />
              </label>
            </div>
          </div>
        )}
      </section>

      <section className="border-b border-[var(--border)] px-2 py-1.5 space-y-1">
        <div className="text-xs text-[var(--text-muted)]">引用知识文档 · Runbook 检索</div>
        <input className="wf-input w-full" placeholder="搜索知识库" value={kbSearch} onChange={(e) => setKbSearch(e.target.value)} />
        <div className="grid grid-cols-2 gap-1 max-h-32 overflow-y-auto">
          {filteredKb.slice(0, 8).map((k) => (
            <button key={k.id} type="button" className="wf-chip" onClick={() => onPickKnowledgeDoc(k)}>{k.title}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <input className="wf-input w-full" placeholder="Runbook 检索关键词" value={runbookQuery} onChange={(e) => setRunbookQuery(e.target.value)} />
          <Button size="sm" variant="outline" onClick={() => onRetrieveRunbook(runbookQuery)}><RefreshCw className="h-3.5 w-3.5" />检索</Button>
        </div>
      </section>

      <section className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} onUpdate={onUpdateMessage} />
        ))}
        {candidates.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-[var(--text-muted)]">候选版本</div>
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                className={cn('wf-candidate w-full rounded border p-1.5 text-left text-xs', selectedCandidateId === c.id && 'is-active')}
                onClick={() => onApplyCandidate(c)}
              >
                <div className="flex items-center gap-1">
                  <strong>{c.label}</strong>
                  <Badge tone={c.risk === 'L1' ? 'success' : c.risk === 'L2' ? 'info' : 'warn'}>{c.risk}</Badge>
                </div>
                <p className="text-[var(--text-muted)]">{c.summary}</p>
                {c.warnings.length > 0 && <div className="text-amber-500">{c.warnings.length} 项警告</div>}
              </button>
            ))}
          </div>
        )}
        {templateCandidates.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-[var(--text-muted)]">沉淀模版候选</div>
            {templateCandidates.map((t) => (
              <div key={t.id} className="rounded border border-[var(--border)] p-1.5 text-xs">
                <div className="flex items-center gap-1">
                  <strong>{t.name}</strong>
                  <Badge tone="info">{Math.round(t.matchScore * 100)}% 匹配</Badge>
                </div>
                <p className="text-[var(--text-muted)]">{t.rationale}</p>
                <Button size="sm" variant="outline" onClick={() => onDepositTemplate(t)}>沉淀模版候选</Button>
              </div>
            ))}
          </div>
        )}
        {!messages.length && !candidates.length && (
          <div className="text-xs text-[var(--text-muted)] py-4 text-center">
            <Sparkles className="h-5 w-5 mx-auto mb-1" />输入业务目标，模型将生成隔离草稿供数字伙伴装配
          </div>
        )}
      </section>

      <footer className="border-t border-[var(--border)] p-2">
        <div className="flex items-end gap-1">
          <textarea
            rows={2}
            className="wf-textarea w-full"
            placeholder="补充澄清或继续对话…"
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend(); }}
            disabled={!canWrite}
          />
          <Button onClick={handleSend} disabled={!composer.trim() || !canWrite}>
            <Send className="h-3.5 w-3.5" />发送
          </Button>
        </div>
        <div className="text-[10px] text-[var(--text-muted)] pt-1">⌘/Ctrl + Enter 快速发送 · 角色 {userRole ?? 'user'}</div>
      </footer>
    </div>
  );
}

function CheckRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1 text-xs">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function RiskRow({ value, onChange }: { value: 'L1' | 'L2' | 'L3'; onChange: (v: 'L1' | 'L2' | 'L3') => void }) {
  return (
    <label className="flex items-center gap-1 text-xs">
      <span className="text-[10px] text-[var(--text-muted)]">风险</span>
      <select className="wf-input" value={value} onChange={(e) => onChange(e.target.value as 'L1' | 'L2' | 'L3')}>
        <option value="L1">L1</option><option value="L2">L2</option><option value="L3">L3</option>
      </select>
    </label>
  );
}

function MessageBubble({ m, onUpdate }: { m: SessionMessage; onUpdate: (id: string, content: string) => void }) {
  if (m.kind === 'template') {
    return (
      <div className="rounded border border-emerald-300 bg-emerald-50/30 p-1.5 text-xs">
        <Badge tone="success">模版候选</Badge>
        <span>{m.content}</span>
      </div>
    );
  }
  if (m.kind === 'retrieve') {
    return (
      <div className="rounded border border-sky-300 bg-sky-50/30 p-1.5 text-xs">
        <Badge tone="info">检索</Badge>
        <span>{m.content}</span>
      </div>
    );
  }
  if (m.role === 'system') {
    return (
      <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-1.5 text-xs text-[var(--text-muted)]">
        {m.content}
      </div>
    );
  }
  return (
    <div className={cn('rounded border p-1.5 text-xs', m.role === 'user' ? 'border-[var(--brand)] bg-[var(--brand)]/5' : 'border-[var(--border)] bg-[var(--surface-1)]')}>
      <textarea
        className="w-full bg-transparent outline-none resize-none"
        rows={Math.max(2, Math.ceil(m.content.length / 40))}
        value={m.content}
        onChange={(e) => onUpdate(m.id, e.target.value)}
        readOnly={m.role !== 'user'}
      />
      {m.status === 'streaming' && <Loader2 className="h-3 w-3 animate-spin inline" />}
    </div>
  );
}