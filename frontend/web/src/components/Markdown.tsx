/**
 * Markdown 渲染（markdown-it，CommonMark + GFM 全量）
 *
 * 支持:标题 / 段落 / 粗斜体 / 删除线 / 行内代码 / 链接 / 图片 / 自动链接 /
 *       引用 / 有序无序列表（含嵌套）/ 任务列表 / GFM 表格 / 代码块 /
 *       分割线 / 脚注 / 下划线填空 / 表单抬头行
 *
 * 安全：markdown-it 以 `html: false` 运行，原始 HTML 一律转义，不会形成 XSS；
 *       链接 URL 走 markdown-it 自带的 validateLink（拦截 javascript: 等）。
 *
 * 类名沿用既有约定（md-content 下的 md-* ），global.css 不必重写。
 */
import { useMemo } from 'react';
import MarkdownIt, { type RendererRule } from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import { cn } from '@qzda/web-utils';

function highlightCode(code: string, lang: string): string {
  let html = escapeHtml(code);
  const keywords: Record<string, string[]> = {
    bash: ['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'function', 'return', 'echo', 'export'],
    yaml: ['true', 'false', 'null', 'yes', 'no'],
    json: ['true', 'false', 'null'],
    sql: ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'INSERT', 'UPDATE', 'DELETE', 'JOIN', 'ON', 'AS', 'IN', 'NOT', 'NULL'],
    python: ['def', 'class', 'import', 'from', 'return', 'if', 'else', 'elif', 'for', 'while', 'in', 'not', 'and', 'or', 'True', 'False', 'None'],
    go: ['func', 'package', 'import', 'return', 'if', 'else', 'for', 'range', 'var', 'const', 'type', 'struct', 'interface', 'go', 'defer', 'chan', 'map'],
    ts: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'extends', 'interface', 'type', 'export', 'default', 'import', 'from', 'async', 'await'],
  };
  const kws = keywords[lang] ?? [];
  if (kws.length > 0) {
    const pattern = new RegExp(`\\b(${kws.join('|')})\\b`, 'g');
    html = html.replace(pattern, '<span class="md-kw">$1</span>');
  }
  html = html.replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, '<span class="md-str">$1</span>');
  html = html.replace(/\b(\d+)\b/g, '<span class="md-num">$1</span>');
  if (lang === 'bash' || lang === 'yaml' || lang === 'python' || lang === 'go' || lang === 'ts') {
    html = html.replace(/(#[^<\n]*$|#[^<\n]*\n)/gm, '<span class="md-com">$1</span>');
  }
  return html;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 表单抬头行：部门：___  整理人：___  整理日期：____年__月__日 */
function isFormMetaLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.startsWith('|') || t.startsWith('#')) return false;
  const fields = t.split(/\s{2,}|\t+/).filter(Boolean);
  if (fields.length < 2) return false;
  return fields.every((f) => /[：:]/.test(f) || /_{2,}/.test(f) || /年.*月.*日/.test(f));
}

const md = new MarkdownIt({
  html: false,       // 原始 HTML 一律转义 —— 防 XSS
  linkify: true,     // 裸 URL 自动成链
  breaks: true,      // 软换行渲染成 <br>，符合对话阅读习惯
  typographer: false,
});

md.use(taskLists, { label: false, labelAfter: false });
md.use(footnote);

// --- 下划线填空：______ → 可视填空格（放在 emphasis 之前，避免被当成粗体） ---
md.inline.ruler.before('emphasis', 'blank', (state, silent) => {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x5f) return false;
  let count = 0;
  while (start + count < state.posMax && state.src.charCodeAt(start + count) === 0x5f) count += 1;
  if (count < 3) return false;
  if (!silent) {
    const token = state.push('blank', '', 0);
    token.content = '_'.repeat(count);
  }
  state.pos += count;
  return true;
});
md.renderer.rules.blank = () => '<span class="md-blank" aria-hidden="true"></span>';

