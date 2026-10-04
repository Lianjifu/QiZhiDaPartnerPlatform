/** Composer `@` 提及：解析触发区间、替换 token、从正文提取能力 key。 */

export type MentionKind = 'expert' | 'skill' | 'doc' | 'member';

export type MentionCategory = {
  kind: MentionKind;
  key: string;
  label: string;
  desc: string;
};

export const MENTION_CATEGORIES: MentionCategory[] = [
  { kind: 'expert', key: '@expert', label: '专家', desc: '在岗数字伙伴' },
  { kind: 'skill', key: '@skill', label: '技能', desc: '已装配技能 / 工具 / 流程' },
  { kind: 'doc', key: '@doc', label: '文档', desc: '知识库 / Runbook' },
  { kind: 'member', key: '@member', label: '成员', desc: '协作同事' },
];

export function formatMentionToken(kind: MentionKind, item: { key?: string; name: string }): string {
  const raw = String(item.key ?? item.name).trim();
  if (kind === 'skill') {
    if (/^(skill|tool|workflow):/i.test(raw)) return `@${raw}`;
    return `@skill:${item.name}`;
  }
  if (kind === 'expert') return `@expert:${item.name}`;
  if (kind === 'doc') return `@doc:${raw}`;
  return `@member:${item.name}`;
}

/** 匹配句首或空白后的未完成 `@token`（不含已闭合的完整提及）。 */
export function mentionTriggerMatch(draft: string): { start: number; query: string } | null {
  const m = /(^|[\s\u3000])@([^\s@]*)$/u.exec(draft);
  if (!m || m.index === undefined) return null;
  return { start: m.index + m[1].length, query: m[2] ?? '' };
}

export function shouldShowMentionMenu(draft: string): boolean {
  return mentionTriggerMatch(draft) !== null;
}

/** 用完整提及 token 替换当前 `@…` 触发段；无触发段时追加。 */
export function replaceMentionTrigger(draft: string, token: string): string {
  const normalized = token.startsWith('@') ? token : `@${token}`;
  const match = mentionTriggerMatch(draft);
  if (!match) {
    const pad = draft && !/[\s\u3000]$/u.test(draft) ? ' ' : '';
    return `${draft}${pad}${normalized} `;
  }
  const before = draft.slice(0, match.start);
  const after = draft.slice(match.start + 1 + match.query.length);
  return `${before}${normalized}${after.length ? after : ' '}`;
}

/** 从正文提取 `@skill:…` / `@tool:…` / `@workflow:…`（与工具链 key 对齐）。 */
export function parseCapabilityMentions(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const re = /@(skill|tool|workflow):([^\s@]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const key = `${m[1]}:${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(key);
  }
  return found;
}

export function mergeMentionedTools(base: string[], text: string, knownKeys: string[]): string[] {
  const known = new Set(knownKeys);
  const next = [...base];
  const seen = new Set(base);
  for (const key of parseCapabilityMentions(text)) {
    if (!known.has(key) || seen.has(key)) continue;
    seen.add(key);
    next.push(key);
  }
  return next;
}

export function filterByQuery<T extends { name: string; key?: string; label?: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const hay = `${item.name} ${item.key ?? ''} ${item.label ?? ''}`.toLowerCase();
    return hay.includes(q);
  });
}
