/**
 * CloseoutModal — close-out summary dialog.
 */
import { useState } from 'react';
import { Modal, Button, Input } from '@qzda/web-ui';
import { FileDown, AlertTriangle } from 'lucide-react';
import type { ChatSession } from '@/hooks/types';

export interface CloseoutModalProps {
  open: boolean;
  session: ChatSession | undefined;
  onClose: () => void;
}

export function CloseoutModal({ open, session, onClose }: CloseoutModalProps) {
  const [summary, setSummary] = useState('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="结案"
      width={420}
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose}>取消</Button>
          <Button size="sm" disabled={!summary.trim()} onClick={() => { onClose(); }}><FileDown className="h-3 w-3" />确认结案</Button>
        </>
      }
    >
      <p className="text-xs text-[var(--text-muted)] mb-2">记录会话结论、证据与未完成事项。结案后会话标记为已完成。</p>
      <div className="space-y-3">
        <label className="block text-xs font-medium">
          结案摘要
          <Input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="本次会话结论与遗留事项…"
            className="mt-1.5"
          />
        </label>
        <div className="rounded-md bg-[var(--warning-bg)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-[var(--warning)]" />
          会话 {session?.id} 已完成，结案后可继续只读查阅，不会再产生新轮次。
        </div>
      </div>
    </Modal>
  );
}
