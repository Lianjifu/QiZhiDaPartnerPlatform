/**
 * Composer 协作模式：问答 / 方案 / 执行
 * 产品层 runMode → 现有 ABI sessionMode + modeHint + 工具门禁
 */
import type { CopilotToolDef } from './expert-tools';
import {
  approvalToolKeys,
  defaultEnabledToolKeys,
  ensureDefaultSkillsEnabled,
  isOfficeDocumentTool,
  toolsForExecuteMode,
} from './expert-tools';

export type RunMode = 'ask' | 'plan' | 'agent';
export type ReasoningEffort = 'off' | 'standard' | 'deep';
// Composer 协作控件：回复方式统一为「分段」一种，不再提供切换。
// 旧的 `single | segmented | stepwise` 三选一 UI 已移除，ReplyMode
// 字段保留仅为兼容服务端已持久化的 session.replyMode。
export type ReplyMode = 'segmented';
export const DEFAULT_REPLY_MODE: ReplyMode = 'segmented';

export const RUN_MODE_OPTIONS: Array<{
  value: RunMode;
  label: string;
  hint: string;
}> = [
  { value: 'ask', label: '问答', hint: '只回答，不改系统' },
  { value: 'plan', label: '方案', hint: '先出计划，确认后再做' },
  { value: 'agent', label: '执行', hint: '直接处理并调用工具' },
];

export const REASONING_EFFORT_OPTIONS: Array<{
  value: ReasoningEffort;
  label: string;
}> = [
  { value: 'off', label: '关' },
  { value: 'standard', label: '标准' },
  { value: 'deep', label: '深度' },
];

export const DEFAULT_RUN_MODE: RunMode = 'plan';
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'standard';

const ASK_READ_TOOL_RE = /retrieve|recall|skill\.read|time\.now|read_file|glob|grep|^builtin:(knowledge|memory|skill|time)/i;

export function parseRunMode(v: unknown): RunMode | null {
  if (v === 'ask' || v === 'plan' || v === 'agent') return v;
  return null;
}

export function parseReasoningEffort(v: unknown): ReasoningEffort | null {
  if (v === 'off' || v === 'standard' || v === 'deep') return v;
  return null;
}

/** 从会话已有字段恢复产品模式（无 runMode 时由 sessionMode 推导） */
export function deriveRunMode(opts: {
  runMode?: string | null;
  sessionMode?: string | null;
}): RunMode {
  const parsed = parseRunMode(opts.runMode);
  if (parsed) return parsed;
  return opts.sessionMode === 'execute' ? 'agent' : DEFAULT_RUN_MODE;
}

export function defaultReasoningForRunMode(mode: RunMode): ReasoningEffort {
  return mode === 'ask' ? 'off' : DEFAULT_REASONING_EFFORT;
}

export function deriveReasoningEffort(opts: {
  reasoningEffort?: string | null;
  runMode?: RunMode;
}): ReasoningEffort {
  const parsed = parseReasoningEffort(opts.reasoningEffort);
  if (parsed) return parsed;
  return defaultReasoningForRunMode(opts.runMode ?? DEFAULT_RUN_MODE);
}

export type RunModeDispatch = {
  sessionMode: 'investigate' | 'execute';
  modeHint: string;
  enabledTools: string[];
  enableApprovalTools?: string[];
};

/** 将产品 runMode 映射为发送所需的治理字段与工具列表 */
export function mapRunModeToDispatch(
  mode: RunMode,
  available: CopilotToolDef[],
  currentEnabled?: string[],
): RunModeDispatch {
  const readOnly = available.filter((t) => !t.unavailable && !t.requiresApproval);
  const askKeys = readOnly
    .filter((t) => ASK_READ_TOOL_RE.test(t.key) || ASK_READ_TOOL_RE.test(t.name))
    .map((t) => t.key);

  switch (mode) {
    case 'ask':
      return {
        sessionMode: 'investigate',
        modeHint: 'direct',
        enabledTools: askKeys.length ? askKeys : [],
      };
    case 'plan': {
      const filtered = (currentEnabled ?? []).filter((k) => {
        const t = available.find((x) => x.key === k);
        if (!t || t.unavailable) return false;
        if (!t.requiresApproval) return true;
        return isOfficeDocumentTool(t);
      });
      return {
        sessionMode: 'investigate',
        modeHint: 'plan_exec',
        enabledTools: filtered.length
          ? ensureDefaultSkillsEnabled(filtered, available)
          : defaultEnabledToolKeys(available),
      };
    }
    case 'agent': {
      const base = currentEnabled?.length
        ? ensureDefaultSkillsEnabled(currentEnabled, available)
        : defaultEnabledToolKeys(available);
      return {
        sessionMode: 'execute',
        modeHint: 'react',
        enabledTools: toolsForExecuteMode(base, available),
        enableApprovalTools: approvalToolKeys(available),
      };
    }
  }
}

export function runModeLabel(mode: RunMode): string {
  return RUN_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? mode;
}

export function reasoningEffortLabel(effort: ReasoningEffort): string {
  return REASONING_EFFORT_OPTIONS.find((o) => o.value === effort)?.label ?? effort;
}
