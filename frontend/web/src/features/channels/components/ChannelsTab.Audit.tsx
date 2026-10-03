import { History } from 'lucide-react';
import { Badge } from '@qzda/web-ui';
import type { ChannelAuditEvent } from '@qzda/web-types';
import { EmptyState } from '@/components/shared';
import { formatTime } from './ChannelsShared';

export function Audit({ items }: { items: ChannelAuditEvent[] }) {
  return (
    <div className="channels-panel">
      <div className="channels-section-head">
        <div>
          <h2>渠道审计 · {items.length}</h2>
          <p>接入、验证、发布、投递与失败处置均保留关联证据，供合规与排障。</p>
        </div>
      </div>
      {items.length ? (
        <div className="channels-audit-list">
          {items.map((item) => (
            <article key={item.id} className="channels-audit">
              <div>
                <div className="channels-card__top">
                  <strong>{item.action}</strong>
                  <Badge tone={item.result === 'success' ? 'success' : 'error'}>
                    {item.result === 'success' ? '成功' : '失败'}
                  </Badge>
                </div>
                <p>{item.target}{item.reason ? ` · ${item.reason}` : ''}</p>
                <div className="channels-card__meta">
                  <span>{item.actor}</span>
                  <span className="font-mono">{item.correlationId}</span>
                </div>
              </div>
              <time>{formatTime(item.time)}</time>
            </article>
          ))}
        </div>
      ) : (
        <div className="channels-empty">
          <EmptyState icon={History} title="暂无渠道审计事件" description="完成接入验证或策略发布后，证据将出现在此。" />
        </div>
      )}
    </div>
  );
}