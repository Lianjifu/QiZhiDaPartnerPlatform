/**
 * 工作流模块共享类型、常量、helper 与小组件。
 *
 * 拆分原因：原 pages/Workflows.tsx 单文件 4479L（M06 P1 整合），按 D1 决策拆为 9 个子文件；
 * 此处集中共享部分，避免每个 tab 文件重复声明。
 */
import { Handle, Position, applyNodeChanges, type Node, type Edge } from 'reactflow';
import {
  PlayCircle, Clock, Bell, Database, Wrench, Cpu, GitBranch, ShieldCheck,
  FileText, Webhook, RefreshCw, RotateCcw, MessageSquare, ArrowRight,
} from 'lucide-react';
import type { WorkflowNodeKind, WorkflowSkill } from '@qzda/web-types';
import { cn } from '@qzda/web-utils';
import {
  DEFAULT_VISIBLE_TEMPLATES,
  type ConnectorBindings, type DepartmentKey, type TemplateUpgradeDiff,
  type WorkflowTemplateAsset,
} from '@/features/workflows/department-templates';

export type { WorkflowNodeKind };

export const NODE_ICONS: Record<WorkflowNodeKind, any> = {
  trigger: PlayCircle, schedule: Clock, event: Bell,
  retrieve: Database, transform: Wrench,
  decision: Cpu, condition: GitBranch, approval: ShieldCheck, policy: ShieldCheck,
  branch: GitBranch, parallel: GitBranch,
  execute: Wrench, http: Webhook, mcp: Cpu, task: FileText,
  retry: RefreshCw, compensate: RotateCcw, audit: FileText, notify: Bell,
};
export const NODE_LABELS: Record<WorkflowNodeKind, string> = {
  trigger: 'Webhook 触发', schedule: '定时调度', event: '告警事件',
  retrieve: '知识检索', transform: '数据转换',
  decision: '数字伙伴研判', condition: '条件判断', approval: '人工审批', policy: '风险策略',
  branch: '条件分支', parallel: '并行编排',
  execute: '执行受控动作', http: 'HTTP / API', mcp: 'MCP 工具', task: '创建任务',
  retry: '重试策略', compensate: '补偿回滚', audit: '审计留痕', notify: '结果通知',
};
export const NODE_COLORS: Record<WorkflowNodeKind, string> = {
  trigger: '#3b82f6', schedule: '#3b82f6', event: '#3b82f6',
  retrieve: '#10b981', transform: '#10b981',
  decision: '#8b5cf6', condition: '#8b5cf6', approval: '#f59e0b', policy: '#f59e0b',
  branch: '#06b6d4', parallel: '#06b6d4',
  execute: '#ef4444', http: '#ef4444', mcp: '#ef4444', task: '#ef4444',
  retry: '#f59e0b', compensate: '#f59e0b', audit: '#64748b', notify: '#38bdf8',
};
export const NODE_DESCS: Record<WorkflowNodeKind, string> = {
  trigger: '接收外部系统 Webhook 请求', schedule: '按 Cron 或日历规则发起流程', event: '订阅监控告警或消息事件',
  retrieve: '查询知识库、运行手册与历史证据', transform: '映射、清洗并标准化上下文数据',
  decision: '由数字伙伴分析上下文并生成处置决策', condition: '基于表达式判断后续路径', approval: '按审批人、超时与签名规则复核', policy: '校验风险等级、权限和变更策略',
  branch: '按条件选择唯一处置路径', parallel: '并发执行多个独立步骤并汇聚',
  execute: '调用已纳管 Skill 完成受控处置动作', http: '调用企业内部或第三方 API', mcp: '调用受控 MCP 工具', task: '创建人工处置任务并回传结果',
  retry: '按退避策略自动重试可恢复失败', compensate: '执行补偿动作或回滚变更', audit: '写入可追溯的审计证据', notify: '通过飞书、企微、钉钉等通知结果',
};

export type NodeLibraryCategory = 'trigger' | 'context' | 'decision' | 'action' | 'governance' | 'reliability';
export type NodeRisk = 'standard' | 'review' | 'sensitive';

