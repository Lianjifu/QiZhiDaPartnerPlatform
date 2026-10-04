/**
 * CopilotPage.MessageStatus — inline status chip on assistant message meta row.
 * Visual mapping:
 *   pending|in_flight|streaming  → running
 *   succeeded                    → hidden (caller renders nothing)
 *   failed                       → retry
 *   cancelled|expired            → muted
 *   moderated                    → danger
 */
import { CircleDashed, RotateCcw, ShieldAlert, Square, TriangleAlert } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import type { ChatMessageEx } from '@/hooks/types';

type Variant = 'running' | 'retry' | 'muted' | 'danger' | 'warning' | null;

function pick(status: ChatMessageEx['status'] | undefined): { variant: Variant; label: string; Icon?: typeof CircleDashed } {
  switch (status) {
    case 'queued':
    case 'in_flight':
    case 'streaming':
      return { variant: 'running', label: '生成中', Icon: CircleDashed };
    case 'failed':
      return { variant: 'retry', label: '失败 · 可重试', Icon: RotateCcw };
    case 'cancelled':
      return { variant: 'muted', label: '已停止', Icon: Square };
    case 'expired':
      return { variant: 'warning', label: '已过期', Icon: TriangleAlert };
    case 'moderated':
      return { variant: 'danger', label: '内容已处置', Icon: ShieldAlert };
    case 'succeeded':
    default:
      return { variant: null, label: '' };
  }
}

export function CopilotMessageStatus({ status, elapsedSec }: { status?: ChatMessageEx['status']; elapsedSec?: number }) {
  const { variant, label, Icon } = pick(status);
  if (!variant) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        variant === 'running' && 'bg-[var(--status-running-bg)] text-[var(--status-running-fg)]',
        variant === 'retry' && 'bg-[var(--status-retry-bg)] text-[var(--status-retry-fg)]',
        variant === 'muted' && 'bg-[var(--status-muted-bg)] text-[var(--status-muted-fg)]',
        variant === 'warning' && 'bg-[var(--warning-bg)] text-[var(--warning)]',
        variant === 'danger' && 'bg-[var(--danger-bg)] text-[var(--danger)]',
      )}
      role="status"
      aria-live="polite"
      data-status={status}
    >
      {Icon ? <Icon className={cn('h-2.5 w-2.5', variant === 'running' && 'animate-pulse')} /> : null}
      <span>{label}</span>
      {variant === 'running' && elapsedSec != null && elapsedSec > 0 ? (
        <span className="font-mono tabular-nums">{elapsedSec}s</span>
      ) : null}
    </span>
  );
}
