// @vitest-environment jsdom
/**
 * ToolCallGroup — 整组工具调用的折叠条。
 *
 * 锁死两件事:
 *   1. 收起时只显示一行「调用了 N 项能力」,不铺开每个工具;
 *   2. 展开后每项能力各占一行(能力名对人话,原始标识在明细里)。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToolCallGroup } from './CopilotPage.ToolCallGroup';
import type { ToolCall } from '@/hooks/types';

afterEach(() => cleanup());

const toolCalls: ToolCall[] = [
  { id: 'tc1', name: 'knowledge.retrieve', args: { query: '入职' }, status: 'success' },
  { id: 'tc2', name: 'memory.recall', args: {}, status: 'success' },
];

describe('ToolCallGroup', () => {
  it('collapses all tool calls into a single summary line', () => {
    render(<ToolCallGroup toolCalls={toolCalls} />);

    expect(screen.getByText('调用了 2 项能力')).toBeTruthy();
    // 收起时不铺开明细
    expect(screen.queryByText('知识检索')).toBeNull();
  });

  it('expands to one row per tool call', () => {
    render(<ToolCallGroup toolCalls={toolCalls} />);

    fireEvent.click(screen.getByText('调用了 2 项能力'));

    expect(screen.getByText('知识检索')).toBeTruthy();
    expect(screen.getByText('记忆回忆')).toBeTruthy();
  });

  it('auto-expands while streaming', () => {
    render(<ToolCallGroup toolCalls={toolCalls} streaming />);

    expect(screen.getByText('知识检索')).toBeTruthy();
  });
});
