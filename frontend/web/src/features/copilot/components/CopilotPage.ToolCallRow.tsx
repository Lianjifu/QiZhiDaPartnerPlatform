/** ToolCallRow — 单次工具调用的紧凑一行(Claude Code 风格):状态点 + 工具名(参数摘要) + 耗时,点击展开明细。 */
import { useState } from 'react';
import { cn } from '@qzda/web-utils';
import type { ToolCall } from '@/hooks/types';

const STATUS_DOT: Record<string, { className: string; label: string }> = {
  success: { className: 'bg-[var(--success)]', label: '成功' },
  failed: { className: 'bg-[var(--danger)]', label: '失败' },
  denied: { className: 'bg-[var(--warning)]', label: '已拒绝' },
  running: { className: 'bg-[var(--brand)] animate-pulse', label: '执行中' },
  pending: { className: 'bg-[var(--text-muted)]', label: '等待中' },
  needs_instruction: { className: 'bg-[var(--warning)]', label: '需要补充说明' },
};

function summarizeArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  const [key, value] = entries[0];
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const short = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  return entries.length > 1 ? `${key}: ${short}, …` : `${key}: ${short}`;
}

export function ToolCallRow({ toolCall }: { toolCall: ToolCall }) {
  const [open, setOpen] = useState(false);
  const status = STATUS_DOT[String(toolCall.status)] ?? STATUS_DOT.pending;
  const detail = toolCall.error || toolCall.result;
  return (
    <div className="font-mono text-[12px] leading-[1.6]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-fit max-w-full min-w-0 items-center gap-2 text-left text-[var(--text-secondary)] hover:text-[var(--text)]"
      >
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', status.className)} role="img" aria-label={status.label} />
        <span className="shrink-0 font-semibold text-[var(--text)]">{toolCall.name}</span>
        <span className="min-w-0 truncate text-[var(--text-muted)]">({summarizeArgs(toolCall.args)})</span>
        {toolCall.durationMs != null ? (
          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-[var(--text-muted)]">{toolCall.durationMs}ms</span>
        ) : null}
      </button>
      {open ? (
        <div className="mt-1.5 space-y-1 border-t border-[var(--border)] pt-1.5 text-[11px]">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-[var(--text-muted)]">
            {JSON.stringify(toolCall.args ?? {}, null, 2)}
          </pre>
          {detail ? (
            <pre className={cn('max-h-48 overflow-auto whitespace-pre-wrap break-words', toolCall.error ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]')}>
              {detail}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
