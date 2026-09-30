import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, Cloud, FileText, History, KeyRound, MessageSquare, Pencil, Plus, Power, Route, Search, Send, ShieldAlert, ShieldCheck, Trash2, Users,
} from 'lucide-react';
import { Badge, Button, Input, toast } from '@de/web-ui';
import type { ChannelAuditEvent, ChannelDeployment, ChannelKind, DeliveryAttempt, DeliveryPolicyDraft, DeliveryPolicyVersion } from '@de/web-types';
import { useApiMutation, useApiQuery } from '@/services/query';
import { ConfirmDialog, Drawer, EmptyState, Modal } from '@/components/shared';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { connectionModeLabel, deliveryPolicyStatusLabel, deploymentDeletionAction, deploymentInboundFact } from '@/features/channels/channel-ui';
import { useT } from '@/i18n';
import { cn } from '@de/web-utils';

type Tab = 'deployments' | 'routing' | 'templates' | 'health' | 'failures' | 'audit';

const TABS: Array<{ key: Tab; labelKey: string; icon: typeof Cloud }> = [
  { key: 'deployments', labelKey: 'module.channels.tabs.deployments', icon: Cloud },
  { key: 'templates', labelKey: 'module.channels.tabs.templates', icon: FileText },
  { key: 'routing', labelKey: 'module.channels.tabs.routing', icon: Route },
  { key: 'health', labelKey: 'module.channels.tabs.health', icon: Activity },
  { key: 'failures', labelKey: 'module.channels.tabs.failures', icon: AlertTriangle },
  { key: 'audit', labelKey: 'module.channels.tabs.audit', icon: History },
];

const KIND_LABEL: Record<ChannelKind, string> = {
  feishu: '飞书',
  wecom: '企业微信',
  weixin: '个人微信',
  dingtalk: '钉钉',
  slack: 'Slack',
  webhook: 'Webhook',
};

const STATUS_LABEL: Record<ChannelDeployment['status'], string> = {
  draft: '草稿',
  active: '运行中',
  disabled: '已停用',
  offline: '离线',
};

const ENV_LABEL = { production: '生产', sandbox: '沙箱' } as const;
const CLASSIFICATION_LABEL = { internal: '内部', restricted: '受限' } as const;

