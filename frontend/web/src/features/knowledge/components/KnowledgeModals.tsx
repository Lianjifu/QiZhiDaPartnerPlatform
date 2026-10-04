/**
 * 知识中心 · 弹层集合（M07 P1 拆分）。
 *
 * 包含：文档阅读器详情（DocDetail）/ 上传内容（UploadDoc）/ 新建知识包
 * （NewKnowledgePackage）/ 接入数据源（ConnectSource pass-through）/ 引用智能体
 * （CitationAgents）/ 证据片段抽屉（ChunkDetail wrap）/ 重建索引与删除文档确认
 * （ConfirmDialog）。
 *
 * 注意：UploadDocModal + readUploadFileContent 是原文件 L1079-1254 的整体迁移，
 * 仅调整了 KB_TYPE_OPTIONS 来源（来自 KnowledgeShared）以去除跨文件 import。
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight, Download, FileText, Hash, Pencil, Search, ShieldCheck, Sparkles, Trash2, TrendingUp, Upload,
} from 'lucide-react';
import { Badge, Button, Input } from '@qzda/web-ui';
import { ConfirmDialog, EmptyState, Modal } from '@/components/shared';
import { cn } from '@qzda/web-utils';
import { docQualityBarValue, formatDocQualityAverage } from '@/features/knowledge/knowledge-ui';
import { ChunkDetailModal } from './ChunkEvidence';
import { ConnectSourceModal } from './ConnectSourceModal';
import { DocumentPaperPreview } from './DocumentPaperPreview';
import { Field, KB_TYPE_OPTIONS, QualityBar } from './KnowledgeShared';
import type { KnowledgeController } from './useKnowledgeController';

export function KnowledgeModals({ c }: { c: KnowledgeController }) {
  return (
    <>
      <DocDetailModal c={c} />
      <ConnectSourceModal
        open={c.activeModal === 'connectSource'}
        onClose={() => c.setActiveModal(null)}
        onSubmit={c.connectSource}
        connecting={c.sourceMutation.isPending || c.sourceSyncMutation.isPending}
      />
      <CitationAgentsModal
        open={c.activeModal === 'citationAgents'}
        onClose={() => c.setActiveModal(null)}
        citation={c.citationTrace[0]}
      />
      <ChunkDetailModal
        chunk={c.chunkDrawer}
        docTitle={c.docDetail?.title}
        canWrite={c.canWrite}
        onClose={() => c.setChunkDrawer(null)}
        onRescore={c.handleRescore}
        onOpenDocument={(docId) => c.openDocument(docId)}
      />
      <ConfirmDialog
        open={c.reindexConfirm}
        onClose={() => c.setReindexConfirm(false)}
        onConfirm={c.handleReindex}
        title="重新索引"
        description="将对全部知识内容重新执行 Embed + Index，预计耗时 5-10 分钟，期间检索仍可使用旧索引。"
        confirmText="开始重建"
      />
      <ConfirmDialog
        open={Boolean(c.deleteConfirm)}
        onClose={() => { if (!c.deleteDocsMutation.isPending) c.setDeleteConfirm(null); }}
        onConfirm={c.handleDeleteDocs}
        tone="danger"
        title={c.deleteConfirm && c.deleteConfirm.ids.length > 1 ? `删除 ${c.deleteConfirm.ids.length} 项知识文档？` : '删除知识文档？'}
        description={c.deleteConfirm
          ? `将永久移除「${c.deleteConfirm.titles.slice(0, 3).join('」「')}${c.deleteConfirm.titles.length > 3 ? `」等 ${c.deleteConfirm.titles.length} 项` : '」'}，并清理切片、引用痕迹与本地正文。${c.deleteConfirm.citeTotal > 0 ? ` 其中累计引用 ${c.deleteConfirm.citeTotal} 次，删除后下游检索将不再命中。` : ''}`
          : undefined}
        confirmText={c.deleteDocsMutation.isPending ? '删除中…' : '删除'}
      />
    </>
  );
}

function DocDetailModal({ c }: { c: KnowledgeController }) {
  const navigate = useNavigate();
  const detail = c.docDetail;
  return (
    <Modal
      open={c.showDetails}
      onClose={() => { c.setShowDetails(false); c.setEditingContent(false); }}
      title={detail ? (
        <span className="flex min-w-0 flex-col gap-1.5">
          <span className="truncate">{detail.title}</span>
          <span className="flex flex-wrap items-center gap-1.5 font-normal">
            <Badge tone="info">{detail.source}</Badge>
            <span className={cn('knowledge-status-dot', detail.status === 'ready' ? 'is-ready' : 'is-indexing')}>
              {detail.status === 'ready' ? '已就绪' : '索引中'}
            </span>
            <Badge tone="neutral">{detail.version ?? 'v1.0'}</Badge>
            {detail.classification && <Badge tone="warn">{detail.classification}</Badge>}
          </span>
        </span>
      ) : '内容详情'}
      description={detail ? `责任人 ${detail.author ?? '未指定'} · 更新于 ${detail.updatedAt?.slice(0, 10) ?? '—'}` : '正在加载文档内容…'}
      size="2xl"
      bodyClassName="overflow-hidden p-0"
      footer={(
        <>
          <Button variant="secondary" onClick={() => { c.setShowDetails(false); c.setEditingContent(false); }}>关闭</Button>
          <Button variant="secondary" onClick={c.downloadOriginal} disabled={!detail}><Download className="h-3.5 w-3.5" />下载原文</Button>
          <Button variant="secondary" disabled={!c.topChunks.length} onClick={() => { c.setShowDetails(false); c.setChunkDrawer(c.topChunks[0]); }}>
            <Hash className="h-3.5 w-3.5" />关联切片
          </Button>
          {c.canWrite && detail && (
            <Button variant="danger" disabled={c.deleteDocsMutation.isPending} onClick={() => {
              c.setShowDetails(false);
              c.setEditingContent(false);
              c.requestDeleteDocs([detail.id]);
            }}>
              <Trash2 className="h-3.5 w-3.5" />删除
            </Button>
          )}
          {c.canWrite && (
            <Button variant={c.editingContent ? 'secondary' : 'primary'} onClick={() => c.setEditingContent((editing) => !editing)}>
              <Pencil className="h-3.5 w-3.5" />{c.editingContent ? '退出编辑' : '编辑内容'}
            </Button>
          )}
        </>
      )}
    >
      {!detail ? (
        <div className="flex h-[40vh] items-center justify-center text-xs text-[var(--text-muted)]">加载文档内容中…</div>
      ) : (
        <div className="knowledge-doc-detail">
          <DocumentPaperPreview
            content={detail.content}
            editing={c.editingContent}
            canWrite={c.canWrite}
            metaLabel={`${detail.size ?? '—'} · ${detail.chunks ?? 0} 切片 · ${detail.chunkStrategy ?? '结构切片'}`}
            onToggleEdit={() => c.setEditingContent((editing) => !editing)}
            onEditBlur={() => c.setGovernanceNotice(`内容「${detail.title}」编辑草稿已更新，发布前需完成复核。`)}
          />
          <aside className="knowledge-doc-detail__aside">
            <section className="knowledge-doc-stat-strip">
              <div>
                <strong>{formatDocQualityAverage(detail.quality)}</strong>
                <small>综合质量</small>
              </div>
              <div>
                <strong className="font-mono">{detail.citeCount ?? 0}</strong>
                <small>运行引用</small>
              </div>
              <div>
                <strong className="font-mono">{detail.chunks ?? 0}</strong>
                <small>切片数</small>
              </div>
            </section>
            <section className="knowledge-doc-meta">
              <div className="knowledge-doc-meta__title">内容质量</div>
              <div className="mt-3 space-y-2.5">
                <QualityBar label="完整度" value={docQualityBarValue(detail.quality?.completeness)} />
                <QualityBar label="时效性" value={docQualityBarValue(detail.quality?.freshness)} />
                <QualityBar label="引用正确率" value={docQualityBarValue(detail.quality?.citationAccuracy)} />
              </div>
            </section>
            <section className="knowledge-doc-impact">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--brand)]">
                  <TrendingUp className="h-3.5 w-3.5" />引用影响
                </div>
                <span className="font-mono text-[11px] font-semibold text-[var(--text)]">{detail.citeCount ?? 0} 次</span>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-[var(--text-secondary)]">版本变更前请确认智能体与工作流影响范围。</p>
              <button type="button" className="knowledge-doc-impact__action" onClick={() => {
                c.setShowDetails(false);
                const pkgId = detail.packageId as string | undefined;
                navigate(pkgId ? `/knowledge/packages/${encodeURIComponent(pkgId)}?step=versions` : '/knowledge');
              }}>
                查看引用治理 <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </section>
            {detail.tags?.length > 0 && (
              <section className="knowledge-doc-meta">
                <div className="knowledge-doc-meta__title">标签</div>
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {detail.tags.map((tag: string) => <Badge key={tag} tone="neutral">#{tag}</Badge>)}
                </div>
              </section>
            )}
            {detail.versions?.length > 0 && (
              <section className="knowledge-doc-meta">
                <div className="knowledge-doc-meta__title">版本历史</div>
                <ul className="knowledge-doc-versions">
                  {detail.versions.slice(0, 3).map((version: { version: string; time: string; note: string }, index: number) => (
                    <li key={`${version.version}-${version.time}`} className={cn(index === 0 && 'is-current')}>
                      <div className="flex items-center justify-between gap-2">
                        <strong className="font-mono">{version.version}</strong>
                        {index === 0 && <Badge tone="brand">当前</Badge>}
                      </div>
                      <span>{version.time}</span>
                      <small>{version.note}</small>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <button type="button" className="knowledge-doc-nav" onClick={() => {
              c.setShowDetails(false);
              if (c.docPreviewId) navigate(`/knowledge/docs/${encodeURIComponent(c.docPreviewId)}?step=retrieval`);
            }}>
              <span className="flex items-center gap-1.5"><Search className="h-3.5 w-3.5 text-[var(--brand)]" />前往检索与评测</span>
              <ChevronRight className="h-3.5 w-3.5 text-[var(--brand)]" />
            </button>
          </aside>
        </div>
      )}
    </Modal>
  );
}

const TEXT_UPLOAD_EXT = /\.(md|markdown|txt|json|ya?ml|csv|log)$/i;

async function readUploadFileContent(file: File): Promise<string> {
  const isText = TEXT_UPLOAD_EXT.test(file.name)
    || file.type.startsWith('text/')
    || file.type === 'application/json'
    || file.type === 'application/markdown';
  if (isText) {
    const content = (await file.text()).replace(/^﻿/, '');
    if (!content.trim()) {
      throw new Error('文件内容为空，请选择有效的 Markdown / 文本文件');
    }
    return content;
  }
  const base = file.name.replace(/\.[^.]+$/, '') || file.name;
  return [
    `# ${base}`,
    '',
    `> 已接收文件「${file.name}」（${Math.max(1, Math.round(file.size / 1024))} KB）。`,
    '>',
    '> 当前控制面可直接阅读 Markdown / 纯文本正文；PDF / Word 需异步解析后才会写入可读内容。',
    '> 若需立即查看正文，请另存为 `.md` 或 `.txt` 后重新上传。',
  ].join('\n');
}

export function UploadDocModal({ open, onClose, onSubmit, uploading = false }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: { title: string; source: string; tags: string; content: string; fileName?: string }) => void;
  uploading?: boolean;
}) {
  const [title, setTitle] = useState('');
  const [source, setSource] = useState(KB_TYPE_OPTIONS[0]);
  const [tags, setTags] = useState('');
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const valid = title.trim().length > 0 && Boolean(file);
  const busy = uploading || reading;

  useEffect(() => {
    if (!open) {
      setTitle('');
      setSource(KB_TYPE_OPTIONS[0]);
      setTags('');
      setDragging(false);
      setFile(null);
      setReading(false);
      setError(null);
    }
  }, [open]);

  const applyFile = (next?: File | null) => {
    if (!next) return;
    setError(null);
    setFile(next);
    setTitle((current) => current.trim() || next.name.replace(/\.[^.]+$/, ''));
  };

  const handleSubmit = async () => {
    if (!valid || busy || !file) return;
    setReading(true);
    setError(null);
    try {
      const content = await readUploadFileContent(file);
      onSubmit({ title: title.trim(), source, tags: tags.trim(), content, fileName: file.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取文件失败');
    } finally {
      setReading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="上传文档"
      description="支持 PDF / Word / Markdown / 纯文本。Markdown 与纯文本会直接写入正文，可在详情中阅读。"
      size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>取消</Button>
        <Button disabled={!valid || busy} onClick={() => { void handleSubmit(); }}>
          <Upload className="h-3.5 w-3.5" />{reading ? '读取文件…' : uploading ? '上传中…' : '开始上传'}
        </Button>
      </>}
    >
      <div className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          accept=".pdf,.doc,.docx,.md,.txt,.markdown,.zip"
          onChange={(event) => { applyFile(event.target.files?.[0] ?? null); event.target.value = ''; }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); applyFile(event.dataTransfer.files?.[0] ?? null); }}
          className={cn('knowledge-upload-dropzone', dragging && 'is-dragging', file && 'has-file')}
        >
          <span className="knowledge-upload-dropzone__icon"><Upload className="h-5 w-5" /></span>
          <span className="mt-3 text-xs font-semibold text-[var(--text)]">{file ? '重新选择文件' : '拖拽文件到此处，或点击选择'}</span>
          <span className="mt-1 text-[10px] text-[var(--text-muted)]">PDF / Word / Markdown / 文本 · 最大 50MB · 多文件请打包 zip</span>
        </button>
        {file && (
          <div className="knowledge-upload-file">
            <span className="knowledge-upload-file__icon"><FileText className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-xs text-[var(--text)]">{file.name}</strong>
              <small className="text-[10px] text-[var(--text-muted)]">
                {Math.max(1, Math.round(file.size / 1024))} KB · {TEXT_UPLOAD_EXT.test(file.name) ? '将读取正文并写入详情' : '二进制文件将进入解析队列'}
              </small>
            </span>
            <button type="button" className="rounded-md px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]" onClick={() => { setFile(null); fileInputRef.current?.click(); }}>更换</button>
          </div>
        )}
        {error && (
          <div className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-[11px] text-[var(--danger)]">{error}</div>
        )}
        <Field label="文档标题" required>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：Redis 故障 Runbook v3.3" className="de-employee-input bg-[var(--bg)]" onKeyDown={(event) => event.key === 'Enter' && void handleSubmit()} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="文档分类">
            <select value={source} onChange={(event) => setSource(event.target.value)} className="de-employee-input h-9 w-full rounded-lg bg-[var(--bg)] px-2.5 text-xs text-[var(--text)]">
              {KB_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </Field>
          <Field label="标签">
            <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="redis, oom, 生产" className="de-employee-input bg-[var(--bg)]" />
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">多个标签用逗号分隔，便于检索与治理筛选</p>
          </Field>
        </div>
        <div className="knowledge-upload-hint">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
          <span>上传后将执行敏感内容检测，并进入加工队列。Markdown / 纯文本正文会随请求一并提交，可在详情中直接阅读。</span>
        </div>
      </div>
    </Modal>
  );
}

function CitationAgentsModal({ open, onClose, citation }: {
  open: boolean;
  onClose: () => void;
  citation: { title: string; lastUsed: string; citeCount: number; usedBy?: string[] } | null;
}) {
  return (
    <Modal open={open} onClose={onClose} title="引用此文档的智能体" size="md">
      {!citation ? (
        <EmptyState icon={Sparkles} title="暂无数据" />
      ) : (
        <div className="space-y-2">
          <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-xs">
            <div className="font-semibold text-sm">{citation.title}</div>
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5">最近引用 {citation.lastUsed} · 累计 {citation.citeCount} 次</div>
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-2 mb-1">引用方</div>
          <div className="grid grid-cols-2 gap-2">
            {(citation.usedBy ?? []).map((user) => (
              <div key={user} className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-xs flex items-center justify-between">
                <span className="font-mono">{user}</span>
                <Badge tone="brand" className="text-[9px]">{Math.floor(Math.random() * 30) + 5} 次</Badge>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[var(--text-muted)] mt-2">提示：升级文档版本时，所有引用方将在下次检索时自动切换到新版本。</p>
        </div>
      )}
    </Modal>
  );
}

