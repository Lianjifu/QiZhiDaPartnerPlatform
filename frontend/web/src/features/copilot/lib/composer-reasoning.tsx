import { useId, useRef, useState } from 'react';
import { Check, ChevronDown, Zap } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import {
  REASONING_EFFORT_OPTIONS,
  type ReasoningEffort,
  reasoningEffortLabel,
} from './composer-mode';
import { ComposerPortal } from './composer-portal';

type Props = {
  value: ReasoningEffort;
  disabled?: boolean;
  onChange: (effort: ReasoningEffort) => void;
};

export function ComposerReasoningMenu({ value, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const pick = (effort: ReasoningEffort) => {
    onChange(effort);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={disabled ? '当前不可调整推理强度' : '推理强度'}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'copilot-composer__reasoning-btn inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px]',
          'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]',
          'disabled:cursor-not-allowed disabled:opacity-45',
          open && 'bg-[var(--bg-hover)] text-[var(--text)]',
        )}
      >
        <Zap className="h-3 w-3 shrink-0" />
        <span className="font-medium">推理：{reasoningEffortLabel(value)}</span>
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>
      <ComposerPortal
        open={open}
        anchorRef={btnRef}
        onClose={() => setOpen(false)}
        width={144}
        className="copilot-composer__menu overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] py-1 shadow-lg"
      >
        <div id={menuId} role="menu">
          {REASONING_EFFORT_OPTIONS.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--bg-hover)]',
                  active && 'bg-[var(--bg-hover)] font-semibold',
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(opt.value);
                }}
              >
                <span className="grid h-4 w-4 place-items-center">
                  {active ? <Check className="h-3.5 w-3.5 text-[var(--brand)]" /> : null}
                </span>
                {opt.label}
              </button>
            );
          })}
        </div>
      </ComposerPortal>
    </>
  );
}