type ChannelTemplate = {
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

type BlacklistItem = { id: string; type: string; value: string; reason: string; addedBy: string; expires: string };

type DeploymentHealth = {
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

function formatTime(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN');
}

function templateToneIcon(tone?: string) {
  if (tone === 'error') return { Icon: ShieldAlert, className: 'is-error' };
  if (tone === 'warn') return { Icon: AlertTriangle, className: 'is-warn' };
  return { Icon: FileText, className: 'is-info' };
}

function sanitizeTemplatePreview(preview: string) {
  return preview.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/^\s+/gm, '').trim();
}

export default function Channels() {
  const { t } = useT();
  const { user } = useAuthStore();
  const canWrite = Boolean(user?.permissions.includes('channel.write'));
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId ?? 'w1');
  const scopeKey = `${currentWorkspaceId}:${user?.id ?? 'anonymous'}`;
  const [tab, setTab] = useState<Tab>('deployments');
  const [newOpen, setNewOpen] = useState(false);
  const [editDeployment, setEditDeployment] = useState<ChannelDeployment | null>(null);
  const [selectedPolicy, setSelectedPolicy] = useState<string | null>(null);
  const [deleteDeployment, setDeleteDeployment] = useState<ChannelDeployment | null>(null);
  const [templateQuery, setTemplateQuery] = useState('');

  const deployments = useApiQuery<ChannelDeployment[]>(['channel-deployments', scopeKey], '/api/channel-control/deployments');
  const policies = useApiQuery<DeliveryPolicyDraft[]>(['delivery-policies', scopeKey], '/api/channel-control/policies');
  const overview = useApiQuery<{ activeDeployments: number; publishedPolicies: number; deadLetters: number; capacityRisk: string }>(['channel-overview', scopeKey], '/api/channel-control/overview');
  const failures = useApiQuery<DeliveryAttempt[]>(['channel-dead-letters', scopeKey], '/api/channel-control/dead-letters');
  const audit = useApiQuery<ChannelAuditEvent[]>(['channel-audit', scopeKey], '/api/channel-control/audit');
  const healthMetrics = useApiQuery<DeploymentHealth[]>(['channel-health', scopeKey], '/api/channel-control/health', undefined, { enabled: tab === 'health' });
  const templates = useApiQuery<ChannelTemplate[]>(['channel-templates', scopeKey], '/api/channel-templates', undefined, { enabled: tab === 'templates' });
  const blacklist = useApiQuery<BlacklistItem[]>(['channel-blacklist', scopeKey], '/api/channel-blacklist', undefined, { enabled: tab === 'templates' });
  const activePolicy = policies.data?.find((item) => item.id === selectedPolicy);
  const versions = useApiQuery<DeliveryPolicyVersion[]>(['delivery-versions', scopeKey, selectedPolicy], `/api/channel-control/policies/${selectedPolicy ?? '__none__'}/versions`, undefined, { enabled: Boolean(selectedPolicy) });
  const create = useApiMutation<ChannelDeployment, Record<string, unknown>>('/api/channel-control/deployments');
  const update = useApiMutation<ChannelDeployment, Record<string, unknown> & { id: string }>((v) => `/api/channel-control/deployments/${v.id}`, undefined, 'PATCH');
  const verify = useApiMutation<ChannelDeployment, { id: string }>((v) => `/api/channel-control/deployments/${v.id}/verify`);
  const disable = useApiMutation<ChannelDeployment, { id: string }>((v) => `/api/channel-control/deployments/${v.id}/disable`);
  const remove = useApiMutation<{ id: string }, { id: string }>((v) => `/api/channel-control/deployments/${v.id}`, undefined, 'DELETE');
  const validate = useApiMutation<DeliveryPolicyDraft, { id: string }>((v) => `/api/channel-control/policies/${v.id}/validate`);
  const publish = useApiMutation<DeliveryPolicyVersion, { id: string }>((v) => `/api/channel-control/policies/${v.id}/publish`);
  const simulate = useApiMutation<{ status: string; capacityRisk: string }, { id: string }>((v) => `/api/channel-control/policies/${v.id}/simulate`);
  const createTemplate = useApiMutation<ChannelTemplate, { name: string; desc: string; kind: ChannelKind }>('/api/channel-templates');
  const replayDeadLetter = useApiMutation<DeliveryAttempt, { id: string }>((v) => `/api/channel-control/dead-letters/${v.id}/replay`);

  const loading = deployments.isLoading || policies.isLoading;
  const notifyError = (e: unknown) => toast.error(e instanceof Error ? e.message : '渠道控制面操作失败');
  const policyRefs = useMemo(() => new Set((policies.data ?? []).filter((p) => p.status === 'published').flatMap((p) => [p.primaryDeploymentId, ...p.fallbackDeploymentIds])), [policies.data]);
  const deploymentMap = useMemo(() => {
    const map = new Map<string, ChannelDeployment>();
    (deployments.data ?? []).forEach((item) => map.set(item.id, item));
    return map;
  }, [deployments.data]);

  const kpis: Array<{ key: Tab; label: string; value: number; sub: string; icon: typeof Cloud; tone: string }> = [
    { key: 'deployments', label: '活跃部署', value: overview.data?.activeDeployments ?? 0, sub: '个', icon: Cloud, tone: 'brand' },
    { key: 'routing', label: '已发布策略', value: overview.data?.publishedPolicies ?? 0, sub: '个', icon: Route, tone: 'brand' },
    { key: 'failures', label: '死信待处置', value: overview.data?.deadLetters ?? 0, sub: '条', icon: AlertTriangle, tone: (overview.data?.deadLetters ?? 0) > 0 ? 'warn' : 'success' },
  ];

  return (
    <div className="de-employee-page channels-page h-full min-w-0 overflow-y-auto bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5">
      <div className="channels-page__stack">
        <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
          <div className="flex items-start justify-between gap-4 px-4 py-3.5 md:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg">
                  <Send className="h-4 w-4" />
                </div>
                <h1 className="text-base font-semibold text-[var(--text)]">{t('module.channels.title')}</h1>
              </div>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{t('module.channels.subtitle')}</p>
            </div>
            <div className="channels-guardrail shrink-0">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>渠道控制面 · 服务端负责凭据与授权</span>
            </div>
          </div>
          <div className="de-employee-tabs flex overflow-x-auto px-3" role="tablist" aria-label={t('module.channels.title')}>
            {TABS.map(({ key, labelKey, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn('de-employee-tab flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs transition-colors', tab === key && 'is-active')}
              >
                <Icon className="h-3.5 w-3.5" />{t(labelKey)}
              </button>
            ))}
          </div>
        </section>

        <section className="channels-kpis" aria-label="渠道摘要">
          {kpis.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cn('channels-kpi', `channels-kpi--${item.tone}`, tab === item.key && 'is-active')}
              onClick={() => setTab(item.key)}
            >
              <span className="channels-kpi__icon"><item.icon className="h-4 w-4" /></span>
              <span className="channels-kpi__body">
                <span>{item.label}</span>
                <strong>{item.value}<small>{item.sub}</small></strong>
              </span>
            </button>
          ))}
        </section>

        <section className="de-employee-shell channels-workspace overflow-hidden rounded-xl bg-[var(--surface-1)]">
          {loading ? (
            <div className="channels-loading">正在读取渠道控制面状态…</div>
          ) : tab === 'deployments' ? (
            <Deployments
              items={deployments.data ?? []}
              canWrite={canWrite}
              refs={policyRefs}
              onNew={() => setNewOpen(true)}
              onEdit={setEditDeployment}
              onVerify={(id) => verify.mutate({ id }, { onSuccess: () => toast.success('渠道连通性验证通过'), onError: notifyError })}
              onDisable={(id) => disable.mutate({ id }, { onSuccess: () => toast.success('渠道部署已停用'), onError: notifyError })}
              onEnable={(id) => update.mutate({ id, status: 'active' }, { onSuccess: () => toast.success('渠道部署已恢复运行'), onError: notifyError })}
              onDelete={setDeleteDeployment}
            />
          ) : tab === 'routing' ? (
            <Routing
              policies={policies.data ?? []}
              deployments={deploymentMap}
              canWrite={canWrite}
              onOpen={setSelectedPolicy}
            />
          ) : tab === 'templates' ? (
            <Templates
              templates={templates.data ?? []}
              blacklist={blacklist.data ?? []}
              query={templateQuery}
              onQuery={setTemplateQuery}
              canWrite={canWrite}
              onCreate={(body) => createTemplate.mutate(body, { onSuccess: () => toast.success('消息模板草稿已创建'), onError: notifyError })}
            />
          ) : tab === 'health' ? (
            <Health
              overview={overview.data}
              deployments={deployments.data ?? []}
              metrics={healthMetrics.data ?? []}
              onSimulate={() => {
                const draft = policies.data?.[0];
                if (!draft) { toast.warn('暂无策略可模拟'); return; }
                simulate.mutate({ id: draft.id }, { onSuccess: (v) => toast[v.status === 'passed' ? 'success' : 'warn'](`模拟结果：${v.status} · 容量 ${v.capacityRisk}`), onError: notifyError });
              }}
              canWrite={canWrite}
            />
          ) : tab === 'failures' ? (
            <Failures
              items={failures.data ?? []}
              deployments={deploymentMap}
              canWrite={canWrite}
              onGoRouting={() => setTab('routing')}
              onReplay={(id) => replayDeadLetter.mutate({ id }, {
                onSuccess: () => {
                  toast.success('死信已重投并从队列移除');
                  failures.refetch();
                  overview.refetch();
                  audit.refetch();
                },
                onError: notifyError,
              })}
            />
          ) : (
            <Audit items={audit.data ?? []} />
          )}
        </section>
      </div>

      <DeploymentCreateModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        canWrite={canWrite}
        workspaceId={currentWorkspaceId}
        submitting={create.isPending || verify.isPending}
        onSubmit={async (body) => {
          try {
            const deployment = await create.mutateAsync(body);
            try {
              await verify.mutateAsync({ id: deployment.id });
              toast.success('渠道已接入并完成连通性验证');
            } catch (verifyErr) {
              toast.warn(verifyErr instanceof Error
                ? `已保存接入配置，但验证未通过：${verifyErr.message}`
                : '已保存接入配置，但连通性验证未通过，可稍后在卡片上重试「验证」');
            }
            setNewOpen(false);
          } catch (e) {
            notifyError(e);
          }
        }}
      />
      <DeploymentEditDrawer
        deployment={editDeployment}
        onClose={() => setEditDeployment(null)}
        canWrite={canWrite}
        submitting={update.isPending || verify.isPending}
        onSubmit={async (body) => {
          if (!editDeployment) return;
          try {
            const next = await update.mutateAsync({ id: editDeployment.id, ...body });
            if (body.reverify) {
              try {
                await verify.mutateAsync({ id: editDeployment.id });
                toast.success('渠道配置已更新并完成连通性验证');
              } catch (verifyErr) {
                toast.warn(verifyErr instanceof Error
                  ? `配置已保存，但验证未通过：${verifyErr.message}`
                  : '配置已保存，但连通性验证未通过');
              }
            } else {
              toast.success(`「${next.name}」已更新`);
            }
            setEditDeployment(null);
          } catch (e) {
            notifyError(e);
          }
        }}
      />
      <Drawer open={Boolean(activePolicy)} onClose={() => setSelectedPolicy(null)} title={activePolicy?.eventType} description="策略需校验后发布；发布产生不可变版本。" width={520}>
        {activePolicy && (
          <PolicyDrawer
            policy={activePolicy}
            versions={versions.data ?? []}
            deployments={deploymentMap}
            canWrite={canWrite}
            onValidate={() => validate.mutate({ id: activePolicy.id }, { onSuccess: (v) => toast[v.status === 'ready' ? 'success' : 'warn'](v.status === 'ready' ? '策略校验通过' : '策略校验未通过'), onError: notifyError })}
            onPublish={() => publish.mutate({ id: activePolicy.id }, { onSuccess: () => toast.success('投递策略已发布'), onError: notifyError })}
            onSimulate={() => simulate.mutate({ id: activePolicy.id }, { onSuccess: (v) => toast[v.status === 'passed' ? 'success' : 'warn'](`模拟结果：${v.status} · 容量 ${v.capacityRisk}`), onError: notifyError })}
          />
        )}
      </Drawer>
      <ConfirmDialog
        open={Boolean(deleteDeployment)}
        onClose={() => setDeleteDeployment(null)}
        onConfirm={() => { if (deleteDeployment) remove.mutate({ id: deleteDeployment.id }, { onSuccess: () => toast.success('渠道部署已删除'), onError: notifyError }); }}
        title="删除渠道部署？"
        description="已发布策略引用的部署将被 API 拒绝删除。"
        confirmText="删除"
        tone="danger"
      />
    </div>
  );
}

