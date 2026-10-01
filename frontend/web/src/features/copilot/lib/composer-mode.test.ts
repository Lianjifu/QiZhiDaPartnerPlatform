import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUN_MODE,
  defaultReasoningForRunMode,
  deriveReasoningEffort,
  deriveRunMode,
  mapRunModeToDispatch,
  parseReasoningEffort,
  parseRunMode,
} from './composer-mode';
import type { CopilotToolDef } from './expert-tools';
import { computeContextUsage } from './composer-context';

const tools: CopilotToolDef[] = [
  { key: 'builtin:knowledge.retrieve', name: 'knowledge.retrieve', desc: '', kind: 'platform', group: 'platform' },
  { key: 'builtin:memory.recall', name: 'memory.recall', desc: '', kind: 'platform', group: 'platform' },
  { key: 'bash', name: 'bash', desc: '', kind: 'runtime', group: 'runtime', requiresApproval: true },
  { key: 'read_file', name: 'read_file', desc: '', kind: 'runtime', group: 'runtime' },
];

describe('composer-mode', () => {
  it('parses runMode / reasoningEffort', () => {
    expect(parseRunMode('ask')).toBe('ask');
    expect(parseRunMode('nope')).toBeNull();
    expect(parseReasoningEffort('deep')).toBe('deep');
    expect(parseReasoningEffort('max')).toBeNull();
  });

  it('derives runMode from sessionMode when missing', () => {
    expect(deriveRunMode({ sessionMode: 'execute' })).toBe('agent');
    expect(deriveRunMode({ sessionMode: 'investigate' })).toBe(DEFAULT_RUN_MODE);
    expect(deriveRunMode({ runMode: 'ask', sessionMode: 'execute' })).toBe('ask');
  });

  it('maps ask to investigate + direct + read-only tools', () => {
    const d = mapRunModeToDispatch('ask', tools);
    expect(d.sessionMode).toBe('investigate');
    expect(d.modeHint).toBe('direct');
    expect(d.enabledTools).not.toContain('bash');
    expect(d.enabledTools.some((k) => /retrieve|recall|read_file/.test(k))).toBe(true);
  });

  it('maps plan to investigate + plan_exec and backfills assembled skills', () => {
    const withSkills: CopilotToolDef[] = [
      ...tools,
      { key: 'skill:docx', name: 'docx', desc: '已装配技能 · docx', kind: 'skill', group: 'skill' },
      { key: 'skill:obsidian', name: 'obsidian', desc: '已装配技能 · obsidian', kind: 'skill', group: 'skill' },
    ];
    const d = mapRunModeToDispatch('plan', withSkills, ['bash', 'read_file', 'builtin:knowledge.retrieve', 'skill:docx']);
    expect(d.sessionMode).toBe('investigate');
    expect(d.modeHint).toBe('plan_exec');
    expect(d.enabledTools).not.toContain('bash');
    expect(d.enabledTools).toContain('read_file');
    expect(d.enabledTools).toContain('skill:docx');
    expect(d.enabledTools).toContain('skill:obsidian');
  });

  it('keeps approval-required office skills enabled in plan mode', () => {
    const withOffice: CopilotToolDef[] = [
      ...tools,
      { key: 'skill:docx', name: 'docx', desc: '', kind: 'skill', group: 'skill', requiresApproval: true },
      { key: 'skill:pptx', name: 'pptx', desc: '', kind: 'skill', group: 'skill', requiresApproval: true },
    ];
    const d = mapRunModeToDispatch('plan', withOffice, ['skill:docx', 'skill:pptx']);
    expect(d.enabledTools).toContain('skill:docx');
    expect(d.enabledTools).toContain('skill:pptx');
  });

  it('maps agent to execute + react with approval tools', () => {
    const d = mapRunModeToDispatch('agent', tools, ['read_file']);
    expect(d.sessionMode).toBe('execute');
    expect(d.modeHint).toBe('react');
    expect(d.enabledTools).toContain('bash');
    expect(d.enableApprovalTools).toContain('bash');
  });

  it('defaults reasoning by runMode', () => {
    expect(defaultReasoningForRunMode('ask')).toBe('off');
    expect(defaultReasoningForRunMode('plan')).toBe('standard');
    expect(deriveReasoningEffort({ runMode: 'ask' })).toBe('off');
    expect(deriveReasoningEffort({ reasoningEffort: 'deep', runMode: 'ask' })).toBe('deep');
  });
});

describe('composer-context', () => {
  it('uses promptTokens / contextWindow when available', () => {
    const u = computeContextUsage({ promptTokens: 2000, contextWindow: 128000 });
    expect(u.estimated).toBe(false);
    expect(u.percent).toBeCloseTo((2000 / 128000) * 100, 5);
  });

  it('falls back to char estimate and marks estimated', () => {
    const u = computeContextUsage({ draftChars: 1000, contextWindow: 32000 });
    expect(u.estimated).toBe(true);
    expect(u.used).toBeGreaterThan(0);
    expect(u.max).toBe(32000);
  });
});
