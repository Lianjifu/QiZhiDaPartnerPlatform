/**
 * 供应商详情弹层（M08 P1 拆分）。
 *
 * 查看态与编辑态共用同一套字段布局；查看只读、编辑可改。
 */
import { useEffect, useState } from 'react';
import { Download, Network, Pencil, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge, Button, Input, toast } from '@qzda/web-ui';
import type { ModelProvider, ProviderImpact } from '@qzda/web-types';
import { useApiMutation } from '@/services/query';
import {
  PROVIDER_CONNECT_PRESETS, applyProviderConnectProtocol, canDiscoverModels,
  canTestSavedProvider, draftFromProvider, getProviderConnectPreset,
  pickModelAfterDiscover, providerConnectToPayload, protocolLabel,
  validateProviderConnectDraft,
  type ProviderConnectDraft,
} from '@/features/models/provider-connect';
import { providerLifecycleAction, providerStatusLabel, providerStatusTone } from '@/features/models/model-ui';
import { cn } from '@qzda/web-utils';
import { Field, TIER_LABEL } from './ModelsShared';

type Props = {
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
  embedded?: boolean;
};

export function ModelsModalsProviderDetail({ provider, impact, canWrite, workspaceId, onClose, onSave, onTest, onDisable, onDelete, onOpenPolicy, embedded }: Props) {
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
  const viewing = mode === 'view';
  const fields = viewing ? viewPreset : preset;
  const show = (key: (typeof fields.fields)[number]) => fields.fields.includes(key);
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

  return (
    <div className="model-provider-detail">
      {statusBanner}
      {!viewing && (
        <p className="rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]">
          编辑中：修改仅在点击「保存配置」后生效；连通性验证请先保存，再回到查看态执行。
        </p>
      )}

      <div>
        <div className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">接入协议</div>
        <div className="flex flex-wrap gap-1.5">
          {PROVIDER_CONNECT_PRESETS.map((item) => {
            const active = (viewing ? provider.protocol : draft.protocol) === item.protocol;
            return (
              <button
                key={item.protocol}
                type="button"
                title={item.description}
                disabled={viewing}
                onClick={() => {
                  if (viewing) return;
                  setDraft((current) => applyProviderConnectProtocol(current, item.protocol));
                  setDiscovered([]);
                  setDiscoverHint(null);
                }}
                className={cn(
                  'rounded-lg px-2.5 py-1.5 text-[11px] transition-colors',
                  viewing && 'cursor-default',
                  active
                    ? 'bg-[var(--brand-light)] font-semibold text-[var(--brand)]'
                    : 'bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] disabled:hover:text-[var(--text-muted)]',
                )}
                style={active ? undefined : { boxShadow: 'var(--saas-ring)' }}
              >
                {item.shortLabel}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] leading-5 text-[var(--text-muted)]">{fields.hint}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="供应商名称">
          <Input
            className="h-9 text-xs"
            readOnly={viewing}
            value={viewing ? provider.name : draft.displayName}
            onChange={(event) => patch('displayName', event.target.value)}
          />
        </Field>
        <Field label="备注">
          <Input
            className="h-9 text-xs"
            readOnly={viewing}
            value={viewing ? (provider.note ?? '') : draft.note}
            onChange={(event) => patch('note', event.target.value)}
            placeholder={viewing ? '—' : '例如：公司专用账号（可选）'}
          />
        </Field>
      </div>

      {show('baseUrl') && (
        <Field label="API 请求地址">
          <Input
            className="h-9 font-mono text-xs"
            readOnly={viewing}
            value={viewing ? (provider.baseUrl || '') : draft.baseUrl}
            onChange={(event) => { patch('baseUrl', event.target.value); setDiscovered([]); }}
            placeholder="https://your-api-endpoint.com/v1"
          />
        </Field>
      )}

      <div className="rounded-xl bg-[var(--bg)] p-3 text-xs" style={{ boxShadow: 'var(--saas-ring)' }}>
        <div className="font-medium text-[var(--text)]">凭据引用</div>
        <div className="mt-1 font-mono text-[var(--text-muted)]">{provider.credentialRef} · {provider.credentialMasked}</div>
        {!viewing && (
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
        )}
      </div>

      {(show('deploymentName') || show('apiVersion')) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {show('deploymentName') && (
            <Field label="Deployment Name">
              <Input
                className="h-9 font-mono text-xs"
                readOnly={viewing}
                value={viewing ? (provider.deploymentName || '') : draft.deploymentName}
                onChange={(event) => patch('deploymentName', event.target.value)}
              />
            </Field>
          )}
          {show('apiVersion') && (
            <Field label="API Version">
              <Input
                className="h-9 font-mono text-xs"
                readOnly={viewing}
                value={viewing ? (provider.apiVersion || '') : draft.apiVersion}
                onChange={(event) => patch('apiVersion', event.target.value)}
              />
            </Field>
          )}
        </div>
      )}

      {show('modelId') && (
        <Field label="默认模型">
          <div className="flex gap-2">
            <Input
              className="h-9 flex-1 font-mono text-xs"
              list={viewing ? undefined : `provider-detail-models-${provider.id}`}
              readOnly={viewing}
              value={viewing ? ((provider.models ?? []).map((model) => model.name).join(' · ') || '') : draft.modelId}
              onChange={(event) => patch('modelId', event.target.value)}
              placeholder={preset.modelPlaceholder}
            />
            {!viewing && (
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
            )}
          </div>
          {!viewing && (
            <>
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
            </>
          )}
        </Field>
      )}

      {(show('organizationId') || show('region')) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {show('organizationId') && (
            <Field label="Organization ID（可选）">
              <Input
                className="h-9 font-mono text-xs"
                readOnly={viewing}
                value={viewing ? (provider.organizationId || '') : draft.organizationId}
                onChange={(event) => patch('organizationId', event.target.value)}
              />
            </Field>
          )}
          {show('region') && (
            <Field label="云区域 / 数据驻留">
              <Input
                className="h-9 text-xs"
                readOnly={viewing}
                value={viewing ? (provider.cloudRegion || '') : draft.region}
                onChange={(event) => patch('region', event.target.value)}
              />
            </Field>
          )}
        </div>
      )}

      {impactPanel}

      {viewing && !testGate.ok && (
        <div className="rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--warning)]">
          信息不足，无法验证连通性：{testGate.reason}
        </div>
      )}
      {!viewing && issues.length > 0 && (
        <div className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--danger)]">
          {issues.map((issue) => <div key={issue}>• {issue}</div>)}
        </div>
      )}

      {viewing ? (
        <div className="model-provider-detail__actions flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
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
            {!embedded && <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>}
            {canWrite && (
              <Button size="sm" onClick={enterEdit}>
                <Pencil className="h-3.5 w-3.5" />编辑配置
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="model-provider-detail__actions flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
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
      )}
    </div>
  );
}
