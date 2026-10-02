/**
 * 数字伙伴边界策略编辑器：
 *
 *  - `resolveBoundaryPolicy` — 兼容历史职责字段，重建结构化契约
 *  - `BoundaryPolicyEditor` — 岗位契约 (role) / 能力授权模式 (capability)
 *
 * 详情面板（`ProfileContent` / `StructuredBoundaryContent` 等）见 `PartnersDetail.Panels`。
 */
import type {
  DigitalPartner,
  DigitalPartnerBoundaryPolicy,
  DigitalPartnerExecutionMode,
  DigitalPartnerResponsibility,
} from '@qzda/web-types';
import { Badge } from '@qzda/web-ui';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@qzda/web-ui';
import { executionModeOptions, environmentOptions } from './PartnersShared';

export function resolveBoundaryPolicy(employee: DigitalPartner): DigitalPartnerBoundaryPolicy {
  const stored = employee.boundaryPolicy;
  const storedIsComplete =
    !!stored &&
    Array.isArray(stored.responsibilities) &&
    Array.isArray(stored.capabilityModes) &&
    Array.isArray(stored.allowedEnvironments) &&
    !!stored.handoff &&
    Array.isArray(stored.handoff.triggers) &&
    Array.isArray(stored.handoff.approvers) &&
    Array.isArray(stored.handoff.notificationChannels);
  if (storedIsComplete) {
    return {
      ...stored,
      responsibilities: stored.responsibilities.map((item) => ({ ...item, deliverables: [...(item.deliverables ?? [])] })),
      capabilityModes: stored.capabilityModes.map((item) => ({ ...item })),
      allowedEnvironments: [...stored.allowedEnvironments],
      handoff: {
        ...stored.handoff,
        triggers: [...stored.handoff.triggers],
        approvers: [...stored.handoff.approvers],
        notificationChannels: [...stored.handoff.notificationChannels],
      },
    };
  }
  return {
    responsibilities: employee.responsibilities.map((title, index) => ({
      id: `${employee.id}-responsibility-${index}`,
      title,
      objective: '在岗位授权范围内形成可复核的业务结果。',
      trigger: '收到工作请求或命中服务事件',
      deliverables: ['处理结论与处置证据'],
      evidenceRequired: true,
    })),
    capabilityModes: [
      ...employee.capabilities.tools.map((capabilityName) => ({ capabilityType: 'tool' as const, capabilityName, mode: 'approval_required' as DigitalPartnerExecutionMode })),
      ...employee.capabilities.workflows.map((capabilityName) => ({ capabilityType: 'workflow' as const, capabilityName, mode: 'approval_required' as DigitalPartnerExecutionMode })),
      ...employee.capabilities.skills.map((capabilityName) => ({ capabilityType: 'skill' as const, capabilityName, mode: 'recommend' as DigitalPartnerExecutionMode })),
    ],
    dataClassification: employee.risk === 'high' ? 'restricted' : 'confidential',
    allowedEnvironments: [employee.environment],
    handoff: {
      triggers: employee.handoffPolicy?.triggers?.length ? [...employee.handoffPolicy.triggers] : ['命中禁止行为', '需要业务判断'],
      approvers: [employee.escalationOwner],
      notificationChannels: [...employee.capabilities.channels],
      slaMinutes: employee.risk === 'high' ? 15 : 30,
    },
  };
}

function Field({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; required?: boolean }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {label}
      {required && <span className="ml-1 text-[var(--danger)]">*</span>}
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-xs font-normal outline-none focus:border-[var(--brand)]" />
    </label>
  );
}

function NumberField({ label, value, suffix, onChange }: { label: string; value: number; suffix: string; onChange: (value: number) => void }) {
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

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-xs font-normal outline-none focus:border-[var(--brand)]">
        {options.map(([key, text]) => <option value={key} key={key}>{text}</option>)}
      </select>
    </label>
  );
}

