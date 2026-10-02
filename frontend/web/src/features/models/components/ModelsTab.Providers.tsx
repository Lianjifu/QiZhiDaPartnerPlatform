/**
 * 模型中心 · 接入工作区（供应商列表 + CRUD 入口）。
 *
 * M08 P1 拆分：原 pages/Models.tsx 中的 AccessWorkspace 拆出。
 * 状态由 useModelsController 提供；本组件只消费控制器并渲染 UI。
 */
import { FileKey2, Trash2 } from 'lucide-react';
import { Badge } from '@qzda/web-ui';
import type { ModelProvider, RoutingPolicyDraft } from '@qzda/web-types';
import { EmptyState } from '@/components/shared';
import { providerReferencedByPublishedPolicies, providerStatusLabel, providerStatusTone } from '@/features/models/model-ui';
import { protocolLabel } from '@/features/models/provider-connect';
import { TIER_LABEL } from './ModelsShared';
import type { ModelsController } from './useModelsController';

type Props = {
  c: ModelsController;
  description: string;
  canWrite: boolean;
  providers: ModelProvider[];
  policies: RoutingPolicyDraft[];
  onSelect: (id: string) => void;
  onDelete: (provider: ModelProvider) => void;
};

export function ModelsTabProviders({ c: _c, description, canWrite, providers, policies, onSelect, onDelete }: Props) {
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
          <EmptyState icon={FileKey2} title="暂无供应商" description="接入后可验证连通性并供路由策略引用。" />
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
                  <div className="mt-1.5 text-[11px] leading-5 text-[var(--text-secondary)]">
                    {provider.models.map((model) => model.name).join(' · ') || '未配置模型'}
                  </div>
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
