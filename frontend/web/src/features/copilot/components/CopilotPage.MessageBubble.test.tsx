// @vitest-environment jsdom
/**
 * 协作页气泡渲染的「不泄底」回归测试。
 *
 * 背景：后端的 reasoningSteps 的 step.detail 里带内部代号
 * （client_hint / default_logic / knowledge.retrieve / retrieve），
 * 前端曾把这些直接拼进回复正文，用户看到的回复像一段日志。
 * 这里锁死「内部代号不出现在可见正文里」。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { CopilotPageMessageBubble } from './CopilotPage.MessageBubble';
import { splitMessageIntoBubbles, withStableKeys } from './CopilotPage.BubbleSplitter';
import type { ChatMessageEx } from '@/hooks/types';

afterEach(() => cleanup());

const leakyMessage: ChatMessageEx = {
  id: 'm-leak',
  role: 'assistant',
  content: '## 结论\n可以直接办理入职。',
  createdAt: '2026-11-06T00:00:00Z',
  status: 'succeeded',
  reasoningSteps: [
    { id: 's1', kind: 'plan', title: '理解任务：入职流程', detail: '用户问入职办理' },
    { id: 's2', kind: 'framework', title: '选用框架', detail: '推理深度：深度 · 默认逻辑框架' },
    { id: 's3', kind: 'plan', title: '分析问题并按需调用能力', detail: 'client_hint' },
    { id: 's4', kind: 'tool_call', title: '检索相关知识', detail: 'knowledge.retrieve' },
    { id: 's5', kind: 'plan', title: '第 1/5 步：检索知识', detail: 'retrieve' },
  ],
  toolCalls: [{ id: 'tc1', name: 'knowledge.retrieve', args: { query: '入职' }, status: 'success' }],
};

function renderMessage(m: ChatMessageEx, expert?: { id: string; name: string }) {
  const slices = splitMessageIntoBubbles(m);
  const keyed = withStableKeys(m, slices);
  return keyed.map(({ key, slice, merged }) => (
    <CopilotPageMessageBubble
      key={key}
      m={merged}
      expert={expert}
      bubbleProps={{
        ...slice.bubbleProps,
        showHeader: false,
        turnTail: false,
        showTurnPanel: slice.kind === 'thought',
      }}
    />
  ));
}

describe('assistant bubble does not leak internal reasoning into the body', () => {
  it('keeps internal codes out of the rendered bubble text', () => {
    const { container } = render(<>{renderMessage(leakyMessage)}</>);

    const visible = container.textContent ?? '';
    expect(visible).not.toContain('client_hint');
    expect(visible).not.toContain('default_logic');
    expect(visible).not.toContain('knowledge.retrieve');
    expect(visible).not.toContain('retrieve');
    // 正文本身保留
    expect(visible).toContain('可以直接办理入职');
  });

  it('splits the message into a thought slice plus a tool slice plus an answer slice', () => {
    const slices = splitMessageIntoBubbles(leakyMessage);
    expect(slices.map((s) => s.kind)).toEqual(['thought', 'tool_call', 'answer']);
    // thought 片段不带正文
    expect(slices[0]!.messageOverride.content).toBe('');
    // answer 片段是真正的答复
    expect(slices[2]!.messageOverride.content).toContain('可以直接办理入职');
  });

  it('shows the current user identity on a user bubble instead of a hardcoded name', () => {
    const userMsg: ChatMessageEx = {
      id: 'm-user',
      role: 'user',
      content: '我要办入职',
      createdAt: '2026-11-06T00:00:00Z',
      status: 'succeeded',
    };
    render(
      <CopilotPageMessageBubble
        m={userMsg}
        currentUser={{ id: 'u9', name: '张三', role: 'user' }}
        bubbleProps={{ variantStyle: 'standard', showHeader: true }}
      />,
    );
    expect(screen.getByText('张三')).toBeTruthy();
    expect(screen.queryByText('王昊')).toBeNull();
  });

  it('puts the user identity below the bubble, not above it', () => {
    const userMsg: ChatMessageEx = {
      id: 'm-user-2',
      role: 'user',
      content: '我要办入职',
      createdAt: '2026-11-06T00:00:00Z',
      status: 'succeeded',
    };
    const { container } = render(
      <CopilotPageMessageBubble
        m={userMsg}
        currentUser={{ id: 'u9', name: '张三', role: 'user' }}
        bubbleProps={{ variantStyle: 'standard', showHeader: true }}
      />,
    );
    const text = container.textContent ?? '';
    expect(text.indexOf('我要办入职')).toBeLessThan(text.indexOf('张三'));
  });

  it('renders the user bubble with a neutral background and no border or shadow', () => {
    const userMsg: ChatMessageEx = {
      id: 'm-user-3',
      role: 'user',
      content: '我要办入职',
      createdAt: '2026-11-06T00:00:00Z',
      status: 'succeeded',
    };
    const { container } = render(
      <CopilotPageMessageBubble
        m={userMsg}
        currentUser={{ id: 'u9', name: '张三', role: 'user' }}
        bubbleProps={{ variantStyle: 'standard', showHeader: true }}
      />,
    );
    const body = container.querySelector('.copilot-message__body--user');
    expect(body?.className).toContain('bg-[var(--surface-3)]');
    expect(body?.className).not.toContain('border');
    expect(body?.className).not.toContain('shadow');
    expect(body?.className).not.toContain('bg-[var(--brand-light)]');
  });

  it('collapses all tool calls of a turn into one group line', () => {
    const msg: ChatMessageEx = {
      id: 'm-tools',
      role: 'assistant',
      content: '好的。',
      createdAt: '2026-11-06T00:00:00Z',
      status: 'succeeded',
      toolCalls: [
        { id: 'tc1', name: 'knowledge.retrieve', args: { query: '入职' }, status: 'success' },
        { id: 'tc2', name: 'memory.recall', args: {}, status: 'success' },
      ],
    };
    const slices = splitMessageIntoBubbles(msg);
    expect(slices.filter((s) => s.kind === 'tool_call')).toHaveLength(1);

    render(
      <CopilotPageMessageBubble
        m={{ ...msg, ...slices[0].messageOverride }}
        bubbleProps={{ ...slices[0].bubbleProps }}
      />,
    );
    expect(screen.getByText('调用了 2 项能力')).toBeTruthy();
  });
});

describe('消息流样式已拍平(Claude Code 风格)', () => {
  it('assistant and tool bubbles no longer carry card chrome', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8');
    const assistantRule = css.match(
      /\.copilot-message--assistant,\s*\.copilot-message--tool\s*\{[^}]*\}/,
    )?.[0];
    expect(assistantRule).toBeTruthy();
    expect(assistantRule).not.toContain('var(--surface-1)');
    expect(assistantRule).not.toContain('var(--border)');
    expect(assistantRule).toContain('box-shadow: none');
  });

  it('assistant body does not paint headings as titled sections', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8');
    const headingRule = css.match(
      /\.copilot-message__body--assistant \.md-content \.md-h2,[\s\S]*?\{[^}]*\}/,
    )?.[0];
    expect(headingRule).toBeTruthy();
    // 退化为与正文同号的强调行:没有字号跳变、没有品牌竖条
    expect(headingRule).toContain('font-size: inherit');
    expect(headingRule).not.toContain('border-left');
    expect(headingRule).not.toContain('var(--brand)');
  });
});
