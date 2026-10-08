/**
 * 供应商接入表单弹层（M08 P1 拆分）。
 *
 * 原 pages/Models.tsx 中的 ProviderForm 拆出；状态自管，父组件仅传：
 * - canWrite / workspaceId / creating / onCancel / onSubmit。
 * 凭据走 provider-connect 工具，session 内保存到 ref，不写入 React state。
 */
import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, RefreshCw } from 'lucide-react';
import { Badge, Button, Input, toast } from '@qzda/web-ui';
import { useApiMutation } from '@/services/query';
import {
  PROVIDER_CONNECT_PRESETS, applyProviderConnectProtocol, canDiscoverModels,
  canTestConnectDraft, createProviderConnectDraft, getProviderConnectPreset,
  pickModelAfterDiscover, protocolBaseUrlHint, providerConnectToPayload,
  resolveProviderCredential, validateProviderConnectDraft,
  type ProviderConnectDraft,
} from '@/features/models/provider-connect';
import { cn } from '@qzda/web-utils';
import { Field, type DiscoverModelsResult } from './ModelsShared';

type Props = {
  canWrite: boolean;
  workspaceId: string;
  creating?: boolean;
  embedded?: boolean;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>, onDone: (ok: boolean) => void) => void;
};

export function ModelsModalsProviderForm({ canWrite, workspaceId, creating, embedded, onCancel, onSubmit }: Props) {
  const [draft, setDraft] = useState<ProviderConnectDraft>(() => createProviderConnectDraft('openai_compatible'));
  const sessionCredentialRef = useRef('');
  const [credentialVerified, setCredentialVerified] = useState(false);
  const [discovered, setDiscovered] = useState<Array<{ id: string; name: string }>>([]);
  const [discoverHint, setDiscoverHint] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [probeResult, setProbeResult] = useState<null | {
    ok: boolean;
    title: string;
    detail?: string;
    latencyMs?: number;
    suggestProtocol?: string;
  }>(null);
  const preset = getProviderConnectPreset(draft.protocol);
  const effectiveCredential = () => resolveProviderCredential(draft, sessionCredentialRef.current);
  const hasCredential = Boolean(effectiveCredential()) || draft.protocol === 'ollama';
  const credentialOptions = { sessionCredential: sessionCredentialRef.current };
  const issues = validateProviderConnectDraft(draft, credentialOptions);
  const discoverGate = hasCredential ? canDiscoverModels(draft, credentialOptions) : { ok: false as const, reason: '请先填写 API Key' };
  const testGate = hasCredential ? canTestConnectDraft(draft, credentialOptions) : { ok: false as const, reason: '请先填写 API Key' };
  const protocolHint = protocolBaseUrlHint(draft.protocol, draft.baseUrl);
  const discoverModels = useApiMutation<DiscoverModelsResult, Record<string, unknown>>(
    '/api/model-providers/discover-models',
  );
  const testConnection = useApiMutation<{ status: string; latencyMs?: number; suggestedProtocol?: string }, Record<string, unknown>>(
    '/api/model-providers/test-connection',
  );
  const rememberCredential = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    sessionCredentialRef.current = trimmed;
    setCredentialVerified(false);
  };
  const markCredentialVerified = () => {
    const resolved = effectiveCredential();
    if (resolved) sessionCredentialRef.current = resolved;
    setCredentialVerified(Boolean(resolved) || draft.protocol === 'ollama');
  };
  const patch = <K extends keyof ProviderConnectDraft>(key: K, value: ProviderConnectDraft[K]) => {
    if (key === 'apiKey' && typeof value === 'string') rememberCredential(value);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const show = (key: (typeof preset.fields)[number]) => preset.fields.includes(key);
  const discoverBody = () => ({
    workspaceId,
    protocol: draft.protocol,
    baseUrl: draft.baseUrl.trim(),
    credential: effectiveCredential(),
    apiKey: effectiveCredential(),
    apiVersion: draft.apiVersion || undefined,
    deploymentName: draft.deploymentName || undefined,
  });
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">接入协议</div>
        <div className="flex flex-wrap gap-1.5">
          {PROVIDER_CONNECT_PRESETS.map((item) => (
            <button
              key={item.protocol}
              type="button"
              title={item.description}
              onClick={() => {
                setDraft((current) => applyProviderConnectProtocol(current, item.protocol));
                setDiscovered([]);
                setDiscoverHint(null);
                setProbeResult(null);
              }}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-[11px] transition-colors',
                draft.protocol === item.protocol
                  ? 'bg-[var(--brand-light)] font-semibold text-[var(--brand)]'
                  : 'bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)]',
              )}
              style={draft.protocol === item.protocol ? undefined : { boxShadow: 'var(--saas-ring)' }}
            >
              {item.shortLabel}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-5 text-[var(--text-muted)]">{preset.hint}</p>
        {protocolHint && (
          <p className="mt-1.5 rounded-lg bg-[var(--warning-bg)] px-2.5 py-1.5 text-[11px] leading-5 text-[var(--warning)]">
            {protocolHint}
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="供应商名称">
          <Input className="h-9 text-xs" value={draft.displayName} onChange={(event) => patch('displayName', event.target.value)} placeholder="例如：Claude 官方" />
        </Field>
        <Field label="备注">
          <Input className="h-9 text-xs" value={draft.note} onChange={(event) => patch('note', event.target.value)} placeholder="例如：公司专用账号（可选）" />
        </Field>
      </div>

      {show('baseUrl') && (
        <Field label="API 请求地址">
          <Input
            className="h-9 font-mono text-xs"
            value={draft.baseUrl}
            onChange={(event) => {
              patch('baseUrl', event.target.value);
              setDiscovered([]);
              setProbeResult(null);
            }}
            placeholder="https://your-api-endpoint.com/v1"
          />
          <p className="mt-1.5 text-[11px] leading-5 text-[var(--text-muted)]">
            填写兼容该协议的服务器端点；OpenAI 兼容地址通常以 /v1 结尾。
          </p>
        </Field>
      )}

      {show('apiKey') && (
        <Field label={preset.credentialLabel}>
          <Input
            className="h-9 font-mono text-xs"
            type="password"
            value={draft.apiKey}
            onChange={(event) => {
              patch('apiKey', event.target.value);
              setProbeResult(null);
            }}
            placeholder={preset.credentialPlaceholder}
            autoComplete="new-password"
            name="provider-api-key"
            form="de-provider-secret"
          />
          <form id="de-provider-secret" className="hidden" aria-hidden="true" onSubmit={(event) => event.preventDefault()} />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            {credentialVerified && !draft.apiKey.trim()
              ? '凭据已通过连接测试，拉取模型与创建时无需重复填写。'
              : '只需填写这里；提交后写入凭据引用，不会回显明文。'}
          </p>
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {show('deploymentName') && (
          <Field label="Deployment Name">
            <Input className="h-9 font-mono text-xs" value={draft.deploymentName} onChange={(event) => patch('deploymentName', event.target.value)} placeholder="Azure 部署名" />
          </Field>
        )}
        {show('apiVersion') && (
          <Field label="API Version">
            <Input className="h-9 font-mono text-xs" value={draft.apiVersion} onChange={(event) => patch('apiVersion', event.target.value)} placeholder="2024-10-21" />
          </Field>
        )}
      </div>

      {show('modelId') && (
        <Field label="默认模型">
          <div className="flex gap-2">
            <Input
              className="h-9 flex-1 font-mono text-xs"
              list="provider-discovered-models"
              value={draft.modelId}
              onChange={(event) => patch('modelId', event.target.value)}
              placeholder={preset.modelPlaceholder}
            />
            <Button
              size="sm"
              variant="secondary"
              className="h-9 shrink-0 px-2.5"
              disabled={!canWrite || !discoverGate.ok || discoverModels.isPending}
              title={discoverGate.ok ? '从供应商端点真实拉取模型列表' : discoverGate.reason}
              loading={discoverModels.isPending}
              onClick={() => {
                setDiscoverHint(null);
                discoverModels.mutate(discoverBody(), {
                  onSuccess: (result) => {
                    markCredentialVerified();
                    const models = result.models ?? [];
                    setDiscovered(models);
                    setDraft((current) => ({
                      ...current,
                      modelId: pickModelAfterDiscover(current.modelId, models),
                    }));
                    const sourceHint = result.source === 'remote'
                      ? `已从供应商拉取 ${models.length} 个模型`
                      : `已获取 ${models.length} 个模型（目录回落，非实时）`;
                    const suggest = result.suggestedProtocol && result.suggestedProtocol !== draft.protocol
                      ? `；地址更像 ${result.suggestedProtocol}，可切换协议后重试`
                      : '';
                    setDiscoverHint(`${sourceHint}${suggest}。点选下方标签或继续手写。`);
                    toast.success(sourceHint);
                  },
                  onError: (error) => {
                    setDiscovered([]);
                    const message = error instanceof Error ? error.message.replace(/^E_[A-Z_]+:\s*/, '') : '拉取模型失败';
                    setDiscoverHint(message);
                    toast.error(message);
                  },
                });
              }}
            >
              <Download className="h-3.5 w-3.5" />拉取
            </Button>
          </div>
          <datalist id="provider-discovered-models">
            {discovered.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </datalist>
          <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
            {discoverHint ?? '点击「拉取」向供应商真实请求模型目录；点选标签即可填入默认模型。'}
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
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {show('organizationId') && (
          <Field label="Organization ID（可选）">
            <Input className="h-9 font-mono text-xs" value={draft.organizationId} onChange={(event) => patch('organizationId', event.target.value)} placeholder="org_…" />
          </Field>
        )}
        {show('region') && (
          <Field label="云区域 / 数据驻留">
            <Input className="h-9 text-xs" value={draft.region} onChange={(event) => patch('region', event.target.value)} placeholder="cn-east-1 / global" />
          </Field>
        )}
      </div>

      {probeResult && (
        <div
          role="status"
          className={cn(
            'rounded-lg px-3 py-2.5 text-[11px] leading-5',
            probeResult.ok
              ? 'bg-[var(--success-bg)] text-[var(--success)]'
              : 'bg-[var(--danger-bg)] text-[var(--danger)]',
          )}
        >
          <div className="flex items-start gap-2">
            {probeResult.ok
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={probeResult.ok ? 'success' : 'error'}>
                  {probeResult.ok ? '连接成功' : '连接失败'}
                </Badge>
                <strong className="text-xs font-semibold">{probeResult.title}</strong>
                {typeof probeResult.latencyMs === 'number' && (
                  <span className="font-mono text-[10px] opacity-90">延迟 {probeResult.latencyMs}ms</span>
                )}
              </div>
              {probeResult.detail && (
                <p className="text-[11px] leading-5 opacity-95">{probeResult.detail}</p>
              )}
              {probeResult.ok && probeResult.suggestProtocol && (
                <p className="rounded-md bg-[var(--warning-bg)] px-2 py-1 text-[var(--warning)]">
                  当前协议可连通，但地址更像 <code className="font-mono">{probeResult.suggestProtocol}</code>
                  ，建议切换后再创建，避免后续拉取/路由异常。
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {attempted && issues.length > 0 && (
        <div className="rounded-lg bg-[var(--danger-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--danger)]">
          {issues.map((issue) => <div key={issue}>• {issue}</div>)}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-3">
        {!embedded && <Button size="sm" variant="ghost" onClick={onCancel}>取消</Button>}
        <Button
          size="sm"
          variant="secondary"
          disabled={!canWrite || !testGate.ok || testConnection.isPending}
          loading={testConnection.isPending}
          title={testGate.ok ? '不落库，仅向供应商发起连通性探测' : testGate.reason}
          onClick={() => {
            if (!testGate.ok) return;
            setProbeResult(null);
            testConnection.mutate(discoverBody(), {
              onSuccess: (result) => {
                markCredentialVerified();
                const latencyMs = typeof result.latencyMs === 'number' ? result.latencyMs : undefined;
                const suggestProtocol = result.suggestedProtocol && result.suggestedProtocol !== draft.protocol
                  ? result.suggestedProtocol
                  : undefined;
                setProbeResult({
                  ok: true,
                  title: '供应商端点可达，鉴权通过',
                  latencyMs,
                  suggestProtocol,
                  detail: suggestProtocol
                    ? undefined
                    : '可继续创建受管接入；凭据仅保存在服务端。',
                });
                toast.success(latencyMs != null ? `连接测试通过（${latencyMs}ms）` : '连接测试通过');
              },
              onError: (error) => {
                const message = error instanceof Error ? error.message.replace(/^E_[A-Z_]+:\s*/, '') : '连接测试失败';
                setProbeResult({
                  ok: false,
                  title: '无法连通或鉴权失败',
                  detail: message,
                });
                toast.error(message);
              },
            });
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" />测试连接
        </Button>
        <Button
          size="sm"
          disabled={!canWrite || creating}
          loading={creating}
          onClick={() => {
            setAttempted(true);
            if (issues.length > 0) return;
            onSubmit(providerConnectToPayload(draft, workspaceId, { sessionCredential: sessionCredentialRef.current }), (ok) => {
              if (!ok) return;
              sessionCredentialRef.current = '';
              setCredentialVerified(false);
              patch('apiKey', '');
            });
          }}
        >
          {embedded ? '创建并进入路由策略' : '创建受管接入'}
        </Button>
      </div>
    </div>
  );
}
