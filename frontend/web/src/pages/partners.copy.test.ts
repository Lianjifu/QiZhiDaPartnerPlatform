import { describe, expect, it } from 'vitest';
import { capabilityAssemblyCompleteness, operationsHealth, OPERATIONS_HANDOFF_THRESHOLD, releaseOnboardingCompleteness, roleSetupCompleteness, type CapabilityAssemblyEmployee, type OperationsEmployee, type ReleaseOnboardingEmployee, type RoleSetupEmployee } from '@/lib/partners';

/** Mirrors gateLabel / terminology rules from DigitalPartners for regression. */
function gateLabel(employee: {
  lifecycle: string;
  release: { status: string };
  evaluation: { status: string; score?: number };
  runtime: { anomalies: number };
}) {
  if (employee.lifecycle === 'quarantined' || (employee.lifecycle === 'active' && employee.runtime.anomalies > 0)) return '需关注';
  if (employee.lifecycle === 'active') return '可协作';
  if (employee.release.status === 'pending_approval') return '待确认上岗';
  if (employee.evaluation.status === 'passed') return `评测 ${employee.evaluation.score ?? '—'} · 可申请上岗`;
  if (employee.evaluation.status === 'failed') return '评测未通过';
  if (employee.lifecycle === 'paused') return '已暂停';
  if (employee.runtime.anomalies > 0) return '需关注';
  return '配置与评测中';
}

const forbidden = [/Agent\s+a\d/i, /双签/, /员工工厂/, /Workforce/i, /纳管员工/, /打开 Copilot/];

function baseEmployee(overrides: Partial<RoleSetupEmployee> = {}): RoleSetupEmployee {
  return {
    owner: '张经理',
    escalationOwner: '李值班',
    serviceObject: '生产业务系统',
    responsibilities: ['运行态势汇总'],
    handoffPolicy: { triggers: ['置信度不足'], approvalRequiredFor: [] },
    boundaryPolicy: {
      responsibilities: [{ title: '运行态势汇总', objective: '形成风险优先级', trigger: '每日 09:00' }],
      handoff: { triggers: ['置信度不足'], approvers: ['李值班'] },
      allowedEnvironments: ['sandbox'],
    },
    memoryPolicy: {
      shortTermHours: 24,
      workingDays: 7,
      longTermCadence: 'weekly',
      knowledgePromotion: 'approval_required',
    },
    ...overrides,
  };
}

function baseCapabilityEmployee(overrides: Partial<CapabilityAssemblyEmployee> = {}): CapabilityAssemblyEmployee {
  return {
    capabilities: {
      model: '企业通用路由 v2',
      skills: ['工单分诊'],
      tools: ['Jira'],
      workflows: ['IT 服务请求流'],
      knowledge: ['IT 服务知识库'],
    },
    boundaryPolicy: {
      capabilityModes: [
        { capabilityType: 'skill', capabilityName: '工单分诊', mode: 'recommend' },
        { capabilityType: 'tool', capabilityName: 'Jira', mode: 'approval_required' },
        { capabilityType: 'workflow', capabilityName: 'IT 服务请求流', mode: 'approval_required' },
      ],
    },
    ...overrides,
  };
}

describe('digital employees catalog copy', () => {
  it('surfaces collaboration and release gates', () => {
    expect(gateLabel({ lifecycle: 'active', release: { status: 'released' }, evaluation: { status: 'passed', score: 94 }, runtime: { anomalies: 0 } })).toBe('可协作');
    expect(gateLabel({ lifecycle: 'active', release: { status: 'released' }, evaluation: { status: 'passed', score: 94 }, runtime: { anomalies: 2 } })).toBe('需关注');
    expect(gateLabel({ lifecycle: 'draft', release: { status: 'pending_approval' }, evaluation: { status: 'passed', score: 90 }, runtime: { anomalies: 0 } })).toBe('待确认上岗');
  });

  it('keeps brand-safe catalog phrases', () => {
    const phrases = [
      '专家团队协同的数字伙伴：岗位边界清晰，上岗门禁与人工接管可追溯。',
      '在册专家',
      '待上岗审批',
      '新建数字伙伴',
      '创建数字伙伴',
      '配置中',
      '发起协作',
      '执行运行时已绑定（内部）',
      '企业可信企智搭 · 数字伙伴平台',
      '专家团队协同 · 岗位边界清晰',
      '配置岗位授权契约',
      '受控能力装配',
      '岗位配置只维护授权契约；能力引用请到「能力装配」；评测上岗请到「上岗发布」。',
      '能力装配只引用各中心已发布资产，并设置执行授权模式；岗位职责请到「岗位配置」，评测上岗请到「上岗发布」。',
      '维护岗位档案、职责边界、人工接管与记忆策略；能力引用请到「能力装配」。',
      '工具接入',
      '待补档案',
      '边界待完善',
      '契约完整',
      '未绑模型',
      '缺执行能力',
      '待设授权模式',
      '装配完整',
      '待评测',
      '评测未通过',
      '可申请上岗',
      '待确认上岗',
      '已上岗',
      '质量与上岗门禁',
      '按岗位与部门发现可协作的数字伙伴；上岗门禁在「上岗发布」中推进。',
      '仍需完善配置、完成评测后即可申请上岗。',
      '仍需配置、评测后申请上岗。',
      '需处置异常',
      '交接偏高',
      '运行稳定',
      '在岗专家',
      '暂停 / 隔离',
      '保存配置',
      '配置可保存，上岗前仍需完成评测',
      '采用并创建',
    ];
    for (const phrase of phrases) {
      expect(phrase).not.toMatch(/创建草稿|保存配置草稿|采用为草稿/);
      for (const pattern of forbidden) {
        expect(phrase).not.toMatch(pattern);
      }
    }
  });

  it('rejects legacy factory / workforce wording in role-setup surface', () => {
    const banned = ['配置数字员工', 'Workforce', '员工工厂', '双签'];
    const allowedTitles = ['配置岗位授权契约', '受控能力装配'];
    for (const title of allowedTitles) {
      for (const word of banned) {
        expect(title).not.toContain(word);
      }
    }
  });
});

