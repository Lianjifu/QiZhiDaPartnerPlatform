import { describe, expect, it } from 'vitest';
import { mockHandler } from './mock';

const admin = { Authorization: 'Bearer mock-admin-token', 'x-workspace-id': 'w1' };
const builder = { Authorization: 'Bearer mock-user-token', 'x-workspace-id': 'w1' };
const auditor = { Authorization: 'Bearer mock-auditor-token', 'x-workspace-id': 'w1' };
const secondaryWorkspaceAdmin = { Authorization: 'Bearer mock-admin-token', 'x-workspace-id': 'w2' };

function sandboxConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    scope: 'capability' as const,
    profile: {
      name: '测试采购专员',
      role: '采购询价',
      department: '采购中心',
      description: '校验上岗门禁。',
      owner: '王昊',
      escalationOwner: '采购负责人',
      serviceObject: '采购申请',
      risk: 'low',
      environment: 'sandbox',
      ...((overrides.profile as object) ?? {}),
    },
    boundary: {
      responsibilities: ['询价对比', '供应商初筛'],
      prohibitedActions: ['不得绕过采购审批'],
      handoffPolicy: { triggers: ['需要人工判断'], approvalRequiredFor: [] },
      boundaryPolicy: {
        responsibilities: [{ id: 'resp-1', title: '询价对比', objective: '形成比价结论', trigger: '收到采购申请', deliverables: ['比价表'], evidenceRequired: true }],
        capabilityModes: [{ capabilityType: 'skill', capabilityName: '工单分诊', mode: 'recommend' }],
        dataClassification: 'internal',
        allowedEnvironments: ['sandbox'],
        handoff: { triggers: ['需要人工判断'], approvers: ['采购负责人'], notificationChannels: ['Web'], slaMinutes: 30 },
      },
      ...((overrides.boundary as object) ?? {}),
    },
    capabilities: {
      model: '企业通用路由 v2',
      knowledge: [],
      skills: ['工单分诊'],
      tools: ['Jira'],
      workflows: [],
      channels: ['Web'],
      ...((overrides.capabilities as object) ?? {}),
    },
    memoryPolicy: { shortTermHours: 24, workingDays: 7, longTermCadence: 'daily', knowledgePromotion: 'approval_required' },
    ...overrides,
  };
}

