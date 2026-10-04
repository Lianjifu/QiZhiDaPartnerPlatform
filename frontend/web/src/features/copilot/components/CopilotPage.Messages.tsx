/**
 * CopilotPage.Messages — message stream area with bubbles and progress.
 */
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useCopilotContext } from '@/features/copilot/components/useCopilotController';
import { CopilotPageMessageBubble } from '@/features/copilot/components/CopilotPage.MessageBubble';
import { TurnThoughtPanel } from '@/features/copilot/turn-narrative/turn-thought-panel';

export function CopilotPageMessages() {
  const ctrl = useCopilotContext();
  const { s, currentSession, displayMessages, showTypingFallback, generationHint,
    openContext, isGenerating, streamingAssistant, jumpToMessage,
    switchActiveVariant, openAuditTab, openReplay } = ctrl;

  // Auto-scroll on message updates
  useEffect(() => {
    if (s.scrollRef.current) {
      s.scrollRef.current.scrollTo({
        top: s.scrollRef.current.scrollHeight,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    }
  }, [displayMessages.length, isGenerating, s.scrollRef]);

  if (!currentSession) {
    return (
      <div ref={s.scrollRef} className="copilot-messages flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-[var(--text-muted)]">
        <span className="text-sm">选择一个会话，或点击「新会话」开始协作。</span>
      </div>
    );
  }

  return (
    <div ref={s.scrollRef} className="copilot-messages min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5" role="log" aria-live="polite" aria-relevant="additions text">
      {displayMessages.length === 0 ? (
        <div className="flex h-full items-center justify-center text-[var(--text-muted)]">
          <span className="text-sm">发送第一条消息开始对话。</span>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {displayMessages.map((message) => (
            <CopilotPageMessageBubble
              key={message.id}
              m={message}
              onOpenContext={(tab, mid, artifact, opts) => openContext(tab, mid, artifact, opts)}
              onOpenAudit={openAuditTab}
              onOpenReplay={openReplay}
              onSwitchVariant={(mid, variantId) => void switchActiveVariant(mid, variantId)}
              conversationId={currentSession?.conversationId}
            />
          ))}
          {streamingAssistant && (
            <TurnThoughtPanel message={streamingAssistant} />
          )}
          {showTypingFallback && (
            <div className="copilot-typing flex items-center gap-2 text-[12px] text-[var(--text-muted)]" aria-live="polite">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{generationHint || '正在连接模型与准备上下文…'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
