/**
 * 会话消息合并：在线回合本地权威，空闲时按 id/clientMsgId upsert 服务端终态。
 */
import type { ChatMessageEx } from '@/hooks/types';
import { orderAssistantSegments } from './segment-message-order';
import { collapseDuplicateArtifactSegments } from './artifact-segment';

export type ConversationMergeReason =
  | 'apply'
  | 'skip_typing'
  | 'skip_streaming'
  | 'skip_local_ahead'
  | 'skip_empty_server';

export type ConversationMergeResult = {
  messages: ChatMessageEx[];
  reason: ConversationMergeReason;
  applied: boolean;
};

function messageKey(message: ChatMessageEx): string {
  return message.clientMsgId || message.serverMsgId || message.id;
}

/** 同一逻辑消息可能以 client / server / local id 多种形式出现。 */
function messageAliases(message: ChatMessageEx): string[] {
  const out = new Set<string>();
  if (message.clientMsgId) out.add(`c:${message.clientMsgId}`);
  if (message.serverMsgId) {
    out.add(`s:${message.serverMsgId}`);
    out.add(`i:${message.serverMsgId}`);
  }
  if (message.id) {
    out.add(`i:${message.id}`);
    out.add(`s:${message.id}`);
  }
  return [...out];
}

function mergeMessagePair(existing: ChatMessageEx, incoming: ChatMessageEx, preferIncoming: boolean): ChatMessageEx {
  // 本地灌入时：已有终态则不回退为 streaming 占位
  if (!preferIncoming && !isStreaming(existing) && isStreaming(incoming)) {
    return existing;
  }
  // 服务端灌入时：终态覆盖 streaming
  if (preferIncoming && isStreaming(existing) && !isStreaming(incoming)) {
    return {
      ...existing,
      ...incoming,
      clientMsgId: existing.clientMsgId || incoming.clientMsgId,
      serverMsgId: existing.serverMsgId || incoming.serverMsgId,
      id: incoming.id || incoming.serverMsgId || existing.serverMsgId || existing.id,
    };
  }
  if (isStreaming(existing) && !isStreaming(incoming)) {
    if (!preferIncoming) return existing;
  }
  if (isStreaming(incoming) && !isStreaming(existing)) {
    return incoming;
  }
  if (preferIncoming || stamp(incoming) >= stamp(existing)) {
    return {
      ...existing,
      ...incoming,
      clientMsgId: existing.clientMsgId || incoming.clientMsgId,
      serverMsgId: existing.serverMsgId || incoming.serverMsgId,
      id: incoming.id || incoming.serverMsgId || existing.serverMsgId || existing.id,
      cognitive: incoming.cognitive ?? existing.cognitive,
      turnMeta: incoming.turnMeta ?? existing.turnMeta,
      turnTasks: (incoming.turnTasks?.length ? incoming.turnTasks : existing.turnTasks),
      reasoningSteps: (incoming.reasoningSteps?.length ? incoming.reasoningSteps : existing.reasoningSteps),
    };
  }
  return existing;
}

/** 终态列表按 message.id 去重，避免 React key 冲突。 */
export function dedupeConversationMessages(messages: ChatMessageEx[]): ChatMessageEx[] {
  if (messages.length < 2) return messages;
  const byId = new Map<string, ChatMessageEx>();
  const order: string[] = [];
  for (const message of messages) {
    const existing = byId.get(message.id);
    if (!existing) {
      byId.set(message.id, message);
      order.push(message.id);
      continue;
    }
    byId.set(message.id, mergeMessagePair(existing, message, stamp(message) >= stamp(existing)));
  }
  return orderAssistantSegments(collapseDuplicateArtifactSegments(order.map((id) => byId.get(id)!)));
}

function isStreaming(message: ChatMessageEx): boolean {
  return message.status === 'streaming' || message.status === 'in_flight' || message.status === 'queued';
}

