import { describe, expect, it } from 'vitest';
import {
  applySegmentSSEEvent,
  createSegmentRouter,
  ensureSegment,
  segmentIds,
  thoughtHostId,
} from './copilot-segment-router';

describe('copilot-segment-router', () => {
  it('reuses default placeholder for first segment id', () => {
    const state = createSegmentRouter('m1');
    expect(ensureSegment(state, 'm1')).toBe('m1');
    expect(segmentIds(state)).toEqual(['m1']);
  });

  it('creates additional segments on message_start', () => {
    const state = createSegmentRouter('m1');
    const r = applySegmentSSEEvent(state, { type: 'message_start', messageId: 'm2', segmentIndex: 1 });
    expect(r).toEqual({ kind: 'start', messageId: 'm2', isNew: true });
    expect(segmentIds(state)).toEqual(['m1', 'm2']);
  });

  it('accumulates message_delta per messageId', () => {
    const state = createSegmentRouter('m1');
    applySegmentSSEEvent(state, { type: 'message_start', messageId: 'm1' });
    applySegmentSSEEvent(state, { type: 'message_delta', messageId: 'm1', text: '你好' });
    applySegmentSSEEvent(state, { type: 'message_start', messageId: 'm2' });
    applySegmentSSEEvent(state, { type: 'message_delta', messageId: 'm2', text: '第二段' });
    expect(state.segments.get('m1')?.content).toBe('你好');
    expect(state.segments.get('m2')?.content).toBe('第二段');
  });

  it('falls back to legacy delta without messageId', () => {
    const state = createSegmentRouter('m1');
    applySegmentSSEEvent(state, { type: 'delta', text: 'legacy' });
    expect(state.segments.get('m1')?.content).toBe('legacy');
  });

  it('finalize_all on done marks streaming segments succeeded', () => {
    const state = createSegmentRouter('m1');
    applySegmentSSEEvent(state, { type: 'message_delta', messageId: 'm1', text: 'a' });
    applySegmentSSEEvent(state, { type: 'message_start', messageId: 'm2' });
    applySegmentSSEEvent(state, { type: 'message_delta', messageId: 'm2', text: 'b' });
    applySegmentSSEEvent(state, { type: 'done', ok: true });
    expect(state.segments.get('m1')?.status).toBe('succeeded');
    expect(state.segments.get('m2')?.status).toBe('succeeded');
  });

  it('keeps thought host on default segment when adding segments', () => {
    const state = createSegmentRouter('m1');
    applySegmentSSEEvent(state, { type: 'message_start', messageId: 'm2', segmentIndex: 1 });
    expect(thoughtHostId(state)).toBe('m1');
  });

  it('message_done replaces content when provided', () => {
    const state = createSegmentRouter('m1');
    applySegmentSSEEvent(state, { type: 'message_delta', messageId: 'm1', text: '全文草稿' });
    applySegmentSSEEvent(state, { type: 'message_done', messageId: 'm1', content: '仅第一段' });
    expect(state.segments.get('m1')?.content).toBe('仅第一段');
    expect(state.segments.get('m1')?.status).toBe('succeeded');
  });
});
