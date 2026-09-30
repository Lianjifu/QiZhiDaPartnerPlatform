import type { ChannelDeployment, DeliveryPolicyStatus } from '@qzda/web-types';

export function deploymentDeletionAction(deletionAllowed: boolean) {
  return deletionAllowed ? { disabled: false, label: '删除部署' } : { disabled: true, label: '已被策略引用' };
}

export function deliveryPolicyStatusLabel(status: DeliveryPolicyStatus) {
  return ({ draft: '草稿', ready: '待发布', published: '已发布', superseded: '已替代' } as const)[status];
}

/** Normalize aliases written by older clients / cc-connect bind forms. */
export function normalizeConnectionMode(mode?: ChannelDeployment['connectionMode'] | string | null) {
  const value = String(mode ?? '').trim().toLowerCase();
  if (!value) return undefined;
  if (value === 'websocket' || value === 'ws' || value === 'long_connection') return 'websocket' as const;
  if (value === 'stream') return 'stream' as const;
  if (value === 'long_poll') return 'long_poll' as const;
  if (value === 'webhook') return 'webhook' as const;
  return undefined;
}

export function connectionModeLabel(mode?: ChannelDeployment['connectionMode'] | string | null) {
  const normalized = normalizeConnectionMode(mode);
  if (!normalized) return '';
  if (normalized === 'websocket') return 'WebSocket';
  if (normalized === 'stream') return 'Stream';
  if (normalized === 'long_poll') return '长轮询';
  return 'Webhook';
}

/** Whether inbound is HTTP callback (show 回调 path) vs long-connection (no public URL). */
export function isWebhookInboundMode(deployment: Pick<ChannelDeployment, 'connectionMode' | 'webhookPath' | 'kind'>) {
  const mode = normalizeConnectionMode(deployment.connectionMode);
  if (mode === 'websocket' || mode === 'stream' || mode === 'long_poll') return false;
  if (mode === 'webhook') return true;
  // Legacy rows without connectionMode: infer from webhookPath.
  return Boolean(deployment.webhookPath);
}

export function deploymentInboundFact(deployment: Pick<ChannelDeployment, 'connectionMode' | 'webhookPath' | 'webhookUrl' | 'kind'>) {
  if (isWebhookInboundMode(deployment) && deployment.webhookPath) {
    return {
      label: '回调',
      value: deployment.webhookPath,
      title: deployment.webhookUrl ?? deployment.webhookPath,
      mono: true,
    };
  }
  const mode = normalizeConnectionMode(deployment.connectionMode);
  if (mode === 'websocket') {
    return { label: '入站', value: 'WebSocket 长连接 · 无需公网', title: '开放平台选「使用长连接接收事件」', mono: false };
  }
  if (mode === 'stream') {
    return { label: '入站', value: 'Stream 长连接 · 无需公网', title: undefined, mono: false };
  }
  if (mode === 'long_poll') {
    return { label: '入站', value: '长轮询侧车 · 无需公网回调', title: undefined, mono: false };
  }
  return null;
}
