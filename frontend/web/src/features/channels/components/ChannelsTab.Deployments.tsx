import { AlertTriangle, FileText, Power, ShieldCheck, Trash2, Pencil } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import type { ChannelDeployment } from '@qzda/web-types';
import { EmptyState } from '@/components/shared';
import { connectionModeLabel, deploymentDeletionAction, deploymentInboundFact } from '@/features/channels/channel-ui';
import { Cloud, Plus } from 'lucide-react';
import { DeploymentEditDrawer } from './ChannelsTab.DeploymentsDrawer';
import { ENV_LABEL, KIND_LABEL, STATUS_LABEL, formatTime } from './ChannelsShared';

export function Deployments({
  items,
  canWrite,
  refs,
  onNew,
  onEdit,
  onVerify,
  onDisable,
  onEnable,
  onDelete,
}: {
  items: ChannelDeployment[];
  canWrite: boolean;
  refs: Set<string>;
  onNew: () => void;
  onEdit: (d: ChannelDeployment) => void;
  onVerify: (id: string) => void;
  onDisable: (id: string) => void;
  onEnable: (id: string) => void;
  onDelete: (d: ChannelDeployment) => void;
}) {
  return (
    <div className="channels-panel">
      <div className="channels-section-head">
        <div>
          <h2>渠道接入 · {items.length}</h2>
          <p>受管部署、凭据引用、连通性验证与生命周期；可编辑配置，删除受已发布策略引用保护。</p>
        </div>
        <Button size="sm" disabled={!canWrite} onClick={onNew}><Plus className="h-3.5 w-3.5" />接入渠道</Button>
      </div>
      {items.length ? (
        <div className="channels-deploy-grid">
          {items.map((d) => {
            const deletion = deploymentDeletionAction(!refs.has(d.id));
            const mode = connectionModeLabel(d.connectionMode);
            const inbound = deploymentInboundFact(d);
            return (
              <article key={d.id} className="channels-card">
                <div className="channels-card__top">
                  <div className="min-w-0">
                    <strong>{d.name}</strong>
                    <p>{KIND_LABEL[d.kind] ?? d.kind} · {ENV_LABEL[d.environment]} · {d.owner}</p>
                  </div>
                  <Badge tone={d.status === 'active' ? 'success' : d.status === 'disabled' || d.status === 'offline' ? 'error' : 'neutral'}>
                    {STATUS_LABEL[d.status]}
                  </Badge>
                </div>

                <div className="channels-card__chips">
                  <span className="channels-card__chip">{KIND_LABEL[d.kind] ?? d.kind}</span>
                  <span className="channels-card__chip">{ENV_LABEL[d.environment]}</span>
                  {mode ? <span className="channels-card__chip channels-card__chip--accent">{mode}</span> : null}
                  {d.botName ? <span className="channels-card__chip" title={d.botOpenId}>机器人 {d.botName}</span> : null}
                </div>

                <dl className="channels-card__facts">
                  <div>
                    <dt>凭据</dt>
                    <dd className="font-mono">{d.credentialMasked}</dd>
                  </div>
                  {inbound ? (
                    <div>
                      <dt>{inbound.label}</dt>
                      <dd className={inbound.mono ? 'font-mono' : undefined} title={inbound.title}>{inbound.value}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>验证</dt>
                    <dd>{d.lastVerifiedAt ? `已验证 ${formatTime(d.lastVerifiedAt)}` : '待连通性验证'}</dd>
                  </div>
                  {d.lastVerifyError ? (
                    <div className="channels-card__facts--full">
                      <dt>最近错误</dt>
                      <dd className="channels-card__error">{d.lastVerifyError}</dd>
                    </div>
                  ) : null}
                </dl>

                <div className="channels-card__actions">
                  <button type="button" className="channels-action channels-action--primary" disabled={!canWrite} onClick={() => onEdit(d)}>
                    <Pencil className="h-3.5 w-3.5" />编辑
                  </button>
                  <button type="button" className="channels-action" disabled={!canWrite} onClick={() => onVerify(d.id)}>
                    <ShieldCheck className="h-3.5 w-3.5" />验证
                  </button>
                  {d.status === 'disabled' ? (
                    <button type="button" className="channels-action" disabled={!canWrite} onClick={() => onEnable(d.id)}>
                      <Power className="h-3.5 w-3.5" />启用
                    </button>
                  ) : (
                    <button type="button" className="channels-action" disabled={!canWrite || d.status === 'draft'} onClick={() => onDisable(d.id)}>
                      <Power className="h-3.5 w-3.5" />停用
                    </button>
                  )}
                  <button type="button" className="channels-action channels-action--danger" disabled={!canWrite || deletion.disabled} onClick={() => onDelete(d)}>
                    <Trash2 className="h-3.5 w-3.5" />{deletion.label}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Cloud} title="暂无渠道部署" description="接入飞书、企微或钉钉等投递通道后，数字伙伴通知与告警才能出站。" action={canWrite ? <Button size="sm" onClick={onNew}><Plus className="h-3.5 w-3.5" />接入渠道</Button> : undefined} />
      )}
    </div>
  );
}
