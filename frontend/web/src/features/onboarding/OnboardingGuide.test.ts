import { describe, expect, it } from 'vitest';
import { JOURNEY_CARDS, PREVIEW_NAV_BY_ROLE, PREVIEW_NAV_GROUPS, VALUE_CARDS } from './OnboardingGuide';

describe('OnboardingGuide copy', () => {
  it('admin preview nav mirrors supply-side sidebar IA', () => {
    const flat = PREVIEW_NAV_GROUPS.flatMap((group) => [...group.items]);
    expect(flat).toEqual([
      '运营总览',
      '专家协作',
      '任务中心',
      '工作伙伴',
      '工作流程',
      '模型服务',
      '知识中心',
      '技能中心',
      '记忆中心',
      '消息渠道',
    ]);
    expect(PREVIEW_NAV_GROUPS.map((g) => g.label)).toEqual([null, '协作', '编排', '能力']);
  });

  it('exposes role-specific four-character nav previews', () => {
    expect(PREVIEW_NAV_BY_ROLE.user.flatMap((g) => [...g.items])).toEqual([
      '运营总览', '专家协作', '我的待办', '工作伙伴', '工作流程', '知识检索', '技能清单',
    ]);
    expect(PREVIEW_NAV_BY_ROLE.auditor.flatMap((g) => [...g.items])).toContain('审计中心');
    expect(PREVIEW_NAV_BY_ROLE.auditor.flatMap((g) => [...g.items])).toContain('任务核查');
    expect(PREVIEW_NAV_BY_ROLE.auditor.flatMap((g) => [...g.items])).toContain('伙伴档案');
    for (const role of ['user', 'admin', 'auditor'] as const) {
      for (const item of PREVIEW_NAV_BY_ROLE[role].flatMap((g) => g.items)) {
        expect([...item].length).toBe(4);
      }
    }
  });

  it('value cards cover security, capability assets, and audit trail', () => {
    expect(VALUE_CARDS.map((c) => c.title)).toEqual([
      '安全受控执行',
      '能力资产统一',
      '全过程可追溯',
    ]);
    expect(VALUE_CARDS.some((c) => /记忆|消息渠道/.test(c.description))).toBe(true);
    expect(VALUE_CARDS.some((c) => /持续验证|访问控制/.test(c.description))).toBe(true);
  });

  it('journey cards follow 能力 → 编排上岗 → 受控运营', () => {
    expect(JOURNEY_CARDS.map((c) => c.title)).toEqual(['能力接入', '编排上岗', '受控运营']);
    expect(JOURNEY_CARDS[0].description).toMatch(/记忆|消息渠道/);
    expect(JOURNEY_CARDS[1].description).toMatch(/数字伙伴|工作流程/);
    expect(JOURNEY_CARDS[2].description).toMatch(/持续验证|审计/);
  });
});
