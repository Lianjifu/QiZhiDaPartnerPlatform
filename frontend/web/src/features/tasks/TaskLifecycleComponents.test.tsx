import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlledTask } from '@qzda/web-types';

const query = vi.hoisted(() => vi.fn());
const mutation = vi.hoisted(() => vi.fn());

vi.mock('@/services/query', () => ({
  useApiQuery: query,
  useApiMutation: mutation,
}));

import Tasks from './components/TasksPage';
import { TaskLifecycleBoard } from './TaskLifecycleBoard';
import { TaskLifecycleDrawer } from './TaskLifecycleDrawer';

const task: ControlledTask = {
  id: 'task-1', code: 'TSK-1', title: 'Production task', priority: 'P1', status: 'pending',
  progress: { done: 0, total: 1 }, tags: [], createdAt: '2026-07-17T00:00:00.000Z', updatedAt: '2026-07-17T00:00:00.000Z',
  lifecycleStage: 'pending', source: 'manual', sla: { risk: 'none', escalated: false },
  execution: { retryCount: 0, paused: false }, governance: { approvalRequired: false, approvalStatus: 'not_required' },
  links: {}, auditEvents: [], version: 1,
};

const idleMutation = { mutate: vi.fn(), isPending: false };

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  query.mockReset();
  mutation.mockReset();
  mutation.mockReturnValue(idleMutation);
});

afterEach(cleanup);

describe('controlled task UI resilience', () => {
  it('retries a failed task list query inline', () => {
    const refetch = vi.fn();
    query.mockReturnValue({ data: undefined, isLoading: false, error: new Error('offline'), refetch });

    render(<MemoryRouter><Tasks /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('shows failed task and audit queries in the drawer with retry controls', () => {
    const taskRefetch = vi.fn();
    const auditRefetch = vi.fn();
    query.mockImplementation((key: unknown[]) => key[0] === 'controlled-task-audit'
      ? { data: undefined, isLoading: false, error: new Error('audit offline'), refetch: auditRefetch }
      : { data: undefined, isLoading: false, error: new Error('task offline'), refetch: taskRefetch });

    render(<TaskLifecycleDrawer task={task} onPendingChange={vi.fn()} />);

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    fireEvent.click(within(alerts[0]).getByRole('button', { name: '重试' }));
    fireEvent.click(within(alerts[1]).getByRole('button', { name: '重试' }));
    expect(taskRefetch).toHaveBeenCalledOnce();
    expect(auditRefetch).toHaveBeenCalledOnce();
  });

  it('prevents opening or dragging task cards and list rows while pending', () => {
    const onOpen = vi.fn();
    const onTransition = vi.fn();
    const { rerender } = render(<TaskLifecycleBoard tasks={[task]} view="board" disabled onOpen={onOpen} onTransition={onTransition} />);

    const card = screen.getByText(task.title).closest('article')!;
    expect(card.getAttribute('draggable')).toBe('false');
    fireEvent.click(card);
    fireEvent.click(screen.getByRole('button', { name: /打开详情/ }));
    expect(onOpen).not.toHaveBeenCalled();

    rerender(<TaskLifecycleBoard tasks={[task]} view="list" disabled onOpen={onOpen} onTransition={onTransition} />);
    fireEvent.click(screen.getByText(task.title).closest('tr')!);
    expect((screen.getByRole('button', { name: '打开详情' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
