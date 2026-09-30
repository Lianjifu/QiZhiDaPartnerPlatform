/**
 * Copilot「运行配置 · 工具链」：展示平台工具、已装配 skills、运行时 tools。
 */
export type CopilotToolDef = {
  key: string;
  name: string;
  desc: string;
  kind: 'tool' | 'skill' | 'workflow' | 'platform' | 'runtime';
  group: 'platform' | 'skill' | 'runtime' | 'enterprise';
  requiresApproval?: boolean;
  unavailable?: boolean;
};

export type ExpertToolSource = {
  capabilities?: {
    tools?: string[];
    skills?: string[];
    workflows?: string[];
  };
  boundaryPolicy?: {
    capabilityModes?: Array<{
      capabilityType: string;
      capabilityName: string;
      mode: string;
    }>;
  };
};

const PLATFORM_TOOLS: Array<{ key: string; name: string; desc: string; phase?: string }> = [
  { key: 'builtin:knowledge.retrieve', name: 'knowledge.retrieve', desc: '平台内置 · 检索已发布知识库', phase: 'P0' },
  { key: 'builtin:memory.recall', name: 'memory.recall', desc: '平台内置 · 检索跨会话记忆', phase: 'P0' },
  { key: 'builtin:skill.read', name: 'skill.read', desc: '平台内置 · 加载 SKILL.md 全文', phase: 'P0' },
  { key: 'builtin:time.now', name: 'time.now', desc: '平台内置 · 当前时间', phase: 'P0' },
  { key: 'builtin:todo_write', name: 'todo_write', desc: '平台 · 会话 Todo 列表', phase: 'P2' },
  { key: 'builtin:ask_user_question', name: 'ask_user_question', desc: '平台 · 向用户提问', phase: 'P2' },
  { key: 'builtin:structured_output', name: 'structured_output', desc: '平台 · 结构化 JSON 输出', phase: 'P2' },
  { key: 'builtin:enter_plan_mode', name: 'enter_plan_mode', desc: '平台 · 进入计划模式', phase: 'P3' },
  { key: 'builtin:exit_plan_mode', name: 'exit_plan_mode', desc: '平台 · 退出计划模式', phase: 'P3' },
];

const RUNTIME_TOOL_META: Record<string, { desc: string; phase: string; requiresApproval?: boolean }> = {
  read_file: { desc: '运行时 · 读文件', phase: 'P0' },
  glob: { desc: '运行时 · 列文件', phase: 'P0' },
  grep: { desc: '运行时 · 搜内容', phase: 'P0' },
  bash: { desc: '运行时 · 沙箱命令', phase: 'P0', requiresApproval: true },
  web_fetch: { desc: '运行时 · HTTP GET', phase: 'P2' },
  write_file: { desc: '运行时 · 写文件', phase: 'P1', requiresApproval: true },
  edit_file: { desc: '运行时 · Patch 编辑', phase: 'P1', requiresApproval: true },
  web_search: { desc: '运行时 · Web 搜索', phase: 'P1' },
  execute_code: { desc: '运行时 · 代码执行', phase: 'P2', requiresApproval: true },
  edit_notebook: { desc: '运行时 · Notebook 编辑', phase: 'P2', requiresApproval: true },
  send_attachment: { desc: '运行时 · 发送附件', phase: 'P2' },
  agent: { desc: '运行时 · 子 Agent', phase: 'P3', requiresApproval: true },
  task_create: { desc: '运行时 · 创建任务', phase: 'P3' },
  task_list: { desc: '运行时 · 列出任务', phase: 'P3' },
  task_output: { desc: '运行时 · 任务输出', phase: 'P3' },
  task_wait: { desc: '运行时 · 等待任务', phase: 'P3' },
  task_stop: { desc: '运行时 · 停止任务', phase: 'P3', requiresApproval: true },
  list_mcp_resources: { desc: '运行时 · MCP 资源列表', phase: 'P3' },
  read_mcp_resource: { desc: '运行时 · 读 MCP 资源', phase: 'P3' },
};

const RUNTIME_TOOL_NAMES = new Set(Object.keys(RUNTIME_TOOL_META));

function slug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

function modeOf(employee: ExpertToolSource | null | undefined, type: string, name: string): string | undefined {
  return employee?.boundaryPolicy?.capabilityModes?.find(
    (item) => item.capabilityType === type && item.capabilityName === name,
  )?.mode;
}

function describe(kind: CopilotToolDef['kind'], name: string): string {
  switch (kind) {
    case 'skill':
      return `已装配技能 · ${name}`;
    case 'workflow':
      return `已装配流程 · ${name}`;
    case 'platform':
      return `平台工具 · ${name}`;
    case 'runtime':
      return `运行时工具 · ${name}`;
    default:
      return `已装配工具 · ${name}`;
  }
}

function isAllowlistedRuntime(kind: CopilotToolDef['kind'], name: string): boolean {
  const n = name.toLowerCase();
  if (kind === 'skill') {
    return /docx|xlsx|pptx|excel|word|ppt|weather|github|gog|summarize|pdf|diagram/.test(n);
  }
  if (kind === 'platform' || kind === 'runtime') {
    return true;
  }
  if (kind === 'tool') {
    if (RUNTIME_TOOL_NAMES.has(n)) return true;
    return n === 'knowledge.retrieve' || n === 'memory.recall' || n === 'skill.read' || n === 'time.now'
      || n.includes('cmdb') || n.includes('检索') || n.includes('知识库');
  }
  return false;
}

