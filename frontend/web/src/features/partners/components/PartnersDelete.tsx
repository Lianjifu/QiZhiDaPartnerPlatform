import { useState } from 'react';
import { Button } from '@qzda/web-ui';
import { Modal } from '@/components/shared';
import { useApiMutation } from '@/services/query';
import { partnerCanDelete } from '@/features/partners/lib/partners';
import { employeePrimaryLabel } from '@/features/partners/lib/partners';
import type { DigitalPartner } from '@qzda/web-types';

export function DeleteUnreleasedPartnerButton({
  employee,
  onDeleted,
  className,
  variant = 'ghost',
}: {
  employee: DigitalPartner;
  onDeleted?: () => void;
  className?: string;
  variant?: 'ghost' | 'outline';
}) {
  const [open, setOpen] = useState(false);
  const remove = useApiMutation<{ id: string; status: string }, void>(
    () => `/api/partners/${encodeURIComponent(employee.id)}`,
    {
      invalidateKeys: [['digital-employees'], ['digital-employees', 'overview']],
      onSuccess: () => {
        setOpen(false);
        onDeleted?.();
      },
    },
    'DELETE',
  );
  if (!partnerCanDelete(employee)) return null;
  const errorText = remove.error instanceof Error ? remove.error.message : null;
  return (
    <>
      <Button size="sm" variant={variant} className={className} onClick={(event) => { event.stopPropagation(); setOpen(true); }}>删除</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="删除数字伙伴"
        description={`将删除「${employeePrimaryLabel(employee)}」的未上岗档案，此操作不可恢复。`}
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>确认删除</Button>
          </>
        )}
      >
        {errorText ? <p className="text-xs text-[var(--danger)]">{errorText}</p> : null}
      </Modal>
    </>
  );
}
