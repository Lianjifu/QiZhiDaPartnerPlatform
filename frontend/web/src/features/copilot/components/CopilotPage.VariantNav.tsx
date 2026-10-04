/**
 * CopilotPage.VariantNav — sibling navigator shown above the assistant
 * message body when a message has more than one variant in its group.
 *
 * Renders nothing when there is only one variant (the message itself).
 * Emits onSwitch(id) when the user picks a sibling.
 */
import { ChevronLeft, ChevronRight, GitBranch } from 'lucide-react';
import { cn } from '@qzda/web-utils';

export type CopilotVariant = {
  id: string;
  branchIndex: number;
  isActive: boolean;
  role?: string;
  preview?: string;
};

export function CopilotVariantNav({
  variants,
  activeId,
  onSwitch,
}: {
  variants: CopilotVariant[];
  activeId: string | null;
  onSwitch: (variantId: string) => void;
}) {
  if (!variants || variants.length <= 1) return null;
  const active = variants.find((v) => v.id === activeId) ?? variants.find((v) => v.isActive) ?? variants[0];
  const idx = variants.findIndex((v) => v.id === active.id);
  const prev = idx > 0 ? variants[idx - 1] : null;
  const next = idx >= 0 && idx < variants.length - 1 ? variants[idx + 1] : null;
  return (
    <nav
      className="copilot-variant-nav inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px]"
      aria-label="消息变体切换"
      data-active-id={active.id}
      data-variant-count={variants.length}
    >
      <GitBranch className="h-3 w-3 text-[var(--text-muted)]" aria-hidden="true" />
      <button
        type="button"
        onClick={() => prev && onSwitch(prev.id)}
        disabled={!prev}
        className={cn(
          'inline-flex items-center justify-center rounded-sm px-1 py-0.5 text-[var(--text-muted)]',
          prev ? 'hover:bg-[var(--bg-hover)] hover:text-[var(--text)]' : 'opacity-40 cursor-not-allowed',
        )}
        aria-label="上一个变体"
      >
        <ChevronLeft className="h-3 w-3" />
      </button>
      <span className="font-mono tabular-nums text-[var(--text-secondary)]">
        变体 {idx + 1}/{variants.length}
      </span>
      <button
        type="button"
        onClick={() => next && onSwitch(next.id)}
        disabled={!next}
        className={cn(
          'inline-flex items-center justify-center rounded-sm px-1 py-0.5 text-[var(--text-muted)]',
          next ? 'hover:bg-[var(--bg-hover)] hover:text-[var(--text)]' : 'opacity-40 cursor-not-allowed',
        )}
        aria-label="下一个变体"
      >
        <ChevronRight className="h-3 w-3" />
      </button>
      {active.preview ? (
        <span className="ml-1 truncate max-w-[280px] text-[var(--text-muted)]" title={active.preview}>
          {active.preview}
        </span>
      ) : null}
    </nav>
  );
}
