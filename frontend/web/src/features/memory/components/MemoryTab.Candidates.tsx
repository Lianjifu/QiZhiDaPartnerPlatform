/**
 * MemoryTab.Candidates — 知识候选审阅列表(通过/拒绝 + 草稿跳转)。
 * M07 P1 拆分原因:原 pages/Memory.tsx 单文件 1043L。
 */
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ExternalLink, FileUp, XCircle } from 'lucide-react';
import { Badge } from '@qzda/web-ui';
import { EmptyState } from '@/components/shared';
import type { DigitalPartner, MemoryKnowledgeCandidate, MemoryRecord } from '@qzda/web-types';
import { MEMORY_CLASSIFICATION_LABEL, memoryFormatFullTime } from './MemoryShared';

type Props = {
  items: MemoryKnowledgeCandidate[];
  records: MemoryRecord[];
  employeeMap: Map<string, DigitalPartner>;
  canReview: boolean;
  onReview: (id: string, action: 'approve' | 'reject') => void;
};

export function MemoryTabCandidates({ items, records, employeeMap, canReview, onReview }: Props) {
  const navigate = useNavigate();
  const pending = items.filter((item) => item.status === 'pending_review').length;
  return (
    <div className="memory-list">
      <div className="memory-section-head">
        <div>
          <h2>知识候选 · {pending} 待审</h2>
          <p>普通用户可提交候选；审核通过后创建知识包草稿并跳转知识中心。</p>
        </div>
      </div>
      {items.length ? (
        <div className="memory-record-list">
          {items.map((item) => {
            const source = records.find((record) => record.id === item.memoryId);
            const employee = source?.digitalPartnerId ? employeeMap.get(source.digitalPartnerId) : undefined;
            return (
              <article key={item.id} className="memory-record is-warn">
                <div className="memory-record__main">
                  <div className="memory-record__body">
                    <div className="memory-record__title">
                      <strong>{item.title}</strong>
                      <Badge tone={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'neutral' : 'warn'}>
                        {item.status === 'pending_review' ? '待审核' : item.status === 'approved' ? '已通过' : '已拒绝'}
                      </Badge>
                    </div>
                    <p>{item.summary}</p>
                  </div>
                  <div className="memory-record__actions">
                    {item.status === 'approved' && item.knowledgePackageId && (
                      <button type="button" className="memory-action memory-action--primary" onClick={() => navigate(`/knowledge/packages/${item.knowledgePackageId}`)}>
                        <ExternalLink className="h-3.5 w-3.5" />打开草稿
                      </button>
                    )}
                    {canReview && item.status === 'pending_review' && (
                      <>
                        <button type="button" className="memory-action memory-action--primary" onClick={() => onReview(item.id, 'approve')}>
                          <CheckCircle2 className="h-3.5 w-3.5" />通过
                        </button>
                        <button type="button" className="memory-action memory-action--danger" onClick={() => onReview(item.id, 'reject')}>
                          <XCircle className="h-3.5 w-3.5" />拒绝
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="memory-record__meta">
                  {employee && <span>{employee.name} · {employee.role}</span>}
                  <span>{MEMORY_CLASSIFICATION_LABEL[item.classification]}</span>
                  <span className="font-mono">来源 {item.sourceCorrelationId}</span>
                  <span>提交 {memoryFormatFullTime(item.submittedAt)}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="memory-empty">
          <EmptyState icon={FileUp} title="暂无待审核知识候选" description="从长期记忆提炼后将在此等待事实校验与责任人审核。" />
        </div>
      )}
    </div>
  );
}