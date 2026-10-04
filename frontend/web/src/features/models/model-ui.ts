import type { ModelLevel, ModelProvider, ModelProviderStatus, ProviderImpact, RoutingPolicyDraft, RoutingPolicyStatus, Role } from '@qzda/web-types';
import { resolveAppRole } from '@/features/role-nav/role-nav';

export type ModelWorkspaceTab = 'access' | 'routing' | 'governance' | 'audit';
export type RoutingPolicyLevel = Exclude<ModelLevel, 'audit'>;

/** 管理员管接入/治理；路由策略在供应商接入向导与详情中维护；审计员只读模型审计。 */
export function visibleModelTabs(role?: Role | null): ModelWorkspaceTab[] {
  return resolveAppRole(role) === 'auditor' ? ['audit'] : ['access', 'governance'];
}

export function defaultModelTab(role?: Role | null): ModelWorkspaceTab {
  return resolveAppRole(role) === 'auditor' ? 'audit' : 'access';
}

export function parseModelTab(value: string | null | undefined, role?: Role | null): ModelWorkspaceTab {
  const visible = visibleModelTabs(role);
  if (visible.includes(value as ModelWorkspaceTab)) return value as ModelWorkspaceTab;
  return defaultModelTab(role);
}

/** 路由等级用途：调度优先级与可用性期望，不是会话里的模型选择器。 */
export function routingLevelPurpose(level: RoutingPolicyLevel): string {
  return ({
    P0: '关键链路 · 建议配置降级链',
    P1: '核心业务 · 主备可用优先',
    P2: '常规任务 · 成本与合规并重',
    P3: '低风险探索 · 可先单模型发布',
  } as const)[level];
}

export function routingDataScopeLabel(policy: Pick<RoutingPolicyDraft, 'dataScope' | 'egressAllowed'>): string {
  if (policy.dataScope === 'restricted') return '受限 · 禁止出境';
  return policy.egressAllowed ? '内部 · 可出境' : '内部 · 境内';
}

/** 列表「下一步」提示，驱动草稿→校验→发布闭环。 */
export function routingPolicyNextAction(status: RoutingPolicyStatus): string {
  return ({
    draft: '校验草稿',
    ready: '发布版本',
    published: '可取消发布 / 调整需重校验',
    superseded: '查看历史快照',
  } as const)[status];
}

/** Provider 是否被当前已发布策略引用（用于列表删除按钮）。 */
export function providerReferencedByPublishedPolicies(
  provider: Pick<ModelProvider, 'id' | 'models'>,
  policies: Array<Pick<RoutingPolicyDraft, 'status' | 'primaryModelId' | 'fallbackModelIds'>>,
) {
  const modelIds = new Set((provider.models ?? []).map((model) => model.id));
  return policies.some((policy) => {
    if (policy.status !== 'published') return false;
    if (modelIds.has(policy.primaryModelId)) return true;
    return policy.fallbackModelIds.some((id) => modelIds.has(id));
  });
}

export function summarizeRoutingPolicies(policies: RoutingPolicyDraft[]) {
  const published = policies.filter((item) => item.status === 'published').length;
  const draft = policies.filter((item) => item.status === 'draft').length;
  const ready = policies.filter((item) => item.status === 'ready').length;
  const withFallback = policies.filter((item) => item.status === 'published' && item.fallbackModelIds.length > 0).length;
  return { published, draft, ready, withFallback, total: policies.length };
}

/** 预算占用比例（0–100），用于治理页进度条；无上限时返回 null。 */
export function budgetUtilizationPercent(spendUsd: number, budgetUsd: number): number | null {
  if (budgetUsd <= 0) return null;
  return Math.min(100, Math.round((spendUsd / budgetUsd) * 100));
}

/** 已发布策略不可演练时的原因（有降级链则返回 null）。 */
export function governanceDrillBlockReason(policy: Pick<RoutingPolicyDraft, 'status' | 'fallbackModelIds' | 'level'>): string | null {
  if (policy.status !== 'published') return '仅已发布路由可演练';
  if (policy.fallbackModelIds.length === 0) {
    return policy.level === 'P3'
      ? '未配置降级链（P3 可先单模型发布，演练需至少一级备选）'
      : '未配置降级链，无法验证故障切流';
  }
  return null;
}

