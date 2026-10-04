/**
 * useCopilotEffects — all useEffect blocks for the Copilot page.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { employeePrimaryLabel } from '@/features/partners/lib/partners';
import { toast } from '@qzda/web-ui';
import { getApiClient } from '@qzda/web-api';
import type { ChatMessageEx } from '@/hooks/types';
import type { DigitalPartner } from '@qzda/web-types';
import { effectiveColumnMode, sessionHistoryPresentation } from '@/features/copilot/lib/layout';
import { resolveHydratedMessages } from '@/features/copilot/lib/conversation-merge';
import {
  defaultCopilotModelKey, isDemoCopilotModelKey, matchCopilotModelKey,
  resolveCopilotModelId,
} from '@/features/copilot/lib/copilot-models';
import {
  buildExpertTools, defaultEnabledToolKeys, ensureDefaultSkillsEnabled,
} from '@/features/copilot/lib/expert-tools';
import { deriveReasoningEffort, deriveRunMode } from '@/features/copilot/lib/composer-mode';
import { readCopilotLastSession } from '@/lib/copilot-workspace';
import { toChatSession, sessionInWorkspace, type SessionItem } from '@/features/copilot/components/CopilotPage.helpers';
import type { CopilotState } from '@/features/copilot/components/useCopilotState';

export interface UseCopilotEffectsParams {
  s: CopilotState;
  isAdmin: boolean;
  canMutate: boolean;
  activeSession: any;
  currentSession: any;
  activeEmployee: DigitalPartner | null;
  employeeBoundModel: string | null;
  availableTools: ReturnType<typeof buildExpertTools>;
  conversationFetchId: string | undefined;
  onDutyEmployees: DigitalPartner[];
  sendModelId: string | undefined;
  enabledToolKeySig: string;
  isGenerating: boolean;
}

export function useCopilotEffects(p: UseCopilotEffectsParams) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { id: routeSessionId } = useParams<{ id?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const employeeIdFromQuery = searchParams.get('employeeId');
  const currentUser = useAuthStore((state) => state.user);
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId ?? 'w1');

  // 切换工作区
  useEffect(() => {
    if (p.s.prevWorkspaceRef.current === currentWorkspaceId) return;
    p.s.prevWorkspaceRef.current = currentWorkspaceId;
    p.s.setHistoryReady(false);
    p.s.chat.clearActive();
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    void queryClient.invalidateQueries({
      predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'conversation',
    });
    if (routeSessionId) navigate('/copilot', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- p.s itself changes identity every render; setters + refs are stable.
  }, [currentWorkspaceId, queryClient, routeSessionId, navigate, p.s.prevWorkspaceRef, p.s.setHistoryReady, p.s.chat.clearActive]);

  // viewport resize
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => p.s.setViewportW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- p.s.setViewportW is a stable useState setter.
  }, [p.s.setViewportW]);

  // Esc handler
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (p.s.showSlash || p.s.showMention) {
        p.s.setShowSlash(false);
        if (p.s.showMention && p.s.mentionPane !== 'root') { p.s.setMentionPane('root'); return; }
        p.s.setShowMention(false); p.s.setMentionPane('root'); p.s.setMentionQuery('');
        return;
      }
      if (p.s.sessionsOpen) {
        p.s.setSessionsOpen(false); p.s.sessionToggleRef.current?.focus();
      } else if (p.s.contextSelection.open) {
        p.s.setContextSelection((sel: any) => ({ ...sel, open: false }));
        p.s.detailsToggleRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- p.s changes identity each render; only the keyboard binding needs to mount once.
  }, [p.s.showSlash, p.s.showMention, p.s.setShowSlash, p.s.setMentionPane, p.s.setShowMention, p.s.setMentionQuery, p.s.sessionsOpen, p.s.setSessionsOpen, p.s.sessionToggleRef, p.s.contextSelection.open, p.s.setContextSelection, p.s.detailsToggleRef]);

  // Keep sessions pinned on tablet/desktop
  useEffect(() => {
    const keep = () => {
      const should = sessionHistoryPresentation(window.innerWidth) === 'pinned';
      if (should !== p.s.sessionsOpen) p.s.setSessionsOpen(should);
    };
    keep();
    window.addEventListener('resize', keep);
    return () => window.removeEventListener('resize', keep);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- p.s.sessionsOpen/setSessionsOpen are the only deps that affect this; p.s itself changes identity each render.
  }, [p.s.sessionsOpen, p.s.setSessionsOpen]);

  // Focus input on session change
  useEffect(() => {
    setTimeout(() => p.s.inputRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- p.s.inputRef is a stable ref.
  }, [p.s.chat.state.activeId, p.s.inputRef]);

  // Auto-scroll messages
  useEffect(() => {
    if (p.s.scrollRef.current) {
      p.s.scrollRef.current.scrollTo({
        top: p.s.scrollRef.current.scrollHeight,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- p.s.scrollRef is a stable ref.
  }, [p.s.chat.activeSession?.messages.length, p.s.chat.state.typing, p.s.scrollRef]);

  // Close more-menu on outside click
  useEffect(() => {
    if (!p.s.moreMenuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (p.s.moreMenuRef.current && !p.s.moreMenuRef.current.contains(event.target as Node)) {
        p.s.setMoreMenuOpen(false); p.s.setExportSubOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointer);
    return () => window.removeEventListener('mousedown', onPointer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters + ref are stable.
  }, [p.s.moreMenuOpen, p.s.moreMenuRef, p.s.setMoreMenuOpen, p.s.setExportSubOpen]);

  // Merge server history into local sessions
  useEffect(() => {
    if (p.s.sessionsLoading && p.s.sessionHistoryData === undefined) return;
    if (p.s.sessionsError && p.s.sessionHistoryData === undefined) {
      p.s.setHistoryReady(true); return;
    }
    if (p.s.sessionHistoryData === undefined && p.s.sessionsFetching) return;
    p.s.chat.importSessions(p.s.sessionHistory.map(toChatSession), {
      workspaceId: currentWorkspaceId,
      reconcile: Array.isArray(p.s.sessionHistoryData) && p.s.sessionHistoryData.length > 0,
    });
    if (!p.s.historyReady) p.s.setHistoryReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when server data actually changes; p.s itself changes identity each render.
  }, [p.s.sessionsLoading, p.s.sessionHistoryData, p.s.sessionsError, p.s.sessionsFetching, p.s.sessionHistory, p.s.historyReady, p.s.setHistoryReady, p.s.chat.importSessions, queryClient, currentWorkspaceId]);

  // Recovery effect on typing edge
  useEffect(() => {
    const wasTyping = p.s.typingWasRef.current;
    p.s.typingWasRef.current = p.s.chat.state.typing;
    if (!wasTyping || p.s.chat.state.typing) return;
    if (!p.conversationFetchId || /^s_/.test(p.conversationFetchId)) return;
    void queryClient.invalidateQueries({ queryKey: ['conversation', p.conversationFetchId, currentWorkspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['sessions'] });
  }, [p.s.chat.state.typing, p.conversationFetchId, currentWorkspaceId, queryClient, p.s]);

  // Recover pending turns on mount/reload
  useEffect(() => {
    if (!p.s.historyReady || !p.s.chat.state.activeId) return;
    const sess = p.s.chat.state.sessions[p.s.chat.state.activeId];
    if (!sess) return;
    const needs = Boolean(sess.pendingTurn) || sess.messages.some((m: any) => m.status === 'in_flight');
    if (!needs || p.s.chat.state.typing) return;
    void p.s.chat.recoverPendingTurn(p.s.chat.state.activeId).then((outcome) => {
      if (outcome === 'done' && p.conversationFetchId && !/^s_/.test(p.conversationFetchId)) {
        void queryClient.invalidateQueries({ queryKey: ['conversation', p.conversationFetchId, currentWorkspaceId] });
        void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      }
    });
  }, [p.s, p.conversationFetchId, currentWorkspaceId, queryClient]);

  // Deep link URL → state
  useEffect(() => {
    if (!p.s.historyReady || !routeSessionId) return;
    if (routeSessionId === p.s.chat.state.activeId) return;
    const local = p.s.chat.state.sessions[routeSessionId];
    const fromServer = p.s.sessionHistory.find((item: SessionItem) => item.id === routeSessionId);
    if (!local && !fromServer) return;
    if (!sessionInWorkspace(local ?? fromServer, currentWorkspaceId)) return;
    p.s.chat.switchSession(routeSessionId);
  }, [p.s.historyReady, routeSessionId, p.s.chat.state.activeId, p.s.chat.switchSession, p.s.sessionHistory, currentWorkspaceId, p.s.chat.state.sessions, p.s]);

  // URL sync state → URL
  useEffect(() => {
    if (!p.s.historyReady || !p.s.chat.state.activeId) return;
    if (routeSessionId === p.s.chat.state.activeId) return;
    const active = p.s.chat.state.sessions[p.s.chat.state.activeId];
    if (!sessionInWorkspace(active, currentWorkspaceId)) return;
    if (routeSessionId) {
      const routeLocal = p.s.chat.state.sessions[routeSessionId];
      const routeServer = p.s.sessionHistory.find((item: SessionItem) => item.id === routeSessionId);
      if ((routeLocal || routeServer) && sessionInWorkspace(routeLocal ?? routeServer, currentWorkspaceId)) return;
    }
    navigate(`/copilot/${p.s.chat.state.activeId}`, { replace: true });
  }, [p.s.historyReady, p.s.chat.state.activeId, routeSessionId, navigate, p.s.chat.state.sessions, p.s.sessionHistory, currentWorkspaceId, p.s]);

  // Deep link ?employeeId=
  useEffect(() => {
    if (!p.s.historyReady || !employeeIdFromQuery) return;
    if (p.s.deepLinkHandled.current === employeeIdFromQuery) return;
    const employee = p.s.employees.find((item: DigitalPartner) => item.id === employeeIdFromQuery);
    if (!employee) return;
    p.s.deepLinkHandled.current = employeeIdFromQuery;
    if (employee.lifecycle !== 'active') { p.s.setExpertPickerOpen(true); return; }
    const existing = Object.values(p.s.chat.state.sessions).find(
      (session: any) => session.digitalPartnerId === employee.id && session.status === 'active' && sessionInWorkspace(session, currentWorkspaceId),
    );
    if (existing) {
      p.s.chat.switchSession(existing.id);
    } else if (p.canMutate) {
      void p.s.chat.newSession({
        digitalPartnerId: employee.id,
        digitalPartnerName: employeePrimaryLabel(employee),
        agentKey: employee.capabilities.agentId,
        modelId: p.sendModelId,
        enabledTools: p.s.enabledTools.length ? p.s.enabledTools : defaultEnabledToolKeys(p.availableTools),
      }).then((id) => {
        if (id) navigate(`/copilot/${id}`, { replace: true });
      }).catch((err) => {
        toast.error(err instanceof Error ? err.message : '创建会话失败，请重试');
      });
    }
    setSearchParams({}, { replace: true });
  }, [p.s.historyReady, employeeIdFromQuery, p.s.employees, p.s.chat.state.sessions, p.s.chat.switchSession, p.s.chat.newSession, navigate, setSearchParams, p.canMutate, currentWorkspaceId, p.sendModelId, p.s.enabledTools, p.availableTools, p.s]);

  // Restore toolchain on session / tool list change
  useEffect(() => {
    const seed = p.activeSession?.enabledTools?.length ? p.activeSession.enabledTools : [];
    const next = ensureDefaultSkillsEnabled(seed, p.availableTools);
    const same = p.s.enabledTools.length === next.length && p.s.enabledTools.every((k, i) => k === next[i]);
    if (!same) p.s.setEnabledTools(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- p.s itself is now stable via useMemo; p.activeSession identity changes each useChat render.
  }, [p.activeSession?.id, p.enabledToolKeySig, p.s.enabledTools, p.s.setEnabledTools, p.availableTools]);

  // Cleanup invalid digitalPartnerId
  useEffect(() => {
    if (!p.s.employeesData || !p.activeSession?.digitalPartnerId || p.activeEmployee) return;
    p.s.chat.syncSession({
      ...p.activeSession,
      digitalPartnerId: undefined,
      digitalPartnerName: undefined,
      agent: '助手',
      agentKey: undefined,
    });
  }, [p.s.employeesData, p.activeSession, p.activeEmployee, p.s.chat.syncSession]);

  // Restore risk/handoff/closed on session change
  useEffect(() => {
    if (!p.currentSession) return;
    const nextRisk = p.currentSession.riskLevel === 'high' || p.currentSession.riskLevel === 'low' ? p.currentSession.riskLevel : 'medium';
    if (p.s.riskLevel !== nextRisk) p.s.setRiskLevel(nextRisk);
    const h = p.currentSession.handoff;
    const nextHandoffActive = Boolean(h?.active);
    if (p.s.handoffActive !== nextHandoffActive) p.s.setHandoffActive(nextHandoffActive);
    if (h?.ownerName && p.s.handoffOwner !== h.ownerName) p.s.setHandoffOwner(h.ownerName);
    const nextClosed = p.currentSession.status === 'closed' || p.currentSession.status === 'done'
      || p.currentSession.status === 'archived' || p.currentSession.lifecycle === 'archived'
      || p.currentSession.lifecycle === 'deleted';
    if (p.s.isClosed !== nextClosed) p.s.setIsClosed(nextClosed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- p.s is memoized; p.currentSession identity changes each useChat render but primitives guard the writes.
  }, [p.currentSession?.id, p.s.riskLevel, p.s.handoffActive, p.s.handoffOwner, p.s.isClosed, p.s.setRiskLevel, p.s.setHandoffActive, p.s.setHandoffOwner, p.s.setIsClosed]);

  // Sync handoff/closed on governance field updates
  useEffect(() => {
    if (!p.currentSession) return;
    const h = p.currentSession.handoff;
    const nextHandoffActive = Boolean(h?.active);
    if (p.s.handoffActive !== nextHandoffActive) p.s.setHandoffActive(nextHandoffActive);
    const nextClosed = p.currentSession.status === 'closed' || p.currentSession.status === 'done'
      || p.currentSession.status === 'archived' || p.currentSession.lifecycle === 'archived'
      || p.currentSession.lifecycle === 'deleted';
    if (p.s.isClosed !== nextClosed) p.s.setIsClosed(nextClosed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.currentSession?.handoff?.active, p.currentSession?.status, p.currentSession?.lifecycle, p.s.handoffActive, p.s.isClosed, p.s.setHandoffActive, p.s.setIsClosed]);

  // Restore Composer mode on session change
  useEffect(() => {
    if (!p.activeSession) {
      if (p.s.runMode !== 'ask') p.s.setRunMode('ask');
      if (p.s.reasoningEffort !== 'standard') p.s.setReasoningEffort('standard');
      return;
    }
    const nextRun = deriveRunMode({ runMode: p.activeSession.runMode, sessionMode: p.activeSession.sessionMode });
    if (p.s.runMode !== nextRun) p.s.setRunMode(nextRun);
    const nextEffort = deriveReasoningEffort({
      reasoningEffort: p.activeSession.reasoningEffort,
      runMode: nextRun,
    });
    if (p.s.reasoningEffort !== nextEffort) p.s.setReasoningEffort(nextEffort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.activeSession?.id, p.activeSession?.runMode, p.activeSession?.sessionMode, p.activeSession?.reasoningEffort, p.s.runMode, p.s.reasoningEffort, p.s.setRunMode, p.s.setReasoningEffort]);

  // Restore model on session change
  useEffect(() => {
    if (p.activeSession?.modelId) {
      const match = p.s.modelOptions.find(
        (m: any) => m.key === p.activeSession.modelId || m.modelId === p.activeSession.modelId || m.apiModel === p.activeSession.modelId || m.label === p.activeSession.modelId,
      );
      const next = match?.key ?? p.activeSession.modelId;
      if (p.s.currentModelKey !== next) p.s.setCurrentModelKey(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.activeSession?.id, p.activeSession?.modelId, p.s.modelOptions, p.s.currentModelKey, p.s.setCurrentModelKey]);

  // Switch to default model if currentModelKey invalid
  useEffect(() => {
    if (!p.s.modelOptions.length) return;
    if (!p.s.modelOptions.some((m: any) => m.key === p.s.currentModelKey)) {
      p.s.setCurrentModelKey(defaultCopilotModelKey(p.s.modelOptions));
    }
  }, [p.s.modelOptions, p.s.currentModelKey, p.s]);

  // After binding expert: switch to employee-bound model
  useEffect(() => {
    const empKey = matchCopilotModelKey(p.s.modelOptions, p.employeeBoundModel);
    if (!empKey) return;
    if (p.s.currentModelKey === empKey) return;
    if (isDemoCopilotModelKey(p.s.currentModelKey) || !p.activeSession?.modelId || isDemoCopilotModelKey(p.activeSession.modelId)) {
      p.s.setCurrentModelKey(empKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.employeeBoundModel, p.s.modelOptions, p.activeSession?.id, p.activeSession?.modelId, p.s.currentModelKey, p.s.setCurrentModelKey]);

  // Strip write tools when session mode is investigate
  const sessionMode = p.activeSession?.sessionMode === 'execute' ? 'execute' : 'investigate';
  useEffect(() => {
    if (sessionMode !== 'investigate') return;
    const writeKeys = new Set(p.availableTools.filter((t) => t.requiresApproval).map((t) => t.key));
    const hasWrite = p.s.enabledTools.some((k) => writeKeys.has(k));
    if (!hasWrite) return;
    p.s.setEnabledTools((prev: string[]) => prev.filter((key) => !writeKeys.has(key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionMode, p.availableTools, p.s.enabledTools, p.s.setEnabledTools]);

  // Generation timer
  useEffect(() => {
    if (!p.isGenerating) { p.s.setGenerationStartedAt(null); return; }
    p.s.setGenerationStartedAt((prev: number | null) => prev ?? Date.now());
    const timer = window.setInterval(() => p.s.setGenerationTick((v: number) => v + 1), 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.isGenerating, p.s.setGenerationStartedAt, p.s.setGenerationTick]);

  // Auto-select active session
  useEffect(() => {
    if (!p.s.historyReady || p.s.sessionsLoading) return;
    if (p.s.chat.state.typing) return;
    const visible = Object.values(p.s.chat.state.sessions).filter((session: any) => sessionInWorkspace(session, currentWorkspaceId));
    if (p.s.chat.state.activeId && visible.some((session: any) => session.id === p.s.chat.state.activeId)) return;
    if (routeSessionId) {
      const routeLocal = p.s.chat.state.sessions[routeSessionId];
      if (routeLocal && sessionInWorkspace(routeLocal, currentWorkspaceId)) {
        if (p.s.chat.state.activeId !== routeSessionId) p.s.chat.switchSession(routeSessionId);
        return;
      }
    }
    const remembered = readCopilotLastSession(currentWorkspaceId);
    if (remembered && visible.some((session: any) => session.id === remembered)) {
      p.s.chat.switchSession(remembered);
      if (routeSessionId !== remembered) navigate(`/copilot/${remembered}`, { replace: true });
      return;
    }
    if (routeSessionId && visible.some((session: any) => session.id === routeSessionId)) {
      p.s.chat.switchSession(routeSessionId);
      return;
    }
    if (visible[0]?.id) {
      p.s.chat.switchSession(visible[0].id);
      if (routeSessionId !== visible[0].id) navigate(`/copilot/${visible[0].id}`, { replace: true });
      return;
    }
    if (p.s.chat.state.activeId) p.s.chat.clearActive();
    if (routeSessionId) navigate('/copilot', { replace: true });
  }, [p.s.historyReady, p.s.sessionsLoading, p.s.chat.state.typing, p.s.chat.state.activeId, p.s.chat.state.sessions, currentWorkspaceId, p.s.chat.switchSession, p.s.chat.clearActive, navigate, routeSessionId, p.s]);

  // Cmd/Ctrl+Shift+E context drawer
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== 'e') return;
      event.preventDefault();
      const canOpen = Boolean(p.currentSession);
      if (!canOpen) return;
      if (p.s.contextSelection.open) {
        p.s.setContextSelection((sel: any) => ({ ...sel, open: false }));
      } else {
        p.s.setContextSelection((sel: any) => ({ ...sel, open: true, tab: 'overview' }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [p.s.contextSelection.open, p.currentSession, p.s]);

  // localStorage: persist context selection per session
  useEffect(() => {
    if (!p.currentSession?.id || typeof window === 'undefined') return;
    if (!p.s.contextSelection.open) {
      window.localStorage.removeItem(`copilot-context:${p.currentSession.id}`);
      return;
    }
    window.localStorage.setItem(`copilot-context:${p.currentSession.id}`, JSON.stringify(p.s.contextSelection));
  }, [p.s.contextSelection, p.currentSession?.id]);

  // Hydrate context selection from localStorage on session change
  useEffect(() => {
    if (!p.currentSession?.id || typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(`copilot-context:${p.currentSession.id}`);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved.open || (saved.scope !== 'message' && saved.scope !== 'session')) return;
      const validTabs = ['overview', 'document', 'evidence', 'tasks', 'approvals', 'audit', 'admin'];
      p.s.setContextSelection({
        open: true,
        scope: saved.scope,
        messageId: saved.messageId,
        tab: validTabs.includes(saved.tab) ? saved.tab : 'overview',
        pinned: !!saved.pinned,
      });
    } catch {
      window.localStorage.removeItem(`copilot-context:${p.currentSession.id}`);
    }
  }, [p.currentSession?.id, p.s]);
}
