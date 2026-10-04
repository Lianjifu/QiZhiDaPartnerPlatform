import { describe, expect, it } from 'vitest';
import {
  budgetRiskLabel,
  modelQueryState,
  normalizeProviderImpact,
  parseModelTab,
  visibleModelTabs,
  defaultModelTab,
  policyStatusLabel,
  providerLifecycleAction,
  providerStatusLabel,
  providerStatusTone,
  routingDataScopeLabel,
  routingLevelPurpose,
  routingPolicyNextAction,
  summarizeRoutingPolicies,
  budgetUtilizationPercent,
  governanceDrillEligibility,
  governanceDrillBlockReason,
  governanceBudgetBreakdown,
} from './model-ui';

describe('model control-plane UI state', () => {
  it('blocks destructive provider removal when published routes still reference it', () => {
    expect(providerLifecycleAction({ deletionAllowed: false })).toEqual({ disabled: true, label: '已被已发布路由引用' });
    expect(providerLifecycleAction(undefined)).toEqual({ disabled: true, label: '检查引用中…' });
    expect(providerLifecycleAction({ deletionAllowed: true })).toEqual({ disabled: false, label: '删除供应商' });
  });

  it('normalizes null routeReferences from qzda-core so detail drawers do not crash', () => {
    expect(normalizeProviderImpact({
      providerId: 'mp-23',
      deletionAllowed: true,
      routeReferences: null as unknown as [],
    })).toEqual({
      providerId: 'mp-23',
      deletionAllowed: true,
      routeReferences: [],
    });
  });

  it('surfaces ready policies as pending publication rather than published', () => {
    expect(policyStatusLabel('ready')).toBe('待发布');
    expect(policyStatusLabel('published')).toBe('已发布');
  });

  it('localizes provider lifecycle statuses', () => {
    expect(providerStatusLabel('standby')).toBe('待命');
    expect(providerStatusLabel('active')).toBe('可用');
    expect(providerStatusTone('active')).toBe('success');
    expect(providerStatusTone('standby')).toBe('warn');
  });

  it('parses model workspace tabs from URL with role-scoped visibility', () => {
    expect(parseModelTab('routing')).toBe('access');
    expect(parseModelTab('governance')).toBe('governance');
    expect(parseModelTab('unknown')).toBe('access');
    expect(parseModelTab(null)).toBe('access');
    expect(parseModelTab('audit')).toBe('access');
    expect(parseModelTab('audit', 'auditor')).toBe('audit');
    expect(parseModelTab('access', 'auditor')).toBe('audit');
    expect(visibleModelTabs('admin')).toEqual(['access', 'governance']);
    expect(visibleModelTabs('auditor')).toEqual(['audit']);
    expect(defaultModelTab('auditor')).toBe('audit');
  });

  it('maps budget risk labels for governance summary', () => {
    expect(budgetRiskLabel('normal')).toBe('正常');
    expect(budgetRiskLabel('attention')).toBe('关注');
  });

  it('does not present query failures as empty model-control-plane data', () => {
    expect(modelQueryState({ isLoading: false, isError: true, data: [], errorDetail: 'E_NETWORK: 无法连接' })).toEqual({
      kind: 'error',
      label: '模型控制面数据读取失败',
      detail: '无法连接',
    });
    expect(modelQueryState({ isLoading: false, isError: false, data: [] })).toEqual({
      kind: 'empty',
      label: '暂无模型控制面数据',
      detail: undefined,
    });
  });

  it('explains routing level purpose and next lifecycle action', () => {
    expect(routingLevelPurpose('P0')).toContain('降级');
    expect(routingPolicyNextAction('draft')).toBe('校验草稿');
    expect(routingPolicyNextAction('ready')).toBe('发布版本');
    expect(routingPolicyNextAction('published')).toBe('可取消发布 / 调整需重校验');
    expect(routingDataScopeLabel({ dataScope: 'restricted', egressAllowed: false })).toBe('受限 · 禁止出境');
  });

  it('detects published-route references for list delete affordance', async () => {
    const { providerReferencedByPublishedPolicies } = await import('./model-ui');
    expect(providerReferencedByPublishedPolicies(
      { id: 'p1', models: [{ id: 'm1' } as any] },
      [{ status: 'published', primaryModelId: 'm1', fallbackModelIds: [] }],
    )).toBe(true);
    expect(providerReferencedByPublishedPolicies(
      { id: 'p1', models: [{ id: 'm1' } as any] },
      [{ status: 'draft', primaryModelId: 'm1', fallbackModelIds: [] }],
    )).toBe(false);
  });

  it('summarizes routing policy counts for workspace KPIs', () => {
    expect(summarizeRoutingPolicies([
      { id: 'a', workspaceId: 'w1', level: 'P0', primaryModelId: 'm1', fallbackModelIds: ['m2'], dataScope: 'internal', egressAllowed: true, budgetLimitUsd: 100, status: 'published', validationIssues: [] },
      { id: 'b', workspaceId: 'w1', level: 'P1', primaryModelId: 'm1', fallbackModelIds: [], dataScope: 'internal', egressAllowed: false, budgetLimitUsd: 50, status: 'draft', validationIssues: [] },
      { id: 'c', workspaceId: 'w1', level: 'P2', primaryModelId: 'm1', fallbackModelIds: [], dataScope: 'restricted', egressAllowed: false, budgetLimitUsd: 20, status: 'ready', validationIssues: [] },
    ])).toEqual({ published: 1, draft: 1, ready: 1, withFallback: 1, total: 3 });
  });

  it('computes budget utilization and drill eligibility for governance', () => {
    expect(budgetUtilizationPercent(420, 1000)).toBe(42);
    expect(budgetUtilizationPercent(10, 0)).toBeNull();
    const eligibility = governanceDrillEligibility([
      { id: 'a', workspaceId: 'w1', level: 'P0', primaryModelId: 'm1', fallbackModelIds: ['m2'], dataScope: 'internal', egressAllowed: true, budgetLimitUsd: 100, status: 'published', validationIssues: [] },
      { id: 'b', workspaceId: 'w1', level: 'P3', primaryModelId: 'm1', fallbackModelIds: [], dataScope: 'restricted', egressAllowed: false, budgetLimitUsd: 20, status: 'published', validationIssues: [] },
      { id: 'c', workspaceId: 'w1', level: 'P0', primaryModelId: 'm1', fallbackModelIds: ['m2'], dataScope: 'internal', egressAllowed: true, budgetLimitUsd: 100, status: 'superseded', validationIssues: [] },
    ]);
    expect(eligibility.count).toBe(1);
    expect(eligibility.total).toBe(2);
    expect(eligibility.ready).toBe(true);
    expect(eligibility.blocked).toHaveLength(1);
    expect(eligibility.blocked[0]?.reason).toContain('降级链');
    expect(eligibility.drillable.map((item) => item.id)).toEqual(['a']);
  });

  it('explains why a published policy cannot be drilled', () => {
    expect(governanceDrillBlockReason({
      status: 'published',
      fallbackModelIds: [],
      level: 'P3',
    })).toContain('P3');
    expect(governanceDrillBlockReason({
      status: 'published',
      fallbackModelIds: ['m2'],
      level: 'P0',
    })).toBeNull();
  });

  it('breaks down governance budget without counting superseded policies', () => {
    expect(governanceBudgetBreakdown([
      { status: 'published', budgetLimitUsd: 200 },
      { status: 'draft', budgetLimitUsd: 100 },
      { status: 'superseded', budgetLimitUsd: 200 },
    ])).toEqual({ publishedUsd: 200, draftUsd: 100, effectiveUsd: 200, planningUsd: 300 });
  });
});
