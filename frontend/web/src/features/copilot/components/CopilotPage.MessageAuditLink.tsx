/**
 * CopilotPage.MessageAuditLink — quick links to per-message audit row +
 * replay view. Disabled buttons when IDs aren't present.
 */
import { FileSearch, History } from 'lucide-react';
import { cn } from '@qzda/web-utils';

export function CopilotMessageAuditLink({
  conversationId,
  correlationId,
  auditEventId,
  onOpenAudit,
  onOpenReplay,
}: {
  conversationId?: string;
  correlationId?: string;
  auditEventId?: string;
  onOpenAudit?: (auditEventId: string) => void;
  onOpenReplay?: (conversationId: string, correlationId: string) => void;
}) {
  const hasAudit = !!auditEventId && !!onOpenAudit;
  const hasReplay = !!conversationId && !!correlationId && !!onOpenReplay;
  if (!hasAudit && !hasReplay) return null;
  return (
    <div className="copilot-message-audit inline-flex items-center gap-1">
      {hasAudit ? (
        <button
          type="button"
          onClick={() => onOpenAudit!(auditEventId!)}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]',
            'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]',
          )}
          title={`查看审计 ${auditEventId}`}
          aria-label="查看此轮审计"
        >
          <FileSearch className="h-3 w-3" />
          <span>审计</span>
        </button>
      ) : null}
      {hasReplay ? (
        <button
          type="button"
          onClick={() => onOpenReplay!(conversationId!, correlationId!)}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]',
            'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]',
          )}
          title={`回放 ${correlationId}`}
          aria-label="回放此轮"
        >
          <History className="h-3 w-3" />
          <span>回放</span>
        </button>
      ) : null}
    </div>
  );
}
