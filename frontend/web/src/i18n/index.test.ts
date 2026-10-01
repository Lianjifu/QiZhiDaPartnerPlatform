import { describe, expect, it } from 'vitest';
import { DICTS } from './index';

const CONTROL_PLANE_KEYS = [
  'module.models.title',
  'module.models.tabs.access',
  'module.channels.title',
  'module.channels.tabs.routing',
  'module.knowledge.tabs.processing',
  'module.memory.tabs.governance',
  'module.memory.guardrail',
  'module.workspace.tabs.environment',
  'module.governance.tabs.controls',
  'module.zeroTrust.tabs.events',
  'module.audit.export',
] as const;

describe('enterprise navigation translations', () => {
  it('provides a non-empty Chinese and English value for every governed navigation key', () => {
    for (const key of CONTROL_PLANE_KEYS) {
      expect(DICTS['zh-CN'][key]).toBeTruthy();
      expect(DICTS['en-US'][key]).toBeTruthy();
      expect(DICTS['zh-CN'][key]).not.toBe(DICTS['en-US'][key]);
    }
  });

  it('keeps the workspace release label explicit in both languages', () => {
    expect(DICTS['zh-CN']['module.workspace.tabs.environment']).toBe('环境发布');
    expect(DICTS['en-US']['module.workspace.tabs.environment']).toBe('Environments');
  });

  it('uses four-character Chinese primary nav labels', () => {
    const navKeys = [
      'nav.home', 'nav.copilot', 'nav.copilot.auditor',
      'nav.tasks', 'nav.tasks.user', 'nav.tasks.auditor',
      'nav.agents', 'nav.agents.auditor',
      'nav.workflows', 'nav.workflows.auditor',
      'nav.models', 'nav.models.auditor', 'nav.knowledge', 'nav.knowledge.user', 'nav.knowledge.auditor',
      'nav.skills', 'nav.skills.user', 'nav.skills.auditor',
      'nav.memory', 'nav.memory.auditor', 'nav.channels',
      'nav.accessControl', 'nav.zeroTrust', 'nav.auditCenter',
    ] as const;
    for (const key of navKeys) {
      expect([...DICTS['zh-CN'][key]].length, key).toBe(4);
    }
    expect(DICTS['zh-CN']['nav.group.operations']).toBe('协作');
    expect(DICTS['zh-CN']['nav.group.audit']).toBe('审计');
    expect(DICTS['zh-CN']['nav.group.review']).toBe('核查');
    expect(DICTS['zh-CN']['account.platformSettings']).toBe('平台设置');
    expect(DICTS['zh-CN']['module.settings.tabs.usage']).toBe('套餐用量');
    expect(DICTS['zh-CN']['nav.workflows']).toBe('工作流程');
    expect(DICTS['zh-CN']['nav.zeroTrust']).toBe('持续验证');
    expect(DICTS['zh-CN']['nav.agents']).toBe('数字伙伴');
    expect(DICTS['zh-CN']['nav.agents.auditor']).toBe('伙伴档案');
    expect([...DICTS['zh-CN']['nav.agents']].length).toBe(4);
    expect([...DICTS['zh-CN']['nav.agents.auditor']].length).toBe(4);
    expect(DICTS['zh-CN']['app.title']).toBe('企智搭 · 数字伙伴平台');
    expect(DICTS['en-US']['app.title']).toBe('QiZhiDa · PartnerPlatform');
    expect(DICTS['en-US']['nav.agents']).toBe('Partners');
    expect(DICTS['zh-CN']['module.agents.tabs.market']).not.toContain('工厂');
  });

  it('labels the skills store tab and CTA consistently', () => {
    expect(DICTS['zh-CN']['module.skills.tabs.store']).toBe('技能商店');
    expect(DICTS['zh-CN']['module.skills.cta.store']).toBe('从商店安装');
    expect(DICTS['zh-CN']['module.skills.summary.store']).toContain('Registry');
    expect(DICTS['en-US']['module.skills.tabs.store']).toBe('Skill Store');
    expect(DICTS['en-US']['module.skills.cta.store']).toBe('Install from store');
  });
});
