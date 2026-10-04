import { describe, expect, it } from 'vitest';
import {
  ROLE_NAV,
  defaultKnowledgeTab,
  defaultSkillsTab,
  defaultWorkflowTab,
  getRoleNavGroups,
  navLabelKeyForPath,
  rolePageCopy,
  visibleKnowledgeTabs,
  visibleSkillsTabs,
  visibleWorkflowTabs,
  workspaceErrorMessage,
} from './role-nav';

function zhLen(key: string, dict: Record<string, string>) {
  return [...(dict[key] ?? '')].length;
}

describe('role-nav IA', () => {
  it('exposes distinct sidebars for user, admin, and auditor', () => {
    expect(getRoleNavGroups('user').flatMap((g) => g.items.map((i) => i.to))).toEqual([
      '/home', '/copilot', '/tasks', '/partners', '/workflows', '/knowledge', '/skills',
    ]);
    expect(getRoleNavGroups('admin').flatMap((g) => g.items.map((i) => i.to))).toContain('/memory');
    expect(getRoleNavGroups('admin').flatMap((g) => g.items.map((i) => i.to))).toContain('/models');
    expect(getRoleNavGroups('auditor').flatMap((g) => g.items.map((i) => i.to))).toEqual([
      '/home', '/audit-center', '/zero-trust', '/tasks', '/copilot', '/partners', '/workflows', '/knowledge', '/skills', '/memory', '/models',
    ]);
    expect(getRoleNavGroups('user').flatMap((g) => g.items.map((i) => i.to))).not.toContain('/memory');
    expect(getRoleNavGroups('user').flatMap((g) => g.items.map((i) => i.to))).not.toContain('/models');
  });

  it('keeps Chinese nav label keys four characters when resolved via DICTS-like map', () => {
    const zh: Record<string, string> = {
      'nav.home': '运营总览',
      'nav.copilot': '专家协作',
      'nav.tasks': '任务中心',
      'nav.tasks.user': '我的待办',
      'nav.tasks.auditor': '任务核查',
      'nav.agents': '数字伙伴',
      'nav.agents.auditor': '伙伴档案',
      'nav.workflows': '工作流程',
      'nav.workflows.auditor': '流程版本',
      'nav.knowledge': '知识中心',
      'nav.knowledge.user': '知识检索',
      'nav.knowledge.auditor': '知识引用',
      'nav.skills': '技能中心',
      'nav.skills.user': '技能清单',
      'nav.skills.auditor': '技能权限',
      'nav.memory': '记忆中心',
      'nav.memory.auditor': '记忆策略',
      'nav.models': '模型服务',
      'nav.models.auditor': '模型审计',
      'nav.channels': '消息渠道',
      'nav.auditCenter': '审计中心',
      'nav.zeroTrust': '持续验证',
      'nav.copilot.auditor': '协作记录',
    };
    for (const role of ['user', 'admin', 'auditor'] as const) {
      for (const item of ROLE_NAV[role].flatMap((g) => g.items)) {
        expect(zhLen(item.i18n, zh)).toBe(4);
      }
    }
  });

  it('resolves breadcrumb keys and page copy by role', () => {
    expect(navLabelKeyForPath('/tasks', 'user')).toBe('nav.tasks.user');
    expect(navLabelKeyForPath('/tasks', 'auditor')).toBe('nav.tasks.auditor');
    expect(rolePageCopy('tasks', 'user').title).toBe('我的待办');
    expect(rolePageCopy('tasks', 'auditor').title).toBe('任务核查');
    expect(rolePageCopy('agents', 'auditor').title).toBe('伙伴档案');
    expect(rolePageCopy('agents', 'admin').title).toBe('数字伙伴');
    expect(rolePageCopy('workflows', 'auditor').title).toBe('流程版本');
    expect(rolePageCopy('copilot', 'auditor').title).toBe('协作记录');
    expect(rolePageCopy('models', 'auditor').title).toBe('模型审计');
    expect(rolePageCopy('models', 'admin').title).toBe('模型服务');
  });

  it('defaults capability tabs for consumption vs audit', () => {
    expect(defaultKnowledgeTab('user')).toBe('retrieval');
    expect(defaultKnowledgeTab('auditor')).toBe('governance');
    expect(visibleKnowledgeTabs('user')).toEqual(['retrieval', 'assets']);
    expect(defaultSkillsTab('auditor')).toBe('governance');
    expect(visibleSkillsTabs('user')).toEqual(['workspace', 'workflowSkills']);
    expect(defaultWorkflowTab('auditor')).toBe('versions');
    expect(defaultWorkflowTab('user')).toBe('templates');
    expect(defaultWorkflowTab('admin')).toBe('templates');
    expect(visibleWorkflowTabs('auditor')).toEqual(['versions', 'history', 'templates']);
    expect(visibleWorkflowTabs('admin')).toEqual(['templates', 'canvas', 'publishSkill', 'history', 'versions']);
    expect(visibleWorkflowTabs('user')).toEqual(['templates', 'canvas', 'publishSkill', 'history', 'versions']);
  });

  it('rewrites cross-workspace permission errors', () => {
    expect(workspaceErrorMessage('E_FORBIDDEN: 无权访问其他工作区资源')).toContain('当前工作区无权限');
  });
});
