import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import type { TurnTaskItem } from './types';

type Props = {
  tasks: TurnTaskItem[];
  compact?: boolean;
};

function statusIcon(status: TurnTaskItem['status']) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="h-3 w-3 text-[var(--success)]" />;
    case 'running':
      return <Loader2 className="h-3 w-3 animate-spin text-[var(--brand)]" />;
    case 'failed':
    case 'cancelled':
      return <XCircle className="h-3 w-3 text-[var(--danger)]" />;
    default:
      return <Circle className="h-3 w-3 text-[var(--text-muted)]" />;
  }
}

export function TurnTaskList({ tasks, compact }: Props) {
  if (!tasks.length) return null;
  const deduped = dedupeTurnTasks(tasks);
  const visible = compact ? deduped.slice(-4) : deduped;
  const hidden = deduped.length - visible.length;
  return (
    <div className="copilot-turn-task space-y-1" role="list" aria-label="任务清单">
      {visible.map((task, index) => (
        <div
          key={`${task.id}__${index}`}
          role="listitem"
          className="flex items-start gap-2 text-[11px] text-[var(--text-secondary)]"
        >
          <span className="mt-0.5 shrink-0">{statusIcon(task.status)}</span>
          <div className="min-w-0">
            <div className="font-medium">{task.title}</div>
            {task.detail ? <div className="text-[var(--text-muted)]">{task.detail}</div> : null}
          </div>
        </div>
      ))}
      {hidden > 0 ? (
        <div className="text-[10px] text-[var(--text-muted)]">另有 {hidden} 项任务</div>
      ) : null}
    </div>
  );
}

/** Keep latest status per task id (backend historically appended added/started/completed). */
export function dedupeTurnTasks(tasks: TurnTaskItem[]): TurnTaskItem[] {
  const byId = new Map<string, TurnTaskItem>();
  for (const task of tasks) {
    const id = String(task.id ?? '').trim() || String(task.title ?? '').trim();
    if (!id) continue;
    const prev = byId.get(id);
    byId.set(id, prev ? { ...prev, ...task, id, title: task.title || prev.title } : { ...task, id });
  }
  return [...byId.values()];
}

export function mergeTurnTasks(existing: TurnTaskItem[], event: {
  taskId?: string;
  title?: string;
  status?: string;
  action?: string;
  detail?: string;
}): TurnTaskItem[] {
  const id = String(event.taskId ?? '').trim();
  const title = String(event.title ?? '').trim();
  if (!id && !title) return existing;
  const key = id || title;
  const status = normalizeTaskStatus(event.status ?? event.action);
  const idx = existing.findIndex((t) => t.id === key);
  const next: TurnTaskItem = {
    id: key,
    title: title || existing[idx]?.title || key,
    status,
    detail: event.detail || existing[idx]?.detail,
    startedAt: status === 'running' ? new Date().toISOString() : existing[idx]?.startedAt,
    endedAt: status === 'done' || status === 'failed' || status === 'cancelled'
      ? new Date().toISOString()
      : existing[idx]?.endedAt,
  };
  if (idx >= 0) {
    const copy = [...existing];
    copy[idx] = { ...existing[idx], ...next };
    return copy;
  }
  return [...existing, next];
}

function normalizeTaskStatus(raw?: string): TurnTaskItem['status'] {
  const v = (raw ?? '').toLowerCase();
  if (v === 'running' || v === 'started') return 'running';
  if (v === 'done' || v === 'completed') return 'done';
  if (v === 'failed') return 'failed';
  if (v === 'cancelled') return 'cancelled';
  return 'pending';
}
