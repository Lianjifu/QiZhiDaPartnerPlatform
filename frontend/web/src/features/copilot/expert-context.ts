/**
 * 专家上下文：仅从本会话/本消息真实数据派生，禁止演示硬编码。
 * P0–P3：岗位契约、工具明细、记忆命中、证据导出。
 */
import type { ChatMessageEx, Citation, ToolCall } from '@/hooks/types';
import type { DigitalEmployee } from '@de/web-types';
import type { RunMode } from './composer-mode';
import { runModeLabel } from './composer-mode';

export type ExpertContextRag = {
  attempted: boolean;
  backend?: string;
  hitCount: number;
  topK: number | null;
  label: string;
};

export type ExpertContextTools = {
  total: number;
  success: number;
  failed: number;
  avgMs: number | null;
};

export type ExpertContextToolItem = {
  id: string;
  name: string;
  status: ToolCall['status'];
  durationMs: number | null;
  error: string | null;
  permission: string | null;
  approvalPending: boolean;
  messageId: string;
};

export type ExpertContextMemoryHit = {
  id: string;
  title: string;
  layer: string;
  score: number | null;
};

export type ExpertContextTimelineItem = {
  tone: 'success' | 'info' | 'warn' | 'error';
  text: string;
  time: string;
  messageId?: string;
};

export type ExpertContextOverview = {
  citations: Citation[];
  tools: ExpertContextTools;
  toolItems: ExpertContextToolItem[];
  rag: ExpertContextRag;
  memoryHits: ExpertContextMemoryHit[];
  tokenUsed: number | null;
  modelLabel: string | null;
  providerLabel: string | null;
  durationMs: number | null;
  snapshotIds: string[];
  timeline: ExpertContextTimelineItem[];
  pendingApprovals: number;
  linkedTaskIds: string[];
};

export type ExpertJobContract = {
  role: string;
  name: string;
  department: string;
  version: string;
  risk: string;
  environment: string;
  serviceObject: string;
  description: string;
  responsibilities: string[];
  prohibitedActions: string[];
  model: string;
  knowledge: string[];
  skills: string[];
  tools: string[];
  workflows: string[];
  channels: string[];
  evaluationScore: number | null;
  owner: string;
  escalationOwner: string;
};

function isKnowledgeTool(name: string): boolean {
  return /knowledge|rag|retrieve|检索/i.test(name);
}

function formatClock(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return '—';
  }
}

