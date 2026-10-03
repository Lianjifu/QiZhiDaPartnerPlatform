import { type ReactNode } from 'react';
import { Activity, AlertTriangle, Cloud, FileText, History, Route } from 'lucide-react';
import type { ChannelDeployment, ChannelKind } from '@qzda/web-types';

export type ChannelsTab = 'deployments' | 'routing' | 'templates' | 'health' | 'failures' | 'audit';

export const CHANNELS_TABS: Array<{ key: ChannelsTab; labelKey: string; icon: typeof Cloud }> = [
  { key: 'deployments', labelKey: 'module.channels.tabs.deployments', icon: Cloud },
  { key: 'templates', labelKey: 'module.channels.tabs.templates', icon: FileText },
  { key: 'routing', labelKey: 'module.channels.tabs.routing', icon: Route },
  { key: 'health', labelKey: 'module.channels.tabs.health', icon: Activity },
  { key: 'failures', labelKey: 'module.channels.tabs.failures', icon: AlertTriangle },
  { key: 'audit', labelKey: 'module.channels.tabs.audit', icon: History },
];

export const KIND_LABEL: Record<ChannelKind, string> = {
  feishu: '飞书',
  wecom: '企业微信',
  weixin: '个人微信',
  dingtalk: '钉钉',
  slack: 'Slack',
  webhook: 'Webhook',
};

export const STATUS_LABEL: Record<ChannelDeployment['status'], string> = {
  draft: '草稿',
  active: '运行中',
  disabled: '已停用',
  offline: '离线',
};

export const ENV_LABEL = { production: '生产', sandbox: '沙箱' } as const;

export const CLASSIFICATION_LABEL = { internal: '内部', restricted: '受限' } as const;

export type ChannelTemplate = {
  id: string;
  name: string;
  kind?: ChannelKind;
  locale?: string;
  status?: 'draft' | 'published';
  tone?: string;
  desc: string;
  preview: string;
  updatedAt?: string;
};

export type BlacklistItem = {
  id: string;
  type: string;
  value: string;
  reason: string;
  addedBy: string;
  expires: string;
};

export type DeploymentHealth = {
  deploymentId: string;
  successRate: number;
  p95Ms: number;
  errorCount24h: number;
  status: 'healthy' | 'attention' | 'offline';
  name?: string;
  kind?: string;
  environment?: string;
  deployStatus?: string;
};

export function formatTime(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN');
}

export function templateToneIcon(tone?: string) {
  if (tone === 'error') return { Icon: AlertTriangle, className: 'is-error' };
  if (tone === 'warn') return { Icon: AlertTriangle, className: 'is-warn' };
  return { Icon: FileText, className: 'is-info' };
}

export function sanitizeTemplatePreview(preview: string) {
  return preview.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/^\s+/gm, '').trim();
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="channels-create__field">
      <span className="channels-create__label">{label}</span>
      {children}
    </label>
  );
}