export function governanceDrillEligibility(policies: RoutingPolicyDraft[]) {
  const published = policies.filter((item) => item.status === 'published');
  const drillable = published.filter((item) => item.fallbackModelIds.length > 0);
  const blocked = published
    .filter((item) => item.fallbackModelIds.length === 0)
    .map((policy) => ({
      policy,
      reason: governanceDrillBlockReason(policy) ?? '不可演练',
    }));
  // total = 已发布条数；已替代不计入分母，避免「0/2」误导。
  return {
    drillable,
    blocked,
    count: drillable.length,
    total: published.length,
    ready: drillable.length > 0,
    guidance: drillable.length > 0
      ? `可对 ${drillable.length} 条已发布路由执行 sandbox 降级演练`
      : published.length === 0
        ? '暂无已发布路由；请先接入供应商并配置路由策略'
        : '已发布路由均无降级链；请到供应商详情或接入向导补齐备选后重新校验发布',
  };
}

/** 治理预算口径：占用上限=已发布；草稿仅作规划参考；已替代不计。 */
export function governanceBudgetBreakdown(policies: Array<Pick<RoutingPolicyDraft, 'status' | 'budgetLimitUsd'>>) {
  let publishedUsd = 0;
  let draftUsd = 0;
  for (const policy of policies) {
    if (policy.status === 'published') publishedUsd += policy.budgetLimitUsd;
    else if (policy.status === 'draft' || policy.status === 'ready') draftUsd += policy.budgetLimitUsd;
  }
  return {
    publishedUsd,
    draftUsd,
    /** 与强制限额 / 占用分母一致 */
    effectiveUsd: publishedUsd,
    planningUsd: publishedUsd + draftUsd,
  };
}

export function providerLifecycleAction(impact: Pick<ProviderImpact, 'deletionAllowed'> | null | undefined) {
  if (!impact) {
    return { disabled: true, label: '检查引用中…' };
  }
  return impact.deletionAllowed
    ? { disabled: false, label: '删除供应商' }
    : { disabled: true, label: '已被已发布路由引用' };
}

/** Normalize impact payload so null slices never crash the provider detail drawer. */
export function normalizeProviderImpact(impact: ProviderImpact | null | undefined): ProviderImpact | undefined {
  if (!impact) return undefined;
  return {
    ...impact,
    routeReferences: Array.isArray(impact.routeReferences) ? impact.routeReferences : [],
  };
}

export function policyStatusLabel(status: RoutingPolicyStatus) {
  return ({ draft: '草稿', ready: '待发布', published: '已发布', superseded: '已替代' } as const)[status];
}

export function providerStatusLabel(status: ModelProviderStatus) {
  return ({
    draft: '草稿',
    standby: '待命',
    active: '可用',
    disabled: '已停用',
    offline: '离线',
  } as const)[status];
}

export function providerStatusTone(status: ModelProviderStatus): 'success' | 'warn' | 'error' | 'neutral' | 'info' {
  if (status === 'active') return 'success';
  if (status === 'standby' || status === 'draft') return 'warn';
  if (status === 'disabled' || status === 'offline') return 'error';
  return 'neutral';
}

export function budgetRiskLabel(risk: string) {
  return ({ normal: '正常', attention: '关注', critical: '告警' } as const)[risk as 'normal' | 'attention' | 'critical'] ?? risk;
}

export function modelQueryState({
  isLoading,
  isError,
  data,
  errorDetail,
}: {
  isLoading: boolean;
  isError: boolean;
  data?: readonly unknown[];
  errorDetail?: string;
}) {
  if (isLoading) return { kind: 'loading' as const, label: '正在读取模型控制面数据', detail: undefined as string | undefined };
  if (isError) {
    return {
      kind: 'error' as const,
      label: '模型控制面数据读取失败',
      detail: errorDetail?.replace(/^E_[A-Z0-9_]+:\s*/, '') || '请确认粗粒度控制面已启动（cd backend && make run），然后重新读取。',
    };
  }
  if (data && data.length === 0) return { kind: 'empty' as const, label: '暂无模型控制面数据', detail: undefined as string | undefined };
  return { kind: 'ready' as const, label: '', detail: undefined as string | undefined };
}

/** Normalize provider/policy payloads from control plane (null slices → []). */
export function normalizeModelProviders<T extends { models?: readonly unknown[] | null }>(providers: T[] | null | undefined): T[] {
  return (providers ?? []).map((provider) => ({
    ...provider,
    models: Array.isArray(provider.models) ? provider.models : [],
  }));
}

export function normalizeRoutingPolicies<T extends { fallbackModelIds?: readonly string[] | null; validationIssues?: readonly string[] | null }>(
  policies: T[] | null | undefined,
): Array<T & { fallbackModelIds: string[]; validationIssues: string[] }> {
  return (policies ?? []).map((policy) => ({
    ...policy,
    fallbackModelIds: Array.isArray(policy.fallbackModelIds) ? [...policy.fallbackModelIds] : [],
    validationIssues: Array.isArray(policy.validationIssues) ? [...policy.validationIssues] : [],
  }));
}
