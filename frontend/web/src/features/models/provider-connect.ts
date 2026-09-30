import type { ModelConnectProtocol, ProviderTier } from '@qzda/web-types';

export type ProviderConnectFieldKey =
  | 'displayName'
  | 'baseUrl'
  | 'apiKey'
  | 'modelId'
  | 'deploymentName'
  | 'apiVersion'
  | 'organizationId'
  | 'region';

export type ProviderConnectPreset = {
  protocol: ModelConnectProtocol;
  label: string;
  shortLabel: string;
  description: string;
  defaultTier: ProviderTier;
  defaultName: string;
  defaultBaseUrl: string;
  defaultModelId: string;
  defaultRegion: string;
  defaultApiVersion?: string;
  credentialLabel: string;
  credentialPlaceholder: string;
  modelLabel: string;
  modelPlaceholder: string;
  fields: ProviderConnectFieldKey[];
  hint: string;
};

export type ProviderConnectDraft = {
  protocol: ModelConnectProtocol;
  displayName: string;
  note: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  deploymentName: string;
  apiVersion: string;
  organizationId: string;
  region: string;
};

export const PROVIDER_CONNECT_PRESETS: ProviderConnectPreset[] = [
  {
    protocol: 'openai_compatible',
    label: 'OpenAI 兼容',
    shortLabel: 'OpenAI',
    description: 'OpenAI / 兼容网关（DeepSeek、Groq、vLLM、OneAPI 等）',
    defaultTier: 'official',
    defaultName: 'OpenAI Compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModelId: 'gpt-4o',
    defaultRegion: 'global',
    credentialLabel: 'API Key',
    credentialPlaceholder: 'sk-…',
    modelLabel: '模型 ID',
    modelPlaceholder: 'gpt-4o / deepseek-chat',
    fields: ['displayName', 'baseUrl', 'apiKey', 'modelId', 'organizationId', 'region'],
    hint: '适用于官方 OpenAI 及 OpenAI-Compatible 代理；Base URL 需包含 /v1。',
  },
  {
    protocol: 'azure_openai',
    label: 'Azure OpenAI',
    shortLabel: 'Azure',
    description: 'Azure OpenAI 资源：Endpoint + Deployment + API Version',
    defaultTier: 'official',
    defaultName: 'Azure OpenAI',
    defaultBaseUrl: 'https://{resource}.openai.azure.com',
    defaultModelId: 'gpt-4o',
    defaultRegion: 'eastasia',
    defaultApiVersion: '2024-10-21',
    credentialLabel: 'API Key',
    credentialPlaceholder: 'Azure 资源密钥',
    modelLabel: '模型映射名',
    modelPlaceholder: '用于路由展示的模型名',
    fields: ['displayName', 'baseUrl', 'apiKey', 'deploymentName', 'apiVersion', 'modelId', 'region'],
    hint: 'Endpoint 填资源域名；Deployment Name 为门户中的部署名；API Version 需与资源一致。',
  },
  {
    protocol: 'anthropic',
    label: 'Anthropic',
    shortLabel: 'Claude',
    description: 'Anthropic Messages API（Claude 系列）',
    defaultTier: 'official',
    defaultName: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModelId: 'claude-sonnet-4-20250514',
    defaultRegion: 'us-west-2',
    credentialLabel: 'API Key',
    credentialPlaceholder: 'sk-ant-…',
    modelLabel: '模型 ID',
    modelPlaceholder: 'claude-sonnet-4-…',
    fields: ['displayName', 'baseUrl', 'apiKey', 'modelId', 'region'],
    hint: '企业代理可覆盖 Base URL；生产密钥须写入 KMS/Vault，客户端仅保留引用。',
  },
  {
    protocol: 'dashscope',
    label: '通义千问',
    shortLabel: 'DashScope',
    description: '阿里云 DashScope / 通义千问兼容模式',
    defaultTier: 'official',
    defaultName: 'DashScope',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModelId: 'qwen-max',
    defaultRegion: 'cn-hangzhou',
    credentialLabel: 'API Key',
    credentialPlaceholder: 'sk-…',
    modelLabel: '模型 ID',
    modelPlaceholder: 'qwen-max / qwen-plus',
    fields: ['displayName', 'baseUrl', 'apiKey', 'modelId', 'region'],
    hint: '国内数据驻留建议选择 cn-* 区域；兼容模式 Base URL 已预填。',
  },
  {
    protocol: 'ollama',
    label: 'Ollama / 本地',
    shortLabel: 'Ollama',
    description: '本地或内网 OpenAI 兼容推理服务',
    defaultTier: 'self_hosted',
    defaultName: 'Ollama',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    defaultModelId: 'qwen2.5:72b',
    defaultRegion: 'cn-east-1',
    credentialLabel: 'API Key（可选）',
    credentialPlaceholder: '本地服务可填 ollama',
    modelLabel: '模型名',
    modelPlaceholder: 'qwen2.5:72b',
    fields: ['displayName', 'baseUrl', 'apiKey', 'modelId', 'region'],
    hint: '自部署服务可不强制密钥；请确保仅内网可达并纳入零信任策略。',
  },
  {
    protocol: 'custom',
    label: '自定义',
    shortLabel: '自定义',
    description: '其他 OpenAI 风格或企业私有网关',
    defaultTier: 'connectable',
    defaultName: '自定义模型服务',
    defaultBaseUrl: '',
    defaultModelId: '',
    defaultRegion: 'cn-east-1',
    credentialLabel: 'API Key',
    credentialPlaceholder: '一次性密钥，提交后不回显',
    modelLabel: '模型 ID',
    modelPlaceholder: '部署或路由标识',
    fields: ['displayName', 'baseUrl', 'apiKey', 'modelId', 'region'],
    hint: '用于尚未内置的供应商；仍按 write-only 凭据引用接入。',
  },
];

