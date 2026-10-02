/**
 * 模型中心 · 治理工作区（运行健康 + 预算占用 + sandbox 演练）。
 *
 * M08 P1 拆分：原 pages/Models.tsx 中的 GovernanceWorkspace 拆出。
 * 状态由 useModelsController 提供；本组件只消费控制器并渲染 UI。
 */
import { Badge } from '@qzda/web-ui';
import type { ModelGovernanceSnapshot, ModelProvider, RoutingPolicyDraft } from '@qzda/web-types';
import { cn } from '@qzda/web-utils';
import {
  budgetRiskLabel, budgetUtilizationPercent, governanceBudgetBreakdown,
  governanceDrillEligibility, routingDataScopeLabel,
} from '@/features/models/model-ui';
import { FlaskConical, Route } from 'lucide-react';
import { modelNameById, type LastDrillResult } from './ModelsShared';

type Props = {
  canWrite: boolean;
  snapshot?: ModelGovernanceSnapshot;
  models: ModelProvider['models'];
  policies: RoutingPolicyDraft[];
  description: string;
  lastDrillResult: LastDrillResult;
  onOpenDrill: (policyId?: string) => void;
  onGoRouting: () => void;
  onConfigurePolicy: (policyId: string) => void;
};

export function ModelsTabGovernance({ canWrite, snapshot, models, policies, description, lastDrillResult, onOpenDrill, onGoRouting, onConfigurePolicy }: Props) {
  const byId = modelNameById(models);
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
