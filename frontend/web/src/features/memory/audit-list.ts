import type { MemoryAuditEvent } from '@qzda/web-types';

/** 按 id 去重，保留首次出现（API/持久化可能返回重复 ma-*）。 */
export function dedupeMemoryAudits(audits: MemoryAuditEvent[]): MemoryAuditEvent[] {
  const seen = new Set<string>();
  const out: MemoryAuditEvent[] = [];
  for (const event of audits) {
    const key = event.id?.trim() || `${event.time}|${event.action}|${event.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

export function memoryAuditReactKey(event: MemoryAuditEvent, index: number): string {
  return `${event.id || 'audit'}-${event.time || index}-${index}`;
}
