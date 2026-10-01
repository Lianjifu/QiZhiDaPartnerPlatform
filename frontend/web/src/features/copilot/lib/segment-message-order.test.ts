import { describe, expect, it } from 'vitest';
import { orderAssistantSegments } from './segment-message-order';
import type { ChatMessageEx } from '@/hooks/types';

describe('orderAssistantSegments', () => {
  it('sorts assistant segments by segmentIndex within the same correlation', () => {
    const messages: ChatMessageEx[] = [
      { id: 'u1', role: 'user', content: 'hi', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'a3', role: 'assistant', content: '第三段', correlationId: 'c1', segmentIndex: 2, createdAt: '2026-01-01T00:00:02Z' },
      { id: 'a1', role: 'assistant', content: '第一段', correlationId: 'c1', segmentIndex: 0, createdAt: '2026-01-01T00:00:01Z' },
      { id: 'a2', role: 'assistant', content: '第二段', correlationId: 'c1', segmentIndex: 1, createdAt: '2026-01-01T00:00:01Z' },
    ];
    const ordered = orderAssistantSegments(messages);
    expect(ordered.map((m) => m.id)).toEqual(['u1', 'a1', 'a2', 'a3']);
  });
});
