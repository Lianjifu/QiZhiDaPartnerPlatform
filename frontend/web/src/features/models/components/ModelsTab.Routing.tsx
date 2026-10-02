/**
 * 模型中心 · 路由工作区（版本化路由策略列表）。
 *
 * M08 P1 拆分：原 pages/Models.tsx 中的 RoutingWorkspace 拆出。
 * 状态由 useModelsController 提供；本组件只消费控制器并渲染 UI。
 */
import { useState } from 'react';
import { Route } from 'lucide-react';
import { Badge } from '@qzda/web-ui';
import type { ModelProvider, RoutingPolicyDraft } from '@qzda/web-types';
import { cn } from '@qzda/web-utils';
import { EmptyState } from '@/components/shared';
import { policyStatusLabel, routingDataScopeLabel, routingLevelPurpose, routingPolicyNextAction } from '@/features/models/model-ui';
import { modelNameById } from './ModelsShared';

type Props = {
  policies: RoutingPolicyDraft[];
  models: ModelProvider['models'];
  description: string;
  onOpen: (id: string) => void;
};

export function ModelsTabRouting({ policies, models, description, onOpen }: Props) {
  const byId = modelNameById(models);
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
