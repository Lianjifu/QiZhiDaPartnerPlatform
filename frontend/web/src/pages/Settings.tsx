/**
 * 平台设置：组织 / 身份 / 保留 / 集成 / 用量 + 治理三项
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApiMutation, useApiQuery } from '@/services/query';
import { Badge, Button, KpiCard, Progress, toast } from '@de/web-ui';
import {
  Building2, ShieldCheck, Bell, CreditCard, Database, Clock3, HardDrive,
  CheckCircle2, Plus, Key, Webhook, RotateCcw, Download, Trash2, Copy,
  Settings as SettingsIcon, ShieldAlert, ScrollText, Users, Link2, Activity,
  AlertTriangle, Bot, Coins, Fingerprint, Timer, ExternalLink,
} from 'lucide-react';
import { cn } from '@de/web-utils';
import { useT } from '@/i18n';
import Governance from '@/pages/Governance';
import ZeroTrust from '@/pages/ZeroTrust';
import AuditCenter from '@/pages/AuditCenter';

const MENU = [
  { key: 'tenant', labelKey: 'module.settings.tabs.organization', icon: Building2 },
  { key: 'security', labelKey: 'module.settings.tabs.identity', icon: Fingerprint },
  { key: 'backup', labelKey: 'module.settings.tabs.retention', icon: HardDrive },
  { key: 'apikeys', labelKey: 'module.settings.tabs.integration', icon: Key },
  { key: 'billing', labelKey: 'module.settings.tabs.usage', icon: CreditCard },
  { key: 'access', labelKey: 'nav.accessControl', icon: Users },
  { key: 'zeroTrust', labelKey: 'nav.zeroTrust', icon: ShieldAlert },
  { key: 'auditCenter', labelKey: 'nav.auditCenter', icon: ScrollText },
] as const;

type TabKey = (typeof MENU)[number]['key'];
const SETTINGS_TAB_KEYS = new Set<string>(MENU.map((item) => item.key));
const panelClass = 'de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]';

function SettingsToggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('settings-switch', checked && 'is-on')}
    >
      <span />
    </button>
  );
}

export default function Settings() {
  const { t } = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const [active, setActive] = useState<TabKey>(() =>
    (tabFromUrl && SETTINGS_TAB_KEYS.has(tabFromUrl) ? tabFromUrl : 'tenant') as TabKey,
  );

  const { data: billing } = useApiQuery<any>(['billing'], '/api/billing');
  const { data: tenantProfile } = useApiQuery<any>(
    ['tenant-profile'],
    '/api/tenant/profile',
    undefined,
    { enabled: active === 'tenant' },
  );
  const { data: notifChannels = [] } = useApiQuery<any[]>(
    ['notification-channels'],
    '/api/notification-channels',
    undefined,
    { enabled: active === 'tenant' },
  );
  const { data: apiKeys = [] } = useApiQuery<any[]>(
    ['api-keys'],
    '/api/api-keys',
    undefined,
    { enabled: active === 'apikeys' },
  );
  const { data: webhooks = [] } = useApiQuery<any[]>(
    ['webhooks-config'],
    '/api/webhooks-config',
    undefined,
    { enabled: active === 'apikeys' },
  );
  const { data: backups = [] } = useApiQuery<any[]>(
    ['backups'],
    '/api/backups',
    undefined,
    { enabled: active === 'backup' },
  );

  const selectTab = (key: TabKey) => {
    setActive(key);
    setSearchParams(key === 'tenant' ? {} : { tab: key }, { replace: true });
  };

  useEffect(() => {
    if (tabFromUrl && SETTINGS_TAB_KEYS.has(tabFromUrl) && tabFromUrl !== active) {
      setActive(tabFromUrl as TabKey);
    }
  }, [tabFromUrl, active]);

  return (
    <div className="settings-page de-employee-page h-full min-w-0 overflow-y-auto bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5">
      <div className="settings-page__stack">
        <section className={panelClass}>
          <div className="settings-page__intro">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <div className="de-employee-icon-tile grid h-9 w-9 place-items-center rounded-lg">
                  <SettingsIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-base font-semibold text-[var(--text)]">{t('module.settings.title')}</h1>
                  <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{t('module.settings.subtitle')}</p>
                </div>
              </div>
            </div>
            <div className="settings-guardrail">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>安全基线已启用</span>
            </div>
          </div>
          <nav className="de-employee-tabs flex overflow-x-auto px-3" aria-label="设置分类">
            {MENU.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => selectTab(item.key)}
                className={cn(
                  'de-employee-tab flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs transition-colors',
                  active === item.key && 'is-active',
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {t(item.labelKey)}
              </button>
            ))}
          </nav>
        </section>

        {active === 'tenant' && (
          <TenantPanel
            billing={billing}
            tenantProfile={tenantProfile}
            notifChannels={notifChannels}
            onGotoAccess={() => selectTab('access')}
          />
        )}
        {active === 'security' && <SecurityPanel onGotoAccess={() => selectTab('access')} />}
        {active === 'backup' && <BackupPanel backups={backups} />}
        {active === 'apikeys' && <IntegrationPanel apiKeys={apiKeys} webhooks={webhooks} />}
        {active === 'billing' && billing && <BillingPanel billing={billing} />}
        {active === 'access' && <Governance embedded />}
        {active === 'zeroTrust' && <ZeroTrust embedded />}
        {active === 'auditCenter' && <AuditCenter embedded />}
      </div>
    </div>
  );
}

function PanelHeader({
  icon: Icon,
  title,
  description,
  trailing,
}: {
  icon: typeof Building2;
  title: string;
  description?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="settings-panel__head">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <span className="settings-panel__icon">
            <Icon className="h-3.5 w-3.5" />
          </span>
          {title}
        </div>
        {description && <p className="settings-panel__desc">{description}</p>}
      </div>
      {trailing ? <div className="settings-panel__trailing shrink-0">{trailing}</div> : null}
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  meta,
  actionLabel,
  onAction,
}: {
  icon: typeof Building2;
  title: string;
  description: string;
  meta?: string[];
  actionLabel: string;
  onAction?: () => void;
}) {
  return (
    <article className="settings-feature-card">
      <div className="settings-feature-card__icon">
        <Icon className="h-4 w-4" />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {meta && meta.length > 0 && (
        <div className="settings-feature-card__meta">
          {meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      )}
      <button type="button" className="settings-feature-card__action" onClick={onAction}>
        {actionLabel}
        <ExternalLink className="h-3 w-3 opacity-70" />
      </button>
    </article>
  );
}

function TenantPanel({
  billing,
  tenantProfile,
  notifChannels,
  onGotoAccess,
}: {
  billing: any;
  tenantProfile?: any;
  notifChannels: any[];
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
        <section className={cn(panelClass, 'settings-panel--fill')}>
          <PanelHeader
            icon={Building2}
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

        <section className={cn(panelClass, 'settings-panel--fill')}>
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
                <div key={n.id} className={cn('settings-notify-row', !on && 'is-off')}>
                  <div className="settings-notify-row__main">
                    <div className="settings-notify-row__title">
                      <span className={cn('settings-notify-row__icon', on && 'is-on')}>
                        <Bell className="h-3.5 w-3.5" />
                      </span>
                      <strong>{n.name}</strong>
                      <Badge tone={on ? 'success' : 'neutral'}>{on ? '启用' : '禁用'}</Badge>
                    </div>
                    <div className="settings-notify-row__channels">
                      {n.channels.map((c: string) => (
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

function SecurityPanel({ onGotoAccess }: { onGotoAccess: () => void }) {
  return (
    <div className="settings-section">
      <section className="settings-kpis">
        <KpiCard label="身份源" value="OIDC" icon={Fingerprint} tone="brand" size="comfortable" />
        <KpiCard label="MFA 覆盖" value="96" sub="%" icon={ShieldCheck} tone="success" size="comfortable" />
        <KpiCard label="SSO 状态" value="已连接" icon={CheckCircle2} tone="info" size="comfortable" />
        <KpiCard label="会话超时" value="8h" icon={Timer} tone="warn" size="comfortable" />
      </section>

      <section className={panelClass}>
        <PanelHeader
          icon={Fingerprint}
          title="企业身份认证"
          description="数字伙伴与成员共用企业身份源；强制 MFA 与会话轮换，关键变更写入审计。"
          trailing={(
            <Badge tone="success">
              <CheckCircle2 className="mr-1 inline h-3 w-3" />
              企业 SSO 已连接
            </Badge>
          )}
        />

        <div className="settings-identity-strip">
          <div className="settings-identity-strip__item">
            <span>协议</span>
            <strong>OIDC</strong>
          </div>
          <div className="settings-identity-strip__item">
            <span>身份源</span>
            <strong>企业 IdP · ACME SSO</strong>
          </div>
          <div className="settings-identity-strip__item">
            <span>MFA</span>
            <strong>强制开启</strong>
          </div>
          <div className="settings-identity-strip__item">
            <span>最近同步</span>
            <strong className="font-mono">今天 09:12</strong>
          </div>
        </div>

        <div className="settings-feature-grid">
          <FeatureCard
            icon={ShieldCheck}
            title="单点登录"
            description="企业身份源同步成员与组映射，登录强制多因素验证。"
            meta={['OIDC', 'MFA', '组映射']}
            actionLabel="查看身份源"
          />
          <FeatureCard
            icon={Users}
            title="账户生命周期"
            description="入职同步、禁用回收与访问范围由访问控制统一管理。"
            meta={['成员同步', '禁用回收']}
            actionLabel="前往访问控制"
            onAction={onGotoAccess}
          />
          <FeatureCard
            icon={Timer}
            title="会话与令牌"
            description="Web 会话 8 小时，API Token 90 天轮换，异常登录自动告警。"
            meta={['8h 会话', '90 天 Token']}
            actionLabel="查看策略"
          />
        </div>

        <div className="settings-panel__foot">
          身份策略变更需管理员权限；数字伙伴运行身份继承企业 SSO，并受持续验证策略约束。
        </div>
      </section>
    </div>
  );
}

function BackupPanel({ backups }: { backups: any[] }) {
  const latest = backups[0];
  const autoCount = backups.filter((b) => b.type === '自动').length;
  const requestBackup = useApiMutation<any, { scope: string }>(
    '/api/backups',
    {
      onSuccess: () => toast.success('已提交备份申请，等待审批'),
      onError: (error) => toast.error(error instanceof Error ? error.message : '备份申请失败'),
    },
  );

  return (
    <div className="settings-section">
      <section className="settings-kpis">
        <KpiCard label="备份总数" value={backups.length} sub="份" icon={Database} tone="brand" size="comfortable" />
        <KpiCard label="最近备份" value={latest?.time?.slice(5, 10) ?? '—'} sub={latest?.time?.slice(11) ?? ''} icon={Clock3} tone="success" size="comfortable" />
        <KpiCard label="自动备份" value={autoCount} sub="份" icon={RotateCcw} tone="info" size="comfortable" />
        <KpiCard label="保留策略" value="30" sub="天" icon={HardDrive} tone="warn" size="comfortable" />
      </section>

      <section className={panelClass}>
        <PanelHeader
          icon={HardDrive}
          title="数据保留与恢复"
          description="覆盖数字伙伴运行记忆索引、知识与配置快照；恢复需管理员审批。"
          trailing={(
            <Button size="sm" loading={requestBackup.isPending} onClick={() => requestBackup.mutate({ scope: 'full' })}>
              <RotateCcw className="h-3 w-3" />立即备份
            </Button>
          )}
        />
        <div className="settings-table-head settings-table-head--backup">
          <span>备份时间</span>
          <span>类型</span>
          <span>大小</span>
          <span>耗时</span>
          <span className="text-right">操作</span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {backups.map((b) => (
            <article key={b.id} className="settings-table-row settings-table-row--backup">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" />
                <span className="font-mono text-[11px]">{b.time}</span>
              </div>
              <div><Badge tone={b.type === '自动' ? 'info' : 'brand'}>{b.type}</Badge></div>
              <div className="font-mono text-[var(--text-secondary)]">{b.size}</div>
              <div className="text-[var(--text-muted)]">{b.duration}</div>
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="secondary"><RotateCcw className="h-3 w-3" />恢复</Button>
                <Button size="sm" variant="secondary" aria-label="下载备份"><Download className="h-3 w-3" /></Button>
              </div>
            </article>
          ))}
        </div>
        <div className="settings-panel__foot">自动备份每日 02:00 执行；恢复操作需管理员审批并写入审计。</div>
      </section>
    </div>
  );
}

function IntegrationPanel({ apiKeys, webhooks }: { apiKeys: any[]; webhooks: any[] }) {
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
                {w.events.map((e: string) => <Badge key={e} tone="info">{e}</Badge>)}
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

function KeyStatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge tone="success">生效中</Badge>;
  if (status === 'warning') return <Badge tone="warn">即将到期</Badge>;
  return <Badge tone="neutral">{status}</Badge>;
}

function BillingPanel({ billing }: { billing: any }) {
  const usage = billing.usage;
  const quotas = [
    { key: 'cost', label: '本月成本', used: `$${usage.cost}`, limit: `$${usage.budget}`, pct: (usage.cost / usage.budget) * 100, tone: usage.cost / usage.budget >= 0.8 ? 'warn' as const : 'success' as const, icon: Coins },
    { key: 'tokens', label: 'Token 消耗', used: `${(usage.tokens / 1e6).toFixed(1)}M`, limit: `${(usage.tokenBudget / 1e6).toFixed(0)}M`, pct: (usage.tokens / usage.tokenBudget) * 100, tone: 'primary' as const, icon: Activity },
    { key: 'seats', label: '席位', used: String(usage.seats), limit: String(usage.seatLimit), pct: (usage.seats / usage.seatLimit) * 100, tone: 'primary' as const, icon: Users },
    { key: 'agents', label: '数字伙伴', used: String(usage.agents), limit: String(usage.agentLimit), pct: (usage.agents / usage.agentLimit) * 100, tone: usage.agents / usage.agentLimit >= 0.8 ? 'warn' as const : 'success' as const, icon: Bot },
  ];
  const budgetPct = Math.round((usage.cost / usage.budget) * 100);
  const warnCount = quotas.filter((q) => q.pct >= 80).length;

  return (
    <div className="settings-section">
      <section className="settings-kpis">
        <KpiCard label="订阅方案" value={billing.plan === 'Enterprise Plus' ? 'Ent+' : billing.plan} icon={CreditCard} tone="brand" size="comfortable" />
        <KpiCard label="固定月费" value={billing.price} icon={Building2} tone="info" size="comfortable" />
        <KpiCard label="预算消耗" value={budgetPct} sub="%" icon={Coins} tone={budgetPct >= 80 ? 'warn' : 'success'} size="comfortable" />
        <KpiCard label="下次扣款" value={billing.nextBilling.slice(5)} icon={Clock3} tone="warn" size="comfortable" />
      </section>

      <div className="settings-split settings-split--billing">
        <section className={panelClass}>
          <PanelHeader icon={CreditCard} title="订阅信息" trailing={<Badge tone="brand">{billing.plan}</Badge>} />
          <div className="settings-billing-facts">
            <BillingFact label="方案" value={billing.plan} />
            <BillingFact label="月费" value={<span className="font-mono font-semibold text-[var(--brand)]">{billing.price}</span>} />
            <BillingFact label="计费周期" value="按月 · 自然月结算" />
            <BillingFact label="下次扣款" value={billing.nextBilling} />
            <BillingFact label="席位上限" value={`${usage.seatLimit} 席`} />
            <BillingFact label="数字伙伴上限" value={`${usage.agentLimit} 个`} />
          </div>
          <div className="settings-panel__foot">
            <Button size="sm" variant="secondary"><Download className="h-3 w-3" />导出账单</Button>
          </div>
        </section>

        <section className={panelClass}>
          <PanelHeader
            icon={Bot}
            title="配额用量"
            description="按租户聚合席位、数字伙伴与 Token 消耗。"
            trailing={warnCount > 0 ? (
              <Badge tone="warn"><AlertTriangle className="mr-1 inline h-3 w-3" />{warnCount} 项接近上限</Badge>
            ) : (
              <Badge tone="success"><CheckCircle2 className="mr-1 inline h-3 w-3" />用量正常</Badge>
            )}
          />
          <div className="settings-table-head settings-table-head--quota">
            <span>配额项</span><span>已用 / 上限</span><span>占用</span><span>进度</span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {quotas.map((item) => (
              <article key={item.key} className="settings-table-row settings-table-row--quota">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <item.icon className="h-3.5 w-3.5 text-[var(--brand)]" />
                  {item.label}
                </div>
                <div className="font-mono text-[11px] text-[var(--text-secondary)]">{item.used} / {item.limit}</div>
                <div>
                  <Badge tone={item.pct >= 90 ? 'error' : item.pct >= 80 ? 'warn' : item.tone === 'success' ? 'success' : 'brand'}>
                    {Math.round(item.pct)}%
                  </Badge>
                </div>
                <div className="min-w-0">
                  <Progress value={item.pct} tone={item.pct >= 90 ? 'error' : item.pct >= 80 ? 'warn' : item.tone === 'success' ? 'success' : 'primary'} />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className={cn(panelClass, 'settings-panel__foot')}>
        套餐用量按租户聚合；Token 与运行成本达 80% 时将触发预算告警。升级方案或扩容数字伙伴席位请联系企业客户成功经理。
      </section>
    </div>
  );
}

function BillingFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="settings-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
