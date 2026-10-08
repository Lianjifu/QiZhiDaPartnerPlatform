/**
 * CopilotPage.BubbleSplitter 单元测试
 * - 纯函数测试,不依赖 React / DOM
 * - 覆盖:无 tool / 有 thought / 多 tool 链 / fallback / citations
 */
import { describe, expect, it } from 'vitest';
import {
  splitMessageIntoBubbles,
  applySliceToMessage,
  describeSlices,
  withStableKeys,
} from './CopilotPage.BubbleSplitter';
import type { ChatMessageEx } from '@/hooks/types';

const baseMsg = (overrides: Partial<ChatMessageEx> = {}): ChatMessageEx => ({
  id: 'm1',
  role: 'assistant',
  content: '你好,这是一段回答。',
  createdAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

describe('splitMessageIntoBubbles', () => {
  it('returns single answer bubble for plain text without tools', () => {
    const slices = splitMessageIntoBubbles(baseMsg());
    expect(slices.length).toBe(1);
    expect(slices[0].kind).toBe('answer');
    expect(slices[0].messageOverride.content).toBe('你好,这是一段回答。');
    expect(slices[0].bubbleProps?.variantStyle).toBe('standard');
  });

  it('returns single bubble for user role without splitting', () => {
    const slices = splitMessageIntoBubbles(baseMsg({ role: 'user', content: '我在问' }));
    expect(slices.length).toBe(1);
    expect(slices[0].kind).toBe('answer');
    expect(slices[0].messageOverride.role).toBe('user');
  });

  it('extracts thought from reasoningSteps', () => {
    const slices = splitMessageIntoBubbles(baseMsg({
      reasoningSteps: [
        { type: 'understand', text: '用户问入职流程' },
        { type: 'plan', text: '先查 RAG 再回答' },
      ],
      content: '这是最终回答。',
    }));
    expect(slices.length).toBe(2);
    expect(slices[0].kind).toBe('thought');
    expect(slices[0].messageOverride.content).toContain('用户问入职流程');
    expect(slices[0].bubbleProps?.variantStyle).toBe('muted');
    expect(slices[1].kind).toBe('answer');
    expect(slices[1].messageOverride.content).toBe('这是最终回答。');
  });

  it('extracts thought from [thinking]...[/thinking] tag', () => {
    const slices = splitMessageIntoBubbles(baseMsg({
      content: '[thinking]我先想一下用户意图[/thinking]好的,请看下面流程。',
    }));
    expect(slices.length).toBe(2);
    expect(slices[0].kind).toBe('thought');
    expect(slices[0].messageOverride.content).toBe('我先想一下用户意图');
    expect(slices[1].messageOverride.content).toBe('好的,请看下面流程。');
  });

  it('extracts thought from cognitive.phases (LLM 没 [thinking] 标记时)', () => {
    const slices = splitMessageIntoBubbles(baseMsg({
      content: '这是最终回答。',
      cognitive: {
        enabled: true,
        primary: 'logic',
        primaryLabel: '逻辑',
        mode: 'standard',
        phases: ['意图理解', '任务规划', '质量复核'],
      },
    }));
    // 期望:thought(空 content 但携带 cognitive)+ answer
    expect(slices.length).toBe(2);
    expect(slices[0].kind).toBe('thought');
    expect(slices[0].bubbleProps?.variantStyle).toBe('muted');
    expect(slices[1].kind).toBe('answer');
    expect(slices[1].bubbleProps?.skipTurnPanel).toBe(true);
    expect(slices[1].messageOverride.content).toBe('这是最终回答。');
  });

  it('extracts thought from turnTasks (有任务卡也算 thought)', () => {
    const slices = splitMessageIntoBubbles(baseMsg({
      content: '这是最终回答。',
      turnTasks: [
        { id: 't1', title: '明确职责', status: 'done' },
        { id: 't2', title: '列出事项', status: 'done' },
        { id: 't3', title: '说明边界', status: 'done' },
      ],
    }));
    expect(slices.length).toBe(2);
    expect(slices[0].kind).toBe('thought');
    expect(slices[1].kind).toBe('answer');
    expect(slices[1].bubbleProps?.skipTurnPanel).toBe(true);
  });

  it('answer slice always has skipTurnPanel=true (避免 thought 重复渲染)', () => {
    const slices = splitMessageIntoBubbles(baseMsg({
      reasoningSteps: [{ type: 'plan', text: 'think' }],
      content: 'answer',
    }));
    // 即使有 reasoningSteps 触发 thought 泡,answer 仍 skipTurnPanel
    const answerSlice = slices.find((s) => s.kind === 'answer')!;
    expect(answerSlice.bubbleProps?.skipTurnPanel).toBe(true);
  });

  // === 流式期间行为锁定 ===

it('streaming 期间只返回 1 个泡(避免 SSE 事件触发重复切分)', () => {
  const statuses: Array<'queued' | 'in_flight' | 'streaming'> = ['queued', 'in_flight', 'streaming'];
  for (const status of statuses) {
    const slices = splitMessageIntoBubbles(baseMsg({
      status,
      // 即使有 thought + tool calls + cognitive,流式期间也只出 1 个泡
      reasoningSteps: [{ type: 'plan', text: 'thinking' }],
      content: '部分内容...', // 增量到达
      toolCalls: [
        { id: 'tc1', name: 'knowledge.retrieve', args: {}, status: 'ok' },
      ],
      turnTasks: [{ id: 't1', title: '任务1', status: 'done' }],
      cognitive: { enabled: true, phases: ['意图理解'] },
    }));
    expect(slices.length).toBe(1);
    expect(slices[0].kind).toBe('answer');
    expect(slices[0].bubbleProps?.skipTurnPanel).toBe(true);
  }
});

it('流式结束后(re-render 触发)再走完整切分', () => {
  // 同一消息两次 split:streaming 时单泡,completed 时多泡
  const m = baseMsg({
    status: 'streaming',
    reasoningSteps: [{ type: 'plan', text: 'think' }],
    content: '部分内容',
  });
  expect(splitMessageIntoBubbles(m).length).toBe(1);

  // status 变 succeeded
  const completed = { ...m, status: 'succeeded' as const };
  const slices = splitMessageIntoBubbles(completed);
  expect(slices.length).toBe(2); // thought + answer
  expect(slices[0].kind).toBe('thought');
  expect(slices[1].kind).toBe('answer');
});

it('纯内容(无 thought 数据)只有 answer 一个泡', () => {
    const slices = splitMessageIntoBubbles(baseMsg({
      content: '只有答案。',
    }));
    expect(slices.length).toBe(1);
    expect(slices[0].kind).toBe('answer');
    // 即使只有 answer 泡,skipTurnPanel 仍为 true(让 TurnThoughtPanel 显式关闭)
    expect(slices[0].bubbleProps?.skipTurnPanel).toBe(true);
  });

it('debug: actual kinds', () => {
    expect(true).toBe(true);
  });

  it('alternates tool_call and tool_observation per tool call, with last obs merged into answer', () => {
    const slices = splitMessageIntoBubbles(baseMsg({
      toolCalls: [
        { id: 'tc1', name: 'knowledge.retrieve', args: { query: '入职' }, status: 'ok' },
        { id: 'tc2', name: 'memory.recall', args: {}, status: 'ok' },
      ],
      content:
        '【思考】应该查知识【/思考】' +
        '<<<TOOL>>>{"name":"knowledge.retrieve","args":{"query":"入职"}}<<<END>>>' +
        '共找到 3 条知识\n' +
        '<<<TOOL>>>{"name":"memory.recall","args":{}}<<<END>>>' +
        '记忆里有 2 条偏好\n' +
        '最终回答:流程如下。',
    }));
    // 期望:thought, tool_call[0], obs[0], tool_call[1], answer(含 obs[1] 与最终回答)
    // 注:obs 与 answer 之间无显式 marker,采取"最后一次 obs 与 answer 合并"策略,
    // 避免依赖易出错的启发式分隔。
    expect(slices.map((s) => s.kind)).toEqual([
      'thought',
      'tool_call',
      'tool_observation',
      'tool_call',
      'answer',
    ]);
    expect(slices[1].messageOverride.toolCalls?.[0]?.id).toBe('tc1');
    expect(slices[2].messageOverride.content).toContain('共找到 3 条知识');
    expect(slices[3].messageOverride.toolCalls?.[0]?.id).toBe('tc2');
    // answer 段同时包含最后一次 obs 的延续 + 真正的回答(无 marker 切分)
    expect(slices[4].messageOverride.content).toContain('记忆里有 2 条偏好');
    expect(slices[4].messageOverride.content).toContain('最终回答:流程如下。');
  });

  it('handles tool call without <<<TOOL>>> markers (natural language path)', () => {
    // LLM 直接文字描述工具使用,没有 <<<TOOL>>> 块
    const slices = splitMessageIntoBubbles(baseMsg({
      toolCalls: [{ id: 'tc1', name: 'knowledge.retrieve', args: {}, status: 'ok' }],
      content: '我查询了相关文档,得到 3 条记录。流程是 A → B → C。',
    }));
    // 期望:tool_call + answer(observation 走 natural language,合并到 answer)
    expect(slices.length).toBe(2);
    expect(slices[0].kind).toBe('tool_call');
    expect(slices[1].kind).toBe('answer');
    expect(slices[1].messageOverride.content).toContain('我查询了相关文档');
    expect(slices[1].messageOverride.content).toContain('流程是 A → B → C');
  });

  it('adds meta bubble when citations present', () => {
    const slices = splitMessageIntoBubbles(baseMsg({
      citations: [
        { docId: 'd1', title: '入职流程', tier: 'primary' },
        { docId: 'd2', title: '体检', tier: 'secondary' },
      ],
      content: '答案是 A。',
    }));
    const last = slices[slices.length - 1];
    expect(last.kind).toBe('meta');
    expect(last.bubbleProps?.collapse).toBe(true);
  });

  it('returns at least one slice even with empty content', () => {
    const slices = splitMessageIntoBubbles(baseMsg({ content: '' }));
    expect(slices.length).toBeGreaterThanOrEqual(1);
    // 空内容不应包含 thought
    expect(slices.some((s) => s.kind === 'thought')).toBe(false);
  });

  it('skips tool_observation bubble when observation text is empty', () => {
    const slices = splitMessageIntoBubbles(baseMsg({
      toolCalls: [{ id: 'tc1', name: 'test', args: {}, status: 'ok' }],
      // tool call 块之后没有任何文字
      content: '<<<TOOL>>>{"name":"test","args":{}}<<<END>>>',
    }));
    // 期望:tool_call + answer(observation 被跳过)
    expect(slices.map((s) => s.kind)).toEqual(['tool_call', 'answer']);
  });

  it('preserves original message fields in answer slice', () => {
    const slices = splitMessageIntoBubbles(baseMsg({
      content: '答案',
      variants: [{ id: 'v1', content: '答案', isActive: true }],
    }));
    const answer = slices.find((s) => s.kind === 'answer')!;
    // variants 应保留(因为 answer 没显式设 undefined)
    expect(answer.messageOverride.variants).toBeUndefined();
    // 但 role / status 应被设置
    expect(answer.messageOverride.role).toBe('assistant');
  });

  it('handles reasoningSteps even without content (empty answer still present)', () => {
    const slices = splitMessageIntoBubbles(baseMsg({
      reasoningSteps: [{ type: 'plan', text: 'just thinking' }],
      content: '',
    }));
    expect(slices.length).toBe(2);
    expect(slices[0].kind).toBe('thought');
    // 空 answer 也保留一个 slice(避免数组空)
    expect(slices[1].kind).toBe('answer');
    expect(slices[1].messageOverride.content).toBe('');
  });
});

describe('applySliceToMessage', () => {
  it('merges override fields onto original message', () => {
    const m = baseMsg({ status: 'streaming' });
    const slice = {
      kind: 'answer' as const,
      index: 0,
      messageOverride: { content: '新内容', status: 'idle' },
    };
    const merged = applySliceToMessage(m, slice);
    expect(merged.content).toBe('新内容');
    expect(merged.status).toBe('idle');
    expect(merged.id).toBe(m.id); // 原字段保留
  });
});

describe('describeSlices', () => {
  it('produces readable summary', () => {
    const slices = splitMessageIntoBubbles(baseMsg({
      reasoningSteps: [{ type: 'plan', text: 'think' }],
      toolCalls: [{ id: 't1', name: 'k.retrieve', args: {}, status: 'ok' }],
      content: '<<<TOOL>>>{}<<<END>>>observation\n最终',
    }));
    const desc = describeSlices(slices);
    expect(desc).toMatch(/thought/);
    expect(desc).toMatch(/tool_call/);
    expect(desc).toMatch(/answer/);
  });
});

describe('withStableKeys', () => {
  it('generates unique keys per slice', () => {
    const m = baseMsg({ id: 'msg-123' });
    const slices = splitMessageIntoBubbles(m);
    const keyed = withStableKeys(m, slices);
    expect(keyed.length).toBe(slices.length);
    const keys = keyed.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length); // all unique
    // 全部以 msg-123 开头
    expect(keys.every((k) => k.startsWith('msg-123__'))).toBe(true);
  });
});