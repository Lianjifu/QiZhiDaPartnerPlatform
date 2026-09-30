import { useMemo } from 'react';
import { Badge, Button } from '@qzda/web-ui';
import { Eye, ExternalLink, FileText, RefreshCw } from 'lucide-react';
import type { KnowledgeRetrievalResult } from '@qzda/web-types';
import { Modal } from '@/components/shared';
import { estimateChunkTokens, plainTextFromMarkdown, renderMarkdownDocument } from '@/features/knowledge/markdown-doc';

export function EvidenceResultList({
  chunks,
  emptyHint,
  onOpen,
}: {
  chunks: KnowledgeRetrievalResult[];
  emptyHint?: string;
  onOpen: (chunk: KnowledgeRetrievalResult) => void;
}) {
  if (!chunks.length) {
    return (
      <div className="knowledge-evidence-empty">
        <FileText className="h-4 w-4 text-[var(--text-muted)]" />
        <p>{emptyHint ?? '执行验证后，将在此展示命中证据。'}</p>
      </div>
    );
  }

  return (
    <div className="knowledge-evidence-list">
      {chunks.map((chunk) => {
        const score = Math.round((chunk.score ?? 0) * 100);
        const preview = plainTextFromMarkdown(chunk.text, 160);
        return (
          <article key={`${chunk.docId}-${chunk.idx}`} className="knowledge-evidence-card">
            <header className="knowledge-evidence-card__head">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="knowledge-evidence-index">[{chunk.idx}]</span>
                  <strong className="truncate text-[12px] text-[var(--text)]">{chunk.source}</strong>
                </div>
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  文档 {chunk.docId}
                  {chunk.page != null ? ` · p.${chunk.page}` : ''}
                  {' · '}
                  约 {estimateChunkTokens(chunk.text)} tokens
                </p>
              </div>
              <Badge tone={score >= 80 ? 'success' : score >= 60 ? 'warn' : 'neutral'}>{score}%</Badge>
            </header>
            <p className="knowledge-evidence-card__preview">{preview}</p>
            <footer className="knowledge-evidence-card__foot">
              <button type="button" className="knowledge-evidence-card__action" onClick={() => onOpen(chunk)}>
                <Eye className="h-3.5 w-3.5" />查看详情
              </button>
            </footer>
          </article>
        );
      })}
    </div>
  );
}

export function ChunkDetailModal({
  chunk,
  docTitle,
  canWrite,
  onClose,
  onRescore,
  onOpenDocument,
}: {
  chunk: KnowledgeRetrievalResult | null;
  docTitle?: string;
  canWrite: boolean;
  onClose: () => void;
  onRescore: () => void;
  onOpenDocument: (docId: string) => void;
}) {
  const rendered = useMemo(() => renderMarkdownDocument(chunk?.text), [chunk?.text]);
  const score = chunk ? Math.round((chunk.score ?? 0) * 100) : 0;
  const tokens = estimateChunkTokens(chunk?.text);

  return (
    <Modal
      open={Boolean(chunk)}
      onClose={onClose}
      title={chunk ? `证据片段 · #${chunk.idx}` : '证据详情'}
      description={chunk ? `相关度 ${score}% · 用于回答校验的可引用原文` : undefined}
      size="lg"
      panelClassName="max-w-[760px]"
      bodyClassName="chunk-detail-modal"
      footer={chunk ? (
        <>
          {canWrite && (
            <Button variant="secondary" onClick={onRescore}>
              <RefreshCw className="h-3.5 w-3.5" />重新评分
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>关闭</Button>
          <Button
            onClick={() => {
              if (chunk?.docId) onOpenDocument(chunk.docId);
              onClose();
            }}
            disabled={!chunk?.docId}
          >
            <ExternalLink className="h-3.5 w-3.5" />打开所属文档
          </Button>
        </>
      ) : undefined}
    >
      {chunk && (
        <div className="chunk-detail">
          <section className="chunk-detail__hero">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[var(--text)]">{docTitle || chunk.source}</div>
              <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
                来源标签 {chunk.source}
                {chunk.page != null ? ` · 页码 p.${chunk.page}` : ''}
                {' · '}
                片段编号 #{chunk.idx}
              </p>
            </div>
            <div className="chunk-detail__score">
              <strong>{score}%</strong>
              <small>相关度</small>
            </div>
          </section>

          <section className="chunk-detail__chips" aria-label="片段属性">
            <span><small>所属文档</small><strong>{docTitle || chunk.docId || chunk.source}</strong></span>
            <span><small>Token 估算</small><strong className="font-mono">{tokens}</strong></span>
            <span><small>向量模型</small><strong className="font-mono">BGE-M3</strong></span>
            {chunk.page != null && (
              <span><small>页码</small><strong className="font-mono">p.{chunk.page}</strong></span>
            )}
          </section>

          <section className="chunk-detail__body">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-[var(--text)]">原文片段</h3>
              <Badge tone="neutral">已渲染</Badge>
            </div>
            {rendered.isEmpty ? (
              <div className="chunk-detail__empty">暂无正文内容</div>
            ) : (
              <div className="chunk-detail__paper">
                <article
                  className="knowledge-md knowledge-md--compact"
                  dangerouslySetInnerHTML={{ __html: rendered.html }}
                />
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
