/**
 * SettingsTab.Tenant — 平台设置 / 组织:租户档案 + 配额条 + 通知渠道开关。
 * M09 P1 拆分:从 pages/Settings.tsx 行 224-408 抽出。
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell, Bot, CreditCard, ShieldCheck, Users, ExternalLink,
} from 'lucide-react';
import { Badge, Button, KpiCard, toast } from '@qzda/web-ui';
import { useApiMutation } from '@/services/query';
import {
  Field, PanelHeader, SettingsToggle, panelClass,
} from './SettingsShared';

type Billing = {
  price?: string;
  plan?: string;
  usage?: { seats?: number; seatLimit?: number; agents?: number; agentLimit?: number };
};
type TenantProfile = {
  name?: string;
  region?: string;
  tenantId?: string;
  createdAt?: string;
};
type NotifChannel = {
  id: string;
  name: string;
  enabled?: boolean;
  channels: string[];
  frequency: string;
};

export function TenantPanel({
  billing,
  tenantProfile,
  notifChannels,
  onGotoAccess,
}: {
  billing?: Billing;
  tenantProfile?: TenantProfile;
  notifChannels: NotifChannel[];
  onGotoAccess: () => void;
}) {
  const seats = billing?.usage?.seats ?? 18;
  const seatLimit = billing?.usage?.seatLimit ?? 50;
  const agents = billing?.usage?.agents ?? 8;
  const agentLimit = billing?.usage?.agentLimit ?? 20;
  const seatPct = Math.round((seats / seatLimit) * 100);
  const agentPct = Math.round((agents / agentLimit) * 100);
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [tenantName, setTenantName] = useState('ACME Corp');
  const [region, setRegion] = useState('cn-east-1');

  useEffect(() => {
    setEnabledMap(Object.fromEntries(notifChannels.map((n) => [n.id, Boolean(n.enabled)])));
  }, [notifChannels]);

  useEffect(() => {
    if (tenantProfile?.name) setTenantName(String(tenantProfile.name));
    if (tenantProfile?.region) setRegion(String(tenantProfile.region));
  }, [tenantProfile]);

  const saveProfile = useApiMutation<any, { name: string; region: string }>(
    '/api/tenant/profile',
    {
      onSuccess: () => toast.success('组织资料已保存，并写入审计'),
      onError: (error) => toast.error(error instanceof Error ? error.message : '保存失败'),
    },
    'PATCH',
  );
  const patchChannel = useApiMutation<any, { id: string; enabled: boolean }>(
    ({ id }) => `/api/notification-channels/${id}`,
    {
      onSuccess: () => toast.success('通知渠道已更新'),
      onError: (error) => toast.error(error instanceof Error ? error.message : '更新失败'),
    },
    'PATCH',
  );

  return (
    <div className="settings-section">
      <section className="settings-kpis">
        <KpiCard label="席位占用" value={seats} sub={`/ ${seatLimit}`} icon={Users} tone="brand" size="comfortable" />
        <KpiCard label="数字伙伴" value={agents} sub={`/ ${agentLimit}`} icon={Bot} tone="success" size="comfortable" />
        <KpiCard label="月费" value={billing?.price ?? '$5,000'} icon={CreditCard} tone="info" size="comfortable" />
        <KpiCard label="方案" value={billing?.plan === 'Enterprise Plus' ? 'Ent+' : (billing?.plan ?? 'Ent+')} icon={ShieldCheck} tone="warn" size="comfortable" />
      </section>

      <div className="settings-quota-strip">
        <div className="settings-quota-strip__item">
          <div className="settings-quota-strip__label">
            <Users className="h-3.5 w-3.5" />
            <span>席位配额</span>
            <strong className="font-mono">{seats}/{seatLimit}</strong>
          </div>
          <div className="settings-quota-strip__track" aria-hidden>
            <span style={{ width: `${Math.min(seatPct, 100)}%` }} />
          </div>
        </div>
        <div className="settings-quota-strip__item">
          <div className="settings-quota-strip__label">
            <Bot className="h-3.5 w-3.5" />
            <span>数字伙伴配额</span>
            <strong className="font-mono">{agents}/{agentLimit}</strong>
          </div>
          <div className="settings-quota-strip__track" aria-hidden>
            <span className={agentPct >= 80 ? 'is-warn' : undefined} style={{ width: `${Math.min(agentPct, 100)}%` }} />
          </div>
        </div>
        <div className="settings-quota-strip__item settings-quota-strip__item--plan">
          <div className="settings-quota-strip__label">
            <CreditCard className="h-3.5 w-3.5" />
            <span>当前方案</span>
            <strong>{billing?.plan === 'Enterprise Plus' ? 'Enterprise Plus' : (billing?.plan ?? 'Enterprise Plus')}</strong>
          </div>
          <p>月费 {billing?.price ?? '$5,000'} · 配额受套餐约束，扩容请联系客户成功。</p>
        </div>
      </div>

      <div className="settings-split settings-split--org">
        <section className={`${panelClass} settings-panel--fill`}>
          <PanelHeader
            icon={Users}
            title="租户信息"
            description="租户档案与配额边界；数字伙伴上限受套餐约束。"
            trailing={(
              <Button
                size="sm"
                loading={saveProfile.isPending}
                onClick={() => saveProfile.mutate({ name: tenantName.trim() || 'ACME Corp', region: region.trim() || 'cn-east-1' })}
              >
                保存
              </Button>
            )}
          />
          <div className="settings-facts">
            <label className="settings-fact">
              <span className="settings-fact__label">租户名</span>
              <input
                className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
              />
            </label>
            <Field label="租户 ID" value={<span className="font-mono">{tenantProfile?.tenantId ?? 'tenant-acme'}</span>} />
            <label className="settings-fact">
              <span className="settings-fact__label">区域</span>
              <input
                className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 font-mono text-xs"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              />
            </label>
            <Field label="创建时间" value={tenantProfile?.createdAt ?? '2024-03-12'} />
            <Field label="席位" value={<span className="font-mono">{seats} / {seatLimit}</span>} />
            <Field label="数字伙伴" value={<span className="font-mono">{agents} / {agentLimit}</span>} />
            <Field label="订阅" value={<span className="font-mono">{billing?.price ?? '$5,000'} / 月</span>} />
            <Field label="状态" value={<Badge tone="success">生产运行中</Badge>} />
          </div>
          <div className="settings-panel__foot">
            成员授权与职责分离请在
            <button type="button" className="settings-inline-link" onClick={onGotoAccess}>访问控制</button>
            管理。
          </div>
        </section>

        <section className={`${panelClass} settings-panel--fill`}>
          <PanelHeader
            icon={Bell}
            title="通知与告警"
            description="平台级告警订阅；渠道投递细节可在消息渠道管理。"
            trailing={(
              <Link to="/channels" className="settings-text-link">
                消息渠道 <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          />
          <div className="settings-notify-list">
            {notifChannels.map((n) => {
              const on = Boolean(enabledMap[n.id]);
              return (
                <div key={n.id} className={`settings-notify-row${on ? '' : ' is-off'}`}>
                  <div className="settings-notify-row__main">
                    <div className="settings-notify-row__title">
                      <span className={`settings-notify-row__icon${on ? ' is-on' : ''}`}>
                        <Bell className="h-3.5 w-3.5" />
                      </span>
                      <strong>{n.name}</strong>
                      <Badge tone={on ? 'success' : 'neutral'}>{on ? '启用' : '禁用'}</Badge>
                    </div>
                    <div className="settings-notify-row__channels">
                      {n.channels.map((c) => (
                        <span key={c}>{c}</span>
                      ))}
                    </div>
                    <p className="settings-notify-row__freq">频率 · {n.frequency}</p>
                  </div>
                  <SettingsToggle
                    checked={on}
                    onChange={(value) => {
                      setEnabledMap((prev) => ({ ...prev, [n.id]: value }));
                      patchChannel.mutate({ id: n.id, enabled: value });
                    }}
                    label={n.name}
                  />
                </div>
              );
            })}
          </div>
          <div className="settings-panel__foot">
            告警投递走消息渠道路由；关闭营销类通知不影响安全与系统状态。
          </div>
        </section>
      </div>
    </div>
  );
}
