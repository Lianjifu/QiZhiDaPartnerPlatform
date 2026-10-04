import { useEffect, useMemo, useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import type { ChatMessageEx } from '@/hooks/types';
import { thoughtKindLabel } from '../lib/human-thought';
import { buildTurnSummary } from './build-turn-summary';
import { groupTurnPhases } from './group-turn-phases';
import { phaseLabel } from './phase-labels';
import type { TurnMeta, TurnPhaseBlock } from './types';
import { TurnTaskList, settleTurnTasks } from './turn-task-list';

type Props = {
  message: ChatMessageEx;
  streaming?: boolean;
  showNarrative?: boolean;
};

function PhaseSection({ block, streaming }: { block: TurnPhaseBlock; streaming?: boolean }) {
  const hidden = Math.max(0, block.steps.length - 6);
  const visible = hidden > 0 ? block.steps.slice(-6) : block.steps;
  if (block.status === 'skipped') {
    return (
      <div className="copilot-turn-thought__phase copilot-turn-thought__phase--skipped text-[11px] text-[var(--text-muted)]">
        {block.label}（已跳过）
      </div>
    );
  }
  if (visible.length === 0 && block.status === 'pending') return null;
  return (
    <details className="copilot-turn-thought__phase group/phase" open={streaming && block.status === 'running'}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[12px] font-semibold text-[var(--text-secondary)] marker:content-none">
        <span className={cn(
          'inline-flex h-1.5 w-1.5 rounded-full',
          block.status === 'running' && 'bg-[var(--brand)] animate-pulse',
          block.status === 'done' && 'bg-[var(--success)]',
          block.status === 'pending' && 'bg-[var(--border)]',
        )} />
        {block.label}
        {block.status === 'running' ? <span className="text-[10px] font-normal text-[var(--brand)]">进行中</span> : null}
      </summary>
      <div className="mt-1.5 space-y-1.5 border-l border-[var(--border)] pl-3">
        {hidden > 0 ? (
          <div className="text-[10px] text-[var(--text-muted)]">另有 {hidden} 步已折叠</div>
        ) : null}
        {visible.map((s) => (
          <div key={s.id} className="flex items-start gap-2 text-[11px]">
            <span className="mt-0.5 text-[9px] font-medium text-[var(--text-muted)]">{thoughtKindLabel(s.kind)}</span>
            <div className="min-w-0">
              <div className="font-medium text-[var(--text-secondary)]">
                {s.frameworkLabel && s.kind !== 'framework' ? (
                  <span className="mr-1.5 rounded bg-[var(--brand-light)] px-1 py-0.5 text-[9px] text-[var(--brand)]">
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
    </details>
  );
}

export function TurnThoughtPanel({ message, streaming, showNarrative = true }: Props) {
  const thinking = (message.thinking ?? message.thinkingSummary ?? '').trim();
  const steps = message.reasoningSteps ?? [];
  const tasks = settleTurnTasks(message.turnTasks ?? message.turnMeta?.tasks ?? [], {
    streaming,
    messageStatus: message.status,
  });
  const phases = useMemo(
    () => groupTurnPhases(steps, tasks, message.cognitive, streaming, message.turnMeta as TurnMeta | undefined),
    [steps, tasks, message.cognitive, streaming, message.turnMeta],
  );
  const hasContent = thinking.length > 0 || steps.length > 0 || phases.length > 0 || tasks.length > 0;
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (streaming) setExpanded(true);
  }, [streaming, message.id]);

  if (!showNarrative) return null;

  if (!hasContent && streaming) {
    return (
      <div className="copilot-turn-thought max-w-[920px] rounded-md border border-dashed border-[var(--border)] bg-[var(--bg-elevated)]/60 px-3 py-2 text-[11px] text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-2">
          <Brain className="h-3 w-3 shrink-0 text-[var(--brand)]" />
          正在理解问题并准备下一步…
        </span>
      </div>
    );
  }

  if (!hasContent) return null;

  const summary = buildTurnSummary(message, phases, streaming);

  return (
    <div className="copilot-turn-thought max-w-[920px] rounded-md border border-[var(--border)] bg-[var(--bg-elevated)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={`turn-thought-${message.id}`}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        <Brain className="h-3 w-3 shrink-0" />
        <span className="font-semibold">{summary}</span>
        {expanded ? <ChevronDown className="ml-auto h-3 w-3" /> : <ChevronRight className="ml-auto h-3 w-3" />}
      </button>
      {expanded && (
        <div id={`turn-thought-${message.id}`} className="space-y-2 px-3 pb-2">
          {thinking ? (
            <div className="text-[11px] leading-relaxed text-[var(--text-muted)] whitespace-pre-wrap">{thinking}</div>
          ) : null}
          {phases.map((block) => (
            <PhaseSection key={block.phase} block={block} streaming={streaming} />
          ))}
          {tasks.length > 0 ? (
            <div className="rounded-md border border-[var(--border)]/70 bg-[var(--bg)]/40 px-2.5 py-2">
              <div className="mb-1 text-[10px] font-semibold text-[var(--text-muted)]">{phaseLabel('plan')} · 任务</div>
              <TurnTaskList tasks={tasks} compact />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
