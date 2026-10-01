/**
 * Composer 上下文占用：最近一轮 promptTokens / 模型 contextWindow
 */
export type ContextUsageInput = {
  /** 最近助手消息 metrics.promptTokens */
  promptTokens?: number | null;
  /** 会话累计（可选兜底） */
  sessionTokens?: number | null;
  /** 当前模型窗口 */
  contextWindow?: number | null;
  /** 草稿字符（无 metrics 时估算） */
  draftChars?: number;
  /** 历史消息字符估算 */
  historyChars?: number;
};

export type ContextUsage = {
  used: number;
  max: number;
  percent: number;
  estimated: boolean;
  /** 各部分 token 估算占比；只有估算模式可能有真实值 */
  breakdown?: {
    system: number;
    skills: number;
    history: number;
    attachments: number;
    draft: number;
  };
};

const CHARS_PER_TOKEN = 1 / 0.6;

export function estimateTokensFromChars(chars: number): number {
  if (!chars || chars <= 0) return 0;
  return Math.max(1, Math.round(chars * 0.6));
}

export function computeContextUsage(input: ContextUsageInput): ContextUsage {
  const max = input.contextWindow && input.contextWindow > 0 ? input.contextWindow : 0;
  const prompt = typeof input.promptTokens === 'number' && input.promptTokens > 0
    ? input.promptTokens
    : 0;
  const session = typeof input.sessionTokens === 'number' && input.sessionTokens > 0
    ? input.sessionTokens
    : 0;

  if (prompt > 0 && max > 0) {
    return {
      used: prompt,
      max,
      percent: Math.min(100, (prompt / max) * 100),
      estimated: false,
    };
  }
  if (session > 0 && max > 0) {
    return {
      used: session,
      max,
      percent: Math.min(100, (session / max) * 100),
      estimated: false,
    };
  }

  const chars = (input.historyChars ?? 0) + (input.draftChars ?? 0);
  const estimated = estimateTokensFromChars(chars);
  if (max > 0) {
    return {
      used: estimated,
      max,
      percent: Math.min(100, (estimated / max) * 100),
      estimated: true,
    };
  }
  // 无窗口时仍给一个相对草稿的百分比（相对 4k 字估算上限），避免空白
  const fallbackMax = Math.max(estimateTokensFromChars(4000), 1);
  return {
    used: estimated,
    max: fallbackMax,
    percent: Math.min(100, (estimated / fallbackMax) * 100),
    estimated: true,
  };
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

void CHARS_PER_TOKEN;