describe('digital employee control plane', () => {
  it('keeps employee records scoped to the active workspace', async () => {
    const employees = await mockHandler('/api/partners', { method: 'GET', headers: admin }) as Array<{ workspaceId: string }>;
    expect(employees.length).toBeGreaterThan(0);
    expect(employees.every((employee) => employee.workspaceId === 'w1')).toBe(true);
  });

  it('returns only published, enabled capability assets for employee assembly', async () => {
    const catalog = await mockHandler('/api/partner-capability-catalog', { method: 'GET', headers: admin }) as any;
    expect(catalog.models.length).toBeGreaterThan(0);
    expect(catalog.workflows.every((item: { name: string }) => item.name)).toBe(true);
    expect(catalog.channels.every((item: { name: string }) => item.name)).toBe(true);
    expect(catalog.workflows.some((item: { meta: string }) => item.meta.startsWith('流程技能'))).toBe(true);

    const secondaryCatalog = await mockHandler('/api/partner-capability-catalog', { method: 'GET', headers: secondaryWorkspaceAdmin }) as any;
    expect(secondaryCatalog.models.some((item: { name: string }) => item.name === 'Claude Sonnet-4')).toBe(false);
  });

  it('allows role-scope configuration without resubmitting capabilities', async () => {
    const employee = await mockHandler('/api/partners', { method: 'POST', headers: admin, body: { name: '岗位契约专员', role: '契约维护', department: '人事部' } }) as any;
    const submitted = await mockHandler(`/api/partners/${employee.id}/configuration`, {
      method: 'POST',
      headers: admin,
      body: {
        scope: 'role',
        profile: { name: '小员', role: 'HR', department: '人事', description: 'HR 服务', owner: '平台管理员', escalationOwner: 'HR 总监', serviceObject: '内部用户', risk: 'low', environment: 'sandbox' },
        boundary: sandboxConfiguration().boundary,
        memoryPolicy: sandboxConfiguration().memoryPolicy,
      },
    }) as any;
    expect(submitted.status).toBe('current');
    const saved = await mockHandler(`/api/partners/${employee.id}`, { method: 'GET', headers: admin }) as any;
    expect(saved.name).toBe('小员');
    expect(saved.capabilities.model).toBe('企业通用路由 v2');
  });

  it('allows admin to confirm their own pending release in production-like env', async () => {
    const employee = await mockHandler('/api/partners', { method: 'POST', headers: admin, body: { name: '自批校验专员', role: '自批校验', department: '信息技术部' } }) as any;
    await mockHandler(`/api/partners/${employee.id}/configuration`, {
      method: 'POST',
      headers: admin,
      body: sandboxConfiguration({
        profile: {
          name: '自批校验专员',
          role: '自批校验',
          department: '信息技术部',
          description: '验证上岗双人审批。',
          owner: '王昊',
          escalationOwner: '技术平台主管',
          serviceObject: '平台配置',
          risk: 'low',
          environment: 'production',
        },
      }),
    });
    await mockHandler(`/api/partners/${employee.id}/evaluate`, { method: 'POST', headers: admin });
    const released = await mockHandler(`/api/partners/${employee.id}/release`, { method: 'POST', headers: admin }) as any;
    expect(released.lifecycle).toBe('active');
    expect(released.release.status).toBe('released');
  });

  it('blocks non-admin applicant from confirming their own pending release', async () => {
    const employee = await mockHandler('/api/partners', { method: 'POST', headers: builder, body: { name: '普通用户上岗', role: '普通校验', department: '信息技术部' } }) as any;
    await mockHandler(`/api/partners/${employee.id}/configuration`, {
      method: 'POST',
      headers: builder,
      body: sandboxConfiguration({
        profile: {
          name: '普通用户上岗',
          role: '普通校验',
          department: '信息技术部',
          description: '验证普通用户须管理员确认。',
          owner: '王昊',
          escalationOwner: '技术平台主管',
          serviceObject: '平台配置',
          risk: 'low',
          environment: 'production',
        },
      }),
    });
    await mockHandler(`/api/partners/${employee.id}/evaluate`, { method: 'POST', headers: builder });
    const pending = await mockHandler(`/api/partners/${employee.id}/release`, { method: 'POST', headers: builder }) as any;
    expect(pending.release.status).toBe('pending_approval');
    await expect(mockHandler(`/api/partners/${employee.id}/lifecycle`, { method: 'POST', headers: builder, body: { lifecycle: 'active' } })).rejects.toThrow('E_SOD_SELF_APPROVAL');
    const approved = await mockHandler(`/api/partners/${employee.id}/lifecycle`, { method: 'POST', headers: admin, body: { lifecycle: 'active' } }) as any;
    expect(approved.lifecycle).toBe('active');
    expect(approved.release.status).toBe('released');
  });

  it('requires profile, published capabilities and evaluation before release', async () => {
    const employee = await mockHandler('/api/partners', { method: 'POST', headers: admin, body: { name: '测试采购专员', role: '采购询价', department: '采购中心' } }) as { id: string };
    await expect(mockHandler(`/api/partners/${employee.id}/release`, { method: 'POST', headers: admin })).rejects.toThrow(/E_DIGITAL_EMPLOYEE_/);

    await mockHandler(`/api/partners/${employee.id}/configuration`, { method: 'POST', headers: admin, body: sandboxConfiguration() });
    await expect(mockHandler(`/api/partners/${employee.id}/capabilities`, { method: 'PATCH', headers: admin, body: { skills: ['x'] } })).rejects.toThrow('E_DIGITAL_EMPLOYEE_USE_CONFIGURATION');

    await expect(mockHandler(`/api/partners/${employee.id}/release`, { method: 'POST', headers: admin })).rejects.toThrow('E_DIGITAL_EMPLOYEE_EVALUATION_REQUIRED');

    const evaluated = await mockHandler(`/api/partners/${employee.id}/evaluate`, { method: 'POST', headers: admin }) as any;
    expect(evaluated.evaluation.status).toBe('passed');

    const released = await mockHandler(`/api/partners/${employee.id}/release`, { method: 'POST', headers: builder }) as any;
    expect(released).toMatchObject({ lifecycle: 'active', release: { status: 'released', requestedBy: '业务构建者' } });

    await expect(mockHandler(`/api/partners/${employee.id}/release`, { method: 'POST', headers: admin })).rejects.toThrow('E_DIGITAL_EMPLOYEE_ALREADY_RELEASED');
  });

  it('blocks lifecycle bypass without release and allows resume after pause', async () => {
    const draft = await mockHandler('/api/partners', { method: 'POST', headers: admin, body: { name: '旁路校验', role: '旁路', department: '信息技术部' } }) as { id: string };
    await expect(mockHandler(`/api/partners/${draft.id}/lifecycle`, { method: 'POST', headers: admin, body: { lifecycle: 'active' } })).rejects.toThrow('E_DIGITAL_EMPLOYEE_RELEASE_REQUIRED');

    const employee = await mockHandler('/api/partners', { method: 'POST', headers: admin, body: { name: '恢复校验专员', role: '恢复校验', department: '信息技术部' } }) as { id: string };
    await mockHandler(`/api/partners/${employee.id}/configuration`, {
      method: 'POST',
      headers: admin,
      body: sandboxConfiguration({ profile: { name: '恢复校验专员', role: '恢复校验', department: '信息技术部', description: 'resume', owner: '王昊', escalationOwner: '值班经理', serviceObject: '门禁', risk: 'low', environment: 'sandbox' } }),
    });
    await mockHandler(`/api/partners/${employee.id}/evaluate`, { method: 'POST', headers: admin });
    await mockHandler(`/api/partners/${employee.id}/release`, { method: 'POST', headers: admin });
    await mockHandler(`/api/partners/${employee.id}/lifecycle`, { method: 'POST', headers: admin, body: { lifecycle: 'paused', reason: '值班复核' } });
    await expect(mockHandler(`/api/partners/${employee.id}/lifecycle`, { method: 'POST', headers: admin, body: { lifecycle: 'active' } })).rejects.toThrow('E_DIGITAL_EMPLOYEE_RESUME_CONFIRM_REQUIRED');
    const resumed = await mockHandler(`/api/partners/${employee.id}/lifecycle`, { method: 'POST', headers: admin, body: { lifecycle: 'active', confirmed: true, reason: '已处置' } }) as any;
    expect(resumed.lifecycle).toBe('active');
  });

  it('rejects withdraw and reject when release is already completed', async () => {
    const employee = await mockHandler('/api/partners', { method: 'POST', headers: admin, body: { name: '撤回校验专员', role: '撤回校验', department: '信息技术部' } }) as { id: string };
    await mockHandler(`/api/partners/${employee.id}/configuration`, {
      method: 'POST',
      headers: admin,
      body: sandboxConfiguration({ profile: { name: '撤回校验专员', role: '撤回校验', department: '信息技术部', description: '撤回', owner: '王昊', escalationOwner: '值班经理', serviceObject: '门禁', risk: 'low', environment: 'sandbox' } }),
    });
    await mockHandler(`/api/partners/${employee.id}/evaluate`, { method: 'POST', headers: admin });
    await mockHandler(`/api/partners/${employee.id}/release`, { method: 'POST', headers: builder });

    await expect(mockHandler(`/api/partners/${employee.id}/release/withdraw`, { method: 'POST', headers: builder })).rejects.toThrow('E_DIGITAL_EMPLOYEE_RELEASE_NOT_PENDING');
    await expect(mockHandler(`/api/partners/${employee.id}/release/reject`, { method: 'POST', headers: admin, body: { reason: '已上岗' } })).rejects.toThrow('E_DIGITAL_EMPLOYEE_RELEASE_NOT_PENDING');
  });

  it('keeps auditors read-only while allowing evidence lookup', async () => {
    const evidence = await mockHandler('/api/partners/de-sre/evidence', { method: 'GET', headers: auditor }) as Array<{ action: string }>;
    expect(evidence.length).toBeGreaterThan(0);
    await expect(mockHandler('/api/partners/de-sre/lifecycle', { method: 'POST', headers: auditor, body: { lifecycle: 'paused' } })).rejects.toThrow('E_AUDITOR_READ_ONLY');
  });

  it('requires reason to pause and confirmation to resume an active employee', async () => {
    await expect(mockHandler('/api/partners/de-sre/lifecycle', { method: 'POST', headers: admin, body: { lifecycle: 'paused' } })).rejects.toThrow('E_DIGITAL_EMPLOYEE_OPS_REASON_REQUIRED');

    const paused = await mockHandler('/api/partners/de-sre/lifecycle', {
      method: 'POST',
      headers: admin,
      body: { lifecycle: 'paused', reason: '成功率下降，暂停待值班复核' },
    }) as any;
    expect(paused).toMatchObject({
      lifecycle: 'paused',
      opsControl: { lastAction: 'paused', reason: '成功率下降，暂停待值班复核', actor: '平台管理员' },
    });

    await expect(mockHandler('/api/partners/de-sre/lifecycle', { method: 'POST', headers: admin, body: { lifecycle: 'active' } })).rejects.toThrow('E_DIGITAL_EMPLOYEE_RESUME_CONFIRM_REQUIRED');

    const resumed = await mockHandler('/api/partners/de-sre/lifecycle', {
      method: 'POST',
      headers: admin,
      body: { lifecycle: 'active', confirmed: true, reason: '失败样本已复核' },
    }) as any;
    expect(resumed).toMatchObject({
      lifecycle: 'active',
      opsControl: { lastAction: 'resumed', reason: '失败样本已复核' },
    });

    const evidence = await mockHandler('/api/partners/de-sre/evidence', { method: 'GET', headers: admin }) as Array<{ action: string }>;
    expect(evidence.some((item) => item.action === '恢复运行')).toBe(true);
  });

  it('adopts a governed template as an independent draft and synchronizes its lifecycle evidence', async () => {
    const employee = await mockHandler('/api/partner-templates/det-service-desk/adopt', { method: 'POST', headers: admin }) as any;
    expect(employee).toMatchObject({ lifecycle: 'draft', templateId: 'det-service-desk', templateVersion: '2.1.0' });

    const records = await mockHandler('/api/partner-template-adoptions', { method: 'GET', headers: admin }) as any[];
    expect(records.some((record) => record.employeeId === employee.id && record.status === 'draft')).toBe(true);

    await mockHandler(`/api/partners/${employee.id}`, { method: 'PATCH', headers: admin, body: { escalationOwner: 'IT 服务负责人' } });
    await mockHandler(`/api/partners/${employee.id}/configuration`, {
      method: 'POST',
      headers: admin,
      body: sandboxConfiguration({
        profile: { name: employee.name, role: employee.role, department: employee.department, description: employee.description, owner: employee.owner, escalationOwner: 'IT 服务负责人', serviceObject: employee.serviceObject, risk: 'low', environment: 'sandbox' },
        capabilities: { model: employee.capabilities.model, knowledge: employee.capabilities.knowledge, skills: employee.capabilities.skills.length ? employee.capabilities.skills : ['工单分诊'], tools: employee.capabilities.tools.length ? employee.capabilities.tools : ['Jira'], workflows: employee.capabilities.workflows, channels: employee.capabilities.channels },
        boundary: {
          responsibilities: employee.responsibilities,
          prohibitedActions: employee.prohibitedActions,
          handoffPolicy: { triggers: ['需要人工判断'], approvalRequiredFor: [] },
          boundaryPolicy: {
            responsibilities: [{ id: 'resp-adopt', title: employee.responsibilities[0] ?? '服务', objective: '完成岗位任务', trigger: '收到请求', deliverables: ['处置结论'], evidenceRequired: true }],
            capabilityModes: [{ capabilityType: 'skill', capabilityName: (employee.capabilities.skills[0] ?? '工单分诊'), mode: 'recommend' }],
            dataClassification: 'internal',
            allowedEnvironments: ['sandbox'],
            handoff: { triggers: ['需要人工判断'], approvers: ['IT 服务负责人'], notificationChannels: ['Web'], slaMinutes: 30 },
          },
        },
      }),
    });
    await mockHandler(`/api/partners/${employee.id}/evaluate`, { method: 'POST', headers: admin });
    const evaluatedRecords = await mockHandler('/api/partner-template-adoptions', { method: 'GET', headers: admin }) as any[];
    expect(evaluatedRecords.find((record) => record.employeeId === employee.id)?.status).toBe('testing');

    await mockHandler(`/api/partners/${employee.id}/release`, { method: 'POST', headers: builder });
    const submittedRecords = await mockHandler('/api/partner-template-adoptions', { method: 'GET', headers: admin }) as any[];
    expect(submittedRecords.find((record) => record.employeeId === employee.id)?.status).toBe('active');

    const updatedRecords = await mockHandler('/api/partner-template-adoptions', { method: 'GET', headers: admin }) as any[];
    expect(updatedRecords.find((record) => record.employeeId === employee.id)?.status).toBe('active');
  });

  it('limits department templates to their workspace and requires an administrator to publish or certify them', async () => {
    const secondaryTemplates = await mockHandler('/api/partner-templates', { method: 'GET', headers: secondaryWorkspaceAdmin }) as Array<{ id: string }>;
    expect(secondaryTemplates.some((template) => template.id === 'det-alert-ops')).toBe(false);

    const template = await mockHandler('/api/partner-templates', { method: 'POST', headers: admin, body: { name: '变更风险分析专员', role: '变更影响评估', department: '信息技术部', tags: ['变更', '风险评估'] } }) as any;
    expect(template).toMatchObject({ source: 'department', scope: 'workspace', workspaceId: 'w1', status: 'review' });

    const certified = await mockHandler(`/api/partner-templates/${template.id}`, { method: 'PATCH', headers: admin, body: { status: 'certified' } }) as any;
    expect(certified.status).toBe('certified');
    await expect(mockHandler(`/api/partner-templates/${template.id}`, { method: 'PATCH', headers: auditor, body: { status: 'deprecated' } })).rejects.toThrow('E_AUDITOR_READ_ONLY');
  });

  it('applies role-scope configuration immediately for an active employee without dual approval', async () => {
    const employee = await mockHandler('/api/partners', { method: 'POST', headers: admin, body: { name: '配置验证专员', role: '配置验证', department: '信息技术部' } }) as any;
    await mockHandler(`/api/partners/${employee.id}/configuration`, {
      method: 'POST',
      headers: admin,
      body: sandboxConfiguration({
        profile: { name: '配置验证专员', role: '配置验证', department: '信息技术部', description: '验证受控配置流程。', owner: '王昊', escalationOwner: '技术平台主管', serviceObject: '平台配置', risk: 'low', environment: 'sandbox' },
      }),
    });
    await mockHandler(`/api/partners/${employee.id}/evaluate`, { method: 'POST', headers: admin });
    await mockHandler(`/api/partners/${employee.id}/release`, { method: 'POST', headers: builder });

    const configuration = {
      scope: 'role' as const,
      profile: { name: '配置验证专员', role: '配置验证', department: '信息技术部', description: '验证受控配置流程。', owner: '王昊', escalationOwner: '技术平台主管', serviceObject: '平台配置', risk: 'medium', environment: 'production' },
      boundary: {
        responsibilities: ['验证配置'], prohibitedActions: ['不得绕过审批'], handoffPolicy: { triggers: ['需要人工判断'], approvalRequiredFor: ['配置协同流'] },
        boundaryPolicy: {
          responsibilities: [{ id: 'resp-configuration', title: '验证配置', objective: '验证受控配置流程。', trigger: '收到配置变更请求', deliverables: ['验证结论与审计证据'], evidenceRequired: true }],
          capabilityModes: [{ capabilityType: 'workflow', capabilityName: '配置协同流', mode: 'approval_required' }],
          dataClassification: 'confidential', allowedEnvironments: ['production'],
          handoff: { triggers: ['需要人工判断'], approvers: ['技术平台主管'], notificationChannels: ['Web'], slaMinutes: 30 },
        },
      },
      memoryPolicy: { shortTermHours: 24, workingDays: 7, longTermCadence: 'daily', knowledgePromotion: 'approval_required' },
    };
    const submitted = await mockHandler(`/api/partners/${employee.id}/configuration`, { method: 'POST', headers: builder, body: configuration }) as any;
    expect(submitted).toMatchObject({ status: 'current', requiresApproval: false, changeSummary: '更新岗位授权契约' });

    const versions = await mockHandler(`/api/partners/${employee.id}/configuration-versions`, { method: 'GET', headers: admin }) as any[];
    expect(versions.some((version) => version.id === submitted.id && version.status === 'current')).toBe(true);

    const saved = await mockHandler(`/api/partners/${employee.id}`, { method: 'GET', headers: admin }) as any;
    expect(saved.environment).toBe('production');
    expect(saved.handoffPolicy).toMatchObject({ triggers: ['需要人工判断'], approvalRequiredFor: ['配置协同流'] });
    expect(saved.boundaryPolicy).toMatchObject({ dataClassification: 'confidential', allowedEnvironments: ['production'], capabilityModes: [{ capabilityName: '配置协同流', mode: 'approval_required' }] });
    await expect(mockHandler(`/api/partners/${employee.id}/configuration`, { method: 'POST', headers: auditor, body: configuration })).rejects.toThrow('E_AUDITOR_READ_ONLY');
  });

  it('applies capability-scope configuration immediately without dual approval', async () => {
    const employee = await mockHandler('/api/partners', { method: 'POST', headers: admin, body: { name: '装配直通专员', role: '装配验证', department: '信息技术部' } }) as any;
    const base = sandboxConfiguration({
      profile: { name: '装配直通专员', role: '装配验证', department: '信息技术部', description: '验证能力装配直通。', owner: '王昊', escalationOwner: '技术平台主管', serviceObject: '平台配置', risk: 'low', environment: 'sandbox' },
    });
    await mockHandler(`/api/partners/${employee.id}/configuration`, { method: 'POST', headers: admin, body: base });
    await mockHandler(`/api/partners/${employee.id}/evaluate`, { method: 'POST', headers: admin });
    await mockHandler(`/api/partners/${employee.id}/release`, { method: 'POST', headers: builder });

    const submitted = await mockHandler(`/api/partners/${employee.id}/configuration`, {
      method: 'POST',
      headers: admin,
      body: {
        ...base,
        scope: 'capability',
        profile: { ...base.profile, environment: 'production' },
        capabilities: { ...base.capabilities, model: 'deepseek-v4-flash' },
      },
    }) as any;
    expect(submitted).toMatchObject({ status: 'current', requiresApproval: false });
    const saved = await mockHandler(`/api/partners/${employee.id}`, { method: 'GET', headers: admin }) as any;
    expect(saved.capabilities.model).toBe('deepseek-v4-flash');
  });

  it('rejects a boundary policy that grants execution to an unbound capability', async () => {
    const employee = await mockHandler('/api/partners', { method: 'POST', headers: admin, body: { name: '边界校验专员', role: '策略校验', department: '信息技术部' } }) as any;
    const configuration = {
      scope: 'capability' as const,
      profile: { name: employee.name, role: employee.role, department: employee.department, description: '校验能力引用。', owner: '王昊', escalationOwner: '值班经理', serviceObject: '策略验证', risk: 'low', environment: 'sandbox' },
      boundary: {
        responsibilities: ['校验岗位授权'], prohibitedActions: [], handoffPolicy: { triggers: ['需要人工判断'], approvalRequiredFor: [] },
        boundaryPolicy: {
          responsibilities: [{ id: 'resp-boundary', title: '校验岗位授权', objective: '确保授权仅作用于已装配能力。', trigger: '提交策略', deliverables: ['校验结论'], evidenceRequired: true }],
          capabilityModes: [{ capabilityType: 'tool', capabilityName: '未绑定工具', mode: 'execute' }],
          dataClassification: 'internal', allowedEnvironments: ['sandbox'],
          handoff: { triggers: ['需要人工判断'], approvers: ['值班经理'], notificationChannels: ['Web'], slaMinutes: 30 },
        },
      },
      capabilities: { model: '企业通用路由 v2', knowledge: [], skills: [], tools: [], workflows: [], channels: ['Web'] },
      memoryPolicy: { shortTermHours: 24, workingDays: 7, longTermCadence: 'daily', knowledgePromotion: 'approval_required' },
    };
    await expect(mockHandler(`/api/partners/${employee.id}/configuration`, { method: 'POST', headers: admin, body: configuration })).rejects.toThrow('E_DIGITAL_EMPLOYEE_BOUNDARY_CAPABILITY_INVALID');
  });

  it('deletes unreleased partners and blocks deleting released ones', async () => {
    const draft = await mockHandler('/api/partners', { method: 'POST', headers: admin, body: { name: '待删档案', role: '草稿', department: '信息技术部' } }) as { id: string };
    const deleted = await mockHandler(`/api/partners/${draft.id}`, { method: 'DELETE', headers: admin }) as { id: string; status: string };
    expect(deleted).toMatchObject({ id: draft.id, status: 'deleted' });
    await expect(mockHandler(`/api/partners/${draft.id}`, { method: 'GET', headers: admin })).rejects.toThrow('E_DIGITAL_EMPLOYEE_NOT_FOUND');
    await expect(mockHandler('/api/partners/de-sre', { method: 'DELETE', headers: admin })).rejects.toThrow('E_DIGITAL_PARTNER_PUBLISH_FORBIDDEN');
  });
});
