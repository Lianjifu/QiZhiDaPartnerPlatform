/**
 * sandbox 故障切换演练弹层（M08 P1 拆分）。
 *
 * 原 pages/Models.tsx 中的 FailoverDrillForm 拆出。
 */
import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@qzda/web-ui';
import type { ModelProvider, RoutingPolicyDraft } from '@qzda/web-types';
import { routingDataScopeLabel, routingLevelPurpose } from '@/features/models/model-ui';
import { modelNameById, type LastDrillResult, Field } from './ModelsShared';

type Props = {
  canWrite: boolean;
  models: ModelProvider['models'];
  publishedPolicies: RoutingPolicyDraft[];
  drillPolicyId: string;
  onDrillPolicyChange: (id: string) => void;
  pending: boolean;
  lastResult: LastDrillResult;
  onCancel: () => void;
  onRun: (policyId: string) => void;
};

export function ModelsModalsFailoverDrill({
  canWrite, models, publishedPolicies, drillPolicyId, onDrillPolicyChange,
  pending, lastResult, onCancel, onRun,
}: Props) {
  const byId = modelNameById(models);
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
