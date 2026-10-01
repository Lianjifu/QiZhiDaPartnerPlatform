import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText, Loader2, Presentation, Table } from 'lucide-react';
import { renderMarkdownDocument } from '@/features/knowledge/markdown-doc';
import type { SkillArtifactLink } from '@/features/copilot/artifact-links';
import { artifactKindLabel } from '@/features/copilot/artifact-links';
import { authHeader } from '@/auth';

export type DocxPreviewBlock = {
  type: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'blank';
  text?: string;
  ordered?: boolean;
};

export type PptxPreviewSlide = {
  index: number;
  title: string;
  lines?: string[];
  bullets?: string[];
  variant?: 'cover' | 'section' | 'content' | 'agenda' | 'metrics' | string;
  background?: string;
  accent?: string;
  textColor?: string;
  eyebrow?: string;
  subtitle?: string;
  footer?: string;
  imageUrl?: string;
};

export type DocPreviewPayload = {
  kind?: 'docx' | 'pptx' | 'pdf' | 'xlsx' | string;
  title: string;
  filename: string;
  downloadName?: string;
  pageCount?: number;
  blocks: DocxPreviewBlock[];
  slides?: PptxPreviewSlide[];
  contentWarning?: string;
  previewMode?: 'visual' | 'raster' | string;
  accent?: string;
};

export type XlsxPreviewCell = {
  address: string;
  value?: unknown;
  formula?: unknown;
};

export type XlsxWorksheetSummary = {
  name: string;
  rowCount?: number;
  actualRowCount?: number;
  columnCount?: number;
  actualColumnCount?: number;
};

export type XlsxPreviewPayload = {
  kind: 'xlsx';
  title: string;
  filename: string;
  downloadName?: string;
  workbook?: {
    creator?: string | null;
    modified?: string | null;
    worksheetCount?: number;
    worksheets?: XlsxWorksheetSummary[];
  };
  selection?: {
    sheet?: string;
    range?: string;
    truncated?: boolean;
    cells?: XlsxPreviewCell[];
  };
};

const XLSX_COL_RE = /^\$?([A-Z]+)\$?(\d+)$/i;

export function columnIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i += 1) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n;
}

export function parseCellAddress(addr: string): { row: number; col: number } | null {
  const m = XLSX_COL_RE.exec(addr || '');
  if (!m) return null;
  return { row: Number(m[2]), col: columnIndex(m[1].toUpperCase()) };
}

export function xlsxCellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === 'object') {
    // ExcelJS richText / hyperlink / formula result shapes
    const obj = value as { text?: string; result?: unknown; richText?: Array<{ text?: string }> };
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text || '').join('');
    if (obj.result !== undefined) return xlsxCellToText(obj.result);
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

type XlsxGrid = {
  cols: number;
  rows: number;
  data: Map<string, string>;
};

export function buildXlsxGrid(cells: XlsxPreviewCell[] | undefined, maxCols: number, maxRows: number): XlsxGrid {
  const data = new Map<string, string>();
  let maxR = 0;
  let maxC = 0;
  for (const c of cells || []) {
    const pos = parseCellAddress(c.address);
    if (!pos) continue;
    if (pos.row > maxRows || pos.col > maxCols) continue;
    if (pos.row > maxR) maxR = pos.row;
    if (pos.col > maxC) maxC = pos.col;
    data.set(`${pos.row}:${pos.col}`, xlsxCellToText(c.value));
  }
  return { cols: maxC, rows: maxR, data };
}

