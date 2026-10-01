/**
 * 将 Copilot SSE 事件映射为对人阅读友好的「思考」步骤，
 * 并分离生成进度文案（不进思考面板）。
 */
import type { ReasoningStep } from '@/hooks/types';

export type ThoughtEventLike = {
  type?: string;
  stage?: string;
  status?: string;
  title?: string;
  detail?: string;
  kind?: string;
  name?: string;
  mode?: string;
  reason?: string;
  goal?: string;
  critique?: string;
  summary?: string;
  round?: number;
  index?: number;
  total?: number;
  hitCount?: number;
  memoryHits?: number;
  ragHits?: number;
  action?: string;
  step?: number;
  warning?: string;
  error?: string;
  task?: string;
  preview?: string;
  department?: string;
  employeeId?: string;
  policyLevel?: string;
  provenance?: Array<{ id?: string; title?: string; layer?: string }>;
  steps?: unknown;
  specialists?: unknown;
  framework?: string;
  frameworkLabel?: string;
  phase?: string;
  phases?: string[];
  phaseStep?: string;
  role?: string;
  confidence?: number;
};

const KIND_LABEL: Record<ReasoningStep['kind'], string> = {
  plan: '计划',
  search: '检索',
  analyze: '判断',
  tool_call: '调用',
  reflect: '反思',
  finalize: '收尾',
  framework: '思路',
};

export function thoughtKindLabel(kind: ReasoningStep['kind']): string {
  return KIND_LABEL[kind] ?? '思考';
}

