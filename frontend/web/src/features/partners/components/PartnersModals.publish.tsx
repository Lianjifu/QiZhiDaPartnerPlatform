import { useState } from 'react';
import type { DigitalPartner, DigitalPartnerTemplate } from '@qzda/web-types';
import { Button } from '@qzda/web-ui';
import { Modal } from '@/components/shared';
import { useApiMutation } from '@/services/query';

/** 发布部门蓝图（岗位蓝图）模态表单。
 * 从广场视图触发，发布后进入待认证状态；不会直接创建或上岗数字伙伴。 */
export function PublishDepartmentTemplateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [department, setDepartment] = useState('');
  const [serviceObject, setServiceObject] = useState('');
  const [description, setDescription] = useState('');
  const [risk, setRisk] = useState<DigitalPartner['risk']>('low');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const publish = useApiMutation<DigitalPartnerTemplate, Partial<DigitalPartnerTemplate>>('/api/partner-templates', {
    onSuccess: () => { setError(null); onClose(); },
    onError: (reason) => setError(reason instanceof Error ? reason.message : '模板发布失败，请稍后重试。'),
  });
  const submit = () => {
    if (!name.trim() || !role.trim() || !department.trim()) return;
    publish.mutate({ name, role, department, serviceObject, description, risk, tags: tags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean) });
  };
  return <Modal open={open} onClose={onClose} title="发布部门蓝图" description="蓝图仅在当前工作区共享，发布后进入待认证状态；不会直接创建或上岗数字伙伴。" size="md" footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button loading={publish.isPending} disabled={!name.trim() || !role.trim() || !department.trim()} onClick={submit}>提交认证</Button></>}><div className="grid gap-4"><div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-xs leading-5 text-[var(--text-muted)]">蓝图承载岗位边界与默认能力；模型、知识、技能、工作流和渠道仍须在各自中心完成治理与发布。</div><div className="grid gap-3 sm:grid-cols-2"><Field label="蓝图名称" value={name} onChange={setName} placeholder="例如：变更风险分析专员" required /><Field label="岗位角色" value={role} onChange={setRole} placeholder="例如：变更影响评估" required /><Field label="所属部门" value={department} onChange={setDepartment} placeholder="例如：信息技术部" required /><Field label="服务对象" value={serviceObject} onChange={setServiceObject} placeholder="例如：应用交付团队" /><SelectField label="风险等级" value={risk} onChange={(value) => setRisk(value as DigitalPartner['risk'])} options={[['low', '低风险'], ['medium', '中风险'], ['high', '高风险']]} /><Field label="能力标签" value={tags} onChange={setTags} placeholder="例如：变更、风险评估" /></div><label className="grid gap-1.5 text-xs font-medium">岗位说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="说明岗位服务目标、默认职责与需要人工介入的边界。" className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-normal outline-none focus:border-[var(--brand)]" /></label>{error && <p role="alert" className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-light)] px-3 py-2 text-xs text-[var(--danger)]">{error}</p>}</div></Modal>;
}

function Field({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; required?: boolean }) {
  return <label className="grid gap-1.5 text-xs font-medium">{label}{required && <span className="ml-1 text-[var(--danger)]">*</span>}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-xs font-normal outline-none focus:border-[var(--brand)]" /></label>;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label className="grid gap-1.5 text-xs font-medium">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-xs font-normal outline-none focus:border-[var(--brand)]">{options.map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select></label>;
}