/**
 * 模型中心控制器 hook（M08 P1 拆分）。
 *
 * 原 pages/Models.tsx 中全部 useState / query / mutation / handler / useEffect
 * 收拢至本文件；组件文件只消费返回的 controller，不再持有业务状态。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from '@qzda/web-ui';
import type {
  ModelAuditEvent, ModelGovernanceSnapshot, ModelProvider,
  ProviderImpact, RoutingPolicyDraft, RoutingPolicyVersion,
} from '@qzda/web-types';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  modelQueryState,
  normalizeModelProviders, normalizeProviderImpact,
  normalizeRoutingPolicies, parseModelTab,
  summarizeRoutingPolicies, governanceDrillEligibility,
  visibleModelTabs, defaultModelTab,
  type ModelWorkspaceTab,
} from '@/features/models/model-ui';
import { resolveAppRole } from '@/features/role-nav/role-nav';
import type { LastDrillResult } from './ModelsShared';

export type ModelsController = ReturnType<typeof useModelsController>;

export function useModelsController(options?: { providerId?: string }) {
  const { user } = useAuthStore();
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId ?? 'w1');
  const canWrite = Boolean(user?.permissions.includes('model.write'));
  const isAuditor = resolveAppRole(user?.role) === 'auditor';
  const visibleTabs = useMemo(() => visibleModelTabs(user?.role), [user?.role]);
  const scopeKey = `${currentWorkspaceId}:${user?.id ?? 'anonymous'}`;
  const [searchParams, setSearchParams] = useSearchParams();
  const workspace = parseModelTab(searchParams.get('tab'), user?.role);

  // 模态层状态
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
  const [lastDrillResult, setLastDrillResult] = useState<LastDrillResult>(null);

  // 服务端数据查询
  const modelQueryOpts = { staleTime: 0, refetchOnMount: 'always' as const };
  const providersQuery = useApiQuery<ModelProvider[]>(['model-providers', scopeKey], '/api/model-providers', undefined, { ...modelQueryOpts, enabled: !isAuditor });
  const policiesQuery = useApiQuery<RoutingPolicyDraft[]>(['model-routing-policies', scopeKey], '/api/model-routing/policies', undefined, { ...modelQueryOpts, enabled: !isAuditor });
  const governanceQuery = useApiQuery<ModelGovernanceSnapshot>(['model-governance', scopeKey], '/api/model-governance/overview', undefined, { ...modelQueryOpts, enabled: !isAuditor });
  const auditQuery = useApiQuery<ModelAuditEvent[]>(['model-audit', scopeKey], '/api/model-audit', undefined, modelQueryOpts);
  const providers = useMemo(() => normalizeModelProviders(providersQuery.data), [providersQuery.data]);
  const policies = useMemo(() => normalizeRoutingPolicies(policiesQuery.data), [policiesQuery.data]);
  const focusedProviderId = options?.providerId
    ?? (providerModal && providerModal !== 'new' ? providerModal : undefined);
  const activeProvider = focusedProviderId ? providers.find((item) => item.id === focusedProviderId) : undefined;
  const impactQuery = useApiQuery<ProviderImpact>(['model-provider-impact', scopeKey, focusedProviderId], `/api/model-providers/${focusedProviderId ?? '__none__'}/impact`, undefined, { enabled: Boolean(focusedProviderId) });
  const activeImpact = useMemo(() => normalizeProviderImpact(impactQuery.data), [impactQuery.data]);
  const versionsQuery = useApiQuery<RoutingPolicyVersion[]>(['model-policy-versions', scopeKey, policyDrawer], `/api/model-routing/policies/${policyDrawer ?? '__none__'}/versions`, undefined, { enabled: Boolean(policyDrawer) });

  // 服务端写入 mutations
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

  // 派生数据
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
  const routingSummary = summarizeRoutingPolicies(policies);
  const auditSuccessCount = auditEvents.filter((event) => event.result === 'success').length;
  const auditFailedCount = auditEvents.filter((event) => event.result === 'failed').length;
  const budgetTone: 'success' | 'warn' = governanceQuery.data?.budgetRisk === 'normal' ? 'success' : 'warn';

  // 错误反馈 + 刷新
  const reportError = useCallback((error: unknown) => toast.error(error instanceof Error ? error.message.replace(/^E_[A-Z_]+:\s*/, '') : '模型控制面操作失败'), []);
  const refetchControlPlane = useCallback(() => {
    if (isAuditor) { void auditQuery.refetch(); return; }
    void providersQuery.refetch();
    void policiesQuery.refetch();
    void governanceQuery.refetch();
    void auditQuery.refetch();
  }, [isAuditor, providersQuery, policiesQuery, governanceQuery, auditQuery]);

  // 工作区 tab 路由
  const setWorkspace = useCallback((tab: ModelWorkspaceTab) => {
    if (!visibleTabs.includes(tab)) return;
    if (tab === workspace) { refetchControlPlane(); return; }
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  }, [visibleTabs, workspace, refetchControlPlane, searchParams, setSearchParams]);
  const openPolicyFromGovernance = useCallback((policyId: string) => {
    setPolicyDrawer(policyId);
    setPolicyDetailTab('draft');
  }, []);

  // 自动修正非法 tab
  useEffect(() => {
    const raw = searchParams.get('tab');
    const resolved = parseModelTab(raw, user?.role);
    if (!raw || raw !== resolved) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', resolved);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, user?.role]);

  // tab / 作用域切换时强制刷新
  useEffect(() => {
    refetchControlPlane();
    // 仅在工作区 tab / 作用域变化时刷新；refetch 句柄随 query 稳定即可
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: tab/scope driven refresh
  }, [workspace, scopeKey]);

  // 默认演练策略
  useEffect(() => {
    if (!drillPolicyId && publishedPolicies[0]) setDrillPolicyId(publishedPolicies[0].id);
  }, [drillPolicyId, publishedPolicies]);

  return {
    // 角色 & 权限
    user, canWrite, isAuditor, visibleTabs, currentWorkspaceId, scopeKey,
    // 当前工作区
    workspace, setWorkspace, openPolicyFromGovernance,
    // 服务端数据
    providers, policies, models, governance: governanceQuery.data,
    auditEvents, filteredAudit, auditActions, auditSuccessCount, auditFailedCount,
    queryState, routingSummary, drillEligibility, budgetTone, refetchControlPlane, reportError,
    providersLoading: providersQuery.isLoading,
    // modal / drawer 状态与 setter
    providerModal, setProviderModal,
    activeProvider, activeImpact, impactQuery,
    policyDrawer, setPolicyDrawer, selectedPolicy,
    createPolicyOpen, setCreatePolicyOpen,
    createPolicyPayload, setCreatePolicyPayload,
    savePolicyDraft, setSavePolicyDraft,
    validatePolicyTarget, setValidatePolicyTarget,
    policyDetailTab, setPolicyDetailTab,
    publishPolicy, setPublishPolicy,
    unpublishPolicy, setUnpublishPolicy,
    deleteProvider, setDeleteProvider,
    rollbackTarget, setRollbackTarget,
    auditResultFilter, setAuditResultFilter,
    auditActionFilter, setAuditActionFilter,
    drillPolicyId, setDrillPolicyId,
    drillModalOpen, setDrillModalOpen,
    confirmDrillPolicyId, setConfirmDrillPolicyId,
    confirmDrillPolicy, lastDrillResult, setLastDrillResult,
    versions: versionsQuery.data ?? [],
    publishedPolicies,
    // mutations
    createProvider, updateProvider, testProvider, disableProvider, removeProvider,
    createPolicy, updatePolicy, validatePolicy, publish, unpublish, rollback, runDrill,
    // 单独 refetch 句柄（供 ConfirmDialog 触发副作用刷新）
    refetchAudit: auditQuery.refetch,
    refetchGovernance: governanceQuery.refetch,
  };
}
