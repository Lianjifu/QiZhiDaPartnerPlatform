/**
 * CopilotPage.FeedbackModal — wraps FeedbackForm in a slide-in drawer.
 */
import { ThumbsUp, ThumbsDown, X } from 'lucide-react';
import { useCopilotState } from '@/features/copilot/components/useCopilotState';
import { FeedbackForm } from '@/features/copilot/components/CopilotPage.Feedback';
import type { ChatMessageEx, FeedbackTag } from '@/hooks/types';

export interface CopilotPageFeedbackModalProps {
  open: boolean;
  messageId: string | null;
  onClose: () => void;
  onSubmit: (payload: { tags?: FeedbackTag[]; comment?: string }) => void;
}

export function CopilotPageFeedbackModal({ open, messageId, onClose, onSubmit }: CopilotPageFeedbackModalProps) {
  if (!open || !messageId) return null;
  return (
    <div className="copilot-citation-layer fixed inset-0 z-40" onClick={onClose}>
      <div className="copilot-scrim" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-drawer-title"
        className="absolute right-0 top-0 h-full w-[400px] max-w-[90vw] bg-[var(--surface-1)] border-l border-[var(--border)] shadow-2xl p-5 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div id="feedback-drawer-title" className="text-sm font-semibold flex items-center gap-2">
            <ThumbsUp className="h-4 w-4 text-[var(--brand)]" />反馈
          </div>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded hover:bg-[var(--bg-hover)]" aria-label="关闭反馈">
            <X className="h-4 w-4" />
          </button>
        </div>
        <FeedbackMessageTarget messageId={messageId} onSubmit={onSubmit} />
      </div>
    </div>
  );
}

function FeedbackMessageTarget({ messageId, onSubmit }: { messageId: string; onSubmit: (p: { tags?: FeedbackTag[]; comment?: string }) => void }) {
  // Look up via chat hook — useCopilotState exposes chat directly.
  // The actual target message is fetched from the active session.
  const s = useCopilotState();
  const target = s.chat.activeSession?.messages.find((m: ChatMessageEx) => m.id === messageId);
  if (!target) return <div className="text-[11px] text-[var(--text-muted)]">未找到目标消息</div>;
  return <FeedbackForm target={target} onSubmit={onSubmit} />;
}