export const NODE_LIBRARY_GROUPS: Array<{ id: NodeLibraryCategory; label: string; desc: string; kinds: WorkflowNodeKind[] }> = [
  { id: 'trigger', label: '触发与输入', desc: '定义数字伙伴何时开始工作', kinds: ['trigger', 'schedule', 'event'] },
  { id: 'context', label: '上下文与数据', desc: '补齐处置所需的证据与变量', kinds: ['retrieve', 'transform'] },
  { id: 'decision', label: '智能决策', desc: '由规则或数字伙伴研判决定处置路径', kinds: ['decision', 'condition', 'branch', 'parallel'] },
  { id: 'action', label: '执行与协同', desc: '调用受控能力或派发人工工作', kinds: ['execute', 'http', 'mcp', 'task'] },
  { id: 'governance', label: '人工与治理', desc: '在关键动作前实施权限和审批控制', kinds: ['policy', 'approval', 'audit'] },
  { id: 'reliability', label: '可靠性与收尾', desc: '处理失败、补偿并通知相关人员', kinds: ['retry', 'compensate', 'notify'] },
];

export const NODE_LIBRARY_META: Record<WorkflowNodeKind, { category: NodeLibraryCategory; risk: NodeRisk; badge?: string }> = {
  trigger: { category: 'trigger', risk: 'standard' }, schedule: { category: 'trigger', risk: 'standard' }, event: { category: 'trigger', risk: 'standard' },
  retrieve: { category: 'context', risk: 'standard' }, transform: { category: 'context', risk: 'standard' },
  decision: { category: 'decision', risk: 'review', badge: 'AI' }, condition: { category: 'decision', risk: 'standard' }, branch: { category: 'decision', risk: 'standard' }, parallel: { category: 'decision', risk: 'standard' },
  execute: { category: 'action', risk: 'sensitive', badge: '已纳管 Skill' }, http: { category: 'action', risk: 'sensitive', badge: '外部调用' }, mcp: { category: 'action', risk: 'sensitive', badge: '受控工具' }, task: { category: 'action', risk: 'review', badge: '人工协同' },
  policy: { category: 'governance', risk: 'review', badge: '策略' }, approval: { category: 'governance', risk: 'review', badge: '需审批' }, audit: { category: 'governance', risk: 'standard' },
  retry: { category: 'reliability', risk: 'review', badge: '失败处理' }, compensate: { category: 'reliability', risk: 'sensitive', badge: '回滚' }, notify: { category: 'reliability', risk: 'standard' },
};

export const NODE_LIB = NODE_LIBRARY_GROUPS.flatMap((group) => group.kinds);

export function recommendedNodeKinds(sourceKind?: WorkflowNodeKind): WorkflowNodeKind[] {
  if (!sourceKind) return ['trigger', 'event', 'schedule', 'retrieve', 'decision'];
  const category = NODE_LIBRARY_META[sourceKind].category;
  if (category === 'trigger') return ['retrieve', 'transform', 'decision', 'condition'];
  if (category === 'context') return ['decision', 'condition', 'branch', 'policy'];
  if (category === 'decision') return ['policy', 'approval', 'execute', 'http', 'mcp', 'task'];
  if (category === 'action') return ['audit', 'retry', 'compensate', 'notify'];
  if (category === 'governance') return ['execute', 'http', 'mcp', 'audit', 'notify'];
  return ['audit', 'notify', 'task', 'compensate'];
}

export const EMPTY_NODES: Node[] = [];
export const EMPTY_EDGES: Edge[] = [];
export const SAMPLE_NODES: Node[] = [
  { id: 'n1', type: 'custom', position: { x: 60, y: 80 }, data: { kind: 'trigger', label: 'Webhook 触发' } },
  { id: 'n2', type: 'custom', position: { x: 280, y: 80 }, data: { kind: 'retrieve', label: '知识检索' } },
  { id: 'n3', type: 'custom', position: { x: 500, y: 80 }, data: { kind: 'decision', label: '数字伙伴研判' } },
  { id: 'n4', type: 'custom', position: { x: 720, y: 80 }, data: { kind: 'approval', label: '双重审批' } },
  { id: 'n5', type: 'custom', position: { x: 940, y: 40 }, data: { kind: 'branch', label: '分支：成功路径' } },
  { id: 'n6', type: 'custom', position: { x: 940, y: 160 }, data: { kind: 'branch', label: '分支：回滚路径' } },
  { id: 'n7', type: 'custom', position: { x: 1180, y: 40 }, data: { kind: 'execute', label: '执行受控恢复' } },
  { id: 'n8', type: 'custom', position: { x: 1180, y: 160 }, data: { kind: 'execute', label: '回滚 + 告警' } },
  { id: 'n9', type: 'custom', position: { x: 1420, y: 100 }, data: { kind: 'audit', label: '审计留痕' } },
  { id: 'n10', type: 'custom', position: { x: 1660, y: 100 }, data: { kind: 'notify', label: '飞书 / 企微通知' } },
];
export const SAMPLE_EDGES: Edge[] = [
  { id: 'e1-2', source: 'n1', target: 'n2' }, { id: 'e2-3', source: 'n2', target: 'n3' },
  { id: 'e3-4', source: 'n3', target: 'n4' }, { id: 'e4-5', source: 'n4', target: 'n5' },
  { id: 'e4-6', source: 'n4', target: 'n6' }, { id: 'e5-7', source: 'n5', target: 'n7' },
  { id: 'e6-8', source: 'n6', target: 'n8' }, { id: 'e7-9', source: 'n7', target: 'n9' },
  { id: 'e8-9', source: 'n8', target: 'n9' }, { id: 'e9-10', source: 'n9', target: 'n10' },
];