/** `BoundaryPolicyEditor` — 岗位契约 (role) 或 能力授权模式 (capability)。 */
export function BoundaryPolicyEditor({ policy, capabilities, onChange, mode = 'role' }: { policy: DigitalPartnerBoundaryPolicy; capabilities: DigitalPartner['capabilities']; onChange: (policy: DigitalPartnerBoundaryPolicy) => void; mode?: 'role' | 'capability' }) {
  const updateResponsibility = (index: number, patch: Partial<DigitalPartnerResponsibility>) =>
    onChange({ ...policy, responsibilities: policy.responsibilities.map((item, current) => current === index ? { ...item, ...patch } : item) });
  const setHandoff = (key: keyof DigitalPartnerBoundaryPolicy['handoff'], value: string[] | number) =>
    onChange({ ...policy, handoff: { ...policy.handoff, [key]: value } });
  const rows = [
    ...capabilities.tools.map((capabilityName) => ({ capabilityType: 'tool' as const, capabilityName, label: '工具' })),
    ...capabilities.workflows.map((capabilityName) => ({ capabilityType: 'workflow' as const, capabilityName, label: '工作流' })),
    ...capabilities.skills.map((capabilityName) => ({ capabilityType: 'skill' as const, capabilityName, label: '技能' })),
  ];
  const setCapabilityMode = (capabilityType: 'tool' | 'workflow' | 'skill', capabilityName: string, modeValue: DigitalPartnerExecutionMode) => {
    const exists = policy.capabilityModes.some((item) => item.capabilityType === capabilityType && item.capabilityName === capabilityName);
    onChange({
      ...policy,
      capabilityModes: exists
        ? policy.capabilityModes.map((item) => item.capabilityType === capabilityType && item.capabilityName === capabilityName ? { ...item, mode: modeValue } : item)
        : [...policy.capabilityModes, { capabilityType, capabilityName, mode: modeValue }],
    });
  };
  const modeOf = (capabilityType: 'tool' | 'workflow' | 'skill', capabilityName: string) =>
    policy.capabilityModes.find((item) => item.capabilityType === capabilityType && item.capabilityName === capabilityName)?.mode ?? 'recommend';
  const setEnvironment = (environment: DigitalPartnerBoundaryPolicy['allowedEnvironments'][number], checked: boolean) =>
    onChange({ ...policy, allowedEnvironments: checked ? [...new Set([...policy.allowedEnvironments, environment])] : policy.allowedEnvironments.filter((item) => item !== environment) });
  const addResponsibility = () => onChange({
    ...policy,
    responsibilities: [...policy.responsibilities, { id: `responsibility-${Date.now()}`, title: '未命名岗位职责', objective: '', trigger: '', deliverables: [], evidenceRequired: true }],
  });
  const updateArrayItem = (key: 'triggers' | 'approvers' | 'notificationChannels', index: number, value: string) =>
    setHandoff(key, policy.handoff[key].map((item, current) => current === index ? value : item));
  const addArrayItem = (key: 'triggers' | 'approvers' | 'notificationChannels', placeholder: string) =>
    setHandoff(key, [...policy.handoff[key], placeholder]);

  if (mode === 'capability') {
    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5">
          <div>
            <h3 className="text-sm font-semibold">执行边界（能力授权模式）</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">仅可对当前已装配的工具、工作流和技能授予执行模式；能力本体仍由各中心独立治理。岗位职责请到「岗位配置」维护。</p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <div className="min-w-[540px] divide-y divide-[var(--border)] text-xs">
              <div className="grid grid-cols-[minmax(180px,1fr)_92px_150px] gap-3 px-2 pb-2 text-[11px] text-[var(--text-muted)]"><span>已绑定能力</span><span>类型</span><span>授权模式</span></div>
              {rows.map((row) => (
                <div key={`${row.capabilityType}-${row.capabilityName}`} className="grid grid-cols-[minmax(180px,1fr)_92px_150px] items-center gap-3 px-2 py-2.5">
                  <span className="truncate font-medium">{row.capabilityName}</span>
                  <Badge tone="info">{row.label}</Badge>
                  <select value={modeOf(row.capabilityType, row.capabilityName)} onChange={(event) => setCapabilityMode(row.capabilityType, row.capabilityName, event.target.value as DigitalPartnerExecutionMode)} className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs outline-none focus:border-[var(--brand)]">
                    {executionModeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
              ))}
              {!rows.length && <p className="px-2 py-3 text-xs text-[var(--text-muted)]">请先在上方引用至少一项工具、工作流或技能。</p>}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">岗位职责</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">每项职责需说明目标、触发条件与可复核交付，构成岗位授权的业务契约。</p>
          </div>
          <Button size="sm" variant="secondary" onClick={addResponsibility}><Plus className="h-3.5 w-3.5" />新增职责</Button>
        </div>
        <div className="mt-3 space-y-3">
          {policy.responsibilities.map((item, index) => (
            <article key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[var(--brand)]">职责 {String(index + 1).padStart(2, '0')}</span>
                {policy.responsibilities.length > 1 && (
                  <button type="button" onClick={() => onChange({ ...policy, responsibilities: policy.responsibilities.filter((_, current) => current !== index) })} className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--danger-light)] hover:text-[var(--danger)]" aria-label={`删除职责 ${item.title}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="职责名称" value={item.title} onChange={(value) => updateResponsibility(index, { title: value })} placeholder="例如：运行态势汇总" required />
                <Field label="业务目标" value={item.objective} onChange={(value) => updateResponsibility(index, { objective: value })} placeholder="例如：形成风险优先级建议" required />
                <Field label="触发条件" value={item.trigger} onChange={(value) => updateResponsibility(index, { trigger: value })} placeholder="例如：每日 09:00 / 重大事件" required />
                <Field label="交付与证据" value={item.deliverables.join('、')} onChange={(value) => updateResponsibility(index, { deliverables: value.split('、').map((entry) => entry.trim()).filter(Boolean) })} placeholder="例如：态势摘要、风险清单" />
                <label className="flex items-center gap-2 text-xs font-medium sm:col-span-2">
                  <input type="checkbox" checked={item.evidenceRequired} onChange={(event) => updateResponsibility(index, { evidenceRequired: event.target.checked })} />
                  要求留存处置证据
                </label>
              </div>
            </article>
          ))}
        </div>
      </section>
      <div className="rounded-lg border border-[var(--brand)]/20 bg-[var(--brand-light)] px-3 py-2.5 text-xs leading-5 text-[var(--text-secondary)]">
        能力授权模式（工具/技能/工作流执行边界）请到「能力装配」维护；此处只定义岗位职责与人工接管契约。
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5">
          <h3 className="text-sm font-semibold">升级与审批</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">命中触发条件后中止自主执行，通知接管人并保留审批、交接证据。</p>
          <div className="mt-3 space-y-2">
            {([['triggers', '接管触发条件', '例如：置信度不足'] as const, ['approvers', '接管负责人', '例如：值班经理'] as const, ['notificationChannels', '通知渠道', '例如：事件中心'] as const]).map(([key, label, placeholder]) => (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-medium">{label}</span>
                  <button type="button" onClick={() => addArrayItem(key, placeholder)} className="text-[11px] text-[var(--brand)]">+ 添加</button>
                </div>
                {policy.handoff[key].map((value, index) => (
                  <div key={`${key}-${index}`} className="mb-1.5 flex gap-1.5">
                    <input value={value} onChange={(event) => updateArrayItem(key, index, event.target.value)} placeholder={placeholder} className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs outline-none focus:border-[var(--brand)]" />
                    {policy.handoff[key].length > 1 && (
                      <button type="button" onClick={() => setHandoff(key, policy.handoff[key].filter((_, current) => current !== index))} className="rounded-md px-2 text-[var(--text-muted)] hover:bg-[var(--danger-light)] hover:text-[var(--danger)]">×</button>
                    )}
                  </div>
                ))}
              </div>
            ))}
            <NumberField label="接管 SLA" value={policy.handoff.slaMinutes} suffix="分钟" onChange={(value) => setHandoff('slaMinutes', value)} />
          </div>
        </section>
        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5">
          <h3 className="text-sm font-semibold">数据与范围</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">仅声明此岗位策略允许使用的数据级别和运行环境，不替代零信任、数据权限策略。</p>
          <div className="mt-3 grid gap-3">
            <SelectField label="最高数据分类" value={policy.dataClassification} onChange={(value) => onChange({ ...policy, dataClassification: value as DigitalPartnerBoundaryPolicy['dataClassification'] })} options={[['internal', '内部'], ['confidential', '敏感'], ['restricted', '受限']]} />
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium">允许运行环境</legend>
              <div className="flex flex-wrap gap-3">
                {environmentOptions.map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    <input type="checkbox" checked={policy.allowedEnvironments.includes(value)} onChange={(event) => setEnvironment(value, event.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </section>
      </div>
    </div>
  );
}
