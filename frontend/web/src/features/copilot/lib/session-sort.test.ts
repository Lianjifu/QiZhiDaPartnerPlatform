import { describe, expect, it } from 'vitest';
import { compareSessionsByRecency, sortSessionsByRecency } from './session-sort';

describe('sortSessionsByRecency', () => {
  it('puts newest lastActiveAt first', () => {
    const sorted = sortSessionsByRecency([
      { id: 'old', lastActiveAt: 1_000, createdAt: 1_000 },
      { id: 'new', lastActiveAt: 2_000, createdAt: 2_000 },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(['new', 'old']);
  });

  it('falls back to createdAt when lastActiveAt missing', () => {
    const sorted = sortSessionsByRecency([
      { id: 'a', createdAt: 100 },
      { id: 'b', createdAt: 200 },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('compareSessionsByRecency is stable for equal stamps', () => {
    expect(compareSessionsByRecency({ id: 'a', lastActiveAt: 1 }, { id: 'b', lastActiveAt: 1 })).toBeGreaterThan(0);
  });
});