function pushUnique(
  out: CopilotToolDef[],
  seen: Set<string>,
  employee: ExpertToolSource | null | undefined,
  item: { kind: CopilotToolDef['kind']; group: CopilotToolDef['group']; key?: string; name?: string; desc?: string; requiresApproval?: boolean; unavailable?: boolean },
  names?: string[],
) {
  const list = names ?? (item.name ? [item.name] : []);
  for (const raw of list) {
    const name = raw.trim();
    if (!name) continue;
    const key = item.key ?? `${item.kind}:${slug(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mode = modeOf(employee, item.kind === 'platform' || item.kind === 'runtime' ? 'tool' : item.kind, name);
    if (mode === 'prohibited') continue;
    const requiresApproval = mode === 'approval_required' || item.requiresApproval;
    const unavailable = item.unavailable ?? (
      item.group === 'enterprise'
      && !isAllowlistedRuntime(item.kind, name)
      && !requiresApproval
    );
    out.push({
      key,
      name,
      kind: item.kind,
      group: item.group,
      desc: item.desc ?? (unavailable ? `${describe(item.kind, name)}（未接入）` : describe(item.kind, name)),
      requiresApproval,
      unavailable,
    });
  }
}

/**
 * 从数字伙伴能力装配构建本会话工具链（平台 → 技能 → 运行时 → 企业工具）。
 */
export function buildExpertTools(employee?: ExpertToolSource | null): CopilotToolDef[] {
  const out: CopilotToolDef[] = [];
  const seen = new Set<string>();

  for (const pt of PLATFORM_TOOLS) {
    pushUnique(out, seen, employee, {
      key: pt.key,
      name: pt.name,
      kind: 'platform',
      group: 'platform',
      desc: pt.desc,
    });
  }

  if (!employee?.capabilities) return out;

  const caps = employee.capabilities;
  const toolNames = caps.tools ?? [];

  for (const raw of toolNames) {
    const name = raw.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    if (RUNTIME_TOOL_NAMES.has(lower)) {
      const meta = RUNTIME_TOOL_META[lower];
      pushUnique(out, seen, employee, {
        name,
        kind: 'runtime',
        group: 'runtime',
        desc: meta?.desc,
        requiresApproval: meta?.requiresApproval ?? lower === 'bash',
      });
      continue;
    }
    if (lower === 'knowledge.retrieve' || lower === 'memory.recall' || lower === 'skill.read' || lower === 'time.now'
      || lower === 'todo_write' || lower === 'ask_user_question' || lower === 'structured_output'
      || lower === 'enter_plan_mode' || lower === 'exit_plan_mode') {
      continue;
    }
    pushUnique(out, seen, employee, {
      name,
      kind: 'tool',
      group: 'enterprise',
    });
  }

  pushUnique(out, seen, employee, { kind: 'skill', group: 'skill' }, caps.skills);
  pushUnique(out, seen, employee, { kind: 'workflow', group: 'enterprise', unavailable: true }, caps.workflows);

  return out;
}

/** 新会话默认启用：平台内置 + 已接入工具 + 已装配技能；流程/未接入/需审批项除外。 */
export function defaultEnabledToolKeys(tools: CopilotToolDef[]): string[] {
  return tools
    .filter((t) => !t.requiresApproval && !t.unavailable && t.kind !== 'workflow')
    .map((t) => t.key);
}

/** 已装配且默认可启用的技能（不含需审批 / 未接入）。 */
export function defaultAssembledSkillKeys(tools: CopilotToolDef[]): string[] {
  return tools
    .filter((t) => t.kind === 'skill' && !t.requiresApproval && !t.unavailable)
    .map((t) => t.key);
}

/**
 * 保留当前勾选中仍合法的项，并补齐默认应选中的已装配技能。
 * 解决历史会话只勾了部分 office 技能、或从问答模式切回后技能被掏空的问题。
 */
export function ensureDefaultSkillsEnabled(enabled: string[], available: CopilotToolDef[]): string[] {
  const keys = new Set(available.map((t) => t.key));
  const kept = enabled.filter((k) => keys.has(k));
  if (kept.length === 0) return defaultEnabledToolKeys(available);
  return Array.from(new Set([...kept, ...defaultAssembledSkillKeys(available)]));
}

export function isOfficeDocumentTool(tool: CopilotToolDef): boolean {
  return /docx|xlsx|pptx|excel|word|ppt/i.test(tool.name) || /docx|xlsx|pptx|excel|word|ppt/i.test(tool.key);
}

export function toolsForExecuteMode(base: string[], available: CopilotToolDef[]): string[] {
  const extras = available
    .filter((t) => !t.unavailable && t.requiresApproval)
    .map((t) => t.key);
  return Array.from(new Set([...base, ...extras]));
}

export function isWriteExecutionIntent(text: string): boolean {
  return /\/(exec|kubectl|write|apply|config)|CONFIG SET|kubectl\s+(apply|delete|exec)/i.test(text)
    || /(生成|制作|导出|写一份|做一份).{0,12}(PPT|pptx|幻灯片|演示文稿|文档|报告|docx|xlsx|表格)/i.test(text)
    || /\b(pptx?|docx?|xlsx?)\b/i.test(text);
}

/** 进入执行模式时可一并解锁的审批类工具（不含普通已装配技能）。 */
export function approvalToolKeys(available: CopilotToolDef[]): string[] {
  return available
    .filter((t) => !t.unavailable && t.requiresApproval)
    .map((t) => t.key);
}
