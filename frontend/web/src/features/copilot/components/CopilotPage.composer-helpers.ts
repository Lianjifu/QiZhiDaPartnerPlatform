/**
 * Composer behaviors — input change, slash/mention menu, attachments, keyboard.
 */
import { toast } from '@qzda/web-ui';
import { getApiClient } from '@qzda/web-api';
import { planSlashPick, type SlashUiAction } from '@/features/copilot/lib/slash-commands';
import {
  replaceMentionTrigger, shouldShowMentionMenu, type MentionKind,
} from '@/features/copilot/lib/mentions';
import {
  approvalToolKeys, defaultEnabledToolKeys, toolsForExecuteMode, type CopilotToolDef,
} from '@/features/copilot/lib/expert-tools';
import type { CopilotState } from '@/features/copilot/components/useCopilotState';
import type { CopilotActions } from '@/features/copilot/components/useCopilotActions';

export interface ComposerHandlers {
  onInputChange: (v: string) => void;
  insertSlash: (cmd: string) => void;
  openMentionMenu: () => void;
  pickMentionCategory: (kind: MentionKind) => void;
  applyMentionToken: (token: string, toolKey?: string) => void;
  onTextareaKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: React.ClipboardEventHandler<HTMLTextAreaElement>;
  addAttachments: (files: File[]) => void;
  removeAttachment: (i: number) => void;
}