export function getProviderConnectPreset(protocol: ModelConnectProtocol) {
  return PROVIDER_CONNECT_PRESETS.find((item) => item.protocol === protocol) ?? PROVIDER_CONNECT_PRESETS[0];
}

export function createProviderConnectDraft(protocol: ModelConnectProtocol = 'openai_compatible'): ProviderConnectDraft {
  const preset = getProviderConnectPreset(protocol);
  return {
    protocol,
    displayName: preset.defaultName,
    note: '',
    baseUrl: preset.defaultBaseUrl,
    apiKey: '',
    modelId: preset.defaultModelId,
    deploymentName: protocol === 'azure_openai' ? 'gpt-4o' : '',
    apiVersion: preset.defaultApiVersion ?? '',
    organizationId: '',
    region: preset.defaultRegion,
  };
}

export function draftFromProvider(provider: {
  name: string;
  note?: string;
  protocol?: ModelConnectProtocol;
  tier?: ProviderTier;
  baseUrl?: string;
  apiVersion?: string;
  organizationId?: string;
  deploymentName?: string;
  cloudRegion: string;
  models: Array<{ name: string }>;
}): ProviderConnectDraft {
  const protocol = provider.protocol
    ?? (provider.tier === 'self_hosted' ? 'ollama' : provider.tier === 'connectable' ? 'custom' : 'openai_compatible');
  const preset = getProviderConnectPreset(protocol);
  return {
    protocol,
    displayName: provider.name,
    note: provider.note ?? '',
    baseUrl: provider.baseUrl ?? preset.defaultBaseUrl,
    apiKey: '',
    modelId: provider.models[0]?.name ?? preset.defaultModelId,
    deploymentName: provider.deploymentName ?? (protocol === 'azure_openai' ? (provider.models[0]?.name ?? '') : ''),
    apiVersion: provider.apiVersion ?? preset.defaultApiVersion ?? '',
    organizationId: provider.organizationId ?? '',
    region: provider.cloudRegion || preset.defaultRegion,
  };
}

export function applyProviderConnectProtocol(draft: ProviderConnectDraft, protocol: ModelConnectProtocol): ProviderConnectDraft {
  const next = createProviderConnectDraft(protocol);
  return {
    ...next,
    apiKey: draft.apiKey,
    note: draft.note,
    displayName: draft.displayName && draft.displayName !== getProviderConnectPreset(draft.protocol).defaultName
      ? draft.displayName
      : next.displayName,
  };
}

export function resolveProviderCredential(
  draft: Pick<ProviderConnectDraft, 'apiKey'>,
  sessionCredential?: string,
): string {
  return draft.apiKey.trim() || sessionCredential?.trim() || '';
}

