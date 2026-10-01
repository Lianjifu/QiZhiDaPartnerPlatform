/**
 * useCopilotActions — user-action handlers (send, slash, attachments, share, etc).
 */
import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from '@qzda/web-ui';
import { getApiClient } from '@qzda/web-api';
import type { DigitalPartner } from '@qzda/web-types';
import {
  approvalToolKeys, buildExpertTools, defaultEnabledToolKeys, isWriteExecutionIntent, toolsForExecuteMode,
} from '@/features/copilot/lib/expert-tools';
import {
  filterSlashCommands, parseSlashCommand, planSlashPick, planSlashSend, slashHelpText,
  type SlashUiAction,
} from '@/features/copilot/lib/slash-commands';
import {
  filterByQuery, mergeMentionedTools, replaceMentionTrigger, shouldShowMentionMenu,
} from '@/features/copilot/lib/mentions';
import { DEFAULT_REPLY_MODE, mapRunModeToDispatch } from '@/features/copilot/lib/composer-mode';
import { escapeHtml } from '@/features/copilot/components/CopilotPage.helpers';
import type { CopilotState } from '@/features/copilot/components/useCopilotState';

export interface UseCopilotActionsParams {
  s: CopilotState;
  isAdmin: boolean;
  canMutate: boolean;
  sendModelId: string | undefined;
  activeEmployee: DigitalPartner | null;
  onDutyEmployees: DigitalPartner[];
  currentSession: any;
  activeSession: any;
  sessionMode: 'investigate' | 'execute';
}

export interface CopilotActions {
  persistRunConfig: (modelId: string, tools: string[]) => void;
  startSessionWithExpert: (employee: DigitalPartner) => void;
  openNewSessionPicker: () => void;
  openRebindExpertPicker: () => void;
  handleRunModeChange: (mode: 'ask' | 'plan' | 'agent') => void;
  handleReasoningChange: (effort: 'off' | 'standard' | 'deep') => void;
  handleSend: () => void;
  applySlashAction: (action: SlashUiAction) => Promise<void>;
  handleExport: (format: 'markdown' | 'json') => void;
  printAuditRecord: () => void;
  toggleArchive: () => void;
  shareSession: () => void;
  copyShareUrl: () => Promise<void>;
  filteredExperts: DigitalPartner[];
  slashFiltered: ReturnType<typeof filterSlashCommands>;
}

