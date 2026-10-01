/**
 * Copilot「运行配置 · 模型」：仅展示当前工作区真实供应商模型，
 * 不再回退演示别名（sonnet-4 等）。
 */
export type CopilotModelOption = {
  key: string;
  label: string;
  tier: string;
  tone: 'success' | 'brand' | 'warn' | 'neutral';
  desc: string;
  /** 传给 Cap / Collab 的模型标识（优先供应商内模型 id） */
  modelId: string;
  /** 调用上游 API 时的模型名（如 deepseek-v4-flash） */
  apiModel?: string;
  providerId?: string;
  providerName?: string;
  contextWindow?: number;
  status?: string;
};

type ProviderLike = {
  id: string;
  name?: string;
  status?: string;
  protocol?: string;
  models?: Array<{
    id: string;
    name?: string;
    status?: string;
    capabilities?: string[];
    contextWindow?: number;
  }>;
};

type PolicyLike = {
  id: string;
  level?: string;
  status?: string;
  primaryModelId?: string;
  fallbackModelIds?: string[];
};

const DEMO_MODEL_ALIASES = new Set(['sonnet-4', 'haiku-4.5', 'opus-4.8', 'gpt-5', 'deepseek-r2']);

export function isDemoCopilotModelKey(key: string | undefined | null): boolean {
  if (!key) return true;
  return DEMO_MODEL_ALIASES.has(key.toLowerCase());
}

function isChatModel(model: NonNullable<ProviderLike['models']>[number]): boolean {
  if (model.status && model.status !== 'available') return false;
  const caps = model.capabilities ?? [];
  if (caps.length === 0) return true;
  return caps.some((c) => /chat|reasoning|vision|code/i.test(c)) && !caps.every((c) => /embed/i.test(c));
}

function tierTone(level: string): CopilotModelOption['tone'] {
  if (level.startsWith('P0')) return 'success';
  if (level === 'P1') return 'brand';
  if (level === 'P2') return 'warn';
  return 'neutral';
}

function providerShortName(provider: ProviderLike): string {
  const raw = (provider.name || provider.protocol || 'provider').trim();
  const first = raw.split(/[\s·/_-]+/)[0] || raw;
  return first.toLowerCase();
}

function formatCtx(ctx?: number): string {
  if (!ctx || ctx <= 0) return '';
  const k = Math.round(ctx / 1000);
  return k > 0 ? `${k}k ctx` : '';
}

/** 将供应商与已发布路由合并为 Copilot 可选模型列表（无供应商时返回空）。 */
export function buildCopilotModelOptions(
  providers: ProviderLike[] | null | undefined,
  policies: PolicyLike[] | null | undefined,
): CopilotModelOption[] {
  const published = (policies ?? []).filter((p) => p.status === 'published');
  const modelTier = new Map<string, string>();
  for (const pol of published) {
    const level = pol.level || 'P1';
    if (pol.primaryModelId) modelTier.set(pol.primaryModelId, level);
    for (const id of pol.fallbackModelIds ?? []) {
      if (id && !modelTier.has(id)) modelTier.set(id, level);
    }
  }

  const out: CopilotModelOption[] = [];
  const seen = new Set<string>();
  for (const provider of providers ?? []) {
    if (provider.status === 'disabled') continue;
    for (const model of provider.models ?? []) {
      if (!isChatModel(model)) continue;
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      const tier = modelTier.get(model.id) || '—';
      const apiModel = model.name || model.id;
      const ctx = formatCtx(model.contextWindow);
      const short = providerShortName(provider);
      out.push({
        key: model.id,
        modelId: model.id,
        apiModel,
        label: apiModel,
        tier,
        tone: tierTone(tier),
        desc: ctx ? `${short} · ${ctx}` : short,
        providerId: provider.id,
        providerName: provider.name,
        contextWindow: model.contextWindow,
        status: provider.status,
      });
    }
  }

  out.sort((a, b) => {
    const ap = a.tier.startsWith('P') ? 0 : 1;
    const bp = b.tier.startsWith('P') ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.label.localeCompare(b.label, 'zh');
  });
  return out;
}

export function defaultCopilotModelKey(options: CopilotModelOption[]): string {
  const active = options.find((m) => m.status === 'active' && (m.tier === 'P0' || m.tier === 'P0+'));
  if (active) return active.key;
  const p0 = options.find((m) => m.tier === 'P0' || m.tier === 'P0+');
  if (p0) return p0.key;
  const anyActive = options.find((m) => m.status === 'active' || m.status === 'standby');
  return (anyActive ?? options[0])?.key ?? '';
}

/** 将数字伙伴装配的模型/路由名解析为运行配置 key。 */
export function matchCopilotModelKey(
  options: CopilotModelOption[],
  bound: string | undefined | null,
): string | null {
  const name = (bound ?? '').trim();
  if (!name || !options.length) return null;
  const hit = options.find(
    (m) =>
      m.key === name ||
      m.modelId === name ||
      m.apiModel === name ||
      m.label === name ||
      m.providerName === name ||
      (m.tier !== '—' && `${m.tier} 路由` === name) ||
      (m.desc && m.desc.startsWith(name)),
  );
  return hit?.key ?? null;
}

/** 解析发送用的 modelId：优先选项 id，其次 api 名。 */
export function resolveCopilotModelId(option: CopilotModelOption | undefined, fallbackKey: string): string {
  return option?.modelId || option?.apiModel || fallbackKey;
}

/** 发送时最终 modelId：运行配置显式选择 > 员工装配 > 回退。 */
export function resolveSendModelId(opts: {
  runModelId: string;
  runKey: string;
  employeeBoundModel?: string | null;
  options: CopilotModelOption[];
}): string {
  const { runModelId, runKey, employeeBoundModel, options } = opts;
  if (runKey && !isDemoCopilotModelKey(runKey) && runModelId && !isDemoCopilotModelKey(runModelId)) {
    return runModelId;
  }
  const empKey = matchCopilotModelKey(options, employeeBoundModel);
  if (empKey) {
    const opt = options.find((m) => m.key === empKey);
    return resolveCopilotModelId(opt, empKey);
  }
  if (employeeBoundModel?.trim()) {
    return employeeBoundModel.trim();
  }
  if (runModelId && !isDemoCopilotModelKey(runModelId)) return runModelId;
  if (runKey && !isDemoCopilotModelKey(runKey)) return runKey;
  return options[0] ? resolveCopilotModelId(options[0], options[0].key) : '';
}
