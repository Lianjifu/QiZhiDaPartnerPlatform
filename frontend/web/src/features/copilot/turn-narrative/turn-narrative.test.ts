import { describe, expect, it } from 'vitest';
import { inferPhaseFromStep } from './infer-phase';
import { groupTurnPhases } from './group-turn-phases';
import { dedupeTurnTasks, mergeTurnTasks, settleTurnTasks } from './turn-task-list';
import type { ReasoningStep } from '@/hooks/types';

describe('inferPhaseFromStep', () => {
  it('uses explicit narrative phase when present', () => {
    expect(inferPhaseFromStep({ kind: 'plan', title: 'x', phase: 'execute' })).toBe('execute');
  });

  it('maps framework to understand', () => {
    expect(inferPhaseFromStep({ kind: 'framework', title: '选用框架' })).toBe('understand');
  });

  it('maps tool_call to execute', () => {
    expect(inferPhaseFromStep({ kind: 'tool_call', title: '调用 docx' })).toBe('execute');
  });
});

describe('groupTurnPhases', () => {
  const steps: ReasoningStep[] = [
    { id: '1', kind: 'plan', title: '理解任务', phase: 'understand' },
    { id: '2', kind: 'framework', title: '选用框架', phase: 'understand' },
    { id: '3', kind: 'plan', title: '思路阶段', phase: 'plan' },
    { id: '4', kind: 'tool_call', title: '调用检索', phase: 'execute' },
  ];

  it('groups steps into phases', () => {
    const phases = groupTurnPhases(steps, [], { bypass: false, primary: 'problem', primaryLabel: '问题解决' });
    expect(phases.find((p) => p.phase === 'understand')?.steps.length).toBe(2);
    expect(phases.find((p) => p.phase === 'execute')?.steps.length).toBe(1);
  });

  it('skips plan when cognitive bypass', () => {
    const phases = groupTurnPhases(
      [{ id: '1', kind: 'plan', title: '直接作答', phase: 'understand' }],
      [],
      { bypass: true, bypassReason: 'short_chitchat' },
    );
    const plan = phases.find((p) => p.phase === 'plan');
    expect(plan?.status).toBe('skipped');
  });
});

describe('dedupeTurnTasks', () => {
  it('keeps latest status for duplicate plan ids', () => {
    const tasks = dedupeTurnTasks([
      { id: 'plan_3', title: '生成 PPT', status: 'pending' },
      { id: 'plan_3', title: '生成 PPT', status: 'running' },
      { id: 'plan_3', title: '生成 PPT', status: 'done', detail: 'success' },
      { id: 'plan_4', title: '上传', status: 'pending' },
    ]);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ id: 'plan_3', status: 'done', detail: 'success' });
    expect(tasks[1]?.id).toBe('plan_4');
  });

  it('mergeTurnTasks updates in place', () => {
    let tasks = mergeTurnTasks([], { taskId: 'plan_3', title: '生成 PPT', action: 'added' });
    tasks = mergeTurnTasks(tasks, { taskId: 'plan_3', title: '生成 PPT', action: 'completed', detail: 'ok' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe('done');
  });

  it('settleTurnTasks closes running items after the turn ends', () => {
    const settled = settleTurnTasks(
      [
        { id: 'plan_1', title: '回顾偏好', status: 'done', detail: 'success' },
        { id: 'plan_2', title: '梳理可交付能力清单', status: 'running', detail: 'answer' },
      ],
      { streaming: false, messageStatus: 'succeeded' },
    );
    expect(settled[1]?.status).toBe('done');
  });

  it('settleTurnTasks keeps running while streaming', () => {
    const settled = settleTurnTasks(
      [{ id: 'plan_2', title: '梳理可交付能力清单', status: 'running' }],
      { streaming: true, messageStatus: 'streaming' },
    );
    expect(settled[0]?.status).toBe('running');
  });
});
