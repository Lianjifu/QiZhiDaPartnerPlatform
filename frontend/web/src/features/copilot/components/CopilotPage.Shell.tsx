/**
 * CopilotPage.Shell — outer grid wrapper with scrim, split separators.
 */
import { cn } from '@qzda/web-utils';
import { useCopilotContext } from '@/features/copilot/components/useCopilotController';
import { CopilotPageSessionsAside } from '@/features/copilot/components/CopilotPage.SessionsAside';
import { CopilotPageConversation } from '@/features/copilot/components/CopilotPage.Conversation';
import { CopilotPageContextAside } from '@/features/copilot/components/CopilotPage.ContextAside';

export function CopilotPageShell() {
  const ctrl = useCopilotContext();
  const { s, detailsOpen, sessionsOpen, closeContext, gridTemplate,
    sessionsPaneW, detailsPaneW, columnMode, draggingSplit,
    onSessionsSplitPointerDown, onDetailsSplitPointerDown,
    onSessionsSplitKeyDown, onDetailsSplitKeyDown } = ctrl;

  return (
    <div
      ref={s.shellRef}
      className={cn('copilot-shell relative h-full min-h-0 min-w-0 bg-[var(--bg-elevated)]', draggingSplit && 'is-resizing')}
      data-sessions-open={sessionsOpen ? 'true' : 'false'}
      data-details-open={detailsOpen ? 'true' : 'false'}
      data-column-mode={columnMode}
      style={{
        ['--copilot-sessions-w' as string]: `${sessionsPaneW}px`,
        ['--copilot-details-w' as string]: `${detailsPaneW}px`,
        ['--copilot-grid-columns' as string]: gridTemplate.columns,
        ['--copilot-grid-areas' as string]: gridTemplate.areas ?? '',
      }}
    >
      {(sessionsOpen || detailsOpen) && (
        <button
          type="button"
          className="copilot-scrim"
          aria-label="关闭会话抽屉"
          onClick={() => { s.setSessionsOpen(false); closeContext(); }}
        />
      )}

      <CopilotPageSessionsAside />

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整会话列表宽度"
        aria-valuemin={200}
        aria-valuemax={420}
        aria-valuenow={sessionsPaneW}
        tabIndex={0}
        className={cn('copilot-split copilot-split--sessions', draggingSplit === 'sessions' && 'is-dragging')}
        onPointerDown={onSessionsSplitPointerDown}
        onKeyDown={onSessionsSplitKeyDown}
      >
        <span className="copilot-split__grip" aria-hidden="true" />
      </div>

      <CopilotPageConversation />

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整上下文抽屉宽度"
        aria-valuemin={280}
        aria-valuemax={520}
        aria-valuenow={detailsPaneW}
        tabIndex={0}
        className={cn('copilot-split copilot-split--details', draggingSplit === 'details' && 'is-dragging')}
        onPointerDown={onDetailsSplitPointerDown}
        onKeyDown={onDetailsSplitKeyDown}
      >
        <span className="copilot-split__grip" aria-hidden="true" />
      </div>

      <CopilotPageContextAside />
    </div>
  );
}
