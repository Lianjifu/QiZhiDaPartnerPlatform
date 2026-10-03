/**
 * SettingsTab.Integration — 平台设置 / 集成:API Key 表 + Webhook 回调表。
 * M09 P1 拆分:从 pages/Settings.tsx 行 546-630 抽出。
 */
import {
  Activity, Clock3, Copy, Download, Key, Link2, Plus,
  RotateCcw, Settings as SettingsIcon, Trash2, Webhook,
} from 'lucide-react';
import { Badge, Button, KpiCard } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import {
  KeyStatusBadge, PanelHeader, panelClass,
} from './SettingsShared';

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  status: string;
  created: string;
  lastUsed: string;
  expires: string;
};

type WebhookConfig = {
  id: string;
  url: string;
  status: string;
  events: string[];
  success: number;
  retry: number;
};

export function IntegrationPanel({
  apiKeys,
  webhooks,
}: {
  apiKeys: ApiKey[];
  webhooks: WebhookConfig[];
}) {
  const activeKeys = apiKeys.filter((k) => k.status === 'active').length;
  const expiringKeys = apiKeys.filter((k) => k.status === 'warning').length;
  const avgSuccess = webhooks.length
    ? (webhooks.reduce((sum, w) => sum + w.success, 0) / webhooks.length).toFixed(1)
    : '—';

  return (
    <div className="settings-section">
      <section className="settings-kpis">
        <KpiCard label="活跃 Key" value={activeKeys} sub="个" icon={Key} tone="brand" size="comfortable" />
        <KpiCard label="即将到期" value={expiringKeys} sub="个" icon={Clock3} tone={expiringKeys ? 'warn' : 'success'} size="comfortable" />
        <KpiCard label="Webhook" value={webhooks.length} sub="个" icon={Webhook} tone="info" size="comfortable" />
        <KpiCard label="投递成功率" value={avgSuccess} sub="%" icon={Activity} tone="success" size="comfortable" />
      </section>

      <section className={panelClass}>
        <PanelHeader
          icon={Key}
          title="开发者凭证"
          description="供工作流、外部集成与 CI 调用控制面 API；生产建议最小权限。"
          trailing={<Button size="sm"><Plus className="h-3 w-3" />新建 Key</Button>}
        />
        <div className="settings-table-head settings-table-head--keys">
          <span>名称</span><span>Key 前缀</span><span>状态</span><span>创建</span><span>最后使用</span><span>到期</span><span className="text-right">操作</span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {apiKeys.map((k) => (
            <article key={k.id} className="settings-table-row settings-table-row--keys">
              <div className="flex min-w-0 items-center gap-2">
                <Key className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
                <span className="truncate font-semibold">{k.name}</span>
              </div>
              <div className="truncate font-mono text-[11px] text-[var(--text-secondary)]">{k.prefix}</div>
              <div><KeyStatusBadge status={k.status} /></div>
              <div className="text-[var(--text-muted)]">{k.created}</div>
              <div className="text-[var(--text-muted)]">{k.lastUsed}</div>
              <div className={cn('font-mono', k.status === 'warning' ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]')}>{k.expires}</div>
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="secondary" aria-label="复制 Key"><Copy className="h-3 w-3" /></Button>
                <Button size="sm" variant="secondary" aria-label="轮换 Key"><RotateCcw className="h-3 w-3" /></Button>
                <Button size="sm" variant="danger" aria-label="删除 Key"><Trash2 className="h-3 w-3" /></Button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={panelClass}>
        <PanelHeader
          icon={Webhook}
          title="Webhook 回调"
          description="订阅数字伙伴告警、升级与审计事件；失败进入重试与死信。"
          trailing={<Button size="sm"><Plus className="h-3 w-3" />添加</Button>}
        />
        <div className="settings-table-head settings-table-head--hooks">
          <span>回调地址</span><span>订阅事件</span><span>成功率</span><span>重试</span><span className="text-right">操作</span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {webhooks.map((w) => (
            <article key={w.id} className="settings-table-row settings-table-row--hooks">
              <div className="flex min-w-0 items-center gap-2">
                <Link2 className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
                <span className="truncate font-mono text-[11px]">{w.url}</span>
                <Badge tone="success" className="shrink-0">{w.status === 'active' ? '生效' : w.status}</Badge>
              </div>
              <div className="flex flex-wrap gap-1">
                {w.events.map((e) => <Badge key={e} tone="info">{e}</Badge>)}
              </div>
              <div className="font-mono text-[var(--success)]">{w.success}%</div>
              <div className="text-[var(--text-muted)]">{w.retry} 次</div>
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="secondary"><SettingsIcon className="h-3 w-3" /></Button>
                <Button size="sm" variant="secondary" aria-label="下载日志"><Download className="h-3 w-3" /></Button>
              </div>
            </article>
          ))}
        </div>
        <div className="settings-panel__foot">
          API Key 与 Webhook 凭据由服务端保管；轮换与删除均写入审计，生产环境建议最小权限与 IP 白名单。
        </div>
      </section>
    </div>
  );
}
