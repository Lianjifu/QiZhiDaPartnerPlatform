import { CheckCircle2, Send } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import type { ChannelDeployment, DeliveryAttempt } from '@qzda/web-types';
import { EmptyState } from '@/components/shared';
import { formatTime } from './ChannelsShared';

export function Failures({
  items,
  deployments,
  canWrite,
  onGoRouting,
  onReplay,
}: {
  items: DeliveryAttempt[];
  deployments: Map<string, ChannelDeployment>;
  canWrite: boolean;
  onGoRouting: () => void;
  onReplay: (id: string) => void;
}) {
  return (
    <div className="channels-panel">
      <div className="channels-section-head">
        <div>
          <h2>失败处置 · {items.length}</h2>
          <p>失败自动重试、降级后进入死信；载荷与目标均脱敏，可回溯关联链路。</p>
        </div>
        <button type="button" className="channels-text-link" onClick={onGoRouting}>检查投递路由</button>
      </div>
      {items.length ? (
        <div className="channels-failure-list">
          {items.map((item) => (
            <article key={item.id} className="channels-failure">
              <div className="channels-card__top">
                <div>
                  <strong>死信 · {item.targetMasked}</strong>
                  <p>{deployments.get(item.deploymentId)?.name ?? item.deploymentId} · 尝试 {item.attempts} 次</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="error">死信</Badge>
                  <Button size="sm" variant="secondary" disabled={!canWrite} onClick={() => onReplay(item.id)}>
                    <Send className="h-3.5 w-3.5" />重投
                  </Button>
                </div>
              </div>
              <p className="channels-failure__payload">{item.payloadSummary}</p>
              <div className="channels-card__meta">
                <span>{formatTime(item.createdAt)}</span>
                <span className="font-mono">{item.correlationId}</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="channels-empty">
          <EmptyState
            icon={CheckCircle2}
            title="没有待处置死信"
            description="当前队列清空。若出现投递失败，将在此保留脱敏证据并支持人工复盘。"
          />
        </div>
      )}
    </div>
  );
}