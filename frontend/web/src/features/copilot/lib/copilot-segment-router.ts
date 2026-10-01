/**
 * 纯函数：Copilot 多段 SSE 事件 → 分段状态（便于单测与 useChat 复用）
 */
import type { CopilotSSEEvent } from './copilot-stream';

export type SegmentDraft = {
  id: string;
  content: string;
  status: 'streaming' | 'succeeded' | 'failed';
};

export type SegmentRouterState = {
  defaultId: string;
  segments: Map<string, SegmentDraft>;
};

export function createSegmentRouter(defaultId: string): SegmentRouterState {
  const segments = new Map<string, SegmentDraft>();
  segments.set(defaultId, { id: defaultId, content: '', status: 'streaming' });
  return { defaultId, segments };
}

/** 思考/工具轨迹始终挂在首段（占位 replyId），不随 message_start 漂移。 */
export function thoughtHostId(state: SegmentRouterState): string {
  return state.defaultId;
}

export function ensureSegment(state: SegmentRouterState, messageId?: string): string {
  const mid = (messageId && messageId.trim()) || state.defaultId;
  if (!state.segments.has(mid)) {
    state.segments.set(mid, { id: mid, content: '', status: 'streaming' });
  }
  return mid;
}

export type SegmentEventResult =
  | { kind: 'noop' }
  | { kind: 'start'; messageId: string; isNew: boolean }
  | { kind: 'delta'; messageId: string; text: string; content: string }
  | { kind: 'done'; messageId: string; content?: string }
  | { kind: 'finalize_all' };

export function applySegmentSSEEvent(
  state: SegmentRouterState,
  data: Partial<CopilotSSEEvent>,
): SegmentEventResult {
  const typ = data.type ?? '';
  if (typ === 'message_start' && data.messageId) {
    const isNew = !state.segments.has(data.messageId) && data.messageId !== state.defaultId;
    ensureSegment(state, data.messageId);
    return { kind: 'start', messageId: data.messageId, isNew };
  }
  if (typ === 'message_delta' && data.text) {
    const mid = ensureSegment(state, data.messageId ?? state.defaultId);
    const prev = state.segments.get(mid)?.content ?? '';
    const content = prev + data.text;
    state.segments.set(mid, { id: mid, content, status: 'streaming' });
    return { kind: 'delta', messageId: mid, text: data.text, content };
  }
  if (typ === 'message_done' && data.messageId) {
    const mid = ensureSegment(state, data.messageId);
    const cur = state.segments.get(mid);
    const finalContent = typeof data.content === 'string'
      ? data.content
      : typeof data.text === 'string'
        ? data.text
        : cur?.content ?? '';
    state.segments.set(mid, { id: mid, content: finalContent, status: 'succeeded' });
    return { kind: 'done', messageId: mid, content: finalContent };
  }
  if (typ === 'delta' && data.text) {
    const mid = ensureSegment(state, data.messageId ?? state.defaultId);
    const prev = state.segments.get(mid)?.content ?? '';
    const content = prev + data.text;
    state.segments.set(mid, { id: mid, content, status: 'streaming' });
    return { kind: 'delta', messageId: mid, text: data.text, content };
  }
  if (typ === 'done') {
    for (const [id, seg] of state.segments) {
      if (seg.status === 'streaming') {
        state.segments.set(id, { ...seg, status: 'succeeded' });
      }
    }
    return { kind: 'finalize_all' };
  }
  return { kind: 'noop' };
}

export function segmentIds(state: SegmentRouterState): string[] {
  return [...state.segments.keys()];
}
