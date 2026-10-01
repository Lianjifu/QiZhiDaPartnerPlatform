/**
 * useCopilotController — top-level hook composing state, actions, effects,
 * and providing a context value consumed by CopilotPage sub-components.
 */
import { createContext, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, BellOff, BookOpenCheck, BriefcaseBusiness, FileText, ListChecks,
  Search, Server, ShieldCheck, Users, Wrench, Zap,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useApiQuery } from '@/services/query';
import {
  compareDigitalPartners, employeePrimaryLabel, employeeSecondaryLabel,
} from '@/lib/partners';
import { computeContextUsage } from '@/features/copilot/lib/composer-context';
import { buildExpertSuggestions, type ExpertSuggestionIcon } from '@/features/copilot/lib/expert-suggestions';
import {
  buildExpertTools, defaultEnabledToolKeys, type CopilotToolDef,
} from '@/features/copilot/lib/expert-tools';
import { resolveSendModelId } from '@/features/copilot/lib/copilot-models';
import { collapseDuplicateArtifactSegments } from '@/features/copilot/lib/artifact-segment';
import { extractSkillArtifacts } from '@/features/copilot/lib/artifact-links';
import { deriveWorkbenchSummary, type WorkbenchContextTab } from '@/features/copilot/lib/workbench';
import { deriveExpertContextOverview, deriveTurnProgress } from '@/features/copilot/lib/expert-context';
import { sortSessionsByRecency } from '@/features/copilot/lib/session-sort';
import {
  effectiveColumnMode, gridTemplateForMode, type ColumnMode,
} from '@/features/copilot/lib/layout';
import {
  sessionInWorkspace, type AgentMeta, type CurrentUserIdentity,
} from '@/features/copilot/components/CopilotPage.helpers';
import { useCopilotState, type CopilotState } from '@/features/copilot/components/useCopilotState';
import { useCopilotActions, type CopilotActions } from '@/features/copilot/components/useCopilotActions';
import { useCopilotEffects } from '@/features/copilot/components/useCopilotEffects';
import { buildComposerHandlers, type ComposerHandlers } from '@/features/copilot/components/CopilotPage.composer-helpers';
import { buildSplitHandlers, type SplitHandlers } from '@/features/copilot/components/CopilotPage.split-helpers';
import {
  buildContextHandlers, messageHasContext, type ContextHandlers,
} from '@/features/copilot/components/CopilotPage.context-helpers';
import type { ChatMessageEx } from '@/hooks/types';
import type { DigitalPartner } from '@qzda/web-types';
import type { MentionKind } from '@/features/copilot/lib/mentions';


export type CopilotController = {
  s: CopilotState;
  isAdmin: boolean;
  canMutate: boolean;
  currentUser: CurrentUserIdentity | null;
  onDutyEmployees: DigitalPartner[];
  activeEmployee: DigitalPartner | null;
  hasBoundExpert: boolean;
  availableTools: CopilotToolDef[];
  sendModelId: string | undefined;
  activeSession: any;
  currentSession: any;
  sessionMode: 'investigate' | 'execute';
  expertName: string;
  expertMeta: string | null;
  expertDescription: string;
  expertSuggestions: ReturnType<typeof buildExpertSuggestions>;
  suggestionIconMap: Record<ExpertSuggestionIcon, any>;
  agentMeta: AgentMeta;
  isGenerating: boolean;
  generationHint: string;
  generationElapsedSec: number;
  streamingAssistant: ChatMessageEx | null;
  displayMessages: ChatMessageEx[];
  filteredSessions: any[];
  grouped: Record<'pinned' | 'today' | 'yesterday' | 'week' | 'earlier', any[]>;
  filteredExperts: DigitalPartner[];
  hasSessionContext: boolean;
  hasSelectedContext: boolean;
  canOpenExpertContext: boolean;
  workbench: ReturnType<typeof deriveWorkbenchSummary>;
  contextSummary: ReturnType<typeof deriveWorkbenchSummary>;
  sessionExpertContext: ReturnType<typeof deriveExpertContextOverview>;
  messageExpertContext: ReturnType<typeof deriveExpertContextOverview> | null;
  turnProgress: ReturnType<typeof deriveTurnProgress>;
  sessionUsage: { tokens: number; priced: number | null };
  sessionSignals: { executions: number; pendingApprovals: number; evidence: number };
  charCount: number;
  contextUsage: ReturnType<typeof computeContextUsage>;
  mentionSkillItems: any[];
  mentionExpertItems: any[];
  mentionDocItems: any[];
  mentionMemberItems: any[];
  slashGrouped: Record<string, any[]>;
  slashFiltered: any[];
  showTypingFallback: boolean;
  selectedDocumentArtifact: ReturnType<typeof extractSkillArtifacts>[number] | undefined;
  hasStreamingAssistant: boolean;
  hasPendingTurn: boolean;
  sessionFetchId: string | undefined;
  canFetchConversation: boolean;
  conversationMissing: boolean;
  visibleContextTabs: { tab: WorkbenchContextTab; label: string; count?: number }[];
  selectedContextMessage: ChatMessageEx | undefined;
  contextMessages: ChatMessageEx[];
  detailsOpen: boolean;
  contextTab: WorkbenchContextTab;
  sessionsOpen: boolean;
  sessionsPaneW: number;
  detailsPaneW: number;
  draggingSplit: 'sessions' | 'details' | null;
  columnMode: ColumnMode;
  gridTemplate: ReturnType<typeof gridTemplateForMode>;
  detailsPinned: boolean;
  actions: CopilotActions;
} & ContextHandlers & ComposerHandlers & SplitHandlers;

