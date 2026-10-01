/**
 * Split-pane behaviors — drag handlers, keyboard nudges, persisted widths.
 */
import type { CopilotState } from '@/features/copilot/components/useCopilotState';

export interface SplitHandlers {
  persistSessionsW: (n: number) => number;
  persistDetailsW: (n: number) => number;
  onSessionsSplitPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDetailsSplitPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onSessionsSplitKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onDetailsSplitKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}

export function buildSplitHandlers(s: CopilotState): SplitHandlers {
  const persistSessionsW = (n: number) => {
    const clamped = Math.min(420, Math.max(200, Math.round(n)));
    s.setSessionsPaneW(clamped);
    window.localStorage.setItem('copilot-sessions-w', String(clamped));
    return clamped;
  };

  const persistDetailsW = (n: number) => {
    const clamped = Math.min(520, Math.max(280, Math.round(n)));
    s.setDetailsPaneW(clamped);
    window.localStorage.setItem('copilot-details-w', String(clamped));
    return clamped;
  };

  const onSessionsSplitPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const shell = s.shellRef.current;
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    const styles = getComputedStyle(shell);
    const pad = parseFloat(styles.paddingLeft) || 0;
    s.setDraggingSplit('sessions');
    event.currentTarget.setPointerCapture(event.pointerId);
    const onMove = (m: PointerEvent) => persistSessionsW(m.clientX - rect.left - pad);
    const onUp = (u: PointerEvent) => {
      s.setDraggingSplit(null);
      try { event.currentTarget.releasePointerCapture(u.pointerId); } catch { /* ignore */ }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onDetailsSplitPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const shell = s.shellRef.current;
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    const styles = getComputedStyle(shell);
    const pad = parseFloat(styles.paddingRight) || 0;
    s.setDraggingSplit('details');
    event.currentTarget.setPointerCapture(event.pointerId);
    const onMove = (m: PointerEvent) => persistDetailsW(rect.right - pad - m.clientX);
    const onUp = (u: PointerEvent) => {
      s.setDraggingSplit(null);
      try { event.currentTarget.releasePointerCapture(u.pointerId); } catch { /* ignore */ }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onSessionsSplitKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); persistSessionsW(s.sessionsPaneW - 12); }
    if (e.key === 'ArrowRight') { e.preventDefault(); persistSessionsW(s.sessionsPaneW + 12); }
  };

  const onDetailsSplitKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!s.contextSelection.open) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); persistDetailsW(s.detailsPaneW + 12); }
    if (e.key === 'ArrowRight') { e.preventDefault(); persistDetailsW(s.detailsPaneW - 12); }
  };

  return {
    persistSessionsW, persistDetailsW,
    onSessionsSplitPointerDown, onDetailsSplitPointerDown,
    onSessionsSplitKeyDown, onDetailsSplitKeyDown,
  };
}
