import type { SkillArtifactLink } from '@/features/copilot/lib/artifact-links';
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

export type XlsxGrid = {
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

// Re-export the main panel so existing `import { DocumentPreviewPanel } from './DocumentPreview'` keeps working.
export { DocumentPreviewPanel } from './DocumentPreview.Panel';