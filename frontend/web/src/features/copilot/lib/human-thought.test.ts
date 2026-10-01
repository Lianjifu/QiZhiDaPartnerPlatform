import { describe, expect, it } from 'vitest';
import {
  appendHumanThought,
  mergeThoughtSteps,
  progressLabelFromEvent,
  toHumanThoughtStep,
  thoughtKindLabel,
} from './human-thought';
import type { ReasoningStep } from '@/hooks/types';

describe('human-thought', () => {
  it('maps memory hits to readable search step', () => {
    const step = toHumanThoughtStep('stage', {
      stage: 'memory',
      status: 'ok',
      hitCount: 2,
      provenance: [{ title: '招聘周报要点', layer: 'short_term' }],
    });
    expect(step?.kind).toBe('search');
    expect(step?.title).toContain('2 条相关记忆');
    expect(step?.detail).toContain('招聘周报要点');
  });

  it('drops pipeline stages from thought', () => {
    expect(toHumanThoughtStep('stage', { stage: 'policy', status: 'running' })).toBeNull();
    expect(toHumanThoughtStep('stage', { stage: 'runtime', status: 'running' })).toBeNull();
    expect(toHumanThoughtStep('stage', { stage: 'execute', status: 'running' })).toBeNull();
    expect(toHumanThoughtStep('route', { mode: 'react' })).toBeNull();
  });

  it('accepts explicit thought events', () => {
    const step = toHumanThoughtStep('thought', {
      title: '选择 Word 产出',
      detail: '便于转发与存档',
      kind: 'analyze',
    });
    expect(step?.title).toBe('选择 Word 产出');
    expect(step?.kind).toBe('analyze');
  });

  it('keeps cognitive framework metadata on thought', () => {
    const step = toHumanThoughtStep('thought', {
      title: '选用框架：问题解决分析（主）',
      kind: 'framework',
      framework: 'problem',
      frameworkLabel: '问题解决分析',
      mode: 'standard',
      phase: 'define',
      phases: ['define', 'bottleneck', 'action'],
      role: 'primary',
      confidence: 0.7,
    });
    expect(step?.kind).toBe('framework');
    expect(step?.framework).toBe('problem');
    expect(step?.frameworkLabel).toBe('问题解决分析');
    expect(step?.cognitiveMode).toBe('standard');
    expect(step?.phases).toEqual(['define', 'bottleneck', 'action']);
    expect(thoughtKindLabel('framework')).toBe('思路');
  });

  it('maps plan to human copy; reflect ok defers to explicit thought', () => {
    expect(toHumanThoughtStep('plan', { status: 'ready', goal: '本周招聘简报' })?.title)
      .toContain('本周招聘简报');
    expect(toHumanThoughtStep('reflect', { status: 'ok', critique: '覆盖面试与 offer' })).toBeNull();
    expect(toHumanThoughtStep('thought', {
      title: '反思：覆盖面试与 offer',
      kind: 'reflect',
    })?.title).toContain('覆盖面试与 offer');
  });

  it('builds progress labels without polluting thought', () => {
    expect(progressLabelFromEvent('stage', { stage: 'runtime', status: 'running' }))
      .toBe('模型处理中');
    expect(progressLabelFromEvent('stage', { stage: 'execute', status: 'running' }))
      .toBe('分析并调用能力');
    expect(progressLabelFromEvent('tool', { status: 'running', name: 'skill:docx' }))
      .toBe('调用 skill:docx');
  });

  it('merges adjacent duplicate titles', () => {
    const a: ReasoningStep = { id: '1', kind: 'search', title: '参考了 2 条相关记忆' };
    const b: ReasoningStep = { id: '2', kind: 'search', title: '参考了 2 条相关记忆', detail: 'x' };
    const merged = mergeThoughtSteps([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.detail).toBe('x');
  });

  it('appendHumanThought skips null', () => {
    expect(appendHumanThought([], null)).toEqual([]);
    const next = appendHumanThought([], toHumanThoughtStep('thought', { title: '理解任务' }));
    expect(next).toHaveLength(1);
  });

  it('exposes kind labels without raw brackets', () => {
    expect(thoughtKindLabel('plan')).toBe('计划');
    expect(thoughtKindLabel('reflect')).toBe('反思');
  });
});
