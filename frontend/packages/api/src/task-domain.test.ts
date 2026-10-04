import { describe, expect, it } from 'vitest';
import { createTaskDomain, mockHandler } from './mock';

describe('task domain', () => {
  it('rejects completion while approval is pending', () => {
    expect(() => createTaskDomain().transition('t2', 'completed', { actor: '王昊' }))
      .toThrow('任务等待人工审批');
  });

  it('rejects running while approval is pending', () => {
    expect(() => createTaskDomain().transition('t2', 'running', { actor: '王昊' }))
      .toThrow('任务等待人工审批');
  });

  it('rejects execution after required approval is rejected', () => {
    const domain = createTaskDomain();
    domain.approve('t2', { actor: '王昊', approved: false, reason: '风险未解除' });

    expect(() => domain.transition('t2', 'completed', { actor: '王昊' }))
      .toThrow('任务审批已拒绝');
  });

  it('writes an audit event for takeover', () => {
    const task = createTaskDomain().takeover('t1', { actor: '王昊', reason: '处理超时风险' });

    expect(task.auditEvents.at(-1)?.action).toBe('人工接管');
  });

  it('returns detached task snapshots', () => {
    const domain = createTaskDomain();
    const task = domain.takeover('t1', { actor: '王昊', reason: '处理超时风险' });
    task.execution.paused = false;
    task.auditEvents[0]!.action = '篡改记录';

    const stored = domain.get('t1')!;
    expect(stored.execution.paused).toBe(true);
    expect(stored.auditEvents[0]?.action).toBe('人工接管');
  });

  it('emits a failed global audit and notification when approval is rejected', async () => {
    await mockHandler('/api/mock/reset', { method: 'POST' });
    await mockHandler('/api/tasks/t2/approve', { method: 'POST', body: { actor: '王昊', approved: false } });

    const audits = await mockHandler('/api/audit-stream', {}) as Array<{ action: string; result: string }>;
    const messages = await mockHandler('/api/message-stream', {}) as Array<{ content: string; status: string }>;
    expect(audits[0]).toMatchObject({ action: '审批拒绝', result: 'failed' });
    expect(messages[0]).toMatchObject({ content: '审批拒绝：TSK-20260713-002', status: 'failed' });
  });

  it('retries a failed task and records the retry', () => {
    const domain = createTaskDomain([{
      ...createTaskDomain().get('t1')!,
      id: 'failed-task',
      lifecycleStage: 'risk',
      sla: { dueAt: undefined, remainingMin: -1, risk: 'failed', escalated: true },
      execution: { retryCount: 0, error: '执行失败', paused: true },
    }]);

    const task = domain.retry('failed-task', { actor: '王昊', reason: '恢复后重试' });

    expect(task.execution.retryCount).toBe(1);
    expect(task.lifecycleStage).toBe('running');
    expect(task.auditEvents.at(-1)?.action).toBe('重试任务');
  });

  it('requires retry or takeover for a failed task', () => {
    const domain = createTaskDomain([{
      ...createTaskDomain().get('t1')!,
      id: 'failed-task',
      lifecycleStage: 'risk',
      sla: { dueAt: undefined, remainingMin: -1, risk: 'failed', escalated: true },
    }]);

    expect(() => domain.transition('failed-task', 'completed', { actor: '王昊' }))
      .toThrow('风险或失败任务仅允许重试或人工接管');
  });
});

describe('scheduled task mock API', () => {
  it('creates a scheduled job through the mock API', async () => {
    await mockHandler('/api/mock/reset', { method: 'POST' });
    const created = await mockHandler('/api/scheduled-tasks', { method: 'POST', body: { title: '演示巡检', cadence: 'daily', hour: 8, minute: 0 } }) as { title: string; cadence: string };
    expect(created.title).toBe('演示巡检');
    expect(created.cadence).toBe('daily');
    const listed = await mockHandler('/api/scheduled-tasks', {}) as Array<{ title: string }>;
    expect(listed.some((item) => item.title === '演示巡检')).toBe(true);
  });
});
