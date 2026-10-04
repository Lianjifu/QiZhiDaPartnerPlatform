import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import { Button } from '@qzda/web-ui';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  closeOnBackdrop?: boolean;
  /** 为 false 时不响应 ESC（叠层确认弹窗打开时，底层弹窗应关闭此项） */
  closeOnEscape?: boolean;
  children?: ReactNode;
  /** 覆盖默认 body 样式，例如文档阅读器需要去掉内边距与外层滚动 */
  bodyClassName?: string;
  panelClassName?: string;
  /** 叠层用：确认框应高于业务弹窗，默认 z-[200] */
  overlayClassName?: string;
}

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-6xl',
  '2xl': 'max-w-[1440px]',
};

/**
 * 通用居中弹窗。open 由父级 state 控制，纯受控。
 * - ESC 关闭
 * - 点遮罩关闭（可通过 closeOnBackdrop 关闭）
 * - 自带 Header (title + 关闭按钮) + body + footer
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEscape = true,
  children,
  bodyClassName,
  panelClassName,
  overlayClassName,
}: ModalProps) {
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, closeOnEscape]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className={cn('fixed inset-0 z-[400] flex items-center justify-center p-4', overlayClassName)} role="presentation">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-[fadeIn_0.15s_ease]"
        onClick={() => closeOnBackdrop && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-[1] flex w-full max-h-[min(92vh,920px)] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_20px_60px_rgba(15,23,42,0.16)] animate-[scaleIn_0.18s_ease]',
          SIZE_CLASS[size],
          panelClassName,
        )}
      >
        {(title || description) && (
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-6 py-4">
            <div className="min-w-0">
              {title && <h3 className="text-[15px] font-semibold text-[var(--text)]">{title}</h3>}
              {description && <p className="mt-1 text-[13px] leading-5 text-[var(--text-muted)]">{description}</p>}
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
        {children != null && children !== false && (
          <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 py-5', bodyClassName)}>{children}</div>
        )}
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border)] px-6 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** 标准化 Modal 底部"取消 + 确认"按钮组 */
export function ModalActions({
  onCancel,
  onConfirm,
  confirmText = '确认',
  cancelText = '取消',
  confirmTone = 'primary',
  disabled = false,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmText?: string;
  cancelText?: string;
  confirmTone?: 'primary' | 'danger';
  disabled?: boolean;
}) {
  return (
    <>
      <Button variant="ghost" onClick={onCancel}>{cancelText}</Button>
      <Button
        variant={confirmTone === 'danger' ? 'danger' : 'primary'}
        onClick={onConfirm}
        disabled={disabled}
      >
        {confirmText}
      </Button>
    </>
  );
}
