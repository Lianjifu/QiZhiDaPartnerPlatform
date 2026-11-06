import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseSSEChunk, streamResumeTurn } from './copilot-stream';

describe('M16 awaiting / resume', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses the awaiting event (tool + actionId)', () => {
    const events: Array<{ type: string; tool?: string; actionId?: string; status?: string }> = [];
    parseSSEChunk(
      'event: awaiting\ndata: {"type":"awaiting","stage":"approval","status":"pending_authorization","actionId":"act-1","tool":"shell.exec"}\n\n',
      (_event, data) => events.push({
        type: data.type,
        tool: data.tool,
        actionId: data.actionId,
        status: data.status,
      }),
    );
    expect(events).toEqual([
      { type: 'awaiting', tool: 'shell.exec', actionId: 'act-1', status: 'pending_authorization' },
    ]);
  });

  it('posts to the resume endpoint and replays the SSE frames', async () => {
    const fetchMock = vi.fn(async () => new Response(
      [
        'event: stage',
        'data: {"type":"stage","stage":"resume","status":"running"}',
        '',
        'event: delta',
        'data: {"type":"delta","text":"已按审批结果继续"}',
        '',
        'event: done',
        'data: {"type":"done","ok":true,"text":"已按审批结果继续"}',
        '',
      ].join('\n'),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const seen: Array<{ type: string; text?: string }> = [];
    await streamResumeTurn({
      conversationId: 'conv-1',
      correlationId: 'corr-1',
      onEvent: (_event, data) => seen.push({ type: data.type, text: data.text }),
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/copilot/conversations/conv-1/turns/corr-1/resume');
    expect(init.method).toBe('POST');
    expect(seen.map((e) => e.type)).toEqual(['stage', 'delta', 'done']);
    expect(seen[1].text).toBe('已按审批结果继续');
  });

  it('surfaces the backend error when the turn is still awaiting approval', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: false, error: { code: 'E_NOT_FOUND', message: '该回合没有待续跑的审批动作' } }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(streamResumeTurn({
      conversationId: 'conv-1',
      correlationId: 'corr-x',
      onEvent: () => undefined,
    })).rejects.toThrow('该回合没有待续跑的审批动作');
  });
});