export const CopilotContext = createContext<CopilotController | null>(null);

export function useCopilotContext(): CopilotController {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error('useCopilotContext must be used inside CopilotContext.Provider');
  return ctx;
}

export function useCopilotController(): CopilotController {
  const s = useCopilotState();
  const navigate = useNavigate();
  const currentUser = useAuthStore((state: any) => state.user);
  const isAdmin = currentUser?.role === 'admin';
  const canMutate = currentUser?.role === 'admin' || currentUser?.role === 'user';

  // Base derived
  const onDutyEmployees = useMemo(
    () => s.employees.filter((item) => item.lifecycle === 'active').sort(compareDigitalPartners),
    [s.employees],
  );
  const activeSession = s.chat.activeSession;
  const currentSession = activeSession && sessionInWorkspace(activeSession, s.currentWorkspaceId)
    ? activeSession : undefined;
  const activeEmployeeId = activeSession?.digitalPartnerId ?? undefined;
  const activeEmployee = s.employees.find((item) => item.id === activeEmployeeId) ?? null;
  const hasBoundExpert = Boolean(activeEmployee);
  const employeeBoundModel = activeEmployee?.capabilities?.model ?? null;
  const availableTools = useMemo(() => buildExpertTools(activeEmployee), [activeEmployee]);
  const sendModelId = resolveSendModelId({
    runModelId: s.runModelId,
    runKey: s.currentModelKey,
    employeeBoundModel,
    options: s.modelOptions,
  });
  const sessionMode: 'investigate' | 'execute' = activeSession?.sessionMode === 'execute' ? 'execute' : 'investigate';

  // Conversation fetch
  const serverSession = useMemo(
    () => s.sessionHistory.find((item) => item.id === s.chat.state.activeId),
    [s.sessionHistory, s.chat.state.activeId],
  );
  const conversationFetchId = activeSession?.conversationId
    || (serverSession ? (serverSession.conversationId || serverSession.id) : undefined);
  const canFetchConversation = Boolean(conversationFetchId)
    && !/^s_/.test(conversationFetchId ?? '')
    && !s.chat.isConversationDeleted(conversationFetchId)
    && sessionInWorkspace(activeSession, s.currentWorkspaceId);
  const { isError: conversationMissing } = useApiQuery<any>(
    ['conversation', conversationFetchId, s.currentWorkspaceId],
    `/api/conversations/${conversationFetchId ?? '__none__'}`,
    undefined,
    { enabled: canFetchConversation, retry: false, staleTime: 0 },
  );

  // Actions
  const actions = useCopilotActions({
    s, isAdmin, canMutate, sendModelId, activeEmployee, onDutyEmployees,
    currentSession, activeSession, sessionMode,
  });

  // Workbench + contexts
  const workbench = useMemo(() => deriveWorkbenchSummary(currentSession), [currentSession]);
  const selectedContextMessage = useMemo(
    () => s.contextSelection.scope === 'message' && s.contextSelection.messageId
      ? currentSession?.messages.find((m: any) => m.id === s.contextSelection.messageId)
      : undefined,
    [s.contextSelection.messageId, s.contextSelection.scope, currentSession],
  );
  const contextMessages = useMemo(
    () => selectedContextMessage ? [selectedContextMessage] : currentSession?.messages ?? [],
    [currentSession, selectedContextMessage],
  );
  const contextSummary = useMemo(
    () => currentSession
      ? deriveWorkbenchSummary({ title: currentSession.title, messages: contextMessages })
      : workbench,
    [contextMessages, currentSession, workbench],
  );
  const sessionExpertContext = useMemo(
    () => deriveExpertContextOverview(currentSession?.messages ?? []),
    [currentSession?.messages],
  );
  const messageExpertContext = useMemo(
    () => (selectedContextMessage ? deriveExpertContextOverview([selectedContextMessage]) : null),
    [selectedContextMessage],
  );
  const turnProgress = useMemo(
    () => deriveTurnProgress(selectedContextMessage ?? currentSession?.messages.filter((m: any) => m.role === 'assistant').at(-1)),
    [selectedContextMessage, currentSession?.messages],
  );

  // Generation state
  const hasStreamingAssistant = Boolean(
    currentSession?.messages.some((m: any) => m.role === 'assistant' && (m.status === 'streaming' || m.status === 'in_flight')),
  );
  const hasPendingTurn = Boolean(currentSession?.pendingTurn);
  const isGenerating = s.chat.state.typing || hasStreamingAssistant || hasPendingTurn;
  const streamingAssistant = useMemo(
    () => currentSession?.messages.find((m: any) => m.role === 'assistant' && (m.status === 'streaming' || m.status === 'in_flight')) ?? null,
    [currentSession?.messages],
  );
  const generationElapsedSec = s.generationStartedAt
    ? Math.max(0, Math.floor((Date.now() - s.generationStartedAt) / 1000))
    : 0;
  const latestReasoningTitle = streamingAssistant?.reasoningSteps?.[streamingAssistant.reasoningSteps.length - 1]?.title;
  const generationHint = !isGenerating
    ? ''
    : streamingAssistant?.progressHint
      ? `正在执行：${streamingAssistant.progressHint}`
      : latestReasoningTitle
        ? `正在执行：${latestReasoningTitle}`
        : generationElapsedSec >= 20
          ? '任务较复杂，仍在处理中。可继续等待，或点击停止后重试。'
          : generationElapsedSec >= 6
            ? '模型与工具链处理中，首段内容即将出现…'
            : '已收到请求，正在连接模型与准备上下文…';
  const showTypingFallback = s.chat.state.typing && !hasStreamingAssistant;

  // Messages / sessions
  const displayMessages = useMemo(
    () => collapseDuplicateArtifactSegments(currentSession?.messages ?? []),
    [currentSession?.messages],
  );
  const filteredSessions = useMemo(() => {
    const list = Object.values(s.chat.state.sessions).filter((session: any) => sessionInWorkspace(session, s.currentWorkspaceId));
    const q = s.searchQ.trim().toLowerCase();
    return sortSessionsByRecency(
      list.filter((session: any) => !q || session.title.toLowerCase().includes(q) || session.preview.toLowerCase().includes(q)),
    );
  }, [s.chat.state.sessions, s.currentWorkspaceId, s.searchQ]);
  const grouped = useMemo(() => ({
    pinned: filteredSessions.filter((session: any) => session.pinned),
    today: filteredSessions.filter((session: any) => !session.pinned && session.group === 'today'),
    yesterday: filteredSessions.filter((session: any) => !session.pinned && session.group === 'yesterday'),
    week: filteredSessions.filter((session: any) => !session.pinned && session.group === 'week'),
    earlier: filteredSessions.filter((session: any) => !session.pinned && session.group === 'earlier'),
  }), [filteredSessions]);

  // Usage + cost
  const charCount = s.chat.state.draftInput.length;
  const contextUsage = useMemo(() => {
    const msgs = activeSession?.messages ?? [];
    const lastAssistant = [...msgs].reverse().find((m: any) => m.role === 'assistant');
    const promptTokens = lastAssistant?.metrics?.promptTokens;
    const sessionTokens = msgs.reduce((sum: number, m: any) => {
      const p = m.metrics?.promptTokens ?? 0;
      const c = m.metrics?.completionTokens ?? 0;
      return sum + p + c;
    }, 0);
    const historyChars = msgs.reduce((sum: number, m: any) => sum + (m.content?.length ?? 0), 0);
    return computeContextUsage({
      promptTokens,
      sessionTokens: sessionTokens || null,
      contextWindow: s.currentModel?.contextWindow,
      draftChars: charCount,
      historyChars,
    });
  }, [activeSession?.messages, charCount, s.currentModel?.contextWindow]);

  // Mention items
  const mentionSkillItems = useMemo(
    () => availableTools.filter((t) => t.kind === 'skill' || t.kind === 'tool' || t.kind === 'workflow'),
    [availableTools],
  );
  const mentionExpertItems = useMemo(
    () => s.employees.filter((e) => e.lifecycle === 'active' || e.release?.status === 'released').map((e) => ({
      key: e.id, name: e.role || e.name, label: e.name, desc: `${e.department} · ${e.name}`,
    })),
    [s.employees],
  );
  const mentionDocItems = useMemo(
    () => (activeEmployee?.capabilities?.knowledge ?? []).map((name) => ({ key: name, name, desc: '已装配知识库' })),
    [activeEmployee],
  );
  const mentionMemberItems = useMemo(() => {
    const names = Array.from(new Set(
      [activeEmployee?.owner, activeEmployee?.escalationOwner, '王昊', '李婷'].filter(Boolean) as string[],
    ));
    return names.map((name) => ({ key: name, name, desc: '协作成员' }));
  }, [activeEmployee]);

  const slashGrouped = useMemo(() => {
    const g: Record<string, any[]> = { agent: [], kb: [], task: [], tool: [], collab: [] };
    actions.slashFiltered.forEach((c: any) => { g[c.category]?.push(c); });
    return g;
  }, [actions.slashFiltered]);

  const sessionUsage = useMemo(() => {
    const messages = currentSession?.messages ?? [];
    const tokens = messages.reduce((sum: number, message: any) => sum + (message.metrics?.promptTokens ?? 0) + (message.metrics?.completionTokens ?? 0), 0);
    const priced = tokens > 0 ? Number(((tokens / 1000) * (s.riskLevel === 'high' ? 0.08 : 0.045)).toFixed(2)) : null;
    return { tokens, priced };
  }, [currentSession, s.riskLevel]);
  const sessionSignals = useMemo(() => {
    const messages = currentSession?.messages ?? [];
    const executions = messages.reduce((total: number, message: any) => total + (message.toolCalls?.length ?? 0), 0);
    const pendingApprovals = messages.filter((message: any) => message.approvalRequest?.decision === 'pending').length;
    const evidence = messages.reduce((total: number, message: any) => total + (message.citations?.length ?? 0), 0);
    return { executions, pendingApprovals, evidence };
  }, [currentSession]);

  // Layout
  const detailsPinned = s.contextSelection.pinned;
  const columnMode: ColumnMode = effectiveColumnMode(
    { width: s.viewportW, height: typeof window === 'undefined' ? 900 : window.innerHeight },
    { sessions: s.sessionsOpen, main: true, details: s.contextSelection.open },
    detailsPinned,
  );
  const gridTemplate = gridTemplateForMode(columnMode, undefined, {
    sessions: s.sessionsPaneW,
    details: s.detailsPaneW,
  });

  // Composed handlers
  const contextHandlers = useMemo(
    () => buildContextHandlers(s, currentSession, navigate),
    [s, currentSession, navigate],
  );
  const composer = useMemo(
    () => buildComposerHandlers(s, availableTools, sendModelId, actions),
    [s, availableTools, sendModelId, actions],
  );
  const splits = useMemo(() => buildSplitHandlers(s), [s]);

  // Document artifact for context drawer
  const selectedDocumentArtifact = useMemo(() => {
    if (s.contextSelection.artifact) return s.contextSelection.artifact;
    for (const message of contextMessages) {
      if (!message.content || message.role === 'user' || message.role === 'tool') continue;
      const items = extractSkillArtifacts(message.content);
      if (items.length > 0) return items[0];
    }
    return undefined;
  }, [contextMessages, s.contextSelection.artifact]);

  // Context gating
  const hasSessionContext = workbench.evidence + workbench.linkedTasks + workbench.pendingApprovals + workbench.executions + workbench.documents > 0;
  const hasSelectedContext = !!selectedContextMessage && messageHasContext(selectedContextMessage);
  const canOpenExpertContext = Boolean(currentSession && (activeEmployee || currentSession.digitalPartnerId || hasSessionContext));

  const visibleContextTabs: { tab: WorkbenchContextTab; label: string; count?: number }[] = [
    { tab: 'overview', label: '概览' },
    ...(contextSummary.documents > 0 ? [{ tab: 'document' as const, label: '文档', count: contextSummary.documents }] : []),
    ...(contextSummary.evidence > 0 ? [{ tab: 'evidence' as const, label: '证据', count: contextSummary.evidence }] : []),
    ...(contextSummary.linkedTasks > 0 ? [{ tab: 'tasks' as const, label: '任务', count: contextSummary.linkedTasks }] : []),
    ...(contextSummary.pendingApprovals > 0 ? [{ tab: 'approvals' as const, label: '审批', count: contextSummary.pendingApprovals }] : []),
    ...(contextSummary.executions > 0 ? [{ tab: 'audit' as const, label: '审计', count: contextSummary.executions }] : []),
    ...(s.contextSelection.tab === 'admin' ? [{ tab: 'admin' as const, label: '运行控制' }] : []),
  ];

  const suggestionIconMap: Record<ExpertSuggestionIcon, any> = useMemo(() => ({
    zap: Zap, server: Server, shield: ShieldCheck, bell: BellOff,
    users: Users, file: FileText, clipboard: ListChecks, book: BookOpenCheck,
    activity: Activity, briefcase: BriefcaseBusiness, search: Search, wrench: Wrench,
  }), []);

  const expertName = hasBoundExpert ? employeePrimaryLabel(activeEmployee!) : (s.currentModel?.label ?? '助手');
  const expertMeta = hasBoundExpert ? employeeSecondaryLabel(activeEmployee!) : null;
  const expertDescription = hasBoundExpert
    ? (activeEmployee!.description ?? '选择在岗数字伙伴后开始专家协作。')
    : '未绑定数字伙伴，将以通用助手直接调用已选模型。可点选专家后改绑。';
  const expertSuggestions = useMemo(
    () => (activeEmployee ? buildExpertSuggestions(activeEmployee) : []),
    [activeEmployee],
  );
  const agentMeta: AgentMeta = useMemo(() => ({
    id: activeEmployee?.capabilities.agentId ?? 'runtime',
    name: expertName,
    category: activeEmployee?.department ?? (hasBoundExpert ? '专家团队' : '通用助手'),
    version: activeEmployee?.version ?? '—',
    rating: 0, ratingCount: 0, lastActive: '—', installCount: 0,
    responseP95: activeEmployee?.runtime.p95Ms ?? 0,
    totalTokens: 0,
    sla: activeEmployee ? Number((activeEmployee.runtime.successRate * 100).toFixed(1)) : 0,
    errorRate: activeEmployee ? Math.max(0, 1 - activeEmployee.runtime.successRate) : 0,
    knowledgeBases: activeEmployee?.capabilities.knowledge.length ?? 0,
    tools: (activeEmployee?.capabilities.tools.length ?? 0) + (activeEmployee?.capabilities.skills.length ?? 0),
    languages: ['zh-CN'],
    description: expertDescription,
  }), [activeEmployee, expertName, expertDescription, hasBoundExpert]);

  // Side-effects
  useCopilotEffects({
    s, isAdmin, canMutate,
    activeSession, currentSession, activeEmployee, employeeBoundModel, availableTools,
    conversationFetchId, onDutyEmployees, sendModelId,
    enabledToolKeySig: availableTools.map((t) => t.key).join('|'),
    isGenerating,
  });

  return {
    s,
    isAdmin, canMutate,
    currentUser: currentUser ? { id: currentUser.id, name: currentUser.name, role: currentUser.role } : null,
    onDutyEmployees, activeEmployee, hasBoundExpert, availableTools, sendModelId,
    activeSession, currentSession, sessionMode,
    expertName, expertMeta, expertDescription, expertSuggestions,
    suggestionIconMap, agentMeta,
    isGenerating, generationHint, generationElapsedSec,
    streamingAssistant, displayMessages,
    filteredSessions, grouped,
    filteredExperts: actions.filteredExperts,
    hasSessionContext, hasSelectedContext, canOpenExpertContext,
    workbench, contextSummary, sessionExpertContext, messageExpertContext, turnProgress,
    sessionUsage, sessionSignals,
    charCount, contextUsage,
    mentionSkillItems, mentionExpertItems, mentionDocItems, mentionMemberItems,
    slashGrouped, slashFiltered: actions.slashFiltered,
    showTypingFallback,
    selectedDocumentArtifact,
    hasStreamingAssistant, hasPendingTurn,
    sessionFetchId: conversationFetchId,
    canFetchConversation, conversationMissing,
    visibleContextTabs, selectedContextMessage, contextMessages,
    detailsOpen: s.contextSelection.open,
    contextTab: s.contextSelection.tab,
    sessionsOpen: s.sessionsOpen,
    sessionsPaneW: s.sessionsPaneW,
    detailsPaneW: s.detailsPaneW,
    draggingSplit: s.draggingSplit,
    columnMode, gridTemplate, detailsPinned,
    actions,
    ...contextHandlers,
    ...composer,
    ...splits,
  };
}

export type { MentionKind };
