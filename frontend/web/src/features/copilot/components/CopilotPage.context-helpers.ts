/**
 * Context drawer helpers — open/close/jump/switch/copy handlers.
 */
import type { NavigateFunction } from 'react-router-dom';
import type { ChatMessageEx } from '@/hooks/types';
import type { CopilotState } from '@/features/copilot/components/useCopilotState';
import type { WorkbenchContextTab } from '@/features/copilot/lib/workbench';
import { extractSkillArtifacts } from '@/features/copilot/lib/artifact-links';

export interface ContextHandlers {
  openContext: (tab: WorkbenchContextTab, messageId?: string, artifact?: any, options?: { startSlide?: number }) => void;
  closeContext: () => void;
  setContextTab: (tab: WorkbenchContextTab) => void;
  jumpToMessage: (messageId?: string) => void;
  switchSession: (id: string) => void;
  openCitation: (citation: any, messageId?: string) => void;
  copyMessage: (m: ChatMessageEx) => Promise<void>;
  switchActiveVariant: (mid: string, variantId: string) => Promise<void>;
  openAuditTab: (auditEventId: string) => void;
  openReplay: (conversationId: string, correlationId: string) => void;
}

export function messageHasContext(m?: ChatMessageEx) {
  return !!m && (
    (m.citations?.length ?? 0) > 0 || (m.toolCalls?.length ?? 0) > 0 || !!m.approvalRequest
    || !!m.linkedTaskId || (!!m.content && m.role !== 'user' && m.role !== 'tool'
      && extractSkillArtifacts(m.content).length > 0)
  );
}

export function buildContextHandlers(
  s: CopilotState,
  currentSession: any,
  navigate: NavigateFunction,
): ContextHandlers {
  const openContext = (
    tab: WorkbenchContextTab,
    messageId?: string,
    artifact?: any,
    options?: { startSlide?: number },
  ) => {
    const target = messageId ? currentSession?.messages.find((m: any) => m.id === messageId) : undefined;
    if (messageId && !target) return;
    if (messageId && !messageHasContext(target)) return;
    if (tab !== 'evidence' || messageId !== s.contextSelection.messageId) s.setFocusedCitation(null);
    s.setContextSelection((sel: any) => ({
      open: true,
      scope: messageId ? 'message' : 'session',
      tab,
      messageId,
      artifact: tab === 'document' ? artifact : undefined,
      startSlide: tab === 'document' ? options?.startSlide : undefined,
      pinned: sel.pinned,
    }));
    s.setSessionsOpen(false);
  };

  const closeContext = () => {
    s.setFocusedCitation(null);
    s.setContextSelection((sel: any) => ({ ...sel, open: false }));
  };

  const setContextTab = (tab: WorkbenchContextTab) => {
    if (tab !== 'evidence') s.setFocusedCitation(null);
    s.setContextSelection((sel: any) => ({
      ...sel, open: true, tab,
      artifact: tab === 'document' ? sel.artifact : undefined,
    }));
  };

  const jumpToMessage = (messageId?: string) => {
    if (!messageId) return;
    s.messageRefs.current[messageId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    s.setHoverMsgId(messageId);
    window.setTimeout(() => s.setHoverMsgId((cur: string | null) => cur === messageId ? null : cur), 1200);
  };

  const switchSession = (id: string) => {
    s.chat.switchSession(id);
    navigate(`/copilot/${id}`, { replace: true });
    s.setSessionsOpen(false);
    requestAnimationFrame(() => s.inputRef.current?.focus());
  };

  const openCitation = (citation: any, messageId?: string) => {
    openContext('evidence', messageId);
    s.setFocusedCitation(citation);
  };

  const copyMessage = async (m: ChatMessageEx) => {
    try {
      await navigator.clipboard.writeText(m.content);
      s.setCopiedId(m.id);
      setTimeout(() => s.setCopiedId(null), 1500);
    } catch { /* ignore */ }
  };

  const switchActiveVariant = async (mid: string, variantId: string) => {
    await s.chat.switchActiveVariant(mid, variantId);
  };

  const openAuditTab = (auditEventId: string) => {
    s.setContextSelection((sel: any) => ({ ...sel, open: true, tab: 'audit', auditEventId }));
  };

  const openReplay = (conversationId: string, correlationId: string) => {
    navigate(`/copilot/${currentSession?.id ?? conversationId}?replay=${encodeURIComponent(correlationId)}`);
  };

  return { openContext, closeContext, setContextTab, jumpToMessage, switchSession, openCitation, copyMessage, switchActiveVariant, openAuditTab, openReplay };
}
