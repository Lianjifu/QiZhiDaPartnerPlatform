import type { Role } from '@de/web-types';

export type AppRole = Extract<Role, 'user' | 'admin' | 'auditor'>;

export type RoleNavItem = {
  to: string;
  i18n: string;
  icon: string;
};

export type RoleNavGroup = {
  labelKey: string | null;
  items: RoleNavItem[];
};

/** 三角色侧栏：菜单项四字对齐；分组可短。 */
export const ROLE_NAV: Record<AppRole, RoleNavGroup[]> = {
  user: [
    { labelKey: null, items: [{ to: '/home', i18n: 'nav.home', icon: 'Home' }] },
    {
      labelKey: 'nav.group.operations',
      items: [
        { to: '/copilot', i18n: 'nav.copilot', icon: 'MessageSquare' },
        { to: '/tasks', i18n: 'nav.tasks.user', icon: 'ListChecks' },
      ],
    },
    {
      labelKey: 'nav.group.orchestration',
      items: [
        { to: '/partners', i18n: 'nav.agents', icon: 'BriefcaseBusiness' },
        { to: '/workflows', i18n: 'nav.workflows', icon: 'Workflow' },
      ],
    },
    {
      labelKey: 'nav.group.capabilities',
      items: [
        { to: '/knowledge', i18n: 'nav.knowledge.user', icon: 'BookOpen' },
        { to: '/skills', i18n: 'nav.skills.user', icon: 'Wrench' },
      ],
    },
  ],
  admin: [
    { labelKey: null, items: [{ to: '/home', i18n: 'nav.home', icon: 'Home' }] },
    {
      labelKey: 'nav.group.operations',
      items: [
        { to: '/copilot', i18n: 'nav.copilot', icon: 'MessageSquare' },
        { to: '/tasks', i18n: 'nav.tasks', icon: 'ListChecks' },
      ],
    },
    {
      labelKey: 'nav.group.orchestration',
      items: [
        { to: '/partners', i18n: 'nav.agents', icon: 'BriefcaseBusiness' },
        { to: '/workflows', i18n: 'nav.workflows', icon: 'Workflow' },
      ],
    },
    {
      labelKey: 'nav.group.capabilities',
      items: [
        { to: '/models', i18n: 'nav.models', icon: 'Brain' },
        { to: '/knowledge', i18n: 'nav.knowledge', icon: 'BookOpen' },
        { to: '/skills', i18n: 'nav.skills', icon: 'Wrench' },
        { to: '/memory', i18n: 'nav.memory', icon: 'BrainCircuit' },
        { to: '/channels', i18n: 'nav.channels', icon: 'Send' },
      ],
    },
  ],
  auditor: [
    { labelKey: null, items: [{ to: '/home', i18n: 'nav.home', icon: 'Home' }] },
    {
      labelKey: 'nav.group.audit',
      items: [
        { to: '/audit-center', i18n: 'nav.auditCenter', icon: 'ScrollText' },
        { to: '/zero-trust', i18n: 'nav.zeroTrust', icon: 'ShieldAlert' },
      ],
    },
    {
      labelKey: 'nav.group.review',
      items: [
        { to: '/tasks', i18n: 'nav.tasks.auditor', icon: 'ListChecks' },
        { to: '/copilot', i18n: 'nav.copilot.auditor', icon: 'MessageSquare' },
        { to: '/partners', i18n: 'nav.agents.auditor', icon: 'BriefcaseBusiness' },
        { to: '/workflows', i18n: 'nav.workflows.auditor', icon: 'Workflow' },
        { to: '/knowledge', i18n: 'nav.knowledge.auditor', icon: 'BookOpen' },
        { to: '/skills', i18n: 'nav.skills.auditor', icon: 'Wrench' },
        { to: '/memory', i18n: 'nav.memory.auditor', icon: 'BrainCircuit' },
        { to: '/models', i18n: 'nav.models.auditor', icon: 'Brain' },
      ],
    },
  ],
};

export function resolveAppRole(role: Role | undefined | null): AppRole {
  if (role === 'auditor' || role === 'admin' || role === 'user') return role;
  return 'user';
}

export function getRoleNavGroups(role: Role | undefined | null): RoleNavGroup[] {
  return ROLE_NAV[resolveAppRole(role)];
}

export function navLabelKeyForPath(pathname: string, role: Role | undefined | null): string {
  const groups = getRoleNavGroups(role);
  const hit = groups.flatMap((g) => g.items).find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
  if (hit) return hit.i18n;
  if (pathname.startsWith('/settings')) return 'nav.settingsGeneral';
  if (pathname.startsWith('/governance')) return 'nav.accessControl';
  if (pathname.startsWith('/zero-trust')) return 'nav.zeroTrust';
  if (pathname.startsWith('/audit-center')) return 'nav.auditCenter';
  if (pathname.startsWith('/workspaces')) return 'workspace.manage';
  return 'nav.home';
}

export function isAuditorReadonly(role: Role | undefined | null) {
  return resolveAppRole(role) === 'auditor';
}

export function roleCanMutate(role: Role | undefined | null) {
  return !isAuditorReadonly(role);
}