function uid(): string {
  return `rs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function step(
  kind: ReasoningStep['kind'],
  title: string,
  detail?: string,
  phase?: string,
): ReasoningStep {
  return {
    id: uid(),
    kind,
    title,
    detail: detail?.trim() || undefined,
    phase,
    startedAt: new Date().toISOString(),
  };
}

function provenanceTitles(provenance?: ThoughtEventLike['provenance']): string {
  if (!Array.isArray(provenance) || !provenance.length) return '';
  return provenance
    .map((p) => p.title || p.id || '')
    .filter(Boolean)
    .slice(0, 4)
    .join(' · ');
}

/** 显式 thought 事件：后端已给出人话，原样采纳。 */
function fromExplicitThought(data: ThoughtEventLike): ReasoningStep | null {
  const title = (data.title ?? '').trim();
  if (!title) return null;
  let kindRaw = (data.kind ?? 'analyze').toLowerCase();
  const kind: ReasoningStep['kind'] =
    kindRaw === 'plan' || kindRaw === 'search' || kindRaw === 'analyze'
      || kindRaw === 'tool_call' || kindRaw === 'reflect' || kindRaw === 'finalize'
      || kindRaw === 'framework'
      ? kindRaw
      : 'analyze';
  const base = step(kind, title, data.detail ?? data.summary ?? data.critique);
  if (data.framework) base.framework = data.framework;
  if (data.frameworkLabel) base.frameworkLabel = data.frameworkLabel;
  if (data.mode && (data.framework || data.phases || kind === 'framework')) base.cognitiveMode = data.mode;
  if (data.phase) base.phase = data.phase;
  if (data.phaseStep) base.phaseStep = data.phaseStep;
  if (Array.isArray(data.phases) && data.phases.length) base.phases = data.phases.map(String);
  if (data.role) base.role = data.role;
  if (typeof data.confidence === 'number') base.confidence = data.confidence;
  return base;
}

/**
 * 将 SSE 映射为思考步骤；返回 null 表示不进思考面板（进度/调试类事件）。
 */
export function toHumanThoughtStep(
  typ: string,
  data: ThoughtEventLike,
): ReasoningStep | null {
  const t = (typ || data.type || '').toLowerCase();

  if (t === 'thought') {
    return fromExplicitThought(data);
  }

  if (t === 'stage') {
    return mapStageThought(data);
  }
  if (t === 'route') {
    // 路由属运行时细节，不进思考；进度条另算
    return null;
  }
  if (t === 'plan') {
    return mapPlanThought(data);
  }
  if (t === 'reflect') {
    return mapReflectThought(data);
  }
  if (t === 'agent') {
    return mapAgentThought(data);
  }
  if (t === 'evolve') {
    const title = data.title?.trim();
    if (!title && data.status !== 'ok') return null;
    return step(
      'analyze',
      title ? `沉淀经验：${title}` : '记录可复用经验',
      data.summary || data.status,
    );
  }
  if (t === 'authorization') {
    return step('analyze', '需人工确认后继续', data.name || data.title);
  }
  return null;
}

function mapStageThought(data: ThoughtEventLike): ReasoningStep | null {
  const stage = (data.stage ?? '').toLowerCase();
  const status = (data.status ?? '').toLowerCase();

  // 流水线心跳：policy / employee / meter / safety / runtime running 等 → 不进思考
  if (['policy', 'employee', 'meter', 'safety', 'runtime'].includes(stage)) {
    return null;
  }
  if (stage === 'react' || stage === 'execute') {
    if (status === 'ok' && data.action === 'final') {
      return step('finalize', '准备输出回复', undefined, 'plan');
    }
    return null;
  }

  if (stage === 'memory') {
    if (status === 'running') return null;
    const n = typeof data.hitCount === 'number'
      ? data.hitCount
      : (Array.isArray(data.provenance) ? data.provenance.length : 0);
    if (status === 'degraded') {
      return step('search', '记忆读取受限', data.warning || '已降级继续', 'understand');
    }
    if (n <= 0) return null;
    const titles = provenanceTitles(data.provenance);
    return step('search', `参考了 ${n} 条相关记忆`, titles || undefined, 'understand');
  }

  if (stage === 'rag') {
    if (status === 'running') return null;
    const n = typeof data.hitCount === 'number' ? data.hitCount : 0;
    if (status === 'degraded') {
      return step('search', '知识检索受限', data.warning || '已降级继续', 'understand');
    }
    if (n <= 0) return null;
    return step('search', `检索到 ${n} 条已发布知识`, undefined, 'understand');
  }

  return null;
}

function mapPlanThought(data: ThoughtEventLike): ReasoningStep | null {
  const status = (data.status ?? 'ready').toLowerCase();
  if (status === 'ready') {
    const goal = (data.goal || data.title || '').trim();
    const count = Array.isArray(data.steps) ? data.steps.length : 0;
    return step(
      'plan',
      goal ? `计划：${goal}` : '已拟定执行计划',
      count > 0 ? `共 ${count} 步` : undefined,
      'plan',
    );
  }
  if (status === 'step_running') {
    const title = (data.title || '').trim();
    const idx = data.index;
    const total = data.total;
    const prefix = idx != null && total != null ? `第 ${idx}/${total} 步` : '执行计划步骤';
    return step('plan', title ? `${prefix}：${title}` : prefix, undefined, 'plan');
  }
  if (status === 'completed') {
    return step('finalize', '计划步骤已完成', undefined, 'plan');
  }
  if (status === 'failed') {
    return step('analyze', '计划执行遇到问题', data.error || data.reason, 'plan');
  }
  return null;
}

function mapReflectThought(data: ThoughtEventLike): ReasoningStep | null {
  const status = (data.status ?? '').toLowerCase();
  // running → 进度条；ok → 后端 thought 事件已给浓缩句，避免重复
  if (status === 'running' || status === 'ok') {
    return null;
  }
  if (status === 'failed') {
    return step('reflect', '质量复核未完成', data.error, 'reflect');
  }
  return null;
}

function mapAgentThought(data: ThoughtEventLike): ReasoningStep | null {
  const status = (data.status ?? 'delegating').toLowerCase();
  const name = data.name || data.employeeId || '专家';
  if (status === 'supervising') {
    const n = Array.isArray(data.specialists) ? data.specialists.length : 0;
    return step('analyze', n > 0 ? `协调 ${n} 位专家会商` : '协调多位专家', undefined, 'plan');
  }
  if (status === 'delegating') {
    return step('plan', `请 ${name} 协助`, data.task || data.preview, 'plan');
  }
  if (status === 'delegated') {
    return step('analyze', `已收到 ${name} 的结果`, data.preview || data.department, 'execute');
  }
  if (status === 'completed') {
    return step('finalize', '多专家会商完成', undefined, 'plan');
  }
  if (status === 'fallback') {
    return step('analyze', '暂无可用子专家，改为自行处理', data.reason, 'plan');
  }
  return null;
}

/**
 * 生成态进度文案（气泡「正在执行」），不写入思考面板。
 */
export function progressLabelFromEvent(typ: string, data: ThoughtEventLike): string | null {
  const t = (typ || data.type || '').toLowerCase();
  if (t === 'thought' && data.title) {
    return data.title;
  }
  if (t === 'stage') {
    const stage = (data.stage ?? '').toLowerCase();
    const status = (data.status ?? '').toLowerCase();
    if (status !== 'running' && status !== 'ok' && status !== 'degraded') return null;
    switch (stage) {
      case 'policy':
        return status === 'running' ? '校验访问策略' : null;
      case 'employee':
        return status === 'running' ? '准备岗位专家' : null;
      case 'memory':
        return status === 'running' ? '读取相关记忆' : null;
      case 'rag':
        return status === 'running' ? '检索知识库' : null;
      case 'runtime':
        return status === 'running' ? '模型处理中' : status === 'ok' ? '整理回复' : null;
      case 'meter':
        return null;
      case 'react':
      case 'execute':
        if (data.action === 'final') return '整理回复';
        if (data.action === 'bootstrap_retrieve') return '补充检索上下文';
        return status === 'running' ? '分析并调用能力' : null;
      case 'safety':
        return null;
      default:
        return status === 'running' ? '处理中' : null;
    }
  }
  if (t === 'route') {
    const mode = (data.mode ?? '').toLowerCase();
    if (mode === 'plan_exec' || mode === 'plan') return '制定方案';
    if (mode === 'multi_agent') return '协调专家';
    if (mode === 'direct') return '直接作答';
    return '开始推理';
  }
  if (t === 'plan') {
    if (data.status === 'step_running') return data.title ? `执行：${data.title}` : '执行计划步骤';
    if (data.status === 'ready') return '制定计划';
    return null;
  }
  if (t === 'reflect' && data.status === 'running') return '检查回复质量';
  if (t === 'tool' && data.status === 'running') {
    const name = data.name || '能力';
    return `调用 ${name}`;
  }
  if (t === 'agent') {
    if (data.status === 'delegating') return `请 ${data.name || '专家'} 协助`;
    if (data.status === 'supervising') return '协调专家会商';
  }
  return null;
}

/** 合并相邻同义步骤，避免 stage ok/running 刷屏。 */
export function mergeThoughtSteps(steps: ReasoningStep[]): ReasoningStep[] {
  if (steps.length < 2) return steps;
  const out: ReasoningStep[] = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (prev && sameThoughtFingerprint(prev, s)) {
      out[out.length - 1] = {
        ...prev,
        detail: s.detail || prev.detail,
        endedAt: s.startedAt || prev.endedAt,
      };
      continue;
    }
    out.push(s);
  }
  return out;
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

function sameThoughtFingerprint(a: ReasoningStep, b: ReasoningStep): boolean {
  if (a.kind !== b.kind) return false;
  // 同框架相邻阶段可合并，避免步骤爆炸
  if (a.framework && b.framework && a.framework === b.framework && a.kind === 'plan' && b.kind === 'plan') {
    if ((a.title.startsWith('思路阶段') || a.phase) && (b.title.startsWith('思路阶段') || b.phase)) {
      return true;
    }
  }
  return normalizeTitle(a.title) === normalizeTitle(b.title);
}

export function appendHumanThought(
  existing: ReasoningStep[],
  next: ReasoningStep | null,
): ReasoningStep[] {
  if (!next) return existing;
  return mergeThoughtSteps([...existing, next]);
}
