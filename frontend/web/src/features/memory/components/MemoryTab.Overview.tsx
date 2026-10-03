/**
 * MemoryTab.Overview — 记忆生命周期 / 当前策略 / 最近审计。
 * M07 P1 拆分原因:原 pages/Memory.tsx 单文件 1043L。
 */
import { Link } from 'react-router-dom';
import { ArrowRight, ExternalLink, History, ShieldCheck } from 'lucide-react';
import { Badge } from '@qzda/web-ui';
import { EmptyState } from '@/components/shared';
import type { DigitalPartner, MemoryAuditEvent, MemoryLayer, MemoryPolicy, MemoryRecord } from '@qzda/web-types';
import { memoryAuditReactKey } from '@/features/memory/audit-list';
import {
  MemoryTabKey,
  MEMORY_LAYER,
  MEMORY_LAYER_TAB,
  memoryCapacityRatio,
  memoryFormatTime,
} from './MemoryShared';

type Props = {
  records: MemoryRecord[];
  policy?: MemoryPolicy;
  audit: MemoryAuditEvent[];
  employees: DigitalPartner[];
  employeeFilter: string;
  selectedEmployee?: DigitalPartner;
  onOpen: (tab: MemoryTabKey) => void;
  onEmployeeFilter: (value: string) => void;
};

export function MemoryTabOverview({
  records,
  policy,
  audit,
  employees,
  employeeFilter,
  selectedEmployee,
  onOpen,
  onEmployeeFilter,
}: Props) {
  const scoped = employeeFilter === 'all' ? records : records.filter((record) => record.digitalPartnerId === employeeFilter);
  const ratio = Math.min(1, memoryCapacityRatio(policy));
  const layers = (['short_term', 'working', 'long_term'] as MemoryLayer[]).map((layer) => ({
    layer,
    ...MEMORY_LAYER[layer],
    count: scoped.filter((record) => record.layer === layer && record.status === 'active').length,
  }));

  return (
    <div className="memory-overview">
      <div className="memory-section-head">
        <div>
          <h2>记忆生命周期</h2>
          <p>短期会话 → 工作证据 → 长期经验 → 知识候选；岗位策略可与工作区默认值对照。</p>
        </div>
        <select
          value={employeeFilter}
          onChange={(event) => onEmployeeFilter(event.target.value)}
          className="memory-select"
          aria-label="按数字伙伴筛选"
        >
          <option value="all">全部数字伙伴</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>{employee.name} · {employee.role}</option>
          ))}
        </select>
      </div>

      {selectedEmployee && (
        <div className="memory-employee-banner">
          <div>
            <strong>{selectedEmployee.name}</strong>
            <span>
              岗位策略：短期 {selectedEmployee.memoryPolicy.shortTermHours}h · 工作 {selectedEmployee.memoryPolicy.workingDays} 天 ·
              提炼 {selectedEmployee.memoryPolicy.longTermCadence === 'daily' ? '每日' : '每周'} ·
              转知识 {selectedEmployee.memoryPolicy.knowledgePromotion === 'approval_required' ? '需审核' : '关闭'}
            </span>
          </div>
          <Link to={`/partners?employeeId=${selectedEmployee.id}`} className="memory-text-link">
            打开岗位契约 <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}

      <div className="memory-lifecycle">
        {layers.map((item, index) => (
          <div key={item.layer} className="memory-lifecycle__item">
            <button type="button" className={`memory-lifecycle__card is-${item.tone}`} onClick={() => onOpen(MEMORY_LAYER_TAB[item.layer])}>
              <div className="memory-lifecycle__top">
                <Badge tone={item.tone}>{item.label}</Badge>
                <strong>{item.count}</strong>
              </div>
              <p>{item.desc}</p>
            </button>
            {index < layers.length - 1 && <ArrowRight className="memory-lifecycle__arrow" />}
          </div>
        ))}
        <div className="memory-lifecycle__item">
          <button type="button" className="memory-lifecycle__card is-warn" onClick={() => onOpen('candidates')}>
            <div className="memory-lifecycle__top">
              <Badge tone="warn">候选</Badge>
              <ArrowRight className="h-3.5 w-3.5 text-[var(--brand)]" />
            </div>
            <p>审核通过后进入知识中心草稿，不直接成为权威知识。</p>
          </button>
        </div>
      </div>

      <div className="memory-overview__grid">
        <section className="memory-panel">
          <div className="memory-panel__head">
            <h3><ShieldCheck className="h-4 w-4 text-[var(--brand)]" />当前工作区策略</h3>
            <p>默认 TTL、审批与容量边界，适用于本工作区全部数字伙伴。</p>
          </div>
          <div className="memory-policy-grid">
            <div className="memory-policy-stat">
              <span>短期保留</span>
              <strong>{policy?.shortTermTtlHours ?? 24}<small>小时</small></strong>
            </div>
            <div className="memory-policy-stat">
              <span>工作记忆保留</span>
              <strong>{policy?.workingMemoryTtlDays ?? 30}<small>天</small></strong>
            </div>
            <div className="memory-policy-stat">
              <span>长期写入审批</span>
              <strong className={policy?.longTermWriteApproval ? 'text-[var(--success)]' : ''}>{policy?.longTermWriteApproval ? '已启用' : '未启用'}</strong>
            </div>
            <div className="memory-policy-stat memory-policy-stat--wide">
              <div className="flex items-center justify-between gap-2">
                <span>长期容量</span>
                <strong>{policy?.usedCapacity ?? 0} / {policy?.longTermCapacity ?? 0}</strong>
              </div>
              <div className="memory-capacity-track" aria-hidden>
                <div className="memory-capacity-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
              </div>
            </div>
          </div>
          {selectedEmployee && (
            <p className="memory-policy-note">
              工作区默认 {policy?.shortTermTtlHours ?? 24}h / {policy?.workingMemoryTtlDays ?? 30} 天；
              {selectedEmployee.name} 岗位为 {selectedEmployee.memoryPolicy.shortTermHours}h / {selectedEmployee.memoryPolicy.workingDays} 天。
            </p>
          )}
        </section>

        <section className="memory-panel">
          <div className="memory-panel__head">
            <h3><History className="h-4 w-4 text-[var(--brand)]" />最近记忆变更</h3>
            <button type="button" className="memory-text-link" onClick={() => onOpen('governance')}>策略审计</button>
          </div>
          {audit.length ? (
            <div className="memory-audit-list">
              {audit.slice(0, 4).map((event, index) => (
                <div key={memoryAuditReactKey(event, index)} className="memory-audit-item">
                  <div>
                    <strong>{event.action}</strong>
                    <p>{event.target}</p>
                  </div>
                  <time>{memoryFormatTime(event.time)}</time>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={History} title="暂无记忆审计事件" />
          )}
        </section>
      </div>
    </div>
  );
}
