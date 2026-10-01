/** 侧栏会话按最近活跃时间降序（新会话置顶）。 */

export type SessionRecencyFields = {
  id?: string;
  lastActiveAt?: number;
  createdAt?: number;
};

export function sessionRecency(session: SessionRecencyFields): number {
  return session.lastActiveAt ?? session.createdAt ?? 0;
}

/** 最近活跃优先；同秒时按创建时间；仍相同则按 id，保证稳定。 */
export function compareSessionsByRecency(a: SessionRecencyFields, b: SessionRecencyFields): number {
  const diff = sessionRecency(b) - sessionRecency(a);
  if (diff !== 0) return diff;
  const created = (b.createdAt ?? 0) - (a.createdAt ?? 0);
  if (created !== 0) return created;
  return (b.id ?? '').localeCompare(a.id ?? '');
}

export function sortSessionsByRecency<T extends SessionRecencyFields>(sessions: T[]): T[] {
  return [...sessions].sort(compareSessionsByRecency);
}
