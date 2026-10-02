/**
 * 路由策略相关弹层（M08 P1 拆分）。
 *
 * 原 pages/Models.tsx 中的 CreatePolicyForm + PolicyDetail + FallbackChainEditor
 * 拆出到本文件。
 */
import { useEffect, useState } from 'react';
import { Badge, Button, Input } from '@qzda/web-ui';
import type { ModelProvider, RoutingPolicyDraft, RoutingPolicyVersion } from '@qzda/web-types';
import {
  policyStatusLabel, routingDataScopeLabel, routingLevelPurpose, routingPolicyNextAction,
  type RoutingPolicyLevel,
} from '@/features/models/model-ui';
import { cn } from '@qzda/web-utils';
import { CheckCircle2 } from 'lucide-react';
import { Field } from './ModelsShared';

// ---------- CreatePolicyForm ----------

type CreatePolicyFormProps = {
  canWrite: boolean;
  workspaceId: string;
  models: ModelProvider['models'];
  onSubmit: (payload: Record<string, unknown>) => void;
};

export function ModelsModalsCreatePolicy({ canWrite, workspaceId, models, onSubmit }: CreatePolicyFormProps) {
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

// ---------- PolicyDetail ----------

type PolicyDetailProps = {
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
};

export function ModelsModalsPolicyDetail({
  policy, models, versions, canWrite, focusTab, onFocusTabConsumed,
  onSave, onValidate, onPublish, onUnpublish, onRollback,
}: PolicyDetailProps) {
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

// ---------- FallbackChainEditor ----------

type FallbackChainEditorProps = {
  models: ModelProvider['models'];
  primaryModelId: string;
  fallbackModelIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
};

export function FallbackChainEditor({ models, primaryModelId, fallbackModelIds, onChange, disabled }: FallbackChainEditorProps) {
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
