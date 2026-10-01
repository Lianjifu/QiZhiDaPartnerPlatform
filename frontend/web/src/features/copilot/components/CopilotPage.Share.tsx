/**
 * ShareDialog — share session token dialog.
 */
import { ShieldCheck, Share2, X, Lock, Copy } from 'lucide-react';
import { Button } from '@qzda/web-ui';

export interface ShareDialogProps {
  open: boolean;
  token?: string;
  onCopy: () => Promise<void>;
  onClose: () => void;
}

export function ShareDialog({ open, token, onCopy, onClose }: ShareDialogProps) {
  if (!open) return null;
  return (
    <div className="copilot-citation-layer fixed inset-0 z-40" onClick={onClose}>
      <div className="copilot-scrim" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] max-w-[90vw] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div id="share-dialog-title" className="text-sm font-semibold flex items-center gap-2">
            <Share2 className="h-4 w-4 text-[var(--brand)]" />分享会话
          </div>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded hover:bg-[var(--bg-hover)]" aria-label="关闭分享">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 text-xs">
          <div className="rounded-md bg-[var(--bg)] border border-[var(--border)] p-2 text-[10px] text-[var(--text-muted)] flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3" />仅查看 · 脱敏 token / 内部 IP · 审计 SignedLog
          </div>
          <div>
            <div className="text-[10px] text-[var(--text-muted)] mb-1">分享链接（只读）</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-[11px] break-all rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5">
                {typeof window !== 'undefined' ? window.location.origin : ''}/copilot/share/{token}
              </code>
              <Button size="sm" variant="secondary" onClick={onCopy}>
                <Copy className="h-3 w-3" />复制
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
            <Lock className="h-3 w-3" />RBAC：仅工作区协作者可访问
          </div>
          <div className="flex gap-1.5 pt-2 border-t border-[var(--border)] justify-end">
            <Button size="sm" onClick={onClose}>完成</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
