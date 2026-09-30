import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, AlertTriangle, CheckCircle2, Cloud, Download, FileKey2, FlaskConical, History, Network, Pencil, Plus, RefreshCw, Route, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge, Button, Input, KpiCard, toast } from '@de/web-ui';
import type { ModelAuditEvent, ModelGovernanceSnapshot, ModelProvider, ProviderImpact, ProviderTier, RoutingPolicyDraft, RoutingPolicyVersion } from '@de/web-types';
import { useApiMutation, useApiQuery } from '@/services/query';
import { ConfirmDialog, EmptyState, Modal, RoleReadonlyBanner } from '@/components/shared';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  budgetRiskLabel,
  modelQueryState,
  normalizeModelProviders,
  normalizeProviderImpact,
  normalizeRoutingPolicies,
  parseModelTab,
  policyStatusLabel,
  providerLifecycleAction,
  providerReferencedByPublishedPolicies,
  providerStatusLabel,
  providerStatusTone,
  routingDataScopeLabel,
  routingLevelPurpose,
  routingPolicyNextAction,
  summarizeRoutingPolicies,
  budgetUtilizationPercent,
  governanceDrillEligibility,
  governanceBudgetBreakdown,
  visibleModelTabs,
  defaultModelTab,
  type ModelWorkspaceTab,
  type RoutingPolicyLevel,
} from '@/features/models/model-ui';
import { rolePageCopy, resolveAppRole } from '@/features/role-nav/role-nav';
import {
  PROVIDER_CONNECT_PRESETS,
  applyProviderConnectProtocol,
  canDiscoverModels,
  canTestConnectDraft,
  canTestSavedProvider,
  createProviderConnectDraft,
  draftFromProvider,
  getProviderConnectPreset,
  pickModelAfterDiscover,
  protocolBaseUrlHint,
  protocolLabel,
  providerConnectToPayload,
  resolveProviderCredential,
  validateProviderConnectDraft,
  type ProviderConnectDraft,
} from '@/features/models/provider-connect';
import { useT } from '@/i18n';
import { cn } from '@de/web-utils';

const WORKSPACES: Array<{ key: ModelWorkspaceTab; labelKey: string; icon: typeof Cloud; description: string }> = [
  { key: 'access', labelKey: 'module.models.tabs.access', icon: Cloud, description: '接入供应商、验证连通性，并管理凭据引用与退役影响。' },
  { key: 'routing', labelKey: 'module.models.tabs.routing', icon: Route, description: '按业务等级维护主/降级模型与数据边界；校验通过后发布不可变路由快照，供数字伙伴与工作流引用。' },
  { key: 'governance', labelKey: 'module.models.tabs.governance', icon: Activity, description: '观察运行健康、预算占用与地域分布；在 sandbox 隔离范围验证已发布路由的降级链。' },
  { key: 'audit', labelKey: 'module.models.tabs.audit', icon: History, description: '追溯接入、校验、发布、回滚、退役与演练结果。' },
];

const TIER_LABEL: Record<ProviderTier, string> = { official: '官方 API', self_hosted: '自部署', connectable: '可接入' };

