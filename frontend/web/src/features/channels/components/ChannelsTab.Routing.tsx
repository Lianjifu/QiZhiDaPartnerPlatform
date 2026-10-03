import { Badge, Button } from '@qzda/web-ui';
import type {
  ChannelDeployment,
  DeliveryPolicyDraft,
  DeliveryPolicyVersion,
} from '@qzda/web-types';
import { EmptyState } from '@/components/shared';
import { deliveryPolicyStatusLabel } from '@/features/channels/channel-ui';
import { Route } from 'lucide-react';
import { CLASSIFICATION_LABEL, formatTime } from './ChannelsShared';

export function Routing({
  policies,
  deployments,
  canWrite,
  onOpen,
}: {
  policies: DeliveryPolicyDraft[];
  deployments: Map<string, ChannelDeployment>;
  canWrite: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="channels-panel">
      <div className="channels-section-head">
        <div>
          <h2>投递路由 · {policies.length}</h2>
          <p>事件、目标组、主渠道与降级链通过版本化发布生效；供数字伙伴告警与任务通知引用。</p>
        </div>
      </div>
      {policies.length ? (
        <div className="channels-table-wrap">
          <table className="channels-table">
            <thead>
              <tr>
                <th>事件</th>
                <th>目标</th>
                <th>主渠道</th>
                <th>降级链</th>
                <th>数据等级</th>
                <th>状态</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => {
                const primary = deployments.get(p.primaryDeploymentId);
                const fallbacks = p.fallbackDeploymentIds
                  .map((id) => deployments.get(id)?.name ?? id)
                  .join(' → ');
                return (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.eventType}</strong>
                      <small>数字伙伴 / 告警协同</small>
                    </td>
                    <td>{p.audience}</td>
                    <td>{primary?.name ?? p.primaryDeploymentId}</td>
                    <td className="channels-table__muted">{fallbacks || '—'}</td>
                    <td>{CLASSIFICATION_LABEL[p.dataClassification]}</td>
                    <td>
                      <Badge
                        tone={
                          p.status === 'published'
                            ? 'success'
                            : p.status === 'ready'
                              ? 'warn'
                              : 'neutral'
                        }
                      >
                        {deliveryPolicyStatusLabel(p.status)}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="channels-action channels-action--primary"
                        disabled={!canWrite}
                        onClick={() => onOpen(p.id)}
                      >
                        管理
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={Route}
          title="暂无投递策略"
          description="创建事件到目标组的路由草稿后，校验并发布方可投递。"
        />
      )}
    </div>
  );
}

export function PolicyDrawer({
  policy,
  versions,
  deployments,
  canWrite,
  onValidate,
  onPublish,
  onSimulate,
}: {
  policy: DeliveryPolicyDraft;
  versions: DeliveryPolicyVersion[];
  deployments: Map<string, ChannelDeployment>;
  canWrite: boolean;
  onValidate: () => void;
  onPublish: () => void;
  onSimulate: () => void;
}) {
  const primary = deployments.get(policy.primaryDeploymentId);
  const fallbacks = policy.fallbackDeploymentIds.map((id) => deployments.get(id)?.name ?? id);
  return (
    <div className="channels-drawer space-y-4 text-xs">
      <div className="channels-drawer-block">
        <h3>策略范围</h3>
        <p>{policy.eventType} → {policy.audience}</p>
        <div className="channels-card__meta mt-2">
          <span>密级 {CLASSIFICATION_LABEL[policy.dataClassification]}</span>
          <span>主渠道 {primary?.name ?? policy.primaryDeploymentId}</span>
          <span>降级 {fallbacks.join(' → ') || '—'}</span>
        </div>
      </div>
      {policy.validationIssues.length > 0 ? (
        <div className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-[var(--danger)]">
          {policy.validationIssues.join('；')}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={!canWrite} onClick={onValidate}>校验草稿</Button>
        <Button size="sm" disabled={!canWrite || policy.status !== 'ready'} onClick={onPublish}>发布版本</Button>
        <Button size="sm" variant="ghost" disabled={!canWrite} onClick={onSimulate}>容量模拟</Button>
      </div>
      <div className="channels-drawer-block">
        <h3>版本历史</h3>
        {versions.length ? (
          versions.map((v) => (
            <p key={v.id} className="mt-2">v{v.version} · {formatTime(v.publishedAt)} · {v.publishedBy}</p>
          ))
        ) : (
          <p className="mt-2 text-[var(--text-muted)]">暂无已发布版本</p>
        )}
      </div>
    </div>
  );
}