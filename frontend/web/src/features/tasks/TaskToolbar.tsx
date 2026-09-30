import { Check, ChevronDown, List, Plus, Search, TableProperties } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ControlledTask, Priority, TaskLifecycleStage, TaskRisk } from '@de/web-types';
import { getStageMeta, riskLabel } from './task-ui';

export type TaskFilters = {
  search: string; stage: TaskLifecycleStage | 'all'; assignee: string; risk: TaskRisk | 'all' | 'attention';
  priority: Priority | 'all'; agent: string; source: ControlledTask['source'] | 'all';
  approval: ControlledTask['governance']['approvalStatus'] | 'all'; blocked: boolean; archived: boolean;
};

export const defaultTaskFilters: TaskFilters = { search: '', stage: 'all', assignee: 'all', risk: 'all', priority: 'all', agent: 'all', source: 'all', approval: 'all', blocked: false, archived: false };

type SelectOption = { value: string; label: string };

function Select({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: SelectOption[]; label: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, []);
  return <div ref={root} className="task-filter-select">
    <button type="button" aria-label={label} aria-expanded={open} className="task-filter-trigger" onClick={() => setOpen((current) => !current)}>{selected?.label}<ChevronDown size={16} /></button>
    {open && <div className="task-filter-menu" role="listbox" aria-label={`${label}选项`}>
      {options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} className={option.value === value ? 'active' : ''} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{option.value === value && <Check size={15} />}</button>)}
    </div>}
  </div>;
}

export function TaskToolbar({ filters, onChange, view, onViewChange, tasks, onCreate }: {
  filters: TaskFilters; onChange: (next: TaskFilters) => void; view: 'board' | 'list'; onViewChange: (view: 'board' | 'list') => void;
  tasks: ControlledTask[]; onCreate?: () => void;
}) {
  const update = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => onChange({ ...filters, [key]: value });
  const assignees = Array.from(new Set(tasks.map((task) => task.assignee).filter(Boolean))) as string[];
  const employees = Array.from(
    new Map(
      tasks
        .filter((task) => task.digitalEmployeeId || task.digitalEmployeeName)
        .map((task) => [task.digitalEmployeeId ?? task.digitalEmployeeName!, task.digitalEmployeeName ?? task.digitalEmployeeId!]),
    ).entries(),
  );
  return <div className="task-toolbar">
    <label className="task-search"><Search size={16} /><input value={filters.search} onChange={(event) => update('search', event.target.value)} placeholder="搜索任务、编号、专家、来源" /></label>
    <Select label="状态" value={filters.stage} onChange={(value) => update('stage', value as TaskFilters['stage'])} options={[{ value: 'all', label: '全部状态' }, ...(['pending', 'running', 'human_action', 'risk', 'completed'] as TaskLifecycleStage[]).map((stage) => ({ value: stage, label: getStageMeta(stage).label }))]} />
    <Select label="负责人" value={filters.assignee} onChange={(value) => update('assignee', value)} options={[{ value: 'all', label: '全部负责人' }, ...assignees.map((name) => ({ value: name, label: name }))]} />
    <Select label="风险" value={filters.risk} onChange={(value) => update('risk', value as TaskFilters['risk'])} options={[{ value: 'all', label: '全部风险' }, { value: 'attention', label: '风险异常' }, ...(['warning', 'critical', 'overdue', 'failed', 'blocked'] as TaskRisk[]).map((risk) => ({ value: risk, label: riskLabel(risk) }))]} />
    <Select label="优先级" value={filters.priority} onChange={(value) => update('priority', value as TaskFilters['priority'])} options={[{ value: 'all', label: '全部优先级' }, ...(['P0', 'P1', 'P2', 'P3'] as Priority[]).map((value) => ({ value, label: value }))]} />
    <Select label="数字伙伴" value={filters.agent} onChange={(value) => update('agent', value)} options={[{ value: 'all', label: '全部数字伙伴' }, ...employees.map(([value, label]) => ({ value, label }))]} />
    <Select label="来源" value={filters.source} onChange={(value) => update('source', value as TaskFilters['source'])} options={[{ value: 'all', label: '全部来源' }, { value: 'conversation', label: '会话' }, { value: 'alert', label: '告警' }, { value: 'manual', label: '手工创建' }]} />
    <Select label="审批状态" value={filters.approval} onChange={(value) => update('approval', value as TaskFilters['approval'])} options={[{ value: 'all', label: '全部审批状态' }, { value: 'pending', label: '待双重审批' }, { value: 'approved', label: '已批准' }, { value: 'rejected', label: '已拒绝' }]} />
    <div className="task-toolbar-actions"><div className="task-view-toggle"><button aria-label="看板视图" className={view === 'board' ? 'active' : ''} onClick={() => onViewChange('board')}><TableProperties size={16} /></button><button aria-label="列表视图" className={view === 'list' ? 'active' : ''} onClick={() => onViewChange('list')}><List size={16} /></button></div>{onCreate && <button type="button" className="task-create-btn" onClick={onCreate}><Plus size={16} />新建任务</button>}</div>
  </div>;
}