export function draftToFlow(draft: { nodes?: any[]; edges?: any[] } | null | undefined): { nodes: Node[]; edges: Edge[] } {
  const rawNodes = draft?.nodes ?? [];
  const rawEdges = draft?.edges ?? [];
  if (!rawNodes.length) return { nodes: [], edges: [] };
  const nodes: Node[] = rawNodes.map((n: any, i: number) => {
    if (n?.type === 'custom' && n.position && n.data) {
      return { id: n.id, type: 'custom', position: n.position, data: { ...n.data } };
    }
    const typeAsKind: Record<string, WorkflowNodeKind> = {
      start: 'trigger', trigger: 'trigger', action: 'execute', execute: 'execute',
      end: 'notify', task: 'task',
    };
    const kind = (n.kind ?? n.data?.kind ?? typeAsKind[String(n.type ?? '').toLowerCase()] ?? 'task') as WorkflowNodeKind;
    const position = n.position ?? { x: 60 + (i % 6) * 220, y: 80 + Math.floor(i / 6) * 120 };
    return {
      id: n.id, type: 'custom', position,
      data: {
        kind,
        label: n.label ?? n.data?.label ?? NODE_LABELS[kind] ?? kind,
        desc: n.description ?? n.data?.desc,
        note: n.data?.note,
        disabled: n.data?.disabled,
      },
    };
  });
  const edges: Edge[] = rawEdges.map((e: any) => ({ id: e.id, source: e.source, target: e.target }));
  return { nodes, edges };
}

export type StructureIssue = { code: string; message: string; severity: 'failed' | 'review' };

export function evaluateWorkflowStructure(flowNodes: Node[], flowEdges: Edge[]): StructureIssue[] {
  const kinds = flowNodes.map((node) => node.data?.kind as WorkflowNodeKind).filter(Boolean);
  const hasWrite = kinds.some((kind) => ['execute', 'http', 'mcp'].includes(kind));
  const hasTrigger = kinds.some((kind) => ['trigger', 'schedule', 'event'].includes(kind));
  const hasApproval = kinds.includes('approval');
  const hasAudit = kinds.includes('audit');
  const hasRollback = kinds.includes('compensate') || flowNodes.some((node) => /回滚|补偿/.test(String(node.data?.label ?? '')));
  const issues: StructureIssue[] = [];
  if (!hasTrigger) issues.push({ code: 'trigger', message: '缺少触发节点（Webhook / 定时 / 事件）', severity: 'failed' });
  if (hasWrite && !hasApproval) issues.push({ code: 'approval', message: '存在外部写入节点，但缺少双重审批节点', severity: 'failed' });
  if (hasWrite && !hasAudit) issues.push({ code: 'audit', message: '存在外部写入节点，但缺少审计留痕节点', severity: 'failed' });
  if (hasWrite && !hasRollback) issues.push({ code: 'compensate', message: '存在外部写入节点，但缺少补偿回滚路径', severity: 'failed' });
  if (hasWrite && !kinds.includes('policy')) issues.push({ code: 'policy', message: '建议在外部写入前串联风险策略节点', severity: 'review' });
  const disconnected = flowNodes.filter((node) => flowNodes.length > 1 && !flowEdges.some((edge) => edge.source === node.id || edge.target === node.id));
  if (disconnected.length) issues.push({ code: 'connections', message: `存在 ${disconnected.length} 个未连线节点`, severity: 'failed' });
  return issues;
}

export function structureIssueForNode(issues: StructureIssue[], kind?: WorkflowNodeKind) {
  if (!kind) return null;
  if (['execute', 'http', 'mcp'].includes(kind)) return issues.find((item) => ['approval', 'audit', 'compensate', 'policy'].includes(item.code)) ?? null;
  if (kind === 'approval') return issues.find((item) => item.code === 'approval') ?? null;
  if (kind === 'audit') return issues.find((item) => item.code === 'audit') ?? null;
  if (kind === 'compensate') return issues.find((item) => item.code === 'compensate') ?? null;
  if (kind === 'policy') return issues.find((item) => item.code === 'policy') ?? null;
  return null;
}

