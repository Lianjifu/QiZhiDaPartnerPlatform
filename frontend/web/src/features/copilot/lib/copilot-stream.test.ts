import { describe, expect, it } from 'vitest';
import { parseSSEChunk, mockIdentityHeaders, isMockChatMode } from './copilot-stream';

describe('parseSSEChunk', () => {
  it('parses stage and delta events', () => {
    const events: Array<{ event: string; type: string }> = [];
    const rest = parseSSEChunk(
      'event: stage\ndata: {"type":"stage","stage":"policy","status":"ok"}\n\nevent: delta\ndata: {"type":"delta","text":"hi"}\n\n',
      (event, data) => events.push({ event, type: data.type }),
    );
    expect(rest).toBe('');
    expect(events).toEqual([
      { event: 'stage', type: 'stage' },
      { event: 'delta', type: 'delta' },
    ]);
  });

  it('keeps incomplete trailing buffer', () => {
    const events: unknown[] = [];
    const rest = parseSSEChunk('event: done\ndata: {"type":"do', () => events.push(1));
    expect(events).toHaveLength(0);
    expect(rest).toContain('data: {"type":"do');
  });

  it('parses memory provenance and evolve events', () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    parseSSEChunk(
      [
        'event: stage',
        'data: {"type":"stage","stage":"memory","status":"ok","hitCount":1,"provenance":[{"id":"mem-1","title":"偏好","layer":"working","score":0.9}]}',
        '',
        'event: evolve',
        'data: {"type":"evolve","kind":"memory_promote","status":"pending_review","title":"会话偏好晋升候选"}',
        '',
        'event: done',
        'data: {"type":"done","ok":true,"messageId":"msg-9","memoryProvenance":[{"id":"mem-1"}],"evolveCandidates":1}',
        '',
      ].join('\n'),
      (event, data) => events.push({ event, data: data as Record<string, unknown> }),
    );
    expect(events).toHaveLength(3);
    expect(events[0].event).toBe('stage');
    expect((events[0].data.provenance as unknown[])).toHaveLength(1);
    expect(events[1].event).toBe('evolve');
    expect(events[1].data.kind).toBe('memory_promote');
    expect(events[2].data.messageId).toBe('msg-9');
    expect(events[2].data.evolveCandidates).toBe(1);
  });

  it('parses snapshotId on done', () => {
    const events: Array<{ type: string; snapshotId?: string }> = [];
    parseSSEChunk(
      'event: done\ndata: {"type":"done","ok":true,"correlationId":"corr-1","snapshotId":"snap-1","ragHits":2}\n\n',
      (_event, data) => events.push({ type: data.type, snapshotId: data.snapshotId }),
    );
    expect(events).toEqual([{ type: 'done', snapshotId: 'snap-1' }]);
  });

  it('parses multi-segment SSE events', () => {
    const events: string[] = [];
    parseSSEChunk(
      [
        'event: message_start',
        'data: {"type":"message_start","messageId":"m2","segmentIndex":1}',
        '',
        'event: message_delta',
        'data: {"type":"message_delta","messageId":"m2","text":"第二段"}',
        '',
        'event: done',
        'data: {"type":"done","ok":true,"messageIds":["m1","m2"],"segmentCount":2}',
        '',
      ].join('\n'),
      (_event, data) => events.push(data.type),
    );
    expect(events).toEqual(['message_start', 'message_delta', 'done']);
  });

  it('gates mock identity headers on VITE_USE_MOCK', () => {
    const headers = mockIdentityHeaders({
      role: 'admin',
      tenantId: 'tenant-acme',
      name: '平台管理员',
      id: 'u1',
      permissions: ['workspace.read'],
    });
    if (isMockChatMode()) {
      expect(headers['x-mock-role']).toBe('admin');
      expect(headers['x-mock-user-id']).toBe('u1');
    } else {
      expect(headers).toEqual({});
    }
  });
});
