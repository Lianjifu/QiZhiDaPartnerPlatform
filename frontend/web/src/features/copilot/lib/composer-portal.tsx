import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** 相对锚点：上方（默认）或下方 */
  placement?: 'top' | 'bottom';
  width?: number;
};

/** 将弹出层挂到 body，避免 Composer overflow 裁切 */
export function ComposerPortal({
  open,
  anchorRef,
  onClose,
  children,
  className,
  placement = 'top',
  width = 208,
}: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.min(
        Math.max(8, r.left),
        window.innerWidth - width - 8,
      );
      if (placement === 'top') {
        setPos({ top: r.top - 6, left });
      } else {
        setPos({ top: r.bottom + 6, left });
      }
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, placement, width]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      className={className}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width,
        zIndex: 80,
        transform: placement === 'top' ? 'translateY(-100%)' : undefined,
      }}
      role="presentation"
    >
      {children}
    </div>,
    document.body,
  );
}
