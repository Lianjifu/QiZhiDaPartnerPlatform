import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@qzda/web-utils';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  side?: 'right' | 'left';
  width?: number;
  footer?: ReactNode;
  flush?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * 通用侧滑面板。open 受控。
 * - ESC 关闭
 * - 点遮罩关闭
 * - 滑入动画（CSS keyframes 由全局样式提供，或内联 transition）
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  side = 'right',
  width = 480,
  footer,
  flush = false,
  className,
  children,
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200]">
      <div
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px] animate-[drawerFadeIn_220ms_ease-out]"
        onClick={onClose}
      />
      <div
        className={cn(
          'absolute top-0 h-full overflow-hidden bg-[var(--surface-1)] flex flex-col animate-[drawerSlideIn_240ms_ease-out]',
          side === 'right' ? 'right-0' : 'left-0',
          'max-sm:!left-0 max-sm:!right-0 max-sm:!w-full',
          className,
        )}
        style={{
          width,
          maxWidth: '92vw',
          boxShadow: side === 'right'
            ? '-12px 0 40px rgba(15,23,42,0.10), -1px 0 0 rgba(15,23,42,0.06)'
            : '12px 0 40px rgba(15,23,42,0.10), 1px 0 0 rgba(15,23,42,0.06)',
        }}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-3 px-6 py-5" style={{ boxShadow: 'var(--saas-divider)' }}>
            <div className="min-w-0">
              {title && <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</h3>}
              {description && <p className="mt-1 text-[12px] text-[var(--text-muted)]">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--surface-1)]', flush ? 'px-0 py-0' : 'px-6 py-5')}>{children}</div>
        {footer && (
          <div className="px-6 py-4" style={{ boxShadow: 'inset 0 1px 0 rgba(15,23,42,0.06)' }}>{footer}</div>
        )}
      </div>
    </div>
  );
}
