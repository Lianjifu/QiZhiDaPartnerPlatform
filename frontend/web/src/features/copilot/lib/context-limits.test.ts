import { describe, expect, it } from 'vitest';
import {
  COPILOT_LLM_HISTORY_MESSAGES,
  capSessionMessages,
  shouldShowContextWindowHint,
} from './context-limits';

describe('context-limits', () => {
  it('caps long sessions with head, notice, and tail', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      role: i === 0 ? 'system' : 'user',
      content: `msg-${i}`,
    }));
    const capped = capSessionMessages(msgs, 6);
    expect(capped).toHaveLength(6);
    expect(capped[0]?.id).toBe('m0');
    expect(capped[1]?.role).toBe('system');
    expect(String(capped[1]?.content)).toContain('省略');
    expect(capped.at(-1)?.id).toBe('m9');
  });

  it('shows hint when messages exceed LLM window', () => {
    expect(shouldShowContextWindowHint(COPILOT_LLM_HISTORY_MESSAGES)).toBe(false);
    expect(shouldShowContextWindowHint(COPILOT_LLM_HISTORY_MESSAGES + 1)).toBe(true);
  });
});