export function CustomNode({ data, selected }: { data: any; selected?: boolean }) {
  const Icon = NODE_ICONS[data.kind as WorkflowNodeKind];
  const color = NODE_COLORS[data.kind as WorkflowNodeKind];
  return (
    <div
      className={cn(
        'workflow-node relative rounded-md border-2 bg-[var(--surface-1)] px-3 py-2 min-w-[140px] text-center shadow-sm transition-all',
        selected && 'ring-2 ring-[var(--brand)]',
        data.disabled && 'opacity-50 grayscale',
      )}
      style={{ borderColor: color }}
      title={data.note || undefined}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-[var(--bg)]" style={{ background: color, left: -7 }} />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-[var(--bg)]" style={{ background: color, right: -7 }} />
      <Icon className="h-3.5 w-3.5 mx-auto" style={{ color }} />
      <div className="workflow-node__kind text-[10px] uppercase tracking-wide opacity-70 mt-0.5">{data.kind}</div>
      <div className="workflow-node__label text-xs font-semibold text-[var(--text)]">{data.label || NODE_LABELS[data.kind as WorkflowNodeKind]}</div>
      {data.note && (
        <div className="mt-1 flex items-center justify-center gap-0.5 rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/50 px-1 py-0.5">
          <MessageSquare className="h-2.5 w-2.5 text-amber-600 shrink-0" />
          <span className="workflow-node__note text-[9px] text-amber-700 dark:text-amber-300 truncate max-w-[110px]">{data.note}</span>
        </div>
      )}
    </div>
  );
}

export const nodeTypes = { custom: CustomNode };

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">{label}</div>
      {children}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold flex items-center gap-1">
        <ArrowRight className="h-3 w-3" />{title}
      </div>
      <div className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-2">{children}</div>
    </div>
  );
}

export type SidePanelKey = 'library' | 'debug' | 'properties';
export type TabKey = 'canvas' | 'templates' | 'publishSkill' | 'history' | 'versions';

export type GenerationResult = {
  id: string;
  prompt: string;
  status: 'generated' | 'review_required' | 'applied' | 'discarded' | 'expired';
  model: string;
  revisionId?: string;
  promptDigest?: string;
  policyVersion?: string;
  expiresAt?: string;
  createdAt: string;
  workflow: { nodes: Array<{ id: string; kind: WorkflowNodeKind; label: string; position: { x: number; y: number }; description?: string }>; edges: Array<{ id: string; source: string; target: string }> };
  checks: { structure: 'passed' | 'review'; dependencies: 'passed' | 'review'; risk: 'passed' | 'review' };
  dependencies: Array<{ type: 'tool' | 'mcp' | 'agent'; name: string; status: 'available' | 'missing'; reason?: string }>;
  risks: Array<{ level: 'L1' | 'L2' | 'L3'; node: string; text: string; requiresApproval: boolean }>;
  warnings: string[];
  qualityScore: number;
  requiresReview: boolean;
};

export type GenerationVars = {
  prompt: string;
  constraints: { riskLevel: 'L1' | 'L2' | 'L3'; requireApproval: boolean; requireAudit: boolean; requireRollback: boolean };
  workspaceId: string;
  model: string;
};

export type WorkflowValidation = {
  passed: boolean;
  checks: Record<string, 'passed' | 'review' | 'failed'>;
  warnings: string[];
};

export type WorkflowRunRecord = {
  id: string; workflowId?: string; time: string; trigger: string;
  status: 'success' | 'failed' | 'running' | string;
  duration: number; steps: number; who: string; error?: string;
  revisionId?: string; correlationId?: string;
  environment?: 'sandbox' | 'staging' | 'production' | string;
  evidenceMode?: 'recorded' | 'synthetic';
  nodeSteps?: Array<{ id: string; kind?: string; label: string; status?: 'pending' | 'success' | 'failed' | 'skipped' | string }>;
  attempt?: number; parentRunId?: string;
};

export type DraftGate = {
  blocked: boolean; reasons: string[];
  templateId: string; templateName: string; templateVersion: string; owner: string;
  sourceTemplateId?: string; sourceTemplateVersion?: string;
  degraded?: boolean; healthHint?: string;
};

export type Snapshot = { nodes: Node[]; edges: Edge[] };
export type VersionSnapshot = Snapshot & {
  id: string; label: string; time: string; desc: string;
  status?: 'draft' | 'published';
  evidenceMode?: 'recorded' | 'synthetic';
  nodeCount?: number; edgeCount?: number;
  parentVersionId?: string; publishedAt?: string;
};

