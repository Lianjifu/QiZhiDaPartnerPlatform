/**
 * useCopilotState — all useState + refs + initial queries for the Copilot page.
 */
import { useMemo, useRef, useState } from 'react';
import { useApiQuery } from '@/services/query';
import { useChat } from '@/hooks/useChat';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { DigitalPartner, ModelProvider, RoutingPolicyDraft } from '@qzda/web-types';
import {
  buildCopilotModelOptions,
  defaultCopilotModelKey,
  resolveCopilotModelId,
} from '@/features/copilot/lib/copilot-models';
import type { SessionItem, ComposerAttachment } from '@/features/copilot/components/CopilotPage.helpers';
import type { ReasoningEffort, RunMode } from '@/features/copilot/lib/composer-mode';
import type { ContextSelection } from '@/features/copilot/components/CopilotPage.helpers';

export function useCopilotState() {
  const [searchQ, setSearchQ] = useState('');
  const [historyReady, setHistoryReady] = useState(false);
  const [showSlash, setShowSlash] = useState(false);
  const [showMention, setShowMention] = useState(false);
  const [mentionPane, setMentionPane] = useState<'root' | import('@/features/copilot/lib/mentions').MentionKind>('root');
  const [mentionQuery, setMentionQuery] = useState('');
  const [showApproval, setShowApproval] = useState<{ messageId: string; signerIndex: number } | null>(null);
  const [expandedArgs, setExpandedArgs] = useState<Record<string, boolean>>({});
  const [expandedApproval, setExpandedApproval] = useState<Record<string, boolean>>({});
  const [focusedCitation, setFocusedCitation] = useState<any | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth >= 1024,
  );
  const [contextSelection, setContextSelection] = useState<ContextSelection>({
    open: false, scope: 'session', tab: 'overview', pinned: false,
  });
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [mediaCapturing, setMediaCapturing] = useState<null | 'mic' | 'camera'>(null);
  const [mediaAttachments, setMediaAttachments] = useState<import('@/features/copilot/lib/composer-media').MediaCaptureResult[]>([]);
  const [runMode, setRunMode] = useState<RunMode>('ask');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('standard');
  const [riskLevel, setRiskLevel] = useState<'low' | 'medium' | 'high'>('medium');
  const [closeoutOpen, setCloseoutOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffOwner, setHandoffOwner] = useState('李婷 · 值班负责人');
  const [handoffActive, setHandoffActive] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [hoverMsgId, setHoverMsgId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState<string | null>(null);
  const [shareDialog, setShareDialog] = useState<{ open: boolean; token?: string }>({ open: false });
  const [rejectionReason, setRejectionReason] = useState<{ mid: string; idx: number; open: boolean }>({ mid: '', idx: -1, open: false });
  const [expertPickerOpen, setExpertPickerOpen] = useState(false);
  const [expertPickerMode, setExpertPickerMode] = useState<'new' | 'rebind'>('new');
  const [expertPickerQuery, setExpertPickerQuery] = useState('');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [exportSubOpen, setExportSubOpen] = useState(false);
  const [rebindBlockedReason, setRebindBlockedReason] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [currentModelKey, setCurrentModelKey] = useState('');
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [sessionsPaneW, setSessionsPaneW] = useState(() => {
    if (typeof window === 'undefined') return 280;
    const saved = Number(window.localStorage.getItem('copilot-sessions-w'));
    return Number.isFinite(saved) && saved >= 200 && saved <= 420 ? saved : 280;
  });
  const [viewportW, setViewportW] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  );
  const [detailsPaneW, setDetailsPaneW] = useState(() => {
    if (typeof window === 'undefined') return 360;
    const saved = Number(window.localStorage.getItem('copilot-details-w'));
    return Number.isFinite(saved) && saved >= 280 && saved <= 520 ? saved : 360;
  });
  const [draggingSplit, setDraggingSplit] = useState<'sessions' | 'details' | null>(null);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationTick, setGenerationTick] = useState(0);

  const deepLinkHandled = useRef<string | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionToggleRef = useRef<HTMLButtonElement | null>(null);
  const detailsToggleRef = useRef<HTMLButtonElement | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const historyIdx = useRef(0);
  const typingWasRef = useRef(false);
  const prevWorkspaceRef = useRef<string>('');

  const chat = useChat({ name: '岗位专家' });
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId ?? 'w1');
  const canReadModels = useAuthStore((state) =>
    state.user?.role === 'admin' || Boolean(state.user?.permissions?.includes('model.read')),
  );

  const { data: employeesData } = useApiQuery<DigitalPartner[]>(['digital-employees'], '/api/partners');
  const employees = useMemo(() => employeesData ?? [], [employeesData]);
  const { data: modelProvidersData } = useApiQuery<ModelProvider[]>(
    ['model-providers', 'copilot'], '/api/model-providers', undefined, { enabled: canReadModels },
  );
  const { data: routingPoliciesData } = useApiQuery<RoutingPolicyDraft[]>(
    ['model-routing-policies', 'copilot'], '/api/model-routing/policies', undefined, { enabled: canReadModels },
  );
  const modelOptions = useMemo(
    () => buildCopilotModelOptions(modelProvidersData, routingPoliciesData),
    [modelProvidersData, routingPoliciesData],
  );
  const { data: slashCmdsData } = useApiQuery<
    { cmd?: string; desc?: string; icon?: string; category?: string; name?: string; description?: string }[]
  >(['slash-cmds'], '/api/slash-commands');
  const { data: sessionHistoryData, isLoading: sessionsLoading, isError: sessionsError, isFetching: sessionsFetching } =
    useApiQuery<SessionItem[]>(['sessions'], '/api/sessions');
  const sessionHistory = useMemo(() => sessionHistoryData ?? [], [sessionHistoryData]);
  const slashCmds = useMemo(() => {
    const raw = slashCmdsData ?? [];
    return raw.map((item) => {
      if (item.cmd) {
        return {
          cmd: item.cmd,
          desc: item.desc ?? item.description ?? '',
          icon: item.icon ?? 'Sparkles',
          category: item.category ?? 'tool',
        };
      }
      const name = item.name ?? '';
      return {
        cmd: name.startsWith('/') ? name : `/${name}`,
        desc: item.desc ?? item.description ?? '',
        icon: item.icon ?? 'Sparkles',
        category: item.category ?? 'tool',
      };
    });
  }, [slashCmdsData]);

  const currentModel = modelOptions.find((m) => m.key === currentModelKey) ?? modelOptions[0];
  const runModelId = resolveCopilotModelId(currentModel, currentModelKey);

  return useMemo(() => ({
    // search/UI state
    searchQ, setSearchQ,
    historyReady, setHistoryReady,
    showSlash, setShowSlash,
    showMention, setShowMention,
    mentionPane, setMentionPane,
    mentionQuery, setMentionQuery,
    showApproval, setShowApproval,
    expandedArgs, setExpandedArgs,
    expandedApproval, setExpandedApproval,
    focusedCitation, setFocusedCitation,
    sessionsOpen, setSessionsOpen,
    contextSelection, setContextSelection,
    editingMessageId, setEditingMessageId,
    mediaCapturing, setMediaCapturing,
    mediaAttachments, setMediaAttachments,
    runMode, setRunMode,
    reasoningEffort, setReasoningEffort,
    riskLevel, setRiskLevel,
    closeoutOpen, setCloseoutOpen,
    handoffOpen, setHandoffOpen,
    handoffOwner, setHandoffOwner,
    handoffActive, setHandoffActive,
    isClosed, setIsClosed,
    debugOpen, setDebugOpen,
    hoverMsgId, setHoverMsgId,
    copiedId, setCopiedId,
    feedbackOpen, setFeedbackOpen,
    shareDialog, setShareDialog,
    rejectionReason, setRejectionReason,
    expertPickerOpen, setExpertPickerOpen,
    expertPickerMode, setExpertPickerMode,
    expertPickerQuery, setExpertPickerQuery,
    moreMenuOpen, setMoreMenuOpen,
    exportSubOpen, setExportSubOpen,
    rebindBlockedReason, setRebindBlockedReason,
    modelOpen, setModelOpen,
    toolsOpen, setToolsOpen,
    currentModelKey, setCurrentModelKey,
    enabledTools, setEnabledTools,
    attachments, setAttachments,
    isDragging, setIsDragging,
    sessionsPaneW, setSessionsPaneW,
    viewportW, setViewportW,
    detailsPaneW, setDetailsPaneW,
    draggingSplit, setDraggingSplit,
    generationStartedAt, setGenerationStartedAt,
    generationTick, setGenerationTick,
    // refs (stable identity)
    deepLinkHandled, moreMenuRef, fileInputRef, shellRef, scrollRef, inputRef,
    sessionToggleRef, detailsToggleRef, messageRefs, historyIdx, typingWasRef, prevWorkspaceRef,
    // data
    chat, currentWorkspaceId, employees, employeesData,
    modelProvidersData, routingPoliciesData, modelOptions,
    slashCmdsData, slashCmds,
    sessionHistoryData, sessionHistory, sessionsLoading, sessionsError, sessionsFetching,
    currentModel, runModelId,
  }), [
    searchQ, historyReady, showSlash, showMention, mentionPane, mentionQuery, showApproval,
    expandedArgs, expandedApproval, focusedCitation, sessionsOpen, contextSelection,
    editingMessageId, mediaCapturing, mediaAttachments, runMode, reasoningEffort, riskLevel,
    closeoutOpen, handoffOpen, handoffOwner, handoffActive, isClosed, debugOpen,
    hoverMsgId, copiedId, feedbackOpen, shareDialog, rejectionReason,
    expertPickerOpen, expertPickerMode, expertPickerQuery, moreMenuOpen, exportSubOpen,
    rebindBlockedReason, modelOpen, toolsOpen, currentModelKey, enabledTools, attachments,
    isDragging, sessionsPaneW, viewportW, detailsPaneW, draggingSplit,
    generationStartedAt, generationTick,
    chat, currentWorkspaceId, employees, employeesData,
    modelProvidersData, routingPoliciesData, modelOptions,
    slashCmdsData, slashCmds,
    sessionHistoryData, sessionHistory, sessionsLoading, sessionsError, sessionsFetching,
    currentModel, runModelId,
  ]);
}

export type CopilotState = ReturnType<typeof useCopilotState>;
