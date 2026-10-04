import { useEffect, useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import type { ChatMessageEx } from '@/hooks/types';
import { thoughtKindLabel } from './human-thought';

type Props = {
  message: ChatMessageEx;
  streaming?: boolean;
};

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '';
  const sec = Math.max(1, Math.round(ms / 1000));
  return `${sec}s`;
}

/** 助手气泡内可折叠思考：合并 thinking + reasoningSteps（人话） */
const MAX_VISIBLE_THOUGHT_STEPS = 8;

export function ThoughtPanel({ message, streaming }: Props) {
  const thinking = (message.thinking ?? message.thinkingSummary ?? '').trim();
  const steps = message.reasoningSteps ?? [];
  const hiddenStepCount = Math.max(0, steps.length - MAX_VISIBLE_THOUGHT_STEPS);
  const visibleSteps = hiddenStepCount > 0 ? steps.slice(-MAX_VISIBLE_THOUGHT_STEPS) : steps;
  const hasContent = thinking.length > 0 || steps.length > 0;
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (streaming) setExpanded(true);
  }, [streaming, message.id]);

  if (!hasContent && streaming) {
    return (
      <div className="copilot-message__thought max-w-[920px] rounded-md border border-dashed border-[var(--border)] bg-[var(--bg-elevated)]/60 px-3 py-2 text-[11px] text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-2">
          <Brain className="h-3 w-3 shrink-0 text-[var(--brand)]" />
          正在理解问题并准备下一步…
        </span>
      </div>
    );
  }

  if (!hasContent) return null;

  const durationLabel = formatDuration(message.metrics?.durationMs);
  const frameworkHint = message.cognitive?.bypass
    ? ''
    : (message.cognitive?.primaryLabel || message.reasoningSteps?.find((s) => s.frameworkLabel)?.frameworkLabel || '');
  const summary = streaming
    ? `思考中 · ${steps.length || 1} 步${frameworkHint ? ` · ${frameworkHint}` : ''}`
    : durationLabel
      ? `已思考 · ${durationLabel}${frameworkHint ? ` · ${frameworkHint}` : ''}`
      : steps.length
        ? `已思考 · ${steps.length} 步${frameworkHint ? ` · ${frameworkHint}` : ''}`
        : '已思考';

  return (
    <div className="copilot-message__thought max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg-elevated)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={`thought-${message.id}`}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        <Brain className="h-3 w-3 shrink-0" />
        <span className="font-semibold">{summary}</span>
        {expanded ? <ChevronDown className="ml-auto h-3 w-3" /> : <ChevronRight className="ml-auto h-3 w-3" />}
      </button>
      {expanded && (
        <div id={`thought-${message.id}`} className="space-y-2 px-3 pb-2">
          {thinking ? (
            <div className="text-[11px] leading-relaxed text-[var(--text-muted)] whitespace-pre-wrap">
              {thinking}
            </div>
          ) : null}
          {visibleSteps.length > 0 && (
            <div className="space-y-1.5">
              {hiddenStepCount > 0 ? (
                <div className="text-[10px] text-[var(--text-muted)]">
                  另有 {hiddenStepCount} 步已折叠
                </div>
              ) : null}
              {visibleSteps.map((s, i) => (
                <div key={s.id} className="flex items-start gap-2 text-[11px]">
                  <span className={cn(
                    'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[var(--brand-light)] text-[9px] font-mono text-[var(--brand)]',
                  )}>
                    {steps.length - visibleSteps.length + i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-[var(--text-secondary)]">
                      <span className="mr-1.5 text-[9px] font-medium text-[var(--text-muted)]">
                        {thoughtKindLabel(s.kind)}
                      </span>
                      {s.frameworkLabel && s.kind !== 'framework' ? (
                        <span className="mr-1.5 rounded bg-[var(--brand-light)] px-1 py-0.5 text-[9px] font-medium text-[var(--brand)]">
                          {s.frameworkLabel}
                        </span>
                      ) : null}
                      {s.title}
                    </div>
                    {s.detail ? <div className="text-[var(--text-muted)]">{s.detail}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
