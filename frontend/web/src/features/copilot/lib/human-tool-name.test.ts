import { describe, expect, it } from 'vitest';
import { humanToolName } from './human-tool-name';

describe('humanToolName', () => {
  it('translates built-in tool ids into capability names', () => {
    expect(humanToolName('knowledge.retrieve')).toBe('知识检索');
    expect(humanToolName('memory.recall')).toBe('记忆回忆');
    expect(humanToolName('tool:shell.exec')).toBe('受控命令');
    expect(humanToolName('builtin:artifact.read')).toBe('产物读取');
  });

  it('falls back to the raw name for unknown tools', () => {
    expect(humanToolName('hris.lookup')).toBe('hris.lookup');
  });

  it('handles empty input', () => {
    expect(humanToolName('')).toBe('能力');
    expect(humanToolName(undefined)).toBe('能力');
    expect(humanToolName(null)).toBe('能力');
  });
});
