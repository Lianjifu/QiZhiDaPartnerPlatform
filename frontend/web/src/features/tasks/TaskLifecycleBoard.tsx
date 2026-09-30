import { AlertTriangle, ArrowRight, MessagesSquare, UserRound } from 'lucide-react';
import type { ControlledTask, TaskLifecycleStage } from '@qzda/web-types';
import { Badge } from '@qzda/web-ui';
import { STAGES, employeeLabel, getStageMeta, isRiskTask, nextStepLabel, riskLabel, sourceLabel } from './task-ui';

const priorityTone = { P0: 'error', P1: 'warn', P2: 'info', P3: 'neutral' } as const;
const riskTone = (task: ControlledTask) => task.lifecycleStage === 'risk' || isRiskTask(task.sla ?? { risk: 'none' }) ? 'error' : 'neutral';
const slaText = (task: ControlledTask) => task.sla?.remainingMin === undefined ? '未设 SLA' : task.sla.remainingMin < 0 ? `超时 ${Math.abs(task.sla.remainingMin)} 分钟` : `${task.sla.remainingMin} 分钟内`;

function TaskCard({ task, onOpen, disabled }: { task: ControlledTask; onOpen: (task: ControlledTask) => void; disabled: boolean }) {
  const risk = task.lifecycleStage === 'risk' || isRiskTask(task.sla ?? { risk: 'none' });
  return <article className="task-lifecycle-card" draggable={!disabled} aria-busy={disabled || undefined} onDragStart={(event) => { if (disabled) event.preventDefault(); else event.dataTransfer.setData('text/task-id', task.id); }} onClick={() => { if (!disabled) onOpen(task); }}>
    <div className="task-card-top"><Badge tone={priorityTone[task.priority]}>{task.priority}</Badge><span className={risk ? 'task-sla risk' : 'task-sla'}>{risk && <AlertTriangle size={13} />}{slaText(task)}</span></div>
    <h3>{task.title}</h3><p>{getStageMeta(task.lifecycleStage).label} · {nextStepLabel(task)}</p>
    <footer><span><UserRound size={13} />{task.assignee ?? '未分派'}</span><span>{employeeLabel(task)}</span></footer>
    <div className="task-card-meta"><span>{sourceLabel(task.source)}</span>{task.links?.conversationId && <span className="task-card-session"><MessagesSquare size={12} />会话关联</span>}</div>
    {(risk || task.lifecycleStage === 'human_action' || task.dispatchKind) && <div className="task-card-flag">{task.dispatchKind === 'assist' && task.assistStatus === 'pending' ? '待协办确认' : task.dispatchKind === 'assign' ? '本部门派工' : task.lifecycleStage === 'human_action' ? (task.governance?.approvalStatus === 'pending' ? '待双重审批' : '需要专家确认') : riskLabel(task.sla?.risk ?? 'none')}</div>}
    <button className="task-card-open" type="button" disabled={disabled} onClick={(event) => { event.stopPropagation(); if (!disabled) onOpen(task); }}>打开详情 <ArrowRight size={14} /></button>
  </article>;
}

export function TaskLifecycleBoard({ tasks, view, disabled = false, onOpen, onTransition }: { tasks: ControlledTask[]; view: 'board' | 'list'; disabled?: boolean; onOpen: (task: ControlledTask) => void; onTransition: (task: ControlledTask, stage: TaskLifecycleStage) => void }) {
  if (view === 'list') return <div className={disabled ? 'task-list-panel is-pending' : 'task-list-panel'}><table><thead><tr><th>任务编号与标题</th><th>当前阶段</th><th>优先级</th><th>负责人</th><th>工作伙伴</th><th>来源</th><th>SLA</th><th>最后更新</th><th /></tr></thead><tbody>{tasks.map((task) => <tr key={task.id} aria-disabled={disabled || undefined} onClick={() => { if (!disabled) onOpen(task); }}><td><code>{task.code}</code><strong>{task.title}</strong></td><td><Badge tone={getStageMeta(task.lifecycleStage).tone}>{getStageMeta(task.lifecycleStage).label}</Badge></td><td><Badge tone={priorityTone[task.priority]}>{task.priority}</Badge></td><td>{task.assignee ?? '未分派'}</td><td>{employeeLabel(task)}</td><td>{sourceLabel(task.source)}</td><td className={riskTone(task) === 'error' ? 'task-list-risk' : ''}>{slaText(task)}</td><td>{new Date(task.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td><button type="button" disabled={disabled} onClick={(event) => { event.stopPropagation(); if (!disabled) onOpen(task); }}>打开详情</button></td></tr>)}</tbody></table>{tasks.length === 0 && <p className="task-empty">没有符合当前条件的任务。</p>}</div>;
  return <div className={disabled ? 'task-lifecycle-board is-pending' : 'task-lifecycle-board'}>{STAGES.map((stage) => <section key={stage} className="task-lifecycle-column" onDragOver={(event) => { if (!disabled) event.preventDefault(); }} onDrop={(event) => { if (disabled) return; const task = tasks.find((item) => item.id === event.dataTransfer.getData('text/task-id')); if (task && task.lifecycleStage !== stage) onTransition(task, stage); }}><header><span>{getStageMeta(stage).label}</span><b>{tasks.filter((task) => task.lifecycleStage === stage).length}</b></header><div>{tasks.filter((task) => task.lifecycleStage === stage).map((task) => <TaskCard key={task.id} task={task} onOpen={onOpen} disabled={disabled} />)}</div></section>)}</div>;
}