export function formatWorkflowVersionLabel(version: { id?: string; label?: string; version?: string }): string {
  const explicit = String(version.label ?? '').trim();
  if (explicit) return explicit;
  const raw = String(version.version ?? '').trim();
  if (raw) return raw.startsWith('v') || raw.startsWith('V') ? raw : `v${raw}`;
  const id = String(version.id ?? '').trim();
  return id || '未命名版本';
}

export function mapRemoteVersion(version: {
  id: string; label?: string; version?: string; time?: string; desc?: string; createdAt?: string;
  status?: 'draft' | 'published'; evidenceMode?: 'recorded' | 'synthetic';
  nodeCount?: number; edgeCount?: number; parentVersionId?: string; publishedAt?: string;
  nodes?: any[]; edges?: any[];
}): VersionSnapshot {
  const flow = draftToFlow({ nodes: version.nodes, edges: version.edges });
  const hasGraph = Boolean(version.nodes?.length);
  const createdAt = version.createdAt ? String(version.createdAt) : '';
  return {
    id: version.id,
    label: formatWorkflowVersionLabel(version),
    time: version.time || (createdAt ? createdAt.replace('T', ' ').replace(/Z$/, '') : '—'),
    desc: version.desc || (version.status === 'published' ? '已发布版本' : '草稿版本'),
    status: version.status ?? 'draft',
    evidenceMode: version.evidenceMode ?? (hasGraph ? 'recorded' : 'synthetic'),
    nodeCount: version.nodeCount ?? flow.nodes.length,
    edgeCount: version.edgeCount ?? flow.edges.length,
    parentVersionId: version.parentVersionId,
    publishedAt: version.publishedAt,
    nodes: flow.nodes,
    edges: flow.edges,
  };
}

export function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return {
    nodes: snapshot.nodes.map((node) => ({ ...node, position: { ...node.position }, data: { ...node.data } })),
    edges: snapshot.edges.map((edge) => ({ ...edge })),
  };
}

export function templateSnapshot(template: WorkflowTemplateAsset): Snapshot {
  if (template.graph?.nodes?.length) {
    const nodes = template.graph.nodes.map((node) => ({
      id: node.id, type: 'custom', position: node.position ?? { x: 80, y: 80 },
      data: { kind: (node.kind as WorkflowNodeKind) || 'task', label: node.label || NODE_LABELS[(node.kind as WorkflowNodeKind)] || node.kind },
    } as Node));
    return { nodes, edges: (template.graph.edges ?? []).map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })) };
  }
  const sequence = template.sequence;
  const nodes = sequence.map((kind, index) => ({
    id: `n${index + 1}`, type: 'custom',
    position: { x: 80 + (index % 4) * 220, y: 80 + Math.floor(index / 4) * 140 },
    data: { kind, label: NODE_LABELS[kind] },
  } as Node));
  return { nodes, edges: nodes.slice(1).map((node, index) => ({ id: `e${index + 1}-${index + 2}`, source: nodes[index].id, target: node.id })) };
}

export const TEMPLATES: WorkflowTemplateAsset[] = DEFAULT_VISIBLE_TEMPLATES;
export function categoryLabel(category: WorkflowTemplateAsset['category'] | string, department?: string) {
  if (department) return department;
  if (category === 'business') return '业务自动化';
  if (category === 'system') return '系统运维';
  if (category === 'security') return '安全响应';
  return '研判与分析';
}

export function WorkflowLifecycleStrip({ highlight }: { highlight: 'version' | 'skill' }) {
  const steps = [
    { key: 'draft', label: '草稿保存' }, { key: 'validate', label: '运行前校验' },
    { key: 'trial', label: '沙箱试运行' }, { key: 'version', label: '发布版本' },
    { key: 'skill', label: '发布技能' },
  ] as const;
  return (
    <ol className="wf-lifecycle" aria-label="流程生命周期">
      {steps.map((step, index) => (
        <li
          key={step.key}
          className={cn(
            'wf-lifecycle__step',
            step.key === highlight && 'is-active',
            (step.key === 'version' || step.key === 'skill') && 'is-fork',
          )}
        >
          {index > 0 && <span className="wf-lifecycle__sep" aria-hidden="true" />}
          <span className="wf-lifecycle__dot">{index + 1}</span>
          <span className="wf-lifecycle__label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export { applyNodeChanges };
export type { ConnectorBindings, DepartmentKey, TemplateUpgradeDiff, WorkflowTemplateAsset, WorkflowSkill };
