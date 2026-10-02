/**
 * 模型中心模块共享类型、常量与小组件（M08 P1 拆分）。
 *
 * 拆分原因：原 pages/Models.tsx 2273L（M08 P1 整合），按 D1 决策拆为 11 个子文件；
 * 此处集中共享部分，避免每个 tab / modal 文件重复声明。
 */
import type { ReactNode } from 'react';
import type { ModelProvider, ProviderTier } from '@qzda/web-types';

export type DiscoverModelsResult = {
  models: Array<{ id: string; name: string }>;
  source?: 'remote' | 'catalog';
  suggestedProtocol?: string;
  resolvedUrl?: string;
};

export const TIER_LABEL: Record<ProviderTier, string> = {
  official: '官方 API',
  self_hosted: '自部署',
  connectable: '可接入',
};

export type LastDrillResult = {
  policyId: string;
  fromModelId: string;
  toModelId: string;
  correlationId: string;
  status: string;
} | null;

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-medium text-[var(--text-secondary)]">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export function modelNameById(models: ModelProvider['models']) {
  return new Map(models.map((model) => [model.id, model.name]));
}