function stamp(message: ChatMessageEx): number {
  const raw = message.editedAt || message.createdAt;
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function sameText(a?: string, b?: string): boolean {
  return (a ?? '').trim() === (b ?? '').trim();
}

/** 折叠相邻重复回合（同用户文案 + 同助手 correlationId 或正文）。 */
export function collapseDuplicateTurns(messages: ChatMessageEx[]): ChatMessageEx[] {
  if (messages.length < 4) return messages;
  const out: ChatMessageEx[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const u1 = messages[i];
    const a1 = messages[i + 1];
    const u2 = messages[i + 2];
    const a2 = messages[i + 3];
    if (
      u1?.role === 'user'
      && a1?.role === 'assistant'
      && u2?.role === 'user'
      && a2?.role === 'assistant'
      && sameText(u1.content, u2.content)
      && (
        (u1.correlationId && u1.correlationId === u2.correlationId)
        || (u1.clientMsgId && u1.clientMsgId === u2.clientMsgId)
        || sameText(a1.content, a2.content)
        || (a1.correlationId && a1.correlationId === a2.correlationId)
      )
    ) {
      const keepAssistant = a2.status === 'succeeded' || (a1.status !== 'succeeded' && stamp(a2) >= stamp(a1))
        ? a2
        : a1;
      out.push(u1, keepAssistant);
      i += 3;
      continue;
    }
    out.push(u1);
  }
  return out;
}

/** 是否应跳过用服务端快照整表覆盖本地（在线回合保护）。 */
export function shouldSkipConversationHydrate(opts: {
  typing?: boolean;
  localMessages: ChatMessageEx[];
  serverMessages: ChatMessageEx[];
}): ConversationMergeReason | null {
  if (opts.typing) return 'skip_typing';
  if (opts.localMessages.some(isStreaming)) return 'skip_streaming';
  if (opts.serverMessages.length === 0 && opts.localMessages.length > 0) return 'skip_empty_server';
  if (opts.localMessages.length > opts.serverMessages.length) return 'skip_local_ahead';
  // 条数相同但本地末条更新更晚：乐观用户气泡尚未落库，禁止整表回滚
  if (opts.localMessages.length > 0 && opts.localMessages.length === opts.serverMessages.length) {
    const localMax = Math.max(0, ...opts.localMessages.map(stamp));
    const serverMax = Math.max(0, ...opts.serverMessages.map(stamp));
    if (localMax > serverMax) return 'skip_local_ahead';
  }
  return null;
}

/**
 * 按 id / clientMsgId upsert。
 * - 本地 streaming / in_flight 优先保留
 * - 其余以服务端正文与终态字段为准（工具调用、审批、metrics）
 */
export function mergeConversationMessages(
  local: ChatMessageEx[],
  server: ChatMessageEx[],
): ChatMessageEx[] {
  if (!server.length) return local;
  if (!local.length) return server;

  const byKey = new Map<string, ChatMessageEx>();
  const aliasToKey = new Map<string, string>();
  const order: string[] = [];

  const registerAliases = (canonicalKey: string, message: ChatMessageEx) => {
    for (const alias of messageAliases(message)) aliasToKey.set(alias, canonicalKey);
  };

  const resolveKey = (message: ChatMessageEx): string | undefined => {
    for (const alias of messageAliases(message)) {
      const mapped = aliasToKey.get(alias);
      if (mapped) return mapped;
    }
    return undefined;
  };

  const put = (message: ChatMessageEx, preferIncoming: boolean) => {
    const existingKey = resolveKey(message);
    const key = existingKey ?? messageKey(message);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, message);
      registerAliases(key, message);
      if (!existingKey) order.push(key);
      return;
    }
    const merged = mergeMessagePair(existing, message, preferIncoming);
    byKey.set(key, merged);
    registerAliases(key, merged);
  };

  for (const message of local) put(message, false);
  for (const message of server) put(message, true);

  return orderAssistantSegments(collapseDuplicateArtifactSegments(order.map((key) => byKey.get(key)!).filter(Boolean)));
}

export function resolveHydratedMessages(opts: {
  typing?: boolean;
  localMessages: ChatMessageEx[];
  serverMessages: ChatMessageEx[];
}): ConversationMergeResult {
  const skip = shouldSkipConversationHydrate(opts);
  if (skip) {
    return { messages: opts.localMessages, reason: skip, applied: false };
  }
  return {
    messages: orderAssistantSegments(collapseDuplicateTurns(mergeConversationMessages(opts.localMessages, opts.serverMessages))),
    reason: 'apply',
    applied: true,
  };
}
