/** Composer `/` 命令：解析与动作规划（UI 执行由 Copilot 接线）。 */

export type SlashCmdName =
  | 'expert'
  | 'search'
  | 'doc'
  | 'summary'
  | 'model'
  | 'skill'
  | 'workflow'
  | 'task'
  | 'member'
  | 'clear'
  | 'export'
  | 'help';

export type SlashParseResult = {
  cmd: SlashCmdName;
  args: string;
  raw: string;
};

export type SlashUiAction =
  | { type: 'open_expert_picker'; query?: string }
  | { type: 'open_model_picker'; query?: string }
  | { type: 'open_mention'; pane: 'skill' | 'member' | 'doc' | 'expert' }
  | { type: 'open_tools' }
  | { type: 'export'; format: 'markdown' }
  | { type: 'clear_session' }
  | { type: 'show_help' }
  | {
      type: 'send';
      content: string;
      modeHint?: string;
      enableTools?: string[];
      reflectHint?: string;
    }
  | { type: 'create_task'; title: string }
  | { type: 'switch_model'; query: string }
  | { type: 'switch_expert'; query: string }
  | { type: 'noop'; message: string };

const KNOWN: Record<string, SlashCmdName> = {
  expert: 'expert',
  search: 'search',
  doc: 'doc',
  summary: 'summary',
  model: 'model',
  skill: 'skill',
  workflow: 'workflow',
  task: 'task',
  member: 'member',
  clear: 'clear',
  export: 'export',
  help: 'help',
};

/** 仅当整段输入以 `/cmd` 开头时视为 Slash 命令（避免正文里的路径被误判）。 */
export function parseSlashCommand(draft: string): SlashParseResult | null {
  const text = draft.trim();
  if (!text.startsWith('/')) return null;
  const m = /^\/([a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/.exec(text);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const cmd = KNOWN[name];
  if (!cmd) return null;
  return { cmd, args: (m[2] ?? '').trim(), raw: text };
}

export function isSlashDraft(draft: string): boolean {
  return /^\/\S*$/.test(draft.trim()) || /^\/[a-zA-Z][\w-]*\s/.test(draft.trim());
}

export function filterSlashCommands<T extends { cmd: string }>(cmds: T[], draft: string): T[] {
  const q = draft.trim().replace(/^\//, '').toLowerCase();
  if (!q) return cmds;
  const token = q.split(/\s+/)[0] ?? '';
  return cmds.filter((c) => c.cmd.replace(/^\//, '').toLowerCase().startsWith(token));
}

/** 从菜单点选时：立即动作 vs 需要补参数。 */
export function planSlashPick(cmd: string): SlashUiAction {
  const name = cmd.replace(/^\//, '').toLowerCase();
  const known = KNOWN[name];
  if (!known) return { type: 'noop', message: `未知命令 ${cmd}` };
  switch (known) {
    case 'expert':
      return { type: 'open_expert_picker' };
    case 'model':
      return { type: 'open_model_picker' };
    case 'skill':
      return { type: 'open_mention', pane: 'skill' };
    case 'member':
      return { type: 'open_mention', pane: 'member' };
    case 'doc':
      return { type: 'open_mention', pane: 'doc' };
    case 'workflow':
      return { type: 'open_tools' };
    case 'clear':
      return { type: 'clear_session' };
    case 'export':
      return { type: 'export', format: 'markdown' };
    case 'help':
      return { type: 'show_help' };
    case 'search':
    case 'summary':
    case 'task':
      // 需要参数：插入命令前缀，等待用户补全后发送
      return { type: 'noop', message: 'await_args' };
    default:
      return { type: 'noop', message: 'await_args' };
  }
}

/** 用户按 Enter 发送时：把 `/cmd args` 变成真实动作。 */
export function planSlashSend(parsed: SlashParseResult): SlashUiAction {
  switch (parsed.cmd) {
    case 'expert':
      return parsed.args
        ? { type: 'switch_expert', query: parsed.args }
        : { type: 'open_expert_picker' };
    case 'model':
      return parsed.args
        ? { type: 'switch_model', query: parsed.args }
        : { type: 'open_model_picker' };
    case 'skill':
      return parsed.args
        ? {
            type: 'send',
            content: `请调用技能「${parsed.args}」完成我的请求，优先使用已装配技能。`,
            enableTools: undefined,
            modeHint: 'react',
          }
        : { type: 'open_mention', pane: 'skill' };
    case 'member':
      return { type: 'open_mention', pane: 'member' };
    case 'doc':
      return parsed.args
        ? {
            type: 'send',
            content: `请检索并引用文档「${parsed.args}」回答相关问题；优先使用 knowledge.retrieve。`,
            enableTools: ['builtin:knowledge.retrieve'],
            modeHint: 'react',
          }
        : { type: 'open_mention', pane: 'doc' };
    case 'search':
      if (!parsed.args) {
        return { type: 'noop', message: '请使用：/search <关键词>' };
      }
      return {
        type: 'send',
        content: `请检索知识库：${parsed.args}\n请调用 knowledge.retrieve，并基于命中内容给出简明结论与引用。`,
        enableTools: ['builtin:knowledge.retrieve'],
        modeHint: 'react',
      };
    case 'summary':
      return {
        type: 'send',
        content: parsed.args
          ? `请生成本会话摘要，并特别关注：${parsed.args}。输出：要点、已决议、待办、风险与下一步。`
          : '请根据本会话完整历史生成结构化摘要：要点、已决议、待办、风险与下一步建议。',
        modeHint: 'direct',
        reflectHint: 'off',
      };
    case 'workflow':
      return parsed.args
        ? {
            type: 'send',
            content: `请说明如何触发已装配流程「${parsed.args}」，并给出受控执行步骤（会话内不直接绕过工作流中心）。`,
            modeHint: 'direct',
          }
        : { type: 'open_tools' };
    case 'task':
      return parsed.args
        ? { type: 'create_task', title: parsed.args }
        : { type: 'noop', message: '请使用：/task <任务标题>' };
    case 'clear':
      return { type: 'clear_session' };
    case 'export':
      return { type: 'export', format: 'markdown' };
    case 'help':
      return { type: 'show_help' };
    default:
      return { type: 'noop', message: '未实现的命令' };
  }
}

export function slashHelpText(cmds: Array<{ cmd: string; desc: string }>): string {
  const lines = [
    '可用 Slash 命令：',
    ...cmds.map((c) => `- \`${c.cmd}\` — ${c.desc}`),
    '',
    '示例：`/search 入职材料` · `/summary` · `/model deepseek` · `/expert 人事专员`',
  ];
  return lines.join('\n');
}
