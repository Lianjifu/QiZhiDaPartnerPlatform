/**
 * ExpertPickerModal — dialog to select a digital partner for new session / rebind.
 */
import { Search, Sparkles, X } from 'lucide-react';
import { Modal, Button, Input } from '@qzda/web-ui';
import { DigitalPartnerAvatar } from '@/features/partners/components/DigitalPartnerAvatar';
import type { DigitalPartner } from '@qzda/web-types';

export interface ExpertPickerModalProps {
  open: boolean;
  mode: 'new' | 'rebind';
  query: string;
  setQuery: (v: string) => void;
  blockedReason: string | null;
  experts: DigitalPartner[];
  onPick: (e: DigitalPartner) => void;
  onClose: () => void;
}

export function ExpertPickerModal(props: ExpertPickerModalProps) {
  const { open, mode, query, setQuery, blockedReason, experts, onPick, onClose } = props;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'rebind' ? '改绑数字伙伴' : '选择数字伙伴'}
      width={520}
    >
      <p className="text-xs text-[var(--text-muted)] mb-2">{mode === 'rebind' ? '改绑后，会话上下文与历史记录保留。' : '开始对话前必须选择一位在岗数字伙伴作为主协作人。'}</p>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2">
          <Search className="h-4 w-4 text-[var(--text-muted)]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按名称 / 角色 / 部门搜索"
            className="border-0 bg-transparent focus-visible:ring-0"
          />
        </div>
        {blockedReason && (
          <div className="rounded-md bg-[var(--warning-bg)] px-3 py-2 text-[11px] text-[var(--warning)]">
            {blockedReason}
          </div>
        )}
        <div className="max-h-[420px] overflow-y-auto">
          {experts.length === 0 ? (
            <div className="py-8 text-center text-[var(--text-muted)] text-xs">
              暂无在岗数字伙伴，请先完成上岗
            </div>
          ) : experts.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onPick(e)}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-[var(--bg-hover)]"
            >
              <DigitalPartnerAvatar employee={e as any} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{e.name}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">{e.role}</span>
                </div>
                <div className="text-[11px] text-[var(--text-muted)] truncate">{e.department}</div>
              </div>
              <Sparkles className="h-3.5 w-3.5 text-[var(--brand)]" />
            </button>
          ))}
        </div>
        <div className="flex items-center justify-end gap-1.5 border-t border-[var(--border)] pt-2">
          <Button size="sm" variant="secondary" onClick={onClose}><X className="h-3 w-3" />取消</Button>
        </div>
      </div>
    </Modal>
  );
}
