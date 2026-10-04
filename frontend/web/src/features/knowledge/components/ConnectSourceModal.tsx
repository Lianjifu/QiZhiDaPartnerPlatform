import { Badge, Button } from '@qzda/web-ui';
import { Modal } from '@/components/shared';
import { Database } from 'lucide-react';
import { ConnectSourceFormView, type ConnectSourceForm } from './ConnectSourceForm';

export type { ConnectSourceForm };

export function ConnectSourceModal({
  open,
  onClose,
  onSubmit,
  connecting = false,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (form: ConnectSourceForm) => void;
  connecting?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="接入数据源"
      description="连接企业知识来源后，按计划同步并进入所选知识包的加工队列。"
      size="lg"
      bodyClassName="knowledge-connect-body"
      panelClassName="knowledge-connect-modal"
    >
      <ConnectSourceFormView
        connecting={connecting}
        onSubmit={onSubmit}
        footer={({ valid, submit }) => (
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={connecting}>取消</Button>
            <Button disabled={!valid || connecting} onClick={submit}>
              <Database className="h-3.5 w-3.5" />
              {connecting ? '接入中…' : '确认接入'}
            </Button>
          </div>
        )}
      />
    </Modal>
  );
}
