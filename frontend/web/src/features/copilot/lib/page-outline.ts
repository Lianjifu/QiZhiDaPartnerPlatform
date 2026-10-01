/** 从助手消息的「## 页面结构」小节提取 PPT/文档的页/章节大纲，供 chip 渲染。 */

export type PageOutline = {
  pages: string[];
  /** 原始 markdown 片段（含 heading + bullets），便于「原始」回退渲染 */
  raw: string;
};

const PAGE_OUTLINE_HEADING_RE = /^#{1,3}\s*页面结构\s*$/m;
const NEXT_HEADING_RE = /^#{1,3}\s/;
const BULLET_RE = /^\s*[-*]\s+(.+?)\s*$/;

export function extractPageOutline(content: string): PageOutline | null {
  if (!content) return null;
  const lines = content.split('\n');
  const startIdx = lines.findIndex((l) => PAGE_OUTLINE_HEADING_RE.test(l));
  if (startIdx < 0) return null;

  const pages: string[] = [];
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (NEXT_HEADING_RE.test(trimmed)) {
      endIdx = i;
      break;
    }
    const m = lines[i].match(BULLET_RE);
    if (m) pages.push(m[1]);
  }
  if (!pages.length) return null;
  return {
    pages,
    raw: lines.slice(startIdx, endIdx).join('\n'),
  };
}

/**
 * 去掉「## 页面结构」整段，避免 <Markdown> 在 hero 下方再次渲染同一份 bullets。
 * 无小节时原样返回。
 */
export function stripPageOutlineSection(content: string): string {
  if (!content) return content;
  const lines = content.split('\n');
  const startIdx = lines.findIndex((l) => PAGE_OUTLINE_HEADING_RE.test(l));
  if (startIdx < 0) return content;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (NEXT_HEADING_RE.test(trimmed) || trimmed === '') {
      endIdx = i;
      break;
    }
  }

  const before = lines.slice(0, startIdx);
  const after = lines.slice(endIdx);
  while (before.length && before[before.length - 1].trim() === '') before.pop();
  while (after.length && after[0].trim() === '') after.shift();
  // 两边都有内容时，保留一个空行作段间隔；只有单边则直接拼接。
  if (before.length && after.length) {
    return [...before, '', ...after].join('\n');
  }
  return [...before, ...after].join('\n');
}
