import { useId, useRef, useState } from 'react';
import { Check, ChevronDown, ListTodo, MessageSquare, Play } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import {
  RUN_MODE_OPTIONS,
  type RunMode,
  runModeLabel,
} from './composer-mode';
import { ComposerPortal } from './composer-portal';

type Props = {
  value: RunMode;
  disabled?: boolean;
  onChange: (mode: RunMode) => void;
};

const MODE_ICON = {
  ask: MessageSquare,
  plan: ListTodo,
  agent: Play,
} as const;

/** [方案 ▾] 下拉：问答 / 方案 / 执行，带图标 */
export function ComposerRunModeMenu({ value, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const TriggerIcon = MODE_ICON[value];

  const pick = (mode: RunMode) => {
    onChange(mode);
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
        title={disabled ? '当前不可切换协作模式' : '协作模式'}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'copilot-composer__mode-btn inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium',
          'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]',
          'disabled:cursor-not-allowed disabled:opacity-45',
          open && 'bg-[var(--bg-hover)] text-[var(--text)]',
          value === 'agent' && 'copilot-composer__mode-btn--execute',
        )}
      >
        <TriggerIcon className="h-3.5 w-3.5 shrink-0 opacity-80" />
        {runModeLabel(value)}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>
      <ComposerPortal
        open={open}
        anchorRef={btnRef}
        onClose={() => setOpen(false)}
        width={220}
        className="copilot-composer__menu overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] py-1 shadow-lg"
      >
        <div id={menuId} role="menu">
          {RUN_MODE_OPTIONS.map((opt) => {
            const active = opt.value === value;
            const Icon = MODE_ICON[opt.value];
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={cn(
                  'flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-[var(--bg-hover)]',
                  active && 'bg-[var(--bg-hover)]',
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(opt.value);
                }}
              >
                <span className={cn(
                  'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md',
                  opt.value === 'agent'
                    ? 'bg-[var(--warning-bg)] text-[var(--warning)]'
                    : 'bg-[var(--brand-light)] text-[var(--brand)]',
                )}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text)]">
                    {opt.label}
                    {active ? <Check className="h-3.5 w-3.5 text-[var(--brand)]" /> : null}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-[var(--text-muted)]">{opt.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </ComposerPortal>
    </>
  );
}
