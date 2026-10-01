/**
 * HandoffModal — human handoff dialog.
 */
import { useState } from 'react';
import { Modal, Button, Input } from '@qzda/web-ui';
import { AlertTriangle, MessageSquareWarning } from 'lucide-react';
import type { ChatSession } from '@/hooks/types';

export interface HandoffModalProps {
  open: boolean;
  session: ChatSession | undefined;
  onClose: () => void;
}

export function HandoffModal({ open, session, onClose }: HandoffModalProps) {
  const [owner, setOwner] = useState('李婷 · 值班负责人');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="人工交接"
      width={420}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>取消</Button>
          <Button
            size="sm"
            disabled={!owner.trim()}
            onClick={onClose}
          >
            <MessageSquareWarning className="h-3 w-3" />确认交接
          </Button>
        </>
      }
    >
      <p className="text-xs text-[var(--text-muted)] mb-2">接管后，自动写操作保持暂停，已生成的证据与审批记录不变。</p>
      <div className="space-y-3">
        <label className="block text-xs font-medium">
          接管人
          <Input value={owner} onChange={(e) => setOwner(e.target.value)} className="mt-1.5" placeholder="例如：李婷 · 值班负责人" />
        </label>
        <div className="rounded-md bg-[var(--warning-bg)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-[var(--warning)]" />
          交接包含当前结论、证据与待审批。确认后将切回「方案」模式并暂停自动写操作（会话 {session?.id}）。
        </div>
      </div>
    </Modal>
  );
}
