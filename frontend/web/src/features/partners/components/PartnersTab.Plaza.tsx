/**
 * 数字伙伴广场 Tab：
 *
 *  - `EmployeePlaza` — 岗位蓝图采用与采用记录列表
 *  - `PublishDepartmentTemplateModal` — 部门蓝图发布（待认证）
 *
 * 共享 UI 原语 / 常量（`riskMeta` / `lifecycleMeta`）来自 `PartnersShared`。
 */
import { useEffect, useMemo, useState } from 'react';
import type { DigitalPartner, DigitalPartnerTemplate, DigitalPartnerTemplateAdoption } from '@qzda/web-types';
import { Badge, Button } from '@qzda/web-ui';
import { Modal } from '@/components/shared';
import { cn } from '@qzda/web-utils';
import { DigitalPartnerAvatar } from './DigitalPartnerAvatar';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { roleCanMutate } from '@/features/role-nav/role-nav';
import { DIGITAL_EMPLOYEE_DEPARTMENT_ORDER } from '@/features/partners/lib/partners';
import { lifecycleMeta, riskMeta } from './PartnersShared';
import { ChevronLeft, ChevronRight, Plus, Search, Sparkles } from 'lucide-react';

const PLAZA_PAGE_SIZE = 4;

export function EmployeePlaza({ employees, onCreate, onAdopt, onClose }: { employees: DigitalPartner[]; onCreate: () => void; onAdopt: (employeeId: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('全部部门');
  const [source, setSource] = useState<'all' | 'platform' | 'department'>('all');
  const [publishOpen, setPublishOpen] = useState(false);
  const [page, setPage] = useState(1);
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const canMutate = roleCanMutate(useAuthStore((state) => state.user?.role));
  const { data: templates = [] } = useApiQuery<DigitalPartnerTemplate[]>(['digital-employee-templates'], '/api/partner-templates');
  const { data: adoptions = [] } = useApiQuery<DigitalPartnerTemplateAdoption[]>(['digital-employee-template-adoptions'], '/api/partner-template-adoptions');
  const adopt = useApiMutation<DigitalPartner, { templateId: string }>((input) => `/api/partner-templates/${input.templateId}/adopt`, { onSuccess: (employee) => onAdopt(employee.id) });
  const govern = useApiMutation<DigitalPartnerTemplate, { id: string; status: 'certified' | 'deprecated' }>((input) => `/api/partner-templates/${input.id}`, undefined, 'PATCH');
  const departments = useMemo(() => {
    const present = Array.from(new Set(templates.map((item) => item.department)));
    const ordered = DIGITAL_EMPLOYEE_DEPARTMENT_ORDER.filter((item) => present.includes(item));
    const rest = present.filter((item) => !DIGITAL_EMPLOYEE_DEPARTMENT_ORDER.includes(item)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return ['全部部门', ...ordered, ...rest];
  }, [templates]);
  const filtered = useMemo(
    () => templates.filter((item) => (department === '全部部门' || item.department === department) && (source === 'all' || item.source === source) && (!query || [item.name, item.role, item.department, ...item.tags].join(' ').toLowerCase().includes(query.toLowerCase()))),
    [templates, department, source, query],
  );
  useEffect(() => { setPage(1); }, [query, department, source]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PLAZA_PAGE_SIZE));
  const pageSafe = Math.min(page, pageCount);
  const pageItems = filtered.slice((pageSafe - 1) * PLAZA_PAGE_SIZE, pageSafe * PLAZA_PAGE_SIZE);
  const statusLabel = (status: DigitalPartnerTemplate['status']): readonly [string, 'success' | 'warn' | 'neutral'] => (
    status === 'certified' ? ['已认证', 'success'] : status === 'review' ? ['待认证', 'warn'] : ['已弃用', 'neutral']
  );
  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-xl bg-[var(--surface-1)]" style={{ boxShadow: 'var(--saas-ring), var(--saas-elev-1)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg"><Sparkles className="h-4 w-4" /></div>
              <h3 className="text-base font-semibold">岗位蓝图</h3>
            </div>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">采用已认证蓝图创建数字伙伴；仍需配置、评测后申请上岗。步骤：选蓝图 → 创建员工 → 完善门禁。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAdmin && canMutate && <Button size="sm" variant="secondary" onClick={() => setPublishOpen(true)}><Plus className="h-3.5 w-3.5" />发布部门蓝图</Button>}
            {canMutate && <Button size="sm" variant="secondary" onClick={onCreate}><Plus className="h-3.5 w-3.5" />新建自定义员工</Button>}
            <Button size="sm" variant="ghost" onClick={onClose}>关闭</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--bg)] px-5 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--brand)]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索岗位、部门或能力标签" className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] pl-8 pr-3 text-xs outline-none focus:border-[var(--brand)]" />
          </div>
          <select value={source} onChange={(event) => setSource(event.target.value as typeof source)} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs">
            <option value="all">全部来源</option>
            <option value="platform">平台认证</option>
            <option value="department">部门共享</option>
          </select>
        </div>
        <div className="flex gap-1 overflow-x-auto border-t border-[var(--border)] px-5 py-2.5">
          {departments.map((item) => (
            <button type="button" key={item} onClick={() => setDepartment(item)} className={cn('shrink-0 rounded-md px-3 py-1.5 text-xs', department === item ? 'bg-[var(--brand-light)] font-semibold text-[var(--brand)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]')}>{item}</button>
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">可采用蓝图</h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{filtered.length} 个蓝图 · 每页 {PLAZA_PAGE_SIZE} 个 · 认证蓝图可直接采用</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {pageItems.map((template) => {
            const [label, tone] = statusLabel(template.status);
            return (
              <article key={template.id} className="flex min-h-[285px] flex-col rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <DigitalPartnerAvatar employee={{ id: template.id, name: template.name, department: template.department }} size={40} />
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-semibold">{template.name}</h4>
                      <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{template.role}</p>
                    </div>
                  </div>
                  <Badge tone={tone}>{label}</Badge>
                </div>
                <p className="mt-3 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">{template.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone="neutral">{template.department}</Badge>
                  <Badge tone={riskMeta[template.risk].tone}>{riskMeta[template.risk].label}</Badge>
                  <Badge tone="info">v{template.version}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {template.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded bg-[var(--surface-1)] px-2 py-1 text-[11px] text-[var(--text-muted)]">{tag}</span>)}
                </div>
                <div className="mt-auto grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--text-muted)]">
                  <span>质量 {template.evaluationScore ?? '—'} 分</span>
                  <span className="text-right">已采用 {template.adoptionCount} 次</span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {canMutate && <Button size="sm" className="flex-1" disabled={template.status === 'deprecated'} loading={adopt.isPending && adopt.variables?.templateId === template.id} onClick={() => adopt.mutate({ templateId: template.id })}>采用并创建</Button>}
                  {isAdmin && canMutate && template.source === 'department' && template.status !== 'deprecated' && (
                    <Button size="sm" variant="secondary" loading={govern.isPending && govern.variables?.id === template.id} onClick={() => govern.mutate({ id: template.id, status: template.status === 'review' ? 'certified' : 'deprecated' })}>
                      {template.status === 'review' ? '认证' : '下架'}
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {pageCount > 1 && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
            <span className="text-[11px] text-[var(--text-muted)]">第 {pageSafe} / {pageCount} 页</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={pageSafe <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-3.5 w-3.5" />上一页</Button>
              <Button size="sm" variant="secondary" disabled={pageSafe >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>下一页<ChevronRight className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        )}
      </section>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h3 className="text-sm font-semibold">采用记录</h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">保留蓝图来源和版本；实例后续评测、上岗与审计独立执行。</p>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {adoptions.length ? adoptions.map((item) => {
            const template = templates.find((candidate) => candidate.id === item.templateId);
            const employee = employees.find((candidate) => candidate.id === item.employeeId);
            return (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <DigitalPartnerAvatar employee={{ id: template?.id ?? item.templateId, name: template?.name ?? item.templateId, department: template?.department }} size={32} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{template?.name ?? item.templateId}</div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">蓝图 v{item.templateVersion} · 采用人 {item.adoptedBy} · 员工 {employee?.name ?? '已归档'}</div>
                  </div>
                </div>
                <Badge tone={lifecycleMeta[item.status].tone}>{lifecycleMeta[item.status].label}</Badge>
              </div>
            );
          }) : <div className="px-5 py-8 text-center text-xs text-[var(--text-muted)]">尚未采用岗位蓝图</div>}
        </div>
      </section>
      <PublishDepartmentTemplateModal open={publishOpen} onClose={() => setPublishOpen(false)} />
    </div>
  );
}

function PublishDepartmentTemplateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="发布部门蓝图"
      description="蓝图仅在当前工作区共享，发布后进入待认证状态；不会直接创建或上岗数字伙伴。"
      size="md"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button loading={publish.isPending} disabled={!name.trim() || !role.trim() || !department.trim()} onClick={submit}>提交认证</Button>
        </>
      )}
    >
      <div className="grid gap-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-xs leading-5 text-[var(--text-muted)]">蓝图承载岗位边界与默认能力；模型、知识、技能、工作流和渠道仍须在各自中心完成治理与发布。</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <PlazaField label="蓝图名称" value={name} onChange={setName} placeholder="例如：变更风险分析专员" required />
          <PlazaField label="岗位角色" value={role} onChange={setRole} placeholder="例如：变更影响评估" required />
          <PlazaField label="所属部门" value={department} onChange={setDepartment} placeholder="例如：信息技术部" required />
          <PlazaField label="服务对象" value={serviceObject} onChange={setServiceObject} placeholder="例如：应用交付团队" />
          <PlazaSelectField label="风险等级" value={risk} onChange={(value) => setRisk(value as DigitalPartner['risk'])} options={[['low', '低风险'], ['medium', '中风险'], ['high', '高风险']]} />
          <PlazaField label="能力标签" value={tags} onChange={setTags} placeholder="例如：变更、风险评估" />
        </div>
        <label className="grid gap-1.5 text-xs font-medium">岗位说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="说明岗位服务目标、默认职责与需要人工介入的边界。" className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-normal outline-none focus:border-[var(--brand)]" /></label>
        {error && <p role="alert" className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-light)] px-3 py-2 text-xs text-[var(--danger)]">{error}</p>}
      </div>
    </Modal>
  );
}

function PlazaField({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; required?: boolean }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {label}
      {required && <span className="ml-1 text-[var(--danger)]">*</span>}
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-xs font-normal outline-none focus:border-[var(--brand)]" />
    </label>
  );
}

function PlazaSelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-xs font-normal outline-none focus:border-[var(--brand)]">
        {options.map(([key, text]) => <option value={key} key={key}>{text}</option>)}
      </select>
    </label>
  );
}