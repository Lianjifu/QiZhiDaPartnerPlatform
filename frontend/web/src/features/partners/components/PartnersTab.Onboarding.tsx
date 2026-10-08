/**
 * 数字伙伴入职视图：
 *
 *  - `EmployeeConfigurationWorkbench` — 岗位授权契约 (role) / 受控能力装配 (capability) 工作台。
 *
 * 共享 UI 原语（`WorkbenchCheckStrip` / `EmployeeAvatar` / `lifecycleMeta`）来自 `PartnersShared`。
 * 边界策略编辑器（`BoundaryPolicyEditor`）来自 `PartnersDetail.Content`。
 * 受控能力装配分支 body（`OnboardingCapabilityBody`）来自 `PartnersTab.Onboarding.Capability`。
 *
 * 上岗 / 运行详情 modal 见 `PartnersTab.Detail`；运行处置弹窗 `OperationsDisposeModal` 也在那里。
 */
import { useEffect, useRef, useState } from 'react';
import type {
  DigitalPartner,
  DigitalPartnerBoundaryPolicy,
  DigitalPartnerConfigurationVersion,
} from '@qzda/web-types';
import { Badge, Button } from '@qzda/web-ui';
import { Modal } from '@/components/shared';
import { cn } from '@qzda/web-utils';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { roleCanMutate } from '@/features/role-nav/role-nav';
import { roleSetupCompleteness } from '@/features/partners/lib/partners';
import {
  formatApiError,
  lifecycleMeta,
  preservedCapabilities,
  EmployeeAvatar,
  riskMeta,
  WorkbenchCheckStrip,
} from './PartnersShared';
import { BoundaryPolicyEditor, resolveBoundaryPolicy } from './PartnersDetail.Content';
import { OnboardingCapabilityBody, type OnboardingCapabilities } from './PartnersTab.Onboarding.Capability';
import { type DigitalPartnerCapabilityCatalog } from './PartnersTab.Capability.LinkedAsset';
import { defaultToolExecutionMode, mergeBuiltinToolBindings, syncCapabilityModes } from './PartnersTab.Capability.Assembly';
import {
  CheckCircle2,
  Database,
  Save,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

type EmployeeConfigurationSection = 'profile' | 'boundary' | 'memory';
type EmployeeConfigurationInput = {
  scope?: 'capability' | 'role';
  profile: Pick<DigitalPartner, 'name' | 'role' | 'department' | 'description' | 'owner' | 'escalationOwner' | 'serviceObject' | 'risk' | 'environment'>;
  boundary: Pick<DigitalPartner, 'responsibilities' | 'prohibitedActions' | 'handoffPolicy' | 'boundaryPolicy'>;
  capabilities: DigitalPartner['capabilities'];
  memoryPolicy: DigitalPartner['memoryPolicy'];
};
type EmployeeConfigurationResult = DigitalPartnerConfigurationVersion & { requiresApproval: boolean };

export type EmbeddedSaveHandle = {
  save: () => void;
  pending: boolean;
  canSave: boolean;
};

/** `EmployeeConfigurationWorkbench` — 配置岗位授权契约 (role) 或 受控能力装配 (capability)。 */
export function EmployeeConfigurationWorkbench({ employee, open, onClose, initialSection = 'profile', mode = 'role', layout = 'modal', embedded = false, onSaved, onBindSave }: { employee: DigitalPartner; open: boolean; onClose: () => void; initialSection?: EmployeeConfigurationSection; mode?: 'role' | 'capability'; layout?: 'modal' | 'inline'; embedded?: boolean; onSaved?: () => void; onBindSave?: (handle: EmbeddedSaveHandle | null) => void }) {
  const [section, setSection] = useState<EmployeeConfigurationSection>(initialSection);
  const [profile, setProfile] = useState({ name: employee.name, role: employee.role, department: employee.department, description: employee.description, owner: employee.owner, escalationOwner: employee.escalationOwner, serviceObject: employee.serviceObject, risk: employee.risk, environment: employee.environment });
  const [boundaryPolicy, setBoundaryPolicy] = useState<DigitalPartnerBoundaryPolicy>(() => resolveBoundaryPolicy(employee));
  const [capabilities, setCapabilities] = useState(() => ({ agentId: employee.capabilities.agentId ?? '', model: employee.capabilities.model, knowledge: employee.capabilities.knowledge.join('\n'), skills: employee.capabilities.skills.join('\n'), tools: employee.capabilities.tools.join('\n'), workflows: employee.capabilities.workflows.join('\n'), channels: employee.capabilities.channels.join('\n') }));
  const [memory, setMemory] = useState({ ...employee.memoryPolicy });
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'admin';
  const canMutate = roleCanMutate(user?.role);

  const { data: versions = [] } = useApiQuery<DigitalPartnerConfigurationVersion[]>(['digital-employee', employee.id, 'configuration-versions'], `/api/partners/${employee.id}/configuration-versions`, undefined, { enabled: open || layout === 'inline' });
  const { data: capabilityCatalog } = useApiQuery<DigitalPartnerCapabilityCatalog>(['digital-employee-capability-catalog'], '/api/partner-capability-catalog', undefined, { enabled: open || layout === 'inline' });
  const closeAfterSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useApiMutation<EmployeeConfigurationResult, EmployeeConfigurationInput>(() => `/api/partners/${employee.id}/configuration`, {
    invalidateKeys: [['digital-employees'], ['digital-employee', employee.id], ['digital-employee', employee.id, 'configuration-versions']],
    onSuccess: (result) => {
      setFeedback({
        kind: 'success',
        text: mode === 'capability'
          ? `${result.version} 能力装配已保存并生效。`
          : employee.release.status === 'released' || employee.lifecycle === 'active'
            ? `${result.version} 岗位授权契约已保存并生效。`
            : `${result.version} 已保存，可继续执行评测与上岗流程。`,
      });
      if (layout === 'inline') {
        onSaved?.();
        return;
      }
      if (closeAfterSaveRef.current) clearTimeout(closeAfterSaveRef.current);
      closeAfterSaveRef.current = setTimeout(() => { closeAfterSaveRef.current = null; onClose(); }, 600);
    },
    onError: (err) => setFeedback({ kind: 'error', text: formatApiError(err, '保存未完成，请检查必填项与岗位边界。') }),
  });

  const approve = useApiMutation<DigitalPartnerConfigurationVersion, { versionId: string }>(({ versionId }) => `/api/partners/${employee.id}/configuration-versions/${versionId}/approve`);

  const lines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);
  const syncFormFromEmployee = () => {
    setProfile({ name: employee.name, role: employee.role, department: employee.department, description: employee.description, owner: employee.owner, escalationOwner: employee.escalationOwner, serviceObject: employee.serviceObject, risk: employee.risk, environment: employee.environment });
    setBoundaryPolicy(resolveBoundaryPolicy(employee));
    setCapabilities({ agentId: employee.capabilities.agentId ?? '', model: employee.capabilities.model, knowledge: employee.capabilities.knowledge.join('\n'), skills: employee.capabilities.skills.join('\n'), tools: employee.capabilities.tools.join('\n'), workflows: employee.capabilities.workflows.join('\n'), channels: employee.capabilities.channels.join('\n') });
    setMemory({ ...employee.memoryPolicy });
  };

  useEffect(() => {
    if (!open) {
      if (closeAfterSaveRef.current) { clearTimeout(closeAfterSaveRef.current); closeAfterSaveRef.current = null; }
      setFeedback(null);
      return;
    }
    setSection(initialSection);
    setFeedback(null);
    syncFormFromEmployee();
  }, [open, employee.id, initialSection]);

  useEffect(() => () => {
    if (closeAfterSaveRef.current) clearTimeout(closeAfterSaveRef.current);
  }, []);

  const capabilityCount = lines(capabilities.skills).length + lines(capabilities.tools).length + lines(capabilities.workflows).length;
  const boundExecutable = [
    ...lines(capabilities.skills).map((capabilityName) => ({ capabilityType: 'skill' as const, capabilityName })),
    ...lines(capabilities.tools).map((capabilityName) => ({ capabilityType: 'tool' as const, capabilityName })),
    ...lines(capabilities.workflows).map((capabilityName) => ({ capabilityType: 'workflow' as const, capabilityName })),
  ];
  const modeTypeLabels: Record<'skill' | 'tool' | 'workflow', string> = {
    skill: '技能', tool: '工具', workflow: '流程',
  };
  const missingModes = boundExecutable.filter((item) => !boundaryPolicy.capabilityModes.some((mode) => mode.capabilityType === item.capabilityType && mode.capabilityName === item.capabilityName));
  const modesComplete = missingModes.length === 0;
  const roleBlocking = [
    !profile.name.trim() && '员工名称',
    !profile.role.trim() && '岗位名称',
    !profile.department.trim() && '所属部门',
    !boundaryPolicy.responsibilities.length && '至少一项岗位职责',
    boundaryPolicy.responsibilities.some((item) => !item.title.trim() || !item.objective.trim() || !item.trigger.trim()) && '完整的职责目标与触发条件',
    !boundaryPolicy.handoff.triggers.some(Boolean) && '至少一项接管触发条件',
    !boundaryPolicy.handoff.approvers.some(Boolean) && '至少一名接管负责人',
    !boundaryPolicy.allowedEnvironments.length && '至少一个运行环境',
  ].filter(Boolean) as string[];
  const capabilityBlocking = [
    !capabilities.model.trim() && '模型路由',
    !capabilityCount && '至少一项技能/工具/工作流',
    ...(capabilityCount > 0 && !modesComplete
      ? [`执行授权模式：${missingModes.map((item) => `${modeTypeLabels[item.capabilityType]}「${item.capabilityName}」`).join('、')}`]
      : []),
  ].filter(Boolean) as string[];
  const blocking = mode === 'capability' ? capabilityBlocking : roleBlocking;
  const roleContractReady = roleSetupCompleteness(employee).ready;
  const alreadyOnDuty = employee.release.status === 'released' || employee.lifecycle === 'active';

  const submit = () => {
    if (blocking.length) { setFeedback({ kind: 'error', text: `请补齐：${blocking.join('、')}` }); return; }
    const capabilityTools = mode === 'capability' && capabilityCatalog
      ? mergeBuiltinToolBindings(capabilityCatalog, lines(capabilities.tools))
      : lines(capabilities.tools);
    const nextCapabilities = mode === 'capability'
      ? { agentId: capabilities.agentId || undefined, model: capabilities.model, knowledge: lines(capabilities.knowledge), skills: lines(capabilities.skills), tools: capabilityTools, workflows: lines(capabilities.workflows), channels: lines(capabilities.channels) }
      : preservedCapabilities(employee);
    const syncedModes = mode === 'capability'
      ? boundExecutable.map((item) => boundaryPolicy.capabilityModes.find((modeItem) => modeItem.capabilityType === item.capabilityType && modeItem.capabilityName === item.capabilityName) ?? {
        ...item,
        mode: item.capabilityType === 'skill'
          ? 'recommend' as const
          : item.capabilityType === 'tool'
            ? defaultToolExecutionMode(capabilityCatalog, item.capabilityName)
            : 'approval_required' as const,
      })
      : boundaryPolicy.capabilityModes;
    const normalizedPolicy = {
      ...boundaryPolicy,
      capabilityModes: syncedModes,
      responsibilities: boundaryPolicy.responsibilities.map((item) => ({ ...item, title: item.title.trim(), objective: item.objective.trim(), trigger: item.trigger.trim(), deliverables: item.deliverables.filter(Boolean) })),
      handoff: {
        ...boundaryPolicy.handoff,
        triggers: boundaryPolicy.handoff.triggers.map((item) => item.trim()).filter(Boolean),
        approvers: boundaryPolicy.handoff.approvers.map((item) => item.trim()).filter(Boolean),
        notificationChannels: boundaryPolicy.handoff.notificationChannels.map((item) => item.trim()).filter(Boolean),
      },
    };
    const nextProfile = mode === 'capability'
      ? { name: employee.name, role: employee.role, department: employee.department, description: employee.description, owner: employee.owner, escalationOwner: employee.escalationOwner, serviceObject: employee.serviceObject, risk: employee.risk, environment: employee.environment }
      : profile;
    const nextMemory = mode === 'capability' ? employee.memoryPolicy : memory;
    save.mutate({
      scope: mode,
      profile: nextProfile,
      boundary: {
        responsibilities: normalizedPolicy.responsibilities.map((item) => item.title),
        prohibitedActions: normalizedPolicy.capabilityModes.filter((item) => item.mode === 'prohibited').map((item) => `禁止使用：${item.capabilityName}`),
        handoffPolicy: { triggers: normalizedPolicy.handoff.triggers, approvalRequiredFor: normalizedPolicy.capabilityModes.filter((item) => item.mode === 'approval_required').map((item) => item.capabilityName) },
        boundaryPolicy: normalizedPolicy,
      },
      capabilities: nextCapabilities,
      memoryPolicy: nextMemory,
    });
  };

  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (!embedded) return;
    onBindSave?.({
      save: () => submitRef.current(),
      pending: save.isPending,
      canSave: canMutate && blocking.length === 0,
    });
    return () => onBindSave?.(null);
  }, [embedded, onBindSave, save.isPending, canMutate, blocking.length]);

  const nav: Array<{ key: EmployeeConfigurationSection; label: string; note: string }> = mode === 'capability' ? [] : [
    { key: 'profile', label: '岗位档案', note: '身份与责任' },
    { key: 'boundary', label: '职责与边界', note: '可做与不可做' },
    { key: 'memory', label: '记忆策略', note: '三层沉淀策略' },
  ];

  const pendingVersion = versions.find((item) => item.status === 'pending_approval');
  const workbenchTitle = mode === 'capability' ? '受控能力装配' : '配置岗位授权契约';
  const workbenchDescription = mode === 'capability'
    ? '引用已发布模型与能力资产，并为技能/工具/流程设置执行授权；保存后立即生效。'
    : '维护岗位档案、职责边界、人工接管与记忆策略。保存后立即生效。';

  const validationAside = (
    <aside className="space-y-3 lg:w-[220px] lg:shrink-0">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
        <h3 className="text-xs font-semibold">配置校验</h3>
        <div className="mt-3 space-y-2 text-[11px]">
          {blocking.length
            ? blocking.map((item) => <div key={item} className="flex gap-1.5 text-[var(--danger)]"><XCircle className="mt-0.5 h-3 w-3 shrink-0" />待补齐：{item}</div>)
            : <div className="flex gap-1.5 text-[var(--success)]"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />必填配置已完整</div>}
          <div className="flex gap-1.5 text-[var(--text-secondary)]"><ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-[var(--brand)]" />可保存当前配置</div>
        </div>
      </section>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
        <h3 className="text-xs font-semibold">配置版本</h3>
        <div className="mt-3 space-y-3">
          {versions.slice(0, 3).map((version) => (
            <div key={version.id} className="text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{version.version}</span>
                <Badge tone={version.status === 'current' ? 'success' : version.status === 'pending_approval' ? 'warn' : 'neutral'}>{version.status === 'current' ? '当前' : version.status === 'pending_approval' ? '待审批' : '已替代'}</Badge>
              </div>
              <p className="mt-1 leading-4 text-[var(--text-muted)]">{version.changeSummary}</p>
              {version.status === 'pending_approval' && isAdmin && canMutate && version.updatedById !== user?.id && version.updatedBy !== user?.name && (
                <Button size="sm" className="mt-2 w-full" loading={approve.isPending && approve.variables?.versionId === version.id} onClick={() => approve.mutate({ versionId: version.id })}>批准并生效</Button>
              )}
              {version.status === 'pending_approval' && isAdmin && canMutate && (version.updatedById === user?.id || version.updatedBy === user?.name) && <p className="mt-2 text-[10px] text-[var(--text-muted)]">您是提交人，须由另一名管理员批准</p>}
            </div>
          ))}
          {!versions.length && <p className="text-[11px] text-[var(--text-muted)]">正在读取配置版本…</p>}
        </div>
      </section>
      {pendingVersion && <p className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-light)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)]">存在待审批配置 {pendingVersion.version}，批准前当前岗位不会改变。</p>}
    </aside>
  );

  const capabilityCapabilities: OnboardingCapabilities = {
    agentId: capabilities.agentId || undefined,
    model: capabilities.model,
    knowledge: lines(capabilities.knowledge),
    skills: lines(capabilities.skills),
    tools: lines(capabilities.tools),
    workflows: lines(capabilities.workflows),
    channels: lines(capabilities.channels),
    cognitive: employee.capabilities.cognitive,
  };
  const handleCapabilityChange = (next: OnboardingCapabilities) => {
    setCapabilities({
      ...capabilities,
      model: next.model,
      knowledge: next.knowledge.join('\n'),
      skills: next.skills.join('\n'),
      tools: next.tools.join('\n'),
      workflows: next.workflows.join('\n'),
      channels: next.channels.join('\n'),
    });
  };
  const handlePolicyChange = (next: DigitalPartnerBoundaryPolicy) => {
    setBoundaryPolicy(syncCapabilityModes(next, capabilityCapabilities, capabilityCatalog));
  };

  const inner = (
      <div className="space-y-4">
        {!embedded && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--bg-elevated)] px-4 py-3" style={{ boxShadow: 'var(--saas-ring)' }}>
          <div className="flex min-w-0 items-center gap-3">
            <EmployeeAvatar employee={employee} size={40} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">{employee.name}</h2>
                <Badge tone={lifecycleMeta[employee.lifecycle].tone}>{lifecycleMeta[employee.lifecycle].label}</Badge>
                <Badge tone={riskMeta[profile.risk].tone}>{riskMeta[profile.risk].label}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{employee.department} · {versions.find((item) => item.status === 'current')?.version ?? '配置 v1'}</p>
            </div>
          </div>
          <div className="rounded-lg bg-[var(--success-bg)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)]" style={{ boxShadow: 'var(--saas-ring)' }}>
            {mode === 'capability' ? '能力装配可直接保存生效' : alreadyOnDuty ? '岗位授权契约保存后立即生效' : '配置可保存，上岗前仍需完成评测'}
          </div>
        </section>
        )}
        {embedded && (
          <p className="text-xs leading-5 text-[var(--text-muted)]">
            {mode === 'capability' ? '引用已发布模型与能力资产，并为技能 / 工具 / 流程设置执行授权。保存本步后再进入上岗。' : '维护岗位档案、职责边界、人工接管与记忆策略。保存本步后再进入能力装配。'}
          </p>
        )}
        {mode === 'capability' && !roleContractReady && (
          <p role="status" className="rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-light)] px-3 py-2 text-xs text-[var(--text-secondary)]">
            岗位授权契约尚未完整，可先装配能力；上岗评测前请先补齐档案与职责。
          </p>
        )}
        {feedback && (
          <p
            role="status"
            className={cn(
              'rounded-lg border px-3 py-2 text-xs',
              feedback.kind === 'success' ? 'border-[var(--success)]/35 bg-[var(--success-bg)] text-[var(--text-secondary)]' : 'border-[var(--danger)]/35 bg-[var(--danger-light)] text-[var(--text-secondary)]',
            )}
          >
            {feedback.text}
          </p>
        )}
        {mode === 'capability' ? (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <OnboardingCapabilityBody
              employee={employee}
              catalog={capabilityCatalog}
              capabilities={capabilityCapabilities}
              onChangeCapabilities={handleCapabilityChange}
              policy={boundaryPolicy}
              onChangePolicy={handlePolicyChange}
            />
            {validationAside}
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[164px_minmax(0,1fr)_220px]">
            <aside>
              <p className="mb-2 px-3 text-[11px] font-medium text-[var(--text-muted)]">配置分区</p>
              <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="员工配置导航">
                {nav.map((item) => (
                  <button type="button" key={item.key} onClick={() => setSection(item.key)} className={cn('shrink-0 rounded-lg px-3 py-2.5 text-left transition-colors', section === item.key ? 'bg-[var(--brand-light)] text-[var(--brand)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')}>
                    <span className="block text-xs font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-[10px] opacity-75">{item.note}</span>
                  </button>
                ))}
              </nav>
            </aside>
            <main className="min-w-0 border-y border-[var(--border)] py-1 lg:border-y-0 lg:border-x lg:px-5">
              {section === 'profile' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold">岗位档案</h3>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">明确岗位身份、责任归属和服务范围；生产环境与高风险调整会进入受控变更。</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ProfileField label="员工名称（花名）" value={profile.name} onChange={(value) => setProfile({ ...profile, name: value })} placeholder="例如：北辰" required />
                    <ProfileField label="岗位名称" value={profile.role} onChange={(value) => setProfile({ ...profile, role: value })} placeholder="例如：信息技术部负责人" required />
                    <ProfileField label="所属部门" value={profile.department} onChange={(value) => setProfile({ ...profile, department: value })} placeholder="例如：信息技术部" required />
                    <ProfileField label="岗位负责人" value={profile.owner} onChange={(value) => setProfile({ ...profile, owner: value })} placeholder="明确业务责任人" />
                    <ProfileField label="人工接管负责人" value={profile.escalationOwner} onChange={(value) => setProfile({ ...profile, escalationOwner: value })} placeholder="异常或越权时的接管人" />
                    <ProfileField label="服务对象" value={profile.serviceObject} onChange={(value) => setProfile({ ...profile, serviceObject: value })} placeholder="例如：生产业务系统" />
                    <ProfileSelect label="风险等级" value={profile.risk} onChange={(value) => setProfile({ ...profile, risk: value as DigitalPartner['risk'] })} options={[['low', '低风险'], ['medium', '中风险'], ['high', '高风险']]} />
                    <ProfileSelect label="运行环境" value={profile.environment} onChange={(value) => setProfile({ ...profile, environment: value as DigitalPartner['environment'] })} options={[['sandbox', '沙箱环境'], ['staging', '预发环境'], ['production', '生产环境']]} />
                    <label className="grid gap-1.5 text-xs font-medium sm:col-span-2">岗位说明<textarea value={profile.description} onChange={(event) => setProfile({ ...profile, description: event.target.value })} rows={4} placeholder="说明服务目标、覆盖范围与人工介入边界。" className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-normal leading-5 outline-none focus:border-[var(--brand)]" /></label>
                  </div>
                </div>
              )}
              {section === 'boundary' && <BoundaryPolicyEditor policy={boundaryPolicy} capabilities={{ agentId: capabilities.agentId || undefined, model: capabilities.model, knowledge: lines(capabilities.knowledge), skills: lines(capabilities.skills), tools: lines(capabilities.tools), workflows: lines(capabilities.workflows), channels: lines(capabilities.channels) }} onChange={setBoundaryPolicy} mode="role" />}
              {section === 'memory' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold">三层记忆策略</h3>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">短期记忆支撑当前会话，工作记忆支撑岗位协作，长期记忆仅可通过审核沉淀为知识候选。</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ProfileNumberField label="短期记忆保留" value={memory.shortTermHours} suffix="小时" onChange={(value) => setMemory({ ...memory, shortTermHours: value })} />
                    <ProfileNumberField label="工作记忆保留" value={memory.workingDays} suffix="天" onChange={(value) => setMemory({ ...memory, workingDays: value })} />
                    <ProfileSelect label="长期记忆提炼" value={memory.longTermCadence} onChange={(value) => setMemory({ ...memory, longTermCadence: value as DigitalPartner['memoryPolicy']['longTermCadence'] })} options={[['daily', '每日提炼'], ['weekly', '每周提炼']]} />
                    <ProfileSelect label="转知识策略" value={memory.knowledgePromotion} onChange={(value) => setMemory({ ...memory, knowledgePromotion: value as DigitalPartner['memoryPolicy']['knowledgePromotion'] })} options={[['approval_required', '审核后转知识'], ['disabled', '不转知识']]} />
                  </div>
                  <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning-light)] p-3 text-xs leading-5 text-[var(--text-secondary)]"><Database className="mr-1 inline h-3.5 w-3.5 text-[var(--warning)]" />长期记忆不会直接成为企业知识；通过内容审核后，才进入知识中心的权威资产目录。</div>
                </div>
              )}
            </main>
            {validationAside}
          </div>
        )}
      </div>
  );

  if (layout === 'inline') {
    return (
      <div className="space-y-4">
        {inner}
        {canMutate && !embedded ? (
          <div className="flex justify-end">
            <Button loading={save.isPending} disabled={Boolean(blocking.length)} onClick={submit}><Save className="h-3.5 w-3.5" />保存配置</Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={workbenchTitle} description={canMutate ? workbenchDescription : '只读核查岗位契约与能力装配证据，不提交变更。'} size="xl" footer={canMutate ? <><Button variant="ghost" onClick={onClose}>取消</Button><Button loading={save.isPending} disabled={Boolean(blocking.length)} onClick={submit}><Save className="h-3.5 w-3.5" />保存配置</Button></> : <Button variant="ghost" onClick={onClose}>关闭</Button>}>
      {inner}
    </Modal>
  );
}

function ProfileField({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; required?: boolean }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {label}
      {required && <span className="ml-1 text-[var(--danger)]">*</span>}
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-xs font-normal outline-none focus:border-[var(--brand)]" />
    </label>
  );
}

function ProfileNumberField({ label, value, suffix, onChange }: { label: string; value: number; suffix: string; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {label}
      <input
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(Math.max(1, Number(event.target.value) || 1))}
        className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-xs font-normal outline-none focus:border-[var(--brand)]"
      />
      <span className="text-[10px] text-[var(--text-muted)]">{suffix}</span>
    </label>
  );
}

function ProfileSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-xs font-normal outline-none focus:border-[var(--brand)]">
        {options.map(([key, text]) => <option value={key} key={key}>{text}</option>)}
      </select>
    </label>
  );
}