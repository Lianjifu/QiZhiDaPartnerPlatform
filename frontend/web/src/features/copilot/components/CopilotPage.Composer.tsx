/**
 * CopilotPage.Composer — input area with slash/mention/attachments.
 */
import { useEffect } from 'react';
import { AtSign, Hash, Plus, Send, Square, Paperclip, Sparkles } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import { Badge } from '@qzda/web-ui';
import { useT } from '@/i18n';
import { useCopilotContext } from '@/features/copilot/components/useCopilotController';
import { ComposerRunModeMenu } from '@/features/copilot/lib/composer-run-mode';
import { ComposerReasoningMenu } from '@/features/copilot/lib/composer-reasoning';
import { ComposerContextUsage } from '@/features/copilot/lib/composer-context-usage';
import { ComposerInsertMenu } from '@/features/copilot/lib/composer-insert';
import { ComposerMediaControls } from '@/features/copilot/lib/ComposerMediaControls';
import { MENTION_CATEGORIES, type MentionKind } from '@/features/copilot/lib/mentions';
import { SLASH_ICON } from '@/features/copilot/components/CopilotPage.helpers';

export function CopilotPageComposer() {
  const ctrl = useCopilotContext();
  const { s, currentSession, charCount, isGenerating,
    mentionExpertItems, mentionSkillItems, mentionDocItems, mentionMemberItems,
    slashGrouped, expertName, hasBoundExpert, contextUsage,
    actions,
    onInputChange, insertSlash, openMentionMenu, pickMentionCategory,
    applyMentionToken, onTextareaKey, onPaste, addAttachments, removeAttachment,
    openContext,
  } = ctrl;
  const runMode = s.runMode;
  const reasoningEffort = s.reasoningEffort;
  const mentionPane = s.mentionPane;
  const mentionQuery = s.mentionQuery;
  const showMention = s.showMention;
  const showSlash = s.showSlash;
  const isClosed = s.isClosed;
  const handoffActive = s.handoffActive;
  const { t } = useT();

  useEffect(() => {
    if (typeof window !== 'undefined' && !s.mediaCapturing && s.mediaAttachments.length > 0) {
      s.setMediaAttachments([]);
    }
  }, [s.mediaCapturing, s.mediaAttachments.length, s]);

  const mentionCategory = (kind: MentionKind) => MENTION_CATEGORIES.find((c) => c.kind === kind);
  const allMentionItems = (kind: MentionKind) => {
    if (kind === 'skill') return mentionSkillItems;
    if (kind === 'expert') return mentionExpertItems;
    if (kind === 'doc') return mentionDocItems;
    if (kind === 'member') return mentionMemberItems;
    return [];
  };
  const filteredMentions = (kind: MentionKind) => {
    const items = allMentionItems(kind);
    if (!mentionQuery) return items;
    const q = mentionQuery.toLowerCase();
    return items.filter((i) => i.name.toLowerCase().includes(q) || (i.desc ?? '').toLowerCase().includes(q));
  };

  return (
    <div className="copilot-composer border-t border-[var(--border)] bg-[var(--bg-elevated)] px-4 pb-4 pt-3 sm:px-5">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        <ComposerRunModeMenu
          value={runMode}
          onChange={actions.handleRunModeChange}
          disabled={isClosed || handoffActive}
        />
        {s.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {s.attachments.map((a, i) => (
              <Badge key={`${a.name}-${i}`} tone={a.error ? 'error' : a.uploading ? 'info' : 'neutral'} className="gap-1 text-[10px]">
                <Paperclip className="h-3 w-3" />
                {a.name} · {a.size}
                {a.uploading && '·上传中'}
                {a.error && `·${a.error}`}
                <button type="button" onClick={() => removeAttachment(i)} aria-label={`移除附件 ${a.name}`}>×</button>
              </Badge>
            ))}
          </div>
        )}
        <div className="copilot-composer__box relative rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-sm focus-within:border-[var(--brand)]">
          <textarea
            ref={s.inputRef}
            value={s.chat.state.draftInput}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onTextareaKey}
            onPaste={onPaste}
            placeholder={hasBoundExpert ? `与 ${expertName} 协作中…` : '输入消息或 / 命令'}
            aria-label="消息输入"
            rows={3}
            className="w-full resize-none bg-transparent px-3 py-2 text-sm focus:outline-none"
            disabled={isClosed || handoffActive}
          />
          {showSlash && (
            <div className="copilot-slash-menu">
              {Object.entries(slashGrouped).map(([cat, list]) => list.length === 0 ? null : (
                <div key={cat} className="copilot-slash-menu__group">
                  <div className="copilot-slash-menu__group-title">{cat}</div>
                  {list.map((cmd) => {
                    const Icon = SLASH_ICON[cmd.icon] ?? Sparkles;
                    return (
                      <button key={cmd.cmd} type="button" className="copilot-slash-menu__item" onClick={() => insertSlash(cmd.cmd)}>
                        <Icon className="h-4 w-4" />
                        <span className="font-medium">{cmd.cmd}</span>
                        <span className="truncate text-[var(--text-muted)]">{cmd.desc}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          {showMention && (
            <div className="copilot-mention-menu">
              {mentionPane === 'root' && (
                <div className="copilot-mention-menu__root">
                  {MENTION_CATEGORIES.map((c) => (
                    <button key={c.kind} type="button" onClick={() => pickMentionCategory(c.kind)} className="copilot-mention-menu__item">
                      <span>{c.label}</span>
                      <span className="truncate text-[var(--text-muted)]">{c.desc}</span>
                    </button>
                  ))}
                </div>
              )}
              {mentionPane !== 'root' && (
                <div className="copilot-mention-menu__sub">
                  <div className="copilot-mention-menu__sub-title">{mentionCategory(mentionPane as MentionKind)?.label}</div>
                  {filteredMentions(mentionPane as MentionKind).map((item) => (
                    <button key={item.key} type="button" className="copilot-mention-menu__item" onClick={() => applyMentionToken(item.name, (item as any).key)}>
                      <span className="font-medium">{item.name}</span>
                      <span className="truncate text-[var(--text-muted)]">{item.desc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            <ComposerInsertMenu
              disabled={isClosed || handoffActive}
              onAttach={() => addAttachments([])}
              onMention={openMentionMenu}
              onSlash={() => s.setShowSlash(true)}
            />
            <button type="button" className="copilot-composer__icon-btn" onClick={openMentionMenu} aria-label="提及"><AtSign className="h-3.5 w-3.5" /></button>
            <button type="button" className="copilot-composer__icon-btn" onClick={() => s.setDebugOpen(true)} aria-label="调试"><Hash className="h-3.5 w-3.5" /></button>
            <ComposerMediaControls
              disabled={isClosed || handoffActive}
              isCapturing={s.mediaCapturing}
              onCameraStart={() => s.setMediaCapturing('camera')}
              onCameraStop={() => s.setMediaCapturing(null)}
              onMicStart={() => s.setMediaCapturing('mic')}
              onMicStop={() => s.setMediaCapturing(null)}
              onError={() => undefined}
              onCapture={(res: any) => s.setMediaAttachments((prev: any) => [...prev, res])}
            />
            <input
              ref={s.fileInputRef}
              type="file"
              hidden
              multiple
              onChange={(e) => addAttachments(Array.from(e.target.files ?? []))}
            />
            <button type="button" className="copilot-composer__icon-btn" onClick={() => addAttachments([])} aria-label="附件">
              <Paperclip className="h-3.5 w-3.5" />
            </button>
            <ComposerReasoningMenu
              value={reasoningEffort}
              onChange={actions.handleReasoningChange}
              disabled={isClosed || handoffActive}
            />
            <ComposerContextUsage usage={contextUsage} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)]">{charCount.toLocaleString()} 字符</span>
            {isGenerating ? (
              <button type="button" className="copilot-composer__stop" onClick={() => s.chat.stop()}>
                <Square className="h-3.5 w-3.5" />停止
              </button>
            ) : (
              <button
                type="button"
                className={cn('copilot-composer__send', (isClosed || handoffActive || !s.chat.state.draftInput.trim()) && 'is-disabled')}
                onClick={actions.handleSend}
                disabled={isClosed || handoffActive || !s.chat.state.draftInput.trim()}
                aria-label="发送"
              >
                <Send className="h-3.5 w-3.5" />发送
              </button>
            )}
          </div>
        </div>
        {currentSession && (
          <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
            <span>{t('copilot.composerHint') ?? 'Enter 发送，Shift+Enter 换行；↑↓ 翻历史；/ 唤起命令面板'}</span>
            <button type="button" className="hover:text-[var(--text)]" onClick={() => openContext('overview')}>
              <Plus className="h-3 w-3 inline" />会话上下文
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