function XlsxGridTable({ grid, sheetName }: { grid: XlsxGrid; sheetName: string }) {
  if (grid.rows === 0 || grid.cols === 0) {
    return (
      <div className="copilot-doc-preview__state">
        <Table className="h-4 w-4" />
        <span>{sheetName} 工作表为空</span>
      </div>
    );
  }
  const headerCells: React.ReactElement[] = [];
  headerCells.push(
    <th key="row-h" className="copilot-doc-preview__xlsx-corner" scope="col">
      &nbsp;
    </th>,
  );
  for (let c = 1; c <= grid.cols; c += 1) {
    headerCells.push(
      <th key={`col-${c}`} className="copilot-doc-preview__xlsx-colhdr" scope="col">
        {String.fromCharCode(64 + c)}
      </th>,
    );
  }
  const bodyRows: React.ReactElement[] = [];
  for (let r = 1; r <= grid.rows; r += 1) {
    const rowCells: React.ReactElement[] = [];
    rowCells.push(
      <th key={`row-${r}`} className="copilot-doc-preview__xlsx-rowhdr" scope="row">
        {r}
      </th>,
    );
    for (let c = 1; c <= grid.cols; c += 1) {
      const text = grid.data.get(`${r}:${c}`) ?? '';
      rowCells.push(
        <td key={`cell-${r}-${c}`} className={r === 1 ? 'copilot-doc-preview__xlsx-cell is-header' : 'copilot-doc-preview__xlsx-cell'}>
          {text}
        </td>,
      );
    }
    bodyRows.push(<tr key={`row-tr-${r}`}>{rowCells}</tr>);
  }
  return (
    <div className="copilot-doc-preview__xlsx-wrap">
      <table className="copilot-doc-preview__xlsx-table" aria-label={`${sheetName} 工作表`}>
        <thead>
          <tr>{headerCells}</tr>
        </thead>
        <tbody>{bodyRows}</tbody>
      </table>
    </div>
  );
}

function XlsxPreviewView({ payload }: { payload: XlsxPreviewPayload }) {
  const worksheets = payload.workbook?.worksheets || [];
  const initialSheet = payload.selection?.sheet || worksheets[0]?.name || 'Sheet1';
  const [activeSheet, setActiveSheet] = useState(initialSheet);
  const grid = useMemo(() => buildXlsxGrid(payload.selection?.cells, 20, 30), [payload.selection?.cells]);

  const showSheetTabs = worksheets.length > 1;
  const meta = [
    payload.workbook?.creator ? `作者：${payload.workbook.creator}` : null,
    payload.workbook?.modified ? `更新：${payload.workbook.modified}` : null,
    typeof payload.workbook?.worksheetCount === 'number' ? `${payload.workbook.worksheetCount} 个工作表` : null,
    payload.selection?.range ? `范围：${payload.selection.range}` : null,
    payload.selection?.truncated ? '（已截断，仅显示前 20×30 单元格）' : null,
  ].filter(Boolean) as string[];

  return (
    <div className="copilot-doc-preview__xlsx">
      {meta.length > 0 ? (
        <div className="copilot-doc-preview__xlsx-meta">{meta.join(' · ')}</div>
      ) : null}
      {showSheetTabs ? (
        <div className="copilot-doc-preview__xlsx-tabs" role="tablist" aria-label="工作表">
          {worksheets.map((ws) => (
            <button
              key={`tab-${ws.name}`}
              type="button"
              role="tab"
              aria-selected={ws.name === activeSheet}
              className={`copilot-doc-preview__xlsx-tab${ws.name === activeSheet ? ' is-active' : ''}`}
              onClick={() => setActiveSheet(ws.name)}
              title={ws.actualRowCount ? `${ws.actualRowCount} 行 × ${ws.actualColumnCount || ws.columnCount || 0} 列` : undefined}
            >
              {ws.name}
            </button>
          ))}
        </div>
      ) : null}
      <XlsxGridTable grid={grid} sheetName={activeSheet} />
    </div>
  );
}

export function artifactPreviewHref(artifact: Pick<SkillArtifactLink, 'filename'>): string {
  return `/api/skill-artifacts/${encodeURIComponent(artifact.filename)}/preview`;
}

export async function downloadArtifactSafely(href: string, downloadName: string): Promise<void> {
  const res = await fetch(href, { method: 'GET', credentials: 'same-origin', headers: authHeader() });
  if (!res.ok) {
    throw new Error(res.status === 404 ? '文件不存在或已过期' : `下载失败（${res.status}）`);
  }
  const blob = await res.blob();
  const sniff = await blob.slice(0, 120).text();
  if ((blob.type || '').includes('json') || sniff.trimStart().startsWith('{')) {
    throw new Error('文件不存在或已过期');
  }
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = downloadName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export function blocksToPreviewMarkdown(blocks: DocxPreviewBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === 'blank' || !block.text?.trim()) {
      lines.push('');
      continue;
    }
    const text = block.text.trim();
    switch (block.type) {
      case 'h1':
        lines.push(`# ${text}`);
        break;
      case 'h2':
        lines.push(`## ${text}`);
        break;
      case 'h3':
        lines.push(`### ${text}`);
        break;
      case 'li':
        lines.push(block.ordered ? `1. ${text}` : `- ${text}`);
        break;
      default:
        lines.push(text);
    }
  }
  return lines.join('\n');
}

