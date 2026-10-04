import { useState } from 'react';
import { FileText } from 'lucide-react';
import { Button, Input } from '@qzda/web-ui';
import type { KnowledgeDoc } from '@qzda/web-types';
import { cn } from '@qzda/web-utils';
import { EmptyState, Modal } from '@/components/shared';

export function AttachDocsModal({
  open,
  onClose,
  candidates,
  onSubmit,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  candidates: KnowledgeDoc[];
  onSubmit: (docIds: string[]) => void;
  busy?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const visible = candidates.filter((doc) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return doc.title.toLowerCase().includes(q) || doc.source.toLowerCase().includes(q);
  });

  const close = () => {
    setSelected([]);
    setQuery('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="纳管文档到知识包"
      description="选择要纳入当前交付单元的内容文档。已发布知识包纳管后会回到「加工中」，需重新发布。"
      size="md"
      footer={(
        <>
          <Button variant="ghost" onClick={close}>取消</Button>
          <Button
            disabled={busy || selected.length === 0}
            onClick={() => {
              onSubmit(selected);
              setSelected([]);
              setQuery('');
            }}
          >
            纳管 {selected.length || ''} 篇
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        <Input placeholder="筛选标题或来源…" value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 text-xs" />
        {visible.length === 0 ? (
          <EmptyState icon={FileText} title="没有可纳管文档" description="当前工作区文档均已归属本包，或请先上传内容。" />
        ) : (
          <div className="max-h-[360px] space-y-1.5 overflow-y-auto">
            {visible.map((doc) => {
              const checked = selected.includes(doc.id);
              return (
                <label key={doc.id} className={cn('knowledge-package-attach-row', checked && 'is-active')}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setSelected((prev) => (checked ? prev.filter((id) => id !== doc.id) : [...prev, doc.id]))}
                  />
                  <span className="min-w-0">
                    <strong className="block truncate text-xs">{doc.title}</strong>
                    <small className="text-[10px] text-[var(--text-muted)]">{doc.source} · {doc.packageId ? `当前包 ${doc.packageId}` : '未归属'}</small>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
