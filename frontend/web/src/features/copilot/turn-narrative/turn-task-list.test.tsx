// @vitest-environment jsdom
/**
 * 任务清单渲染：状态译成人话、标题与状态同行（不再上下两行挤在一起）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TurnTaskList } from './turn-task-list';
import type { TurnTaskItem } from './types';

afterEach(() => cleanup());

const tasks: TurnTaskItem[] = [
  { id: 'plan_1', title: '检索知识库入职制度与材料清单', status: 'done', detail: 'success' },
  { id: 'plan_2', title: '回忆企业/用户相关偏好与既往口径', status: 'done', detail: 'done' },
  { id: 'plan_3', title: '输出简报框架与风险说明', status: 'pending', detail: '检索知识' },
];

describe('TurnTaskList', () => {
  it('shows human-readable status instead of raw machine tokens', () => {
    render(<TurnTaskList tasks={tasks} />);
    expect(screen.getByText('成功')).toBeTruthy();
    expect(screen.getByText('已完成')).toBeTruthy();
    expect(screen.queryByText('success')).toBeNull();
    expect(screen.queryByText('done')).toBeNull();
  });

  it('keeps already-human detail text as-is', () => {
    render(<TurnTaskList tasks={tasks} />);
    expect(screen.getByText('检索知识')).toBeTruthy();
  });

  it('renders title and status on one row', () => {
    const { container } = render(<TurnTaskList tasks={tasks} />);
    const row = container.querySelector('[role="listitem"]');
    expect(row).toBeTruthy();
    const title = screen.getByText('检索知识库入职制度与材料清单');
    const status = screen.getByText('成功');
    expect(title.parentElement).toBe(row);
    expect(status.parentElement).toBe(row);
  });
});