/** 从扁平 blocks（h2 分隔）还原为幻灯片列表，兼容旧预览载荷。 */
export function slidesFromPreviewPayload(payload: DocPreviewPayload): PptxPreviewSlide[] {
  if (Array.isArray(payload.slides) && payload.slides.length > 0) {
    return payload.slides.map((s, i) => ({
      index: s.index || i + 1,
      title: s.title || `第 ${i + 1} 页`,
      lines: s.lines || [],
      bullets: s.bullets || [],
      variant: s.variant,
      background: s.background,
      accent: s.accent || payload.accent,
      textColor: s.textColor,
      eyebrow: s.eyebrow,
      subtitle: s.subtitle,
      footer: s.footer,
      imageUrl: s.imageUrl,
    }));
  }
  const slides: PptxPreviewSlide[] = [];
  let cur: PptxPreviewSlide | null = null;
  for (const block of payload.blocks || []) {
    if (block.type === 'h2' && block.text?.trim()) {
      cur = { index: slides.length + 1, title: block.text.trim(), lines: [], bullets: [] };
      slides.push(cur);
      continue;
    }
    if (!cur || !block.text?.trim()) continue;
    const text = block.text.trim();
    if (block.type === 'li') {
      cur.bullets = [...(cur.bullets || []), text];
      cur.lines = [...(cur.lines || []), text];
    } else if (block.type === 'p' || block.type === 'h3') {
      cur.lines = [...(cur.lines || []), text];
    }
  }
  return slides;
}

/**
 * 将受 Bearer 鉴权保护的图片 URL 转为同源 blob URL，喂给 <img src>。
 * 浏览器原生 <img> 不能附加 Authorization，所以必须先以 fetch 拿到字节
 * 再用 URL.createObjectURL 暴露给标签。未指定 URL 时返回 null。
 */
function useAuthedImageSrc(url: string | undefined): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!url) {
      setBlobUrl(null);
      return;
    }
    let aborted = false;
    const ctrl = new AbortController();
    fetch(url, { credentials: 'same-origin', signal: ctrl.signal, headers: authHeader() })
      .then(async (res) => {
        if (!res.ok || aborted) return;
        const blob = await res.blob();
        if (aborted) return;
        const next = URL.createObjectURL(blob);
        setBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return next;
        });
      })
      .catch(() => {
        /* aborted or network error — leave placeholder src */
      });
    return () => {
      aborted = true;
      ctrl.abort();
    };
  }, [url]);
  return blobUrl;
}

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

