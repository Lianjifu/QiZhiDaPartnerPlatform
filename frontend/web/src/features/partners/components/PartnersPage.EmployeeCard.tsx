/**
 * 数字伙伴目录卡片（catalog grid 中使用）：
 *
 *  - 名称、岗位、生命周期、风险、上岗门禁、标签、能力按钮
 *  - 「发起协作」直接跳转 `/copilot?employeeId=...`；「班组调度」打开详情页班组分区
 */
import { useNavigate } from 'react-router-dom';
import type { DigitalPartner } from '@qzda/web-types';
import { Badge } from '@qzda/web-ui';
import { ArrowUpRight, MessageSquare, UsersRound } from 'lucide-react';
import { isDepartmentHead, partnerDetailPath } from '@/features/partners/lib/partners';
import { EmployeeAvatar, employeeTags, gateLabel, lifecycleMeta, riskMeta } from './PartnersShared';
import { employeePrimaryLabel, employeeSecondaryLabel } from '@/features/partners/lib/partners';
import { DeleteUnreleasedPartnerButton } from './PartnersDelete';

export function EmployeeCard({ employee, onSelect }: { employee: DigitalPartner; onSelect: () => void }) {
  const navigate = useNavigate();
  const meta = lifecycleMeta[employee.lifecycle];
  const tags = employeeTags(employee);
  const gate = gateLabel(employee);
  const head = isDepartmentHead(employee);
  return (
    <article className="de-employee-card group relative overflow-hidden rounded-xl bg-[var(--surface-1)] p-4 text-left">
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <EmployeeAvatar employee={employee} size={44} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <div className="truncate text-sm font-semibold text-[var(--text)]">{employeePrimaryLabel(employee)}</div>
                {employee.lifecycle === 'active' && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--success)]" title="在岗" />}
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-muted)]">{employeeSecondaryLabel(employee)}</div>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--brand)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {head && <Badge tone="info">部门负责人</Badge>}
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <Badge tone={riskMeta[employee.risk].tone}>{riskMeta[employee.risk].label}</Badge>
        </div>
        <p className="mt-2 text-[11px] text-[var(--text-secondary)]">{head ? '可调度本部门专家，并可发起跨部门协办。' : gate}</p>
        {tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{tags.map((tag) => <span key={tag} className="max-w-[110px] truncate rounded px-2 py-0.5 text-[10px] text-[var(--text-muted)]" style={{ boxShadow: 'var(--saas-ring)' }}>{tag}</span>)}</div>}
      </button>
      {employee.lifecycle === 'active' ? (
        <div className="mt-3 flex justify-end gap-2 pt-3" style={{ boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--brand) 14%, transparent)' }}>
          {head && <button type="button" className="de-employee-btn" onClick={(event) => { event.stopPropagation(); navigate(partnerDetailPath(employee.id, 'team')); }}><UsersRound className="h-3.5 w-3.5" />班组调度</button>}
          <button type="button" className="de-employee-btn de-employee-btn--primary" onClick={(event) => { event.stopPropagation(); navigate(`/copilot?employeeId=${employee.id}`); }}><MessageSquare className="h-3.5 w-3.5" />发起协作</button>
        </div>
      ) : (
        <div className="mt-3 flex justify-end gap-2 pt-3" style={{ boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--brand) 14%, transparent)' }}>
          <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <DeleteUnreleasedPartnerButton employee={employee} />
          </span>
          <button type="button" className="de-employee-btn de-employee-btn--primary" onClick={(event) => { event.stopPropagation(); navigate(`/partners/new?id=${employee.id}&step=role`); }}>继续配置</button>
        </div>
      )}
    </article>
  );
}
