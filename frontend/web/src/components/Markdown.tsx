/**
 * 轻量 Markdown 渲染（无依赖）
 * 支持: **粗体** *斜体* `行内代码` # 标题 - 列表 > 引用
 * [text](url) 链接 ```代码块``` GFM 表格
 * 安全（防 XSS）：先转义 HTML
 */
import { useMemo } from 'react';
import { cn } from '@qzda/web-utils';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong class="md-bold">$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em class="md-em">$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>');
  // 下划线填空：____ / ________ → 可视填空格
  s = s.replace(/_{3,}/g, '<span class="md-blank" aria-hidden="true"></span>');
  return s;
}

function highlightCode(code: string, lang: string): string {
  let html = escapeHtml(code);
  const keywords: Record<string, string[]> = {
    bash: ['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'function', 'return', 'echo', 'export'],
    yaml: ['true', 'false', 'null', 'yes', 'no'],
    json: ['true', 'false', 'null'],
    sql: ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'INSERT', 'UPDATE', 'DELETE', 'JOIN', 'ON', 'AS', 'IN', 'NOT', 'NULL'],
    python: ['def', 'class', 'import', 'from', 'return', 'if', 'else', 'elif', 'for', 'while', 'in', 'not', 'and', 'or', 'True', 'False', 'None'],
  };
  const kws = keywords[lang] ?? [];
  if (kws.length > 0) {
    const pattern = new RegExp(`\\b(${kws.join('|')})\\b`, 'g');
    html = html.replace(pattern, '<span class="md-kw">$1</span>');
  }
  html = html.replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="md-str">$1</span>');
  html = html.replace(/\b(\d+)\b/g, '<span class="md-num">$1</span>');
  if (lang === 'bash' || lang === 'yaml' || lang === 'python') {
    html = html.replace(/(#[^<\n]*$|#[^<\n]*\n)/gm, '<span class="md-com">$1</span>');
  }
  return html;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  if (!cells.length) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  // GFM：至少两端或中间有竖线；纯文本里偶尔出现单个 | 不当作表
  const pipes = (trimmed.match(/\|/g) ?? []).length;
  return pipes >= 2;
}

function alignFromSeparator(cell: string): 'left' | 'center' | 'right' {
  const t = cell.trim();
  const left = t.startsWith(':');
  const right = t.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

function renderTable(header: string[], separator: string[], body: string[][]): string {
  const aligns = separator.map(alignFromSeparator);
  const colCount = Math.max(header.length, ...body.map((r) => r.length), aligns.length);
  const pad = (row: string[]) => {
    const next = row.slice(0, colCount);
    while (next.length < colCount) next.push('');
    return next;
  };
  const th = pad(header).map((cell, i) => {
    const align = aligns[i] ?? 'left';
    return `<th style="text-align:${align}">${renderInline(cell || '—')}</th>`;
  }).join('');
  const trs = body.map((row) => {
    const cells = pad(row).map((cell, i) => {
      const align = aligns[i] ?? 'left';
      const empty = cell.trim() === '';
      return `<td style="text-align:${align}"${empty ? ' class="md-td-empty"' : ''}>${empty ? '<span class="md-cell-placeholder"> </span>' : renderInline(cell)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return [
    '<div class="md-table-wrap" role="region" aria-label="表格" tabindex="0">',
    '<table class="md-table">',
    `<thead><tr>${th}</tr></thead>`,
    body.length ? `<tbody>${trs}</tbody>` : '',
    '</table>',
    '</div>',
  ].join('');
}

/** 表单抬头行：部门：___  整理人：___ */
function isFormMetaLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.startsWith('|') || t.startsWith('#')) return false;
  const fields = t.split(/\s{2,}|\t+/).filter(Boolean);
  if (fields.length < 2) return false;
  return fields.every((f) => /[：:]/.test(f) || /_{2,}/.test(f) || /年.*月.*日/.test(f));
}

function renderFormMeta(line: string): string {
  const fields = line.trim().split(/\s{2,}|\t+/).filter(Boolean);
  const items = fields.map((field) => {
    const m = field.match(/^([^：:]+)[：:](.*)$/);
    if (!m) return `<span class="md-form-meta__item">${renderInline(field)}</span>`;
    const label = m[1].trim();
    const value = m[2].trim();
    return `<span class="md-form-meta__item"><span class="md-form-meta__label">${escapeHtml(label)}</span><span class="md-form-meta__value">${value ? renderInline(value) : '<span class="md-blank" aria-hidden="true"></span>'}</span></span>`;
  }).join('');
  return `<div class="md-form-meta">${items}</div>`;
}

export function renderMarkdown(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeLang = '';
  let codeBuf: string[] = [];
  let inList = false;
  let listBuf: string[] = [];
  let listType: 'ul' | 'ol' = 'ul';
  let i = 0;

  const flushList = () => {
    if (!inList) return;
    const tag = listType;
    out.push(`<${tag} class="md-${tag}">${listBuf.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`);
    listBuf = [];
    inList = false;
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (!inCode) {
        flushList();
        inCode = true;
        codeLang = trimmed.slice(3).trim() || 'text';
        codeBuf = [];
      } else {
        out.push(`<pre class="md-pre"><code class="md-pre-code language-${escapeHtml(codeLang)}">${highlightCode(codeBuf.join('\n'), codeLang)}</code></pre>`);
        inCode = false;
      }
      i += 1;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i += 1;
      continue;
    }

    // GFM 表格：表头 + 分隔行 + 数据行
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1] ?? '')) {
      flushList();
      const header = splitTableRow(line);
      const separator = splitTableRow(lines[i + 1] ?? '');
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i] ?? '')) {
        body.push(splitTableRow(lines[i] ?? ''));
        i += 1;
      }
      out.push(renderTable(header, separator, body));
      continue;
    }

    const ulMatch = line.match(/^[\s]*[-*]\s+(.+)$/);
    const olMatch = line.match(/^[\s]*(\d+)\.\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') { flushList(); inList = true; listType = 'ul'; }
      listBuf.push(ulMatch[1] ?? '');
      i += 1;
      continue;
    }
    if (olMatch) {
      if (!inList || listType !== 'ol') { flushList(); inList = true; listType = 'ol'; }
      listBuf.push(olMatch[2] ?? '');
      i += 1;
      continue;
    }
    flushList();

    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const level = h[1]?.length ?? 1;
      out.push(`<h${level} class="md-h md-h${level}">${renderInline(h[2] ?? '')}</h${level}>`);
      i += 1;
      continue;
    }

    if (line.startsWith('> ')) {
      out.push(`<blockquote class="md-quote">${renderInline(line.slice(2))}</blockquote>`);
      i += 1;
      continue;
    }

    // 分隔线（避开表格分隔）
    if (/^---+$/.test(trimmed) && !trimmed.includes('|')) {
      out.push('<hr class="md-hr" />');
      i += 1;
      continue;
    }

    if (trimmed === '') {
      i += 1;
      continue;
    }

    if (isFormMetaLine(line)) {
      out.push(renderFormMeta(line));
      i += 1;
      continue;
    }

    out.push(`<p class="md-p">${renderInline(line)}</p>`);
    i += 1;
  }

  flushList();
  if (inCode) {
    out.push(`<pre class="md-pre"><code class="md-pre-code">${highlightCode(codeBuf.join('\n'), codeLang)}</code></pre>`);
  }

  return out.join('');
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      className={cn('md-content', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