function SlideVisual({ slide, total }: { slide: PptxPreviewSlide; total: number }) {
  const src = useAuthedImageSrc(slide.imageUrl);
  if (slide.imageUrl) {
    return (
      <article className="copilot-pptx-slide copilot-pptx-slide--raster" aria-label={`第 ${slide.index} 页：${slide.title}`}>
        <img
          src={src ?? slide.imageUrl}
          alt={`第 ${slide.index} 页 ${slide.title}`}
          className="copilot-pptx-slide__image"
          draggable={false}
        />
        <footer className="copilot-pptx-slide__footer copilot-pptx-slide__footer--overlay">
          {slide.index} / {total}
        </footer>
      </article>
    );
  }

  const variant = slide.variant
    || (slide.index === 1 || (slide.background ? /^#(0|1|2)/i.test(slide.background) : false) ? 'cover' : 'content');
  const isCover = variant === 'cover';
  const bg = slide.background || (isCover ? '#102A43' : '#FFFFFF');
  const accent = slide.accent || '#F26B38';
  const ink = slide.textColor || (isCover ? '#FFFFFF' : '#102A43');
  const muted = isCover ? '#D7E2EA' : '#5B6B7C';
  const bodyLines = (slide.lines && slide.lines.length > 0) ? slide.lines : (slide.bullets || []);
  const bulletSet = new Set(slide.bullets || []);
  const isAgenda = variant === 'agenda';

  return (
    <article
      className={`copilot-pptx-slide copilot-pptx-slide--${variant}`}
      style={{
        background: bg,
        color: ink,
        ['--pptx-accent' as string]: accent,
        ['--pptx-muted' as string]: muted,
      }}
      aria-label={`第 ${slide.index} 页：${slide.title}`}
    >
      {isCover ? (
        <>
          {slide.eyebrow ? <div className="copilot-pptx-slide__eyebrow">{slide.eyebrow}</div> : null}
          <div className="copilot-pptx-slide__accent-rule" aria-hidden />
          <header className="copilot-pptx-slide__title copilot-pptx-slide__title--cover">{slide.title}</header>
          {(slide.subtitle || bodyLines[0]) ? (
            <p className="copilot-pptx-slide__subtitle">{slide.subtitle || bodyLines[0]}</p>
          ) : null}
          <div className="copilot-pptx-slide__spacer" />
          <footer className="copilot-pptx-slide__meta">
            {slide.footer || '请补充：汇报人 / 周期 / 日期'}
          </footer>
        </>
      ) : (
        <>
          <header className="copilot-pptx-slide__title">{slide.title}</header>
          <div className="copilot-pptx-slide__body">
            {bodyLines.length === 0 ? (
              <p className="copilot-pptx-slide__empty">本页要点待补充</p>
            ) : isAgenda ? (
              <ol className="copilot-pptx-slide__agenda">
                {bodyLines.map((line, i) => (
                  <li key={`${slide.index}-a-${i}`}>
                    <span className="copilot-pptx-slide__agenda-num">{String(i + 1).padStart(2, '0')}</span>
                    <span>{line.replace(/^\d+\s*/, '')}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <ul className="copilot-pptx-slide__list">
                {bodyLines.map((line, i) => {
                  const isBullet = bulletSet.has(line) || bodyLines.length > 1;
                  return (
                    <li key={`${slide.index}-${i}`} className={isBullet ? 'is-bullet' : 'is-plain'}>
                      {line}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <footer className="copilot-pptx-slide__footer">
            {slide.footer ? <span className="copilot-pptx-slide__footer-label">{slide.footer}</span> : null}
            <span>{slide.index} / {total}</span>
          </footer>
        </>
      )}
    </article>
  );
}

function SlideDeckReader({
  slides,
  deckTitle,
  initialIndex,
}: {
  slides: PptxPreviewSlide[];
  deckTitle: string;
  /** 1-based slide number to jump to when the deck first mounts. */
  initialIndex?: number;
}) {
  const [index, setIndex] = useState(() => {
    if (typeof initialIndex !== 'number' || initialIndex < 1) return 0;
    return Math.min(initialIndex - 1, Math.max(0, slides.length - 1));
  });
  const total = slides.length;
  const slide = slides[Math.min(index, Math.max(0, total - 1))];

  useEffect(() => {
    setIndex(0);
  }, [slides]);

  if (!slide || total === 0) {
    return <div className="copilot-doc-preview__state">暂无幻灯片内容</div>;
  }

  const hasRaster = slides.some((s) => Boolean(s.imageUrl));

  return (
    <div className="copilot-pptx-reader" aria-label={`${deckTitle} 幻灯片预览`}>
      <div className={`copilot-pptx-reader__stage${hasRaster ? ' is-raster' : ''}`}>
        <SlideVisual slide={slide} total={total} />
      </div>
      <div className="copilot-pptx-reader__nav">
        <button
          type="button"
          className="copilot-pptx-reader__btn"
          disabled={index <= 0}
          onClick={() => setIndex((v) => Math.max(0, v - 1))}
          aria-label="上一页"
        >
          <ChevronLeft className="h-4 w-4" />
          上一页
        </button>
        <div className="copilot-pptx-reader__dots" role="tablist" aria-label="幻灯片页码">
          {slides.map((s, i) => (
            <button
              key={`dot-${s.index}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={`copilot-pptx-reader__dot${i === index ? ' is-active' : ''}`}
              onClick={() => setIndex(i)}
              aria-label={`第 ${s.index} 页`}
            />
          ))}
        </div>
        <button
          type="button"
          className="copilot-pptx-reader__btn"
          disabled={index >= total - 1}
          onClick={() => setIndex((v) => Math.min(total - 1, v + 1))}
          aria-label="下一页"
        >
          下一页
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
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

  const handleDownload = async (e: React.MouseEvent) => {
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
