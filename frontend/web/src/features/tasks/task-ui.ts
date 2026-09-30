import type { ControlledTask, TaskLifecycleStage, TaskRisk } from '@de/web-types';

export const STAGES: TaskLifecycleStage[] = ['pending', 'running', 'human_action', 'risk', 'completed'];

const stages: Record<TaskLifecycleStage, { label: string; tone: 'neutral' | 'info' | 'warn' | 'error' | 'success' }> = {
  pending: { label: '待处理', tone: 'warn' },
  running: { label: '协同中', tone: 'info' },
  human_action: { label: '待专家确认', tone: 'warn' },
  risk: { label: '风险异常', tone: 'error' },
  completed: { label: '已完成', tone: 'success' },
  archived: { label: '已归档', tone: 'neutral' },
};

export function getStageMeta(stage: TaskLifecycleStage) {
  return stages[stage];
}

export function isRiskTask(sla: Pick<ControlledTask['sla'], 'risk'> | { risk: TaskRisk }) {
  return sla.risk !== 'none';
}

export type PrimaryAction = { key: 'start' | 'human_action' | 'takeover' | 'retry' | 'pause' | 'archive'; label: string };

export function getPrimaryAction(stage: TaskLifecycleStage, risk: TaskRisk): PrimaryAction {
  if (stage === 'risk' && risk === 'failed') return { key: 'takeover', label: '专家接管' };
  if (stage === 'risk') return { key: 'retry', label: '重试协同' };
  if (stage === 'pending') return { key: 'start', label: '开始协同' };
  if (stage === 'running') return { key: 'pause', label: '暂停任务' };
  if (stage === 'human_action') return { key: 'human_action', label: '处理专家确认' };
  return { key: 'archive', label: '确认归档' };
}

export function riskLabel(risk: TaskRisk) {
  return ({ none: '正常', warning: '临期', critical: '高风险', overdue: '已超时', failed: '执行失败', blocked: '依赖阻塞' } as const)[risk];
}

export function sourceLabel(source: ControlledTask['source']) {
  return ({ alert: '告警', conversation: '会话', workflow: '能力触发', manual: '手工创建', dispatch: '负责人调度' } as const)[source];
}

export function dispatchKindLabel(kind?: ControlledTask['dispatchKind']) {
  if (kind === 'assign') return '本部门派工';
  if (kind === 'assist') return '跨部门协办';
  return '未标注';
}

export function assistStatusLabel(status?: ControlledTask['assistStatus']) {
  if (status === 'pending') return '待协办确认';
  if (status === 'accepted') return '协办已接受';
  if (status === 'rejected') return '协办已拒绝';
  if (status === 'not_required') return '无需协办确认';
  return '—';
}

/** 卡片/列表下一步文案：已完成不得再显示「等待下一步」 */
export function nextStepLabel(task: Pick<ControlledTask, 'lifecycleStage' | 'execution'>) {
  if (task.execution?.currentStep) return task.execution.currentStep;
  if (task.lifecycleStage === 'completed' || task.lifecycleStage === 'archived') return '可归档';
  if (task.lifecycleStage === 'pending') return '待开始';
  if (task.lifecycleStage === 'human_action') return '待专家确认';
  if (task.lifecycleStage === 'running') return '与数字伙伴协同中';
  if (task.lifecycleStage === 'risk') return '需处置风险';
  return '查看详情';
}

export function employeeLabel(task: Pick<ControlledTask, 'digitalEmployeeName' | 'digitalEmployeeId' | 'agentId'>) {
  return task.digitalEmployeeName ?? task.digitalEmployeeId ?? '未指定';
}

/** 真实 API 可能缺 links/governance 等字段；统一补默认避免运行时崩溃 */
export function normalizeControlledTask(raw: Partial<ControlledTask> & Pick<ControlledTask, 'id' | 'title'>): ControlledTask {
  const sla = raw.sla ?? { risk: 'none' as const, escalated: false };
  return {
    id: raw.id,
    code: raw.code ?? raw.id,
    title: raw.title,
    description: raw.description,
    priority: raw.priority ?? 'P2',
    status: raw.status ?? 'pending',
    assignee: raw.assignee,
    digitalEmployeeId: raw.digitalEmployeeId,
    digitalEmployeeName: raw.digitalEmployeeName,
    agentId: raw.agentId,
    progress: raw.progress ?? { done: 0, total: 1 },
    tags: raw.tags ?? [],
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
    lifecycleStage: raw.lifecycleStage ?? 'pending',
    source: raw.source ?? 'manual',
    sla: { remainingMin: sla.remainingMin, dueAt: sla.dueAt, risk: sla.risk ?? 'none', escalated: Boolean(sla.escalated) },
    execution: {
      runId: raw.execution?.runId,
      currentStep: raw.execution?.currentStep,
      retryCount: raw.execution?.retryCount ?? 0,
      error: raw.execution?.error,
      paused: Boolean(raw.execution?.paused),
    },
    governance: {
      approvalRequired: Boolean(raw.governance?.approvalRequired),
      approvalStatus: raw.governance?.approvalStatus ?? 'not_required',
      takeoverBy: raw.governance?.takeoverBy,
      takeoverReason: raw.governance?.takeoverReason,
      policyBlocked: raw.governance?.policyBlocked,
    },
    links: {
      conversationId: raw.links?.conversationId,
      alertCode: raw.links?.alertCode,
      workflowId: raw.links?.workflowId,
      assetName: raw.links?.assetName,
      blockedBy: raw.links?.blockedBy,
    },
    auditEvents: raw.auditEvents ?? [],
    version: raw.version ?? 0,
    dispatchKind: raw.dispatchKind,
    coordinatorId: raw.coordinatorId,
    coordinatorName: raw.coordinatorName,
    collaboratorIds: raw.collaboratorIds,
    collaboratorNames: raw.collaboratorNames,
    assistStatus: raw.assistStatus,
    relatedTaskCode: raw.relatedTaskCode,
    slaRemainingMin: raw.slaRemainingMin,
  };
}

export function conversationHref(task: Pick<ControlledTask, 'links' | 'digitalEmployeeId'> | { links?: ControlledTask['links']; digitalEmployeeId?: string }) {
  const conversationId = task.links?.conversationId;
  if (!conversationId) return null;
  const params = new URLSearchParams();
  params.set('session', conversationId);
  if (task.digitalEmployeeId) params.set('employeeId', task.digitalEmployeeId);
  return `/copilot?${params.toString()}`;
}
