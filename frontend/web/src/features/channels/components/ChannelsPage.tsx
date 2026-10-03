import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Cloud, History, Route, Send, ShieldCheck, FileText as FileTextIcon } from 'lucide-react';
import { toast } from '@qzda/web-ui';
import type {
  ChannelAuditEvent,
  ChannelDeployment,
  ChannelKind,
  DeliveryAttempt,
  DeliveryPolicyDraft,
  DeliveryPolicyVersion,
} from '@qzda/web-types';
import { ConfirmDialog, Drawer } from '@/components/shared';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useT } from '@/i18n';
import { cn } from '@qzda/web-utils';
import { Deployments } from './ChannelsTab.Deployments';
import { DeploymentCreateModal } from './ChannelsTab.DeploymentsCreateModal';
import { DeploymentEditDrawer } from './ChannelsTab.DeploymentsDrawer';
import { Templates } from './ChannelsTab.Templates';
import { Health } from './ChannelsTab.Health';
import { Failures } from './ChannelsTab.Failures';
import { Audit } from './ChannelsTab.Audit';
import { PolicyDrawer, Routing } from './ChannelsTab.Routing';
import { CHANNELS_TABS, ChannelsTab, DeploymentHealth, BlacklistItem, ChannelTemplate } from './ChannelsShared';

export default function ChannelsPage() {
  const { t } = useT();
  const { user } = useAuthStore();
  const canWrite = Boolean(user?.permissions.includes('channel.write'));
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId ?? 'w1');
  const scopeKey = `${currentWorkspaceId}:${user?.id ?? 'anonymous'}`;
  const [tab, setTab] = useState<ChannelsTab>('deployments');
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
  const versions = useApiQuery<DeliveryPolicyVersion[]>(
    ['delivery-versions', scopeKey, selectedPolicy],
    `/api/channel-control/policies/${selectedPolicy ?? '__none__'}/versions`,
    undefined,
    { enabled: Boolean(selectedPolicy) },
  );

  const create = useApiMutation<ChannelDeployment, Record<string, unknown>>('/api/channel-control/deployments');
  const update = useApiMutation<ChannelDeployment, Record<string, unknown> & { id: string }>(
    (v) => `/api/channel-control/deployments/${v.id}`,
    undefined,
    'PATCH',
  );
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

  const policyRefs = useMemo(
    () => new Set(
      (policies.data ?? [])
        .filter((p) => p.status === 'published')
        .flatMap((p) => [p.primaryDeploymentId, ...p.fallbackDeploymentIds]),
    ),
    [policies.data],
  );
  const deploymentMap = useMemo(() => {
    const map = new Map<string, ChannelDeployment>();
    (deployments.data ?? []).forEach((item) => map.set(item.id, item));
    return map;
  }, [deployments.data]);

  const kpis: Array<{ key: ChannelsTab; label: string; value: number; sub: string; icon: typeof Cloud; tone: string }> = [
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
            {CHANNELS_TABS.map(({ key, labelKey, icon: Icon }) => (
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
                if (!draft) {
                  toast.warn('暂无策略可模拟');
                  return;
                }
                simulate.mutate({ id: draft.id }, {
                  onSuccess: (v) => toast[v.status === 'passed' ? 'success' : 'warn'](`模拟结果：${v.status} · 容量 ${v.capacityRisk}`),
                  onError: notifyError,
                });
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
        {activePolicy ? (
          <PolicyDrawer
            policy={activePolicy}
            versions={versions.data ?? []}
            deployments={deploymentMap}
            canWrite={canWrite}
            onValidate={() => validate.mutate(
              { id: activePolicy.id },
              {
                onSuccess: (v) => toast[v.status === 'ready' ? 'success' : 'warn'](v.status === 'ready' ? '策略校验通过' : '策略校验未通过'),
                onError: notifyError,
              },
            )}
            onPublish={() => publish.mutate({ id: activePolicy.id }, { onSuccess: () => toast.success('投递策略已发布'), onError: notifyError })}
            onSimulate={() => simulate.mutate(
              { id: activePolicy.id },
              {
                onSuccess: (v) => toast[v.status === 'passed' ? 'success' : 'warn'](`模拟结果：${v.status} · 容量 ${v.capacityRisk}`),
                onError: notifyError,
              },
            )}
          />
        ) : null}
      </Drawer>
      <ConfirmDialog
        open={Boolean(deleteDeployment)}
        onClose={() => setDeleteDeployment(null)}
        onConfirm={() => {
          if (deleteDeployment) {
            remove.mutate(
              { id: deleteDeployment.id },
              { onSuccess: () => toast.success('渠道部署已删除'), onError: notifyError },
            );
          }
        }}
        title="删除渠道部署？"
        description="已发布策略引用的部署将被 API 拒绝删除。"
        confirmText="删除"
        tone="danger"
      />
    </div>
  );
}