// --- 表单抬头行（块级）：部门：___  整理人：___ ---
md.block.ruler.before('paragraph', 'form_meta', (state, startLine, _endLine, silent) => {
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (pos >= max) return false;
  const line = state.src.slice(pos, max);
  if (!isFormMetaLine(line)) return false;
  if (silent) return true;
  const token = state.push('form_meta', '', 0);
  token.content = line;
  token.map = [pos, max];
  state.line = startLine + 1;
  return true;
});
md.renderer.rules.form_meta = (tokens, idx, _options, env) => {
  const fields = tokens[idx].content.trim().split(/\s{2,}|\t+/).filter(Boolean);
  const items = fields.map((field) => {
    const m = field.match(/^([^：:]+)[：:](.*)$/);
    if (!m) return `<span class="md-form-meta__item">${md.renderInline(field, env)}</span>`;
    const label = m[1].trim();
    const value = m[2].trim();
    return `<span class="md-form-meta__item"><span class="md-form-meta__label">${escapeHtml(label)}</span><span class="md-form-meta__value">${value ? md.renderInline(value, env) : '<span class="md-blank" aria-hidden="true"></span>'}</span></span>`;
  }).join('');
  return `<div class="md-form-meta">${items}</div>`;
};

// --- 渲染规则：沿用既有 md-* 类名 ---
// markdown-it 15 的 token 是开闭对（heading_open/close、strong_open/close…），
// 给开标签补 class 即可，闭合标签由 renderToken 负责。
const withClass = (cls: string): RendererRule => (tokens, idx, options, _env, self) => {
  tokens[idx].attrJoin('class', cls);
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrJoin('class', `md-h md-h${tokens[idx].tag.slice(1)}`);
  return self.renderToken(tokens, idx, options);
};
md.renderer.rules.paragraph_open = withClass('md-p');
md.renderer.rules.bullet_list_open = withClass('md-ul');
md.renderer.rules.ordered_list_open = withClass('md-ol');
md.renderer.rules.list_item_open = withClass('md-li');
md.renderer.rules.blockquote_open = withClass('md-quote');
md.renderer.rules.strong_open = withClass('md-bold');
md.renderer.rules.em_open = withClass('md-em');
md.renderer.rules.s_open = () => '<del class="md-del">';
md.renderer.rules.s_close = () => '</del>';
md.renderer.rules.hr = () => '<hr class="md-hr" />';
md.renderer.rules.code_inline = (tokens, idx) => `<code class="md-code">${escapeHtml(tokens[idx].content)}</code>`;
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const lang = (token.info || '').trim().split(/\s+/)[0] || 'text';
  return `<pre class="md-pre"><code class="md-pre-code language-${escapeHtml(lang)}">${highlightCode(token.content, lang)}</code></pre>`;
};
md.renderer.rules.code_block = (tokens, idx) => {
  const token = tokens[idx];
  return `<pre class="md-pre"><code class="md-pre-code">${highlightCode(token.content, 'text')}</code></pre>`;
};
md.renderer.rules.link_open = (tokens, idx, _options, _env, self) => {
  const token = tokens[idx];
  token.attrSet('class', 'md-link');
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return self.renderToken(tokens, idx, _options);
};
md.renderer.rules.image = (tokens, idx, _options, _env, self) => {
  const token = tokens[idx];
  token.attrSet('class', 'md-img');
  token.attrSet('loading', 'lazy');
  token.attrSet('referrerpolicy', 'no-referrer');
  return self.renderToken(tokens, idx, _options);
};
md.renderer.rules.table_open = () =>
  '<div class="md-table-wrap" role="region" aria-label="表格" tabindex="0"><table class="md-table">';
md.renderer.rules.table_close = () => '</table></div>';
// 空单元格给占位符，避免表格行塌成一条线（对齐由 markdown-it 写在 style 上）。
md.renderer.rules.td_open = (tokens, idx, options, _env, self) => {
  const inline = tokens[idx + 1];
  if (inline && inline.type === 'inline' && !inline.content.trim()) {
    const token = tokens[idx];
    token.attrJoin('class', 'md-td-empty');
    return `<td${self.renderAttrs(token)}><span class="md-cell-placeholder"> </span>`;
  }
  return self.renderToken(tokens, idx, options);
};

// 脚注 id 在页面内必须唯一（一条消息一条脚注列表），渲染后统一加前缀。
let footnoteSeq = 0;

export function renderMarkdown(text: string): string {
  const html = md.render(text ?? '');
  if (!html.includes('footnotes')) return html;
  const uid = `m${(footnoteSeq += 1)}`;
  return html
    .replace(/id="fn([A-Za-z0-9_-]+)"/g, (_m, id: string) => `id="fn${uid}-${id}"`)
    .replace(/href="#fn([A-Za-z0-9_-]+)"/g, (_m, id: string) => `href="#fn${uid}-${id}"`);
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
