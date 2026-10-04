/**
 * CopilotPage.Composer — message input with attach / mention / send.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, Paperclip, Send, Square, Sparkles } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import { Badge } from '@qzda/web-ui';
import { useCopilotContext } from '@/features/copilot/components/useCopilotController';
import { ComposerRunModeMenu } from '@/features/copilot/lib/composer-run-mode';
import { formatMentionToken, MENTION_CATEGORIES, type MentionKind } from '@/features/copilot/lib/mentions';
import { SLASH_ICON } from '@/features/copilot/components/CopilotPage.helpers';

type PickerRow = {
  id: string;
  title: string;
  desc?: string;
  icon?: ReactNode;
  onPick: () => void;
};

export function CopilotPageComposer() {
  const ctrl = useCopilotContext();
  const { s, isGenerating,
    mentionExpertItems, mentionSkillItems, mentionDocItems, mentionMemberItems,
    slashGrouped, expertName, hasBoundExpert,
    actions,
    onInputChange, insertSlash, pickMentionCategory,
    applyMentionToken, onTextareaKey, onPaste, addAttachments, removeAttachment,
  } = ctrl;
  const runMode = s.runMode;
  const mentionPane = s.mentionPane;
  const mentionQuery = s.mentionQuery;
  const showMention = s.showMention;
  const showSlash = s.showSlash;
  const isClosed = s.isClosed;
  const handoffActive = s.handoffActive;
  const composerLocked = isClosed || handoffActive || !hasBoundExpert;
  const [activeIdx, setActiveIdx] = useState(0);

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
    return items.filter((i: { name?: string; desc?: string; key?: string }) =>
      `${i.name ?? ''} ${i.desc ?? ''} ${i.key ?? ''}`.toLowerCase().includes(q));
  };

  const mentionRows = useMemo<PickerRow[]>(() => {
    if (!showMention) return [];
    if (mentionPane === 'root') {
      return MENTION_CATEGORIES.map((c) => ({
        id: c.kind,
        title: c.label,
        desc: c.desc,
        onPick: () => pickMentionCategory(c.kind),
      }));
    }
    return filteredMentions(mentionPane as MentionKind).map((item: { key?: string; name: string; desc?: string }) => ({
      id: String(item.key ?? item.name),
      title: item.name,
      desc: item.desc,
      onPick: () => applyMentionToken(
        formatMentionToken(mentionPane as MentionKind, item),
        mentionPane === 'skill' ? item.key : undefined,
      ),
    }));
  }, [showMention, mentionPane, mentionQuery, mentionSkillItems, mentionExpertItems, mentionDocItems, mentionMemberItems, pickMentionCategory, applyMentionToken]);

  const slashRows = useMemo<PickerRow[]>(() => {
    if (!showSlash) return [];
    return Object.entries(slashGrouped).flatMap(([cat, list]) =>
      list.map((cmd) => {
        const Icon = SLASH_ICON[cmd.icon] ?? Sparkles;
        return {
          id: `${cat}:${cmd.cmd}`,
          title: cmd.cmd,
          desc: cmd.desc,
          icon: <Icon className="h-3.5 w-3.5" />,
          onPick: () => insertSlash(cmd.cmd),
        };
      }),
    );
  }, [showSlash, slashGrouped, insertSlash]);

  const pickerRows = showSlash ? slashRows : mentionRows;
  const pickerOpen = (showMention || showSlash) && !composerLocked;

  useEffect(() => {
    setActiveIdx(0);
  }, [showMention, showSlash, mentionPane, mentionQuery, pickerRows.length]);

  const pickActive = () => {
    const row = pickerRows[activeIdx] ?? pickerRows[0];
    row?.onPick();
  };

  return (
    <div className="copilot-composer border-t border-[var(--border)] bg-[var(--bg)] px-4 pb-2.5 pt-2 sm:px-5">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5">
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
        {s.editingMessageId ? (
          <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
            <span>正在编辑提问，发送后将替换原文并重新生成回复</span>
            <button
              type="button"
              className="shrink-0 text-[var(--brand)] hover:underline"
              onClick={() => { s.setEditingMessageId(null); s.chat.setDraft(''); }}
            >
              取消
            </button>
          </div>
        ) : null}
        <div className="copilot-composer__box relative overflow-visible rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-sm focus-within:border-[var(--brand)]">
          {pickerOpen && (
            <div className="copilot-picker" role="listbox" aria-label={showSlash ? '命令' : '提及'}>
              {showMention && mentionPane !== 'root' ? (
                <button
                  type="button"
                  className="copilot-picker__back"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => s.setMentionPane('root')}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  {mentionCategory(mentionPane as MentionKind)?.label ?? '返回'}
                </button>
              ) : null}
              {showSlash ? (
                <div className="copilot-picker__caption">命令</div>
              ) : mentionPane === 'root' ? (
                <div className="copilot-picker__caption">提及</div>
              ) : null}
              {pickerRows.length === 0 ? (
                <div className="copilot-picker__empty">没有匹配项</div>
              ) : pickerRows.map((row, index) => (
                <button
                  key={row.id}
                  type="button"
                  role="option"
                  aria-selected={index === activeIdx}
                  className={cn('copilot-picker__item', index === activeIdx && 'is-active')}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIdx(index)}
                  onClick={row.onPick}
                >
                  {row.icon ? <span className="copilot-picker__icon">{row.icon}</span> : null}
                  <span className="copilot-picker__text">
                    <span className="copilot-picker__title">{row.title}</span>
                    {row.desc ? <span className="copilot-picker__desc">{row.desc}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={s.inputRef}
            value={s.chat.state.draftInput}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (pickerOpen) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveIdx((i) => Math.min(pickerRows.length - 1, i + 1));
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveIdx((i) => Math.max(0, i - 1));
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  pickActive();
                  return;
                }
                if (e.key === 'Tab') {
                  e.preventDefault();
                  pickActive();
                  return;
                }
              }
              onTextareaKey(e);
            }}
            onPaste={onPaste}
            placeholder={hasBoundExpert ? `与 ${expertName} 协作中…` : '请先选择数字伙伴后再输入'}
            aria-label="消息输入"
            rows={1}
            className="copilot-composer__textarea w-full resize-none bg-transparent px-3 py-2 text-sm focus:outline-none"
            disabled={composerLocked}
          />
          <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-0.5">
              <ComposerRunModeMenu
                value={runMode}
                onChange={actions.handleRunModeChange}
                disabled={composerLocked}
              />
              <input
                ref={s.fileInputRef}
                type="file"
                hidden
                multiple
                onChange={(e) => addAttachments(Array.from(e.target.files ?? []))}
              />
              <button
                type="button"
                className="copilot-composer__icon-btn"
                onClick={() => addAttachments([])}
                disabled={composerLocked}
                aria-label="附件"
              >
                <Paperclip className="h-3.5 w-3.5" />
              </button>
            </div>
            {isGenerating ? (
              <button type="button" className="copilot-composer__stop" onClick={() => s.chat.stop()}>
                <Square className="h-3.5 w-3.5" />停止
              </button>
            ) : (
              <button
                type="button"
                className={cn('copilot-composer__send', (composerLocked || !s.chat.state.draftInput.trim()) && 'is-disabled')}
                onClick={actions.handleSend}
                disabled={composerLocked || !s.chat.state.draftInput.trim()}
                aria-label="发送"
              >
                <Send className="h-3.5 w-3.5" />发送
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