export function validateProviderConnectDraft(
  draft: ProviderConnectDraft,
  options: { requireApiKey?: boolean; sessionCredential?: string } = {},
): string[] {
  const preset = getProviderConnectPreset(draft.protocol);
  const requireApiKey = options.requireApiKey ?? true;
  const credential = resolveProviderCredential(draft, options.sessionCredential);
  const issues: string[] = [];
  if (!draft.displayName.trim()) issues.push('请填写供应商名称');
  if (preset.fields.includes('baseUrl') && !draft.baseUrl.trim()) issues.push('请填写 API 请求地址');
  if (requireApiKey && preset.fields.includes('apiKey')) {
    const optionalKey = draft.protocol === 'ollama';
    if (!optionalKey && !credential) issues.push(`请填写 ${preset.credentialLabel}`);
  }
  if (preset.fields.includes('modelId') && !draft.modelId.trim()) issues.push('请填写默认模型');
  if (preset.fields.includes('deploymentName') && !draft.deploymentName.trim()) issues.push('请填写 Deployment Name');
  if (preset.fields.includes('apiVersion') && !draft.apiVersion.trim()) issues.push('请填写 API Version');
  if (draft.baseUrl.trim() && !/^https?:\/\//i.test(draft.baseUrl.trim())) {
    issues.push('API 请求地址需以 http:// 或 https:// 开头');
  }
  return issues;
}

export function canDiscoverModels(
  draft: Pick<ProviderConnectDraft, 'protocol' | 'baseUrl' | 'apiKey' | 'deploymentName' | 'apiVersion'>,
  options: { allowStoredCredential?: boolean; sessionCredential?: string } = {},
) {
  return canTestConnectDraft(draft, options);
}