export default function Models() {
  const { t } = useT();
  const { user } = useAuthStore();
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId ?? 'w1');
  const canWrite = Boolean(user?.permissions.includes('model.write'));
  const isAuditor = resolveAppRole(user?.role) === 'auditor';
  const pageCopy = rolePageCopy('models', user?.role);
  const visibleTabs = useMemo(() => visibleModelTabs(user?.role), [user?.role]);
  const scopeKey = `${currentWorkspaceId}:${user?.id ?? 'anonymous'}`;
  const [searchParams, setSearchParams] = useSearchParams();
  const workspace = parseModelTab(searchParams.get('tab'), user?.role);

  const [providerModal, setProviderModal] = useState<'new' | string | null>(null);
  const [policyDrawer, setPolicyDrawer] = useState<string | null>(null);
  const [createPolicyOpen, setCreatePolicyOpen] = useState(false);
  const [createPolicyPayload, setCreatePolicyPayload] = useState<Record<string, unknown> | null>(null);
  const [savePolicyDraft, setSavePolicyDraft] = useState<Record<string, unknown> | null>(null);
  const [validatePolicyTarget, setValidatePolicyTarget] = useState<RoutingPolicyDraft | null>(null);
  const [policyDetailTab, setPolicyDetailTab] = useState<'draft' | 'validate' | 'versions' | null>(null);
  const [publishPolicy, setPublishPolicy] = useState<RoutingPolicyDraft | null>(null);
  const [unpublishPolicy, setUnpublishPolicy] = useState<RoutingPolicyDraft | null>(null);
  const [deleteProvider, setDeleteProvider] = useState<ModelProvider | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<{ policyId: string; versionId: string; label: string } | null>(null);
  const [auditResultFilter, setAuditResultFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [drillPolicyId, setDrillPolicyId] = useState('');
  const [drillModalOpen, setDrillModalOpen] = useState(false);
  const [confirmDrillPolicyId, setConfirmDrillPolicyId] = useState<string | null>(null);
  const [lastDrillResult, setLastDrillResult] = useState<{
    policyId: string;
    fromModelId: string;
    toModelId: string;
    correlationId: string;
    status: string;
  } | null>(null);

  const modelQueryOpts = { staleTime: 0, refetchOnMount: 'always' as const };
  const providersQuery = useApiQuery<ModelProvider[]>(['model-providers', scopeKey], '/api/model-providers', undefined, { ...modelQueryOpts, enabled: !isAuditor });
  const policiesQuery = useApiQuery<RoutingPolicyDraft[]>(['model-routing-policies', scopeKey], '/api/model-routing/policies', undefined, { ...modelQueryOpts, enabled: !isAuditor });
  const governanceQuery = useApiQuery<ModelGovernanceSnapshot>(['model-governance', scopeKey], '/api/model-governance/overview', undefined, { ...modelQueryOpts, enabled: !isAuditor });
  const auditQuery = useApiQuery<ModelAuditEvent[]>(['model-audit', scopeKey], '/api/model-audit', undefined, modelQueryOpts);
  const providers = useMemo(() => normalizeModelProviders(providersQuery.data), [providersQuery.data]);
  const policies = useMemo(() => normalizeRoutingPolicies(policiesQuery.data), [policiesQuery.data]);
  const activeProvider = providerModal && providerModal !== 'new' ? providers.find((item) => item.id === providerModal) : undefined;
  const impactQuery = useApiQuery<ProviderImpact>(['model-provider-impact', scopeKey, activeProvider?.id], `/api/model-providers/${activeProvider?.id ?? '__none__'}/impact`, undefined, { enabled: Boolean(activeProvider) });
  const activeImpact = useMemo(() => normalizeProviderImpact(impactQuery.data), [impactQuery.data]);
  const versionsQuery = useApiQuery<RoutingPolicyVersion[]>(['model-policy-versions', scopeKey, policyDrawer], `/api/model-routing/policies/${policyDrawer ?? '__none__'}/versions`, undefined, { enabled: Boolean(policyDrawer) });

  const createProvider = useApiMutation<ModelProvider, Record<string, unknown>>('/api/model-providers');
  const updateProvider = useApiMutation<ModelProvider, Record<string, unknown>>((value: any) => `/api/model-providers/${value.id}`, undefined, 'PATCH');
  const testProvider = useApiMutation<{ status: string; providerStatus?: string }, { id: string; reason: string }>((value) => `/api/model-providers/${value.id}/test`);
  const disableProvider = useApiMutation<ModelProvider, { id: string; reason: string }>((value) => `/api/model-providers/${value.id}/disable`);
  const removeProvider = useApiMutation<{ id: string }, { id: string; reason: string }>((value) => `/api/model-providers/${value.id}`, undefined, 'DELETE');
  const createPolicy = useApiMutation<RoutingPolicyDraft, Record<string, unknown>>('/api/model-routing/policies');
  const updatePolicy = useApiMutation<RoutingPolicyDraft, Record<string, unknown>>((value: any) => `/api/model-routing/policies/${value.id}/draft`, undefined, 'PATCH');
  const validatePolicy = useApiMutation<RoutingPolicyDraft, { id: string }>((value) => `/api/model-routing/policies/${value.id}/validate`);
  const publish = useApiMutation<RoutingPolicyVersion, { id: string; reason: string }>((value) => `/api/model-routing/policies/${value.id}/publish`);
  const unpublish = useApiMutation<RoutingPolicyDraft, { id: string; reason: string }>((value) => `/api/model-routing/policies/${value.id}/unpublish`);
  const rollback = useApiMutation<RoutingPolicyVersion, { id: string; versionId: string; reason: string }>((value) => `/api/model-routing/policies/${value.id}/rollback`);
  const runDrill = useApiMutation<{ status: string }, { policyId: string; scope: 'sandbox'; reason: string }>('/api/model-routing/failover-tests');

  const models = useMemo(() => providers.flatMap((provider) => provider.models), [providers]);
  const selectedPolicy = policies.find((item) => item.id === policyDrawer);
  const publishedPolicies = policies.filter((policy) => policy.status === 'published' && policy.fallbackModelIds.length > 0);
  const drillEligibility = useMemo(() => governanceDrillEligibility(policies), [policies]);
  const confirmDrillPolicy = publishedPolicies.find((policy) => policy.id === confirmDrillPolicyId)
    ?? policies.find((policy) => policy.id === confirmDrillPolicyId);
  const auditActions = useMemo(() => Array.from(new Set((auditQuery.data ?? []).map((event) => event.action))), [auditQuery.data]);
  const auditEvents = auditQuery.data ?? [];
  const filteredAudit = auditEvents.filter((event) => (
    (auditResultFilter === 'all' || event.result === auditResultFilter)
    && (auditActionFilter === 'all' || event.action === auditActionFilter)
  ));
  const controlPlaneError = isAuditor
    ? auditQuery.error
    : providersQuery.error ?? policiesQuery.error ?? governanceQuery.error ?? auditQuery.error;
  const queryState = modelQueryState({
    isLoading: isAuditor ? auditQuery.isLoading : providersQuery.isLoading || policiesQuery.isLoading,
    isError: isAuditor
      ? auditQuery.isError
      : providersQuery.isError || policiesQuery.isError || governanceQuery.isError || auditQuery.isError,
    data: isAuditor ? auditEvents : [...providers, ...policies],
    errorDetail: controlPlaneError instanceof Error ? controlPlaneError.message : undefined,
  });
  const reportError = (error: unknown) => toast.error(error instanceof Error ? error.message.replace(/^E_[A-Z_]+:\s*/, '') : '模型控制面操作失败');
  const refetchControlPlane = () => {
    if (isAuditor) {
      void auditQuery.refetch();
      return;
    }
    void providersQuery.refetch();
    void policiesQuery.refetch();
    void governanceQuery.refetch();
    void auditQuery.refetch();
  };
  const setWorkspace = (tab: ModelWorkspaceTab) => {
    if (!visibleTabs.includes(tab)) return;
    if (tab === workspace) {
      // 再次点击当前 tab：强制刷新
      refetchControlPlane();
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };
  const openPolicyFromGovernance = (policyId: string) => {
    setWorkspace('routing');
    setPolicyDrawer(policyId);
    setPolicyDetailTab('draft');
  };

  useEffect(() => {
    const raw = searchParams.get('tab');
    const resolved = parseModelTab(raw, user?.role);
    if (!raw || raw !== resolved) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', resolved);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, user?.role]);

  useEffect(() => {
    refetchControlPlane();
    // 仅在工作区 tab / 作用域变化时刷新；refetch 句柄随 query 稳定即可
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: tab/scope driven refresh
  }, [workspace, scopeKey]);

  useEffect(() => {
    if (!drillPolicyId && publishedPolicies[0]) setDrillPolicyId(publishedPolicies[0].id);
  }, [drillPolicyId, publishedPolicies]);

  const activeWorkspace = WORKSPACES.find((item) => item.key === workspace) ?? WORKSPACES.find((item) => item.key === defaultModelTab(user?.role)) ?? WORKSPACES[0];
  const visibleWorkspaces = WORKSPACES.filter((item) => visibleTabs.includes(item.key));
  const budgetTone = governanceQuery.data?.budgetRisk === 'normal' ? 'success' : 'warn';
  const routingSummary = summarizeRoutingPolicies(policies);
  const auditSuccessCount = auditEvents.filter((event) => event.result === 'success').length;
  const auditFailedCount = auditEvents.filter((event) => event.result === 'failed').length;

  return (
    <div className="models-page h-full min-w-0 overflow-y-auto bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5">
      <div className="space-y-3" aria-label="模型中心">
        {isAuditor && <RoleReadonlyBanner />}
        <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
          <div className="flex items-start justify-between gap-4 px-4 py-3.5 md:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg text-[var(--text-secondary)]">
                  {isAuditor ? <History className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
                </div>
                <h1 className="text-base font-semibold text-[var(--text)]">{pageCopy.title}</h1>
              </div>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{pageCopy.subtitle}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {!isAuditor && (
                <span className="de-employee-hint hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--warning)] sm:inline-flex">
                  <AlertTriangle className="h-3 w-3" />控制面治理 · KMS 由服务端执行
                </span>
              )}
              {workspace === 'access' && (
                <button type="button" className="de-employee-btn de-employee-btn--primary" disabled={!canWrite} onClick={() => setProviderModal('new')}>
                  <Plus className="h-3.5 w-3.5" />接入供应商
                </button>
              )}
              {workspace === 'routing' && (
                <button type="button" className="de-employee-btn de-employee-btn--primary" disabled={!canWrite} onClick={() => setCreatePolicyOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />新建策略
                </button>
              )}
              {workspace === 'governance' && (
                <button
                  type="button"
                  className="de-employee-btn de-employee-btn--primary"
                  disabled={!canWrite || !drillEligibility.ready}
                  title={!drillEligibility.ready ? drillEligibility.guidance : '打开 sandbox 故障切换演练'}
                  onClick={() => setDrillModalOpen(true)}
                >
                  <FlaskConical className="h-3.5 w-3.5" />sandbox 演练
                </button>
              )}
            </div>
          </div>
          {visibleWorkspaces.length > 1 && (
            <div className="de-employee-tabs flex overflow-x-auto px-3" role="tablist" aria-label="模型控制面工作区">
              {visibleWorkspaces.map(({ key, labelKey, icon: Icon }) => (
                <button
                  key={key}
                  id={`model-workspace-tab-${key}`}
                  type="button"
                  role="tab"
                  aria-controls={`model-workspace-${key}`}
                  aria-selected={workspace === key}
                  onClick={() => setWorkspace(key)}
                  className={cn('de-employee-tab flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs transition-colors', workspace === key && 'is-active')}
                >
                  <Icon className="h-3.5 w-3.5" />{t(labelKey)}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className={cn('grid grid-cols-2 gap-3', workspace === 'governance' || workspace === 'routing' || workspace === 'audit' ? 'lg:grid-cols-4' : 'lg:grid-cols-3')} aria-label="控制面摘要">
          {workspace === 'routing' ? (
            <>
              <KpiCard label="已发布路由" value={routingSummary.published} sub="条" icon={Route} tone="success" size="comfortable" />
              <KpiCard label="草稿待校验" value={routingSummary.draft} sub="条" icon={FileKey2} tone="warn" size="comfortable" />
              <KpiCard label="待发布" value={routingSummary.ready} sub="条" icon={CheckCircle2} tone="brand" size="comfortable" />
              <KpiCard label="含降级链" value={routingSummary.withFallback} sub="条已发布" icon={Network} tone="info" size="comfortable" />
            </>
          ) : workspace === 'governance' ? (
            <>
              <KpiCard label="健康占比" value={governanceQuery.data?.healthyShare ?? 0} sub="%" icon={Activity} tone="info" size="comfortable" />
              <KpiCard label="预算状态" value={budgetRiskLabel(governanceQuery.data?.budgetRisk ?? 'normal')} icon={ShieldCheck} tone={budgetTone} size="comfortable" />
              <KpiCard label="本月消耗" value={governanceQuery.data?.monthlySpendUsd ?? 0} sub="USD" icon={Network} tone="warn" size="comfortable" />
              <KpiCard label="可演练路由" value={drillEligibility.count} sub={`/ ${drillEligibility.total} 已发布`} icon={FlaskConical} tone={drillEligibility.ready ? 'success' : 'warn'} size="comfortable" />
            </>
          ) : workspace === 'audit' ? (
            <>
              <KpiCard label="审计事件" value={auditEvents.length} sub="条" icon={History} tone="info" size="comfortable" />
              <KpiCard label="成功" value={auditSuccessCount} sub="条" icon={CheckCircle2} tone="success" size="comfortable" />
              <KpiCard label="失败" value={auditFailedCount} sub="条" icon={AlertTriangle} tone={auditFailedCount ? 'warn' : 'neutral'} size="comfortable" />
              <KpiCard label="动作类型" value={auditActions.length} sub="种" icon={FileKey2} tone="brand" size="comfortable" />
            </>
          ) : (
            <>
              <KpiCard label="可用供应商" value={providers.filter((item) => item.status === 'active').length} sub="个" icon={Cloud} tone="brand" size="comfortable" />
              <KpiCard label="已发布路由" value={routingSummary.published} sub="条" icon={Route} tone="success" size="comfortable" />
              <KpiCard label="预算状态" value={budgetRiskLabel(governanceQuery.data?.budgetRisk ?? 'normal')} icon={ShieldCheck} tone={budgetTone} size="comfortable" />
            </>
          )}
        </section>

        <section
          id={`model-workspace-${workspace}`}
          role="tabpanel"
          aria-labelledby={`model-workspace-tab-${workspace}`}
          className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]"
        >
          {queryState.kind === 'loading' ? (
            <div className="p-8 text-center text-xs text-[var(--text-muted)]">{queryState.label}…</div>
          ) : queryState.kind === 'error' ? (
            <div className="p-8 text-center">
              <AlertTriangle className="mx-auto h-6 w-6 text-[var(--danger)]" />
              <p className="mt-3 text-sm font-medium">{queryState.label}</p>
              {queryState.detail ? (
                <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[var(--text-muted)]">{queryState.detail}</p>
              ) : null}
              <Button className="mt-4" size="sm" variant="secondary" onClick={refetchControlPlane}>重新读取</Button>
            </div>
          ) : queryState.kind === 'empty' ? (
            <div className="p-8">
              <EmptyState
                icon={isAuditor ? History : Cloud}
                title={isAuditor ? '暂无模型控制面审计事件' : queryState.label}
                description={isAuditor ? '接入、发布、回滚与演练操作发生后，证据会出现在此。' : '请先接入供应商或创建路由草稿。'}
              />
            </div>
          ) : workspace === 'access' ? (
            <AccessWorkspace
              providers={providers}
              policies={policies}
              description="接入后验证连通性；被已发布路由引用的供应商需先取消发布或替换模型后再删除。"
              canWrite={canWrite}
              onSelect={setProviderModal}
              onDelete={(provider) => setDeleteProvider(provider)}
            />
          ) : workspace === 'routing' ? (
            <RoutingWorkspace
              policies={policies}
              models={models}
              description={activeWorkspace.description}
              onOpen={setPolicyDrawer}
            />
          ) : workspace === 'governance' ? (
            <GovernanceWorkspace
              canWrite={canWrite}
              snapshot={governanceQuery.data}
              models={models}
              policies={policies}
              description={activeWorkspace.description}
              lastDrillResult={lastDrillResult}
              onOpenDrill={(policyId) => {
                if (policyId) setDrillPolicyId(policyId);
                setDrillModalOpen(true);
              }}
              onGoRouting={() => setWorkspace('routing')}
              onConfigurePolicy={openPolicyFromGovernance}
            />
          ) : (
            <AuditWorkspace
              events={filteredAudit}
              description={activeWorkspace.description}
              resultFilter={auditResultFilter}
              actionFilter={auditActionFilter}
              actions={auditActions}
              onResultFilter={setAuditResultFilter}
              onActionFilter={setAuditActionFilter}
            />
          )}
        </section>
      </div>

      <Modal
        open={providerModal === 'new'}
        onClose={() => setProviderModal(null)}
        title="接入供应商"
        description="按主流大模型协议填写连接信息；凭据仅提交时写入服务端引用，成功后不回显。"
        size="lg"
      >
        <ProviderForm
          canWrite={canWrite}
          workspaceId={currentWorkspaceId}
          creating={createProvider.isPending}
          onCancel={() => setProviderModal(null)}
          onSubmit={(payload) => createProvider.mutate(payload, {
            onSuccess: (provider) => {
              toast.success('供应商已接入，正在验证连通性…');
              setProviderModal(null);
              testProvider.mutate(
                { id: provider.id, reason: '接入后自动连通性验证' },
                {
                  onSuccess: (result) => toast.success(result.providerStatus === 'active' ? '连通性验证通过，供应商已可用' : '连通性验证通过'),
                  onError: reportError,
                },
              );
            },
            onError: reportError,
          })}
        />
      </Modal>
      <Modal
        open={Boolean(activeProvider)}
        onClose={() => setProviderModal(null)}
        title={activeProvider?.name ?? '模型配置'}
        description="查看与编辑分开：查看态只读并验证已保存配置；编辑态修改后保存才会生效。"
        size="lg"
      >
        {activeProvider && (
          <ProviderDetail
            key={activeProvider.id}
            provider={activeProvider}
            impact={activeImpact}
            canWrite={canWrite}
            workspaceId={currentWorkspaceId}
            onClose={() => setProviderModal(null)}
            onSave={(payload) => updateProvider.mutate({ id: activeProvider.id, ...payload }, { onSuccess: () => toast.success('供应商资料已更新'), onError: reportError })}
            onTest={() => testProvider.mutate({ id: activeProvider.id, reason: '人工连通性验证' }, {
              onSuccess: (result) => toast.success(result.providerStatus === 'active' ? '验证通过，供应商已可用' : '供应商连通性验证通过'),
              onError: reportError,
            })}
            onDisable={() => disableProvider.mutate({ id: activeProvider.id, reason: '停止新流量' }, { onSuccess: () => toast.success('供应商已停止新流量'), onError: reportError })}
            onDelete={() => setDeleteProvider(activeProvider)}
            onOpenPolicy={(policyId) => {
              setProviderModal(null);
              setWorkspace('routing');
              setPolicyDrawer(policyId);
              setPolicyDetailTab('validate');
            }}
          />
        )}
      </Modal>
      <Modal
        open={createPolicyOpen}
        onClose={() => { setCreatePolicyOpen(false); setCreatePolicyPayload(null); }}
        title="新建路由草稿"
        description="仅定义调度策略：主/降级模型、数据边界与预算上限。不写入凭据，不执行真实限流。"
        size="md"
        closeOnEscape={!createPolicyPayload}
        closeOnBackdrop={!createPolicyPayload}
      >
        <CreatePolicyForm
          canWrite={canWrite}
          workspaceId={currentWorkspaceId}
          models={models}
          onSubmit={(payload) => setCreatePolicyPayload(payload)}
        />
      </Modal>
      <Modal
        open={Boolean(selectedPolicy)}
        onClose={() => {
          setPolicyDrawer(null);
          setPolicyDetailTab(null);
          setSavePolicyDraft(null);
          setValidatePolicyTarget(null);
        }}
        title={selectedPolicy ? `${selectedPolicy.level} 路由策略` : '路由策略'}
        description={selectedPolicy ? routingLevelPurpose(selectedPolicy.level) : '草稿校验通过后才能发布；版本快照不可改写。'}
        size="lg"
        closeOnEscape={!savePolicyDraft && !validatePolicyTarget && !publishPolicy && !unpublishPolicy && !rollbackTarget}
        closeOnBackdrop={!savePolicyDraft && !validatePolicyTarget && !publishPolicy && !unpublishPolicy && !rollbackTarget}
      >
        {selectedPolicy && (
          <PolicyDetail
            key={selectedPolicy.id}
            policy={selectedPolicy}
            models={models}
            versions={versionsQuery.data ?? []}
            canWrite={canWrite}
            focusTab={policyDetailTab}
            onFocusTabConsumed={() => setPolicyDetailTab(null)}
            onSave={(draft) => setSavePolicyDraft(draft)}
            onValidate={() => setValidatePolicyTarget(selectedPolicy)}
            onPublish={() => setPublishPolicy(selectedPolicy)}
            onUnpublish={() => setUnpublishPolicy(selectedPolicy)}
            onRollback={(versionId, label) => setRollbackTarget({ policyId: selectedPolicy.id, versionId, label })}
          />
        )}
      </Modal>
      <Modal
        open={drillModalOpen}
        onClose={() => { setDrillModalOpen(false); setConfirmDrillPolicyId(null); }}
        title="sandbox 故障切换演练"
        description="仅在隔离范围验证已发布路由的降级链与审计写入；不改写生产流量，不构成合规证明。"
        size="lg"
        closeOnEscape={!confirmDrillPolicyId}
        closeOnBackdrop={!confirmDrillPolicyId}
      >
        <FailoverDrillForm
          canWrite={canWrite}
          models={models}
          publishedPolicies={publishedPolicies}
          drillPolicyId={drillPolicyId}
          onDrillPolicyChange={setDrillPolicyId}
          pending={runDrill.isPending}
          lastResult={lastDrillResult}
          onCancel={() => { setDrillModalOpen(false); setConfirmDrillPolicyId(null); }}
          onRun={(policyId) => setConfirmDrillPolicyId(policyId)}
        />
      </Modal>
      <ConfirmDialog
        open={Boolean(createPolicyPayload)}
        onClose={() => setCreatePolicyPayload(null)}
        onConfirm={() => {
          if (!createPolicyPayload) return;
          createPolicy.mutate(createPolicyPayload, {
            onSuccess: (policy) => {
              toast.success('路由草稿已创建，请继续校验后发布');
              setCreatePolicyPayload(null);
              setCreatePolicyOpen(false);
              setPolicyDrawer(policy.id);
              setPolicyDetailTab('validate');
            },
            onError: reportError,
          });
        }}
        title="确认创建路由草稿？"
        description={`${String(createPolicyPayload?.level ?? '')} 策略将以草稿保存；创建后需完成校验才能发布不可变版本。`}
        confirmText="确认创建"
      />
      <ConfirmDialog
        open={Boolean(savePolicyDraft)}
        onClose={() => setSavePolicyDraft(null)}
        onConfirm={() => {
          if (!savePolicyDraft) return;
          updatePolicy.mutate(savePolicyDraft, {
            onSuccess: () => {
              toast.success('草稿已保存，已发布快照未改动；请重新校验后再发布');
              setSavePolicyDraft(null);
              setPolicyDetailTab('validate');
            },
            onError: reportError,
          });
        }}
        title="确认保存路由草稿？"
        description={selectedPolicy?.status === 'published'
          ? '保存会回到草稿态并清空校验结果，不会改写已发布快照；需重新校验后才能再次发布。'
          : '保存后需重新校验；校验通过才可发布版本。'}
        confirmText="确认保存"
      />
      <ConfirmDialog
        open={Boolean(validatePolicyTarget)}
        onClose={() => setValidatePolicyTarget(null)}
        onConfirm={() => {
          if (!validatePolicyTarget) return;
          validatePolicy.mutate({ id: validatePolicyTarget.id }, {
            onSuccess: (policy) => {
              toast[policy.status === 'ready' ? 'success' : 'warn'](
                policy.status === 'ready' ? '校验通过，可以发布版本' : '校验未通过，请按问题修正草稿',
              );
              setValidatePolicyTarget(null);
              if (policy.status === 'ready') setPolicyDetailTab('validate');
            },
            onError: reportError,
          });
        }}
        title="确认执行路由校验？"
        description="将检查主/降级模型可用性、供应商状态、出境约束与降级链完整性。"
        confirmText="确认校验"
      />
      <ConfirmDialog
        open={Boolean(publishPolicy)}
        onClose={() => setPublishPolicy(null)}
        onConfirm={() => {
          if (!publishPolicy) return;
          publish.mutate({ id: publishPolicy.id, reason: '人工确认发布' }, {
            onSuccess: () => {
              toast.success('路由版本已发布');
              setPublishPolicy(null);
              setPolicyDetailTab('versions');
            },
            onError: reportError,
          });
        }}
        title="发布路由版本？"
        description={publishPolicy ? `将为 ${publishPolicy.level} 生成不可变版本快照并写入审计。` : ''}
        confirmText="确认发布"
      />
      <ConfirmDialog
        open={Boolean(unpublishPolicy)}
        onClose={() => setUnpublishPolicy(null)}
        onConfirm={() => {
          if (!unpublishPolicy) return;
          unpublish.mutate({ id: unpublishPolicy.id, reason: '人工取消发布' }, {
            onSuccess: () => {
              toast.success(`${unpublishPolicy.level} 路由已取消发布，可替换模型或删除相关供应商`);
              setUnpublishPolicy(null);
              setPolicyDetailTab('validate');
              void impactQuery.refetch();
            },
            onError: reportError,
          });
        }}
        title="取消发布路由？"
        description={unpublishPolicy
          ? `将把 ${unpublishPolicy.level} 从已发布回退为草稿；历史版本快照保留。取消后引用该策略的供应商可再删除。`
          : ''}
        confirmText="确认取消发布"
        tone="danger"
      />
      <ConfirmDialog
        open={Boolean(rollbackTarget)}
        onClose={() => setRollbackTarget(null)}
        onConfirm={() => {
          if (!rollbackTarget) return;
          rollback.mutate({ id: rollbackTarget.policyId, versionId: rollbackTarget.versionId, reason: '人工确认回滚' }, {
            onSuccess: () => {
              toast.success('已创建回滚版本');
              setRollbackTarget(null);
              setPolicyDetailTab('versions');
            },
            onError: reportError,
          });
        }}
        title="回滚到历史版本？"
        description={rollbackTarget ? `将基于 ${rollbackTarget.label} 创建新的已发布版本，历史快照不会被改写。` : ''}
        confirmText="确认回滚"
        tone="danger"
      />
      <ConfirmDialog
        open={Boolean(confirmDrillPolicyId)}
        onClose={() => setConfirmDrillPolicyId(null)}
        onConfirm={() => {
          if (!confirmDrillPolicyId) return;
          const policyId = confirmDrillPolicyId;
          runDrill.mutate({ policyId, scope: 'sandbox', reason: '控制面隔离演练' }, {
            onSuccess: (result: any) => {
              setLastDrillResult({
                policyId: result.policyId ?? policyId,
                fromModelId: result.fromModelId,
                toModelId: result.toModelId,
                correlationId: result.correlationId,
                status: result.status ?? 'passed',
              });
              setConfirmDrillPolicyId(null);
              toast.success('sandbox 故障切换演练通过');
              void auditQuery.refetch();
              void governanceQuery.refetch();
            },
            onError: reportError,
          });
        }}
        title="确认执行 sandbox 演练？"
        description={confirmDrillPolicy
          ? `将对 ${confirmDrillPolicy.level} 已发布路由验证主模型 → 一级降级切流，并写入模型审计；不切换生产流量。`
          : '仅在隔离范围验证降级链。'}
        confirmText="确认演练"
      />
      <ConfirmDialog
        open={Boolean(deleteProvider)}
        onClose={() => setDeleteProvider(null)}
        onConfirm={() => {
          if (!deleteProvider) return;
          removeProvider.mutate(
            { id: deleteProvider.id, reason: '人工确认删除' },
            {
              onSuccess: () => {
                toast.success('供应商已删除');
                setDeleteProvider(null);
                setProviderModal(null);
              },
              onError: reportError,
            },
          );
        }}
        title={`删除供应商「${deleteProvider?.name ?? ''}」？`}
        description="删除后凭据引用一并清理。若仍被已发布路由引用，请先到「模型路由」取消发布或替换模型。"
        confirmText="删除"
        tone="danger"
      />
    </div>
  );
}

function AccessWorkspace({
  providers, policies, description, canWrite, onSelect, onDelete,
}: {
  providers: ModelProvider[];
  policies: RoutingPolicyDraft[];
  description: string;
  canWrite: boolean;
  onSelect: (id: string) => void;
  onDelete: (provider: ModelProvider) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">供应商与凭据引用</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p>
        </div>
        <span className="text-xs text-[var(--text-muted)]">{providers.length} 个供应商</span>
      </div>
      {providers.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={Cloud} title="暂无供应商" description="接入后可验证连通性并供路由策略引用。" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:p-4">
          {providers.map((provider) => {
            const referenced = providerReferencedByPublishedPolicies(provider, policies);
            return (
              <div key={provider.id} className="de-employee-card rounded-xl bg-[var(--surface-1)] p-3.5 text-left">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => onSelect(provider.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm font-semibold text-[var(--text)]">{provider.name}</div>
                    <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                      {protocolLabel(provider.protocol)} · {TIER_LABEL[provider.tier]} · {provider.cloudRegion}
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge tone={providerStatusTone(provider.status)}>{providerStatusLabel(provider.status)}</Badge>
                    {canWrite && (
                      <button
                        type="button"
                        title={referenced ? '已被已发布路由引用，请先取消发布' : '删除供应商'}
                        aria-label={`删除 ${provider.name}`}
                        disabled={referenced}
                        className="grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
                        onClick={() => onDelete(provider)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => onSelect(provider.id)} className="mt-2 w-full text-left">
                  <div className="truncate font-mono text-[10px] text-[var(--text-muted)]">{provider.baseUrl ?? '未配置 Endpoint'}</div>
                  <div className="mt-1.5 text-[11px] leading-5 text-[var(--text-secondary)]">{provider.models.map((model) => model.name).join(' · ') || '未配置模型'}</div>
                  <div className="mt-2 flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                    <FileKey2 className="h-3 w-3" />{provider.credentialMasked} · {provider.lastVerifiedAt ? '已验证' : '待验证'}
                    {referenced ? ' · 路由引用中' : ''}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RoutingWorkspace({ policies, models, description, onOpen }: { policies: RoutingPolicyDraft[]; models: ModelProvider['models']; description: string; onOpen: (id: string) => void }) {
  const byId = new Map(models.map((model) => [model.id, model.name]));
  const [statusFilter, setStatusFilter] = useState<'all' | RoutingPolicyDraft['status']>('all');
  const filtered = statusFilter === 'all' ? policies : policies.filter((policy) => policy.status === statusFilter);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">版本化路由策略</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--text-muted)]">{description}</p>
        </div>
        <span className="text-xs text-[var(--text-muted)]">{policies.length} 条策略</span>
      </div>

      <div className="mx-4 mt-3 grid gap-2 rounded-xl bg-[var(--bg)] p-3 text-[11px] leading-5 text-[var(--text-secondary)] sm:grid-cols-3" style={{ boxShadow: 'var(--saas-ring)' }} aria-label="路由定位与边界">
        <div>
          <div className="font-semibold text-[var(--text)]">定位</div>
          <p className="mt-1">企业模型调度中枢：按等级把数字伙伴 / 工作流请求导向已准入模型，并锁定数据与预算边界。</p>
        </div>
        <div>
          <div className="font-semibold text-[var(--text)]">职责</div>
          <p className="mt-1">主模型与降级链 · 出境约束 · 预算上限 · 草稿校验 / 发布 / 回滚。不负责接入凭据、会话选模或 sandbox 演练。</p>
        </div>
        <div>
          <div className="font-semibold text-[var(--text)]">生命周期</div>
          <p className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">草稿 → 校验 → 待发布 → 发布快照 → 回滚生成新版本</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 px-4" role="tablist" aria-label="策略状态筛选">
        {([
          ['all', '全部'],
          ['draft', '草稿'],
          ['ready', '待发布'],
          ['published', '已发布'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={statusFilter === key}
            onClick={() => setStatusFilter(key)}
            className={cn('de-employee-chip shrink-0 rounded-md px-2.5 py-1 text-[11px]', statusFilter === key && 'is-active')}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={Route}
            title={policies.length === 0 ? '暂无路由策略' : '当前筛选下无策略'}
            description={policies.length === 0 ? '创建草稿并完成校验后可发布不可变版本，供数字伙伴能力装配引用。' : '切换状态筛选，或新建其他等级的路由草稿。'}
          />
        </div>
      ) : (
        <div className="overflow-x-auto p-3 md:p-4">
          <table className="min-w-[880px] w-full text-xs">
            <thead className="bg-[var(--bg-elevated)] text-left text-[11px] text-[var(--text-muted)]">
              <tr>
                <th className="rounded-tl-lg px-4 py-2.5">等级 / 用途</th>
                <th className="py-2.5">主模型</th>
                <th className="py-2.5">降级链</th>
                <th className="py-2.5">数据边界</th>
                <th className="py-2.5">预算上限</th>
                <th className="py-2.5">状态</th>
                <th className="py-2.5">下一步</th>
                <th className="rounded-tr-lg px-4 py-2.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((policy) => (
                <tr key={policy.id} className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)]">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-[var(--text)]">{policy.level}</div>
                    <div className="mt-0.5 text-[10px] leading-4 text-[var(--text-muted)]">{routingLevelPurpose(policy.level)}</div>
                  </td>
                  <td className="py-2.5">{byId.get(policy.primaryModelId) ?? '未配置'}</td>
                  <td className="py-2.5">
                    {policy.fallbackModelIds.length
                      ? policy.fallbackModelIds.map((id) => byId.get(id) ?? '不可用').join(' → ')
                      : <span className="text-[var(--text-muted)]">未配置{policy.level === 'P0' || policy.level === 'P1' ? ' · 建议补齐' : ''}</span>}
                  </td>
                  <td className="py-2.5">{routingDataScopeLabel(policy)}</td>
                  <td className="py-2.5 font-mono">${policy.budgetLimitUsd.toLocaleString('en-US')}</td>
                  <td className="py-2.5">
                    <Badge tone={policy.status === 'published' ? 'success' : policy.status === 'ready' ? 'warn' : 'neutral'}>
                      {policyStatusLabel(policy.status)}
                    </Badge>
                  </td>
                  <td className="py-2.5 text-[var(--text-secondary)]">{routingPolicyNextAction(policy.status)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" className="de-employee-btn" onClick={() => onOpen(policy.id)}>管理</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GovernanceWorkspace({
  canWrite, snapshot, models, policies, description, lastDrillResult, onOpenDrill, onGoRouting, onConfigurePolicy,
}: {
  canWrite: boolean;
  snapshot?: ModelGovernanceSnapshot;
  models: ModelProvider['models'];
  policies: RoutingPolicyDraft[];
  description: string;
  lastDrillResult: { policyId: string; fromModelId: string; toModelId: string; correlationId: string; status: string } | null;
  onOpenDrill: (policyId?: string) => void;
  onGoRouting: () => void;
  onConfigurePolicy: (policyId: string) => void;
}) {
  const byId = new Map(models.map((model) => [model.id, model.name]));
  const eligibility = governanceDrillEligibility(policies);
  const budgetParts = governanceBudgetBreakdown(policies);
  const spendUsd = snapshot?.monthlySpendUsd ?? 0;
  const budgetUsd = snapshot?.monthlyBudgetUsd ?? budgetParts.effectiveUsd;
  const draftBudgetUsd = snapshot?.draftBudgetUsd ?? budgetParts.draftUsd;
  const utilization = budgetUtilizationPercent(spendUsd, budgetUsd);
  const lastPolicy = lastDrillResult ? policies.find((item) => item.id === lastDrillResult.policyId) : undefined;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">运行治理与隔离演练</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--text-muted)]">{description}</p>
        </div>
        <span className="text-xs text-[var(--text-muted)]">可演练 {eligibility.count} / {eligibility.total} 条已发布</span>
      </div>

      <div className="mx-4 mt-3 grid gap-2 rounded-xl bg-[var(--bg)] p-3 text-[11px] leading-5 text-[var(--text-secondary)] sm:grid-cols-3" style={{ boxShadow: 'var(--saas-ring)' }} aria-label="治理定位与边界">
        <div>
          <div className="font-semibold text-[var(--text)]">定位</div>
          <p className="mt-1">运行态观察面：看健康、预算与地域是否仍满足数字伙伴调用边界。</p>
        </div>
        <div>
          <div className="font-semibold text-[var(--text)]">职责</div>
          <p className="mt-1">预算占用 · 供应商待命/停用 · 地域分布 · sandbox 降级演练。不编辑路由草稿，不接入凭据。</p>
        </div>
        <div>
          <div className="font-semibold text-[var(--text)]">边界</div>
          <p className="mt-1">用量指标供运营预警，非财务结算；演练仅 sandbox/canary，不切生产流量。策略改动请到「模型路由」。</p>
        </div>
      </div>

      <div className="space-y-3 p-3 md:p-4">
        <div className="de-employee-card rounded-xl bg-[var(--surface-1)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-[var(--text)]">预算占用</div>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                占用上限仅统计已发布路由月度预算（与强制限额一致）；草稿/待发布与已替代不计入分母。
              </p>
            </div>
            <Badge tone={snapshot?.budgetRisk === 'normal' ? 'success' : snapshot?.budgetRisk === 'attention' ? 'warn' : 'error'}>
              {budgetRiskLabel(snapshot?.budgetRisk ?? 'normal')}
            </Badge>
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-2 text-xs">
            <div>
              <span className="font-mono text-sm font-semibold text-[var(--text)]">${spendUsd.toLocaleString('en-US')}</span>
              <span className="text-[var(--text-muted)]"> / ${budgetUsd.toLocaleString('en-US')} USD</span>
            </div>
            <span className="text-[var(--text-muted)]">{utilization == null ? '无已发布上限' : `已占用 ${utilization}%`}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                snapshot?.budgetRisk === 'critical' ? 'bg-[var(--danger)]' : snapshot?.budgetRisk === 'attention' ? 'bg-[var(--warning)]' : 'bg-[var(--success)]',
              )}
              style={{ width: `${utilization ?? 0}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[var(--text-muted)]">
            <span>已发布上限 ${budgetParts.publishedUsd.toLocaleString('en-US')}</span>
            {draftBudgetUsd > 0 && (
              <span>草稿/待发布规划 ${draftBudgetUsd.toLocaleString('en-US')}（不计入占用）</span>
            )}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="de-employee-card rounded-xl bg-[var(--surface-1)] p-4">
            <div className="text-xs font-semibold text-[var(--text)]">供应商运行态</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-[var(--bg)] px-2 py-2" style={{ boxShadow: 'var(--saas-ring)' }}>
                <div className="font-mono text-sm font-semibold text-[var(--success)]">{snapshot?.activeProviders ?? 0}</div>
                <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">可用</div>
              </div>
              <div className="rounded-lg bg-[var(--bg)] px-2 py-2" style={{ boxShadow: 'var(--saas-ring)' }}>
                <div className="font-mono text-sm font-semibold text-[var(--warning)]">{snapshot?.standbyProviders ?? 0}</div>
                <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">待命</div>
              </div>
              <div className="rounded-lg bg-[var(--bg)] px-2 py-2" style={{ boxShadow: 'var(--saas-ring)' }}>
                <div className="font-mono text-sm font-semibold text-[var(--text-secondary)]">{snapshot?.disabledProviders ?? 0}</div>
                <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">已停用</div>
              </div>
            </div>
          </div>

          <div className="de-employee-card rounded-xl bg-[var(--surface-1)] p-4">
            <div className="text-xs font-semibold text-[var(--text)]">地域分布</div>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">按供应商云区域汇总，用于核对出境与数据驻留策略。</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(snapshot?.regionDistribution ?? []).length === 0 ? (
                <span className="text-xs text-[var(--text-muted)]">暂无供应商地域数据</span>
              ) : snapshot?.regionDistribution.map((item) => (
                <span key={item.region} className="de-employee-chip is-active rounded-md px-2.5 py-1 text-[11px]">
                  {item.region} · {item.count}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="de-employee-card rounded-xl bg-[var(--surface-1)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
                <FlaskConical className="h-4 w-4 text-[var(--brand)]" />故障切换演练
              </div>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                仅对「已发布且含降级链」的路由执行 sandbox 验证；结果写入模型审计。
              </p>
              {lastDrillResult ? (
                <div className="mt-2 rounded-lg bg-[var(--bg)] px-3 py-2 text-[11px] leading-5 text-[var(--text-secondary)]" style={{ boxShadow: 'var(--saas-ring)' }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="success">最近演练 · {lastDrillResult.status}</Badge>
                    <span>{lastPolicy?.level ?? lastDrillResult.policyId}</span>
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
                    {byId.get(lastDrillResult.fromModelId) ?? lastDrillResult.fromModelId}
                    {' → '}
                    {byId.get(lastDrillResult.toModelId) ?? lastDrillResult.toModelId}
                    {' · '}
                    {lastDrillResult.correlationId}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">{eligibility.guidance}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {!eligibility.ready && (
                <button type="button" className="de-employee-btn" onClick={onGoRouting}>
                  <Route className="h-3.5 w-3.5" />去模型路由
                </button>
              )}
              <button
                type="button"
                className="de-employee-btn de-employee-btn--primary"
                disabled={!canWrite || !eligibility.ready}
                title={!eligibility.ready ? eligibility.guidance : '打开演练配置'}
                onClick={() => onOpenDrill()}
              >
                <FlaskConical className="h-3.5 w-3.5" />打开演练
              </button>
            </div>
          </div>

          {(eligibility.drillable.length > 0 || eligibility.blocked.length > 0) && (
            <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
              <div className="text-[11px] font-semibold text-[var(--text)]">已发布路由演练就绪度</div>
              {eligibility.drillable.map((policy) => (
                <div key={policy.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--bg)] px-3 py-2 text-[11px]" style={{ boxShadow: 'var(--saas-ring)' }}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[var(--text)]">{policy.level}</span>
                      <Badge tone="success">可演练</Badge>
                      <span className="text-[var(--text-muted)]">降级 {policy.fallbackModelIds.length} 级</span>
                    </div>
                    <p className="mt-0.5 truncate text-[var(--text-muted)]">
                      {byId.get(policy.primaryModelId) ?? policy.primaryModelId}
                      {policy.fallbackModelIds.map((id) => ` → ${byId.get(id) ?? id}`).join('')}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="de-employee-btn"
                    disabled={!canWrite}
                    onClick={() => onOpenDrill(policy.id)}
                  >
                    演练
                  </button>
                </div>
              ))}
              {eligibility.blocked.map(({ policy, reason }) => (
                <div key={policy.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-bg)] px-3 py-2 text-[11px]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[var(--text)]">{policy.level}</span>
                      <Badge tone="warn">不可演练</Badge>
                    </div>
                    <p className="mt-0.5 text-[var(--warning)]">{reason}</p>
                    <p className="mt-0.5 truncate text-[var(--text-muted)]">
                      主模型 {byId.get(policy.primaryModelId) ?? policy.primaryModelId} · {routingDataScopeLabel(policy)}
                    </p>
                  </div>
                  <button type="button" className="de-employee-btn" onClick={() => onConfigurePolicy(policy.id)}>
                    配置降级
                  </button>
                </div>
              ))}
            </div>
          )}

          {eligibility.total === 0 && (
            <div className="mt-3 rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-[11px] text-[var(--text-muted)]">
              还没有已发布路由。可先创建草稿并完成「校验 → 发布」，P0/P1 建议配置降级链以便演练。
              <button type="button" className="ml-2 text-[var(--brand)] underline-offset-2 hover:underline" onClick={onGoRouting}>前往模型路由</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FailoverDrillForm({
  canWrite, models, publishedPolicies, drillPolicyId, onDrillPolicyChange, pending, lastResult, onCancel, onRun,
}: {
  canWrite: boolean;
  models: ModelProvider['models'];
  publishedPolicies: RoutingPolicyDraft[];
  drillPolicyId: string;
  onDrillPolicyChange: (id: string) => void;
  pending: boolean;
  lastResult: { policyId: string; fromModelId: string; toModelId: string; correlationId: string; status: string } | null;
  onCancel: () => void;
  onRun: (policyId: string) => void;
}) {
  const byId = new Map(models.map((model) => [model.id, model.name]));
  const target = publishedPolicies.find((policy) => policy.id === drillPolicyId) ?? publishedPolicies[0];
  const blockedReason = !publishedPolicies.length
    ? '没有「已发布且含降级链」的策略，无法演练'
    : !target
      ? '请选择演练策略'
      : undefined;

  useEffect(() => {
    if (!drillPolicyId && publishedPolicies[0]) onDrillPolicyChange(publishedPolicies[0].id);
  }, [drillPolicyId, publishedPolicies, onDrillPolicyChange]);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 rounded-xl bg-[var(--bg)] p-3 text-[11px] leading-5 text-[var(--text-secondary)] sm:grid-cols-3" style={{ boxShadow: 'var(--saas-ring)' }}>
        <div><span className="font-semibold text-[var(--text)]">范围</span><p className="mt-1">sandbox（隔离）</p></div>
        <div><span className="font-semibold text-[var(--text)]">验证项</span><p className="mt-1">主 → 降级切流 · 审计写入</p></div>
        <div><span className="font-semibold text-[var(--text)]">不影响</span><p className="mt-1">生产流量 · 预算扣费 · 真实 KMS</p></div>
      </div>

      <Field label="演练策略">
        <select
          value={target?.id ?? ''}
          onChange={(event) => onDrillPolicyChange(event.target.value)}
          className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs"
          disabled={!publishedPolicies.length}
        >
          {publishedPolicies.length === 0 && <option value="">无可演练策略</option>}
          {publishedPolicies.map((policy) => (
            <option key={policy.id} value={policy.id}>
              {policy.level} · 降级 {policy.fallbackModelIds.length} 级 · {routingDataScopeLabel(policy)}
            </option>
          ))}
        </select>
      </Field>

      {target && (
        <div className="rounded-xl bg-[var(--bg)] p-3 text-xs" style={{ boxShadow: 'var(--saas-ring)' }}>
          <div className="font-medium text-[var(--text)]">降级路径预览</div>
          <p className="mt-1.5 font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
            {byId.get(target.primaryModelId) ?? target.primaryModelId}
            {target.fallbackModelIds.map((id) => ` → ${byId.get(id) ?? id}`).join('')}
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">{routingLevelPurpose(target.level)} · 预算 ${target.budgetLimitUsd.toLocaleString('en-US')}/月</p>
        </div>
      )}

      {blockedReason && <p className="text-[11px] text-[var(--warning)]">{blockedReason}</p>}

      {lastResult && (
        <div className="rounded-lg border border-[var(--success)]/30 bg-[var(--success-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--success)]">
          最近结果：{byId.get(lastResult.fromModelId) ?? lastResult.fromModelId} → {byId.get(lastResult.toModelId) ?? lastResult.toModelId}
          <span className="ml-1 font-mono text-[10px] opacity-80">· {lastResult.correlationId}</span>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-3">
        <Button size="sm" variant="ghost" onClick={onCancel}>关闭</Button>
        <Button
          size="sm"
          disabled={!canWrite || !target || Boolean(blockedReason) || pending}
          loading={pending}
          onClick={() => target && onRun(target.id)}
        >
          <RefreshCw className="h-3.5 w-3.5" />执行演练
        </Button>
      </div>
    </div>
  );
}

function AuditWorkspace({
  events, description, resultFilter, actionFilter, actions, onResultFilter, onActionFilter,
}: {
  events: ModelAuditEvent[];
  description: string;
  resultFilter: 'all' | 'success' | 'failed';
  actionFilter: string;
  actions: string[];
  onResultFilter: (value: 'all' | 'success' | 'failed') => void;
  onActionFilter: (value: string) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">模型控制面审计</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="审计结果筛选">
            {([
              ['all', '全部'],
              ['success', '成功'],
              ['failed', '失败'],
            ] as const).map(([item, label]) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={resultFilter === item}
                onClick={() => onResultFilter(item)}
                className={cn('de-employee-chip shrink-0 rounded-md px-3 py-1.5 text-xs transition-colors', resultFilter === item && 'is-active')}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={actionFilter}
            onChange={(event) => onActionFilter(event.target.value)}
            className="de-employee-input h-8 rounded-lg bg-[var(--bg)] px-2 text-xs text-[var(--text-secondary)]"
          >
            <option value="all">全部动作</option>
            {actions.map((action) => <option key={action} value={action}>{action}</option>)}
          </select>
          <span className="text-xs text-[var(--text-muted)]">{events.length} 条</span>
        </div>
      </div>
      {events.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={History} title="暂无模型控制面审计事件" />
        </div>
      ) : (
        <div className="space-y-2 p-4">
          {events.map((event) => (
            <article key={event.id} className="de-employee-card rounded-xl bg-[var(--surface-1)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone={event.result === 'success' ? 'success' : 'error'}>{event.result === 'success' ? '成功' : '失败'}</Badge>
                  <strong className="text-xs text-[var(--text)]">{event.action}</strong>
                </div>
                <time className="font-mono text-[11px] text-[var(--text-muted)]">{new Date(event.time).toLocaleString('zh-CN')}</time>
              </div>
              <div className="mt-2 text-xs text-[var(--text-secondary)]">目标：{event.target}{event.reason ? ` · 原因：${event.reason}` : ''}</div>
              <div className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">关联 {event.correlationId}{event.policyVersion ? ` · 版本 ${event.policyVersion}` : ''} · {event.actor}</div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

type DiscoverModelsResult = {
  models: Array<{ id: string; name: string }>;
  source?: 'remote' | 'catalog';
  suggestedProtocol?: string;
  resolvedUrl?: string;
};

function ProviderForm({ canWrite, workspaceId, onCancel, onSubmit, creating }: {
  canWrite: boolean;
  workspaceId: string;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
  creating?: boolean;
}) {
  const [draft, setDraft] = useState<ProviderConnectDraft>(() => createProviderConnectDraft('openai_compatible'));
  const sessionCredentialRef = useRef('');
  const [credentialVerified, setCredentialVerified] = useState(false);
  const [discovered, setDiscovered] = useState<Array<{ id: string; name: string }>>([]);
  const [discoverHint, setDiscoverHint] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<null | {
    ok: boolean;
    title: string;
    detail?: string;
    latencyMs?: number;
    suggestProtocol?: string;
  }>(null);
  const preset = getProviderConnectPreset(draft.protocol);
  const effectiveCredential = () => resolveProviderCredential(draft, sessionCredentialRef.current);
  const hasCredential = Boolean(effectiveCredential()) || draft.protocol === 'ollama';
  const credentialOptions = { sessionCredential: sessionCredentialRef.current };
  const issues = validateProviderConnectDraft(draft, credentialOptions);
  const discoverGate = hasCredential ? canDiscoverModels(draft, credentialOptions) : { ok: false as const, reason: '请先填写 API Key' };
  const testGate = hasCredential ? canTestConnectDraft(draft, credentialOptions) : { ok: false as const, reason: '请先填写 API Key' };
  const protocolHint = protocolBaseUrlHint(draft.protocol, draft.baseUrl);
  const discoverModels = useApiMutation<DiscoverModelsResult, Record<string, unknown>>(
    '/api/model-providers/discover-models',
  );
  const testConnection = useApiMutation<{ status: string; latencyMs?: number; suggestedProtocol?: string }, Record<string, unknown>>(
    '/api/model-providers/test-connection',
  );
  const rememberCredential = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    sessionCredentialRef.current = trimmed;
    setCredentialVerified(false);
  };
  const markCredentialVerified = () => {
    const resolved = effectiveCredential();
    if (resolved) sessionCredentialRef.current = resolved;
    setCredentialVerified(Boolean(resolved) || draft.protocol === 'ollama');
  };
  const patch = <K extends keyof ProviderConnectDraft>(key: K, value: ProviderConnectDraft[K]) => {
    if (key === 'apiKey' && typeof value === 'string') rememberCredential(value);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const show = (key: (typeof preset.fields)[number]) => preset.fields.includes(key);
  const discoverBody = () => ({
    workspaceId,
    protocol: draft.protocol,
    baseUrl: draft.baseUrl.trim(),
    credential: effectiveCredential(),
    apiKey: effectiveCredential(),
    apiVersion: draft.apiVersion || undefined,
    deploymentName: draft.deploymentName || undefined,
  });
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">接入协议</div>
        <div className="flex flex-wrap gap-1.5">
          {PROVIDER_CONNECT_PRESETS.map((item) => (
            <button
              key={item.protocol}
              type="button"
              title={item.description}
              onClick={() => {
                setDraft((current) => applyProviderConnectProtocol(current, item.protocol));
                setDiscovered([]);
                setDiscoverHint(null);
                setProbeResult(null);
              }}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-[11px] transition-colors',
                draft.protocol === item.protocol
                  ? 'bg-[var(--brand-light)] font-semibold text-[var(--brand)]'
                  : 'bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)]',
              )}
              style={draft.protocol === item.protocol ? undefined : { boxShadow: 'var(--saas-ring)' }}
            >
              {item.shortLabel}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-5 text-[var(--text-muted)]">{preset.hint}</p>
        {protocolHint && (
          <p className="mt-1.5 rounded-lg bg-[var(--warning-bg)] px-2.5 py-1.5 text-[11px] leading-5 text-[var(--warning)]">
            {protocolHint}
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="供应商名称">
          <Input className="h-9 text-xs" value={draft.displayName} onChange={(event) => patch('displayName', event.target.value)} placeholder="例如：Claude 官方" />
        </Field>
        <Field label="备注">
          <Input className="h-9 text-xs" value={draft.note} onChange={(event) => patch('note', event.target.value)} placeholder="例如：公司专用账号（可选）" />
        </Field>
      </div>

      {show('baseUrl') && (
        <Field label="API 请求地址">
          <Input
            className="h-9 font-mono text-xs"
            value={draft.baseUrl}
            onChange={(event) => {
              patch('baseUrl', event.target.value);
              setDiscovered([]);
              setProbeResult(null);
            }}
            placeholder="https://your-api-endpoint.com/v1"
          />
          <p className="mt-1.5 rounded-lg bg-[var(--warning-bg)] px-2.5 py-1.5 text-[11px] leading-5 text-[var(--warning)]">
            填写兼容该协议的服务器端点；OpenAI 兼容地址通常以 /v1 结尾。
          </p>
        </Field>
      )}

      {show('apiKey') && (
        <Field label={preset.credentialLabel}>
          <Input
            className="h-9 font-mono text-xs"
            type="password"
            value={draft.apiKey}
            onChange={(event) => {
              patch('apiKey', event.target.value);
              setProbeResult(null);
            }}
            placeholder={preset.credentialPlaceholder}
            autoComplete="new-password"
            name="provider-api-key"
            form="de-provider-secret"
          />
          <form id="de-provider-secret" className="hidden" aria-hidden="true" onSubmit={(event) => event.preventDefault()} />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            {credentialVerified && !draft.apiKey.trim()
              ? '凭据已通过连接测试，拉取模型与创建时无需重复填写。'
              : '只需填写这里；提交后写入凭据引用，不会回显明文。'}
          </p>
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {show('deploymentName') && (
          <Field label="Deployment Name">
            <Input className="h-9 font-mono text-xs" value={draft.deploymentName} onChange={(event) => patch('deploymentName', event.target.value)} placeholder="Azure 部署名" />
          </Field>
        )}
        {show('apiVersion') && (
          <Field label="API Version">
            <Input className="h-9 font-mono text-xs" value={draft.apiVersion} onChange={(event) => patch('apiVersion', event.target.value)} placeholder="2024-10-21" />
          </Field>
        )}
      </div>

      {show('modelId') && (
        <Field label="默认模型">
          <div className="flex gap-2">
            <Input
              className="h-9 flex-1 font-mono text-xs"
              list="provider-discovered-models"
              value={draft.modelId}
              onChange={(event) => patch('modelId', event.target.value)}
              placeholder={preset.modelPlaceholder}
            />
            <Button
              size="sm"
              variant="secondary"
              className="h-9 shrink-0 px-2.5"
              disabled={!canWrite || !discoverGate.ok || discoverModels.isPending}
              title={discoverGate.ok ? '从供应商端点真实拉取模型列表' : discoverGate.reason}
              loading={discoverModels.isPending}
              onClick={() => {
                setDiscoverHint(null);
                discoverModels.mutate(discoverBody(), {
                  onSuccess: (result) => {
                    markCredentialVerified();
                    const models = result.models ?? [];
                    setDiscovered(models);
                    setDraft((current) => ({
                      ...current,
                      modelId: pickModelAfterDiscover(current.modelId, models),
                    }));
                    const sourceHint = result.source === 'remote'
                      ? `已从供应商拉取 ${models.length} 个模型`
                      : `已获取 ${models.length} 个模型（目录回落，非实时）`;
                    const suggest = result.suggestedProtocol && result.suggestedProtocol !== draft.protocol
                      ? `；地址更像 ${result.suggestedProtocol}，可切换协议后重试`
                      : '';
                    setDiscoverHint(`${sourceHint}${suggest}。点选下方标签或继续手写。`);
                    toast.success(sourceHint);
                  },
                  onError: (error) => {
                    setDiscovered([]);
                    const message = error instanceof Error ? error.message.replace(/^E_[A-Z_]+:\s*/, '') : '拉取模型失败';
                    setDiscoverHint(message);
                    toast.error(message);
                  },
                });
              }}
            >
              <Download className="h-3.5 w-3.5" />拉取
            </Button>
          </div>
          <datalist id="provider-discovered-models">
            {discovered.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </datalist>
          <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
            {discoverHint ?? '点击「拉取」向供应商真实请求模型目录；点选标签即可填入默认模型。'}
          </p>
          {discovered.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {discovered.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => patch('modelId', model.id)}
                  className={cn(
                    'rounded-md px-2 py-1 font-mono text-[10px]',
                    draft.modelId === model.id ? 'bg-[var(--brand-light)] text-[var(--brand)]' : 'bg-[var(--bg)] text-[var(--text-secondary)]',
                  )}
                  style={draft.modelId === model.id ? undefined : { boxShadow: 'var(--saas-ring)' }}
                >
                  {model.name}
                </button>
              ))}
            </div>
          )}
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {show('organizationId') && (
          <Field label="Organization ID（可选）">
            <Input className="h-9 font-mono text-xs" value={draft.organizationId} onChange={(event) => patch('organizationId', event.target.value)} placeholder="org_…" />
          </Field>
        )}
        {show('region') && (
          <Field label="云区域 / 数据驻留">
            <Input className="h-9 text-xs" value={draft.region} onChange={(event) => patch('region', event.target.value)} placeholder="cn-east-1 / global" />
          </Field>
        )}
      </div>

      {probeResult && (
        <div
          role="status"
          className={cn(
            'rounded-lg px-3 py-2.5 text-[11px] leading-5',
            probeResult.ok
              ? 'bg-[var(--success-bg)] text-[var(--success)]'
              : 'bg-[var(--danger-bg)] text-[var(--danger)]',
          )}
        >
          <div className="flex items-start gap-2">
            {probeResult.ok
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={probeResult.ok ? 'success' : 'error'}>
                  {probeResult.ok ? '连接成功' : '连接失败'}
                </Badge>
                <strong className="text-xs font-semibold">{probeResult.title}</strong>
                {typeof probeResult.latencyMs === 'number' && (
                  <span className="font-mono text-[10px] opacity-90">延迟 {probeResult.latencyMs}ms</span>
                )}
              </div>
              {probeResult.detail && (
                <p className="text-[11px] leading-5 opacity-95">{probeResult.detail}</p>
              )}
              {probeResult.ok && probeResult.suggestProtocol && (
                <p className="rounded-md bg-[var(--warning-bg)] px-2 py-1 text-[var(--warning)]">
                  当前协议可连通，但地址更像 <code className="font-mono">{probeResult.suggestProtocol}</code>
                  ，建议切换后再创建，避免后续拉取/路由异常。
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <div className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--danger)]">
          {issues.map((issue) => <div key={issue}>• {issue}</div>)}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-3">
        <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!canWrite || !testGate.ok || testConnection.isPending}
          loading={testConnection.isPending}
          title={testGate.ok ? '不落库，仅向供应商发起连通性探测' : testGate.reason}
          onClick={() => {
            if (!testGate.ok) return;
            setProbeResult(null);
            testConnection.mutate(discoverBody(), {
              onSuccess: (result) => {
                markCredentialVerified();
                const latencyMs = typeof result.latencyMs === 'number' ? result.latencyMs : undefined;
                const suggestProtocol = result.suggestedProtocol && result.suggestedProtocol !== draft.protocol
                  ? result.suggestedProtocol
                  : undefined;
                setProbeResult({
                  ok: true,
                  title: '供应商端点可达，鉴权通过',
                  latencyMs,
                  suggestProtocol,
                  detail: suggestProtocol
                    ? undefined
                    : '可继续创建受管接入；凭据仅保存在服务端。',
                });
                toast.success(latencyMs != null ? `连接测试通过（${latencyMs}ms）` : '连接测试通过');
              },
              onError: (error) => {
                const message = error instanceof Error ? error.message.replace(/^E_[A-Z_]+:\s*/, '') : '连接测试失败';
                setProbeResult({
                  ok: false,
                  title: '无法连通或鉴权失败',
                  detail: message,
                });
                toast.error(message);
              },
            });
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" />测试连接
        </Button>
        <Button
          size="sm"
          disabled={!canWrite || issues.length > 0 || creating}
          loading={creating}
          onClick={() => {
            onSubmit(providerConnectToPayload(draft, workspaceId, { sessionCredential: sessionCredentialRef.current }));
            sessionCredentialRef.current = '';
            setCredentialVerified(false);
            patch('apiKey', '');
          }}
        >
          创建受管接入
        </Button>
      </div>
    </div>
  );
}

function ProviderDetail({
  provider, impact, canWrite, workspaceId, onClose, onSave, onTest, onDisable, onDelete, onOpenPolicy,
}: {
  provider: ModelProvider;
  impact?: ProviderImpact;
  canWrite: boolean;
  workspaceId: string;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  onTest: () => void;
  onDisable: () => void;
  onDelete: () => void;
  onOpenPolicy?: (policyId: string) => void;
}) {
  const deletion = providerLifecycleAction(impact);
  const routeReferences = impact?.routeReferences ?? [];
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState<ProviderConnectDraft>(() => draftFromProvider(provider));
  const [discovered, setDiscovered] = useState<Array<{ id: string; name: string }>>([]);
  const [discoverHint, setDiscoverHint] = useState<string | null>(null);
  useEffect(() => {
    if (mode === 'view') setDraft(draftFromProvider(provider));
  }, [provider, mode]);
  const preset = getProviderConnectPreset(draft.protocol);
  const viewPreset = getProviderConnectPreset(provider.protocol ?? draft.protocol);
  const issues = validateProviderConnectDraft(draft, { requireApiKey: false });
  const discoverGate = canDiscoverModels(draft, { allowStoredCredential: true });
  const testGate = canTestSavedProvider(provider);
  const discoverModels = useApiMutation<{ models: Array<{ id: string; name: string }> }, Record<string, unknown>>(
    '/api/model-providers/discover-models',
  );
  const initial = draftFromProvider(provider);
  const dirty = JSON.stringify({ ...draft, apiKey: draft.apiKey ? '***' : '' }) !== JSON.stringify({ ...initial, apiKey: '' }) || Boolean(draft.apiKey);
  const patch = <K extends keyof ProviderConnectDraft>(key: K, value: ProviderConnectDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const show = (key: (typeof preset.fields)[number]) => preset.fields.includes(key);
  const showView = (key: (typeof viewPreset.fields)[number]) => viewPreset.fields.includes(key);
  const enterEdit = () => {
    setDraft(draftFromProvider(provider));
    setDiscovered([]);
    setDiscoverHint(null);
    setMode('edit');
  };
  const cancelEdit = () => {
    setDraft(draftFromProvider(provider));
    setDiscovered([]);
    setDiscoverHint(null);
    setMode('view');
  };

  const statusBanner = (
    <div className="rounded-xl bg-[var(--bg)] p-3 text-xs" style={{ boxShadow: 'var(--saas-ring)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={mode === 'view' ? 'info' : 'warn'}>{mode === 'view' ? '查看' : '编辑中'}</Badge>
        <Badge tone={providerStatusTone(provider.status)}>{providerStatusLabel(provider.status)}</Badge>
        <Badge tone="neutral">{protocolLabel(provider.protocol)}</Badge>
        <Badge tone="neutral">{TIER_LABEL[provider.tier] ?? provider.tier}</Badge>
        <span className="text-[var(--text-muted)]">{provider.lastVerifiedAt ? `最近验证 ${new Date(provider.lastVerifiedAt).toLocaleString('zh-CN')}` : '尚未验证'}</span>
      </div>
      <div className="mt-2 text-[11px] text-[var(--text-secondary)]">
        当前模型：{(provider.models ?? []).map((model) => model.name).join(' · ') || '未配置'}
      </div>
    </div>
  );

  const impactPanel = (
    <div className="rounded-xl bg-[var(--bg)] p-3 text-xs" style={{ boxShadow: 'var(--saas-ring)' }}>
      <div className="font-medium text-[var(--text)]">退役影响</div>
      <p className="mt-1 text-[var(--text-muted)]">
        {!impact
          ? '正在检查已发布路由引用…'
          : (impact.blockedReason ?? '未发现已发布路由引用，可执行删除。')}
      </p>
      {routeReferences.map((item) => (
        <div key={`${item.policyId}:${item.versionId}`} className="mt-1.5 flex flex-wrap items-center gap-2 text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-1">
            <Network className="h-3 w-3" />{item.level} · {item.versionId || item.policyId}
          </span>
          {onOpenPolicy ? (
            <button
              type="button"
              className="text-[11px] font-medium text-[var(--brand)] hover:underline"
              onClick={() => onOpenPolicy(item.policyId)}
            >
              去取消发布
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );

  if (mode === 'view') {
    return (
      <div className="space-y-3">
        {statusBanner}
        <dl className="grid gap-3 sm:grid-cols-2">
          <ViewField label="接入协议" value={protocolLabel(provider.protocol)} />
          <ViewField label="供应商名称" value={provider.name} />
          <ViewField label="备注" value={provider.note?.trim() || '—'} />
          {showView('baseUrl') && <ViewField label="API 请求地址" value={provider.baseUrl || '—'} mono />}
          <ViewField label="凭据引用" value={`${provider.credentialRef || '—'} · ${provider.credentialMasked || '未配置'}`} mono />
          {showView('deploymentName') && <ViewField label="Deployment Name" value={provider.deploymentName || '—'} mono />}
          {showView('apiVersion') && <ViewField label="API Version" value={provider.apiVersion || '—'} mono />}
          {showView('modelId') && (
            <ViewField
              label="默认模型"
              value={(provider.models ?? []).map((model) => model.name).join(' · ') || '—'}
              mono
            />
          )}
          {showView('organizationId') && <ViewField label="Organization ID" value={provider.organizationId || '—'} mono />}
          {showView('region') && <ViewField label="云区域 / 数据驻留" value={provider.cloudRegion || '—'} />}
        </dl>
        {impactPanel}
        {!testGate.ok && (
          <div className="rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--warning)]">
            信息不足，无法验证连通性：{testGate.reason}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!canWrite || !testGate.ok}
              title={testGate.ok ? '使用已保存配置验证连通性' : testGate.reason}
              onClick={() => { if (testGate.ok) onTest(); }}
            >
              <ShieldCheck className="h-3.5 w-3.5" />验证连通性
            </Button>
            <Button size="sm" variant="outline" disabled={!canWrite || provider.status === 'disabled'} onClick={onDisable}>停止新流量</Button>
            <Button size="sm" variant="ghost" disabled={!canWrite || deletion.disabled} onClick={onDelete}><Trash2 className="h-3.5 w-3.5" />{deletion.label}</Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
            {canWrite && (
              <Button size="sm" onClick={enterEdit}>
                <Pencil className="h-3.5 w-3.5" />编辑配置
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {statusBanner}
      <p className="rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]">
        编辑中：修改仅在点击「保存配置」后生效；连通性验证请先保存，再回到查看态执行。
      </p>

      <div>
        <div className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">接入协议</div>
        <div className="flex flex-wrap gap-1.5">
          {PROVIDER_CONNECT_PRESETS.map((item) => (
            <button
              key={item.protocol}
              type="button"
              title={item.description}
              onClick={() => {
                setDraft((current) => applyProviderConnectProtocol(current, item.protocol));
                setDiscovered([]);
                setDiscoverHint(null);
              }}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-[11px] transition-colors',
                draft.protocol === item.protocol
                  ? 'bg-[var(--brand-light)] font-semibold text-[var(--brand)]'
                  : 'bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)]',
              )}
              style={draft.protocol === item.protocol ? undefined : { boxShadow: 'var(--saas-ring)' }}
            >
              {item.shortLabel}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-5 text-[var(--text-muted)]">{preset.hint}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="供应商名称">
          <Input className="h-9 text-xs" value={draft.displayName} onChange={(event) => patch('displayName', event.target.value)} />
        </Field>
        <Field label="备注">
          <Input className="h-9 text-xs" value={draft.note} onChange={(event) => patch('note', event.target.value)} placeholder="例如：公司专用账号（可选）" />
        </Field>
      </div>

      {show('baseUrl') && (
        <Field label="API 请求地址">
          <Input
            className="h-9 font-mono text-xs"
            value={draft.baseUrl}
            onChange={(event) => { patch('baseUrl', event.target.value); setDiscovered([]); }}
            placeholder="https://your-api-endpoint.com/v1"
          />
        </Field>
      )}

      <div className="rounded-xl bg-[var(--bg)] p-3 text-xs" style={{ boxShadow: 'var(--saas-ring)' }}>
        <div className="font-medium text-[var(--text)]">凭据引用</div>
        <div className="mt-1 font-mono text-[var(--text-muted)]">{provider.credentialRef} · {provider.credentialMasked}</div>
        <div className="mt-2">
          <Field label={`${preset.credentialLabel}（轮换，留空不变）`}>
            <Input
              className="h-9 font-mono text-xs"
              type="password"
              value={draft.apiKey}
              onChange={(event) => patch('apiKey', event.target.value)}
              placeholder="输入新密钥以轮换；留空保留现有引用"
              autoComplete="new-password"
              name="provider-api-key-rotate"
              form="de-provider-secret-rotate"
            />
            <form id="de-provider-secret-rotate" className="hidden" aria-hidden="true" onSubmit={(event) => event.preventDefault()} />
          </Field>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {show('deploymentName') && (
          <Field label="Deployment Name">
            <Input className="h-9 font-mono text-xs" value={draft.deploymentName} onChange={(event) => patch('deploymentName', event.target.value)} />
          </Field>
        )}
        {show('apiVersion') && (
          <Field label="API Version">
            <Input className="h-9 font-mono text-xs" value={draft.apiVersion} onChange={(event) => patch('apiVersion', event.target.value)} />
          </Field>
        )}
      </div>

      {show('modelId') && (
        <Field label="默认模型">
          <div className="flex gap-2">
            <Input
              className="h-9 flex-1 font-mono text-xs"
              list={`provider-detail-models-${provider.id}`}
              value={draft.modelId}
              onChange={(event) => patch('modelId', event.target.value)}
              placeholder={preset.modelPlaceholder}
            />
            <Button
              size="sm"
              variant="secondary"
              className="h-9 shrink-0 px-2.5"
              disabled={!discoverGate.ok || discoverModels.isPending}
              title={discoverGate.ok ? '使用已保存凭据或新密钥拉取模型' : discoverGate.reason}
              loading={discoverModels.isPending}
              onClick={() => {
                if (!discoverGate.ok) return;
                setDiscoverHint(null);
                discoverModels.mutate(
                  {
                    workspaceId,
                    providerId: provider.id,
                    protocol: draft.protocol,
                    baseUrl: draft.baseUrl.trim(),
                    credential: draft.apiKey || undefined,
                    apiKey: draft.apiKey || undefined,
                    apiVersion: draft.apiVersion || undefined,
                    deploymentName: draft.deploymentName || undefined,
                  },
                  {
                    onSuccess: (result) => {
                      const models = result.models ?? [];
                      setDiscovered(models);
                      setDraft((current) => ({
                        ...current,
                        modelId: pickModelAfterDiscover(current.modelId, models),
                      }));
                      setDiscoverHint(`已从供应商拉取 ${models.length} 个模型，可点选更新默认模型`);
                      toast.success(`已拉取 ${models.length} 个模型名称`);
                    },
                    onError: (error) => {
                      setDiscovered([]);
                      const message = error instanceof Error ? error.message.replace(/^E_[A-Z_]+:\s*/, '') : '拉取模型失败';
                      setDiscoverHint(message);
                      toast.error(message);
                    },
                  },
                );
              }}
            >
              <Download className="h-3.5 w-3.5" />拉取
            </Button>
          </div>
          <datalist id={`provider-detail-models-${provider.id}`}>
            {discovered.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </datalist>
          <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
            {discoverHint ?? (!discoverGate.ok ? discoverGate.reason : '可手写模型名，或点击「拉取」从端点同步可用名称。')}
          </p>
          {discovered.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {discovered.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => patch('modelId', model.id)}
                  className={cn(
                    'rounded-md px-2 py-1 font-mono text-[10px]',
                    draft.modelId === model.id ? 'bg-[var(--brand-light)] text-[var(--brand)]' : 'bg-[var(--bg)] text-[var(--text-secondary)]',
                  )}
                  style={draft.modelId === model.id ? undefined : { boxShadow: 'var(--saas-ring)' }}
                >
                  {model.name}
                </button>
              ))}
            </div>
          )}
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {show('organizationId') && (
          <Field label="Organization ID（可选）">
            <Input className="h-9 font-mono text-xs" value={draft.organizationId} onChange={(event) => patch('organizationId', event.target.value)} />
          </Field>
        )}
        {show('region') && (
          <Field label="云区域 / 数据驻留">
            <Input className="h-9 text-xs" value={draft.region} onChange={(event) => patch('region', event.target.value)} />
          </Field>
        )}
      </div>

      {impactPanel}

      {issues.length > 0 && (
        <div className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--danger)]">
          {issues.map((issue) => <div key={issue}>• {issue}</div>)}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
        <Button size="sm" variant="ghost" onClick={cancelEdit}>取消编辑</Button>
        <Button
          size="sm"
          disabled={!dirty || issues.length > 0}
          onClick={() => {
            onSave(providerConnectToPayload(draft, workspaceId, { includeCredential: false }));
            patch('apiKey', '');
            setMode('view');
          }}
        >
          保存配置
        </Button>
      </div>
    </div>
  );
}

function ViewField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-[var(--bg)] px-3 py-2.5" style={{ boxShadow: 'var(--saas-ring)' }}>
      <dt className="text-[11px] text-[var(--text-muted)]">{label}</dt>
      <dd className={cn('mt-1 break-all text-xs text-[var(--text)]', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}

function FallbackChainEditor({
  models,
  primaryModelId,
  fallbackModelIds,
  onChange,
  disabled,
}: {
  models: ModelProvider['models'];
  primaryModelId: string;
  fallbackModelIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const available = models.filter((model) => model.status === 'available' && model.id !== primaryModelId && !fallbackModelIds.includes(model.id));
  const byId = new Map(models.map((model) => [model.id, model]));

  return (
    <div className="space-y-2">
      {fallbackModelIds.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)]">未配置降级。P0/P1 建议至少一级备选，故障时可自动切流。</p>
      ) : (
        <ol className="space-y-1.5">
          {fallbackModelIds.map((id, index) => (
            <li key={`${id}-${index}`} className="flex items-center gap-2 rounded-lg bg-[var(--bg)] px-2.5 py-1.5 text-xs" style={{ boxShadow: 'var(--saas-ring)' }}>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">L{index + 1}</span>
              <span className="min-w-0 flex-1 truncate">{byId.get(id)?.name ?? id}</span>
              <button
                type="button"
                className="text-[11px] text-[var(--text-muted)] hover:text-[var(--danger)] disabled:opacity-40"
                disabled={disabled}
                onClick={() => onChange(fallbackModelIds.filter((_, i) => i !== index))}
              >
                移除
              </button>
            </li>
          ))}
        </ol>
      )}
      {fallbackModelIds.length < 3 && (
        <select
          value=""
          disabled={disabled || available.length === 0}
          onChange={(event) => {
            if (!event.target.value) return;
            onChange([...fallbackModelIds, event.target.value]);
          }}
          className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs disabled:opacity-50"
        >
          <option value="">{available.length ? '添加降级模型…' : '无更多可用模型'}</option>
          {available.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      )}
    </div>
  );
}

function CreatePolicyForm({ canWrite, workspaceId, models, onSubmit }: { canWrite: boolean; workspaceId: string; models: ModelProvider['models']; onSubmit: (payload: Record<string, unknown>) => void }) {
  const available = models.filter((model) => model.status === 'available');
  const [level, setLevel] = useState<RoutingPolicyLevel>('P3');
  const [primaryModelId, setPrimary] = useState(available[0]?.id ?? '');
  const [fallbackModelIds, setFallbacks] = useState<string[]>([]);
  const [dataScope, setDataScope] = useState<'internal' | 'restricted'>('internal');
  const [egressAllowed, setEgress] = useState(false);
  const [budgetLimitUsd, setBudget] = useState('200');

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-[var(--bg)] px-3 py-2 text-[11px] leading-5 text-[var(--text-muted)]" style={{ boxShadow: 'var(--saas-ring)' }}>
        路由策略供数字伙伴与工作流引用已发布版本；本表单不接入供应商、不写入 API Key。
      </div>
      <Field label="业务等级">
        <select value={level} onChange={(event) => setLevel(event.target.value as RoutingPolicyLevel)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs">
          {(['P0', 'P1', 'P2', 'P3'] as const).map((item) => <option key={item} value={item}>{item} · {routingLevelPurpose(item)}</option>)}
        </select>
      </Field>
      <Field label="主模型">
        <select
          value={primaryModelId}
          onChange={(event) => {
            const next = event.target.value;
            setPrimary(next);
            setFallbacks((current) => current.filter((id) => id !== next));
          }}
          className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs"
        >
          {available.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </Field>
      <Field label="降级链（可选，按优先级）">
        <FallbackChainEditor
          models={models}
          primaryModelId={primaryModelId}
          fallbackModelIds={fallbackModelIds}
          onChange={setFallbacks}
          disabled={!canWrite}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="数据范围">
          <select
            value={dataScope}
            onChange={(event) => {
              const next = event.target.value as 'internal' | 'restricted';
              setDataScope(next);
              if (next === 'restricted') setEgress(false);
            }}
            className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs"
          >
            <option value="internal">内部</option>
            <option value="restricted">受限（禁止出境）</option>
          </select>
        </Field>
        <Field label="月度预算上限 (USD)">
          <Input inputMode="numeric" value={budgetLimitUsd} onChange={(event) => setBudget(event.target.value)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={egressAllowed} onChange={(event) => setEgress(event.target.checked)} disabled={dataScope === 'restricted'} />
        允许路由至境外部署
      </label>
      <div className="flex justify-end">
        <Button
          disabled={!canWrite || !primaryModelId}
          onClick={() => onSubmit({
            workspaceId,
            level,
            primaryModelId,
            fallbackModelIds,
            dataScope,
            egressAllowed: dataScope === 'restricted' ? false : egressAllowed,
            budgetLimitUsd: Number(budgetLimitUsd) || 0,
          })}
        >
          创建草稿
        </Button>
      </div>
    </div>
  );
}

function PolicyDetail({
  policy, models, versions, canWrite, focusTab, onFocusTabConsumed, onSave, onValidate, onPublish, onUnpublish, onRollback,
}: {
  policy: RoutingPolicyDraft;
  models: ModelProvider['models'];
  versions: RoutingPolicyVersion[];
  canWrite: boolean;
  focusTab?: 'draft' | 'validate' | 'versions' | null;
  onFocusTabConsumed?: () => void;
  onSave: (value: Record<string, unknown>) => void;
  onValidate: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onRollback: (versionId: string, label: string) => void;
}) {
  const [tab, setTab] = useState<'draft' | 'validate' | 'versions'>('draft');
  const [primaryModelId, setPrimary] = useState(policy.primaryModelId);
  const [fallbackModelIds, setFallbacks] = useState<string[]>([...policy.fallbackModelIds]);
  const [egressAllowed, setEgress] = useState(policy.egressAllowed);
  const [budgetLimitUsd, setBudget] = useState(String(policy.budgetLimitUsd));

  useEffect(() => {
    setPrimary(policy.primaryModelId);
    setFallbacks([...policy.fallbackModelIds]);
    setEgress(policy.egressAllowed);
    setBudget(String(policy.budgetLimitUsd));
  }, [
    policy.id,
    policy.primaryModelId,
    policy.egressAllowed,
    policy.budgetLimitUsd,
    policy.status,
    policy.fallbackModelIds.join('\0'),
  ]);

  useEffect(() => {
    if (!focusTab) return;
    setTab(focusTab);
    onFocusTabConsumed?.();
  }, [focusTab, onFocusTabConsumed]);

  const dirty = primaryModelId !== policy.primaryModelId
    || egressAllowed !== policy.egressAllowed
    || String(policy.budgetLimitUsd) !== budgetLimitUsd
    || fallbackModelIds.length !== policy.fallbackModelIds.length
    || fallbackModelIds.some((id, index) => id !== policy.fallbackModelIds[index]);

  const draftPayload = {
    id: policy.id,
    primaryModelId,
    fallbackModelIds,
    egressAllowed: policy.dataScope === 'restricted' ? false : egressAllowed,
    budgetLimitUsd: Number(budgetLimitUsd) || 0,
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[var(--bg)] p-3 text-[11px] leading-5 text-[var(--text-secondary)]" style={{ boxShadow: 'var(--saas-ring)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={policy.status === 'published' ? 'success' : policy.status === 'ready' ? 'warn' : 'neutral'}>{policyStatusLabel(policy.status)}</Badge>
          {dirty && <Badge tone="warn">有未保存修改</Badge>}
          <span>{routingDataScopeLabel(policy)}</span>
          <span className="font-mono text-[var(--text-muted)]">预算 ${policy.budgetLimitUsd.toLocaleString('en-US')}/月</span>
        </div>
        <p className="mt-1.5 text-[var(--text-muted)]">{routingLevelPurpose(policy.level)} · 下一步：{routingPolicyNextAction(policy.status)}</p>
      </div>

      {policy.status === 'published' && (
        <div className="rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--warning)]">
          当前已有已发布快照生效。此处编辑只改草稿，不会立刻影响线上路由；保存后须重新校验并发布新版本。若要退役引用中的供应商，请先取消发布。
        </div>
      )}

      <div className="flex gap-1 rounded-lg bg-[var(--bg-elevated)] p-1" role="tablist" aria-label="策略详情">
        {([
          ['draft', '草稿'],
          ['validate', '校验'],
          ['versions', '版本'],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={cn('flex-1 rounded-md px-2 py-1.5 text-xs font-medium', tab === key ? 'bg-[var(--bg)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)]')}>{label}</button>
        ))}
      </div>

      {tab === 'draft' && (
        <>
          <p className="text-[11px] text-[var(--text-muted)]">编辑草稿不会改写已发布快照。保存后状态回到草稿，需重新校验才能发布。</p>
          <Field label="主模型">
            <select
              value={primaryModelId}
              onChange={(event) => {
                const next = event.target.value;
                setPrimary(next);
                setFallbacks((current) => current.filter((id) => id !== next));
              }}
              disabled={!canWrite}
              className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs disabled:opacity-60"
            >
              {models.map((model) => <option key={model.id} value={model.id} disabled={model.status !== 'available'}>{model.name}</option>)}
            </select>
          </Field>
          <Field label="降级链">
            <FallbackChainEditor
              models={models}
              primaryModelId={primaryModelId}
              fallbackModelIds={fallbackModelIds}
              onChange={setFallbacks}
              disabled={!canWrite}
            />
          </Field>
          <Field label="月度预算上限 (USD)">
            <Input inputMode="numeric" value={budgetLimitUsd} onChange={(event) => setBudget(event.target.value)} disabled={!canWrite} />
          </Field>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={egressAllowed} onChange={(event) => setEgress(event.target.checked)} disabled={!canWrite || policy.dataScope === 'restricted'} />
            允许路由至境外部署
          </label>
          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button
              size="sm"
              disabled={!canWrite || !dirty || !primaryModelId}
              onClick={() => onSave(draftPayload)}
            >
              保存草稿
            </Button>
          </div>
        </>
      )}

      {tab === 'validate' && (
        <>
          <div className="rounded-lg bg-[var(--bg)] p-3 text-[11px] leading-5 text-[var(--text-muted)]" style={{ boxShadow: 'var(--saas-ring)' }}>
            闭环：保存草稿 → 校验 → 发布版本。校验检查主/降级模型可用、供应商未停用、出境与数据范围一致、降级链无环且不指向主模型。
          </div>
          {dirty && (
            <div className="rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-bg)] px-3 py-2 text-[11px] text-[var(--warning)]">
              草稿有未保存修改，请先回到「草稿」保存，再执行校验。
            </div>
          )}
          {policy.validationIssues.length > 0 ? (
            <div className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger)]">{policy.validationIssues.map((issue) => <div key={issue}>• {issue}</div>)}</div>
          ) : (
            <div className="rounded-lg border border-[var(--success)]/30 bg-[var(--success-bg)] p-3 text-xs text-[var(--success)]">
              {policy.status === 'ready' ? '校验已通过，可以发布版本。' : policy.status === 'published' ? '线上版本有效；若刚改过草稿，请保存后重新校验。' : '尚未执行校验，或保存后需重新校验。'}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
            {policy.status === 'published' ? (
              <Button size="sm" variant="outline" disabled={!canWrite} onClick={onUnpublish}>取消发布</Button>
            ) : null}
            <Button size="sm" variant="secondary" disabled={!canWrite || dirty} onClick={onValidate}><CheckCircle2 className="h-3.5 w-3.5" />校验</Button>
            <Button size="sm" disabled={!canWrite || dirty || policy.status !== 'ready'} onClick={onPublish}>发布版本</Button>
          </div>
        </>
      )}

      {tab === 'versions' && (
        <div>
          <div className="mb-2 text-xs font-semibold">版本历史</div>
          <p className="mb-2 text-[11px] text-[var(--text-muted)]">已发布快照不可改写；回滚会基于历史快照生成新版本，并需确认。</p>
          {versions.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">暂无已发布版本</p>
          ) : (
            <div className="space-y-2">
              {versions.map((version) => (
                <div key={version.id} className="flex items-center justify-between rounded-md border border-[var(--border)] p-2 text-xs">
                  <div className="min-w-0">
                    <div>v{version.version} · {new Date(version.publishedAt).toLocaleString('zh-CN')}{version.rollbackOf ? ' · 回滚生成' : ''}</div>
                    <div className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">
                      主 {models.find((m) => m.id === version.snapshot.primaryModelId)?.name ?? version.snapshot.primaryModelId}
                      {version.snapshot.fallbackModelIds.length ? ` · 降级 ${version.snapshot.fallbackModelIds.length} 级` : ''}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => onRollback(version.id, `v${version.version}`)}>以此回滚</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-[var(--text-secondary)]"><span className="mb-1 block">{label}</span>{children}</label>;
}