function formatBytes(b: number) {
  return b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function buildComposerHandlers(
  s: CopilotState,
  availableTools: CopilotToolDef[],
  sendModelId: string | undefined,
  actions: CopilotActions,
): ComposerHandlers {
  const onInputChange = (v: string) => {
    s.chat.setDraft(v);
    if (v === '/') {
      s.setShowSlash(true); s.setShowMention(false); s.setMentionPane('root'); s.setMentionQuery('');
      return;
    }
    if (v.match(/(?:^|[\s　])@[^\s@]*$/u)) {
      const trigger = v.match(/(?:^|[\s　])@([^\s@]*)$/u);
      const q = trigger?.[1] ?? '';
      s.setShowMention(true); s.setShowSlash(false); s.setMentionQuery(q);
      s.setMentionPane((prev: any) => {
        if (prev !== 'root') return prev;
        if (/^(skill|tool|workflow)/i.test(q)) return 'skill';
        if (/^expert/i.test(q)) return 'expert';
        if (/^doc/i.test(q)) return 'doc';
        if (/^member/i.test(q)) return 'member';
        return prev;
      });
      return;
    }
    s.setShowSlash(v.startsWith('/') && v.length > 1 && !v.includes(' '));
    s.setShowMention(false); s.setMentionPane('root'); s.setMentionQuery('');
  };

  const insertSlash = (cmd: string) => {
    const pick = planSlashPick(cmd);
    if (pick.type === 'noop' && pick.message === 'await_args') {
      s.chat.setDraft(`${cmd} `);
      s.setShowSlash(false);
      s.inputRef.current?.focus();
      return;
    }
    void actions.applySlashAction(pick);
    s.inputRef.current?.focus();
  };

  const openMentionMenu = () => {
    const cur = s.chat.state.draftInput;
    const next = shouldShowMentionMenu(cur)
      ? cur
      : `${cur}${cur && !/[\s　]$/u.test(cur) ? ' ' : ''}@`;
    onInputChange(next);
    s.setMentionPane('root');
    s.inputRef.current?.focus();
  };

  const pickMentionCategory = (kind: MentionKind) => {
    s.setMentionPane(kind); s.setMentionQuery('');
    s.inputRef.current?.focus();
  };

  const applyMentionToken = (token: string, toolKey?: string) => {
    const next = replaceMentionTrigger(s.chat.state.draftInput, token);
    s.chat.setDraft(next);
    s.setShowMention(false); s.setMentionPane('root'); s.setMentionQuery('');
    if (toolKey) {
      s.setEnabledTools((prev: string[]) => {
        const base = prev.length ? prev : defaultEnabledToolKeys(availableTools);
        return base.includes(toolKey) ? base : [...base, toolKey];
      });
      const tool = availableTools.find((t) => t.key === toolKey);
      if (tool?.requiresApproval && s.runMode !== 'agent') {
        if (s.runMode === 'ask') {
          toast.error('当前为问答模式，无法启用写工具。请切换到「执行」。');
        } else {
          void s.chat.setCollaborationMode('execute', {
            riskLevel: s.riskLevel,
            enableApprovalTools: approvalToolKeys(availableTools),
            runMode: 'agent',
            reasoningEffort: s.reasoningEffort,
          })
            .then(() => {
              s.setEnabledTools((prev: string[]) => toolsForExecuteMode(
                prev.length ? prev : defaultEnabledToolKeys(availableTools),
                availableTools,
              ));
            })
            .catch((err) => {
              toast.error(err instanceof Error ? err.message : '无法切换到执行模式');
            });
        }
      }
      if (sendModelId) {
        const nextTools = s.enabledTools.includes(toolKey)
          ? s.enabledTools
          : [...s.enabledTools, toolKey];
        actions.persistRunConfig(sendModelId, nextTools.length ? nextTools : defaultEnabledToolKeys(availableTools));
      }
    }
    s.inputRef.current?.focus();
  };

  const onTextareaKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      actions.handleSend();
      s.historyIdx.current = 0;
      return;
    }
    if (e.key === 'Escape' && s.chat.state.typing) { s.chat.stop(); return; }
    const ta = e.currentTarget;
    if (e.key === 'ArrowUp' && ta.selectionStart === 0 && ta.value !== '' && s.chat.state.inputHistory.length > 0) {
      e.preventDefault();
      const hist = s.chat.state.inputHistory;
      const next = Math.min(hist.length, s.historyIdx.current + 1);
      if (next > 0 && next <= hist.length) {
        s.historyIdx.current = next;
        s.chat.setDraft(hist[next - 1]);
      }
    } else if (e.key === 'ArrowDown' && ta.selectionEnd === ta.value.length && s.historyIdx.current > 0) {
      e.preventDefault();
      const hist = s.chat.state.inputHistory;
      s.historyIdx.current -= 1;
      s.chat.setDraft(s.historyIdx.current === 0 ? '' : hist[s.historyIdx.current - 1]);
    }
  };

  const onPaste: React.ClipboardEventHandler<HTMLTextAreaElement> = (e) => {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addAttachments(files); }
  };

  const addAttachments = (files: File[]) => {
    if (!files.length) { s.fileInputRef.current?.click(); return; }
    const conversationId = s.chat.activeSession?.conversationId ?? s.chat.activeSession?.id;
    if (!conversationId || !s.chat.activeSession?.workspaceId || s.chat.activeSession.workspaceId !== s.currentWorkspaceId) {
      toast.error('请先选择或创建会话后再上传附件');
      return;
    }
    const placeholders = files.map((f) => ({
      name: f.name, size: formatBytes(f.size),
      type: f.type.startsWith('image/') ? 'image' : 'file', uploading: true,
    })) as any[];
    s.setAttachments((prev: any[]) => [...prev, ...placeholders]);
    void (async () => {
      const api = getApiClient();
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const form = new FormData();
        form.append('file', file);
        try {
          const uploaded = await api.upload<{ id: string; name?: string }>(
            `/api/conversations/${encodeURIComponent(conversationId)}/attachments`, form,
          );
          s.setAttachments((prev: any[]) => {
            const next = [...prev];
            const idx = next.findIndex((a) => a.uploading && a.name === file.name && !a.id);
            if (idx >= 0) next[idx] = { ...next[idx], id: uploaded.id, uploading: false, error: undefined };
            return next;
          });
        } catch (err) {
          s.setAttachments((prev: any[]) => {
            const next = [...prev];
            const idx = next.findIndex((a) => a.uploading && a.name === file.name && !a.id);
            if (idx >= 0) next[idx] = { ...next[idx], uploading: false, error: err instanceof Error ? err.message : '上传失败' };
            return next;
          });
          toast.error(`${file.name} 上传失败`);
        }
      }
    })();
  };

  const removeAttachment = (i: number) => s.setAttachments((prev: any[]) => prev.filter((_, idx) => idx !== i));

  return {
    onInputChange, insertSlash, openMentionMenu, pickMentionCategory,
    applyMentionToken, onTextareaKey, onPaste, addAttachments, removeAttachment,
  };
}

export type { SlashUiAction };
