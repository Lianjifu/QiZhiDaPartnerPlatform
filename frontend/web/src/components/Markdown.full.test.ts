import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './Markdown';

describe('Markdown 全量渲染', () => {
  it('renders headings, emphasis, strikethrough and inline code', () => {
    const html = renderMarkdown([
      '# 一级标题',
      '## 二级标题',
      '### 三级标题',
      '',
      '**粗体**、*斜体*、~~删除线~~、`inline code`。',
    ].join('\n'));
    expect(html).toContain('md-h1');
    expect(html).toContain('md-h2');
    expect(html).toContain('md-h3');
    expect(html).toContain('md-bold');
    expect(html).toContain('md-em');
    expect(html).toContain('md-del');
    expect(html).toContain('md-code');
  });

  it('renders nested lists with the right depth', () => {
    const html = renderMarkdown([
      '- 一级 A',
      '- 一级 B',
      '  - 二级 B1',
      '    - 三级 B1a',
      '- 一级 C',
    ].join('\n'));
    expect(html).toContain('md-ul');
    // 嵌套：内层 ul 出现在 li 内部
    expect((html.match(/<ul class="md-ul">/g) ?? []).length).toBe(3);
    expect(html).toContain('二级 B1');
    expect(html).toContain('三级 B1a');
  });

  it('renders task lists as checkboxes', () => {
    const html = renderMarkdown(['- [x] 已完成', '- [ ] 待办'].join('\n'));
    expect(html).toContain('task-list-item');
    expect(html).toContain('checkbox');
    expect(html).toContain('已完成');
  });

  it('renders fenced code blocks with language class and highlighting', () => {
    const html = renderMarkdown(['```python', 'def f():', '    return 1', '```'].join('\n'));
    expect(html).toContain('md-pre');
    expect(html).toContain('language-python');
    expect(html).toContain('md-kw');
  });

  it('renders blockquotes and horizontal rules', () => {
    const html = renderMarkdown(['> 引用一行', '> 引用第二行', '', '---'].join('\n'));
    expect(html).toContain('md-quote');
    expect(html).toContain('md-hr');
  });

  it('renders images and links safely', () => {
    const html = renderMarkdown([
      '![示意图](https://example.com/a.png)',
      '',
      '[站点](https://example.com)',
    ].join('\n'));
    expect(html).toContain('md-img');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('md-link');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('escapes raw HTML instead of executing it', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    // 原始 HTML 一律转义成文本，不会成为可执行标签
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('refuses to build a link with a javascript: url', () => {
    const html = renderMarkdown('[点我](javascript:alert(1))');
    // markdown-it 的 validateLink 拦截该协议：不会生成 href
    expect(html).not.toContain('href=');
    expect(html).not.toContain('href="javascript');
  });

  it('renders footnotes with unique ids across messages', () => {
    const a = renderMarkdown('脚注[^1]\n\n[^1]: 说明');
    const b = renderMarkdown('脚注[^1]\n\n[^1]: 说明');
    const idA = a.match(/id="(fn[^"]+)"/)?.[1];
    const idB = b.match(/id="(fn[^"]+)"/)?.[1];
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);
  });

  it('keeps the Chinese fill-in-the-blank and form meta conventions', () => {
    const html = renderMarkdown('部门：________    整理人：________    整理日期：____年__月__日');
    expect(html).toContain('md-form-meta');
    expect(html).toContain('md-blank');
  });

  it('keeps GFM table alignment and empty cell placeholders', () => {
    const html = renderMarkdown([
      '| 左 | 中 | 右 |',
      '|:---|:---:|---:|',
      '| a |  | c |',
    ].join('\n'));
    expect(html).toContain('md-table-wrap');
    expect(html).toContain('text-align:center');
    expect(html).toContain('text-align:right');
    expect(html).toContain('md-td-empty');
    expect(html).toContain('md-cell-placeholder');
  });

  it('autolinks bare urls', () => {
    const html = renderMarkdown('见 https://example.com/x 了解');
    expect(html).toContain('md-link');
  });

  it('supports ordered list start attribute', () => {
    const html = renderMarkdown('3. 第三\n4. 第四');
    expect(html).toContain('start="3"');
  });
});
