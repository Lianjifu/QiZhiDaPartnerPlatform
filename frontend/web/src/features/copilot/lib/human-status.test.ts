import { describe, expect, it } from 'vitest';
import { humanStatusLabel } from './human-status';

describe('humanStatusLabel', () => {
  it('translates machine status tokens into Chinese', () => {
    expect(humanStatusLabel('success')).toBe('成功');
    expect(humanStatusLabel('done')).toBe('已完成');
    expect(humanStatusLabel('skipped')).toBe('已跳过');
    expect(humanStatusLabel('failed')).toBe('失败');
    expect(humanStatusLabel('denied')).toBe('已拒绝');
    expect(humanStatusLabel('running')).toBe('执行中');
    expect(humanStatusLabel('pending')).toBe('等待中');
  });

  it('is case insensitive', () => {
    expect(humanStatusLabel('SUCCESS')).toBe('成功');
    expect(humanStatusLabel(' Skipped ')).toBe('已跳过');
  });

  it('keeps already-human text untouched', () => {
    expect(humanStatusLabel('检索知识')).toBe('检索知识');
    expect(humanStatusLabel('整理结论')).toBe('整理结论');
  });

  it('returns an empty string for blank input', () => {
    expect(humanStatusLabel('')).toBe('');
    expect(humanStatusLabel(undefined)).toBe('');
    expect(humanStatusLabel(null)).toBe('');
  });
});