function pushMemory(
  into: ExpertContextMemoryHit[],
  seen: Set<string>,
  rows: Array<{ id?: string; title?: string; layer?: string; score?: number }> | undefined,
) {
  for (const row of rows ?? []) {
    const id = String(row.id ?? row.title ?? '').trim();
    const title = String(row.title ?? row.id ?? '').trim();
    if (!title) continue;
    const key = `${id}|${title}|${row.layer ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    into.push({
      id: id || key,
      title,
      layer: String(row.layer ?? 'memory'),
      score: typeof row.score === 'number' ? row.score : null,
    });
  }
}

/** 从数字伙伴档案提炼岗位契约（无档案返回 null）。 */
export function deriveExpertJobContract(employee: DigitalEmployee | null | undefined): ExpertJobContract | null {
  if (!employee) return null;
  const structured = (employee.boundaryPolicy?.responsibilities ?? [])
    .map((item) => item.title || item.objective)
    .filter(Boolean) as string[];
  const responsibilities = structured.length ? structured : (employee.responsibilities ?? []).filter(Boolean);
  const prohibited = (employee.prohibitedActions ?? []).filter(Boolean);
  return {
    role: employee.role || employee.name,
    name: employee.name,
    department: employee.department || '—',
    version: employee.version || '—',
    risk: employee.risk || 'medium',
    environment: employee.environment || '—',
    serviceObject: employee.serviceObject || '—',
    description: employee.description || '',
    responsibilities: responsibilities.slice(0, 8),
    prohibitedActions: prohibited.slice(0, 8),
    model: employee.capabilities?.model || '—',
    knowledge: employee.capabilities?.knowledge ?? [],
    skills: employee.capabilities?.skills ?? [],
    tools: employee.capabilities?.tools ?? [],
    workflows: employee.capabilities?.workflows ?? [],
    channels: employee.capabilities?.channels ?? [],
    evaluationScore: typeof employee.evaluation?.score === 'number' ? employee.evaluation.score : null,
    owner: employee.owner || '—',
    escalationOwner: employee.escalationOwner || '—',
  };
}

export function deriveTurnProgress(message: ChatMessageEx | null | undefined) {
  const tasks = message?.turnTasks ?? message?.turnMeta?.tasks ?? [];
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: (t.status === 'running' || t.status === 'done' || t.status === 'failed' || t.status === 'cancelled' || t.status === 'pending')
      ? t.status
      : 'pending' as const,
    detail: 'detail' in t ? t.detail : undefined,
  }));
}

/** 从会话消息汇总专家上下文（优先当前选中消息集合）。 */
export function deriveExpertContextOverview(messages: ChatMessageEx[]): ExpertContextOverview {
  const citations: Citation[] = [];
  const toolCalls: Array<ToolCall & { messageId: string; approvalPending: boolean }> = [];
  const memoryHits: ExpertContextMemoryHit[] = [];
  const memorySeen = new Set<string>();
  const linkedTaskIds: string[] = [];
  const snapshotIds: string[] = [];
  let tokenUsed = 0;
  let hasToken = false;
  let modelLabel: string | null = null;
  let providerLabel: string | null = null;
  let durationMs: number | null = null;
  let ragBackend: string | undefined;
  let ragAttempted = false;
  let pendingApprovals = 0;

  for (const message of messages) {
    for (const c of message.citations ?? []) citations.push(c);
    const approvalPending = message.approvalRequest?.decision === 'pending';
    if (approvalPending) pendingApprovals += 1;
    for (const t of message.toolCalls ?? []) {
      toolCalls.push({ ...t, messageId: message.id, approvalPending });
      if (isKnowledgeTool(t.name)) {
        ragAttempted = true;
        const backend = t.args?.backend;
        if (typeof backend === 'string' && backend) ragBackend = backend;
      }
    }
    pushMemory(memoryHits, memorySeen, message.memoryProvenance);
    pushMemory(memoryHits, memorySeen, message.metrics?.memoryProvenance);
    if (message.linkedTaskId) linkedTaskIds.push(message.linkedTaskId);
    const m = message.metrics;
    if (m) {
      const tok = (m.promptTokens ?? 0) + (m.completionTokens ?? 0);
      if (tok > 0) {
        tokenUsed += tok;
        hasToken = true;
      }
      if (m.model) modelLabel = String(m.model);
      if (m.provider) providerLabel = String(m.provider);
      if (typeof m.durationMs === 'number' && m.durationMs > 0) {
        durationMs = (durationMs ?? 0) + m.durationMs;
      }
      if ((m.ragHits ?? 0) > 0 || (m.memoryHits ?? 0) > 0) ragAttempted = true;
      if (m.snapshotId) snapshotIds.push(m.snapshotId);
    }
  }

  const seenCite = new Set<string>();
  const uniqueCitations = citations.filter((c) => {
    const key = `${c.docId}|${c.source}|${c.text}`;
    if (seenCite.has(key)) return false;
    seenCite.add(key);
    return true;
  });

  const success = toolCalls.filter((t) => t.status === 'success').length;
  const failed = toolCalls.filter((t) => t.status === 'failed' || t.status === 'denied').length;
  const timed = toolCalls.filter((t) => typeof t.durationMs === 'number' && (t.durationMs ?? 0) > 0);
  const avgMs = timed.length
    ? Math.round(timed.reduce((s, t) => s + (t.durationMs ?? 0), 0) / timed.length)
    : null;

  if (uniqueCitations.length > 0) ragAttempted = true;

  const rag: ExpertContextRag = {
    attempted: ragAttempted,
    backend: ragBackend,
    hitCount: uniqueCitations.length,
    topK: uniqueCitations.length > 0 ? uniqueCitations.length : null,
    label: !ragAttempted
      ? '本回合未触发检索'
      : uniqueCitations.length > 0
        ? `命中 ${uniqueCitations.length} 条`
        : '已检索 · 无命中',
  };

  const toolItems: ExpertContextToolItem[] = toolCalls
    .slice()
    .reverse()
    .slice(0, 12)
    .map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      durationMs: typeof t.durationMs === 'number' ? t.durationMs : null,
      error: t.error || (t.status === 'failed' || t.status === 'denied' ? (t.result || '调用失败') : t.status === 'needs_instruction' ? (t.result || '待补全命令') : null),
      permission: t.permission ?? null,
      approvalPending: t.approvalPending,
      messageId: t.messageId,
    }));

  const timeline: ExpertContextTimelineItem[] = [];
  const recent = [...messages].reverse().slice(0, 10);
  for (const message of recent) {
    const time = formatClock(message.createdAt);
    if (message.role === 'assistant' && message.status === 'succeeded') {
      const model = message.metrics?.model || message.metrics?.provider;
      timeline.push({
        tone: 'success',
        text: model ? `助手回复完成 · ${model}` : '助手回复完成',
        time,
        messageId: message.id,
      });
    }
    if (message.status === 'failed') {
      timeline.push({
        tone: 'error',
        text: message.error?.message ? `回合失败 · ${message.error.message}` : '回合失败',
        time,
        messageId: message.id,
      });
    }
    for (const t of message.toolCalls ?? []) {
      const fail = t.status === 'failed' || t.status === 'denied';
      timeline.push({
        tone: t.status === 'needs_instruction' ? 'warn' : fail ? 'error' : 'info',
        text: fail && t.error
          ? `${t.name} · ${t.status} · ${t.error}`
          : `${t.name} · ${t.status === 'success' ? '成功' : t.status === 'needs_instruction' ? '待补全' : t.status}`,
        time,
        messageId: message.id,
      });
    }
    if (message.approvalRequest?.decision === 'pending') {
      timeline.push({ tone: 'warn', text: `写操作待审批 · ${message.approvalRequest.action}`, time, messageId: message.id });
    } else if (message.approvalRequest?.decision === 'approved') {
      timeline.push({ tone: 'success', text: '审批已通过', time, messageId: message.id });
    }
  }

  return {
    citations: uniqueCitations.slice(0, 12),
    tools: {
      total: toolCalls.length,
      success,
      failed,
      avgMs,
    },
    toolItems,
    rag,
    memoryHits: memoryHits.slice(0, 12),
    tokenUsed: hasToken ? tokenUsed : null,
    modelLabel,
    providerLabel,
    durationMs,
    snapshotIds: [...new Set(snapshotIds)].slice(0, 6),
    timeline: timeline.slice(0, 10),
    pendingApprovals,
    linkedTaskIds: [...new Set(linkedTaskIds)],
  };
}

export type ExpertEvidencePack = {
  exportedAt: string;
  scope: 'session' | 'message';
  expert: ExpertJobContract | null;
  runMode: RunMode;
  riskLevel: string;
  overview: ExpertContextOverview;
  compare?: {
    session: Pick<ExpertContextOverview, 'citations' | 'tools' | 'memoryHits' | 'pendingApprovals'>;
    message: Pick<ExpertContextOverview, 'citations' | 'tools' | 'memoryHits' | 'pendingApprovals'>;
  };
};

export function buildExpertEvidencePack(opts: {
  scope: 'session' | 'message';
  employee: DigitalEmployee | null | undefined;
  runMode: RunMode;
  riskLevel: string;
  overview: ExpertContextOverview;
  sessionOverview?: ExpertContextOverview;
  messageOverview?: ExpertContextOverview;
}): ExpertEvidencePack {
  const pack: ExpertEvidencePack = {
    exportedAt: new Date().toISOString(),
    scope: opts.scope,
    expert: deriveExpertJobContract(opts.employee),
    runMode: opts.runMode,
    riskLevel: opts.riskLevel,
    overview: opts.overview,
  };
  if (opts.sessionOverview && opts.messageOverview) {
    pack.compare = {
      session: {
        citations: opts.sessionOverview.citations,
        tools: opts.sessionOverview.tools,
        memoryHits: opts.sessionOverview.memoryHits,
        pendingApprovals: opts.sessionOverview.pendingApprovals,
      },
      message: {
        citations: opts.messageOverview.citations,
        tools: opts.messageOverview.tools,
        memoryHits: opts.messageOverview.memoryHits,
        pendingApprovals: opts.messageOverview.pendingApprovals,
      },
    };
  }
  return pack;
}

export function formatEvidencePackMarkdown(pack: ExpertEvidencePack): string {
  const lines: string[] = [
    '# 专家协作证据包',
    '',
    `- 导出时间：${pack.exportedAt}`,
    `- 范围：${pack.scope === 'message' ? '单条消息' : '整会话'}`,
    `- 模式：${runModeLabel(pack.runMode)}`,
    `- 风险：${pack.riskLevel}`,
    '',
  ];
  if (pack.expert) {
    lines.push('## 岗位专家', '');
    lines.push(`- ${pack.expert.role}（${pack.expert.name}）· ${pack.expert.department} · v${pack.expert.version}`);
    if (pack.expert.responsibilities.length) {
      lines.push('- 职责：');
      pack.expert.responsibilities.forEach((item) => lines.push(`  - ${item}`));
    }
    if (pack.expert.prohibitedActions.length) {
      lines.push('- 禁止项：');
      pack.expert.prohibitedActions.forEach((item) => lines.push(`  - ${item}`));
    }
    lines.push('');
  }
  lines.push('## 检索与引用', '');
  lines.push(`- ${pack.overview.rag.label}`);
  pack.overview.citations.forEach((c) => {
    lines.push(`- [${c.source}] ${c.docId}${c.text ? ` — ${c.text.slice(0, 120)}` : ''}`);
  });
  lines.push('', '## 记忆命中', '');
  if (!pack.overview.memoryHits.length) lines.push('- （无）');
  pack.overview.memoryHits.forEach((m) => lines.push(`- [${m.layer}] ${m.title}`));
  lines.push('', '## 工具调用', '');
  if (!pack.overview.toolItems.length) lines.push('- （无）');
  pack.overview.toolItems.forEach((t) => {
    lines.push(`- ${t.name} · ${t.status}${t.error ? ` · ${t.error}` : ''}`);
  });
  if (pack.compare) {
    lines.push('', '## 会话 vs 消息对比', '');
    lines.push('| 指标 | 会话 | 消息 |');
    lines.push('| --- | --- | --- |');
    lines.push(`| 引用 | ${pack.compare.session.citations.length} | ${pack.compare.message.citations.length} |`);
    lines.push(`| 工具 | ${pack.compare.session.tools.total} | ${pack.compare.message.tools.total} |`);
    lines.push(`| 记忆 | ${pack.compare.session.memoryHits.length} | ${pack.compare.message.memoryHits.length} |`);
    lines.push(`| 待审批 | ${pack.compare.session.pendingApprovals} | ${pack.compare.message.pendingApprovals} |`);
  }
  return `${lines.join('\n')}\n`;
}
