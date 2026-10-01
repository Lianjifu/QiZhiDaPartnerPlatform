import { describe, expect, it } from 'vitest';
import {
  approvalToolKeys,
  buildExpertTools,
  defaultAssembledSkillKeys,
  defaultEnabledToolKeys,
  ensureDefaultSkillsEnabled,
  isWriteExecutionIntent,
  toolsForExecuteMode,
} from './expert-tools';

const PLATFORM_BUILTIN_KEYS = [
  'builtin:knowledge.retrieve',
  'builtin:memory.recall',
  'builtin:skill.read',
  'builtin:time.now',
  'builtin:todo_write',
  'builtin:ask_user_question',
  'builtin:structured_output',
  'builtin:enter_plan_mode',
  'builtin:exit_plan_mode',
];

describe('buildExpertTools', () => {
  it('always includes platform builtins and employee assembly', () => {
    const tools = buildExpertTools({
      capabilities: {
        tools: ['HRIS', '企业微信', '知识库'],
        skills: ['政策问答'],
        workflows: ['人事服务协同流'],
      },
    });
    expect(tools.map((t) => t.key).slice(0, 2)).toEqual([
      'builtin:knowledge.retrieve',
      'builtin:memory.recall',
    ]);
    expect(tools.map((t) => t.name)).toEqual([
      'knowledge.retrieve',
      'memory.recall',
      'skill.read',
      'time.now',
      'todo_write',
      'ask_user_question',
      'structured_output',
      'enter_plan_mode',
      'exit_plan_mode',
      'HRIS',
      '企业微信',
      '知识库',
      '政策问答',
      '人事服务协同流',
    ]);
    expect(tools.find((t) => t.name === 'HRIS')?.unavailable).toBe(true);
    expect(tools.find((t) => t.name === '人事服务协同流')?.unavailable).toBe(true);
    // 未接入工具/流程默认不勾选；已装配技能默认勾选
    expect(defaultEnabledToolKeys(tools)).toEqual([
      ...PLATFORM_BUILTIN_KEYS,
      'tool:知识库',
      'skill:政策问答',
    ]);
    expect(defaultAssembledSkillKeys(tools)).toEqual(['skill:政策问答']);
  });

  it('marks approval_required from boundaryPolicy and skips prohibited', () => {
    const tools = buildExpertTools({
      capabilities: {
        tools: ['CMDB', 'kubectl'],
        skills: [],
        workflows: [],
      },
      boundaryPolicy: {
        capabilityModes: [
          { capabilityType: 'tool', capabilityName: 'kubectl', mode: 'approval_required' },
          { capabilityType: 'tool', capabilityName: 'CMDB', mode: 'execute' },
        ],
      },
    });
    expect(tools.find((t) => t.name === 'kubectl')?.requiresApproval).toBe(true);
    expect(tools.find((t) => t.name === 'CMDB')?.requiresApproval).toBeFalsy();
    expect(defaultEnabledToolKeys(tools).some((k) => k.includes('cmdb'))).toBe(true);
    expect(defaultEnabledToolKeys(tools).some((k) => k.includes('kubectl'))).toBe(false);
  });

  it('still returns builtins when no employee assembly', () => {
    expect(buildExpertTools(null).map((t) => t.key)).toEqual(PLATFORM_BUILTIN_KEYS);
    expect(buildExpertTools({ capabilities: { tools: [], skills: [], workflows: [] } }).map((t) => t.key)).toEqual(
      PLATFORM_BUILTIN_KEYS,
    );
  });

  it('toolsForExecuteMode only adds approval-required tools; plain skills stay in defaults', () => {
    const available = buildExpertTools({
      capabilities: {
        tools: [],
        skills: ['pptx', '政策问答'],
        workflows: [],
      },
      boundaryPolicy: {
        capabilityModes: [
          { capabilityType: 'skill', capabilityName: 'pptx', mode: 'approval_required' },
        ],
      },
    });
    const base = defaultEnabledToolKeys(available);
    expect(base.some((k) => k.includes('政策'))).toBe(true);
    expect(base.some((k) => k.includes('pptx'))).toBe(false);
    const forExec = toolsForExecuteMode(base, available);
    expect(forExec.some((k) => k.includes('pptx'))).toBe(true);
    expect(forExec.some((k) => k.includes('政策'))).toBe(true);
    expect(approvalToolKeys(available).some((k) => k.includes('pptx'))).toBe(true);
    expect(approvalToolKeys(available).some((k) => k.includes('政策'))).toBe(false);
  });

  it('ensureDefaultSkillsEnabled backfills assembled skills onto partial selections', () => {
    const available = buildExpertTools({
      capabilities: {
        tools: [],
        skills: ['docx', 'pptx', 'pdf', 'obsidian', 'skill-creator'],
        workflows: [],
      },
    });
    const partial = ['skill:docx', 'skill:pptx', 'skill:pdf'];
    const merged = ensureDefaultSkillsEnabled(partial, available);
    expect(merged).toEqual(expect.arrayContaining([
      'skill:docx',
      'skill:pptx',
      'skill:pdf',
      'skill:obsidian',
      'skill:skill-creator',
    ]));
    expect(ensureDefaultSkillsEnabled([], available)).toEqual(defaultEnabledToolKeys(available));
  });

  it('detects document / PPT write intents', () => {
    expect(isWriteExecutionIntent('请直接生成PPT')).toBe(true);
    expect(isWriteExecutionIntent('帮我做一份演示文稿')).toBe(true);
    expect(isWriteExecutionIntent('当前进度如何')).toBe(false);
  });
});
