/**
 * CopilotPage.Messages — message stream area with bubbles and progress.
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, BriefcaseBusiness, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@qzda/web-ui';
import { useCopilotContext } from '@/features/copilot/components/useCopilotController';
import { CopilotPageMessageBubble } from '@/features/copilot/components/CopilotPage.MessageBubble';
import { TurnThoughtPanel } from '@/features/copilot/turn-narrative/turn-thought-panel';
import { DigitalPartnerAvatar } from '@/features/partners/components/DigitalPartnerAvatar';

export function CopilotPageMessages() {
  const ctrl = useCopilotContext();
  const { s, currentSession, displayMessages, showTypingFallback, generationHint,
    openContext, isGenerating, streamingAssistant, generationElapsedSec,
    switchActiveVariant, openAuditTab, openReplay, copyMessage,
    activeEmployee, expertName, expertMeta, expertDescription, expertSuggestions,
    suggestionIconMap, canMutate, onDutyEmployees, hasBoundExpert, conversationMissing,
    currentUser, actions,
  } = ctrl;

  useEffect(() => {
    if (s.scrollRef.current) {
      s.scrollRef.current.scrollTo({
        top: s.scrollRef.current.scrollHeight,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    }
  }, [displayMessages.length, isGenerating, s.scrollRef]);

  const emptyIntro = (
    <div className="copilot-empty-state h-full grid place-items-center px-6">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          {activeEmployee ? (
            <div className="mx-auto mb-4 inline-flex overflow-hidden rounded-full">
              <DigitalPartnerAvatar employee={activeEmployee} size={56} />
            </div>
          ) : (
            <div
              className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
              style={{ boxShadow: 'var(--saas-ring), var(--saas-elev-2)' }}
            >
              <BriefcaseBusiness className="h-7 w-7" />
            </div>
          )}
          {hasBoundExpert ? (
            <>
              <h2 className="text-xl font-semibold text-[var(--text)]">{expertName}</h2>
              {expertMeta && <p className="mt-1 text-xs text-[var(--text-secondary)]">{expertMeta}</p>}
              <p className="text-sm text-[var(--text-muted)] mt-1">{expertDescription}</p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-[var(--text)]">{canMutate ? '选择数字伙伴' : '协作记录核查'}</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {canMutate
                  ? '专家协作必须先选择一位在岗数字伙伴，再开始对话。'
                  : '请从左侧选择已有会话核查证据与审批轨迹。'}
              </p>
              {canMutate && (
                <Button size="sm" className="mt-4" onClick={actions.openNewSessionPicker}>
                  <BriefcaseBusiness className="h-3.5 w-3.5" />选择数字伙伴
                </Button>
              )}
              {canMutate && onDutyEmployees.length === 0 && (
                <p className="mt-3 text-[11px] text-[var(--text-muted)]">
                  当前工作区暂无在岗伙伴，请先到 <Link to="/partners" className="text-[var(--brand)]">数字伙伴</Link> 完成上岗。
                </p>
              )}
            </>
          )}
        </div>
        {canMutate && hasBoundExpert && (
          <>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              <Sparkles className="h-3 w-3" />建议试试
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {expertSuggestions.map((p) => {
                const Icon = suggestionIconMap[p.icon] ?? Sparkles;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { s.chat.setDraft(`${p.title} - ${p.desc}`); s.inputRef.current?.focus(); }}
                    className="copilot-suggestion-card group flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 text-left transition-colors hover:border-[var(--brand)] hover:bg-[var(--bg-elevated)]"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[var(--brand-light)] text-[var(--brand)] group-hover:bg-[var(--brand)] group-hover:text-white transition-colors">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--text)]">{p.title}</div>
                      <div className="text-[11px] text-[var(--text-muted)] truncate">{p.desc}</div>
                    </div>
                    <ArrowUp className="h-3.5 w-3.5 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 ml-auto self-center" />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (!currentSession) {
    return (
      <div ref={s.scrollRef} className="copilot-messages flex min-h-0 flex-1 flex-col overflow-y-auto">
        {emptyIntro}
      </div>
    );
  }

  return (
    <div ref={s.scrollRef} className="copilot-messages min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5" role="log" aria-live="polite" aria-relevant="additions text">
      {conversationMissing && (
        <div className="mx-auto mb-3 w-full max-w-3xl rounded-md bg-[var(--warning-bg)] px-3 py-2 text-[12px] text-[var(--warning)]">
          无法加载会话消息。请刷新后重试，或从左侧重新选择会话。
        </div>
      )}
      {displayMessages.length === 0 ? emptyIntro : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {displayMessages.map((message) => (
            <CopilotPageMessageBubble
              key={message.id}
              m={message}
              copiedId={s.copiedId}
              currentUser={currentUser}
              expert={activeEmployee ?? undefined}
              agentName={expertName}
              expertRole={expertMeta ?? undefined}
              generationElapsedSec={message.status === 'streaming' || message.status === 'in_flight' ? generationElapsedSec : undefined}
              conversationId={currentSession?.conversationId}
              onOpenContext={(tab, mid, artifact, opts) => openContext(tab, mid, artifact, opts)}
              onOpenAudit={openAuditTab}
              onOpenReplay={openReplay}
              onSwitchVariant={(mid, variantId) => void switchActiveVariant(mid, variantId)}
              onCopy={(m) => { void copyMessage(m); }}
              onEdit={(m) => {
                if (!canMutate) return;
                s.setEditingMessageId(m.id);
                s.chat.setDraft(m.content ?? '');
                requestAnimationFrame(() => s.inputRef.current?.focus());
              }}
              onRegenerate={(mid) => {
                if (!canMutate || isGenerating) return;
                s.chat.regenerate(mid);
              }}
              onRetryMessage={(mid) => {
                if (!canMutate || isGenerating) return;
                s.chat.retryMessage(mid);
              }}
              onFeedback={(mid, kind) => {
                if (!canMutate) return;
                s.chat.setFeedback(mid, { kind });
                if (kind === 'dislike') s.setFeedbackOpen(mid);
              }}
            />
          ))}
          {streamingAssistant && (
            <TurnThoughtPanel message={streamingAssistant} streaming />
          )}
          {showTypingFallback && (
            <div className="copilot-typing flex items-center gap-2 text-[12px] text-[var(--text-muted)]" aria-live="polite">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{generationHint || '正在连接模型与准备上下文…'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