export function useCopilotActions({
  s, isAdmin, canMutate, sendModelId, activeEmployee, onDutyEmployees, currentSession, activeSession, sessionMode,
}: UseCopilotActionsParams): CopilotActions {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const availableTools = useMemo(() => buildExpertTools(activeEmployee), [activeEmployee]);

  const persistRunConfig = useCallback((modelId: string, tools: string[]) => {
    const sess = s.chat.activeSession;
    if (!sess) return;
    if (sess.modelId === modelId && JSON.stringify(sess.enabledTools ?? []) === JSON.stringify(tools)) return;
    s.chat.persistSession({ ...sess, modelId, enabledTools: tools });
  }, [s.chat]);

  const startSessionWithExpert = (employee: DigitalPartner) => {
    if (!canMutate || employee.lifecycle !== 'active') return;
    const active = s.chat.activeSession;
    if (s.expertPickerMode === 'rebind' && active) {
      const pending = (active.messages ?? []).filter((message: any) => message.approvalRequest?.decision === 'pending').length;
      if (pending > 0) {
        s.setRebindBlockedReason(`当前会话有 ${pending} 项待审批，请先完成或拒绝后再改绑专家。`);
        return;
      }
      if (s.isClosed || s.handoffActive) {
        s.setRebindBlockedReason(s.isClosed ? '会话已结案，无法改绑专家。' : '人工交接中，无法改绑专家。');
        return;
      }
      s.chat.persistSession({
        ...active,
        digitalPartnerId: employee.id,
        digitalPartnerName: employee.name,
        agent: employee.name,
        agentKey: employee.capabilities.agentId,
      });
      s.setExpertPickerOpen(false);
      s.setExpertPickerQuery('');
      s.setRebindBlockedReason(null);
      return;
    }
    void s.chat.newSession({
      digitalPartnerId: employee.id,
      digitalPartnerName: employee.name,
      agentKey: employee.capabilities.agentId,
      modelId: sendModelId,
      enabledTools: s.enabledTools.length ? s.enabledTools : defaultEnabledToolKeys(availableTools),
    }).then((id) => {
      s.setExpertPickerOpen(false);
      s.setExpertPickerQuery('');
      s.setRebindBlockedReason(null);
      if (id) navigate(`/copilot/${id}`);
    }).catch((err) => {
      toast.error(err instanceof Error ? err.message : '创建会话失败，请重试');
    });
  };

  const openNewSessionPicker = () => {
    if (!canMutate) return;
    if (onDutyEmployees.length === 0) {
      void s.chat.newSession({
        modelId: sendModelId,
        enabledTools: s.enabledTools.length ? s.enabledTools : defaultEnabledToolKeys(availableTools),
      }).then((id) => {
        if (id) navigate(`/copilot/${id}`);
      }).catch((err) => {
        toast.error(err instanceof Error ? err.message : '创建会话失败，请重试');
      });
      return;
    }
    s.setExpertPickerMode('new');
    s.setExpertPickerOpen(true);
    s.setExpertPickerQuery('');
    s.setRebindBlockedReason(null);
  };

  const openRebindExpertPicker = () => {
    if (!canMutate) return;
    s.setExpertPickerMode('rebind');
    s.setExpertPickerOpen(true);
    s.setExpertPickerQuery('');
    s.setRebindBlockedReason(null);
  };

  const handleRunModeChange = (mode: 'ask' | 'plan' | 'agent') => {
    if (s.isClosed || s.handoffActive) return;
    const nextEffort = mode === 'ask' && s.reasoningEffort === 'deep' ? 'standard' : s.reasoningEffort;
    s.setRunMode(mode);
    s.setReasoningEffort(nextEffort);
    const mapped = mapRunModeToDispatch(mode, availableTools, s.enabledTools);
    s.setEnabledTools(mapped.enabledTools);
    if (!activeSession) return;
    void s.chat.setCollaborationMode(mapped.sessionMode, {
      riskLevel: s.riskLevel,
      enableApprovalTools: mapped.enableApprovalTools,
      runMode: mode,
      reasoningEffort: nextEffort,
    }).catch((err) => toast.error(err instanceof Error ? err.message : '模式切换失败'));
  };

  const handleReasoningChange = (effort: 'off' | 'standard' | 'deep') => {
    if (s.isClosed || s.handoffActive) return;
    s.setReasoningEffort(effort);
    if (!activeSession) return;
    void s.chat.persistSession({ ...activeSession, reasoningEffort: effort }).catch(() => undefined);
  };

  const handleSend = () => {
    if (!canMutate) return;
    if (!s.chat.state.draftInput.trim() || s.chat.state.typing || s.isClosed || s.handoffActive) return;
    const slash = parseSlashCommand(s.chat.state.draftInput);
    if (slash) {
      void applySlashAction(planSlashSend(slash));
      return;
    }
    if (!sendModelId) {
      window.alert('当前工作区没有可用模型。请先在「模型中心」接入并探测供应商，或为数字伙伴装配可用模型。');
      return;
    }
    const draft = s.chat.state.draftInput.trim();
    const mapped = mapRunModeToDispatch(s.runMode, availableTools, s.enabledTools);
    let tools = mergeMentionedTools(mapped.enabledTools, s.chat.state.draftInput, availableTools.map((t) => t.key));
    if (s.runMode === 'ask') {
      if (isWriteExecutionIntent(draft) || tools.some((key) => availableTools.find((t) => t.key === key)?.requiresApproval)) {
        toast.error('当前为问答模式，无法执行写操作。请切换到「方案」或「执行」。');
        return;
      }
      tools = mapped.enabledTools;
    } else if (s.runMode === 'plan') {
      if (isWriteExecutionIntent(draft)) {
        toast.error('当前为方案模式。如需直接执行，请切换到「执行」。');
      }
      tools = tools.filter((key) => {
        const t = availableTools.find((x) => x.key === key);
        return t && !t.requiresApproval;
      });
    } else {
      tools = toolsForExecuteMode(tools, availableTools);
    }
    const mode = mapped.sessionMode;
    const modeHint = mapped.modeHint;
    const risk = s.riskLevel;
    const attachmentIds = s.attachments.map((a) => a.id).filter((id): id is string => Boolean(id));
    if (s.attachments.some((a) => a.uploading)) {
      toast.error('附件仍在上传，请稍候再发送');
      return;
    }
    if (s.attachments.some((a) => a.error || !a.id)) {
      toast.error('存在上传失败的附件，请移除后重试');
      return;
    }
    const dispatchSend = () => {
      if (tools.length !== s.enabledTools.length || tools.some((k, i) => k !== s.enabledTools[i])) {
        s.setEnabledTools(tools);
      }
      persistRunConfig(sendModelId, tools);
      const sendOpts: any = {
        modelId: sendModelId,
        enabledTools: tools,
        sessionMode: mode,
        runMode: s.runMode,
        reasoningEffort: s.reasoningEffort,
        replyMode: DEFAULT_REPLY_MODE,
        modeHint,
        riskLevel: risk,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
      };
      if (s.editingMessageId) {
        s.chat.replaceAndSend(s.editingMessageId, s.chat.state.draftInput, sendOpts);
        s.setEditingMessageId(null);
      } else {
        s.chat.send(s.chat.state.draftInput, sendOpts);
      }
      s.setAttachments([]);
      s.setShowSlash(false);
      s.setShowMention(false);
      s.setMentionPane('root');
      s.setMentionQuery('');
    };
    if (mode !== sessionMode || activeSession?.runMode !== s.runMode) {
      void s.chat.setCollaborationMode(mode, {
        riskLevel: risk,
        enableApprovalTools: mode === 'execute' ? approvalToolKeys(availableTools) : undefined,
        runMode: s.runMode,
        reasoningEffort: s.reasoningEffort,
      })
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: ['sessions'] });
          dispatchSend();
        })
        .catch((err) => {
          toast.error(err instanceof Error ? err.message : '无法切换协作模式');
        });
      return;
    }
    if (mode === 'execute') {
      const approvalKeys = approvalToolKeys(availableTools);
      const missing = approvalKeys.filter((k) => !tools.includes(k));
      if (missing.length) {
        void s.chat.setCollaborationMode('execute', {
          riskLevel: risk,
          enableApprovalTools: approvalKeys,
          runMode: s.runMode,
          reasoningEffort: s.reasoningEffort,
        }).catch(() => undefined);
      }
    }
    dispatchSend();
  };

  const applySlashAction = async (action: SlashUiAction) => {
    switch (action.type) {
      case 'open_expert_picker':
        s.setExpertPickerMode(s.chat.activeSession ? 'rebind' : 'new');
        s.setExpertPickerOpen(true);
        s.setExpertPickerQuery(action.query ?? '');
        s.setRebindBlockedReason(null);
        s.chat.setDraft('');
        break;
      case 'open_model_picker':
        if (isAdmin) { s.setToolsOpen(false); s.setModelOpen(true); }
        else { s.chat.appendLocalAssistant('当前角色由工作区策略分配受控运行路由，无法通过 /model 手动切换。'); }
        s.chat.setDraft('');
        break;
      case 'open_mention':
        s.chat.setDraft('@');
        s.setShowMention(true); s.setShowSlash(false);
        s.setMentionPane(action.pane); s.setMentionQuery('');
        s.inputRef.current?.focus();
        break;
      case 'open_tools':
        if (isAdmin) { s.setModelOpen(false); s.setToolsOpen(true); }
        s.chat.setDraft('');
        break;
      case 'export':
        handleExport(action.format);
        s.chat.setDraft('');
        s.chat.appendLocalAssistant('已导出当前会话为 Markdown，请查看浏览器下载。');
        break;
      case 'clear_session':
        s.chat.clearActiveMessages(); s.chat.setDraft('');
        s.chat.appendLocalAssistant('已清空本会话消息。岗位专家与运行配置保持不变。');
        break;
      case 'show_help':
        s.chat.setDraft('');
        s.chat.appendLocalAssistant(slashHelpText(s.slashCmds));
        break;
      case 'switch_model': {
        const q = action.query.toLowerCase();
        const match = s.modelOptions.find((m) =>
          [m.key, m.label, m.modelId, m.apiModel, m.desc].filter(Boolean).join(' ').toLowerCase().includes(q));
        if (!match) {
          s.chat.appendLocalAssistant(`未找到匹配模型「${action.query}」。可用：${s.modelOptions.map((m) => m.label).join('、') || '无'}`);
          s.chat.setDraft(''); break;
        }
        s.setCurrentModelKey(match.key);
        const tools = s.enabledTools.length ? s.enabledTools : defaultEnabledToolKeys(availableTools);
        persistRunConfig(match.modelId, tools);
        s.chat.setDraft('');
        s.chat.appendLocalAssistant(`已切换本会话模型为「${match.label}」。`);
        break;
      }
      case 'switch_expert': {
        const q = action.query.toLowerCase();
        const match = onDutyEmployees.find((e) =>
          [e.name, e.role, e.department].join(' ').toLowerCase().includes(q));
        if (!match) {
          s.chat.appendLocalAssistant(`未找到在岗专家「${action.query}」。可用：${onDutyEmployees.map((e) => e.role || e.name).join('、') || '无'}`);
          s.chat.setDraft(''); break;
        }
        s.chat.setDraft('');
        startSessionWithExpert(match);
        break;
      }
      case 'create_task': {
        const sess = s.chat.activeSession;
        if (!sess) { s.chat.appendLocalAssistant('请先打开或创建会话，再使用 /task。'); break; }
        try {
          const conversationId = sess.conversationId ?? sess.id;
          const task = await getApiClient().post<{ id: string; code?: string; title?: string }>(
            `/api/conversations/${encodeURIComponent(conversationId)}/tasks`,
            { title: action.title, priority: 'P2', digitalPartnerId: sess.digitalPartnerId, conversationId, links: { conversationId }, source: 'conversation' },
          );
          s.chat.setDraft('');
          s.chat.appendLocalAssistant(`已创建任务「${task.title ?? action.title}」${task.code ? `（${task.code}）` : ''}，可在任务中心继续跟踪。`);
        } catch (err) {
          s.chat.appendLocalAssistant(`创建任务失败：${err instanceof Error ? err.message : '未知错误'}`);
          s.chat.setDraft('');
        }
        break;
      }
      case 'send': {
        const baseTools = s.enabledTools.length ? s.enabledTools : defaultEnabledToolKeys(availableTools);
        let tools = baseTools;
        if (action.enableTools?.length) {
          const known = new Set(availableTools.map((t) => t.key));
          for (const key of action.enableTools) {
            if (known.has(key) && !tools.includes(key)) tools = [...tools, key];
          }
          for (const key of action.enableTools) {
            if (key.startsWith('builtin:') && !tools.includes(key)) tools = [...tools, key];
          }
          s.setEnabledTools(tools);
        }
        persistRunConfig(sendModelId!, tools);
        s.chat.setDraft('');
        s.chat.send(action.content, {
          modelId: sendModelId, enabledTools: tools,
          modeHint: action.modeHint, reflectHint: action.reflectHint,
        });
        break;
      }
      case 'noop':
        if (action.message && action.message !== 'await_args') {
          s.chat.appendLocalAssistant(action.message); s.chat.setDraft('');
        }
        break;
      default:
        break;
    }
    s.setShowSlash(false);
  };

  const handleExport = (format: 'markdown' | 'json') => {
    if (!currentSession) return;
    const data = s.chat.exportSessionAs(currentSession.id, format);
    if (!data) return;
    const blob = new Blob([data], { type: format === 'json' ? 'application/json' : 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentSession.title || 'session'}-${currentSession.id}.${format === 'json' ? 'json' : 'md'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printAuditRecord = () => {
    if (!currentSession) return;
    const auditData = s.chat.exportSessionAs(currentSession.id, 'audit');
    if (!auditData) return;
    const printWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!printWindow) return;
    const title = escapeHtml(currentSession.title || '数字伙伴会话审计记录');
    const exportedAt = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date());
    printWindow.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>${title} · 审计记录</title><style>
      @page { size: A4; margin: 18mm; }
      * { box-sizing: border-box; }
      body { color: #0f172a; font: 12px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
      h1 { margin: 0; font-size: 20px; } h2 { margin: 24px 0 8px; font-size: 14px; }
      .meta { margin-top: 8px; color: #64748b; } .rule { height: 3px; margin: 16px 0; background: #4f46e5; }
      pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; padding: 14px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; color: #334155; font: 10px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .footer { margin-top: 16px; color: #64748b; font-size: 10px; }
    </style></head><body>
      <h1>${title}</h1><div class="meta">会话 ID：${escapeHtml(currentSession.id)} · 导出时间：${exportedAt}</div>
      <div class="rule"></div><h2>审计明细</h2><pre>${escapeHtml(auditData)}</pre>
      <div class="footer">由企智搭 · 数字伙伴平台生成。请在系统打印对话框中选择"另存为 PDF"。</div>
    </body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const toggleArchive = () => {
    if (!currentSession) return;
    const archived = currentSession.lifecycle === 'archived';
    s.chat.archiveSession(currentSession.id, !archived);
  };

  const shareSession = () => {
    if (!currentSession) return;
    if (currentSession.shareToken) {
      s.setShareDialog({ open: true, token: currentSession.shareToken });
      return;
    }
    void s.chat.shareSession(currentSession.id).then((token) => {
      s.setShareDialog({ open: true, token: token ?? undefined });
      if (!token) toast.error('创建分享失败');
    });
  };

  const copyShareUrl = async () => {
    if (!s.shareDialog.token) return;
    const url = `${window.location.origin}/copilot/share/${s.shareDialog.token}`;
    try { await navigator.clipboard.writeText(url); } catch {}
  };

  const filteredExperts = useMemo(() => {
    const q = s.expertPickerQuery.trim().toLowerCase();
    return onDutyEmployees.filter((item) => !q || [item.name, item.role, item.department].join(' ').toLowerCase().includes(q));
  }, [onDutyEmployees, s.expertPickerQuery]);

  const slashFiltered = useMemo(
    () => filterSlashCommands(s.slashCmds, s.chat.state.draftInput.startsWith('/') ? s.chat.state.draftInput : '/'),
    [s.slashCmds, s.chat.state.draftInput],
  );

  return {
    persistRunConfig,
    startSessionWithExpert,
    openNewSessionPicker,
    openRebindExpertPicker,
    handleRunModeChange,
    handleReasoningChange,
    handleSend,
    applySlashAction,
    handleExport,
    printAuditRecord,
    toggleArchive,
    shareSession,
    copyShareUrl,
    filteredExperts,
    slashFiltered,
  };
}
