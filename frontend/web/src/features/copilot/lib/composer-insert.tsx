import { useId, useRef, useState } from 'react';
import { AtSign, Hash, Paperclip, Plus } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import { ComposerPortal } from './composer-portal';

type Props = {
  disabled?: boolean;
  onAttach: () => void;
  onMention: () => void;
  onSlash: () => void;
};

/** 插入菜单：附件 / @ / 命令，收拢顶栏三图标 */
export function ComposerInsertMenu({ disabled, onAttach, onMention, onSlash }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
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
        title="插入附件、提及或命令"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'copilot-composer__tool grid h-7 w-7 place-items-center rounded-md',
          'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]',
          'disabled:cursor-not-allowed disabled:opacity-45',
          open && 'bg-[var(--bg-hover)] text-[var(--text)]',
        )}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <ComposerPortal
        open={open}
        anchorRef={btnRef}
        onClose={() => setOpen(false)}
        width={168}
        className="copilot-composer__menu overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] py-1 shadow-lg"
      >
        <div id={menuId} role="menu">
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--bg-hover)]"
            onMouseDown={(e) => { e.preventDefault(); pick(onAttach); }}
          >
            <Paperclip className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            添加附件
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--bg-hover)]"
            onMouseDown={(e) => { e.preventDefault(); pick(onMention); }}
          >
            <AtSign className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            @ 提及
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--bg-hover)]"
            onMouseDown={(e) => { e.preventDefault(); pick(onSlash); }}
          >
            <Hash className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            / 命令
          </button>
        </div>
      </ComposerPortal>
    </>
  );
}
