import { describe, expect, it } from 'vitest';
import {
  filterSlashCommands,
  parseSlashCommand,
  planSlashPick,
  planSlashSend,
  slashHelpText,
} from './slash-commands';

describe('parseSlashCommand', () => {
  it('parses cmd and args', () => {
    expect(parseSlashCommand('/search 入职材料')).toEqual({
      cmd: 'search',
      args: '入职材料',
      raw: '/search 入职材料',
    });
    expect(parseSlashCommand('/model')).toEqual({ cmd: 'model', args: '', raw: '/model' });
  });

  it('ignores non-commands', () => {
    expect(parseSlashCommand('请看 /search 文档')).toBeNull();
    expect(parseSlashCommand('/unknown')).toBeNull();
  });
});

describe('planSlashSend / planSlashPick', () => {
  it('opens pickers when args missing', () => {
    expect(planSlashPick('/expert')).toEqual({ type: 'open_expert_picker' });
    expect(planSlashPick('/model')).toEqual({ type: 'open_model_picker' });
    expect(planSlashSend({ cmd: 'search', args: '', raw: '/search' })).toEqual({
      type: 'noop',
      message: '请使用：/search <关键词>',
    });
  });

  it('plans knowledge search send', () => {
    const action = planSlashSend({ cmd: 'search', args: '假期政策', raw: '/search 假期政策' });
    expect(action).toMatchObject({
      type: 'send',
      enableTools: ['builtin:knowledge.retrieve'],
      modeHint: 'react',
    });
  });

  it('plans summary and task', () => {
    expect(planSlashSend({ cmd: 'summary', args: '', raw: '/summary' }).type).toBe('send');
    expect(planSlashSend({ cmd: 'task', args: '跟进入职', raw: '/task 跟进入职' })).toEqual({
      type: 'create_task',
      title: '跟进入职',
    });
  });
});

describe('filterSlashCommands', () => {
  const cmds = [{ cmd: '/model' }, { cmd: '/member' }, { cmd: '/search' }];
  it('filters by prefix', () => {
    expect(filterSlashCommands(cmds, '/mod').map((c) => c.cmd)).toEqual(['/model']);
  });
});

describe('slashHelpText', () => {
  it('lists commands', () => {
    expect(slashHelpText([{ cmd: '/help', desc: '显示所有命令' }])).toContain('/help');
  });
});