/** 页面标题/副标题按角色切换 */
export function rolePageCopy(
  module: 'tasks' | 'knowledge' | 'skills' | 'memory' | 'home' | 'agents' | 'workflows' | 'copilot' | 'models',
  role: Role | undefined | null,
) {
  const r = resolveAppRole(role);
  const table = {
    tasks: {
      user: { title: '我的待办', subtitle: '优先处理待你判断与双重审批的协同事项。' },
      admin: { title: '任务中心', subtitle: '优先处理需要判断、双重审批与风险处置的数字伙伴协同任务。' },
      auditor: { title: '任务核查', subtitle: '只读核查待审批、风险与异常任务证据，不参与处置执行。' },
    },
    knowledge: {
      user: { title: '知识检索', subtitle: '查找并引用工作区知识资产，供专家协作使用。' },
      admin: { title: '知识中心', subtitle: '统一管理企业知识资产、接入加工、检索评测、图谱关联与引用治理。' },
      auditor: { title: '知识引用', subtitle: '只读核查知识版本与引用证据，不修改资产或加工链路。' },
    },
    skills: {
      user: { title: '技能清单', subtitle: '查看已启用、可供数字伙伴调用的技能与工具。' },
      admin: { title: '技能中心', subtitle: '统一接入、治理原子技能与流程技能，供数字伙伴能力装配与调用。' },
      auditor: { title: '技能权限', subtitle: '只读核查技能权限范围与运行证据，不安装或变更配置。' },
    },
    memory: {
      user: { title: '记忆中心', subtitle: '运行记忆请在专家协作上下文中查看。' },
      admin: { title: '记忆中心', subtitle: '受控管理数字伙伴的会话上下文、任务经验和可审核的长期记忆。' },
      auditor: { title: '记忆策略', subtitle: '只读核查记忆策略与审计记录，不改写运行记忆。' },
    },
    home: {
      user: { title: '运营总览', subtitle: '待办、协作动态与需你关注的事项。' },
      admin: { title: '运营总览', subtitle: '专家团队在岗状态、待处理事项与成本产出。' },
      auditor: { title: '运营总览', subtitle: '合规风险摘要、策略命中与待审事项（只读）。' },
    },
    agents: {
      user: { title: '工作伙伴', subtitle: '按岗位边界发现与协作数字伙伴，查看职责与能力装配。' },
      admin: { title: '工作伙伴', subtitle: '专家团队协同的数字伙伴：岗位边界清晰，双重审批与人工接管可追溯。' },
      auditor: { title: '伙伴档案', subtitle: '只读核查岗位契约、能力装配与上岗证据，不创建或变更配置。' },
    },
    workflows: {
      user: { title: '工作流程', subtitle: '编排与试运行受控流程，发布后供数字伙伴装配。' },
      admin: { title: '工作流程', subtitle: '编排、校验、版本发布与流程技能治理，供数字伙伴能力装配。' },
      auditor: { title: '流程版本', subtitle: '只读核查流程版本、运行记录与发布证据，不编辑画布或发布。' },
    },
    copilot: {
      user: { title: '专家协作', subtitle: '与在岗数字伙伴研判与受控执行，写操作经双重审批。' },
      admin: { title: '专家协作', subtitle: '与在岗数字伙伴研判与受控执行，写操作经双重审批。' },
      auditor: { title: '协作记录', subtitle: '只读核查会话证据与审批轨迹；签署位仍可按策略参与双重审批。' },
    },
    models: {
      user: { title: '模型服务', subtitle: '模型能力由管理员统一接入与治理。' },
      admin: { title: '模型服务', subtitle: '统一管理企业模型接入、路由策略与运行治理。' },
      auditor: { title: '模型审计', subtitle: '只读核查模型接入、路由发布、回滚与隔离演练证据。' },
    },
  } as const;
  return table[module][r];
}

export type WorkflowTab = 'templates' | 'canvas' | 'publishSkill' | 'history' | 'versions';

export function defaultWorkflowTab(role: Role | undefined | null): WorkflowTab {
  return resolveAppRole(role) === 'auditor' ? 'versions' : 'canvas';
}

export function visibleWorkflowTabs(role: Role | undefined | null): WorkflowTab[] {
  if (resolveAppRole(role) === 'auditor') return ['versions', 'history', 'templates'];
  return ['templates', 'canvas', 'publishSkill', 'history'];
}

export type KnowledgeTab = 'assets' | 'processing' | 'retrieval' | 'graph' | 'governance';
export type SkillsTab = 'workspace' | 'store' | 'platformTools' | 'workflowSkills' | 'integration' | 'governance';
export type MemoryTab = 'overview' | 'shortTerm' | 'working' | 'longTerm' | 'candidates' | 'governance';

export function defaultKnowledgeTab(role: Role | undefined | null): KnowledgeTab {
  const r = resolveAppRole(role);
  if (r === 'user') return 'retrieval';
  if (r === 'auditor') return 'governance';
  return 'assets';
}

export function visibleKnowledgeTabs(role: Role | undefined | null): KnowledgeTab[] {
  const r = resolveAppRole(role);
  if (r === 'user') return ['retrieval', 'assets'];
  if (r === 'auditor') return ['governance', 'assets', 'retrieval'];
  return ['assets', 'processing', 'retrieval', 'graph', 'governance'];
}

export function defaultSkillsTab(role: Role | undefined | null): SkillsTab {
  const r = resolveAppRole(role);
  if (r === 'auditor') return 'governance';
  return 'workspace';
}

export function visibleSkillsTabs(role: Role | undefined | null): SkillsTab[] {
  const r = resolveAppRole(role);
  if (r === 'user') return ['workspace', 'workflowSkills'];
  if (r === 'auditor') return ['governance', 'workspace'];
  return ['workspace', 'store', 'platformTools', 'workflowSkills', 'integration', 'governance'];
}

export function defaultMemoryTab(role: Role | undefined | null): MemoryTab {
  return resolveAppRole(role) === 'auditor' ? 'governance' : 'overview';
}

export function workspaceErrorMessage(raw: string | undefined) {
  const text = (raw ?? '').replace(/^E_[A-Z0-9_]+:\s*/, '');
  if (/工作区|workspace|无权访问其他/i.test(text)) {
    return '当前工作区无权限或会话已过期，请切换工作区后重试。';
  }
  return text || '请求失败，请稍后重试。';
}