describe('roleSetupCompleteness', () => {
  it('marks complete contract as ready', () => {
    const result = roleSetupCompleteness(baseEmployee());
    expect(result.profileOk).toBe(true);
    expect(result.boundaryOk).toBe(true);
    expect(result.memoryOk).toBe(true);
    expect(result.ready).toBe(true);
    expect(result.label).toBe('契约完整');
    expect(result.missing).toEqual([]);
  });

  it('flags missing profile before boundary', () => {
    const result = roleSetupCompleteness(baseEmployee({
      owner: '',
      escalationOwner: '待指定',
      serviceObject: '',
    }));
    expect(result.profileOk).toBe(false);
    expect(result.label).toBe('待补档案');
    expect(result.missing).toEqual(expect.arrayContaining(['岗位负责人', '人工接管负责人', '服务对象']));
  });

  it('flags incomplete boundary when profile is ok', () => {
    const result = roleSetupCompleteness(baseEmployee({
      boundaryPolicy: {
        responsibilities: [{ title: '待配置岗位职责', objective: '', trigger: '' }],
        handoff: { triggers: [], approvers: [] },
        allowedEnvironments: [],
      },
    }));
    expect(result.profileOk).toBe(true);
    expect(result.boundaryOk).toBe(false);
    expect(result.label).toBe('边界待完善');
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('does not require model routing for role contract readiness', () => {
    const result = roleSetupCompleteness(baseEmployee());
    expect(result.ready).toBe(true);
    expect(result.missing.join('')).not.toMatch(/模型/);
  });

  it('tolerates missing responsibilities / sparse boundary from API hydrate', () => {
    const sparse = {
      owner: '张经理',
      escalationOwner: '李值班',
      serviceObject: '生产业务系统',
    } as RoleSetupEmployee;
    expect(() => roleSetupCompleteness(sparse)).not.toThrow();
    const result = roleSetupCompleteness({
      ...sparse,
      boundaryPolicy: {
        responsibilities: undefined,
        handoff: undefined,
        allowedEnvironments: undefined,
      },
    });
    expect(result.boundaryOk).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining(['完整岗位职责']));
  });
});

describe('capabilityAssemblyCompleteness', () => {
  it('marks full assembly as ready', () => {
    const result = capabilityAssemblyCompleteness(baseCapabilityEmployee());
    expect(result.modelOk).toBe(true);
    expect(result.assetsOk).toBe(true);
    expect(result.modesOk).toBe(true);
    expect(result.ready).toBe(true);
    expect(result.label).toBe('装配完整');
  });

  it('flags missing model first', () => {
    const result = capabilityAssemblyCompleteness(baseCapabilityEmployee({
      capabilities: { model: '', skills: [], tools: [], workflows: [], knowledge: [] },
      boundaryPolicy: { capabilityModes: [] },
    }));
    expect(result.label).toBe('未绑模型');
    expect(result.missing).toContain('模型路由');
  });

  it('flags missing executable assets after model', () => {
    const result = capabilityAssemblyCompleteness(baseCapabilityEmployee({
      capabilities: { model: '企业通用路由 v2', skills: [], tools: [], workflows: [], knowledge: ['手册'] },
      boundaryPolicy: { capabilityModes: [] },
    }));
    expect(result.label).toBe('缺执行能力');
  });

  it('flags missing execution modes when assets exist', () => {
    const result = capabilityAssemblyCompleteness(baseCapabilityEmployee({
      boundaryPolicy: { capabilityModes: [] },
    }));
    expect(result.assetsOk).toBe(true);
    expect(result.modesOk).toBe(false);
    expect(result.label).toBe('待设授权模式');
  });
});

function baseReleaseEmployee(overrides: Partial<ReleaseOnboardingEmployee> = {}): ReleaseOnboardingEmployee {
  const role = baseEmployee();
  const capability = baseCapabilityEmployee();
  return {
    ...role,
    capabilities: capability.capabilities,
    boundaryPolicy: {
      ...role.boundaryPolicy!,
      capabilityModes: capability.boundaryPolicy!.capabilityModes,
    },
    evaluation: { status: 'not_started' },
    release: { status: 'not_released' },
    lifecycle: 'draft',
    ...overrides,
  };
}

describe('releaseOnboardingCompleteness', () => {
  it('marks pending eval when config is ready but not evaluated', () => {
    const result = releaseOnboardingCompleteness(baseReleaseEmployee());
    expect(result.configReady).toBe(true);
    expect(result.stage).toBe('pending_eval');
    expect(result.label).toBe('待评测');
    expect(result.missing).toContain('尚未评测');
    expect(result.gates.find((gate) => gate.key === 'contract')?.fixTab).toBe('roleSetup');
    expect(result.gates.find((gate) => gate.key === 'capability')?.fixTab).toBe('capabilities');
  });

  it('marks eval_failed and ready_to_request stages', () => {
    expect(releaseOnboardingCompleteness(baseReleaseEmployee({ evaluation: { status: 'failed', score: 68 } })).stage).toBe('eval_failed');
    expect(releaseOnboardingCompleteness(baseReleaseEmployee({ evaluation: { status: 'passed', score: 94 } })).stage).toBe('ready_to_request');
  });

  it('marks pending confirmation and released', () => {
    expect(releaseOnboardingCompleteness(baseReleaseEmployee({
      evaluation: { status: 'passed', score: 94 },
      release: { status: 'pending_approval', requestedBy: '建造者' },
      lifecycle: 'pending_approval',
    })).label).toBe('待确认上岗');
    expect(releaseOnboardingCompleteness(baseReleaseEmployee({
      evaluation: { status: 'passed', score: 94 },
      release: { status: 'released', requestedBy: '建造者', approver: '平台管理员' },
      lifecycle: 'active',
    })).label).toBe('已上岗');
  });

  it('omits dual-approval from release gates', () => {
    const result = releaseOnboardingCompleteness(baseReleaseEmployee({ evaluation: { status: 'passed', score: 94 } }));
    expect(result.gates.map((gate) => gate.key)).toEqual(['contract', 'capability', 'evaluation']);
    expect(result.gates.every((gate) => gate.passed)).toBe(true);
    expect(result.stage).toBe('ready_to_request');
  });

  it('flags incomplete contract before evaluation', () => {
    const result = releaseOnboardingCompleteness(baseReleaseEmployee({
      owner: '',
      capabilities: { model: '', skills: [], tools: [], workflows: [], knowledge: [] },
    }));
    expect(result.configReady).toBe(false);
    expect(result.stage).toBe('pending_eval');
    expect(result.missing).toEqual(expect.arrayContaining(['岗位负责人', '模型路由']));
  });
});

function baseOperationsEmployee(overrides: Partial<OperationsEmployee> = {}): OperationsEmployee {
  return {
    lifecycle: 'active',
    escalationOwner: '值班经理',
    owner: '王昊',
    environment: 'production',
    risk: 'medium',
    runtime: { calls24h: 100, successRate: 0.99, p95Ms: 400, costToday: 12, handoffs24h: 2, anomalies: 0 },
    release: { status: 'released' },
    ...overrides,
  };
}

describe('operationsHealth', () => {
  it('marks stable active employees', () => {
    const result = operationsHealth(baseOperationsEmployee());
    expect(result.stage).toBe('stable');
    expect(result.label).toBe('运行稳定');
    expect(result.attention).toBe(false);
  });

  it('prioritizes anomalies over high handoff', () => {
    const result = operationsHealth(baseOperationsEmployee({
      runtime: { calls24h: 100, successRate: 0.9, p95Ms: 2400, costToday: 12, handoffs24h: OPERATIONS_HANDOFF_THRESHOLD + 1, anomalies: 2 },
    }));
    expect(result.stage).toBe('needs_attention');
    expect(result.signals.some((item) => item.key === 'success_rate')).toBe(true);
    expect(result.signals.some((item) => item.key === 'handoff')).toBe(true);
  });

  it('flags high handoff when no anomalies', () => {
    const result = operationsHealth(baseOperationsEmployee({
      runtime: { calls24h: 80, successRate: 0.98, p95Ms: 500, costToday: 8, handoffs24h: OPERATIONS_HANDOFF_THRESHOLD, anomalies: 0 },
    }));
    expect(result.stage).toBe('high_handoff');
    expect(result.label).toBe('交接偏高');
  });

  it('marks paused and quarantined stages', () => {
    expect(operationsHealth(baseOperationsEmployee({ lifecycle: 'paused', opsControl: { lastAction: 'paused', reason: '值班复核' } })).label).toBe('已暂停');
    expect(operationsHealth(baseOperationsEmployee({ lifecycle: 'quarantined' })).stage).toBe('quarantined');
  });
});