/** 连接测试 / 拉取模型：仅检查连通必需字段，不要求供应商名称等展示字段。 */
export function canTestConnectDraft(
  draft: Pick<ProviderConnectDraft, 'protocol' | 'baseUrl' | 'apiKey' | 'deploymentName' | 'apiVersion'>,
  options: { allowStoredCredential?: boolean; sessionCredential?: string } = {},
) {
  if (!draft.baseUrl.trim()) return { ok: false as const, reason: '请先填写 API 请求地址' };
  if (!/^https?:\/\//i.test(draft.baseUrl.trim())) return { ok: false as const, reason: 'API 请求地址格式无效' };
  const credential = resolveProviderCredential(draft, options.sessionCredential);
  if (draft.protocol !== 'ollama' && !credential && !options.allowStoredCredential) {
    return { ok: false as const, reason: '请先填写 API Key' };
  }
  if (draft.protocol === 'azure_openai') {
    if (!draft.deploymentName.trim()) return { ok: false as const, reason: '请先填写 Deployment Name' };
    if (!draft.apiVersion.trim()) return { ok: false as const, reason: '请先填写 API Version' };
  }
  return { ok: true as const };
}

/** 已保存供应商：用落库字段判断能否发起连通性验证（不依赖未保存草稿）。 */
export function canTestSavedProvider(provider: {
  protocol?: ModelConnectProtocol;
  baseUrl?: string;
  apiVersion?: string;
  deploymentName?: string;
  credentialRef?: string;
  credentialMasked?: string;
  tier?: ProviderTier;
}) {
  const protocol = provider.protocol
    ?? (provider.tier === 'self_hosted' ? 'ollama' : 'openai_compatible');
  const hasCredential = Boolean(
    (provider.credentialRef && provider.credentialRef.trim())
    || (provider.credentialMasked && !/^[*·.\s]*$/.test(provider.credentialMasked)),
  );
  return canTestConnectDraft(
    {
      protocol,
      baseUrl: provider.baseUrl ?? '',
      apiKey: '',
      deploymentName: provider.deploymentName ?? '',
      apiVersion: provider.apiVersion ?? '',
    },
    { allowStoredCredential: protocol === 'ollama' || hasCredential },
  );
}

/** Soft guidance when URL host and selected protocol look mismatched. */
export function protocolBaseUrlHint(protocol: ModelConnectProtocol, baseUrl: string): string | null {
  const u = baseUrl.trim().toLowerCase();
  if (!u) return null;
  if (protocol === 'anthropic' && u.includes('deepseek.com')) {
    return 'DeepSeek 请改用「OpenAI」协议；Base URL 推荐 https://api.deepseek.com 或 …/v1';
  }
  if (protocol === 'anthropic' && !u.includes('anthropic') && (u.includes('/v1') || u.includes('openai'))) {
    return '当前地址更像 OpenAI 兼容端点，建议切换到「OpenAI」协议后再拉取';
  }
  if (protocol === 'openai_compatible' && u.includes('anthropic.com')) {
    return '官方 Anthropic 地址请使用「Claude」协议';
  }
  return null;
}

export function pickModelAfterDiscover(
  currentModelId: string,
  models: Array<{ id: string; name: string }>,
): string {
  if (!models.length) return currentModelId;
  if (currentModelId && models.some((m) => m.id === currentModelId || m.name === currentModelId)) {
    return currentModelId;
  }
  return models[0].id;
}

export function providerConnectToPayload(draft: ProviderConnectDraft, workspaceId: string, options: { includeCredential?: boolean; sessionCredential?: string } = {}) {
  const preset = getProviderConnectPreset(draft.protocol);
  const includeCredential = options.includeCredential ?? true;
  const credential = resolveProviderCredential(draft, options.sessionCredential);
  const modelName = draft.protocol === 'azure_openai'
    ? (draft.modelId.trim() || draft.deploymentName.trim())
    : draft.modelId.trim();
  return {
    workspaceId,
    name: draft.displayName.trim(),
    note: draft.note.trim() || undefined,
    protocol: draft.protocol,
    tier: preset.defaultTier,
    baseUrl: draft.baseUrl.trim(),
    apiVersion: draft.apiVersion.trim() || undefined,
    organizationId: draft.organizationId.trim() || undefined,
    deploymentName: draft.deploymentName.trim() || undefined,
    model: modelName,
    region: draft.region.trim() || preset.defaultRegion,
    ...(includeCredential
      ? { credential: credential || (draft.protocol === 'ollama' ? 'ollama-local' : '') }
      : (credential ? { credential } : {})),
  };
}

export function protocolLabel(protocol?: ModelConnectProtocol) {
  if (!protocol) return '未标注协议';
  return getProviderConnectPreset(protocol).label;
}

/** Mock / 演示用：各协议可发现的模型目录。 */
export function catalogModelsForProtocol(protocol: ModelConnectProtocol): Array<{ id: string; name: string }> {
  const catalogs: Record<ModelConnectProtocol, Array<{ id: string; name: string }>> = {
    openai_compatible: [
      { id: 'gpt-4o', name: 'gpt-4o' },
      { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
      { id: 'gpt-4.1', name: 'gpt-4.1' },
      { id: 'o3-mini', name: 'o3-mini' },
      { id: 'deepseek-chat', name: 'deepseek-chat' },
      { id: 'deepseek-reasoner', name: 'deepseek-reasoner' },
    ],
    azure_openai: [
      { id: 'gpt-4o', name: 'gpt-4o' },
      { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
      { id: 'gpt-35-turbo', name: 'gpt-35-turbo' },
      { id: 'text-embedding-3-large', name: 'text-embedding-3-large' },
    ],
    anthropic: [
      { id: 'claude-sonnet-4-20250514', name: 'claude-sonnet-4-20250514' },
      { id: 'claude-opus-4-20250514', name: 'claude-opus-4-20250514' },
      { id: 'claude-haiku-4-20250514', name: 'claude-haiku-4-20250514' },
    ],
    dashscope: [
      { id: 'qwen-max', name: 'qwen-max' },
      { id: 'qwen-plus', name: 'qwen-plus' },
      { id: 'qwen-turbo', name: 'qwen-turbo' },
      { id: 'qwen2.5-72b-instruct', name: 'qwen2.5-72b-instruct' },
    ],
    ollama: [
      { id: 'qwen2.5:72b', name: 'qwen2.5:72b' },
      { id: 'llama3.1:70b', name: 'llama3.1:70b' },
      { id: 'deepseek-r1:32b', name: 'deepseek-r1:32b' },
    ],
    custom: [
      { id: 'default', name: 'default' },
      { id: 'chat', name: 'chat' },
      { id: 'embeddings', name: 'embeddings' },
    ],
  };
  return catalogs[protocol];
}
