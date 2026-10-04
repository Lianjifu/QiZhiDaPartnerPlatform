/**
 * MemoryDetail — 记忆详情 Modal 内容。
 * M07 P1 拆分原因:原 pages/Memory.tsx 单文件 1043L。
 */
import { useNavigate } from 'react-router-dom';
import { FileUp } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import type { DigitalPartner, MemoryRecord } from '@qzda/web-types';
import {
  MemoryRow,
  MEMORY_CLASSIFICATION_LABEL,
  MEMORY_LAYER,
  MEMORY_SCOPE_LABEL,
  MEMORY_SOURCE_LABEL,
  MEMORY_STATUS_LABEL,
  memoryFormatFullTime,
  memorySourcePath,
} from './MemoryShared';

export function MemoryDetail({
  record,
  employee,
  canMutate = false,
  onClose,
  onExpire,
  onDelete,
  onCandidate,
}: {
  record: MemoryRecord;
  employee?: DigitalPartner;
  canMutate?: boolean;
  onClose: () => void;
  onExpire: () => void;
  onDelete: () => void;
  onCandidate: () => void;
}) {
  const href = memorySourcePath(record);
  const navigate = useNavigate();
  return (
    <div className="memory-detail">
      <div className="flex flex-wrap gap-2">
        <Badge tone={MEMORY_LAYER[record.layer].tone}>{MEMORY_LAYER[record.layer].label}</Badge>
        <Badge tone="neutral">{MEMORY_CLASSIFICATION_LABEL[record.classification]}</Badge>
        <Badge tone={record.status === 'active' ? 'success' : 'warn'}>{MEMORY_STATUS_LABEL[record.status]}</Badge>
        <Badge tone="brand">{Math.round(record.confidence * 100)}% 置信</Badge>
      </div>
      <p className="memory-detail__content">{record.content}</p>
      <dl className="memory-detail__grid">
        <MemoryRow label="数字伙伴" value={employee ? `${employee.name} · ${employee.role}` : '未绑定'} />
        <MemoryRow label="作用域" value={MEMORY_SCOPE_LABEL[record.scope]} />
        <MemoryRow label="来源类型" value={MEMORY_SOURCE_LABEL[record.sourceType]} />
        <MemoryRow label="来源 ID" value={record.sourceId} />
        <MemoryRow label="关联链路" value={record.correlationId} />
        <MemoryRow label="过期时间" value={memoryFormatFullTime(record.expiresAt)} />
        <MemoryRow label="创建时间" value={memoryFormatFullTime(record.createdAt)} />
        <MemoryRow label="更新时间" value={memoryFormatFullTime(record.updatedAt)} />
      </dl>
      <div className="flex flex-wrap gap-2">
        {employee && (
          <Button size="sm" variant="secondary" onClick={() => navigate(`/partners/${employee.id}?tab=boundary`)}>
            查看岗位契约
          </Button>
        )}
        {href && (
          <Button size="sm" variant="secondary" onClick={() => navigate(href)}>
            打开来源
          </Button>
        )}
        {canMutate && record.layer === 'long_term' && record.status === 'active' && (
          <Button size="sm" onClick={onCandidate}>
            <FileUp className="h-3 w-3" />提炼为知识候选
          </Button>
        )}
        {canMutate && record.status === 'active' && (
          <Button size="sm" variant="ghost" onClick={onExpire}>失效</Button>
        )}
        {canMutate && <Button size="sm" variant="ghost" onClick={onDelete}>删除</Button>}
        <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
      </div>
    </div>
  );
}
