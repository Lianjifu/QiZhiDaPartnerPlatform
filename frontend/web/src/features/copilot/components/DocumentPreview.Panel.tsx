import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Download, FileSpreadsheet, FileText, Loader2, Presentation } from 'lucide-react';
import { renderMarkdownDocument } from '@/features/knowledge/markdown-doc';
import { authHeader } from '@/auth';
import type { SkillArtifactLink } from '@/features/copilot/lib/artifact-links';
import { artifactKindLabel } from '@/features/copilot/lib/artifact-links';
import type {
  DocPreviewPayload,
  DocxPreviewBlock,
  XlsxPreviewPayload,
} from './DocumentPreview';
import { SlideDeckReader } from './DocumentPreview.Slides';
import { XlsxPreviewView } from './DocumentPreview.Spreadsheet';
import {
  artifactPreviewHref,
  blocksToPreviewMarkdown,
  downloadArtifactSafely,
  slidesFromPreviewPayload,
} from './DocumentPreview';

function DocumentMarkdownBody({ blocks }: { blocks: DocxPreviewBlock[] }) {
  const rendered = useMemo(() => renderMarkdownDocument(blocksToPreviewMarkdown(blocks)), [blocks]);
  if (rendered.isEmpty) {
    return null;
  }
  return (
    <div
      className="knowledge-md copilot-doc-preview__markdown"
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  );
}

export function DocumentPreviewPanel({
  artifact,
  onDownload,
  startSlide,
}: {
  artifact: SkillArtifactLink;
  onDownload?: () => void;
  /** 1-based slide number to jump to when the deck first loads. */
  startSlide?: number;
}) {
  const [payload, setPayload] = useState<DocPreviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dlBusy, setDlBusy] = useState(false);
  const isPptx = artifact.kind === 'pptx' || /\.pptx$/i.test(artifact.filename);
  const isDocx = artifact.kind === 'docx' || /\.docx$/i.test(artifact.filename);
  const isPdf = artifact.kind === 'pdf' || /\.pdf$/i.test(artifact.filename);
  const isXlsx = artifact.kind === 'xlsx' || /\.xlsx$/i.test(artifact.filename);
  const supportsPreview = isPptx || isDocx || isPdf || isXlsx;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);
    if (!supportsPreview) {
      setLoading(false);
      setError('该文件类型暂不支持在线预览，请下载后打开');
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        const res = await fetch(artifactPreviewHref(artifact), { credentials: 'same-origin', headers: authHeader() });
        if (!res.ok) {
          throw new Error(res.status === 404 ? '文档不存在或尚未生成' : `预览失败（${res.status}）`);
        }
        const body = await res.json() as { ok?: boolean; data?: DocPreviewPayload & { contentWarning?: string } };
        const data = (body?.data ?? body) as DocPreviewPayload;
        if (!cancelled) setPayload(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '预览失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifact.filename, artifact.href, artifact.kind, supportsPreview]);

  const title = payload?.title || artifact.title;
  const downloadName = payload?.downloadName || artifact.downloadName;
  const kind = (payload?.kind as SkillArtifactLink['kind'] | undefined) || artifact.kind;
  const isSlideKind = kind === 'pptx';
  const isPaperKind = kind === 'docx' || kind === 'pdf';
  const isSheetKind = kind === 'xlsx';
  const intro = isSlideKind
    ? (payload?.previewMode === 'raster'
      ? '以下为实际生成的 PPT 幻灯片预览（与下载文件一致）。'
      : '按实际版式还原预览；完整动画与字体请下载后用 PowerPoint / WPS 打开。')
    : kind === 'pdf'
      ? '以纸张版式查看 PDF 摘要；完整排版请下载后用 PDF 阅读器打开。'
      : kind === 'docx'
        ? '以纸张版式阅读生成文档；下载后可用 Word / WPS 打开编辑。'
        : kind === 'xlsx'
          ? '以表格视图查看生成数据；完整公式 / 图表请下载后用 Excel / WPS 打开。'
          : '在专家上下文中查看生成文件。';
  const Icon = isSlideKind ? Presentation : isSheetKind ? FileSpreadsheet : FileText;
  const slides = useMemo(
    () => (payload && isSlideKind ? slidesFromPreviewPayload(payload) : []),
    [payload, isSlideKind],
  );

  const handleDownload = async (e: MouseEvent) => {
    e.preventDefault();
    onDownload?.();
    if (dlBusy) return;
    setDlBusy(true);
    try {
      await downloadArtifactSafely(artifact.href, downloadName);
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载失败');
    } finally {
      setDlBusy(false);
    }
  };

  return (
    <section className={`copilot-details-panel copilot-doc-preview-panel${isSlideKind ? ' is-pptx' : isPaperKind ? ' is-docx' : isSheetKind ? ' is-xlsx' : ''}`}>
      <div className="copilot-details-panel__intro">
        <div className="copilot-details-panel__title">
          <Icon className="h-4 w-4" />
          {isSlideKind ? '演示文稿预览' : isSheetKind ? '电子表格预览' : kind === 'pdf' ? 'PDF 预览' : '文档预览'}
        </div>
        <div>{intro}</div>
      </div>

      <div className="copilot-doc-preview__toolbar">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-[var(--text)]">{title}</div>
          <div className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">
            {artifactKindLabel(kind)} · {downloadName}
            {payload?.pageCount ? ` · ${payload.pageCount} ${isSlideKind ? '页幻灯片' : '页'}` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          disabled={dlBusy}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] font-medium text-[var(--text)] hover:border-[var(--brand)]/40"
        >
          <Download className="h-3 w-3" />
          {dlBusy ? '下载中…' : '下载'}
        </button>
      </div>

      {loading && (
        <div className="copilot-doc-preview__state" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>正在加载{isSlideKind ? '幻灯片' : '文档'}…</span>
        </div>
      )}
      {!loading && error && (
        <div className="copilot-doc-preview__state copilot-doc-preview__state--error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={handleDownload}
            className="mt-2 text-[11px] font-medium text-[var(--brand)]"
          >
            改为下载文件
          </button>
        </div>
      )}
      {!loading && !error && payload && isSlideKind && (
        <>
          {payload.contentWarning ? (
            <div
              className="copilot-doc-preview__state copilot-doc-preview__state--error mx-3 mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200"
              role="alert"
            >
              {payload.contentWarning}
            </div>
          ) : null}
          <SlideDeckReader slides={slides} deckTitle={title} initialIndex={startSlide} />
        </>
      )}
      {!loading && !error && payload && isPaperKind && (
        <>
          {payload.contentWarning ? (
            <div
              className="copilot-doc-preview__state copilot-doc-preview__state--error mx-3 mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200"
              role="alert"
            >
              {payload.contentWarning}
            </div>
          ) : null}
          <div className="copilot-doc-preview__paper-stage">
            <article className="copilot-doc-preview__page copilot-doc-preview__page--paper" aria-label={title}>
              <DocumentMarkdownBody blocks={payload.blocks} />
            </article>
          </div>
        </>
      )}
      {!loading && !error && payload && isSheetKind && (
        <div className="copilot-doc-preview__sheet-stage">
          <XlsxPreviewView payload={payload as XlsxPreviewPayload} />
        </div>
      )}
    </section>
  );
}