function Deployments({
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

function Routing({
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
                const fallbacks = p.fallbackDeploymentIds.map((id) => deployments.get(id)?.name ?? id).join(' → ');
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
                      <Badge tone={p.status === 'published' ? 'success' : p.status === 'ready' ? 'warn' : 'neutral'}>
                        {deliveryPolicyStatusLabel(p.status)}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <button type="button" className="channels-action channels-action--primary" disabled={!canWrite} onClick={() => onOpen(p.id)}>
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
        <EmptyState icon={Route} title="暂无投递策略" description="创建事件到目标组的路由草稿后，校验并发布方可投递。" />
      )}
    </div>
  );
}

function Templates({
  templates,
  blacklist,
  query,
  onQuery,
  canWrite,
  onCreate,
}: {
  templates: ChannelTemplate[];
  blacklist: BlacklistItem[];
  query: string;
  onQuery: (value: string) => void;
  canWrite: boolean;
  onCreate: (body: { name: string; desc: string; kind: ChannelKind }) => void;
}) {
  const [name, setName] = useState('');
  const visible = templates.filter((item) => !query.trim() || `${item.name} ${item.desc}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="channels-panel">
      <div className="channels-section-head">
        <div>
          <h2>消息模板 · {templates.length}</h2>
          <p>版本化模板、多语言与变量白名单；投递前脱敏。目标治理控制值班组与黑名单。</p>
        </div>
        <label className="channels-search">
          <Search className="h-3.5 w-3.5" />
          <Input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="检索模板" className="h-9 border-0 bg-transparent text-xs shadow-none focus-visible:ring-0" />
        </label>
      </div>

      <div className="channels-templates-grid">
        <section className="channels-subpanel">
          <div className="channels-subpanel__head">
            <h3><FileText className="h-4 w-4 text-[var(--brand)]" />模板资产</h3>
            {canWrite && (
              <div className="channels-inline-create">
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="新模板名称" className="h-8 w-36 text-xs" />
                <Button
                  size="sm"
                  disabled={!name.trim()}
                  onClick={() => { onCreate({ name: name.trim(), desc: '新建模板草稿', kind: 'feishu' }); setName(''); }}
                >
                  <Plus className="h-3.5 w-3.5" />新建
                </Button>
              </div>
            )}
          </div>
          {visible.length ? (
            <div className="channels-template-list">
              {visible.map((item) => {
                  const tone = templateToneIcon(item.tone);
                  return (
                <article key={item.id} className="channels-template-card">
                  <div className="channels-card__top">
                    <div className="channels-template-card__title">
                      <span className={cn('channels-template-icon', tone.className)}>
                        <tone.Icon className="h-3.5 w-3.5" />
                      </span>
                      <div>
                        <strong>{item.name}</strong>
                        <p>{item.desc}</p>
                      </div>
                    </div>
                    <Badge tone={item.status === 'published' ? 'success' : 'neutral'}>{item.status === 'published' ? '已发布' : '草稿'}</Badge>
                  </div>
                  <pre className="channels-template-preview">{sanitizeTemplatePreview(item.preview)}</pre>
                  <div className="channels-card__meta">
                    <span>{item.kind ? KIND_LABEL[item.kind] : '通用'}</span>
                    <span>{item.locale ?? 'zh-CN'}</span>
                    {item.updatedAt && <span>更新 {formatTime(item.updatedAt)}</span>}
                  </div>
                </article>
                  );
                })}
            </div>
          ) : (
            <EmptyState icon={FileText} title="没有匹配的模板" />
          )}
        </section>

        <section className="channels-subpanel">
          <div className="channels-subpanel__head">
            <h3><Users className="h-4 w-4 text-[var(--brand)]" />目标治理</h3>
          </div>
          <p className="channels-subpanel__desc">策略仅可引用已批准目标组；黑名单阻止异常收件人接收生产告警。</p>
          {blacklist.length ? (
            <div className="channels-blacklist">
              {blacklist.map((item) => (
                <div key={item.id} className="channels-blacklist__row">
                  <div>
                    <strong>{item.value}</strong>
                    <p>{item.type} · {item.reason}</p>
                  </div>
                  <div className="channels-blacklist__meta">
                    <span>{item.addedBy}</span>
                    <span>至 {item.expires}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Users} title="暂无黑名单条目" />
          )}
        </section>
      </div>
    </div>
  );
}

function Health({
  overview,
  deployments,
  metrics,
  onSimulate,
  canWrite,
}: {
  overview?: { capacityRisk: string; activeDeployments?: number; deadLetters?: number };
  deployments: ChannelDeployment[];
  metrics: DeploymentHealth[];
  onSimulate: () => void;
  canWrite: boolean;
}) {
  const metricMap = useMemo(() => {
    const map = new Map<string, DeploymentHealth>();
    metrics.forEach((item) => map.set(item.deploymentId, item));
    return map;
  }, [metrics]);
  const rows = deployments.map((item) => {
    const health = metricMap.get(item.id) ?? {
      deploymentId: item.id,
      successRate: item.status === 'active' ? 99 : 0,
      p95Ms: item.status === 'active' ? 150 : 0,
      errorCount24h: 0,
      status: item.status === 'active' ? 'healthy' as const : 'offline' as const,
    };
    return { ...item, ...health };
  });
  const capacity = overview?.capacityRisk ?? 'unknown';

  return (
    <div className="channels-panel">
      <div className="channels-section-head">
        <div>
          <h2>运行健康</h2>
          <p>按部署查看成功率、P95 与错误；容量风险可走策略模拟预检。</p>
        </div>
        <Button size="sm" variant="secondary" disabled={!canWrite} onClick={onSimulate}>容量模拟</Button>
      </div>

      <div className="channels-health-summary">
        <div className="channels-health-stat">
          <span>容量风险</span>
          <strong className={capacity === 'normal' ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>{capacity}</strong>
        </div>
        <div className="channels-health-stat">
          <span>活跃部署</span>
          <strong>{overview?.activeDeployments ?? deployments.filter((d) => d.status === 'active').length}</strong>
        </div>
        <div className="channels-health-stat">
          <span>死信水位</span>
          <strong>{overview?.deadLetters ?? 0}</strong>
        </div>
      </div>

      <div className="channels-health-grid">
        {rows.map((row) => (
          <article key={row.id} className="channels-card">
            <div className="channels-card__top">
              <div>
                <strong>{row.name}</strong>
                <p>{KIND_LABEL[row.kind as ChannelKind] ?? row.kind} · {ENV_LABEL[row.environment as keyof typeof ENV_LABEL] ?? row.environment}</p>
              </div>
              <Badge tone={row.status === 'healthy' ? 'success' : row.status === 'attention' ? 'warn' : 'neutral'}>
                {row.status === 'healthy' ? '健康' : row.status === 'attention' ? '关注' : '离线'}
              </Badge>
            </div>
            <div className="channels-health-metrics">
              <div><span>成功率</span><strong>{row.successRate}%</strong></div>
              <div><span>P95</span><strong>{row.p95Ms}<small>ms</small></strong></div>
              <div><span>24h 错误</span><strong>{row.errorCount24h}</strong></div>
            </div>
          </article>
        ))}
        <article className="channels-card channels-card--soft">
          <div className="channels-card__top">
            <div>
              <strong>隔离演练</strong>
              <p>在 sandbox / canary 验证投递链路，不影响生产目标组。</p>
            </div>
            <CheckCircle2 className="h-4 w-4 text-[var(--brand)]" />
          </div>
          <p className="channels-card__hint">建议在策略发布前执行模拟，确认降级链容量充足。</p>
        </article>
      </div>
    </div>
  );
}

function Failures({
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

function Audit({ items }: { items: ChannelAuditEvent[] }) {
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
                  <Badge tone={item.result === 'success' ? 'success' : 'error'}>{item.result === 'success' ? '成功' : '失败'}</Badge>
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

function PolicyDrawer({
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
      {policy.validationIssues.length > 0 && (
        <div className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-[var(--danger)]">
          {policy.validationIssues.join('；')}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={!canWrite} onClick={onValidate}>校验草稿</Button>
        <Button size="sm" disabled={!canWrite || policy.status !== 'ready'} onClick={onPublish}>发布版本</Button>
        <Button size="sm" variant="ghost" disabled={!canWrite} onClick={onSimulate}>容量模拟</Button>
      </div>
      <div className="channels-drawer-block">
        <h3>版本历史</h3>
        {versions.length
          ? versions.map((v) => <p key={v.id} className="mt-2">v{v.version} · {formatTime(v.publishedAt)} · {v.publishedBy}</p>)
          : <p className="mt-2 text-[var(--text-muted)]">暂无已发布版本</p>}
      </div>
    </div>
  );
}

const DEPLOY_KIND_OPTIONS: Array<{ value: ChannelKind; label: string; hint: string; icon: typeof MessageSquare }> = [
  { value: 'feishu', label: '飞书', hint: '企业自建应用', icon: MessageSquare },
  { value: 'dingtalk', label: '钉钉', hint: '企业内部应用', icon: Cloud },
  { value: 'wecom', label: '企业微信', hint: '自建应用回调', icon: Users },
  { value: 'weixin', label: '个人微信', hint: 'ilink 长轮询', icon: Send },
];

function DeploymentEditDrawer({
  deployment,
  onClose,
  canWrite,
  submitting = false,
  onSubmit,
}: {
  deployment: ChannelDeployment | null;
  onClose: () => void;
  canWrite: boolean;
  submitting?: boolean;
  onSubmit: (v: Record<string, unknown> & { reverify?: boolean }) => void | Promise<void>;
}) {
  const open = Boolean(deployment);
  const kind = deployment?.kind ?? 'feishu';
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState<'sandbox' | 'production'>('sandbox');
  const [domain, setDomain] = useState('');
  const [connectionMode, setConnectionMode] = useState('websocket');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [encryptKey, setEncryptKey] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [robotCode, setRobotCode] = useState('');
  const [corpId, setCorpId] = useState('');
  const [corpSecret, setCorpSecret] = useState('');
  const [agentId, setAgentId] = useState('');
  const [weixinToken, setWeixinToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [reverify, setReverify] = useState(true);

  useEffect(() => {
    if (!deployment) return;
    setName(deployment.name);
    setEnvironment(deployment.environment);
    setDomain(deployment.domain ?? '');
    setConnectionMode(
      deployment.connectionMode === 'long_connection' ? 'websocket'
        : (deployment.connectionMode ?? (kind === 'dingtalk' ? 'stream' : kind === 'weixin' ? 'long_poll' : 'websocket')),
    );
    setAppId('');
    setAppSecret('');
    setVerificationToken('');
    setEncryptKey('');
    setClientId('');
    setClientSecret('');
    setRobotCode(deployment.robotCode ?? '');
    setCorpId('');
    setCorpSecret('');
    setAgentId(deployment.agentId ?? '');
    setWeixinToken('');
    setAccountId(deployment.accountId ?? '');
    setReverify(true);
  }, [deployment, kind]);

  const valid = canWrite && name.trim().length > 0;

  const handleSave = () => {
    if (!valid || !deployment || submitting) return;
    const body: Record<string, unknown> & { reverify?: boolean } = {
      name: name.trim(),
      environment,
      reverify,
    };
    if (domain.trim()) body.domain = domain.trim();

    if (kind === 'feishu') {
      const mode = connectionMode === 'webhook' ? 'webhook' : 'websocket';
      body.connectionMode = mode;
      if (appId.trim()) body.appId = appId.trim();
      if (appSecret.trim()) body.appSecret = appSecret.trim();
      if (mode === 'webhook') {
        if (verificationToken.trim()) body.verificationToken = verificationToken.trim();
        if (encryptKey.trim()) body.encryptKey = encryptKey.trim();
      }
    } else if (kind === 'dingtalk') {
      body.connectionMode = connectionMode === 'webhook' ? 'webhook' : 'stream';
      if (clientId.trim()) body.clientId = clientId.trim();
      if (clientSecret.trim()) body.clientSecret = clientSecret.trim();
      if (robotCode.trim()) body.robotCode = robotCode.trim();
    } else if (kind === 'wecom') {
      body.connectionMode = connectionMode === 'websocket' ? 'websocket' : 'webhook';
      if (connectionMode === 'websocket') {
        if (clientId.trim()) body.botId = clientId.trim();
        if (clientSecret.trim()) body.botSecret = clientSecret.trim();
      } else {
        if (corpId.trim()) body.corpId = corpId.trim();
        if (corpSecret.trim()) body.corpSecret = corpSecret.trim();
        if (agentId.trim()) body.agentId = agentId.trim();
      }
    } else if (kind === 'weixin') {
      if (weixinToken.trim()) body.token = weixinToken.trim();
      if (accountId.trim()) body.accountId = accountId.trim();
    }

    onSubmit(body);
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="编辑渠道部署"
      description={`${KIND_LABEL[kind] ?? kind} · ${deployment?.credentialMasked ?? ''}；密钥留空则保留原凭据。`}
      width={520}
      footer={(
        <div className="flex items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
            <input type="checkbox" checked={reverify} onChange={(e) => setReverify(e.target.checked)} disabled={!canWrite || submitting} />
            保存后重新验证
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>取消</Button>
            <Button size="sm" disabled={!valid || submitting} onClick={handleSave}>
              {submitting ? '保存中…' : '保存修改'}
            </Button>
          </div>
        </div>
      )}
    >
      <div className="channels-create">
        <Field label="显示名称">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-[var(--bg)]" autoComplete="off" />
        </Field>
        <div className="channels-create__grid">
          <Field label="环境">
            <select value={environment} onChange={(e) => setEnvironment(e.target.value as 'sandbox' | 'production')} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
              <option value="sandbox">沙箱</option>
              <option value="production">生产</option>
            </select>
          </Field>
          <Field label="类型">
            <Input value={KIND_LABEL[kind] ?? kind} disabled className="bg-[var(--bg)]" />
          </Field>
        </div>

        {(kind === 'feishu') ? (
          <>
            <div className="channels-create__grid">
              <Field label={`App ID（当前 ${deployment?.appIdMasked ?? deployment?.credentialMasked ?? '••••'}）`}>
                <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
              </Field>
              <Field label="App Secret">
                <Input type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)]" autoComplete="new-password" />
              </Field>
            </div>
            <Field label="API 域名">
              <select value={domain || 'https://open.feishu.cn'} onChange={(e) => setDomain(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="https://open.feishu.cn">飞书（open.feishu.cn）</option>
                <option value="https://open.larksuite.com">Lark 国际</option>
              </select>
            </Field>
            <Field label="事件接收模式">
              <select value={connectionMode} onChange={(e) => setConnectionMode(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="websocket">WebSocket 长连接（无需公网）</option>
                <option value="webhook">Webhook（平台托管 URL）</option>
              </select>
            </Field>
            {connectionMode === 'webhook' ? (
              <div className="channels-create__grid">
                <Field label="Verification Token">
                  <Input value={verificationToken} onChange={(e) => setVerificationToken(e.target.value)} placeholder="可选，留空保留" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                </Field>
                <Field label="Encrypt Key">
                  <Input type="password" value={encryptKey} onChange={(e) => setEncryptKey(e.target.value)} placeholder="可选，留空保留" className="bg-[var(--bg)]" autoComplete="new-password" />
                </Field>
              </div>
            ) : (
              <div className="channels-create__hint" role="note">
                <KeyRound className="h-3.5 w-3.5 shrink-0" />
                <p>开放平台请选「使用长连接接收事件」。切换为 WebSocket 后将不再暴露 Webhook 回调路径。</p>
              </div>
            )}
          </>
        ) : null}

        {kind === 'dingtalk' ? (
          <>
            <div className="channels-create__grid">
              <Field label={`Client ID（当前 ${deployment?.clientIdMasked ?? deployment?.credentialMasked ?? '••••'}）`}>
                <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
              </Field>
              <Field label="Client Secret">
                <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)]" autoComplete="new-password" />
              </Field>
            </div>
            <Field label="Robot Code（可选）">
              <Input value={robotCode} onChange={(e) => setRobotCode(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
            </Field>
            <Field label="事件接收模式">
              <select value={connectionMode} onChange={(e) => setConnectionMode(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="stream">Stream 长连接</option>
                <option value="webhook">Webhook</option>
              </select>
            </Field>
          </>
        ) : null}

        {kind === 'wecom' ? (
          <>
            <Field label="连接模式">
              <select value={connectionMode} onChange={(e) => setConnectionMode(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="webhook">自建应用 Webhook</option>
                <option value="websocket">智能机器人 WebSocket</option>
              </select>
            </Field>
            {connectionMode === 'websocket' ? (
              <div className="channels-create__grid">
                <Field label="Bot ID">
                  <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                </Field>
                <Field label="Bot Secret">
                  <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)]" autoComplete="new-password" />
                </Field>
              </div>
            ) : (
              <div className="channels-create__grid">
                <Field label={`Corp ID（当前 ${deployment?.corpIdMasked ?? deployment?.credentialMasked ?? '••••'}）`}>
                  <Input value={corpId} onChange={(e) => setCorpId(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                </Field>
                <Field label="Corp Secret">
                  <Input type="password" value={corpSecret} onChange={(e) => setCorpSecret(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)]" autoComplete="new-password" />
                </Field>
                <Field label="Agent ID">
                  <Input value={agentId} onChange={(e) => setAgentId(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                </Field>
              </div>
            )}
          </>
        ) : null}

        {(kind === 'weixin') ? (
          <div className="channels-create__grid">
            <Field label={`Token（当前 ${deployment?.tokenMasked ?? deployment?.credentialMasked ?? '••••'}）`}>
              <Input type="password" value={weixinToken} onChange={(e) => setWeixinToken(e.target.value)} placeholder="留空保留原值" className="bg-[var(--bg)]" autoComplete="new-password" />
            </Field>
            <Field label="Account ID">
              <Input value={accountId} onChange={(e) => setAccountId(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
            </Field>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

function DeploymentCreateModal({
  open,
  onClose,
  canWrite,
  workspaceId,
  submitting = false,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  canWrite: boolean;
  workspaceId: string;
  submitting?: boolean;
  onSubmit: (v: Record<string, unknown>) => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ChannelKind>('feishu');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [domain, setDomain] = useState('https://open.feishu.cn');
  const [connectionMode, setConnectionMode] = useState('websocket');
  const [verificationToken, setVerificationToken] = useState('');
  const [encryptKey, setEncryptKey] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [robotCode, setRobotCode] = useState('');
  const [corpId, setCorpId] = useState('');
  const [corpSecret, setCorpSecret] = useState('');
  const [agentId, setAgentId] = useState('');
  const [callbackToken, setCallbackToken] = useState('');
  const [callbackAesKey, setCallbackAesKey] = useState('');
  const [weixinToken, setWeixinToken] = useState('');
  const [allowFrom, setAllowFrom] = useState('');
  const [accountId, setAccountId] = useState('');

  const enterprise = kind === 'feishu' || kind === 'dingtalk' || kind === 'wecom' || kind === 'weixin';
  const valid = canWrite && name.trim().length > 0 && (
    kind === 'feishu' ? appId.trim() && appSecret.trim()
      : kind === 'dingtalk' ? clientId.trim() && clientSecret.trim()
        : kind === 'wecom' ? (
          connectionMode === 'websocket'
            ? clientId.trim() && clientSecret.trim()
            : corpId.trim() && corpSecret.trim() && agentId.trim()
        )
          : kind === 'weixin' ? weixinToken.trim().length > 0
            : false
  );

  useEffect(() => {
    if (!open) {
      setName('');
      setKind('feishu');
      setAppId('');
      setAppSecret('');
      setDomain('https://open.feishu.cn');
      setConnectionMode('websocket');
      setVerificationToken('');
      setEncryptKey('');
      setClientId('');
      setClientSecret('');
      setRobotCode('');
      setCorpId('');
      setCorpSecret('');
      setAgentId('');
      setCallbackToken('');
      setCallbackAesKey('');
      setWeixinToken('');
      setAllowFrom('');
      setAccountId('');
    }
  }, [open]);

  useEffect(() => {
    if (kind === 'feishu') {
      setDomain('https://open.feishu.cn');
      setConnectionMode('websocket');
    } else if (kind === 'dingtalk') {
      setDomain('https://api.dingtalk.com');
      setConnectionMode('stream');
    } else if (kind === 'wecom') {
      setDomain('https://qyapi.weixin.qq.com');
      setConnectionMode('webhook');
    } else if (kind === 'weixin') {
      setDomain('https://ilinkai.weixin.qq.com');
      setConnectionMode('long_poll');
    }
  }, [kind]);

  const handleSubmit = () => {
    if (!valid || submitting) return;
    if (kind === 'feishu') {
      const mode = connectionMode === 'webhook' ? 'webhook' : 'websocket';
      onSubmit({
        name: name.trim(), kind, workspaceId,
        appId: appId.trim(), appSecret: appSecret.trim(),
        domain: domain.trim() || 'https://open.feishu.cn',
        connectionMode: mode,
        ...(mode === 'webhook' ? {
          verificationToken: verificationToken.trim() || undefined,
          encryptKey: encryptKey.trim() || undefined,
        } : {}),
      });
      return;
    }
    if (kind === 'dingtalk') {
      onSubmit({
        name: name.trim(), kind, workspaceId,
        clientId: clientId.trim(), clientSecret: clientSecret.trim(),
        robotCode: robotCode.trim() || undefined,
        domain: domain.trim() || 'https://api.dingtalk.com',
        connectionMode,
      });
      return;
    }
    if (kind === 'wecom') {
      if (connectionMode === 'websocket') {
        onSubmit({
          name: name.trim(), kind, workspaceId, connectionMode: 'websocket',
          botId: clientId.trim(), botSecret: clientSecret.trim(),
        });
        return;
      }
      onSubmit({
        name: name.trim(), kind, workspaceId, connectionMode: 'webhook',
        corpId: corpId.trim(), corpSecret: corpSecret.trim(), agentId: agentId.trim(),
        callbackToken: callbackToken.trim() || undefined,
        callbackAesKey: callbackAesKey.trim() || undefined,
        apiBaseUrl: domain.trim() || 'https://qyapi.weixin.qq.com',
      });
      return;
    }
    if (kind === 'weixin') {
      onSubmit({
        name: name.trim(), kind, workspaceId,
        token: weixinToken.trim(),
        baseUrl: domain.trim() || 'https://ilinkai.weixin.qq.com',
        allowFrom: allowFrom.trim() || undefined,
        accountId: accountId.trim() || undefined,
      });
    }
  };

  const description = kind === 'feishu'
    ? '对齐 cc-connect：飞书企业自建应用 App ID / Secret；默认 WebSocket 长连接（无需公网）。'
    : kind === 'dingtalk'
      ? '对齐 cc-connect：钉钉企业内部应用 Client ID / Secret；默认 Stream 长连接。'
      : kind === 'wecom'
        ? '对齐 cc-connect：企业微信自建应用（CorpId / Secret / AgentId）或智能机器人 WebSocket。'
        : kind === 'weixin'
          ? '对齐 cc-connect：个人微信 ilink Token（扫码 setup / bind 后填入）。'
          : '凭据只写入引用。';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="接入渠道部署"
      description={description}
      size={enterprise ? 'md' : 'sm'}
      bodyClassName="channels-create-body"
      panelClassName="channels-create-modal"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>取消</Button>
          <Button disabled={!valid || submitting} onClick={() => void handleSubmit()}>
            {submitting ? '接入中…' : '确认接入'}
          </Button>
        </>
      )}
    >
      <div className="channels-create">
        <Field label="部署名称">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`例如：${KIND_LABEL[kind]} 生产机器人`}
            className="bg-[var(--bg)]"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
        </Field>

        <div className="channels-create__section">
          <span className="channels-create__label">渠道类型</span>
          <div className="channels-create__kinds" role="radiogroup" aria-label="渠道类型">
            {DEPLOY_KIND_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = kind === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={cn('channels-create__kind', active && 'is-active')}
                  onClick={() => setKind(option.value)}
                >
                  <span className="channels-create__kind-icon"><Icon className="h-3.5 w-3.5" /></span>
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </button>
              );
            })}
          </div>
        </div>

        {kind === 'feishu' ? (
          <>
            <div className="channels-create__grid">
              <Field label="App ID">
                <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="cli_xxxxxxxxxxxx" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
              </Field>
              <Field label="App Secret">
                <Input type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="开放平台凭据" className="bg-[var(--bg)]" autoComplete="new-password" />
              </Field>
            </div>
            <Field label="API 域名">
              <select value={domain} onChange={(e) => setDomain(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="https://open.feishu.cn">飞书（open.feishu.cn）</option>
                <option value="https://open.larksuite.com">Lark 国际</option>
              </select>
            </Field>
            <Field label="事件接收模式">
              <select value={connectionMode} onChange={(e) => setConnectionMode(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="websocket">WebSocket 长连接（对齐 cc-connect，无需公网）</option>
                <option value="webhook">Webhook（平台托管 URL，需公网/隧道）</option>
              </select>
            </Field>
            {connectionMode === 'webhook' ? (
              <div className="channels-create__grid">
                <Field label="Verification Token（可选）">
                  <Input value={verificationToken} onChange={(e) => setVerificationToken(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                </Field>
                <Field label="Encrypt Key（可选）">
                  <Input type="password" value={encryptKey} onChange={(e) => setEncryptKey(e.target.value)} className="bg-[var(--bg)]" autoComplete="new-password" />
                </Field>
              </div>
            ) : (
              <div className="channels-create__hint" role="note">
                <KeyRound className="h-3.5 w-3.5 shrink-0" />
                <p>开放平台「事件与回调」请选 <strong>使用长连接接收事件</strong>，并订阅 <code>im.message.receive_v1</code>。入站由本机/侧车 WebSocket 进程承接（与 cc-connect 相同），控制面负责凭证与出站。</p>
              </div>
            )}
          </>
        ) : null}

        {kind === 'dingtalk' ? (
          <>
            <div className="channels-create__grid">
              <Field label="Client ID (AppKey)">
                <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="dingxxxxxxxxxxxx" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
              </Field>
              <Field label="Client Secret">
                <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} className="bg-[var(--bg)]" autoComplete="new-password" />
              </Field>
            </div>
            <Field label="Robot Code（可选，默认=Client ID）">
              <Input value={robotCode} onChange={(e) => setRobotCode(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
            </Field>
            <Field label="事件接收模式">
              <select value={connectionMode} onChange={(e) => setConnectionMode(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="stream">Stream 长连接（推荐，无需公网；侧车）</option>
                <option value="webhook">HTTP 回调（平台托管 URL）</option>
              </select>
            </Field>
          </>
        ) : null}

        {kind === 'wecom' ? (
          <>
            <Field label="接入模式">
              <select value={connectionMode} onChange={(e) => setConnectionMode(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
                <option value="webhook">自建应用 Webhook（CorpId + AgentId）</option>
                <option value="websocket">智能机器人 WebSocket（BotId）</option>
              </select>
            </Field>
            {connectionMode === 'websocket' ? (
              <div className="channels-create__grid">
                <Field label="Bot ID">
                  <Input value={clientId} onChange={(e) => setClientId(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                </Field>
                <Field label="Bot Secret">
                  <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} className="bg-[var(--bg)]" autoComplete="new-password" />
                </Field>
              </div>
            ) : (
              <>
                <div className="channels-create__grid">
                  <Field label="Corp ID">
                    <Input value={corpId} onChange={(e) => setCorpId(e.target.value)} placeholder="wwxxxxxxxxxxxx" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                  </Field>
                  <Field label="Agent ID">
                    <Input value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="1000002" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                  </Field>
                </div>
                <Field label="Corp Secret">
                  <Input type="password" value={corpSecret} onChange={(e) => setCorpSecret(e.target.value)} className="bg-[var(--bg)]" autoComplete="new-password" />
                </Field>
                <div className="channels-create__grid">
                  <Field label="Callback Token">
                    <Input value={callbackToken} onChange={(e) => setCallbackToken(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                  </Field>
                  <Field label="EncodingAESKey（43 位）">
                    <Input value={callbackAesKey} onChange={(e) => setCallbackAesKey(e.target.value)} className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
                  </Field>
                </div>
              </>
            )}
          </>
        ) : null}

        {kind === 'weixin' ? (
          <>
            <Field label="ilink Bot Token">
              <Input type="password" value={weixinToken} onChange={(e) => setWeixinToken(e.target.value)} placeholder="扫码 setup / bind 后的 Bearer Token" className="bg-[var(--bg)]" autoComplete="new-password" />
            </Field>
            <div className="channels-create__grid">
              <Field label="Allow From（可选）">
                <Input value={allowFrom} onChange={(e) => setAllowFrom(e.target.value)} placeholder="user@im.wechat 或 *" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
              </Field>
              <Field label="Account ID（可选）">
                <Input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="多账号隔离" className="bg-[var(--bg)] font-mono text-[12px]" autoComplete="off" />
              </Field>
            </div>
          </>
        ) : null}

        <div className="channels-create__hint" role="note">
          <KeyRound className="h-3.5 w-3.5 shrink-0" />
          <div>
            {kind === 'feishu' && connectionMode === 'webhook' && <p>确认后将保存凭据并自动验证（tenant_access_token + bot/v3/info）。Webhook 模式会生成回调路径，填到开放平台「请求地址」。</p>}
            {kind === 'feishu' && connectionMode !== 'webhook' && <p>确认后将保存凭据并自动验证。请在开放平台启用「长连接」；本地需运行 WebSocket 侧车（对齐 cc-connect）承接入站。</p>}
            {kind === 'dingtalk' && <p>确认后将保存凭据并自动验证（oauth2/accessToken）。Stream 入站由侧车；Webhook 模式会生成 HTTP 回调地址。</p>}
            {kind === 'wecom' && <p>确认后将保存凭据并自动验证（gettoken）。自建应用请先接入再在企微后台保存「接收消息」URL；出站需企业可信 IP。</p>}
            {kind === 'weixin' && <p>确认后将保存 Token 并短调用 getUpdates 验证。出站需 context_token；长轮询入站由侧车承接。</p>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="channels-create__field">
      <span className="channels-create__label">{label}</span>
      {children}
    </label>
  );
}
