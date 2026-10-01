import { describe, expect, it } from 'vitest';
import {
  collapseDuplicateTurns,
  dedupeConversationMessages,
  mergeConversationMessages,
  resolveHydratedMessages,
  shouldSkipConversationHydrate,
} from './conversation-merge';
import type { ChatMessageEx } from '@/hooks/types';

function msg(partial: Partial<ChatMessageEx> & Pick<ChatMessageEx, 'id' | 'role' | 'content'>): ChatMessageEx {
  return {
    createdAt: new Date().toISOString(),
    status: 'succeeded',
    ...partial,
  };
}

describe('conversation-merge', () => {
  it('skips hydrate while typing or streaming', () => {
    const local = [msg({ id: 'u1', role: 'user', content: 'hi' }), msg({ id: 'a1', role: 'assistant', content: '…', status: 'streaming' })];
    const server = [msg({ id: 'u1', role: 'user', content: 'hi' })];
    expect(shouldSkipConversationHydrate({ typing: true, localMessages: local, serverMessages: server })).toBe('skip_typing');
    expect(shouldSkipConversationHydrate({ localMessages: local, serverMessages: server })).toBe('skip_streaming');
  });

  it('skips when local is ahead of stale server snapshot', () => {
    const local = [
      msg({ id: 'u1', role: 'user', content: 'a' }),
      msg({ id: 'a1', role: 'assistant', content: 'b' }),
      msg({ id: 'u2', role: 'user', content: 'c' }),
    ];
    const server = [
      msg({ id: 'u1', role: 'user', content: 'a' }),
      msg({ id: 'a1', role: 'assistant', content: 'b' }),
    ];
    expect(shouldSkipConversationHydrate({ localMessages: local, serverMessages: server })).toBe('skip_local_ahead');
    const resolved = resolveHydratedMessages({ localMessages: local, serverMessages: server });
    expect(resolved.applied).toBe(false);
    expect(resolved.messages).toHaveLength(3);
  });

  it('merges server terminal state onto matching local messages', () => {
    const local = [
      msg({ id: 'u1', clientMsgId: 'c1', role: 'user', content: '直接生成' }),
      msg({ id: 'a-local', clientMsgId: 'c2', role: 'assistant', content: '部分', status: 'succeeded' }),
    ];
    const server = [
      msg({ id: 'srv-u', clientMsgId: 'c1', role: 'user', content: '直接生成' }),
      msg({
        id: 'srv-a',
        clientMsgId: 'c2',
        role: 'assistant',
        content: '完整回复',
        status: 'succeeded',
        toolCalls: [{ id: 't1', name: 'skill:pptx', args: {}, status: 'success' }],
      }),
    ];
    const merged = mergeConversationMessages(local, server);
    expect(merged).toHaveLength(2);
    expect(merged[1]?.content).toBe('完整回复');
    expect(merged[1]?.toolCalls?.[0]?.name).toBe('skill:pptx');
    expect(merged[1]?.id).toBe('srv-a');
  });

  it('keeps optimistic local-only user messages', () => {
    const local = [
      msg({ id: 'u1', role: 'user', content: 'old' }),
      msg({ id: 'u2', clientMsgId: 'new', role: 'user', content: 'new' }),
    ];
    const server = [msg({ id: 'u1', role: 'user', content: 'old' })];
    // local ahead → resolve skips; merge itself still preserves
    const merged = mergeConversationMessages(local, server);
    expect(merged.map((m) => m.content)).toEqual(['old', 'new']);
  });

  it('skips when local last stamp is newer at equal length', () => {
    const local = [
      msg({ id: 'u1', role: 'user', content: 'hi', createdAt: '2026-08-06T05:00:00.000Z' }),
      msg({ id: 'u2', role: 'user', content: 'new', createdAt: '2026-08-06T05:01:00.000Z' }),
    ];
    const server = [
      msg({ id: 'u1', role: 'user', content: 'hi', createdAt: '2026-08-06T05:00:00.000Z' }),
      msg({ id: 'a1', role: 'assistant', content: 'old reply', createdAt: '2026-08-06T05:00:30.000Z' }),
    ];
    expect(shouldSkipConversationHydrate({ localMessages: local, serverMessages: server })).toBe('skip_local_ahead');
  });

  it('collapses duplicate server id with local serverMsgId alias', () => {
    const local = [
      msg({ id: 'msg-4', role: 'assistant', content: 'cached', status: 'succeeded' }),
      msg({ id: 'm_local', serverMsgId: 'msg-4', clientMsgId: 'c1', role: 'assistant', content: 'streaming', status: 'streaming' }),
    ];
    const server = [
      msg({ id: 'msg-4', role: 'assistant', content: 'final from server', status: 'succeeded' }),
    ];
    const merged = mergeConversationMessages(local, server);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.content).toBe('final from server');
    expect(merged.map((m) => m.id)).toEqual(['msg-4']);
  });

  it('dedupes messages that share the same id', () => {
    const merged = dedupeConversationMessages([
      msg({ id: 'msg-4', role: 'user', content: 'a' }),
      msg({ id: 'msg-4', role: 'assistant', content: 'b' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.content).toBe('b');
  });

  it('collapses adjacent duplicate turns with same user text', () => {
    const merged = collapseDuplicateTurns([
      msg({ id: 'u1', clientMsgId: 'c1', role: 'user', content: '生成 Word' }),
      msg({ id: 'a1', correlationId: 'corr1', role: 'assistant', content: '旧', status: 'cancelled' }),
      msg({ id: 'u2', clientMsgId: 'c1', role: 'user', content: '生成 Word' }),
      msg({ id: 'a2', correlationId: 'corr2', role: 'assistant', content: '新文档', status: 'succeeded' }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[1]?.content).toBe('新文档');
  });

  it('merges duplicate artifact segments after server hydrate', () => {
    const href = '/api/skill-artifacts/x-模板.docx';
    const local = [
      msg({ id: 'u1', role: 'user', content: '生成模板' }),
      msg({ id: 'body-local', correlationId: 'c1', role: 'assistant', content: '已完成生成。' }),
      msg({ id: 'art-local', correlationId: 'c1', role: 'assistant', content: `下载链接：${href}` }),
    ];
    const server = [
      msg({ id: 'u1', role: 'user', content: '生成模板' }),
      msg({ id: 'body-srv', correlationId: 'c1', role: 'assistant', content: '已完成生成。' }),
      msg({ id: 'art-srv', correlationId: 'c1', role: 'assistant', segmentKind: 'artifact', content: `下载链接：${href}` }),
    ];
    const resolved = resolveHydratedMessages({ localMessages: local, serverMessages: server });
    expect(resolved.applied).toBe(true);
    const assistants = resolved.messages.filter((m) => m.role === 'assistant');
    expect(assistants.length).toBeLessThanOrEqual(2);
    expect(assistants.some((m) => (m.content ?? '').includes(href))).toBe(true);
  });
});
