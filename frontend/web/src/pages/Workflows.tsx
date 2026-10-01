/**
 * P6 工作流（企业级优化版）
 *
 * 页面结构：页面头部、一级功能导航、单一主画布与按需抽屉。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Handle,
  Position,
  ReactFlowProvider,
  applyNodeChanges,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type NodeMouseHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Badge, Button } from '@qzda/web-ui';
import {
  Play, Save, Download, Zap, ShieldCheck, Cpu, GitBranch, Bell, FileText,
  Wrench, Database, PlayCircle, ChevronRight, Activity, CheckCircle2, Clock,
  AlertTriangle, Plus, Sparkles, Settings, Pause, RotateCcw,
  Eye, Bug, Webhook, Layers, Search, History, X, Trash2, GitCompare, MoreHorizontal, ChevronLeft,
  Edit3, Copy, Box, ArrowRight, GripVertical, RefreshCw,
  Undo2, Redo2, FileJson, MessageSquare, StepForward, StepBack, SkipForward, SkipBack, History as HistoryIcon,
} from 'lucide-react';
import type { DigitalPartner, KnowledgePackage, KnowledgeRetrievalProfile, Workflow, WorkflowNodeKind, WorkflowSkill } from '@qzda/web-types';
import { cn } from '@qzda/web-utils';
import { Drawer, ConfirmDialog, RoleReadonlyBanner } from '@/components/shared';
import { useApiMutation, useApiQuery } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useT } from '@/i18n';
import { computeVersionDiff } from '@/features/workflows/version-diff';
import {
  ALL_WORKFLOW_TEMPLATES,
  DEPARTMENT_OPTIONS,
  DEFAULT_VISIBLE_TEMPLATES,
  INDUSTRY_OPTIONS,
  departmentLabel,
  deriveTemplateBlockers,
  diffTemplateUpgrade,
  evaluateTemplateConnectors,
  filterByIndustry,
  isPersonalTemplate,
  isPlatformTemplate,
  isTemplateReusable,
  loadConnectorBindings,
  matchDepartmentKey,
  needsTemplateReview,
  saveConnectorBindings,
  type ConnectorBindings,
  type DepartmentKey,
  type TemplateOrigin,
  type TemplateUpgradeDiff,
  type WorkflowTemplateAsset,
} from '@/features/workflows/department-templates';
import { defaultWorkflowTab, roleCanMutate, rolePageCopy, visibleWorkflowTabs, type WorkflowTab } from '@/features/role-nav/role-nav';

type SidePanelKey = 'library' | 'debug' | 'properties';
type TabKey = 'canvas' | 'templates' | 'publishSkill' | 'history' | 'versions';

type GenerationResult = {
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

type GenerationVars = {
  prompt: string;
  constraints: { riskLevel: 'L1' | 'L2' | 'L3'; requireApproval: boolean; requireAudit: boolean; requireRollback: boolean };
  workspaceId: string;
  model: string;
};

type WorkflowValidation = {
  passed: boolean;
  checks: Record<string, 'passed' | 'review' | 'failed'>;
  warnings: string[];
};
type WorkflowRunRecord = {
  id: string;
  workflowId?: string;
  time: string;
  trigger: string;
  status: 'success' | 'failed' | 'running' | string;
  duration: number;
  steps: number;
  who: string;
  error?: string;
  revisionId?: string;
  correlationId?: string;
  environment?: 'sandbox' | 'staging' | 'production' | string;
  evidenceMode?: 'recorded' | 'synthetic';
  nodeSteps?: Array<{ id: string; kind?: string; label: string; status?: 'pending' | 'success' | 'failed' | 'skipped' | string }>;
  attempt?: number;
  parentRunId?: string;
};

/* ============ 节点元数据 ============ */
const NODE_ICONS: Record<WorkflowNodeKind, any> = {
  trigger: PlayCircle, schedule: Clock, event: Bell,
  retrieve: Database, transform: Wrench,
  decision: Cpu, condition: GitBranch, approval: ShieldCheck, policy: ShieldCheck,
  branch: GitBranch, parallel: GitBranch,
  execute: Wrench, http: Webhook, mcp: Cpu, task: FileText,
  retry: RefreshCw, compensate: RotateCcw, audit: FileText, notify: Bell,
};
const NODE_LABELS: Record<WorkflowNodeKind, string> = {
  trigger: 'Webhook 触发', schedule: '定时调度', event: '告警事件',
  retrieve: '知识检索', transform: '数据转换',
  decision: '数字伙伴研判', condition: '条件判断', approval: '人工审批', policy: '风险策略',
  branch: '条件分支', parallel: '并行编排',
  execute: '执行受控动作', http: 'HTTP / API', mcp: 'MCP 工具', task: '创建任务',
  retry: '重试策略', compensate: '补偿回滚', audit: '审计留痕', notify: '结果通知',
};
const NODE_COLORS: Record<WorkflowNodeKind, string> = {
  trigger: '#3b82f6', schedule: '#3b82f6', event: '#3b82f6',
  retrieve: '#10b981', transform: '#10b981',
  decision: '#8b5cf6', condition: '#8b5cf6', approval: '#f59e0b', policy: '#f59e0b',
  branch: '#06b6d4', parallel: '#06b6d4',
  execute: '#ef4444', http: '#ef4444', mcp: '#ef4444', task: '#ef4444',
  retry: '#f59e0b', compensate: '#f59e0b', audit: '#64748b', notify: '#38bdf8',
};
const NODE_DESCS: Record<WorkflowNodeKind, string> = {
  trigger: '接收外部系统 Webhook 请求', schedule: '按 Cron 或日历规则发起流程', event: '订阅监控告警或消息事件',
  retrieve: '查询知识库、运行手册与历史证据', transform: '映射、清洗并标准化上下文数据',
  decision: '由数字伙伴分析上下文并生成处置决策', condition: '基于表达式判断后续路径', approval: '按审批人、超时与签名规则复核', policy: '校验风险等级、权限和变更策略',
  branch: '按条件选择唯一处置路径', parallel: '并发执行多个独立步骤并汇聚',
  execute: '调用已纳管 Skill 完成受控处置动作', http: '调用企业内部或第三方 API', mcp: '调用受控 MCP 工具', task: '创建人工处置任务并回传结果',
  retry: '按退避策略自动重试可恢复失败', compensate: '执行补偿动作或回滚变更', audit: '写入可追溯的审计证据', notify: '通过飞书、企微、钉钉等通知结果',
};

type NodeLibraryCategory = 'trigger' | 'context' | 'decision' | 'action' | 'governance' | 'reliability';
type NodeRisk = 'standard' | 'review' | 'sensitive';

const NODE_LIBRARY_GROUPS: Array<{ id: NodeLibraryCategory; label: string; desc: string; kinds: WorkflowNodeKind[] }> = [
  { id: 'trigger', label: '触发与输入', desc: '定义数字伙伴何时开始工作', kinds: ['trigger', 'schedule', 'event'] },
  { id: 'context', label: '上下文与数据', desc: '补齐处置所需的证据与变量', kinds: ['retrieve', 'transform'] },
  { id: 'decision', label: '智能决策', desc: '由规则或数字伙伴研判决定处置路径', kinds: ['decision', 'condition', 'branch', 'parallel'] },
  { id: 'action', label: '执行与协同', desc: '调用受控能力或派发人工工作', kinds: ['execute', 'http', 'mcp', 'task'] },
  { id: 'governance', label: '人工与治理', desc: '在关键动作前实施权限和审批控制', kinds: ['policy', 'approval', 'audit'] },
  { id: 'reliability', label: '可靠性与收尾', desc: '处理失败、补偿并通知相关人员', kinds: ['retry', 'compensate', 'notify'] },
];

const NODE_LIBRARY_META: Record<WorkflowNodeKind, { category: NodeLibraryCategory; risk: NodeRisk; badge?: string }> = {
  trigger: { category: 'trigger', risk: 'standard' }, schedule: { category: 'trigger', risk: 'standard' }, event: { category: 'trigger', risk: 'standard' },
  retrieve: { category: 'context', risk: 'standard' }, transform: { category: 'context', risk: 'standard' },
  decision: { category: 'decision', risk: 'review', badge: 'AI' }, condition: { category: 'decision', risk: 'standard' }, branch: { category: 'decision', risk: 'standard' }, parallel: { category: 'decision', risk: 'standard' },
  execute: { category: 'action', risk: 'sensitive', badge: '已纳管 Skill' }, http: { category: 'action', risk: 'sensitive', badge: '外部调用' }, mcp: { category: 'action', risk: 'sensitive', badge: '受控工具' }, task: { category: 'action', risk: 'review', badge: '人工协同' },
  policy: { category: 'governance', risk: 'review', badge: '策略' }, approval: { category: 'governance', risk: 'review', badge: '需审批' }, audit: { category: 'governance', risk: 'standard' },
  retry: { category: 'reliability', risk: 'review', badge: '失败处理' }, compensate: { category: 'reliability', risk: 'sensitive', badge: '回滚' }, notify: { category: 'reliability', risk: 'standard' },
};

const NODE_LIB = NODE_LIBRARY_GROUPS.flatMap((group) => group.kinds);

function recommendedNodeKinds(sourceKind?: WorkflowNodeKind): WorkflowNodeKind[] {
  if (!sourceKind) return ['trigger', 'event', 'schedule', 'retrieve', 'decision'];
  const category = NODE_LIBRARY_META[sourceKind].category;
  if (category === 'trigger') return ['retrieve', 'transform', 'decision', 'condition'];
  if (category === 'context') return ['decision', 'condition', 'branch', 'policy'];
  if (category === 'decision') return ['policy', 'approval', 'execute', 'http', 'mcp', 'task'];
  if (category === 'action') return ['audit', 'retry', 'compensate', 'notify'];
  if (category === 'governance') return ['execute', 'http', 'mcp', 'audit', 'notify'];
  return ['audit', 'notify', 'task', 'compensate'];
}

/* ============ 画布空白起点（数据来自 API 草稿/版本；不再预填 Mock 图） ============ */
const EMPTY_NODES: Node[] = [];
const EMPTY_EDGES: Edge[] = [];
/** 可选示例模板（仅「加载示例」动作使用，不作为默认数据） */
const SAMPLE_NODES: Node[] = [
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
const SAMPLE_EDGES: Edge[] = [
  { id: 'e1-2', source: 'n1', target: 'n2' },
  { id: 'e2-3', source: 'n2', target: 'n3' },
  { id: 'e3-4', source: 'n3', target: 'n4' },
  { id: 'e4-5', source: 'n4', target: 'n5' },
  { id: 'e4-6', source: 'n4', target: 'n6' },
  { id: 'e5-7', source: 'n5', target: 'n7' },
  { id: 'e6-8', source: 'n6', target: 'n8' },
  { id: 'e7-9', source: 'n7', target: 'n9' },
  { id: 'e8-9', source: 'n8', target: 'n9' },
  { id: 'e9-10', source: 'n9', target: 'n10' },
];

/* ============ 服务端草稿 → React Flow ============ */
function draftToFlow(draft: { nodes?: any[]; edges?: any[] } | null | undefined): { nodes: Node[]; edges: Edge[] } {
  const rawNodes = draft?.nodes ?? [];
  const rawEdges = draft?.edges ?? [];
  if (!rawNodes.length) {
    return { nodes: [], edges: [] };
  }
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
      id: n.id,
      type: 'custom',
      position,
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

type StructureIssue = { code: string; message: string; severity: 'failed' | 'review' };

function evaluateWorkflowStructure(flowNodes: Node[], flowEdges: Edge[]): StructureIssue[] {
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

function structureIssueForNode(issues: StructureIssue[], kind?: WorkflowNodeKind) {
  if (!kind) return null;
  if (['execute', 'http', 'mcp'].includes(kind)) return issues.find((item) => ['approval', 'audit', 'compensate', 'policy'].includes(item.code)) ?? null;
  if (kind === 'approval') return issues.find((item) => item.code === 'approval') ?? null;
  if (kind === 'audit') return issues.find((item) => item.code === 'audit') ?? null;
  if (kind === 'compensate') return issues.find((item) => item.code === 'compensate') ?? null;
  if (kind === 'policy') return issues.find((item) => item.code === 'policy') ?? null;
  return null;
}




const NODE_DEBUG: Record<string, { input: string; output: string; log: string[] }> = {
  n1: {
    input: '{ "event": "redis.oom.alert", "cluster": "prod", "node": "redis-01" }',
    output: '{ "status": "captured", "traceId": "tr-7a3f2c91" }',
    log: ['[14:27:55] Webhook 到达 · POST /webhook/redis-oom', '[14:27:55] 签名校验通过 (HMAC-SHA256)', '[14:27:56] 推入事件总线（traceId=tr-7a3f2c91）'],
  },
  n2: {
    input: '{ "query": "redis maxmemory-policy", "topK": 8 }',
    output: '{ "hits": [ { "score": 0.91, "doc": "sop/redis-tuning.md" }, { "score": 0.84, "doc": "runbook/oom.md" } ] }',
    log: ['[14:27:57] 知识检索（topK=8）', '[14:27:58] 命中 2 篇：sop/redis-tuning.md · runbook/oom.md'],
  },
  n3: {
    input: '{ "context": [...], "tools": ["skill_redis_tune", "mcp_k8s"] }',
    output: '{ "decision": "WRITE", "action": "CONFIG SET", "confidence": 0.92 }',
    log: ['[14:28:00] 进入数字伙伴研判节点', '[14:28:01] 工具调用：skill_redis_tune.predict()', '[14:28:01] 决策：WRITE（置信度 0.92）'],
  },
  n4: {
    input: '{ "action": "CONFIG SET", "target": "prod-redis-01", "params": { "maxmemory": "16GB", "policy": "volatile-lru" } }',
    output: '{ "status": "pending_approval", "approvers_required": 2, "deadline": "2026-07-13T15:30:00Z" }',
    log: [
      '[14:28:01] 决策节点推送写操作请求',
      '[14:28:02] 检查双重审批策略 → 需要 2 人签发',
      '[14:28:03] 通知 王昊（Admin） + 李婷（SRE）',
      '[14:28:35] 王昊 已签发（第一签）',
      '[14:29:12] 等待 李婷 签发...',
    ],
  },
  n5: {
    input: '{ "branch": "success", "nextNode": "n7" }',
    output: '{ "branch_result": "success" }',
    log: ['[14:30:02] 分支判定：通过（双重审批完成）'],
  },
  n6: {
    input: '{ "branch": "rollback", "nextNode": "n8" }',
    output: '{ "branch_result": "rollback" }',
    log: ['[14:30:02] 分支判定：回滚路径'],
  },
  n7: {
    input: '{ "tool": "skill_redis_tune", "params": { "maxmemory": "16GB", "policy": "volatile-lru" } }',
    output: '{ "ok": true, "appliedAt": "2026-07-13T14:30:18Z" }',
    log: ['[14:30:15] 调用 skill: skill_redis_tune', '[14:30:18] CONFIG SET 应用成功'],
  },
  n8: {
    input: '{ "tool": "mcp_k8s.rollback", "deployment": "redis-01" }',
    output: '{ "ok": true, "revisions": 1 }',
    log: ['[14:30:15] 触发回滚：mcp_k8s.rollback', '[14:30:18] 回滚完成（revisions=1）', '[14:30:19] 触发告警：P2 故障'],
  },
  n9: {
    input: '{ "traceId": "tr-7a3f2c91", "decision": "WRITE", "appliedBy": "受控恢复流程" }',
    output: '{ "signed": true, "hash": "0x8f2c…a917" }',
    log: ['[14:30:20] 审计留痕写入（SHA-256 哈希链）'],
  },
  n10: {
    input: '{ "channels": ["feishu", "wecom"], "template": "redis-oom-resolved" }',
    output: '{ "delivered": 2, "failed": 0 }',
    log: ['[14:30:21] 飞书通知已送达（oncall@）', '[14:30:21] 企微通知已送达（ops@）'],
  },
};

/* ============ 自定义节点 ============ */
function CustomNode({ data, selected }: { data: any; selected?: boolean }) {
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
      {/* 输入 handle（左侧） */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-[var(--bg)]"
        style={{ background: color, left: -7 }}
      />
      {/* 输出 handle（右侧） */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-[var(--bg)]"
        style={{ background: color, right: -7 }}
      />
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

const nodeTypes = { custom: CustomNode };

/* ============ Mock 模板 ============ */
/* ============ 工作流模板资产（部门默认库 + IT 高级库） ============ */
const TEMPLATES: WorkflowTemplateAsset[] = DEFAULT_VISIBLE_TEMPLATES;

type DraftGate = {
  blocked: boolean;
  reasons: string[];
  templateId: string;
  templateName: string;
  templateVersion: string;
  owner: string;
  sourceTemplateId?: string;
  sourceTemplateVersion?: string;
  degraded?: boolean;
  healthHint?: string;
};

function categoryLabel(category: WorkflowTemplateAsset['category'] | string, department?: string) {
  if (department) return department;
  if (category === 'business') return '业务自动化';
  if (category === 'system') return '系统运维';
  if (category === 'security') return '安全响应';
  return '研判与分析';
}

function normalizeTemplateAsset(
  raw: Partial<WorkflowTemplateAsset> & { id: string; name: string },
  bindings: ConnectorBindings = {},
): WorkflowTemplateAsset {
  const fallback = ALL_WORKFLOW_TEMPLATES.find((item) => item.id === raw.id || item.name === raw.name);
  const connectors = raw.connectors?.length ? raw.connectors : (fallback?.connectors ?? []);
  const degrade = raw.degrade ?? fallback?.degrade;
  const evaluated = evaluateTemplateConnectors({ connectors, degrade }, bindings);
  const dependencyStatus = raw.dependencyStatus?.length
    ? raw.dependencyStatus
    : (raw.dependencies ?? fallback?.dependencies ?? connectors.map((c) => c.slot)).map((name) => ({
        name,
        status: (evaluated.blockers.some((b) => b.startsWith(`${name}：`)) ? 'unauthorized' : 'ready') as 'ready' | 'unauthorized',
        reason: evaluated.blockers.find((b) => b.startsWith(`${name}：`)),
      }));
  const blockers = evaluated.blockers.length
    ? evaluated.blockers
    : deriveTemplateBlockers({
      health: evaluated.health,
      dependencyStatus,
      blockers: raw.blockers ?? fallback?.blockers ?? [],
    });
  const health: WorkflowTemplateAsset['health'] = blockers.length > 0 ? '需授权' : evaluated.health;
  const department = (raw.department as DepartmentKey | undefined)
    ?? fallback?.department
    ?? matchDepartmentKey(raw.owner)
    ?? 'it';
  return {
    id: raw.id,
    name: raw.name,
    version: raw.version ?? fallback?.version ?? '1.0.0',
    category: (raw.category as WorkflowTemplateAsset['category']) ?? fallback?.category ?? 'business',
    department,
    departmentLabel: raw.departmentLabel ?? fallback?.departmentLabel ?? departmentLabel(department),
    audience: raw.audience ?? fallback?.audience ?? '内部用户',
    description: raw.description ?? fallback?.description ?? '',
    nodes: raw.nodes ?? fallback?.nodes ?? (raw.sequence?.length ?? 0),
    installs: raw.installs ?? fallback?.installs ?? 0,
    rating: raw.rating ?? fallback?.rating ?? 0,
    owner: raw.owner ?? fallback?.owner ?? '平台内置',
    verifiedAt: raw.verifiedAt ?? fallback?.verifiedAt ?? '—',
    risk: (raw.risk as WorkflowTemplateAsset['risk']) ?? fallback?.risk ?? 'L2',
    dependencies: raw.dependencies ?? fallback?.dependencies ?? connectors.map((c) => c.slot),
    dependencyStatus,
    health,
    healthHint: raw.healthHint ?? evaluated.healthHint ?? fallback?.healthHint,
    successRate: raw.successRate ?? fallback?.successRate ?? (raw.certification === 'certified' || fallback?.certification === 'certified' ? 'Certified' : '—'),
    sequence: (raw.sequence as WorkflowTemplateAsset['sequence']) ?? fallback?.sequence ?? ['event', 'decision', 'audit', 'notify'],
    blockers,
    variables: raw.variables ?? fallback?.variables ?? [],
    permissions: raw.permissions ?? fallback?.permissions ?? [],
    changelog: raw.changelog ?? fallback?.changelog ?? [],
    recentRuns: raw.recentRuns ?? fallback?.recentRuns ?? [],
    library: raw.library ?? fallback?.library ?? 'default',
    parentId: raw.parentId ?? fallback?.parentId,
    suggestedExpertRole: raw.suggestedExpertRole ?? fallback?.suggestedExpertRole,
    certification: raw.certification ?? fallback?.certification ?? (raw.library === 'advanced' ? 'advanced' : 'certified'),
    industryTags: raw.industryTags ?? fallback?.industryTags ?? ['all'],
    connectors,
    degrade,
    antiPatterns: raw.antiPatterns ?? fallback?.antiPatterns,
    graph: raw.graph ?? fallback?.graph,
    fixtures: raw.fixtures ?? fallback?.fixtures,
    builtin: raw.builtin ?? fallback?.builtin ?? (raw.source === 'personal' || raw.source === 'user' ? false : true),
    source: raw.source ?? fallback?.source ?? (raw.builtin === false ? 'personal' : 'platform'),
    ownerId: raw.ownerId ?? fallback?.ownerId,
    workspaceId: raw.workspaceId ?? fallback?.workspaceId,
    createdAt: raw.createdAt ?? fallback?.createdAt,
    updatedAt: raw.updatedAt ?? fallback?.updatedAt,
    knowledgePackageIds: raw.knowledgePackageIds ?? fallback?.knowledgePackageIds ?? [],
    requiredSkills: raw.requiredSkills ?? fallback?.requiredSkills ?? [],
    optionalSkills: raw.optionalSkills ?? fallback?.optionalSkills ?? [],
    scenarioId: raw.scenarioId ?? fallback?.scenarioId,
  };
}

/* ============ 版本快照 ============ */
type Snapshot = { nodes: Node[]; edges: Edge[] };
type VersionSnapshot = Snapshot & {
  id: string;
  label: string;
  time: string;
  desc: string;
  status?: 'draft' | 'published';
  evidenceMode?: 'recorded' | 'synthetic';
  nodeCount?: number;
  edgeCount?: number;
  parentVersionId?: string;
  publishedAt?: string;
};

function formatWorkflowVersionLabel(version: {
  id?: string;
  label?: string;
  version?: string;
}): string {
  const explicit = String(version.label ?? '').trim();
  if (explicit) return explicit;
  const raw = String(version.version ?? '').trim();
  if (raw) return raw.startsWith('v') || raw.startsWith('V') ? raw : `v${raw}`;
  const id = String(version.id ?? '').trim();
  return id || '未命名版本';
}

function mapRemoteVersion(version: {
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

function WorkflowLifecycleStrip({ highlight }: { highlight: 'version' | 'skill' }) {
  const steps = [
    { key: 'draft', label: '草稿保存' },
    { key: 'validate', label: '运行前校验' },
    { key: 'trial', label: '沙箱试运行' },
    { key: 'version', label: '发布版本' },
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

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return {
    nodes: snapshot.nodes.map((node) => ({ ...node, position: { ...node.position }, data: { ...node.data } })),
    edges: snapshot.edges.map((edge) => ({ ...edge })),
  };
}

function templateSnapshot(template: WorkflowTemplateAsset): Snapshot {
  if (template.graph?.nodes?.length) {
    const nodes = template.graph.nodes.map((node) => ({
      id: node.id,
      type: 'custom',
      position: node.position ?? { x: 80, y: 80 },
      data: {
        kind: (node.kind as WorkflowNodeKind) || 'task',
        label: node.label || NODE_LABELS[(node.kind as WorkflowNodeKind)] || node.kind,
      },
    } as Node));
    return {
      nodes,
      edges: (template.graph.edges ?? []).map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      })),
    };
  }
  const sequence = template.sequence;
  const nodes = sequence.map((kind, index) => ({
    id: `n${index + 1}`,
    type: 'custom',
    position: { x: 80 + (index % 4) * 220, y: 80 + Math.floor(index / 4) * 140 },
    data: { kind, label: NODE_LABELS[kind] },
  } as Node));
  return {
    nodes,
    edges: nodes.slice(1).map((node, index) => ({ id: `e${index + 1}-${index + 2}`, source: nodes[index].id, target: node.id })),
  };
}

/* ============ 顶层组件 ============ */
export default function Workflows() {
  const { t } = useT();
  const navigate = useNavigate();
  const userRole = useAuthStore((state) => state.user?.role);
  const canWrite = useAuthStore((state) => state.hasPermission('workflow.write')) && roleCanMutate(userRole);
  const canExecute = useAuthStore((state) => state.hasPermission('workflow.execute')) && roleCanMutate(userRole);
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const pageCopy = rolePageCopy('workflows', userRole);
  const workflowTabs = visibleWorkflowTabs(userRole);
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId ?? 'w1');
  const [tab, setTab] = useState<TabKey>(() => defaultWorkflowTab(userRole));
  const [sidePanel, setSidePanel] = useState<SidePanelKey>('library');
  const [librarySearchQ, setLibrarySearchQ] = useState('');
  const [canvasSearchQ, setCanvasSearchQ] = useState('');

  // 节点数据（可增删）
  const [nodes, setNodes] = useState<Node[]>(EMPTY_NODES);
  const [edges, setEdges] = useState<Edge[]>(EMPTY_EDGES);

  // 选中 / 右键菜单
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [deleteConfirmNodeId, setDeleteConfirmNodeId] = useState<string | null>(null);

  // 模板筛选
  const [filterGroup, setFilterGroup] = useState<DepartmentKey | 'all'>('office');
  const [filterIndustry, setFilterIndustry] = useState<string>('all');
  const [templateOriginFilter, setTemplateOriginFilter] = useState<TemplateOrigin>('platform');
  const [showAdvancedLibrary, setShowAdvancedLibrary] = useState(false);
  const [workspaceDeptOnly, setWorkspaceDeptOnly] = useState(false);
  const [connectorBindings, setConnectorBindings] = useState<ConnectorBindings>(() => loadConnectorBindings(currentWorkspaceId));
  const [upgradeDiff, setUpgradeDiff] = useState<{ template: WorkflowTemplateAsset; diff: TemplateUpgradeDiff } | null>(null);

  // 顶部操作按钮组
  const [webhookEnabled, setWebhookEnabled] = useState(true);

  // 版本选择
  const [activeVersion, setActiveVersion] = useState('');
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const [versionDiffOpen, setVersionDiffOpen] = useState(false);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [versionCenterSelectedId, setVersionCenterSelectedId] = useState<string>('');
  const [diffBaseId, setDiffBaseId] = useState<string>('');
  const [rollbackTargetId, setRollbackTargetId] = useState<string | null>(null);

  // 模板预览
  const [previewTemplate, setPreviewTemplate] = useState<WorkflowTemplateAsset | null>(null);

  // AI 工作流生成：结果始终先进入预览，不覆盖当前画布
  const [aiGenerateOpen, setAiGenerateOpen] = useState(false);
  const [generationStep, setGenerationStep] = useState<'input' | 'preview'>('input');
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null);
  const [generationPrompt, setGenerationPrompt] = useState('当生产 Redis 触发 OOM 告警时，由数字伙伴研判处置路径，经双重审批后执行受控恢复，写入审计并通知值班负责人');
  const [generationConstraints, setGenerationConstraints] = useState<GenerationVars['constraints']>({ riskLevel: 'L2', requireApproval: true, requireAudit: true, requireRollback: true });
  const [generationModel, setGenerationModel] = useState('企业默认模型');
  const { data: generationHistoryData } = useApiQuery<GenerationResult[]>(['workflow-generations'], '/api/workflows/generations');
  const generationHistory = generationHistoryData ?? [];
  const { data: templateAssetsData, refetch: refetchTemplates } = useApiQuery<Array<Partial<WorkflowTemplateAsset> & { id: string; name: string }>>(['workflow-templates'], '/api/workflow-templates');
  const templateAssets = templateAssetsData ?? [];
  const { data: employeesData } = useApiQuery<DigitalPartner[]>(['digital-employees'], '/api/partners');
  const workspaceDepartments = useMemo(() => {
    const keys = new Set<DepartmentKey>();
    for (const employee of employeesData ?? []) {
      const key = matchDepartmentKey(employee.department);
      if (key) keys.add(key);
    }
    return keys;
  }, [employeesData]);
  const { data: workflowListData } = useApiQuery<Array<Pick<Workflow, 'id'>>>(['workflows', currentWorkspaceId], '/api/workflows');
  const workflowList = Array.isArray(workflowListData) ? workflowListData : [];
  const workflowId = workflowList[0]?.id ?? '';
  const { data: workflowDraft } = useApiQuery<Workflow>(
    ['workflow-draft', currentWorkspaceId, workflowId],
    `/api/workflows/${workflowId || '__none__'}`,
    undefined,
    { enabled: Boolean(workflowId) },
  );
  const { data: remoteVersionsData, refetch: refetchVersions } = useApiQuery<Array<Parameters<typeof mapRemoteVersion>[0]>>(
    ['workflow-versions', currentWorkspaceId, workflowId],
    `/api/workflows/${workflowId || '__none__'}/versions`,
    undefined,
    { enabled: Boolean(workflowId) },
  );
  const remoteVersions = Array.isArray(remoteVersionsData) ? remoteVersionsData : [];
  const draftHydratedRef = useRef(false);
  const [cleanBaseline, setCleanBaseline] = useState(() => JSON.stringify({ nodes: EMPTY_NODES, edges: EMPTY_EDGES }));
  const [draftGate, setDraftGate] = useState<DraftGate | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflightResult, setPreflightResult] = useState<WorkflowValidation | null>(null);
  const [preflightVersion, setPreflightVersion] = useState<string | null>(null);
  const [nodeLibraryOpen, setNodeLibraryOpen] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'error' | 'info' } | null>(null);
  const showToast = useCallback((msg: string, tone: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 2200);
  }, []);

  const generateWorkflowApi = useApiMutation<GenerationResult, GenerationVars>('/api/workflows/generate', {
    onSuccess: (result) => {
      setGenerationResult(result);
      setGenerationStep('preview');
      showToast('已生成可编辑草稿，请专家复核后再应用', 'success');
    },
    onError: () => showToast('生成失败，请调整处置目标后重试', 'error'),
  });
  const discardGenerationApi = useApiMutation<GenerationResult, { id: string }>((vars) => `/api/workflows/generations/${vars.id}/discard`, {
    onSuccess: () => showToast('已放弃本次生成结果', 'info'),
  });
  const applyGenerationApi = useApiMutation<GenerationResult, { id: string }>(({ id }) => `/api/workflows/generations/${id}/apply`, {
    onError: () => showToast('生成草稿与审计未提交，当前画布未变更', 'error'),
  });
  const validateWorkflowApi = useApiMutation<WorkflowValidation, { workflowId?: string; revisionId?: string; nodes: unknown[]; edges: unknown[] }>(
    (vars) => `/api/workflows/${vars.workflowId ?? workflowId}/validate`,
    {
      onSuccess: (result) => {
        setPreflightResult(result);
        setPreflightVersion(activeVersion);
        setPreflightOpen(true);
      },
      onError: () => showToast('运行前校验失败，请稍后重试', 'error'),
    },
  );
  const [focusRunId, setFocusRunId] = useState<string | null>(null);
  const { data: workflowRunsData } = useApiQuery<WorkflowRunRecord[]>(['workflow-runs'], '/api/workflow-runs');
  const workflowRuns = workflowRunsData ?? [];
  const runWorkflowApi = useApiMutation<WorkflowRunRecord, Record<string, unknown>>(
    (vars) => `/api/workflows/${String((vars as { workflowId?: string }).workflowId ?? workflowId)}/run`,
    {
      onSuccess: (run) => {
        setPreflightOpen(false);
        setFocusRunId(run.id);
        setTab('history');
        showToast(`已创建沙箱运行记录 ${run.id}`, 'success');
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : '工作流执行请求失败';
        showToast(message.replace(/^E_[A-Z_]+:\s*/, ''), 'error');
      },
    },
  );
  const saveWorkflowApi = useApiMutation<Workflow, { workflowId: string; nodes: unknown[]; edges: unknown[]; version: string; desc?: string }>(
    (vars) => `/api/workflows/${vars.workflowId}/draft`,
    { onError: () => showToast('服务端保存失败，本地草稿仍已保留', 'error') },
    'PUT',
  );
  const publishWorkflowApi = useApiMutation<{ publishedVersion?: VersionSnapshot }, { workflowId: string; version: string }>(
    (vars) => `/api/workflows/${vars.workflowId}/publish`,
    {
      onSuccess: (result) => {
        setVersionMenuOpen(false);
        refetchVersions();
        const publishedId = (result as any)?.publishedVersion?.id;
        showToast(publishedId ? `已发布版本 ${publishedId}` : '已发布当前草稿版本', 'success');
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : '发布提交失败，请先完成运行前校验';
        showToast(message.replace(/^E_[A-Z_]+:\s*/, ''), 'error');
      },
    },
  );
  const createVersionApi = useApiMutation<VersionSnapshot, { workflowId: string; label?: string; desc?: string; parentVersionId?: string; nodes: unknown[]; edges: unknown[] }>(
    (vars) => `/api/workflows/${vars.workflowId}/versions`,
    {
      onSuccess: (version) => {
        refetchVersions();
        setActiveVersion(version.id);
        setVersionCenterSelectedId(version.id);
        setVersionMenuOpen(false);
        showToast(`已另存版本 ${version.label}`, 'success');
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : '另存版本失败';
        showToast(message.replace(/^E_[A-Z_]+:\s*/, ''), 'error');
      },
    },
  );
  const createPersonalTemplateApi = useApiMutation<
    Partial<WorkflowTemplateAsset> & { id: string; name: string },
    {
      name: string;
      description?: string;
      department?: string;
      sequence?: string[];
      graph?: { nodes: unknown[]; edges: unknown[] };
      risk?: string;
    }
  >('/api/workflow-templates', {
    invalidateKeys: [['workflow-templates']],
    onSuccess: (tpl) => {
      setTemplateOriginFilter('personal');
      setTab('templates');
      showToast(`已保存个人模板「${tpl.name}」`, 'success');
      void refetchTemplates();
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : '保存个人模板失败';
      showToast(message.replace(/^E_[A-Z_]+:\s*/, ''), 'error');
    },
  });
  const deletePersonalTemplateApi = useApiMutation<{ ok: boolean; id: string }, { id: string }>(
    (vars) => `/api/workflow-templates/${vars.id}`,
    {
      invalidateKeys: [['workflow-templates']],
      onSuccess: () => {
        showToast('已删除个人模板', 'info');
        void refetchTemplates();
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : '删除失败';
        showToast(message.replace(/^E_[A-Z_]+:\s*/, ''), 'error');
      },
    },
    'DELETE',
  );
  const rollbackVersionApi = useApiMutation<{ draft: any; version: VersionSnapshot; restoredFrom: string }, { workflowId: string; versionId: string }>(
    (vars) => `/api/workflows/${vars.workflowId}/rollback`,
    {
      onSuccess: (result) => {
        refetchVersions();
        const mapped = mapRemoteVersion(result.version as any);
        const next = cloneSnapshot(mapped);
        setNodes(next.nodes);
        setEdges(next.edges);
        setActiveVersion(mapped.id);
        setSelectedNodeId(next.nodes[0]?.id ?? null);
        historyRef.current = { stack: [next], idx: 0 };
        setRollbackTargetId(null);
        setVersionMenuOpen(false);
        setTab('canvas');
        showToast(`已从 ${result.restoredFrom} 回滚并生成草稿 ${mapped.id}`, 'success');
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : '回滚失败';
        showToast(message.replace(/^E_[A-Z_]+:\s*/, ''), 'error');
      },
    },
  );
  const releaseRequestApi = useApiMutation<unknown, { resourceType: 'workflow'; resourceName: string; risk: 'low' | 'medium' | 'high' }>('/api/release-approvals', {
    onSuccess: () => { setVersionMenuOpen(false); showToast('已提交生产发布申请，等待管理员审批', 'success'); },
    onError: () => showToast('发布申请提交失败，请稍后重试', 'error'),
  });
  const { data: workflowSkillsData, refetch: refetchWorkflowSkills } = useApiQuery<WorkflowSkill[]>(['workflow-skills'], '/api/workflow-skills');
  const workflowSkills = workflowSkillsData ?? [];
  type PublishSkillVars = {
    workflowId: string;
    version: string;
    name: string;
    description: string;
    riskLevel: WorkflowSkill['riskLevel'];
    validationPassed: boolean;
    draftBlocked: boolean;
  };
  const publishAsSkillApi = useApiMutation<WorkflowSkill, PublishSkillVars>(
    (vars) => `/api/workflows/${vars.workflowId}/publish-as-skill`,
    {
      onSuccess: (skill) => {
        refetchWorkflowSkills();
        if (skill.status === 'published') {
          showToast(`已发布流程技能「${skill.name}」`, 'success');
        } else {
          showToast(`高风险技能「${skill.name}」已提交为草稿，待管理员治理发布后方可装配`, 'info');
        }
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : '发布技能失败，请确认流程版本已校验';
        showToast(message.replace(/^E_[A-Z_]+:\s*/, ''), 'error');
      },
    },
  );
  const [skillName, setSkillName] = useState('生产故障处置流程技能');
  const [skillDesc, setSkillDesc] = useState('由工作流程发布的标准作业能力，可供数字伙伴在能力装配中引用。');
  const [skillSourceVersion, setSkillSourceVersion] = useState('');
  const [skillRiskLevel, setSkillRiskLevel] = useState<WorkflowSkill['riskLevel']>('mid');
  useEffect(() => {
    if (tab === 'publishSkill') setSkillSourceVersion(activeVersion);
  }, [tab, activeVersion]);
  const requestProductionRelease = () => {
    if (draftGate?.blocked) {
      showToast(`模板依赖未就绪，无法发布：${draftGate.reasons[0] ?? '请先完成授权'}`, 'error');
      return;
    }
    if (isDirty) {
      showToast('请先保存草稿后再发布版本', 'error');
      return;
    }
    if (isAdmin) publishWorkflowApi.mutate({ workflowId, version: activeVersion });
    else releaseRequestApi.mutate({ resourceType: 'workflow', resourceName: `工作流 ${activeVersion}`, risk: 'medium' });
  };

  // 拖拽
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [draggedKind, setDraggedKind] = useState<WorkflowNodeKind | null>(null);

  // 撤销/重做栈
  const historyRef = useRef<{ stack: Snapshot[]; idx: number }>({ stack: [{ nodes: EMPTY_NODES, edges: EMPTY_EDGES }], idx: 0 });
  useEffect(() => {
    if (!remoteVersions.length) return;
    const mapped = remoteVersions.map(mapRemoteVersion);
    setVersions(mapped);
    setActiveVersion((prev) => (prev && mapped.some((item) => item.id === prev) ? prev : (mapped[0]?.id ?? '')));
    setSkillSourceVersion((prev) => (prev && mapped.some((item) => item.id === prev) ? prev : (mapped[0]?.id ?? '')));
    setVersionCenterSelectedId((prev) => prev && mapped.some((item) => item.id === prev) ? prev : (mapped[0]?.id ?? ''));
    setDiffBaseId((prev) => prev && mapped.some((item) => item.id === prev) ? prev : (mapped.find((item) => item.id !== mapped[0]?.id)?.id ?? mapped[0]?.id ?? ''));
  }, [remoteVersions]);

  useEffect(() => {
    draftHydratedRef.current = false;
  }, [workflowId]);

  useEffect(() => {
    if (!workflowDraft || draftHydratedRef.current) return;
    draftHydratedRef.current = true;
    const flow = draftToFlow(workflowDraft);
    const snapshot = cloneSnapshot(flow);
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    historyRef.current = { stack: [snapshot], idx: 0 };
    setSelectedNodeId(null);
    setCleanBaseline(JSON.stringify({ nodes: snapshot.nodes, edges: snapshot.edges }));
  }, [workflowDraft, workflowId]);
  const pushHistory = useCallback((next: Snapshot) => {
    const h = historyRef.current;
    h.stack = h.stack.slice(0, h.idx + 1);
    h.stack.push(cloneSnapshot(next));
    if (h.stack.length > 50) h.stack.shift();
    h.idx = h.stack.length - 1;
  }, []);
  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.idx <= 0) { showToast('已是最早版本，无法撤销', 'info'); return; }
    h.idx -= 1;
    const snap = h.stack[h.idx];
    setNodes(snap.nodes);
    setEdges(snap.edges);
    showToast('已撤销', 'info');
  }, [showToast]);
  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.idx >= h.stack.length - 1) { showToast('已是最新版本，无法重做', 'info'); return; }
    h.idx += 1;
    const snap = h.stack[h.idx];
    setNodes(snap.nodes);
    setEdges(snap.edges);
    showToast('已重做', 'info');
  }, [showToast]);

  // 命令式 ReactFlow 控制
  const reactFlowRef = useRef<any>(null);
  const focusNode = useCallback((id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node || !reactFlowRef.current) return;
    const { x, y } = node.position;
    reactFlowRef.current.setCenter?.(x + 70, y + 30, { zoom: 1.3, duration: 500 });
    setSelectedNodeId(id);
    setSidePanel('debug');
    showToast(`已定位到节点 ${id}`, 'info');
  }, [nodes, showToast]);

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
      // Esc 关闭弹层
      if (e.key === 'Escape') {
        if (contextMenu) { setContextMenu(null); return; }
        if (versionMenuOpen) { setVersionMenuOpen(false); return; }
        if (previewTemplate) { setPreviewTemplate(null); return; }
      }
      if (isInput) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 's') { e.preventDefault(); saveCanvasRef.current?.(); return; }
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        e.preventDefault();
        deleteNodeRef.current?.(selectedNodeId);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId, contextMenu, versionMenuOpen, previewTemplate, undo, redo]);

  const availableTemplates = useMemo(() => {
    const fromApi = templateAssets.length > 0
      ? templateAssets.map((item) => normalizeTemplateAsset(item, connectorBindings))
      : (templateOriginFilter === 'personal'
        ? []
        : ALL_WORKFLOW_TEMPLATES.map((item) => normalizeTemplateAsset(item, connectorBindings)));
    const byId = new Map(fromApi.map((item) => [item.id, item]));
    // 仅在平台库补齐前端出厂包；个人库完全以 API / mock 为准
    if (templateOriginFilter === 'platform') {
      for (const item of ALL_WORKFLOW_TEMPLATES) {
        if (!byId.has(item.id)) byId.set(item.id, normalizeTemplateAsset(item, connectorBindings));
      }
    }
    return filterByIndustry(Array.from(byId.values()), filterIndustry);
  }, [templateAssets, connectorBindings, filterIndustry, templateOriginFilter]);
  const filteredTemplates = availableTemplates.filter((t) => {
    if (templateOriginFilter === 'platform' ? !isPlatformTemplate(t) : !isPersonalTemplate(t)) return false;
    if (templateOriginFilter === 'platform' && !showAdvancedLibrary && t.library === 'advanced') return false;
    if (filterGroup !== 'all' && t.department !== filterGroup) return false;
    if (workspaceDeptOnly && workspaceDepartments.size > 0 && !workspaceDepartments.has(t.department)) return false;
    return true;
  });
  const platformTemplateCount = availableTemplates.filter((t) => isPlatformTemplate(t) && t.library === 'default').length;
  const personalTemplateCount = availableTemplates.filter((t) => isPersonalTemplate(t)).length;
  const filteredLibrary = NODE_LIB.filter((k) =>
    !librarySearchQ || NODE_LABELS[k].includes(librarySearchQ) || NODE_DESCS[k].toLowerCase().includes(librarySearchQ.toLowerCase()),
  );

  // 当前选中节点
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  );

  // ReactFlow 节点（增加 selected 标记）
  const rfNodes = useMemo<Node[]>(
    () => nodes.map((n) => ({
      ...n,
      selected: n.id === selectedNodeId,
      data: { ...n.data, id: n.id },
    })),
    [nodes, selectedNodeId],
  );
  const rfEdges = useMemo<Edge[]>(
    () => edges.map((e) => ({
      ...e,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
      style: { stroke: '#94a3b8', strokeWidth: 1.2 },
    })),
    [edges],
  );

  const nodeDragSnapshotRef = useRef<Snapshot | null>(null);
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prev) => {
      const next = applyNodeChanges(changes, prev);
      const positionChanges = changes.filter((change) => change.type === 'position');
      if (positionChanges.length) {
        if (positionChanges.some((change) => change.type === 'position' && change.dragging) && !nodeDragSnapshotRef.current) {
          nodeDragSnapshotRef.current = cloneSnapshot({ nodes: prev, edges });
        }
        if (positionChanges.some((change) => change.type === 'position' && !change.dragging)) {
          pushHistory({ nodes: next, edges });
          nodeDragSnapshotRef.current = null;
        }
      }
      return next;
    });
  }, [edges, pushHistory]);

  /* —— 节点操作 —— */
  const addNode = useCallback((kind: WorkflowNodeKind, position?: { x: number; y: number }) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    const id = `n${Date.now().toString(36)}`;
    const pos = position ?? { x: 200 + Math.random() * 200, y: 240 + Math.random() * 120 };
    const newNode: Node = { id, type: 'custom', position: pos, data: { kind, label: NODE_LABELS[kind] } };
    setNodes((prev) => {
      const next = [...prev, newNode];
      pushHistory({ nodes: next, edges });
      return next;
    });
    setSelectedNodeId(id);
    setSidePanel('properties');
    showToast(`已添加节点 ${NODE_LABELS[kind]}（${id}）`, 'success');
  }, [edges, pushHistory, showToast]);

  const deleteNode = useCallback((id: string) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    setNodes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      setEdges((prevE) => {
        const nextE = prevE.filter((e) => e.source !== id && e.target !== id);
        pushHistory({ nodes: next, edges: nextE });
        return nextE;
      });
      return next;
    });
    if (selectedNodeId === id) setSelectedNodeId(null);
    showToast(`节点 ${id} 已删除`, 'info');
  }, [selectedNodeId, showToast, pushHistory]);

  const duplicateNode = useCallback((id: string) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    const src = nodes.find((n) => n.id === id);
    if (!src) return;
    const newId = `n${Date.now().toString(36)}`;
    const cloned: Node = {
      ...src,
      id: newId,
      position: { x: src.position.x + 40, y: src.position.y + 40 },
      data: { ...src.data, label: (src.data?.label ?? NODE_LABELS[src.data.kind as WorkflowNodeKind]) + ' (副本)' },
    };
    setNodes((prev) => {
      const next = [...prev, cloned];
      pushHistory({ nodes: next, edges });
      return next;
    });
    setSelectedNodeId(newId);
    showToast(`节点 ${id} 已复制为 ${newId}`, 'success');
  }, [nodes, edges, pushHistory, showToast]);

  const updateNodeLabel = useCallback((id: string, label: string) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    setNodes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n));
      pushHistory({ nodes: next, edges });
      return next;
    });
  }, [canWrite, edges, pushHistory, showToast]);

  const updateNodeDescription = useCallback((id: string, desc: string) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    setNodes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, desc } } : n));
      pushHistory({ nodes: next, edges });
      return next;
    });
  }, [canWrite, edges, pushHistory, showToast]);

  const updateNodeNote = useCallback((id: string, note: string) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    setNodes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, note } } : n));
      pushHistory({ nodes: next, edges });
      return next;
    });
  }, [canWrite, edges, pushHistory, showToast]);

  const patchNodeData = useCallback((id: string, patch: Record<string, unknown>) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    setNodes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
      pushHistory({ nodes: next, edges });
      return next;
    });
  }, [canWrite, edges, pushHistory, showToast]);

  const structureIssues = useMemo(() => evaluateWorkflowStructure(nodes, edges), [nodes, edges]);

  const disableNode = useCallback((id: string) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    setNodes((prev) => {
      const wasDisabled = prev.find((n) => n.id === id)?.data?.disabled;
      const next = prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, disabled: !n.data?.disabled } } : n));
      pushHistory({ nodes: next, edges });
      showToast(`节点 ${id} ${wasDisabled ? '已启用' : '已禁用'}（运行时跳过）`, 'info');
      return next;
    });
  }, [edges, pushHistory, showToast]);

  const clearCanvas = useCallback(() => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    setClearConfirmOpen(true);
  }, [canWrite, showToast]);

  const confirmClearCanvas = useCallback(() => {
    setNodes([]);
    setEdges([]);
    pushHistory({ nodes: [], edges: [] });
    setSelectedNodeId(null);
    showToast('画布已清空（本地草稿）', 'info');
  }, [showToast, pushHistory]);

  const resetCanvas = useCallback(() => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    const snapshot = cloneSnapshot({
      nodes: SAMPLE_NODES.map((node) => ({ ...node, data: { ...node.data }, position: { ...node.position } })),
      edges: SAMPLE_EDGES.map((edge) => ({ ...edge })),
    });
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    pushHistory(snapshot);
    setSelectedNodeId(null);
    setDraftGate(null);
    showToast('已加载示例编排模板（需保存草稿才会写入服务端）', 'success');
  }, [canWrite, showToast, pushHistory]);

  const saveCanvas = useCallback(() => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    const id = activeVersion;
    const version = versions.find((item) => item.id === id);
    if (version?.status === 'published') {
      showToast('已发布版本不可覆盖，请先另存为新草稿', 'error');
      return;
    }
    const snapshot = cloneSnapshot({ nodes, edges });
    setVersions((prev) => prev.map((item) => item.id === id ? {
      ...item,
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
      evidenceMode: 'recorded',
      time: '刚刚',
      desc: '保存当前本地草稿',
    } : item));
    saveWorkflowApi.mutate({
      workflowId,
      nodes: nodes.map((node) => ({ id: node.id, kind: node.data?.kind, label: node.data?.label, data: node.data, position: node.position })),
      edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
      version: id,
      desc: '保存当前本地草稿',
    }, { onSuccess: () => refetchVersions() });
    setCleanBaseline(JSON.stringify({ nodes: snapshot.nodes, edges: snapshot.edges }));
    showToast(`已保存 ${version?.label ?? id}（工作流草稿）`, 'success');
  }, [activeVersion, canWrite, edges, nodes, refetchVersions, saveWorkflowApi, showToast, versions, workflowId]);

  const saveAsVersion = useCallback((label?: string) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    if (!nodes.length) { showToast('空画布不能另存版本', 'error'); return; }
    createVersionApi.mutate({
      workflowId,
      label,
      desc: '从当前画布另存的草稿版本',
      parentVersionId: activeVersion,
      nodes: nodes.map((node) => ({ id: node.id, kind: node.data?.kind, label: node.data?.label, data: node.data, position: node.position })),
      edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
    });
  }, [activeVersion, canWrite, createVersionApi, edges, nodes, showToast, workflowId]);

  const loadSnapshot = useCallback((snapshot: Snapshot, versionId: string) => {
    const next = cloneSnapshot(snapshot);
    setNodes(next.nodes);
    setEdges(next.edges);
    setActiveVersion(versionId);
    setSkillSourceVersion(versionId);
    setSelectedNodeId(next.nodes[0]?.id ?? null);
    pushHistory(next);
    setCleanBaseline(JSON.stringify({ nodes: next.nodes, edges: next.edges }));
  }, [pushHistory]);

  const runWorkflow = useCallback(() => {
    if (!canExecute) { showToast('当前账号没有工作流执行权限', 'error'); return; }
    if (draftGate?.blocked) {
      showToast(`模板依赖未授权，禁止试运行：${draftGate.reasons[0] ?? '请先完成依赖授权'}`, 'error');
      return;
    }
    if (!nodes.length) { showToast('画布为空，无法运行工作流', 'error'); return; }
    const issues = evaluateWorkflowStructure(nodes, edges);
    const blocking = issues.filter((item) => item.severity === 'failed');
    if (blocking.length) {
      showToast(blocking[0].message, 'error');
      return;
    }
    validateWorkflowApi.mutate({ workflowId, revisionId: activeVersion.startsWith('rev_') || activeVersion.startsWith('tpl_') || activeVersion.startsWith('ver_') || activeVersion.startsWith('pub_') ? activeVersion : undefined, nodes: nodes.map((node) => ({ id: node.id, kind: node.data?.kind, label: node.data?.label, data: node.data })), edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })) });
  }, [activeVersion, canExecute, draftGate, edges, nodes, showToast, validateWorkflowApi, workflowId]);

  const openAIGenerator = useCallback(() => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    navigate('/workflows/orchestration');
  }, [canWrite, navigate, showToast]);
  const submitGeneration = useCallback(() => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    if (generationPrompt.trim().length < 8) { showToast('请至少描述 8 个字符的业务目标', 'error'); return; }
    generateWorkflowApi.mutate({ prompt: generationPrompt.trim(), constraints: generationConstraints, workspaceId: currentWorkspaceId, model: generationModel });
  }, [canWrite, currentWorkspaceId, generateWorkflowApi, generationConstraints, generationModel, generationPrompt, showToast]);
  const applyGeneration = useCallback(async () => {
    if (!canWrite || !generationResult) return;
    const activeSnapshot = versions.find((version) => version.id === activeVersion);
    const hasUnsavedChanges = !activeSnapshot || JSON.stringify({ nodes, edges }) !== JSON.stringify({ nodes: activeSnapshot.nodes, edges: activeSnapshot.edges });
    if (hasUnsavedChanges && !window.confirm('当前画布存在未保存修改。AI 辅助编排将另存为新的隔离草稿，是否继续？')) return;
    const applied = await applyGenerationApi.mutateAsync({ id: generationResult.id });
    if (!applied.revisionId) { showToast('服务端未返回草稿版本，未应用生成结果', 'error'); return; }
    const snapshot: Snapshot = {
      nodes: applied.workflow.nodes.map((node) => ({ id: node.id, type: 'custom', position: node.position, data: { kind: node.kind, label: node.label, desc: node.description } } as Node)),
      edges: applied.workflow.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
    };
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setVersions((previous) => previous.some((version) => version.id === applied.revisionId) ? previous : [{ id: applied.revisionId!, label: `${applied.revisionId} · AI 草稿`, time: '刚刚', desc: `AI 辅助编排 · ${applied.promptDigest ?? applied.id}`, nodes: cloneSnapshot(snapshot).nodes, edges: cloneSnapshot(snapshot).edges }, ...previous]);
    setActiveVersion(applied.revisionId);
    pushHistory(snapshot);
    setSelectedNodeId(snapshot.nodes[0]?.id ?? null);
    setTab('canvas');
    setSidePanel('properties');
    setAiGenerateOpen(false);
    showToast(`已创建隔离草稿 ${applied.revisionId}，专家复核后可发布为流程技能供数字伙伴装配`, 'success');
  }, [activeVersion, applyGenerationApi, canWrite, edges, generationResult, nodes, pushHistory, showToast, versions]);
  const discardGeneration = useCallback(() => {
    if (generationResult) discardGenerationApi.mutate({ id: generationResult.id });
    setAiGenerateOpen(false);
    setGenerationResult(null);
    setGenerationStep('input');
  }, [discardGenerationApi, generationResult]);
  const createTemplateDraft = useCallback((template: WorkflowTemplateAsset) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    const asset = normalizeTemplateAsset(template, connectorBindings);
    const snapshot = templateSnapshot(asset);
    const currentSnapshot = versions.find((version) => version.id === activeVersion);
    const hasUnsavedChanges = !currentSnapshot || JSON.stringify({ nodes, edges }) !== JSON.stringify({ nodes: currentSnapshot.nodes, edges: currentSnapshot.edges });
    if (hasUnsavedChanges && !window.confirm('当前画布存在未保存修改。模板将创建为新的隔离草稿，是否继续？')) return;
    const revisionId = `tpl_${asset.id}_${Date.now().toString(36)}`;
    const reasons = asset.blockers.length ? asset.blockers : deriveTemplateBlockers(asset);
    const blocked = !isTemplateReusable(asset);
    const provenance = {
      sourceTemplateId: asset.id,
      sourceTemplateVersion: asset.version,
      certification: asset.certification,
      degraded: Boolean(asset.healthHint),
    };
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setVersions((previous) => [{
      id: revisionId,
      label: `${asset.version} · 模板草稿`,
      time: '刚刚',
      desc: `sourceTemplateId=${asset.id}@${asset.version} · ${asset.name} · ${asset.owner}${asset.healthHint ? ` · ${asset.healthHint}` : ''}`,
      nodes: cloneSnapshot(snapshot).nodes,
      edges: cloneSnapshot(snapshot).edges,
    }, ...previous]);
    setActiveVersion(revisionId);
    pushHistory(snapshot);
    setSelectedNodeId(snapshot.nodes[0]?.id ?? null);
    setDraftGate({
      blocked,
      reasons: reasons.length ? reasons : (blocked ? ['存在未满足的依赖或治理条件'] : []),
      templateId: asset.id,
      templateName: asset.name,
      templateVersion: asset.version,
      owner: asset.owner,
      sourceTemplateId: provenance.sourceTemplateId,
      sourceTemplateVersion: provenance.sourceTemplateVersion,
      degraded: provenance.degraded,
      healthHint: asset.healthHint,
    });
    setTab('canvas');
    setSidePanel('properties');
    showToast(
      blocked
        ? `已基于「${asset.name}」创建隔离草稿（依赖未授权，试运行与发布已禁用）`
        : asset.healthHint
          ? `已基于「${asset.name}」创建隔离草稿（${asset.healthHint}）`
          : `已基于「${asset.name}」创建隔离草稿（溯源 ${asset.id}@${asset.version}）`,
      blocked ? 'info' : 'success',
    );
  }, [activeVersion, canWrite, connectorBindings, edges, nodes, pushHistory, showToast, versions]);

  const saveAsPersonalTemplate = useCallback(() => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    if (!nodes.length) { showToast('空画布不能保存为个人模板', 'error'); return; }
    const defaultName = versions.find((v) => v.id === activeVersion)?.label?.replace(/^v?\d[\w.-]*\s*[·•-]?\s*/, '') || '我的流程模板';
    const name = window.prompt('个人模板名称', defaultName || '我的流程模板');
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) { showToast('模板名称不能为空', 'error'); return; }
    const sequence = nodes.map((n) => String(n.data?.kind ?? 'task'));
    createPersonalTemplateApi.mutate({
      name: trimmed,
      description: `由画布另存 · ${nodes.length} 节点 / ${edges.length} 连线`,
      department: filterGroup === 'all' ? 'it' : filterGroup,
      sequence,
      graph: {
        nodes: nodes.map((n) => ({ id: n.id, kind: n.data?.kind, label: n.data?.label, position: n.position })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      },
      risk: 'L2',
    });
  }, [activeVersion, canWrite, createPersonalTemplateApi, edges, filterGroup, nodes, showToast, versions]);

  const deletePersonalTemplate = useCallback((template: WorkflowTemplateAsset) => {
    if (!canWrite) { showToast('当前账号没有工作流编辑权限', 'error'); return; }
    if (!isPersonalTemplate(template)) { showToast('平台内置模板不可删除', 'error'); return; }
    if (!window.confirm(`确认删除个人模板「${template.name}」？此操作不可恢复。`)) return;
    deletePersonalTemplateApi.mutate({ id: template.id });
  }, [canWrite, deletePersonalTemplateApi, showToast]);

  const bindConnectorSlot = useCallback((slotName: string, binding = `workspace:${slotName}`) => {
    const next = { ...connectorBindings, [slotName]: binding };
    setConnectorBindings(next);
    saveConnectorBindings(currentWorkspaceId, next);
    showToast(`已绑定槽位 ${slotName}`, 'success');
  }, [connectorBindings, currentWorkspaceId, showToast]);

  const openUpgradeDiff = useCallback((template: WorkflowTemplateAsset) => {
    const latest = availableTemplates.find((t) => t.id === template.id) ?? template;
    const current = draftGate?.sourceTemplateId === template.id
      ? { ...template, version: draftGate.sourceTemplateVersion || template.version }
      : { ...template, version: '0.9.0' };
    // 演示：若 changelog 含更高版本预告，构造升级 Diff
    const previewLatest = template.changelog.some((c) => c.version !== template.version)
      ? {
          ...latest,
          version: template.changelog.map((c) => c.version).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1) || latest.version,
        }
      : latest;
    const diff = diffTemplateUpgrade(current, previewLatest);
    if (!diff.available && template.id === 'wf.fin.expense') {
      const synthetic = diffTemplateUpgrade(
        { ...template, version: '1.0.0' },
        {
          ...template,
          version: '1.1.0',
          sequence: [...template.sequence, 'schedule'],
          connectors: [...template.connectors, { slot: 'budget.check', label: '预算校验', required: false, capability: 'budget.check' }],
          changelog: [...template.changelog],
        },
      );
      setUpgradeDiff({ template, diff: synthetic });
      return;
    }
    setUpgradeDiff({ template, diff });
  }, [availableTemplates, draftGate]);
  const exportWorkflow = useCallback(() => {
    const data = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: n.data?.kind,
        label: n.data?.label,
        desc: n.data?.desc,
        note: n.data?.note,
        position: n.position,
        disabled: !!n.data?.disabled,
      })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-${activeVersion}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`已导出工作流（${nodes.length} 节点 / ${edges.length} 连线）`, 'success');
  }, [nodes, edges, activeVersion, showToast]);

  // 把高频 handler 用 ref 暴露给键盘监听器
  const saveCanvasRef = useRef(saveCanvas); saveCanvasRef.current = saveCanvas;
  const deleteNodeRef = useRef(deleteNode); deleteNodeRef.current = deleteNode;

  // 节点连线
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;
    // 避免重复
    if (edges.some((e) => e.source === connection.source && e.target === connection.target)) {
      showToast('连线已存在', 'info');
      return;
    }
    const newEdge: Edge = {
      id: `e${connection.source}-${connection.target}-${Date.now().toString(36)}`,
      source: connection.source!,
      target: connection.target!,
    };
    setEdges((prev) => {
      const next = [...prev, newEdge];
      pushHistory({ nodes, edges: next });
      return next;
    });
    showToast(`已连线：${connection.source} → ${connection.target}`, 'success');
  }, [edges, nodes, pushHistory, showToast]);

  const deleteEdge = useCallback((id: string) => {
    setEdges((prev) => {
      const next = prev.filter((e) => e.id !== id);
      pushHistory({ nodes, edges: next });
      showToast(`连线 ${id} 已删除`, 'info');
      return next;
    });
  }, [nodes, pushHistory, showToast]);

  // 节点搜索（精确 id 或 label 包含）
  const searchMatch = useMemo(() => {
    if (!canvasSearchQ || tab !== 'canvas') return null;
    const q = canvasSearchQ.trim().toLowerCase();
    if (!q) return null;
    return nodes.find((n) =>
      n.id.toLowerCase() === q ||
      (n.data?.label ?? '').toLowerCase().includes(q) ||
      (n.data?.kind ?? '').toLowerCase().includes(q),
    );
  }, [canvasSearchQ, nodes, tab]);

  /* —— 节点交互 —— */
  const onNodeClick: NodeMouseHandler = useCallback((_, node) => {
    setSelectedNodeId(node.id);
    setSidePanel('properties');
  }, []);

  const onNodeContextMenu: NodeMouseHandler = useCallback((event, node) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
    setSelectedNodeId(node.id);
  }, []);

  /* —— 拖拽到画布 —— */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('application/wf-node') as WorkflowNodeKind;
    if (!kind || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const screenPosition = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const position = reactFlowRef.current?.screenToFlowPosition
      ? reactFlowRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      : reactFlowRef.current?.project
        ? reactFlowRef.current.project(screenPosition)
        : { x: screenPosition.x - 80, y: screenPosition.y - 30 };
    addNode(kind, position);
    setDraggedKind(null);
  }, [addNode]);

  const filteredNodes = nodes; // 留作以后按筛选条件过滤
  const activeSnapshot = versions.find((version) => version.id === activeVersion);
  const isDirty = useMemo(() => {
    const current = JSON.stringify({ nodes, edges });
    if (cleanBaseline) return current !== cleanBaseline;
    // 后端版本常无图快照：无基线时不以“找不到 v4”误判为脏
    if (!activeSnapshot) return false;
    if (!activeSnapshot.nodes.length && !activeSnapshot.edges.length && activeSnapshot.evidenceMode === 'synthetic') {
      return false;
    }
    return current !== JSON.stringify({ nodes: activeSnapshot.nodes, edges: activeSnapshot.edges });
  }, [activeSnapshot, cleanBaseline, edges, nodes]);
  useEffect(() => {
    if (!isDirty) return;
    setPreflightResult(null);
    setPreflightVersion(null);
  }, [isDirty]);
  useEffect(() => {
    setPreflightResult(null);
    setPreflightVersion(null);
  }, [activeVersion]);
  const skillValidationReady = Boolean(
    preflightResult?.passed
    && preflightVersion === skillSourceVersion
    && skillSourceVersion === activeVersion
    && !isDirty,
  );
  const canPublishSkill = Boolean(
    canWrite
    && skillName.trim()
    && !isDirty
    && !draftGate?.blocked
    && skillValidationReady,
  );
  const skillGateSteps = useMemo(() => {
    const versionAligned = skillSourceVersion === activeVersion;
    const validated = Boolean(preflightResult?.passed && preflightVersion === skillSourceVersion);
    return [
      {
        key: 'draft',
        title: '画布草稿已保存',
        detail: isDirty ? '存在未保存修改，请先保存' : '当前版本与画布一致且无脏数据',
        ok: !isDirty,
      },
      {
        key: 'version',
        title: '来源版本已加载到画布',
        detail: versionAligned ? `${skillSourceVersion} 已是画布当前版本` : `请先在版本管理加载 ${skillSourceVersion}`,
        ok: versionAligned,
      },
      {
        key: 'validate',
        title: '运行前校验已通过',
        detail: validated ? `校验通过 · ${skillSourceVersion}` : '请对本版本执行并通过运行前校验',
        ok: validated,
      },
      {
        key: 'deps',
        title: '模板依赖就绪',
        detail: draftGate?.blocked ? (draftGate.reasons[0] ?? '依赖未授权') : '无阻断依赖，可进入发布',
        ok: !draftGate?.blocked,
      },
    ] as const;
  }, [activeVersion, draftGate, isDirty, preflightResult?.passed, preflightVersion, skillSourceVersion]);
  const skillGateHint = isDirty
    ? '请先保存画布草稿后再发布技能'
    : draftGate?.blocked
      ? '来源模板依赖未授权，完成授权前不可发布技能'
      : !skillValidationReady
        ? '发布前须对画布当前版本完成并通过运行前校验'
        : null;
  const publishedSkillCount = workflowSkills.filter((skill) => skill.status === 'published').length;
  const draftSkillCount = workflowSkills.filter((skill) => skill.status === 'draft').length;

  return (
    <div className="workflow-page flex h-full min-w-0 flex-col gap-3 overflow-hidden bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5">
      <section className="de-employee-shell shrink-0 overflow-hidden rounded-xl bg-[var(--surface-1)]">
        <div className="flex items-start justify-between gap-4 px-4 py-3.5 md:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg text-[var(--text-secondary)]">
                <GitBranch className="h-4 w-4" />
              </div>
              <h1 className="text-base font-semibold text-[var(--text)]">{pageCopy.title}</h1>
            </div>
            <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{pageCopy.subtitle}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {tab === 'canvas' && (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--bg)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)]" style={{ boxShadow: 'var(--saas-ring)' }}>
                  <Box className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                  {nodes.length} 节点 · {edges.length} 连线
                </span>
                {isDirty && <Badge tone="warn">草稿未保存</Badge>}
                {canWrite && nodes.length > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => saveAsPersonalTemplate()}>
                    <Save className="h-3.5 w-3.5" />存为个人模板
                  </Button>
                )}
              </>
            )}
            {tab === 'templates' && (
              <span className="rounded-lg bg-[var(--bg)] px-2.5 py-1.5 text-[11px] text-[var(--text-muted)]" style={{ boxShadow: 'var(--saas-ring)' }}>
                {templateOriginFilter === 'personal'
                  ? `个人创建 · ${personalTemplateCount} 套`
                  : `平台内置 · ${platformTemplateCount} 套`}
              </span>
            )}
            {tab === 'publishSkill' && (
              <span className="rounded-lg bg-[var(--bg)] px-2.5 py-1.5 text-[11px] text-[var(--text-muted)]" style={{ boxShadow: 'var(--saas-ring)' }}>
                已发布 {publishedSkillCount} · 待治理 {draftSkillCount}
              </span>
            )}
            {tab === 'history' && (
              <span className="rounded-lg bg-[var(--bg)] px-2.5 py-1.5 text-[11px] text-[var(--text-muted)]" style={{ boxShadow: 'var(--saas-ring)' }}>
                运行记录 · {workflowRuns.length} 条
              </span>
            )}
            {tab === 'versions' && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand-light)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--brand)]">
                  <GitCompare className="h-3.5 w-3.5" />版本中心
                </span>
                {canWrite && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setTab('canvas')}>返回画布</Button>
                    <Button size="sm" variant="secondary" onClick={() => setTab('publishSkill')}>去发布技能</Button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="px-4 pt-1 md:px-5"><RoleReadonlyBanner className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]" /></div>
        <div className="de-employee-tabs flex overflow-x-auto px-3" role="tablist" aria-label="工作流视图">
          {([
            { k: 'templates' as TabKey, label: t('module.workflows.tabs.templates'), icon: Layers },
            { k: 'canvas' as TabKey, label: t('module.workflows.tabs.canvas'), icon: GitBranch },
            { k: 'publishSkill' as TabKey, label: t('module.workflows.tabs.publishSkill'), icon: Sparkles },
            { k: 'versions' as TabKey, label: t('module.workflows.tabs.versions'), icon: GitCompare },
            { k: 'history' as TabKey, label: t('module.workflows.tabs.history'), icon: History },
          ]).filter((v) => workflowTabs.includes(v.k as WorkflowTab)).map((v) => (
            <button
              key={v.k}
              type="button"
              role="tab"
              aria-selected={tab === v.k}
              aria-current={tab === v.k ? 'page' : undefined}
              onClick={() => setTab(v.k)}
              className={cn('de-employee-tab flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs transition-colors', tab === v.k && 'is-active')}
            >
              <v.icon className="h-3.5 w-3.5" />
              {v.label}
            </button>
          ))}
        </div>
        {tab === 'versions' && canWrite && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-2.5 md:px-5">
            <span className="text-[11px] text-[var(--text-muted)]">由画布「当前版本」胶囊进入 · 不与模板库并列为主导航</span>
          </div>
        )}
      </section>

      {/* ======== 主内容区 ======== */}
      <div className="de-employee-shell min-h-0 flex-1 overflow-hidden rounded-xl bg-[var(--surface-1)]">
        {tab === 'canvas' && (
          <CanvasView
            wrapperRef={wrapperRef}
            rfNodes={rfNodes}
            rfEdges={rfEdges}
            onNodeClick={onNodeClick}
            onNodeContextMenu={onNodeContextMenu}
            onNodesChange={onNodesChange}
            handleDragOver={handleDragOver}
            handleDrop={handleDrop}
            sidePanel={sidePanel}
            setSidePanel={setSidePanel}
            librarySearchQ={librarySearchQ}
            setLibrarySearchQ={setLibrarySearchQ}
            canvasSearchQ={canvasSearchQ}
            setCanvasSearchQ={setCanvasSearchQ}
            searchMatch={searchMatch ?? null}
            focusNode={focusNode}
            filteredLibrary={filteredLibrary}
            draggedKind={draggedKind}
            setDraggedKind={setDraggedKind}
            selectedNode={selectedNode}
            selectedNodeId={selectedNodeId}
            nodes={filteredNodes}
            webhookEnabled={webhookEnabled}
            setWebhookEnabled={setWebhookEnabled}
            saveCanvas={saveCanvas}
            saving={saveWorkflowApi.isPending}
            runWorkflow={runWorkflow}
            resetCanvas={resetCanvas}
            clearCanvas={clearCanvas}
            addNode={addNode}
            deleteNode={deleteNode}
            duplicateNode={duplicateNode}
            disableNode={disableNode}
            updateNodeLabel={updateNodeLabel}
            updateNodeDescription={updateNodeDescription}
            updateNodeNote={updateNodeNote}
            patchNodeData={patchNodeData}
            structureIssues={structureIssues}
            showToast={showToast}
            onConnect={onConnect}
            deleteEdge={deleteEdge}
            undo={undo}
            redo={redo}
            canUndo={historyRef.current.idx > 0}
            canRedo={historyRef.current.idx < historyRef.current.stack.length - 1}
            exportWorkflow={exportWorkflow}
            reactFlowRef={reactFlowRef}
            canWrite={canWrite}
            canExecute={canExecute}
            openAIGenerator={openAIGenerator}
            nodeLibraryOpen={nodeLibraryOpen}
            setNodeLibraryOpen={setNodeLibraryOpen}
            validating={validateWorkflowApi.isPending}
            versionMenuOpen={versionMenuOpen}
            setVersionMenuOpen={setVersionMenuOpen}
            versions={versions}
            activeVersion={activeVersion}
            loadSnapshot={loadSnapshot}
            setVersions={setVersions}
            setActiveVersion={setActiveVersion}
            setVersionDiffOpen={setVersionDiffOpen}
            publishVersion={requestProductionRelease}
            publishLabel={isAdmin ? '发布' : '提交发布申请'}
            publishing={publishWorkflowApi.isPending || releaseRequestApi.isPending}
            isDirty={isDirty}
            draftGate={draftGate}
            onOpenVersionCenter={() => { setVersionMenuOpen(false); setTab('versions'); }}
            onSaveAsVersion={() => saveAsVersion()}
            saveAsPending={createVersionApi.isPending}
            onRequestRollback={(versionId) => setRollbackTargetId(versionId)}
          />
        )}

        {tab === 'templates' && (
          <TemplatesView
            filterGroup={filterGroup}
            setFilterGroup={setFilterGroup}
            filterIndustry={filterIndustry}
            setFilterIndustry={setFilterIndustry}
            templateOrigin={templateOriginFilter}
            setTemplateOrigin={setTemplateOriginFilter}
            platformCount={platformTemplateCount}
            personalCount={personalTemplateCount}
            filteredTemplates={filteredTemplates}
            showAdvancedLibrary={showAdvancedLibrary}
            setShowAdvancedLibrary={setShowAdvancedLibrary}
            workspaceDeptOnly={workspaceDeptOnly}
            setWorkspaceDeptOnly={setWorkspaceDeptOnly}
            workspaceDeptCount={workspaceDepartments.size}
            onPreview={(t) => setPreviewTemplate(t)}
            onUseTemplate={createTemplateDraft}
            onBindSlot={bindConnectorSlot}
            onUpgradeDiff={openUpgradeDiff}
            onDeletePersonal={deletePersonalTemplate}
            onSaveFromCanvas={() => { setTab('canvas'); }}
            canWrite={canWrite}
            connectorBindings={connectorBindings}
          />
        )}

        {tab === 'history' && (
          <HistoryView
            showToast={showToast}
            workflowId={workflowId}
            canExecute={canExecute}
            focusRunId={focusRunId}
            onFocusConsumed={() => setFocusRunId(null)}
            onGoCanvas={() => setTab('canvas')}
          />
        )}

        {tab === 'publishSkill' && (
          <div className="wf-publish">
            <header className="wf-publish__hero">
              <div className="wf-publish__hero-main">
                <div className="wf-publish__eyebrow"><Sparkles className="h-3.5 w-3.5" />流程能力沉淀</div>
                <h2 className="wf-publish__title">发布为流程技能</h2>
                <p className="wf-publish__lead">
                  将已通过运行前校验的流程版本写入技能中心，供数字伙伴在能力装配中引用。
                  「调用需审批」指执行时双重审批，与本页发布门禁不同。
                </p>
              </div>
              <div className="wf-publish__hero-meta">
                <span className="wf-publish__meta-chip">来源流程 <code>{workflowId}</code></span>
                <span className="wf-publish__meta-chip">画布版本 <code>{activeVersion}</code></span>
                <Button size="sm" variant="ghost" onClick={() => setTab('canvas')}>返回编排</Button>
                <Button size="sm" variant="ghost" onClick={() => setTab('versions')}>版本中心</Button>
                <Button size="sm" variant="secondary" onClick={() => navigate('/skills?tab=workflowSkills')}>技能中心</Button>
              </div>
            </header>

            <WorkflowLifecycleStrip highlight="skill" />
            <div className="wf-boundary" role="group" aria-label="发布边界">
              <div className="wf-boundary__card">
                <strong>发布版本</strong>
                <span>写入不可变 revision，供生产执行与回滚。不进入技能中心。</span>
                <Button size="sm" variant="ghost" onClick={() => setTab('versions')}>去版本中心</Button>
              </div>
              <div className="wf-boundary__card is-active">
                <strong>发布技能（本页）</strong>
                <span>沉淀为可装配流程技能。依赖已有版本，但不替代「发布版本」。</span>
              </div>
            </div>

            <div className="wf-publish__grid">
              <section className="wf-publish__panel" aria-labelledby="wf-publish-form-title">
                <div className="wf-publish__panel-head">
                  <div>
                    <h3 id="wf-publish-form-title">发布配置</h3>
                    <p>填写技能标识与风险策略。同流程同版本再次发布会更新既有记录。</p>
                  </div>
                  <Badge tone={canPublishSkill ? 'success' : 'warn'}>{canPublishSkill ? '可发布' : '待满足门禁'}</Badge>
                </div>
                <div className="wf-publish__panel-body">
                  <div className="wf-publish__fields">
                    <label className="wf-publish__field">
                      <span>技能名称</span>
                      <input value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="例如：生产故障处置流程技能" />
                    </label>
                    <label className="wf-publish__field">
                      <span>来源版本</span>
                      <select value={skillSourceVersion} onChange={(e) => setSkillSourceVersion(e.target.value)}>
                        {versions.map((v) => (
                          <option key={v.id} value={v.id}>{v.label}{v.id === activeVersion ? '（画布当前）' : ''}</option>
                        ))}
                      </select>
                    </label>
                    <label className="wf-publish__field">
                      <span>风险等级</span>
                      <select
                        value={skillRiskLevel}
                        onChange={(e) => setSkillRiskLevel(e.target.value as WorkflowSkill['riskLevel'])}
                      >
                        <option value="low">低 · 调用可不强制审批</option>
                        <option value="mid">中 · 调用需审批</option>
                        <option value="high">高 · 非管理员先落草稿</option>
                      </select>
                    </label>
                    <label className="wf-publish__field wf-publish__field--full">
                      <span>说明</span>
                      <textarea value={skillDesc} onChange={(e) => setSkillDesc(e.target.value)} rows={3} placeholder="描述适用场景、审批边界与回滚能力" />
                    </label>
                  </div>

                  <div className="wf-publish__actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!canExecute || isDirty || !!draftGate?.blocked || skillSourceVersion !== activeVersion}
                      loading={validateWorkflowApi.isPending}
                      onClick={() => {
                        if (skillSourceVersion !== activeVersion) {
                          showToast('请先加载所选版本到画布后再校验', 'error');
                          return;
                        }
                        runWorkflow();
                      }}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />运行前校验
                    </Button>
                    <Button
                      size="sm"
                      disabled={!canPublishSkill}
                      loading={publishAsSkillApi.isPending}
                      onClick={() => {
                        if (draftGate?.blocked) { showToast(`模板依赖未授权，禁止发布技能：${draftGate.reasons[0]}`, 'error'); return; }
                        if (!skillValidationReady) { showToast('请先对当前画布版本完成运行前校验', 'error'); return; }
                        publishAsSkillApi.mutate({
                          workflowId,
                          version: skillSourceVersion,
                          name: skillName.trim(),
                          description: skillDesc.trim(),
                          riskLevel: skillRiskLevel,
                          validationPassed: true,
                          draftBlocked: Boolean(draftGate?.blocked),
                        });
                      }}
                    >
                      <Sparkles className="h-3.5 w-3.5" />发布为流程技能
                    </Button>
                    {skillSourceVersion !== activeVersion && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const version = versions.find((item) => item.id === skillSourceVersion);
                          if (!version) return;
                          loadSnapshot(version, version.id);
                          showToast(`已加载 ${version.label} 到画布`, 'info');
                        }}
                      >
                        加载所选版本
                      </Button>
                    )}
                    {isDirty && canWrite && (
                      <Button size="sm" variant="ghost" onClick={saveCanvas}>
                        <Save className="h-3.5 w-3.5" />保存草稿
                      </Button>
                    )}
                    {skillGateHint && <p className="wf-publish__actions-note">{skillGateHint}</p>}
                  </div>
                </div>
              </section>

              <aside className="wf-publish__panel" aria-labelledby="wf-publish-gate-title">
                <div className="wf-publish__panel-head">
                  <div>
                    <h3 id="wf-publish-gate-title">发布门禁</h3>
                    <p>四项全部通过后才可写入技能中心。</p>
                  </div>
                  <Badge tone={skillGateSteps.every((step) => step.ok) ? 'success' : 'neutral'}>
                    {skillGateSteps.filter((step) => step.ok).length}/{skillGateSteps.length}
                  </Badge>
                </div>
                <div className="wf-publish__panel-body">
                  <div className="wf-publish__gate-list">
                    {skillGateSteps.map((step, index) => (
                      <div key={step.key} className={cn('wf-publish__gate', step.ok ? 'is-ok' : 'is-bad')}>
                        <span className="wf-publish__gate-index" aria-hidden="true">
                          {step.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                        </span>
                        <div className="wf-publish__gate-copy">
                          <strong>{step.title}</strong>
                          <span>{step.detail}</span>
                        </div>
                        <Badge tone={step.ok ? 'success' : 'warn'}>{step.ok ? '通过' : '待处理'}</Badge>
                      </div>
                    ))}
                  </div>

                  <div className="wf-publish__preview" aria-label="发布预览">
                    <div className="wf-publish__preview-label">发布预览</div>
                    <div className="wf-publish__preview-name">{skillName.trim() || '未命名流程技能'}</div>
                    <p className="wf-publish__preview-desc">{skillDesc.trim() || '尚未填写说明'}</p>
                    <div className="wf-publish__preview-tags">
                      <Badge tone="neutral">{workflowId} @ {skillSourceVersion}</Badge>
                      <Badge tone={skillRiskLevel === 'high' ? 'error' : skillRiskLevel === 'mid' ? 'warn' : 'success'}>
                        {skillRiskLevel === 'high' ? '高风险' : skillRiskLevel === 'mid' ? '中风险' : '低风险'}
                      </Badge>
                      {skillRiskLevel !== 'low' && <Badge tone="warn">调用需审批</Badge>}
                      {skillRiskLevel === 'high' && !isAdmin && <Badge tone="warn">将落草稿</Badge>}
                    </div>
                  </div>
                </div>
              </aside>
            </div>

            <section className="wf-publish__panel" aria-labelledby="wf-publish-list-title">
              <div className="wf-publish__list-head">
                <div>
                  <h3 id="wf-publish-list-title" className="text-[13px] font-semibold text-[var(--text)]">本工作区流程技能</h3>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">
                    已发布 {publishedSkillCount} · 待治理 {draftSkillCount}。装配仅接受已发布项。
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => navigate('/skills?tab=workflowSkills')}>
                  在技能中心查看 <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div>
                {workflowSkills.length ? workflowSkills.map((skill) => (
                  <article key={skill.id} className="wf-publish__skill-row">
                    <div className="min-w-0">
                      <div className="wf-publish__skill-title">
                        <GitBranch className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
                        <span className="truncate">{skill.name}</span>
                      </div>
                      <p className="wf-publish__skill-meta">
                        <code>{skill.sourceWorkflowId}@{skill.sourceVersionId}</code>
                        {skill.description ? ` · ${skill.description}` : ''}
                      </p>
                    </div>
                    <div className="wf-publish__skill-tags">
                      <Badge tone={skill.status === 'published' ? 'success' : skill.status === 'draft' ? 'warn' : 'neutral'}>
                        {skill.status === 'published' ? '已发布' : skill.status === 'draft' ? '待治理发布' : skill.status}
                      </Badge>
                      <Badge tone={skill.riskLevel === 'high' ? 'error' : skill.riskLevel === 'mid' ? 'warn' : 'success'}>
                        {skill.riskLevel === 'high' ? '高风险' : skill.riskLevel === 'mid' ? '中风险' : '低风险'}
                      </Badge>
                      {skill.approvalRequired && <Badge tone="warn">调用需审批</Badge>}
                    </div>
                  </article>
                )) : (
                  <div className="wf-publish__empty">
                    <Sparkles className="mb-1 h-6 w-6 opacity-35" />
                    <strong>尚未发布流程技能</strong>
                    <span>完成门禁后，发布结果会出现在此处</span>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {tab === 'versions' && (() => {
          const selectedVersion = versions.find((item) => item.id === versionCenterSelectedId) ?? versions[0];
          const compareBase = versions.find((item) => item.id === diffBaseId) ?? versions.find((item) => item.id !== selectedVersion?.id) ?? selectedVersion;
          const diffTarget = selectedVersion ? { nodes: selectedVersion.nodes, edges: selectedVersion.edges } : { nodes, edges };
          const diff = selectedVersion && compareBase
            ? computeVersionDiff(compareBase, selectedVersion.id === activeVersion ? { nodes, edges } : diffTarget)
            : null;
          const recordedCount = versions.filter((item) => item.evidenceMode === 'recorded').length;
          const publishedCount = versions.filter((item) => item.status === 'published').length;
          const draftCount = versions.length - publishedCount;
          return (
            <div className="wf-versions">
              <header className="wf-versions__hero">
                <div className="wf-versions__hero-main">
                  <div className="wf-versions__eyebrow"><GitCompare className="h-3.5 w-3.5" />画布上下文 · 修订治理</div>
                  <h2 className="wf-versions__title">版本中心</h2>
                  <p className="wf-versions__lead">
                    管理流程 revision 快照。加载版本只影响画布草稿；「发布版本」写入不可变发布记录，与「发布技能」相互独立。
                  </p>
                </div>
                <div className="wf-versions__hero-meta">
                  <div className="wf-versions__stat"><strong>{versions.length}</strong><span>全部</span></div>
                  <div className="wf-versions__stat is-pub"><strong>{publishedCount}</strong><span>已发布</span></div>
                  <div className="wf-versions__stat"><strong>{draftCount}</strong><span>草稿</span></div>
                  <div className="wf-versions__stat is-ok"><strong>{recordedCount}</strong><span>有快照</span></div>
                  <Button size="sm" variant="ghost" onClick={() => setTab('canvas')}>返回编排</Button>
                </div>
              </header>

              <WorkflowLifecycleStrip highlight="version" />
              <div className="wf-boundary" role="group" aria-label="发布边界">
                <div className="wf-boundary__card is-active">
                  <strong>发布版本（本页）</strong>
                  <span>生成不可变 revision，用于生产执行、审计对照与回滚基线。</span>
                </div>
                <div className="wf-boundary__card">
                  <strong>发布技能</strong>
                  <span>把流程沉淀为数字伙伴可装配能力，不替代版本发布。</span>
                  <Button size="sm" variant="ghost" onClick={() => setTab('publishSkill')}>去发布技能</Button>
                </div>
              </div>

              <div className="wf-versions__layout">
                <section className="wf-versions__panel" aria-labelledby="wf-versions-list-title">
                  <div className="wf-versions__panel-head">
                    <div>
                      <h3 id="wf-versions-list-title">版本列表</h3>
                      <p>流程 <code>{workflowId}</code> · 点击查看详情与差异</p>
                    </div>
                    <Button size="sm" variant="secondary" disabled={!canWrite || createVersionApi.isPending} loading={createVersionApi.isPending} onClick={() => saveAsVersion()}>
                      <Save className="h-3.5 w-3.5" />另存当前画布
                    </Button>
                  </div>
                  <div className="wf-versions__list">
                    {versions.length === 0 ? (
                      <div className="wf-versions__empty"><strong>暂无版本记录</strong><span>保存草稿或另存后将出现在这里</span></div>
                    ) : versions.map((version) => {
                      const selected = version.id === (selectedVersion?.id);
                      const current = version.id === activeVersion;
                      return (
                        <button
                          key={version.id}
                          type="button"
                          className={cn('wf-versions__row', selected && 'is-selected')}
                          onClick={() => { setVersionCenterSelectedId(version.id); if (!diffBaseId || diffBaseId === version.id) setDiffBaseId(versions.find((item) => item.id !== version.id)?.id ?? version.id); }}
                        >
                          <div className="wf-versions__row-main">
                            <span className="wf-versions__row-id">{version.label}</span>
                            <div className="wf-versions__row-tags">
                              {current && <Badge tone="success" className="text-[9px]">画布当前</Badge>}
                              <Badge tone={version.status === 'published' ? 'info' : 'neutral'} className="text-[9px]">{version.status === 'published' ? '已发布' : '草稿'}</Badge>
                              <Badge tone={version.evidenceMode === 'recorded' ? 'success' : 'warn'} className="text-[9px]">{version.evidenceMode === 'recorded' ? '有快照' : '无快照'}</Badge>
                            </div>
                            <div className="wf-versions__row-meta">
                              <span>{version.time}</span>
                              <span className="wf-versions__sep" />
                              <span>{version.nodeCount ?? version.nodes.length} 节点 · {version.edgeCount ?? version.edges.length} 连线</span>
                              {version.parentVersionId && <><span className="wf-versions__sep" /><span>源自 {version.parentVersionId}</span></>}
                            </div>
                            <p className="wf-versions__row-desc">{version.desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <aside className="wf-versions__panel wf-versions__detail" aria-label="版本详情">
                  {!selectedVersion ? (
                    <div className="wf-versions__empty"><strong>选择一个版本</strong><span>查看快照、差异与回滚</span></div>
                  ) : (
                    <>
                      <div className="wf-versions__panel-head">
                        <div>
                          <h3>{selectedVersion.label}</h3>
                          <p>{selectedVersion.desc}</p>
                        </div>
                        <Badge tone={selectedVersion.status === 'published' ? 'info' : 'neutral'}>{selectedVersion.status === 'published' ? '已发布' : '草稿'}</Badge>
                      </div>
                      <div className="wf-versions__detail-body">
                        <div className="wf-versions__kv">
                          <div><span>版本 ID</span><code>{selectedVersion.id}</code></div>
                          <div><span>更新时间</span><strong>{selectedVersion.time}</strong></div>
                          <div><span>规模</span><strong>{selectedVersion.nodeCount ?? selectedVersion.nodes.length} / {selectedVersion.edgeCount ?? selectedVersion.edges.length}</strong></div>
                          <div><span>证据</span><strong>{selectedVersion.evidenceMode === 'recorded' ? '节点快照' : '仅元数据'}</strong></div>
                        </div>

                        <div className="wf-versions__actions">
                          <Button size="sm" variant="secondary" onClick={() => { loadSnapshot(selectedVersion, selectedVersion.id); setTab('canvas'); showToast(`已加载 ${selectedVersion.label} 到画布`, 'info'); }}>
                            <Eye className="h-3.5 w-3.5" />加载到画布
                          </Button>
                          <Button size="sm" variant="outline" disabled={!canWrite || selectedVersion.evidenceMode !== 'recorded'} onClick={() => setRollbackTargetId(selectedVersion.id)}>
                            <RotateCcw className="h-3.5 w-3.5" />回滚到此版本
                          </Button>
                          <Button size="sm" onClick={requestProductionRelease} loading={publishWorkflowApi.isPending || releaseRequestApi.isPending} disabled={!canWrite || isDirty || !!draftGate?.blocked || selectedVersion.id !== activeVersion}>
                            {isAdmin ? '发布当前画布版本' : '提交发布申请'}
                          </Button>
                        </div>
                        {draftGate?.blocked && <div className="wf-versions__warn">模板依赖未授权，禁止发布：{draftGate.reasons[0]}</div>}
                        {selectedVersion.id !== activeVersion && <div className="wf-versions__hint">发布针对画布当前版本（{activeVersion}）。请先加载此版本或另存后再发布。</div>}

                        <div className="wf-versions__diff-head">
                          <h4>与基线差异</h4>
                          <label>
                            基线
                            <select value={compareBase?.id ?? ''} onChange={(event) => setDiffBaseId(event.target.value)}>
                              {versions.map((version) => (
                                <option key={version.id} value={version.id} disabled={version.id === selectedVersion.id}>{version.label}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {!diff || !compareBase ? (
                          <div className="wf-versions__hint">请选择不同的基线版本以查看差异。</div>
                        ) : selectedVersion.evidenceMode !== 'recorded' || compareBase.evidenceMode !== 'recorded' ? (
                          <div className="wf-versions__warn">一方缺少节点快照，无法生成可审计差异。</div>
                        ) : (
                          <div className="wf-versions__diff">
                            <div className="wf-versions__diff-stats">
                              <span>新增节点 <strong>{diff.addedNodes.length}</strong></span>
                              <span>删除节点 <strong>{diff.removedNodes.length}</strong></span>
                              <span>变更节点 <strong>{diff.changedNodes.length}</strong></span>
                              <span>连线 +{diff.addedEdges} / -{diff.removedEdges}</span>
                            </div>
                            {diff.addedNodes.length + diff.removedNodes.length + diff.changedNodes.length === 0 && diff.addedEdges === 0 && diff.removedEdges === 0 ? (
                              <div className="wf-versions__hint">与基线结构一致。</div>
                            ) : (
                              <ul className="wf-versions__diff-list">
                                {diff.addedNodes.map((item) => <li key={`a-${item.id}`} className="is-add">+ {item.label} <code>{item.id}</code></li>)}
                                {diff.removedNodes.map((item) => <li key={`r-${item.id}`} className="is-del">- {item.label} <code>{item.id}</code></li>)}
                                {diff.changedNodes.map((item) => <li key={`c-${item.id}`} className="is-chg">~ {item.id}：{item.from} → {item.to}</li>)}
                              </ul>
                            )}
                            {selectedVersion.id === activeVersion && isDirty && (
                              <div className="wf-versions__hint">画布有未保存修改，差异已计入当前画布内容。</div>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </aside>
              </div>
            </div>
          );
        })()}
      </div>

      {/* 模板预览弹窗 — 用 wrapper 避免 hooks 顺序问题 */}
      {previewTemplate && (
        <TemplatePreviewModalInner
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          showToast={showToast}
          onUseTemplate={createTemplateDraft}
        />
      )}

      <Drawer
        open={Boolean(upgradeDiff)}
        onClose={() => setUpgradeDiff(null)}
        width={480}
        title="模板版本升级 Diff"
        description={upgradeDiff ? `${upgradeDiff.template.name} · ${upgradeDiff.diff.fromVersion} → ${upgradeDiff.diff.toVersion}` : ''}
        footer={<Button size="sm" className="w-full" onClick={() => setUpgradeDiff(null)}>关闭</Button>}
      >
        {upgradeDiff && (
          <div className="space-y-3 p-1 text-xs leading-5">
            <div className={cn('rounded-lg border px-3 py-2', upgradeDiff.diff.available ? 'border-[var(--info)]/30 bg-[var(--info-bg)] text-[var(--info)]' : 'border-[var(--border)] text-[var(--text-muted)]')}>
              {upgradeDiff.diff.available ? '检测到可升级版本（择期应用，不强制）' : '当前已是目录最新版本'}
            </div>
            <div>
              <div className="mb-1 font-semibold text-[var(--text)]">节点变更</div>
              <div>新增：{upgradeDiff.diff.sequenceAdded.join(', ') || '—'}</div>
              <div>移除：{upgradeDiff.diff.sequenceRemoved.join(', ') || '—'}</div>
            </div>
            <div>
              <div className="mb-1 font-semibold text-[var(--text)]">连接器槽位</div>
              <div>新增：{upgradeDiff.diff.connectorAdded.join(', ') || '—'}</div>
              <div>移除：{upgradeDiff.diff.connectorRemoved.join(', ') || '—'}</div>
            </div>
            <div>
              <div className="mb-1 font-semibold text-[var(--text)]">变更说明</div>
              <ul className="list-disc pl-4 text-[var(--text-secondary)]">
                {(upgradeDiff.diff.notes.length ? upgradeDiff.diff.notes : ['无额外说明']).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">升级不会覆盖工作区草稿；确认后需重新创建草稿并校验门禁。</p>
          </div>
        )}
      </Drawer>

      <Drawer
        open={preflightOpen}
        onClose={() => setPreflightOpen(false)}
        width={520}
        title="运行前检查"
        description="确认结构、权限和风险后，才会写入运行记录（含节点快照）。"
        footer={(
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--text-muted)]">创建后可在「运行记录」中查看节点快照与回放</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setPreflightOpen(false)}>取消</Button>
              <Button
                variant="primary"
                onClick={() => runWorkflowApi.mutate({
                  workflowId,
                  version: activeVersion,
                  mode: 'sandbox',
                  trigger: workflowDraft?.name ?? '画布沙箱试运行',
                  nodes: nodes.map((node) => ({ id: node.id, kind: node.data?.kind, label: node.data?.label, data: node.data })),
                  edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
                })}
                loading={runWorkflowApi.isPending}
                disabled={!preflightResult?.passed || !canExecute}
              >
                {runWorkflowApi.isPending ? '创建中…' : '确认沙箱试运行'}
              </Button>
            </div>
          </div>
        )}
      >
        {preflightResult && (
          <div className="space-y-4">
            <div className={cn('rounded-lg border p-3 text-sm font-semibold', preflightResult.passed ? 'border-[var(--success)]/30 bg-[var(--success-bg)] text-[var(--success)]' : 'border-[var(--danger)]/30 bg-[var(--danger-bg)] text-[var(--danger)]')}>
              {preflightResult.passed ? '检查完成，可以运行' : '检查未通过，请修正阻断项'}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(preflightResult.checks).map(([key, status]) => <div key={key} className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2.5"><span className="text-xs text-[var(--text-secondary)]">{({ structure: '结构', connections: '连线', dependencies: '依赖', permissions: '权限', risk: '风险', approval: '审批', audit: '审计', rollback: '回滚' } as Record<string, string>)[key] ?? key}</span><Badge tone={status === 'passed' ? 'success' : status === 'failed' ? 'error' : 'warn'}>{status === 'passed' ? '通过' : status === 'failed' ? '阻断' : '需复核'}</Badge></div>)}
            </div>
            {preflightResult.warnings.length > 0 && <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-bg)] p-3 text-xs leading-5 text-[var(--text-secondary)]"><div className="mb-1 font-semibold text-[var(--warning)]">复核提示</div>{preflightResult.warnings.map((warning) => <div key={warning}>• {warning}</div>)}</div>}
          </div>
        )}
      </Drawer>

      <Drawer
        open={versionDiffOpen}
        onClose={() => setVersionDiffOpen(false)}
        width={520}
        title="版本差异"
        description="对比基线版本与画布当前内容（含未保存修改）"
      >
        {(() => {
          const base = versions.find((item) => item.id === (diffBaseId || versions.find((version) => version.id !== activeVersion)?.id)) ?? versions[0];
          const current = { nodes, edges };
          const diff = base ? computeVersionDiff(base, current) : null;
          return (
            <div className="space-y-4">
              <label className="block text-xs text-[var(--text-secondary)]">
                基线版本
                <select className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-xs" value={base?.id ?? ''} onChange={(event) => setDiffBaseId(event.target.value)}>
                  {versions.map((version) => <option key={version.id} value={version.id}>{version.label}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3"><div className="text-[11px] text-[var(--text-muted)]">画布节点</div><div className="mt-1 text-xl font-semibold">{nodes.length}</div></div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3"><div className="text-[11px] text-[var(--text-muted)]">画布连线</div><div className="mt-1 text-xl font-semibold">{edges.length}</div></div>
              </div>
              {!base || !diff ? (
                <div className="text-xs text-[var(--text-muted)]">暂无可对比版本</div>
              ) : base.evidenceMode !== 'recorded' ? (
                <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-bg)] px-3 py-2 text-[11px] text-[var(--warning)]">基线缺少节点快照，无法生成可审计差异。</div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
                    <span>新增 {diff.addedNodes.length}</span><span>删除 {diff.removedNodes.length}</span><span>变更 {diff.changedNodes.length}</span><span>连线 +{diff.addedEdges}/-{diff.removedEdges}</span>
                  </div>
                  <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 text-xs">
                    {diff.addedNodes.length + diff.removedNodes.length + diff.changedNodes.length === 0 && diff.addedEdges === 0 && diff.removedEdges === 0 ? (
                      <div className="text-[var(--text-muted)]">与基线结构一致</div>
                    ) : (
                      <>
                        {diff.addedNodes.map((item) => <div key={`a-${item.id}`} className="text-[var(--success)]">+ {item.label} <span className="font-mono text-[10px]">{item.id}</span></div>)}
                        {diff.removedNodes.map((item) => <div key={`r-${item.id}`} className="text-[var(--danger)]">- {item.label} <span className="font-mono text-[10px]">{item.id}</span></div>)}
                        {diff.changedNodes.map((item) => <div key={`c-${item.id}`} className="text-[var(--warning)]">~ {item.id}: {item.from} → {item.to}</div>)}
                      </>
                    )}
                  </div>
                </div>
              )}
              <div className="rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]">未保存修改会计入此差异预览，但不会进入已发布版本；发布前请先保存草稿。</div>
            </div>
          );
        })()}
      </Drawer>

      <ConfirmDialog
        open={Boolean(rollbackTargetId)}
        onClose={() => setRollbackTargetId(null)}
        title="确认回滚版本"
        description={`将把画布恢复为 ${rollbackTargetId ?? ''} 的节点快照，并生成新的草稿版本。此操作可在版本列表中追溯。`}
        confirmText="确认回滚"
        tone="danger"
        onConfirm={() => {
          if (!rollbackTargetId) return;
          rollbackVersionApi.mutate({ workflowId, versionId: rollbackTargetId });
        }}
      />

      <WorkflowAIGeneratorDrawer
        open={aiGenerateOpen}
        step={generationStep}
        result={generationResult}
        history={generationHistory}
        prompt={generationPrompt}
        setPrompt={setGenerationPrompt}
        constraints={generationConstraints}
        setConstraints={setGenerationConstraints}
        model={generationModel}
        setModel={setGenerationModel}
        loading={generateWorkflowApi.isPending}
        onGenerate={submitGeneration}
        onApply={applyGeneration}
        onDiscard={discardGeneration}
        onRegenerate={() => { setGenerationStep('input'); setGenerationResult(null); }}
        onSelectHistory={(item) => { setGenerationResult(item); setGenerationStep('preview'); }}
        onClose={() => setAiGenerateOpen(false)}
      />

      {/* ======== 右键菜单 ======== */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 min-w-[180px] rounded-md border border-[var(--border)] bg-[var(--surface-1)] py-1 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]"
              onClick={() => { setSidePanel('properties'); setContextMenu(null); }}
            >
              <Edit3 className="h-3.5 w-3.5" />编辑属性
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]"
              onClick={() => { duplicateNode(contextMenu.nodeId); setContextMenu(null); }}
            >
              <Copy className="h-3.5 w-3.5" />复制节点
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]"
              onClick={() => { disableNode(contextMenu.nodeId); setContextMenu(null); }}
            >
              <Pause className="h-3.5 w-3.5" />禁用 / 启用
            </button>
            <div className="my-1 h-px bg-[var(--border)]" />
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--danger-bg)]"
              onClick={() => { deleteNode(contextMenu.nodeId); setContextMenu(null); }}
            >
              <Trash2 className="h-3.5 w-3.5" />删除节点
            </button>
          </div>
        </>
      )}

      {/* ======== Toast ======== */}
      <ConfirmDialog
        open={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        onConfirm={confirmClearCanvas}
        title="清空画布"
        description="将删除当前画布中的全部节点和连线。该操作只修改本地草稿，可通过撤销恢复。"
        confirmText="确认清空"
        tone="danger"
      />

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in">
          <div className={cn(
            'rounded-md border px-4 py-2.5 shadow-lg text-sm flex items-center gap-2',
            toast.tone === 'success' ? 'border-[var(--success)]/30 bg-[var(--success-bg)] text-[var(--success)]' :
            toast.tone === 'error' ? 'border-[var(--danger)]/30 bg-[var(--danger-bg)] text-[var(--danger)]' :
            'border-[var(--info)]/30 bg-[var(--info-bg)] text-[var(--info)]',
          )}>
            {toast.tone === 'success' && <CheckCircle2 className="h-4 w-4" />}
            {toast.tone === 'error' && <AlertTriangle className="h-4 w-4" />}
            {toast.tone === 'info' && <Activity className="h-4 w-4" />}
            {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}

const AI_PROMPT_EXAMPLES = [
  { label: 'Redis OOM 受控恢复', prompt: '当生产 Redis 触发 OOM 告警时，由数字伙伴研判处置路径，经双重审批后执行受控恢复，写入审计并通知值班负责人' },
  { label: '证书到期巡检', prompt: '每周巡检即将过期的 TLS 证书，数字伙伴研判优先级后创建处置工单，经双重审批后通知值班并写入审计' },
  { label: '高危变更复核', prompt: '当变更窗口外出现高危配置变更时，数字伙伴研判影响面，阻断自动执行，通知专家复核并保留审计留痕' },
] as const;

function dependencyTypeLabel(type: GenerationResult['dependencies'][number]['type']) {
  if (type === 'agent') return '数字伙伴';
  if (type === 'mcp') return 'MCP';
  return '工具';
}

function WorkflowAIGeneratorDrawer({
  open, step, result, history, prompt, setPrompt, constraints, setConstraints, model, setModel,
  loading, onGenerate, onApply, onDiscard, onRegenerate, onSelectHistory, onClose,
}: {
  open: boolean;
  step: 'input' | 'preview';
  result: GenerationResult | null;
  history: GenerationResult[];
  prompt: string;
  setPrompt: (value: string) => void;
  constraints: GenerationVars['constraints'];
  setConstraints: (value: GenerationVars['constraints']) => void;
  model: string;
  setModel: (value: string) => void;
  loading: boolean;
  onGenerate: () => void;
  onApply: () => void;
  onDiscard: () => void;
  onRegenerate: () => void;
  onSelectHistory: (item: GenerationResult) => void;
  onClose: () => void;
}) {
  const toggle = (key: keyof GenerationVars['constraints']) => setConstraints({ ...constraints, [key]: !constraints[key] });
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={640}
      title="AI 辅助编排"
      description="协助专家将自然语言处置需求转为可编辑草稿；需专家复核后才可应用，不会自动执行、发布或覆盖线上流程。"
      footer={step === 'input' ? (
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-[11px] text-[var(--text-muted)]">需专家确认结构、权限与风险</span>
          <div className="flex gap-2"><Button variant="ghost" onClick={onClose} disabled={loading}>取消</Button><Button variant="primary" onClick={onGenerate} loading={loading}>{loading ? '生成中…' : '生成草稿'}</Button></div>
        </div>
      ) : (
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-[11px] text-[var(--text-muted)]">应用后进入隔离草稿，仍需配置与发布审批</span>
          <div className="flex gap-2"><Button variant="ghost" onClick={onDiscard}>放弃</Button><Button variant="outline" onClick={onRegenerate}>重新生成</Button><Button variant="primary" onClick={onApply} disabled={!result || !['generated', 'review_required'].includes(result.status)}>创建隔离草稿</Button></div>
        </div>
      )}
    >
      {step === 'input' ? (
        <div className="space-y-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[var(--text)]">业务目标</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} placeholder="例如：当生产 Redis 触发 OOM 告警时，由数字伙伴研判处置路径，经双重审批后执行受控恢复，写入审计并通知值班" className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2.5 text-sm leading-6 text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-200 focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_var(--brand-light)]" />
            <div className="mt-1 flex justify-between text-[10px] text-[var(--text-muted)]"><span>描述触发、研判、双重审批、受控动作、审计与通知</span><span>{prompt.length}/1000</span></div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {AI_PROMPT_EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  onClick={() => setPrompt(example.prompt)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-[11px] transition-colors',
                    prompt === example.prompt
                      ? 'border-[var(--brand)] bg-[var(--brand-light)] text-[var(--brand)]'
                      : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--brand)]/40 hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]',
                  )}
                >
                  {example.label}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
            <div className="mb-3 text-xs font-semibold text-[var(--text)]">生成约束</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-[var(--text-secondary)]">风险等级<select value={constraints.riskLevel} onChange={(e) => setConstraints({ ...constraints, riskLevel: e.target.value as GenerationVars['constraints']['riskLevel'] })} className="mt-1 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-200 focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_var(--brand-light)]"><option value="L1">L1 · 低风险</option><option value="L2">L2 · 受控操作</option><option value="L3">L3 · 高风险</option></select></label>
              <label className="text-xs text-[var(--text-secondary)]">生成模型<select value={model} onChange={(e) => setModel(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text)] outline-none transition-[border-color,box-shadow] duration-200 focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_var(--brand-light)]"><option>企业默认模型</option><option>Qwen-Enterprise</option></select></label>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {([['requireApproval', '需要双重审批'], ['requireRollback', '支持回滚']] as const).map(([key, label]) => <button key={key} type="button" onClick={() => toggle(key)} className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors', constraints[key] ? 'border-[var(--brand)] bg-[var(--brand-light)] text-[var(--brand)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]')}><span className={cn('grid h-4 w-4 place-items-center rounded border text-[10px]', constraints[key] ? 'border-[var(--brand)] bg-[var(--brand)] text-white' : 'border-[var(--border)]')}>{constraints[key] ? '✓' : ''}</span>{label}</button>)}
              <div className="flex items-center gap-2 rounded-md border border-[var(--success)]/30 bg-[var(--success-bg)] px-3 py-2 text-xs text-[var(--success)]"><ShieldCheck className="h-4 w-4" />审计留痕（策略强制）</div>
            </div>
          </div>
          {history.length > 0 && <div><div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold text-[var(--text)]">最近生成</span><span className="text-[10px] text-[var(--text-muted)]">本工作区生成记录</span></div><div className="space-y-1.5">{history.slice(0, 3).map((item) => <button key={item.id} type="button" onClick={() => onSelectHistory(item)} className="flex w-full items-center justify-between rounded-md border border-[var(--border)] px-3 py-2 text-left hover:bg-[var(--bg-hover)]"><span className="truncate pr-3 text-xs text-[var(--text-secondary)]">{item.prompt}</span><Badge tone={item.qualityScore >= 85 ? 'success' : 'warn'} className="shrink-0 text-[10px]">{item.qualityScore} 分</Badge></button>)}</div></div>}
        </div>
      ) : result ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--text)]">辅助编排草稿预览</div>
                <div className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{result.prompt}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--text-muted)]">
                  <span>模型 · {result.model}</span>
                  {result.policyVersion && <span>策略 · {result.policyVersion}</span>}
                  {result.requiresReview && <span className="text-[var(--warning)]">需专家复核</span>}
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold text-[var(--brand)]">{result.qualityScore}</div>
                <div className="text-[10px] text-[var(--text-muted)]">质量评分</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-[var(--bg-elevated)] px-2 py-2"><div className="text-base font-semibold">{result.workflow.nodes.length}</div><div className="text-[10px] text-[var(--text-muted)]">节点</div></div>
              <div className="rounded-md bg-[var(--bg-elevated)] px-2 py-2"><div className="text-base font-semibold">{result.workflow.edges.length}</div><div className="text-[10px] text-[var(--text-muted)]">连线</div></div>
              <div className="rounded-md bg-[var(--bg-elevated)] px-2 py-2"><div className="text-base font-semibold">{result.dependencies.length}</div><div className="text-[10px] text-[var(--text-muted)]">依赖</div></div>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">{([['structure', '结构校验'], ['dependencies', '依赖检查'], ['risk', '风险扫描']] as const).map(([key, label]) => <div key={key} className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3"><div className="text-[11px] text-[var(--text-muted)]">{label}</div><div className={cn('mt-1 text-xs font-semibold', result.checks[key] === 'passed' ? 'text-[var(--success)]' : 'text-[var(--warning)]')}>{result.checks[key] === 'passed' ? '通过' : '需要专家复核'}</div></div>)}</div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-4"><div className="mb-3 text-xs font-semibold text-[var(--text)]">工具、MCP 与数字伙伴依赖</div><div className="space-y-2">{result.dependencies.map((dep) => <div key={`${dep.type}-${dep.name}`} className="flex items-center justify-between gap-3 text-xs"><span className="text-[var(--text-secondary)]">{dep.name}<span className="ml-2 text-[10px] text-[var(--text-muted)]">{dependencyTypeLabel(dep.type)}</span></span><Badge tone={dep.status === 'available' ? 'success' : 'warn'} className="text-[10px]">{dep.status === 'available' ? '可用' : '缺失权限'}</Badge></div>)}</div></div>
          {result.risks.length > 0 && <div className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-bg)] p-4"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--warning)]"><AlertTriangle className="h-3.5 w-3.5" />风险与权限提示</div>{result.risks.map((risk) => <div key={risk.node} className="text-xs leading-5 text-[var(--text-secondary)]">{risk.level} · {risk.text}</div>)}</div>}
          {result.warnings.length > 0 && <div><div className="mb-2 text-xs font-semibold text-[var(--text)]">专家复核建议</div><ul className="space-y-1 text-xs leading-5 text-[var(--text-muted)]">{result.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul></div>}
          <div className="flex items-center gap-2 rounded-md bg-[var(--info-bg)] px-3 py-2 text-[11px] text-[var(--info)]"><ShieldCheck className="h-3.5 w-3.5 shrink-0" />应用隔离草稿 → 专家配置与校验 → 发布流程技能 → 数字伙伴能力装配。</div>
        </div>
      ) : null}
    </Drawer>
  );
}

/* =============================================================
 *  CanvasView —— 画布主区域
 * ============================================================= */
function CanvasView(props: {
  wrapperRef: React.RefObject<HTMLDivElement>;
  rfNodes: Node[];
  rfEdges: Edge[];
  onNodeClick: NodeMouseHandler;
  onNodeContextMenu: NodeMouseHandler;
  onNodesChange: (changes: NodeChange[]) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  sidePanel: SidePanelKey;
  setSidePanel: (k: SidePanelKey) => void;
  librarySearchQ: string;
  setLibrarySearchQ: (v: string) => void;
  canvasSearchQ: string;
  setCanvasSearchQ: (v: string) => void;
  searchMatch: Node | null;
  focusNode: (id: string) => void;
  filteredLibrary: WorkflowNodeKind[];
  draggedKind: WorkflowNodeKind | null;
  setDraggedKind: (k: WorkflowNodeKind | null) => void;
  selectedNode: Node | null;
  selectedNodeId: string | null;
  nodes: Node[];
  webhookEnabled: boolean;
  setWebhookEnabled: (b: boolean) => void;
  saveCanvas: () => void;
  saving: boolean;
  runWorkflow: () => void;
  resetCanvas: () => void;
  clearCanvas: () => void;
  addNode: (kind: WorkflowNodeKind, pos?: { x: number; y: number }) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  disableNode: (id: string) => void;
  updateNodeLabel: (id: string, label: string) => void;
  updateNodeDescription: (id: string, desc: string) => void;
  updateNodeNote: (id: string, note: string) => void;
  patchNodeData: (id: string, patch: Record<string, unknown>) => void;
  structureIssues: StructureIssue[];
  showToast: (msg: string, tone?: 'success' | 'error' | 'info') => void;
  onConnect: (c: Connection) => void;
  deleteEdge: (id: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  exportWorkflow: () => void;
  reactFlowRef: React.MutableRefObject<any>;
  canWrite: boolean;
  canExecute: boolean;
  openAIGenerator: () => void;
  nodeLibraryOpen: boolean;
  setNodeLibraryOpen: (open: boolean) => void;
  validating: boolean;
  versionMenuOpen: boolean;
  setVersionMenuOpen: (open: boolean) => void;
  versions: VersionSnapshot[];
  activeVersion: string;
  loadSnapshot: (snapshot: Snapshot, versionId: string) => void;
  setVersions: React.Dispatch<React.SetStateAction<VersionSnapshot[]>>;
  setActiveVersion: (version: string) => void;
  setVersionDiffOpen: (open: boolean) => void;
  publishVersion: () => void;
  publishLabel: string;
  publishing: boolean;
  isDirty: boolean;
  draftGate: DraftGate | null;
  onOpenVersionCenter: () => void;
  onSaveAsVersion: () => void;
  saveAsPending: boolean;
  onRequestRollback: (versionId: string) => void;
}) {
  const {
    wrapperRef, rfNodes, rfEdges, onNodeClick, onNodeContextMenu, onNodesChange,
    handleDragOver, handleDrop, sidePanel, setSidePanel,
    librarySearchQ, setLibrarySearchQ, canvasSearchQ, setCanvasSearchQ, searchMatch, focusNode,
    filteredLibrary, setDraggedKind,
    selectedNode, selectedNodeId, nodes, webhookEnabled, setWebhookEnabled,
    saveCanvas, saving, runWorkflow, resetCanvas, clearCanvas,
    addNode, deleteNode, duplicateNode, disableNode, updateNodeLabel, updateNodeDescription, updateNodeNote, patchNodeData, structureIssues, showToast,
    onConnect, deleteEdge, undo, redo, canUndo, canRedo, exportWorkflow, reactFlowRef, canWrite, canExecute, openAIGenerator, nodeLibraryOpen, setNodeLibraryOpen, validating,
    versionMenuOpen, setVersionMenuOpen, versions, activeVersion, loadSnapshot, setVersionDiffOpen, publishVersion, publishLabel, publishing, isDirty,
    draftGate, onOpenVersionCenter, onSaveAsVersion, saveAsPending, onRequestRollback,
  } = props;

  const [mobilePanelOpen, setMobilePanelOpen] = useState<SidePanelKey | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [libraryView, setLibraryView] = useState<'recommended' | 'all'>('recommended');
  const [nodeInspectorTab, setNodeInspectorTab] = useState<'overview' | 'config' | 'debug'>('config');
  const selectedLibraryKind = selectedNode?.data?.kind as WorkflowNodeKind | undefined;
  const recommendedLibrary = useMemo(
    () => recommendedNodeKinds(selectedLibraryKind).filter((kind) => filteredLibrary.includes(kind)),
    [filteredLibrary, selectedLibraryKind],
  );
  const visibleLibrary = libraryView === 'recommended' ? recommendedLibrary : filteredLibrary;
  const visibleLibraryGroups = NODE_LIBRARY_GROUPS
    .map((group) => ({ ...group, kinds: group.kinds.filter((kind) => visibleLibrary.includes(kind)) }))
    .filter((group) => group.kinds.length > 0);
  const handleNodeClick: NodeMouseHandler = useCallback((event, node) => {
    onNodeClick(event, node);
    setNodeInspectorTab('config');
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      setMobilePanelOpen('properties');
    }
  }, [onNodeClick]);

  const actionToolbar = (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-1)] px-3 py-2.5 md:px-5">
      {/* 画布专属操作：先确定版本，再选择构建方式。 */}
      <div className="flex flex-wrap items-center gap-0.5 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <Button size="sm" variant="outline" className="rounded-lg border-transparent bg-[var(--brand-light)] px-2.5 text-[var(--brand)] shadow-none hover:border-transparent hover:bg-[var(--brand-light)]" onClick={() => setVersionMenuOpen(true)} aria-label="切换或管理当前画布版本">
          <HistoryIcon className="h-3.5 w-3.5" />
          <span className="text-[10px] font-semibold opacity-80">当前版本</span>
          <span className="font-mono">{versions.find((version) => version.id === activeVersion)?.label || activeVersion || '—'}</span>
          <ChevronRight className="h-3.5 w-3.5 rotate-90" />
        </Button>
        <div className="mx-1 h-5 w-px bg-[var(--border)]" aria-hidden="true" />
        <Button size="sm" variant="ghost" className="rounded-lg px-2.5 text-[var(--text-secondary)]" onClick={() => setNodeLibraryOpen(!nodeLibraryOpen)} aria-expanded={nodeLibraryOpen}>
          <Box className="h-3.5 w-3.5" />{nodeLibraryOpen ? '收起节点库' : '节点库'}
        </Button>
        <Button size="sm" variant="ghost" className="rounded-lg px-2.5 text-[var(--brand)] hover:bg-[var(--brand-light)] hover:text-[var(--brand)]" onClick={openAIGenerator} disabled={!canWrite}>
          <Sparkles className="h-3.5 w-3.5" />AI 辅助
        </Button>
      </div>

      {/* 提交与验证紧邻，明确“保存后再试运行”的操作路径。 */}
      <div className="flex flex-wrap items-center gap-1.5 md:ml-auto">
        <Button size="sm" variant={isDirty ? 'primary' : 'secondary'} className="rounded-lg px-3.5" onClick={saveCanvas} loading={saving} disabled={!canWrite || saving || !isDirty}>
          <Save className="h-3.5 w-3.5" />{isDirty ? '保存草稿' : '已保存'}
        </Button>
        <Button size="sm" variant="secondary" className="rounded-lg px-3.5" onClick={runWorkflow} disabled={!canExecute || validating || isDirty || !!draftGate?.blocked} loading={validating} title={draftGate?.blocked ? `依赖未授权：${draftGate.reasons[0]}` : isDirty ? '请先保存草稿后再运行试验' : undefined}>
          <Play className="h-3.5 w-3.5" />运行试验
        </Button>
        <div className="relative">
          <Button size="sm" variant="ghost" className="rounded-lg px-2.5 text-[var(--text-secondary)]" onClick={() => setMoreMenuOpen((open) => !open)} aria-expanded={moreMenuOpen}><MoreHorizontal className="h-3.5 w-3.5" />更多</Button>
          {moreMenuOpen && <><div className="fixed inset-0 z-30" onClick={() => setMoreMenuOpen(false)} /><div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-1.5 shadow-lg"><button type="button" onClick={() => { exportWorkflow(); setMoreMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><FileJson className="h-3.5 w-3.5" />导出工作流</button><button type="button" onClick={() => { resetCanvas(); setMoreMenuOpen(false); }} disabled={!canWrite} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" />重置画布</button><div className="my-1 border-t border-[var(--border)]" /><button type="button" onClick={() => { clearCanvas(); setMoreMenuOpen(false); }} disabled={!canWrite} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-[var(--danger)] hover:bg-[var(--danger-bg)] disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />清空画布</button></div></>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {actionToolbar}
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] leading-5 text-[var(--text-muted)] md:px-5">
        本页用于编排受控处置流程草稿。版本治理请点「当前版本」进入抽屉 / 版本中心；完成后请到「发布技能」发布为流程技能，供数字伙伴能力装配；本页不直接发起专家协作上岗。
        {structureIssues.filter((item) => item.severity === 'failed').length > 0 && (
          <span className="ml-2 text-[var(--warning)]">结构门禁：{structureIssues.filter((item) => item.severity === 'failed').map((item) => item.message).join('；')}</span>
        )}
      </div>
      <Drawer open={versionMenuOpen} onClose={() => setVersionMenuOpen(false)} width={520} title="当前版本" description={`画布 ${versions.find((version) => version.id === activeVersion)?.label || activeVersion || '—'} · 切换仅影响草稿；另存 / 发布 / 回滚请在版本中心完成`} footer={<div className="flex w-full gap-2"><Button size="sm" variant="outline" className="flex-1" onClick={onOpenVersionCenter}>打开版本中心</Button><Button size="sm" variant="outline" className="flex-1" onClick={() => setVersionDiffOpen(true)}>查看差异</Button><Button size="sm" variant="primary" className="flex-1" onClick={publishVersion} loading={publishing} disabled={!canWrite || isDirty || !!draftGate?.blocked}>{publishLabel}</Button></div>}>
        <div className="space-y-2">
          {versions.map((version) => (
            <button
              key={version.id}
              type="button"
              onClick={() => { loadSnapshot(version, version.id); setVersionMenuOpen(false); showToast(`已加载 ${version.label}`, 'info'); }}
              className={cn('flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]', version.id === activeVersion ? 'border-[var(--brand)] bg-[var(--brand-light)]' : 'border-[var(--border)] bg-[var(--surface-1)]')}
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-sm font-semibold text-[var(--brand)]">{version.label}</span>
                  {version.id === activeVersion && <Badge tone="success">当前</Badge>}
                  <Badge tone={version.status === 'published' ? 'info' : 'neutral'} className="text-[9px]">{version.status === 'published' ? '已发布' : '草稿'}</Badge>
                  <Badge tone={version.evidenceMode === 'recorded' ? 'success' : 'warn'} className="text-[9px]">{version.evidenceMode === 'recorded' ? '有快照' : '无快照'}</Badge>
                </span>
                <span className="mt-1 block text-[11px] text-[var(--text-muted)]">{version.time} · {version.nodeCount ?? version.nodes.length} 节点</span>
                <span className="block truncate text-xs text-[var(--text-secondary)]">{version.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!canWrite || !versions.find((item) => item.id === activeVersion && item.evidenceMode === 'recorded')}
            onClick={() => onRequestRollback(activeVersion)}
          >
            <RotateCcw className="h-3 w-3" />回滚并生成新草稿
          </Button>
          <Button size="sm" variant="secondary" onClick={onSaveAsVersion} disabled={!canWrite} loading={saveAsPending}>
            <Save className="h-3 w-3" />另存版本
          </Button>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-[var(--text-muted)]">回滚会调用服务端生成新草稿 revision，不会原地覆盖已发布记录；破坏性操作需二次确认。</p>
        {draftGate?.blocked && <div className="mt-3 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--warning)]">来源模板「{draftGate.templateName}」存在未授权依赖，完成授权前不可发布。</div>}
      </Drawer>

      {draftGate && (
        <div className={cn('mx-3 mt-2 rounded-lg border px-3 py-2 text-[11px] leading-5 md:mx-5', draftGate.blocked ? 'border-[var(--warning)]/30 bg-[var(--warning-bg)] text-[var(--warning)]' : 'border-[var(--info)]/25 bg-[var(--info-bg)] text-[var(--info)]')}>
          <span className="font-semibold">来源模板</span>
          <span className="mx-1.5 font-mono">{draftGate.templateId}</span>
          {draftGate.templateName} · {draftGate.templateVersion} · {draftGate.owner}
          {draftGate.blocked ? ` · 阻断：${draftGate.reasons.join('；')}（可配置草稿，禁止试运行与发布）` : ' · 依赖就绪，可校验后试运行'}
        </div>
      )}

      <div className="relative flex min-h-0 min-w-0 flex-1">
      {/* —— 中间：DAG 画布 + Webhook + 操作按钮 —— */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--surface-2)]">
        <Drawer
          open={mobilePanelOpen !== null}
          onClose={() => setMobilePanelOpen(null)}
          title={mobilePanelOpen === 'library' ? '节点库' : selectedNode ? `${selectedNode.data?.label || NODE_LABELS[selectedNode.data?.kind as WorkflowNodeKind]} · 节点详情` : '节点详情'}
          description={mobilePanelOpen === 'library' ? '拖拽或点击添加到画布' : selectedNode ? `${selectedNode.id} · ${NODE_DESCS[selectedNode.data?.kind as WorkflowNodeKind]}` : '选择画布中的节点查看信息与配置'}
          width={460}
        >
          {mobilePanelOpen === 'library' && (
            <div className="space-y-2">
              <input
                value={librarySearchQ}
                onChange={(e) => setLibrarySearchQ(e.target.value)}
                placeholder="搜索节点"
                className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 text-xs outline-none focus:border-[var(--brand)]"
              />
              {filteredLibrary.map((kind) => {
                const Icon = NODE_ICONS[kind];
                return <button key={kind} type="button" className="flex w-full items-center gap-2 rounded-md border border-[var(--border)] p-2 text-left text-xs" onClick={() => addNode(kind)}><Icon className="h-4 w-4" style={{ color: NODE_COLORS[kind] }} />{NODE_LABELS[kind]}</button>;
              })}
            </div>
          )}
          {mobilePanelOpen !== 'library' && selectedNode && (
            <div className="space-y-4">
              <div className="flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-1">
                {[
                  { key: 'overview' as const, label: '概览', icon: FileText },
                  { key: 'config' as const, label: '配置', icon: Settings },
                  { key: 'debug' as const, label: '调试', icon: Bug },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setNodeInspectorTab(item.key)}
                    className={cn('flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] transition-colors', nodeInspectorTab === item.key ? 'bg-[var(--bg)] font-semibold text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]')}
                  >
                    <item.icon className="h-3.5 w-3.5" />{item.label}
                  </button>
                ))}
              </div>
              {nodeInspectorTab === 'overview' && <NodeOverview selectedNode={selectedNode} structureIssues={structureIssues} />}
              {nodeInspectorTab === 'config' && <PropertiesPanel selectedNode={selectedNode} updateNodeLabel={updateNodeLabel} updateNodeDescription={updateNodeDescription} updateNodeNote={updateNodeNote} patchNodeData={patchNodeData} structureIssues={structureIssues} showToast={showToast} />}
              {nodeInspectorTab === 'debug' && <DebugPanel selectedNode={selectedNode} selectedNodeId={selectedNodeId} deleteNode={deleteNode} duplicateNode={duplicateNode} disableNode={disableNode} showToast={showToast} />}
            </div>
          )}
        </Drawer>

        {/* 画布上下文 + 快捷工具 */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2.5 flex-wrap">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--info-bg)] px-2 py-1 text-[10px] font-medium text-[var(--info)]"><Webhook className="h-3.5 w-3.5 shrink-0" /><span className="font-mono">POST</span></span>
            <span className="max-w-[220px] truncate font-mono text-[11px] font-medium text-[var(--text-secondary)]">/webhook/redis-oom</span>
            <button
              type="button"
              onClick={() => setWebhookEnabled(!webhookEnabled)}
              aria-pressed={webhookEnabled}
              aria-label={webhookEnabled ? '停用 Webhook 触发器' : '启用 Webhook 触发器'}
              className={cn(
                'relative h-4 w-7 rounded-full transition-colors shrink-0',
                webhookEnabled ? 'bg-[var(--success)]' : 'bg-[var(--border-strong)]',
              )}
            >
              <span className={cn(
                'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all',
                webhookEnabled ? 'left-3.5' : 'left-0.5',
              )} />
            </button>
            <span className={cn('text-[10px] font-medium shrink-0', webhookEnabled ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>{webhookEnabled ? '触发已启用' : '触发已停用'}</span>
            <span className="hidden h-4 w-px bg-[var(--border)] sm:block" />
            <span className="hidden text-[10px] text-[var(--text-muted)] sm:inline">{rfNodes.length} 节点 · {rfEdges.length} 连线</span>
            {isDirty && <Badge tone="warn" className="text-[9px]">草稿待保存</Badge>}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {/* 画布节点搜索定位 */}
            <div className="relative mr-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--text-muted)]" />
              <input
                value={canvasSearchQ}
                onChange={(e) => setCanvasSearchQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && searchMatch) focusNode(searchMatch.id); }}
                placeholder="定位节点 (id / label)"
                className="h-7 w-44 rounded-md border border-[var(--border)] bg-[var(--bg)] pl-7 pr-2 text-[11px] outline-none focus:border-[var(--brand)]"
              />
              {canvasSearchQ && searchMatch && (
                <button
                  onClick={() => focusNode(searchMatch.id)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded bg-[var(--brand)] px-1.5 py-0.5 text-[9px] text-white"
                >
                  跳转
                </button>
              )}
              {canvasSearchQ && !searchMatch && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-[var(--danger)]">无匹配</span>
              )}
            </div>
            <button
              onClick={undo}
              disabled={!canUndo}
              title="撤销 (Cmd+Z)"
              className="grid h-7 w-7 place-items-center rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text-secondary)] hover:border-[var(--brand)] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              title="重做 (Cmd+Shift+Z)"
              className="grid h-7 w-7 place-items-center rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text-secondary)] hover:border-[var(--brand)] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* 画布 */}
        <div
          ref={wrapperRef}
          className="relative min-h-[560px] flex-1 w-full"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <ReactFlowProvider>
            <ReactFlow
              ref={reactFlowRef}
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              proOptions={{ hideAttribution: true }}
              onNodeClick={handleNodeClick}
              onNodeContextMenu={onNodeContextMenu}
              onNodesChange={onNodesChange}
              onConnect={onConnect}
              onEdgeDoubleClick={(_, edge) => deleteEdge(edge.id)}
              defaultEdgeOptions={{ type: 'smoothstep' }}
              minZoom={0.4}
              maxZoom={1.8}
            >
              <Background gap={20} size={1} color="var(--border-strong)" />
              <Controls position="bottom-right" showInteractive={false} />
              <MiniMap
                position="top-right"
                nodeColor={(n) => NODE_COLORS[(n.data as any)?.kind as WorkflowNodeKind] ?? '#3b82f6'}
                maskColor="rgba(15,21,37,0.6)"
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
              />
            </ReactFlow>
          </ReactFlowProvider>

          {/* 画布内节点库：可直接拖放到任意画布位置 */}
          {nodeLibraryOpen && (
            <div className="absolute left-3 top-3 z-20 flex max-h-[calc(100%-24px)] w-[318px] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)]/95 shadow-xl backdrop-blur">
              <div className="border-b border-[var(--border)] p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <span className="grid h-6 w-6 place-items-center rounded-lg bg-[var(--brand-light)] text-[var(--brand)]"><Box className="h-3.5 w-3.5" /></span>
                  节点库
                  <span className="ml-auto text-[10px] font-normal text-[var(--text-muted)]">点击或拖拽添加</span>
                </div>
                <div className="relative mt-2">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input value={librarySearchQ} onChange={(event) => setLibrarySearchQ(event.target.value)} placeholder="搜索节点、能力或系统" className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] pl-8 pr-2 text-[11px] outline-none focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_var(--brand-light)]" />
                </div>
                <div className="mt-2 flex items-center gap-1 rounded-lg bg-[var(--bg-elevated)] p-1">
                  {(['recommended', 'all'] as const).map((view) => <button key={view} type="button" onClick={() => setLibraryView(view)} className={cn('flex-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors', libraryView === view ? 'bg-[var(--surface-1)] text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)]')}>{view === 'recommended' ? '推荐下一步' : '全部节点'}</button>)}
                </div>
                {libraryView === 'recommended' && <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-muted)]">{selectedLibraryKind ? `基于「${NODE_LABELS[selectedLibraryKind]}」推荐可接入节点` : '从触发器或常用能力开始搭建流程'}</p>}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
                {visibleLibraryGroups.length > 0 ? <div className="space-y-3">{visibleLibraryGroups.map((group) => <section key={group.id}><div className="mb-1.5 flex items-center gap-2 px-0.5"><span className="text-[10px] font-semibold text-[var(--text-secondary)]">{group.label}</span><span className="truncate text-[9px] text-[var(--text-muted)]">{group.desc}</span></div><div className="grid grid-cols-2 gap-1.5">{group.kinds.map((kind) => {
                  const Icon = NODE_ICONS[kind];
                  const color = NODE_COLORS[kind];
                  const meta = NODE_LIBRARY_META[kind];
                  return <button key={kind} draggable onDragStart={(event) => { event.dataTransfer.setData('application/wf-node', kind); event.dataTransfer.effectAllowed = 'move'; setDraggedKind(kind); }} onDragEnd={() => setDraggedKind(null)} onClick={() => addNode(kind)} className="group flex min-w-0 cursor-grab flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-2 text-left transition-all hover:-translate-y-px hover:border-[var(--brand)] hover:shadow-sm active:cursor-grabbing" title={`${NODE_DESCS[kind]} · 拖拽到画布添加`}><span className="flex items-center gap-1.5"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-md" style={{ backgroundColor: `${color}1a`, color }}><Icon className="h-3.5 w-3.5" /></span><span className="truncate text-[10px] font-semibold text-[var(--text)]">{NODE_LABELS[kind]}</span></span><span className="line-clamp-2 min-h-[26px] text-[9px] leading-[13px] text-[var(--text-muted)]">{NODE_DESCS[kind]}</span>{meta.badge && <span className={cn('w-fit rounded px-1.5 py-0.5 text-[8px] font-medium', meta.risk === 'sensitive' ? 'bg-[var(--warning-bg)] text-[var(--warning)]' : meta.risk === 'review' ? 'bg-[var(--brand-light)] text-[var(--brand)]' : 'bg-[var(--bg-hover)] text-[var(--text-muted)]')}>{meta.badge}</span>}</button>;
                })}</div></section>)}</div> : <div className="grid min-h-28 place-items-center px-5 text-center text-[11px] text-[var(--text-muted)]">未找到匹配节点，请调整搜索条件。</div>}
              </div>
            </div>
          )}

          {/* 拖拽提示 */}
          {props.draggedKind && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[var(--brand)]/5 border-2 border-dashed border-[var(--brand)]/40 z-10">
              <div className="rounded-md bg-[var(--surface-1)] border border-[var(--brand)] px-4 py-2 text-sm font-semibold text-[var(--brand)] shadow-lg">
                释放鼠标添加到画布 · {NODE_LABELS[props.draggedKind]}
              </div>
            </div>
          )}

          {/* 画布草稿状态 */}
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]/95 px-2.5 py-1.5 text-[10px] text-[var(--text-muted)] shadow-[0_2px_8px_rgba(15,23,42,0.06)] backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
            <span>编排草稿</span>
            <span className="h-3 w-px bg-[var(--border)]" />
            <span className="font-mono font-semibold text-[var(--text-secondary)]">{selectedNode ? (selectedNode.data?.label || selectedNode.id) : '未选中节点'}</span>
            <span className="text-[var(--text-muted)]">{isDirty ? '待保存' : '已同步'}</span>
          </div>

          {/* 快捷键提示 */}
          <div className="absolute bottom-3 right-3 hidden max-w-[min(520px,calc(100%-24px))] items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)]/95 px-2 py-1 text-[9px] text-[var(--text-muted)] backdrop-blur font-mono sm:flex">
            <span className="whitespace-normal">拖动节点 handle 连线 · 双击连线删除 · Del 删除节点 · ⌘S 保存 · ⌘Z 撤销</span>
          </div>
        </div>
      </div>

      {/* —— 右侧：大屏节点检查器 —— */}
      {selectedNode ? (
        <aside className="hidden w-[340px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface-1)] lg:flex">
          <div className="flex items-start justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-[var(--text)]">{selectedNode.data?.label || NODE_LABELS[selectedNode.data?.kind as WorkflowNodeKind]}</div>
              <div className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">{selectedNode.id} · 节点检查器</div>
            </div>
          </div>
          <div className="flex gap-1 border-b border-[var(--border)] bg-[var(--bg-elevated)] p-1.5">
            {[
              { key: 'overview' as const, label: '概览', icon: FileText },
              { key: 'config' as const, label: '配置', icon: Settings },
              { key: 'debug' as const, label: '调试', icon: Bug },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setNodeInspectorTab(item.key)}
                className={cn('flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] transition-colors', nodeInspectorTab === item.key ? 'bg-[var(--bg)] font-semibold text-[var(--brand)] shadow-sm' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]')}
              >
                <item.icon className="h-3.5 w-3.5" />{item.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {nodeInspectorTab === 'overview' && <NodeOverview selectedNode={selectedNode} structureIssues={structureIssues} />}
            {nodeInspectorTab === 'config' && <PropertiesPanel selectedNode={selectedNode} updateNodeLabel={updateNodeLabel} updateNodeDescription={updateNodeDescription} updateNodeNote={updateNodeNote} patchNodeData={patchNodeData} structureIssues={structureIssues} showToast={showToast} />}
            {nodeInspectorTab === 'debug' && <DebugPanel selectedNode={selectedNode} selectedNodeId={selectedNodeId} deleteNode={deleteNode} duplicateNode={duplicateNode} disableNode={disableNode} showToast={showToast} />}
          </div>
        </aside>
      ) : (
        <aside className="hidden w-[280px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface-1)] p-4 text-center text-[11px] text-[var(--text-muted)] lg:flex">
          <InfoPanel nodes={nodes} edgeCount={rfEdges.length} />
        </aside>
      )}
      </div>
    </div>
  );
}

/* =============================================================
 *  信息面板（节点列表 + 当前 DAG 状态）
 * ============================================================= */
function InfoPanel({ nodes, edgeCount }: { nodes: Node[]; edgeCount?: number }) {
  return (
    <div className="space-y-4">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">画布概览</div>
          <Badge tone="neutral" className="text-[9px]">草稿</Badge>
        </div>
        <div className="grid grid-cols-2 divide-x divide-[var(--border)] rounded-md border border-[var(--border)] bg-[var(--surface-2)]">
          <div className="px-2 py-2 text-center">
            <div className="font-mono text-lg font-bold text-[var(--brand)]">{nodes.length}</div>
            <div className="text-[9px] text-[var(--text-muted)]">节点</div>
          </div>
          <div className="px-2 py-2 text-center">
            <div className="font-mono text-lg font-bold text-[var(--text)]">{edgeCount ?? '—'}</div>
            <div className="text-[9px] text-[var(--text-muted)]">连线</div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">节点列表</div>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">{nodes.length} 个</span>
        </div>
        <div className="divide-y divide-[var(--border)] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg)]">
          {nodes.map((n, i) => {
            const kind = n.data?.kind as WorkflowNodeKind;
            const Icon = NODE_ICONS[kind];
            const color = NODE_COLORS[kind];
            return (
              <div
                key={n.id}
                className="flex h-11 items-center gap-2 px-2.5 text-[11px] transition-colors"
              >
                <span className="w-4 shrink-0 text-right font-mono text-[10px] text-[var(--text-muted)]">{i + 1}</span>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded" style={{ backgroundColor: `${color}1a` }}>
                  <Icon className="h-3.5 w-3.5" style={{ color }} />
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">{n.data?.label || NODE_LABELS[kind]}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* =============================================================
 *  节点检查器概览
 * ============================================================= */
function NodeOverview({ selectedNode, structureIssues = [] }: { selectedNode: Node; structureIssues?: StructureIssue[] }) {
  const kind = selectedNode.data?.kind as WorkflowNodeKind;
  const Icon = NODE_ICONS[kind];
  const color = NODE_COLORS[kind];
  const debugInfo = NODE_DEBUG[selectedNode.id];
  const relatedIssue = structureIssueForNode(structureIssues, kind);
  const failedIssues = structureIssues.filter((item) => item.severity === 'failed');

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: `${color}1a`, color }}><Icon className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ backgroundColor: `${color}1a`, color }}>{kind}</span>
              <Badge tone="neutral" className="text-[9px]">编排节点</Badge>
              {selectedNode.data?.disabled && <Badge tone="neutral" className="text-[9px]">已禁用</Badge>}
              {relatedIssue && <Badge tone={relatedIssue.severity === 'failed' ? 'error' : 'warn'} className="text-[9px]">{relatedIssue.severity === 'failed' ? '门禁阻断' : '建议复核'}</Badge>}
            </div>
            <div className="mt-1 text-sm font-semibold text-[var(--text)]">{selectedNode.data?.label || NODE_LABELS[kind]}</div>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">{selectedNode.data?.desc || NODE_DESCS[kind]}</p>
          </div>
        </div>
      </section>
      {failedIssues.length > 0 && (
        <section className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-bg)] p-2.5 text-[11px]">
          <div className="mb-1 flex items-center gap-1 font-semibold text-[var(--warning)]"><AlertTriangle className="h-3.5 w-3.5" />流程结构门禁</div>
          <ul className="space-y-1 text-[var(--text-secondary)]">{failedIssues.map((item) => <li key={item.code}>• {item.message}</li>)}</ul>
        </section>
      )}
      <section className="grid grid-cols-2 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[11px]">
        <div className="border-b border-r border-[var(--border)] p-2.5"><div className="text-[10px] text-[var(--text-muted)]">节点 ID</div><div className="mt-0.5 font-mono text-[var(--text-secondary)]">{selectedNode.id}</div></div>
        <div className="border-b border-[var(--border)] p-2.5"><div className="text-[10px] text-[var(--text-muted)]">节点状态</div><div className={cn('mt-0.5 font-medium', selectedNode.data?.disabled ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]')}>{selectedNode.data?.disabled ? '已跳过' : '可配置'}</div></div>
        <div className="border-r border-[var(--border)] p-2.5"><div className="text-[10px] text-[var(--text-muted)]">画布坐标</div><div className="mt-0.5 font-mono text-[var(--text-secondary)]">{Math.round(selectedNode.position.x)}, {Math.round(selectedNode.position.y)}</div></div>
        <div className="p-2.5"><div className="text-[10px] text-[var(--text-muted)]">样例日志</div><div className="mt-0.5 font-mono text-[var(--text-secondary)]">{debugInfo ? debugInfo.log.at(-1)?.slice(1, 9) ?? '—' : '暂无记录'}</div></div>
      </section>
      {selectedNode.data?.note && <section className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-bg)] p-2.5 text-[11px]"><div className="mb-1 flex items-center gap-1 font-semibold text-[var(--warning)]"><MessageSquare className="h-3.5 w-3.5" />运行批注</div><p className="leading-relaxed text-[var(--text-secondary)]">{selectedNode.data.note}</p></section>}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">配置提示</div>
        <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{kind === 'approval' ? '请设置审批组、签名人数和审批超时；任何写操作均应保留回滚分支。' : ['execute', 'http', 'mcp'].includes(kind) ? '请确认调用目标、凭据权限、参数与重试策略；高风险动作建议先串联风险策略或双重审批。' : kind === 'policy' ? '请配置风险等级、允许动作与越权处理方式；策略命中结果会写入运行审计。' : ['retry', 'compensate'].includes(kind) ? '请明确可重试错误、退避次数或补偿动作，避免失败后重复写入或产生不可逆变更。' : ['branch', 'condition', 'parallel'].includes(kind) ? '请配置判断表达式、出口与汇聚规则，确保默认路径和异常路径都可以追溯。' : '在“配置”页更新节点名称、描述与运行批注；变更后需点击应用修改。'}</p>
      </section>
    </div>
  );
}

/* =============================================================
 *  调试面板
 * ============================================================= */
function DebugPanel({
  selectedNode, selectedNodeId, deleteNode, duplicateNode, disableNode, showToast,
}: {
  selectedNode: Node | null;
  selectedNodeId: string | null;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  disableNode: (id: string) => void;
  showToast: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}) {
  if (!selectedNode) {
    return (
      <div className="grid h-full place-items-center text-center text-xs text-[var(--text-muted)] px-4">
        <div>
          <Bug className="mx-auto mb-2 h-8 w-8 opacity-30" />
          点击画布上的任意节点<br />查看调试信息
        </div>
      </div>
    );
  }

  const debugInfo = NODE_DEBUG[selectedNode.id];
  const kind = selectedNode.data?.kind as WorkflowNodeKind;

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-[var(--text-muted)]">{selectedNode.id}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: `${NODE_COLORS[kind]}1a`, color: NODE_COLORS[kind] }}>{kind}</span>
        </div>
        <div className="mt-1 text-sm font-semibold">{selectedNode.data?.label || NODE_LABELS[kind]}</div>
        <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{NODE_DESCS[kind]}</div>
      </div>

      <div className="rounded-lg border border-[var(--info)]/25 bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]">
        调试面板展示样例或最近一次试运行证据。当前无绑定执行记录时仅为静态样例，不产生审计事件。
      </div>

      {debugInfo ? (
        <>
          <Section title="样例输入（非真实 run）">
            <pre className="text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-all text-[var(--text-secondary)]">{debugInfo.input}</pre>
          </Section>
          <Section title="样例输出（非真实 run）">
            <pre className="text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-all text-[var(--success)]">{debugInfo.output}</pre>
          </Section>
          <Section title="样例日志">
            <div className="space-y-0.5 font-mono text-[10px]">
              {debugInfo.log.map((line, i) => (
                <div key={i} className="text-[var(--text-secondary)]">{line}</div>
              ))}
            </div>
          </Section>
          <Section title="本地模拟">
            <p className="mb-2 text-[10px] leading-4 text-[var(--text-muted)]">以下操作仅用于界面演示，不会创建执行记录或审计留痕。真实回放请到「运行记录」。</p>
            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary" className="flex-1" onClick={() => showToast(`已在本地模拟重跑节点 ${selectedNodeId}（无审计）`, 'info')}>
                <RotateCcw className="h-3 w-3" />模拟重跑
              </Button>
              <Button size="sm" variant="secondary" className="flex-1" onClick={() => showToast(`已在本地模拟从节点 ${selectedNodeId} 续跑（无审计）`, 'info')}>
                <Eye className="h-3 w-3" />模拟续跑
              </Button>
            </div>
          </Section>
        </>
      ) : (
        <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-center text-[11px] text-[var(--text-muted)]">
          暂无执行记录。完成保存并通过结构门禁后，使用「运行试验」生成可追溯证据。
        </div>
      )}

      <Section title="节点操作">
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => duplicateNode(selectedNode.id)}>
            <Copy className="h-3 w-3" />复制
          </Button>
          <Button size="sm" variant="secondary" onClick={() => disableNode(selectedNode.id)}>
            {selectedNode.data?.disabled ? '启用' : '禁用'}
          </Button>
          <Button size="sm" variant="secondary" className="col-span-2 text-[var(--danger)]" onClick={() => deleteNode(selectedNode.id)}>
            <Trash2 className="h-3 w-3" />删除节点
          </Button>
        </div>
      </Section>
    </div>
  );
}

/* =============================================================
 *  属性面板（编辑节点 label / 描述 / 配置）
 * ============================================================= */
function PropertiesPanel({
  selectedNode, patchNodeData, structureIssues = [], showToast,
}: {
  selectedNode: Node | null;
  updateNodeLabel?: (id: string, label: string) => void;
  updateNodeDescription?: (id: string, desc: string) => void;
  updateNodeNote?: (id: string, note: string) => void;
  patchNodeData: (id: string, patch: Record<string, unknown>) => void;
  structureIssues?: StructureIssue[];
  showToast: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}) {
  const config = (selectedNode?.data?.config ?? {}) as Record<string, any>;
  const [label, setLabel] = useState(selectedNode?.data?.label ?? '');
  const [desc, setDesc] = useState(selectedNode?.data?.desc ?? '');
  const [note, setNote] = useState(selectedNode?.data?.note ?? '');
  const [approverGroup, setApproverGroup] = useState(config.approverGroup ?? 'SRE 值班双人组');
  const [approverCount, setApproverCount] = useState(String(config.approverCount ?? 2));
  const [approvalTimeout, setApprovalTimeout] = useState(String(config.approvalTimeoutSec ?? 300));
  const [execTarget, setExecTarget] = useState(config.execTarget ?? 'skill_redis_tune');
  const [credentialRef, setCredentialRef] = useState(config.credentialRef ?? 'vault://workflow/prod-write');
  const [retryCount, setRetryCount] = useState(String(config.retryCount ?? 1));
  const [riskLevel, setRiskLevel] = useState(config.riskLevel ?? 'L2');
  const [denyAction, setDenyAction] = useState(config.denyAction ?? 'block');
  const [knowledgePackageId, setKnowledgePackageId] = useState('');
  const [noResultPolicy, setNoResultPolicy] = useState<'clarify' | 'handoff' | 'block'>('block');
  const { data: knowledgePackages = [] } = useApiQuery<KnowledgePackage[]>(['workflow-properties', 'knowledge-packages'], '/api/knowledge/packages');
  const { data: retrievalProfiles = [] } = useApiQuery<KnowledgeRetrievalProfile[]>(['workflow-properties', 'retrieval-profiles'], '/api/knowledge/retrieval-profiles');
  const bindKnowledgeMutation = useApiMutation<any, { packageId: string; consumerType: 'workflow'; consumerId: string; consumerName: string; environment: 'production'; profileId: string; noResultPolicy: 'clarify' | 'handoff' | 'block' }>('/api/knowledge/bindings', { onSuccess: (binding) => showToast(`已绑定 ${binding.packageName} ${binding.packageVersion}`, 'success') });

  useEffect(() => {
    const nextConfig = (selectedNode?.data?.config ?? {}) as Record<string, any>;
    setLabel(selectedNode?.data?.label ?? '');
    setDesc(selectedNode?.data?.desc ?? '');
    setNote(selectedNode?.data?.note ?? '');
    setApproverGroup(nextConfig.approverGroup ?? 'SRE 值班双人组');
    setApproverCount(String(nextConfig.approverCount ?? 2));
    setApprovalTimeout(String(nextConfig.approvalTimeoutSec ?? 300));
    setExecTarget(nextConfig.execTarget ?? (selectedNode?.data?.kind === 'http' ? 'https://api.internal/ops' : selectedNode?.data?.kind === 'mcp' ? 'kubernetes-mcp' : 'skill_redis_tune'));
    setCredentialRef(nextConfig.credentialRef ?? 'vault://workflow/prod-write');
    setRetryCount(String(nextConfig.retryCount ?? 1));
    setRiskLevel(nextConfig.riskLevel ?? 'L2');
    setDenyAction(nextConfig.denyAction ?? 'block');
    setKnowledgePackageId('');
  }, [selectedNode?.id]);

  if (!selectedNode) {
    return (
      <div className="grid h-full place-items-center text-center text-xs text-[var(--text-muted)] px-4">
        <div>
          <Settings className="mx-auto mb-2 h-8 w-8 opacity-30" />
          点击画布上的任意节点<br />编辑其属性
        </div>
      </div>
    );
  }

  const kind = selectedNode.data?.kind as WorkflowNodeKind;
  const Icon = NODE_ICONS[kind];
  const color = NODE_COLORS[kind];
  const nodeMeta = NODE_LIBRARY_META[kind];
  const requiresReview = nodeMeta.risk === 'review' || nodeMeta.risk === 'sensitive';
  const relatedIssue = structureIssueForNode(structureIssues, kind);

  const apply = () => {
    const nextConfig: Record<string, unknown> = { ...(selectedNode.data?.config ?? {}) };
    if (kind === 'approval') {
      nextConfig.approverGroup = approverGroup.trim();
      nextConfig.approverCount = Number(approverCount) || 2;
      nextConfig.approvalTimeoutSec = Number(approvalTimeout) || 300;
    }
    if (['execute', 'http', 'mcp'].includes(kind)) {
      nextConfig.execTarget = execTarget.trim();
      nextConfig.credentialRef = credentialRef.trim();
      nextConfig.retryCount = Number(retryCount) || 0;
    }
    if (kind === 'policy') {
      nextConfig.riskLevel = riskLevel;
      nextConfig.denyAction = denyAction;
    }
    patchNodeData(selectedNode.id, { label, desc, note, config: nextConfig });
    showToast(`节点 ${selectedNode.id} 属性已更新`, 'success');
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center gap-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl" style={{ backgroundColor: `${color}1a`, color }}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5"><span className="rounded-md px-1.5 py-0.5 font-mono text-[9px] font-medium" style={{ backgroundColor: `${color}1a`, color }}>{kind}</span>{nodeMeta.badge && <span className="rounded-md bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--text-muted)]">{nodeMeta.badge}</span>}</div>
            <div className="mt-1 text-sm font-semibold text-[var(--text)]">{selectedNode.data?.label || NODE_LABELS[kind]}</div>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-[var(--text-muted)]">{selectedNode.data?.desc || NODE_DESCS[kind]}</p>
      </section>

      {relatedIssue && <section className={cn('rounded-xl border p-3 text-[11px]', relatedIssue.severity === 'failed' ? 'border-[var(--warning)]/30 bg-[var(--warning-bg)]' : 'border-[var(--info)]/25 bg-[var(--info-bg)]')}><div className={cn('flex items-center gap-1.5 font-semibold', relatedIssue.severity === 'failed' ? 'text-[var(--warning)]' : 'text-[var(--info)]')}><AlertTriangle className="h-3.5 w-3.5" />结构门禁提示</div><p className="mt-1.5 leading-5 text-[var(--text-secondary)]">{relatedIssue.message}</p></section>}

      {requiresReview && <section className={cn('rounded-xl border p-3 text-[11px]', nodeMeta.risk === 'sensitive' ? 'border-[var(--warning)]/30 bg-[var(--warning-bg)]' : 'border-[var(--info)]/25 bg-[var(--info-bg)]')}><div className={cn('flex items-center gap-1.5 font-semibold', nodeMeta.risk === 'sensitive' ? 'text-[var(--warning)]' : 'text-[var(--info)]')}><ShieldCheck className="h-3.5 w-3.5" />{nodeMeta.risk === 'sensitive' ? '受控执行节点' : '需要治理复核'}</div><p className="mt-1.5 leading-5 text-[var(--text-secondary)]">{nodeMeta.risk === 'sensitive' ? '请确认目标系统、调用权限与补偿策略；运行前应串联审批或风险策略。' : '请确认策略、审批人或失败路径配置，变更将写入工作流审计。'}</p></section>}

      {kind === 'retrieve' && <section className="space-y-3 rounded-xl border border-[var(--brand)]/25 bg-[var(--brand-light)]/35 p-4"><div><div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text)]"><Database className="h-3.5 w-3.5 text-[var(--brand)]" />知识包引用</div><p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">仅可引用知识库中心已发布的版本；运行记录将保留证据与版本。</p></div><Field label="已发布知识包"><select value={knowledgePackageId} onChange={(event) => setKnowledgePackageId(event.target.value)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12px]"><option value="">请选择知识包</option>{knowledgePackages.filter((item) => item.status === 'published' && item.currentVersion.status === 'published').map((item) => <option key={item.id} value={item.id}>{item.name} · {item.currentVersion.version}</option>)}</select></Field><Field label="无结果策略"><select value={noResultPolicy} onChange={(event) => setNoResultPolicy(event.target.value as typeof noResultPolicy)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12px]"><option value="block">阻断后续执行</option><option value="handoff">转人工接管</option><option value="clarify">请求补充信息</option></select></Field><Button size="sm" className="w-full" disabled={!knowledgePackageId || bindKnowledgeMutation.isPending} onClick={() => { const profile = retrievalProfiles.find((item) => item.packageId === knowledgePackageId); if (!profile) { showToast('该知识包尚未配置检索策略', 'error'); return; } bindKnowledgeMutation.mutate({ packageId: knowledgePackageId, consumerType: 'workflow', consumerId: 'wf1', consumerName: `工作流节点 ${selectedNode.id}`, environment: 'production', profileId: profile.id, noResultPolicy }); }}><ShieldCheck className="h-3.5 w-3.5" />{bindKnowledgeMutation.isPending ? '绑定中…' : '绑定并锁定当前版本'}</Button></section>}

      {kind === 'approval' && (
        <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="text-xs font-semibold text-[var(--text)]">双重审批配置</div>
          <Field label="审批组"><input value={approverGroup} onChange={(e) => setApproverGroup(e.target.value)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12px] outline-none focus:border-[var(--brand)]" /></Field>
          <Field label="所需签发人数"><input type="number" min={1} max={5} value={approverCount} onChange={(e) => setApproverCount(e.target.value)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12px] outline-none focus:border-[var(--brand)]" /></Field>
          <Field label="超时（秒）"><input type="number" min={60} value={approvalTimeout} onChange={(e) => setApprovalTimeout(e.target.value)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12px] outline-none focus:border-[var(--brand)]" /></Field>
        </section>
      )}

      {['execute', 'http', 'mcp'].includes(kind) && (
        <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="text-xs font-semibold text-[var(--text)]">{kind === 'execute' ? '已纳管 Skill 调用' : kind === 'http' ? 'HTTP 调用' : '受控 MCP 调用'}</div>
          <Field label={kind === 'http' ? 'API 端点' : kind === 'mcp' ? 'MCP 工具' : 'Skill 标识'}><input value={execTarget} onChange={(e) => setExecTarget(e.target.value)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12px] outline-none focus:border-[var(--brand)]" /></Field>
          <Field label="凭据引用"><input value={credentialRef} onChange={(e) => setCredentialRef(e.target.value)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12px] outline-none focus:border-[var(--brand)]" /></Field>
          <Field label="失败重试次数"><input type="number" min={0} max={5} value={retryCount} onChange={(e) => setRetryCount(e.target.value)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12px] outline-none focus:border-[var(--brand)]" /></Field>
        </section>
      )}

      {kind === 'policy' && (
        <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="text-xs font-semibold text-[var(--text)]">风险策略</div>
          <Field label="风险等级"><select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12px]"><option value="L1">L1</option><option value="L2">L2</option><option value="L3">L3</option></select></Field>
          <Field label="越权处理"><select value={denyAction} onChange={(e) => setDenyAction(e.target.value)} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12px]"><option value="block">阻断</option><option value="handoff">转人工</option><option value="escalate">升级审批</option></select></Field>
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
      <div className="text-xs font-semibold text-[var(--text)]">基础配置</div>
      <Field label="节点标识">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-[11px] text-[var(--text-muted)]">
          {selectedNode.id}
        </div>
      </Field>

      <Field label="显示名称">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 text-[12px] outline-none transition-[border-color,box-shadow] focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_var(--brand-light)]"
        />
      </Field>

      <Field label="描述">
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[12px] outline-none transition-[border-color,box-shadow] focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_var(--brand-light)]"
        />
      </Field>
      </section>

      <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
      <div className="text-xs font-semibold text-[var(--text)]">运行说明</div>
      <Field label="运维批注">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="如：高峰期需人工确认、双重审批须在 5 分钟内…"
          className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[12px] outline-none transition-[border-color,box-shadow] focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_var(--brand-light)]"
        />
        <div className="mt-1 text-[9px] text-[var(--text-muted)] flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          执行人与审计人员可在节点上下文中查看此批注
        </div>
      </Field>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
      <div className="mb-3 text-xs font-semibold text-[var(--text)]">画布上下文</div>
      <Field label="画布位置">
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-[var(--text-secondary)]">
            x: {Math.round(selectedNode.position.x)}
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-[var(--text-secondary)]">
            y: {Math.round(selectedNode.position.y)}
          </div>
        </div>
      </Field>

      <Field label="运行状态">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px]">
          {selectedNode.data?.disabled
            ? <span className="text-[var(--danger)]">已禁用 · 运行时将跳过此节点</span>
            : <span className="text-[var(--success)]">已启用 · 将按编排路径执行</span>}
        </div>
      </Field>
      </section>

      <Button size="sm" className="w-full" onClick={apply}><Save className="h-3.5 w-3.5" />应用修改</Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">{label}</div>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold flex items-center gap-1">
        <ArrowRight className="h-3 w-3" />{title}
      </div>
      <div className="rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-2">{children}</div>
    </div>
  );
}

/* =============================================================
 *  工作流模版库（平台认证模板 + IT 高级库）
 * ============================================================= */
const TPL_PAGE_SIZE = 6;

function TemplatesView({
  filterGroup, setFilterGroup, filterIndustry, setFilterIndustry, filteredTemplates,
  templateOrigin, setTemplateOrigin, platformCount, personalCount,
  showAdvancedLibrary, setShowAdvancedLibrary,
  workspaceDeptOnly, setWorkspaceDeptOnly, workspaceDeptCount,
  onPreview, onUseTemplate, onBindSlot, onUpgradeDiff, onDeletePersonal, onSaveFromCanvas,
  canWrite, connectorBindings,
}: {
  filterGroup: DepartmentKey | 'all';
  setFilterGroup: (k: DepartmentKey | 'all') => void;
  filterIndustry: string;
  setFilterIndustry: (k: string) => void;
  filteredTemplates: WorkflowTemplateAsset[];
  templateOrigin: TemplateOrigin;
  setTemplateOrigin: (k: TemplateOrigin) => void;
  platformCount: number;
  personalCount: number;
  showAdvancedLibrary: boolean;
  setShowAdvancedLibrary: (v: boolean) => void;
  workspaceDeptOnly: boolean;
  setWorkspaceDeptOnly: (v: boolean) => void;
  workspaceDeptCount: number;
  onPreview: (t: WorkflowTemplateAsset) => void;
  onUseTemplate: (t: WorkflowTemplateAsset) => void;
  onBindSlot: (slot: string) => void;
  onUpgradeDiff: (t: WorkflowTemplateAsset) => void;
  onDeletePersonal: (t: WorkflowTemplateAsset) => void;
  onSaveFromCanvas: () => void;
  canWrite: boolean;
  connectorBindings: ConnectorBindings;
}) {
  const isPersonal = templateOrigin === 'personal';
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'healthy' | 'review'>('all');
  const [page, setPage] = useState(1);

  const visibleTemplates = useMemo(() => filteredTemplates.filter((template) => {
    const hay = `${template.name} ${template.description} ${template.owner} ${template.departmentLabel} ${template.audience} ${template.industryTags.join(' ')} ${template.connectors.map((c) => c.slot).join(' ')}`.toLowerCase();
    const matchesQuery = !query.trim() || hay.includes(query.trim().toLowerCase());
    const matchesScope = scope === 'all' || (scope === 'healthy' ? isTemplateReusable(template) : needsTemplateReview(template));
    return matchesQuery && matchesScope;
  }), [filteredTemplates, query, scope]);

  /** 全部部门：统一平铺；单部门筛选时同样平铺（不再插入分组标题） */
  const flatList = useMemo(
    () => visibleTemplates.slice().sort((a, b) => {
      if (filterGroup === 'all') {
        return a.department.localeCompare(b.department) || a.name.localeCompare(b.name, 'zh');
      }
      return a.name.localeCompare(b.name, 'zh');
    }),
    [visibleTemplates, filterGroup],
  );

  const readyCount = visibleTemplates.filter((t) => isTemplateReusable(t)).length;
  const reviewCount = visibleTemplates.length - readyCount;
  const totalCount = flatList.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / TPL_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [query, scope, filterGroup, filterIndustry, showAdvancedLibrary, workspaceDeptOnly, templateOrigin]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const pagedFlat = useMemo(() => {
    const start = (safePage - 1) * TPL_PAGE_SIZE;
    return flatList.slice(start, start + TPL_PAGE_SIZE);
  }, [flatList, safePage]);

  const rangeStart = totalCount === 0 ? 0 : (safePage - 1) * TPL_PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * TPL_PAGE_SIZE, totalCount);

  const renderCard = (t: WorkflowTemplateAsset, compact = false) => {
    const reusable = isTemplateReusable(t);
    const personal = isPersonalTemplate(t);
    const unbound = (t.connectors ?? []).filter((c) => !c.defaultBinding && !connectorBindings[c.slot] && c.slot !== 'notify.send' && c.slot !== 'knowledge.retrieve');
    const industryLabel = (t.industryTags ?? []).filter((tag) => tag !== 'all').slice(0, 2);
    return (
      <article
        key={t.id}
        className={cn(
          'wf-tpl-card group',
          compact && 'wf-tpl-card--compact',
          t.library === 'advanced' && 'wf-tpl-card--advanced',
          personal && 'wf-tpl-card--personal',
          !reusable && 'wf-tpl-card--blocked',
        )}
      >
        <header className="wf-tpl-card__head">
          <div className="min-w-0 flex-1">
            <div className="wf-tpl-card__title-row">
              <h3 className="wf-tpl-card__title" title={t.name}>{t.name}</h3>
              {personal
                ? <span className="wf-tpl-chip wf-tpl-chip--info">个人创建</span>
                : t.certification === 'certified' && <span className="wf-tpl-chip wf-tpl-chip--ok">平台认证</span>}
              {t.library === 'advanced' && <span className="wf-tpl-chip">高级库</span>}
              {t.parentId && <span className="wf-tpl-chip wf-tpl-chip--info">子流程</span>}
            </div>
            <p className="wf-tpl-card__meta">
              <span>{t.audience}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[10px]">{t.version}</span>
              <span aria-hidden="true">·</span>
              <span>风险 {t.risk}</span>
              {personal && t.owner && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{t.owner}</span>
                </>
              )}
            </p>
          </div>
          <span className={cn('wf-tpl-status', reusable ? 'is-ready' : 'is-blocked')}>
            {reusable ? (t.healthHint ? '可降级使用' : '可直接使用') : '需先授权'}
          </span>
        </header>

        <p className={cn('wf-tpl-card__desc', compact && 'line-clamp-2')}>{t.description}</p>

        {t.healthHint && (
          <div className="wf-tpl-callout wf-tpl-callout--info">{t.healthHint}</div>
        )}

        {!reusable && t.blockers.length > 0 && (
          <div className="wf-tpl-callout wf-tpl-callout--warn">
            <span>{t.blockers[0]}{t.blockers.length > 1 ? ` 等 ${t.blockers.length} 项` : ''}</span>
            {unbound[0] && (
              <button type="button" className="wf-tpl-link" onClick={() => onBindSlot(unbound[0].slot)}>去绑定</button>
            )}
          </div>
        )}

        {!compact && (
          <div className="wf-tpl-card__flow" aria-label={`共 ${t.nodes} 个节点`}>
            {t.sequence.slice(0, 5).map((kind, index) => {
              const StageIcon = NODE_ICONS[kind];
              return (
                <div key={`${kind}-${index}`} className="wf-tpl-card__flow-item">
                  {index > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-[var(--border-strong)]" aria-hidden="true" />}
                  <span title={NODE_LABELS[kind]} className="wf-tpl-card__flow-icon">
                    <StageIcon className="h-3 w-3" />
                  </span>
                  <span className="wf-tpl-card__flow-label">{NODE_LABELS[kind]}</span>
                </div>
              );
            })}
            {t.sequence.length > 5 && <span className="wf-tpl-card__flow-more">+{t.sequence.length - 5}</span>}
          </div>
        )}

        {!compact && (t.connectors?.length ?? 0) > 0 && (
          <div className="wf-tpl-card__slots">
            {t.connectors.slice(0, 3).map((c) => {
              const bound = Boolean(c.defaultBinding || connectorBindings[c.slot] || c.slot === 'notify.send' || c.slot === 'knowledge.retrieve');
              return (
                <button
                  key={c.slot}
                  type="button"
                  title={`${c.label}（${c.slot}）`}
                  onClick={() => !bound && onBindSlot(c.slot)}
                  className={cn('wf-tpl-slot', bound ? 'is-bound' : 'is-open')}
                >
                  {c.label}{c.required ? '' : '（可选）'}
                </button>
              );
            })}
            {t.connectors.length > 3 && <span className="wf-tpl-slot is-more">+{t.connectors.length - 3}</span>}
          </div>
        )}

        {(industryLabel.length > 0 || !compact || (t.knowledgePackageIds?.length ?? 0) > 0 || (t.requiredSkills?.length ?? 0) > 0) && (
          <div className="wf-tpl-card__tags">
            {industryLabel.map((tag) => (
              <span key={tag} className="wf-tpl-tag">{tag}</span>
            ))}
            {industryLabel.length === 0 && <span className="wf-tpl-tag">通用</span>}
            {(t.knowledgePackageIds ?? []).slice(0, 2).map((id) => (
              <span key={id} className="wf-tpl-tag wf-tpl-tag--knowledge" title={id}>知识 · {id.replace(/^kp\.office\./, '')}</span>
            ))}
            {(t.requiredSkills ?? []).slice(0, 3).map((sk) => (
              <span key={sk} className="wf-tpl-tag wf-tpl-tag--skill" title={sk}>技能 · {sk}</span>
            ))}
          </div>
        )}

        <footer className="wf-tpl-card__foot">
          <div className="wf-tpl-card__actions">
            <button type="button" className="wf-tpl-ghost" onClick={() => onPreview(t)}>
              <Eye className="h-3.5 w-3.5" />预览
            </button>
            {!personal && (
              <button type="button" className="wf-tpl-ghost" onClick={() => onUpgradeDiff(t)} title="查看版本差异">
                <GitCompare className="h-3.5 w-3.5" />版本
              </button>
            )}
            {personal && canWrite && (
              <button type="button" className="wf-tpl-ghost wf-tpl-ghost--danger" onClick={() => onDeletePersonal(t)} title="删除个人模板">
                <Trash2 className="h-3.5 w-3.5" />删除
              </button>
            )}
          </div>
          <Button size="sm" className="rounded-lg px-3.5" onClick={() => onUseTemplate(t)}>
            使用模板<ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </footer>
      </article>
    );
  };

  return (
    <div className="wf-tpl-page">
      <div className="wf-tpl-origin" role="tablist" aria-label="模板来源">
        <button
          type="button"
          role="tab"
          aria-selected={!isPersonal}
          className={cn('wf-tpl-origin__btn', !isPersonal && 'is-active')}
          onClick={() => setTemplateOrigin('platform')}
        >
          平台内置<em>{platformCount}</em>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isPersonal}
          className={cn('wf-tpl-origin__btn', isPersonal && 'is-active')}
          onClick={() => setTemplateOrigin('personal')}
        >
          个人创建<em>{personalCount}</em>
        </button>
      </div>

      <header className="wf-tpl-hero">
        <div className="wf-tpl-hero__main">
          <div className="wf-tpl-hero__eyebrow">
            <Sparkles className="h-3.5 w-3.5" />
            {isPersonal ? '工作区私有 · 可复用草稿' : '平台认证 · 可安全复用'}
          </div>
          <h2 className="wf-tpl-hero__title">{isPersonal ? '个人创建模板' : '平台认证模板'}</h2>
          <p className="wf-tpl-hero__lead">
            {isPersonal
              ? '由当前账号从画布另存，仅本工作区可见。选用后生成可编辑草稿，可继续校验、试运行并发布为流程技能。'
              : filterGroup === 'office'
                ? '面向日常办公：制度问答、会议纪要、周报、请假出差等。配套开箱知识与办公技能，可直接使用。'
                : '覆盖入职、报销、权限、发版等部门场景，以及办公通用流程。选用后生成可编辑草稿，配置连接并校验通过后即可发布为流程技能。'}
          </p>
          <ol className="wf-tpl-steps" aria-label="使用路径">
            {(isPersonal
              ? ['画布编排', '存为个人模板', '再次使用', '发布技能']
              : ['选用模板', '配置连接', '校验试运行', '发布技能']
            ).map((label, index) => (
              <li key={label} className="wf-tpl-steps__item">
                {index > 0 && <span className="wf-tpl-steps__sep" aria-hidden="true" />}
                <span className="wf-tpl-steps__num">{index + 1}</span>
                <span className="wf-tpl-steps__label">{label}</span>
              </li>
            ))}
          </ol>
        </div>
        <aside className="wf-tpl-hero__aside" aria-label="库说明">
          <div className="wf-tpl-stat">
            <strong>{visibleTemplates.length}</strong>
            <span>当前可见</span>
          </div>
          <div className="wf-tpl-stat">
            <strong>{readyCount}</strong>
            <span>可直接使用</span>
          </div>
          <div className="wf-tpl-stat">
            <strong>{reviewCount}</strong>
            <span>需先授权</span>
          </div>
          <p className="wf-tpl-hero__note">
            {isPersonal
              ? '个人模板不会覆盖平台内置包；删除仅影响自己创建的条目。可在画布页点击「存为个人模板」。'
              : '源模板只读；运维类剧本请打开「IT 高级库」。创建隔离草稿后不会覆盖现有画布版本。'}
          </p>
        </aside>
      </header>

      <div className="wf-tpl-toolbar">
        <div className="wf-tpl-toolbar__depts" role="group" aria-label="按部门筛选">
          {DEPARTMENT_OPTIONS.map((g) => {
            const count = g.key === 'all'
              ? visibleTemplates.length
              : visibleTemplates.filter((t) => t.department === g.key).length;
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => setFilterGroup(g.key)}
                className={cn('wf-tpl-dept', filterGroup === g.key && 'is-active')}
              >
                {g.label}
                {g.key !== 'all' && count > 0 && <em>{count}</em>}
              </button>
            );
          })}
        </div>
        <div className="wf-tpl-toolbar__filters">
          <div className="wf-tpl-search">
            <Search className="h-3.5 w-3.5" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索流程名称、适用对象或连接能力"
              aria-label="搜索模板"
            />
          </div>
          {!isPersonal && (
            <select
              value={filterIndustry}
              onChange={(e) => setFilterIndustry(e.target.value)}
              className="wf-tpl-select"
              aria-label="行业筛选"
            >
              {INDUSTRY_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          )}
          <div className="wf-tpl-seg" role="group" aria-label="就绪状态">
            {([['all', '全部'], ['healthy', '可直接使用'], ['review', '需先授权']] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setScope(key)} className={cn(scope === key && 'is-active')}>{label}</button>
            ))}
          </div>
          {!isPersonal && (
            <>
              <button
                type="button"
                onClick={() => setWorkspaceDeptOnly(!workspaceDeptOnly)}
                className={cn('wf-tpl-toggle', workspaceDeptOnly && 'is-on')}
                title={workspaceDeptCount ? `当前工作区伙伴覆盖 ${workspaceDeptCount} 个部门` : '当前工作区暂无部门伙伴，将展示全部'}
              >
                仅本工作区部门
              </button>
              <button
                type="button"
                onClick={() => setShowAdvancedLibrary(!showAdvancedLibrary)}
                className={cn('wf-tpl-toggle', showAdvancedLibrary && 'is-warn')}
              >
                IT 高级库
              </button>
            </>
          )}
        </div>
      </div>

      {visibleTemplates.length === 0 ? (
        <div className="wf-tpl-empty">
          <Layers className="h-8 w-8 text-[var(--text-muted)]" />
          <p className="wf-tpl-empty__title">{isPersonal ? '还没有个人模板' : '没有符合条件的模板'}</p>
          <p className="wf-tpl-empty__desc">
            {isPersonal
              ? '在画布编排流程后，点击「存为个人模板」，即可在此复用。'
              : '可切换部门或行业，关闭「仅本工作区部门」，或打开「IT 高级库」。'}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {isPersonal ? (
              canWrite && <Button size="sm" onClick={onSaveFromCanvas}>去画布另存</Button>
            ) : (
              <>
                <Button size="sm" variant="secondary" onClick={() => { setFilterGroup('all'); setFilterIndustry('all'); setScope('all'); setQuery(''); setWorkspaceDeptOnly(false); }}>重置筛选</Button>
                {!showAdvancedLibrary && <Button size="sm" onClick={() => setShowAdvancedLibrary(true)}>打开 IT 高级库</Button>}
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="wf-tpl-pagebar">
            <span>
              {filterGroup === 'all' ? '全部部门统一列表' : `${departmentLabel(filterGroup)} · 统一列表`}
              {' · '}
              第 {rangeStart}–{rangeEnd} 项，共 {totalCount} 个模板 · 每页 {TPL_PAGE_SIZE} 个
            </span>
          </div>

          <div className="wf-tpl-grid">
            {pagedFlat.map((t) => renderCard(t, Boolean(t.parentId)))}
          </div>

          {totalPages > 1 && (
            <nav className="wf-tpl-pager" aria-label="模板分页">
              <Button size="sm" variant="secondary" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                上一页
              </Button>
              <div className="wf-tpl-pager__pages">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={cn('wf-tpl-pager__btn', n === safePage && 'is-active')}
                    onClick={() => setPage(n)}
                    aria-current={n === safePage ? 'page' : undefined}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="secondary" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                下一页
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

/* =============================================================
 *  模板预览弹窗
 * ============================================================= */
function TemplatePreviewModal({
  template, onClose, showToast, onUseTemplate,
}: {
  template: WorkflowTemplateAsset | null;
  onClose: () => void;
  showToast: (msg: string, tone?: 'success' | 'error' | 'info') => void;
  onUseTemplate: (template: WorkflowTemplateAsset) => void;
}) {
  if (!template) return null;
  return <TemplatePreviewModalInner template={template} onClose={onClose} showToast={showToast} onUseTemplate={onUseTemplate} />;
}

function TemplatePreviewModalInner({
  template, onClose, showToast, onUseTemplate,
}: {
  template: WorkflowTemplateAsset;
  onClose: () => void;
  showToast: (msg: string, tone?: 'success' | 'error' | 'info') => void;
  onUseTemplate: (template: WorkflowTemplateAsset) => void;
}) {
  const [zoom, setZoom] = useState(0.7);
  const previewSeq = template.sequence;
  const categoryStyle = template.category === 'business'
    ? 'bg-[var(--info-bg)] text-[var(--info)]'
    : template.category === 'system'
      ? 'bg-[var(--success-bg)] text-[var(--success)]'
      : template.category === 'security'
        ? 'bg-[var(--danger-bg)] text-[var(--danger)]'
        : 'bg-[var(--brand-light)] text-[var(--brand)]';
  const categoryName = template.departmentLabel || categoryLabel(template.category);
  const governanceChecks = template.risk === 'L3' ? 4 : template.risk === 'L2' ? 3 : 2;
  const reusable = isTemplateReusable(template);
  const mid = Math.ceil(previewSeq.length / 2);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-preview-title"
        className="flex h-[min(860px,calc(100%-32px))] w-[min(1240px,calc(100%-32px))] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface-1)] px-6 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset ring-black/[0.03]', categoryStyle)}><Sparkles className="h-4 w-4" /></div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="template-preview-title" className="truncate text-base font-semibold tracking-[-0.01em] text-[var(--text)]">{template.name}</h2>
                <span className="rounded-md bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--text-muted)]">{template.version}</span>
                <Badge tone={reusable ? 'success' : 'warn'} className="text-[9px]">{template.health}</Badge>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">{template.id}</span>
              </div>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{categoryName} · {template.description}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭模板预览" className="grid h-8 w-8 place-items-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><X className="h-4 w-4" /></button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--bg-elevated)]">
          <div className="mx-auto w-full max-w-[1180px] space-y-5 p-6">
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-5 py-4">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">模板概览</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
                  <span>{template.nodes} 个编排节点</span>
                  <span className="hidden h-3 w-px bg-[var(--border)] sm:block" />
                  <span>{governanceChecks} 项治理检查</span>
                  <span className="hidden h-3 w-px bg-[var(--border)] sm:block" />
                  <span>维护团队：{template.owner}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={template.risk === 'L3' ? 'warn' : template.risk === 'L2' ? 'info' : 'success'} className="text-[9px]">{template.risk} 风险</Badge>
                <span className="text-[11px] text-[var(--text-muted)]">最近验证 {template.verifiedAt}</span>
              </div>
            </section>

            {!reusable && (
              <section className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-bg)] px-5 py-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--warning)]"><AlertTriangle className="h-4 w-4" />创建后可配置，但试运行与发布将被阻断</div>
                <ul className="mt-2 space-y-1 text-[11px] leading-5 text-[var(--text-secondary)]">
                  {template.blockers.map((item) => <li key={item}>• {item}</li>)}
                </ul>
              </section>
            )}

            <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-1)]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text)]">流程结构</h3>
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">只读预览：触发 → 研判/策略 → 双重审批 → 执行/补偿 → 审计留痕</p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))} aria-label="缩小流程预览">−</button>
                  <span className="w-10 text-center font-mono text-[10px] text-[var(--text-muted)]">{Math.round(zoom * 100)}%</span>
                  <button type="button" className="grid h-7 w-7 place-items-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" onClick={() => setZoom((z) => Math.min(1.2, z + 0.1))} aria-label="放大流程预览">+</button>
                </div>
              </div>
              <div className="overflow-x-auto bg-[var(--bg-elevated)] p-5">
                <div className="flex min-h-[220px] min-w-max flex-col justify-center gap-4 rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-1)] px-6 py-5">
                  <div className="flex items-center gap-3" style={{ transform: `scale(${zoom})`, transformOrigin: 'left center' }}>
                    {previewSeq.slice(0, mid).map((kind, index) => {
                      const Icon = NODE_ICONS[kind];
                      const color = NODE_COLORS[kind];
                      const isGovernance = ['policy', 'approval', 'audit', 'compensate'].includes(kind);
                      return (
                        <div key={`a-${kind}-${index}`} className="flex items-center gap-3">
                          <div className="w-[132px] rounded-xl border bg-[var(--surface-1)] px-3 py-3 text-center" style={{ borderColor: color }}>
                            <div className="mb-2 flex items-center justify-between">
                              <span className="font-mono text-[9px] text-[var(--text-muted)]">{String(index + 1).padStart(2, '0')}</span>
                              {isGovernance && <ShieldCheck className="h-3.5 w-3.5" style={{ color }} />}
                            </div>
                            <Icon className="mx-auto h-4 w-4" style={{ color }} />
                            <div className="mt-1.5 text-[9px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{kind}</div>
                            <div className="mt-0.5 text-xs font-semibold text-[var(--text)]">{NODE_LABELS[kind]}</div>
                          </div>
                          {index < mid - 1 && <ChevronRight className="h-4 w-4 shrink-0 text-[var(--border-strong)]" />}
                        </div>
                      );
                    })}
                  </div>
                  {previewSeq.length > mid && (
                    <div className="flex items-center gap-3 pl-8" style={{ transform: `scale(${zoom})`, transformOrigin: 'left center' }}>
                      <span className="text-[10px] font-medium text-[var(--text-muted)]">续</span>
                      {previewSeq.slice(mid).map((kind, index) => {
                        const Icon = NODE_ICONS[kind];
                        const color = NODE_COLORS[kind];
                        const isGovernance = ['policy', 'approval', 'audit', 'compensate'].includes(kind);
                        return (
                          <div key={`b-${kind}-${index}`} className="flex items-center gap-3">
                            <div className="w-[132px] rounded-xl border bg-[var(--surface-1)] px-3 py-3 text-center" style={{ borderColor: color }}>
                              <div className="mb-2 flex items-center justify-between">
                                <span className="font-mono text-[9px] text-[var(--text-muted)]">{String(mid + index + 1).padStart(2, '0')}</span>
                                {isGovernance && <ShieldCheck className="h-3.5 w-3.5" style={{ color }} />}
                              </div>
                              <Icon className="mx-auto h-4 w-4" style={{ color }} />
                              <div className="mt-1.5 text-[9px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{kind}</div>
                              <div className="mt-0.5 text-xs font-semibold text-[var(--text)]">{NODE_LABELS[kind]}</div>
                            </div>
                            {index < previewSeq.length - mid - 1 && <ChevronRight className="h-4 w-4 shrink-0 text-[var(--border-strong)]" />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text)]"><CheckCircle2 className="h-4 w-4 text-[var(--success)]" />验证与维护</div>
                <div className="mt-3 text-sm font-semibold text-[var(--text)]">{template.successRate}</div>
                <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">最近验证成功率 · {template.verifiedAt}</p>
                <p className="mt-3 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--text-secondary)]">由 {template.owner} 维护</p>
                {template.changelog[0] && <p className="mt-2 text-[10px] text-[var(--text-muted)]">变更：{template.changelog[0].version} · {template.changelog[0].note}</p>}
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text)]"><Box className="h-4 w-4 text-[var(--info)]" />依赖就绪度</div>
                  <Badge tone={reusable ? 'success' : 'warn'} className="text-[9px]">{template.health}</Badge>
                </div>
                <div className="mt-3 space-y-2">
                  {template.dependencyStatus.map((dependency) => (
                    <div key={dependency.name} className="flex items-start gap-2 text-[11px] text-[var(--text-secondary)]">
                      {dependency.status === 'ready'
                        ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--success)]" />
                        : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />}
                      <span>{dependency.name}{dependency.status === 'unauthorized' ? ` · ${dependency.reason ?? '未授权'}` : ' · 已就绪'}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className={cn('rounded-xl border p-4', template.risk === 'L3' ? 'border-[var(--warning)]/30 bg-[var(--warning-bg)]' : 'border-[var(--info)]/25 bg-[var(--info-bg)]')}>
                <div className={cn('flex items-center gap-2 text-xs font-semibold', template.risk === 'L3' ? 'text-[var(--warning)]' : 'text-[var(--info)]')}><ShieldCheck className="h-4 w-4" />{template.risk} 治理门禁</div>
                <p className="mt-2 text-[11px] leading-5 text-[var(--text-secondary)]">创建隔离草稿后进入编排；外部执行前需完成依赖授权、双重审批、审计留痕与补偿校验。未发布流程技能不可被数字伙伴调用。</p>
              </div>
            </section>

            <section className="grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
                <div className="mb-2 text-xs font-semibold text-[var(--text)]">变量映射</div>
                <div className="space-y-1.5">
                  {template.variables.length ? template.variables.map((item) => (
                    <div key={item.key} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono text-[var(--text-secondary)]">{item.key}</span>
                      <span className="text-[var(--text-muted)]">{item.label}{item.required ? ' · 必填' : ''}</span>
                    </div>
                  )) : <div className="text-[11px] text-[var(--text-muted)]">无额外变量</div>}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
                <div className="mb-2 text-xs font-semibold text-[var(--text)]">权限门禁</div>
                <div className="space-y-1.5">
                  {template.permissions.length ? template.permissions.map((item) => (
                    <div key={item.action} className="text-[11px] text-[var(--text-secondary)]">
                      <span className="font-medium text-[var(--text)]">{item.action}</span>
                      <span className="text-[var(--text-muted)]"> · {item.gate}</span>
                    </div>
                  )) : <div className="text-[11px] text-[var(--text-muted)]">无额外权限项</div>}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
                <div className="mb-2 text-xs font-semibold text-[var(--text)]">最近验证运行</div>
                <div className="space-y-1.5">
                  {template.recentRuns.length ? template.recentRuns.map((run) => (
                    <div key={run.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono text-[var(--text-muted)]">{run.id}</span>
                      <Badge tone={run.status === 'success' ? 'success' : 'error'} className="text-[9px]">{run.status === 'success' ? '通过' : '失败'}</Badge>
                    </div>
                  )) : <div className="text-[11px] text-[var(--text-muted)]">暂无验证记录</div>}
                </div>
              </div>
            </section>
          </div>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface-1)] px-6 py-3.5">
          <div className="text-[11px] text-[var(--text-muted)]">
            {reusable
              ? '创建后将另存为隔离草稿，不影响当前工作流；可继续校验与试运行。'
              : '可创建隔离草稿用于配置，但依赖未授权前禁止试运行与发布。'}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>取消</Button>
            <Button size="sm" onClick={() => { onUseTemplate(template); onClose(); }}><Download className="h-3.5 w-3.5" />使用模板</Button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function HistoryView({
  showToast,
  workflowId,
  canExecute,
  focusRunId,
  onFocusConsumed,
  onGoCanvas,
}: {
  showToast: (msg: string, tone?: 'success' | 'error' | 'info') => void;
  workflowId: string;
  canExecute: boolean;
  focusRunId?: string | null;
  onFocusConsumed?: () => void;
  onGoCanvas?: () => void;
}) {
  const { data: runs = [], refetch, isLoading } = useApiQuery<WorkflowRunRecord[]>(['workflow-runs'], '/api/workflow-runs');
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mobileReplayOpen, setMobileReplayOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed' | 'running'>('all');
  const [page, setPage] = useState(1);
  const retryRunApi = useApiMutation<WorkflowRunRecord, { id: string; workflowId: string }>(
    (vars) => `/api/workflows/${vars.workflowId}/runs/${vars.id}/retry`,
    {
      onSuccess: (run) => {
        showToast(`已创建重试尝试 ${run.id}`, 'success');
        setSelectedRunId(run.id);
        refetch();
      },
      onError: (err) => {
        const message = err instanceof Error ? err.message : '重试请求失败，请检查权限或运行状态';
        showToast(message.replace(/^E_[A-Z_]+:\s*/, ''), 'error');
      },
    },
  );

  useEffect(() => {
    if (focusRunId) {
      setSelectedRunId(focusRunId);
      onFocusConsumed?.();
      return;
    }
    if (!selectedRunId && runs[0]) setSelectedRunId(runs[0].id);
  }, [focusRunId, onFocusConsumed, runs, selectedRunId]);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? runs[0];
  const replaySteps = selectedRun?.nodeSteps?.length
    ? selectedRun.nodeSteps
    : Array.from({ length: selectedRun?.steps ?? 0 }, (_, index) => ({
        id: `synthetic-${index + 1}`,
        label: `步骤 ${index + 1}`,
        status: 'pending' as const,
      }));
  const hasRecordedEvidence = selectedRun?.evidenceMode === 'recorded' && Boolean(selectedRun.nodeSteps?.length);
  const totalSteps = replaySteps.length;
  const successCount = runs.filter((run) => run.status === 'success').length;
  const failedCount = runs.filter((run) => run.status === 'failed').length;
  const runningCount = runs.filter((run) => run.status === 'running').length;
  const recordedCount = runs.filter((run) => run.evidenceMode === 'recorded' && Boolean(run.nodeSteps?.length)).length;
  const visibleRuns = runs.filter((run) => (
    (statusFilter === 'all' || run.status === statusFilter)
    && (!query.trim() || `${run.id} ${run.trigger} ${run.who} ${run.revisionId ?? ''} ${run.correlationId ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  ));
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(visibleRuns.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedRuns = visibleRuns.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstItem = visibleRuns.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, visibleRuns.length);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setStep((s) => {
        if (s >= totalSteps) { setPlaying(false); return s; }
        return s + 1;
      });
    }, 800);
    return () => clearInterval(timer);
  }, [playing, totalSteps]);

  useEffect(() => {
    setStep(0);
    setPlaying(false);
  }, [selectedRunId]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter]);

  const openRun = (id: string, mobile = false) => {
    setSelectedRunId(id);
    if (mobile || (typeof window !== 'undefined' && window.matchMedia('(max-width: 1079px)').matches)) {
      setMobileReplayOpen(true);
    }
  };

  const statusLabel = (status: string) => (
    status === 'success' ? '已完成' : status === 'failed' ? '执行失败' : '运行中'
  );

  const renderReplayBody = (embedded = false) => {
    if (!selectedRun) {
      return <div className="wf-history__replay-empty">请选择左侧一条运行记录查看回放</div>;
    }
    return (
      <>
        <div className="wf-history__replay-head">
          {!embedded && <div className="wf-history__replay-kicker">运行回放</div>}
          <h3 className="wf-history__replay-title">{selectedRun.trigger}</h3>
          <div className="wf-history__replay-sub">
            {selectedRun.time} · {selectedRun.who}
            {selectedRun.revisionId ? ` · ${selectedRun.revisionId}` : ''}
            {selectedRun.attempt && selectedRun.attempt > 1 ? ` · 第 ${selectedRun.attempt} 次尝试` : ''}
            {selectedRun.parentRunId ? ` · 源自 ${selectedRun.parentRunId}` : ''}
          </div>
          <div className="wf-history__replay-tags">
            <Badge tone={selectedRun.status === 'success' ? 'success' : selectedRun.status === 'failed' ? 'error' : 'info'}>
              {statusLabel(selectedRun.status)}
            </Badge>
            {selectedRun.environment && <Badge tone="neutral">{selectedRun.environment}</Badge>}
            <Badge tone={hasRecordedEvidence ? 'success' : 'warn'}>
              {hasRecordedEvidence ? '节点快照证据' : '仅有汇总'}
            </Badge>
          </div>
        </div>

        {!hasRecordedEvidence && (
          <div className="wf-history__replay-warn">
            该记录未保存节点快照。下方回放按步骤数占位，不能作为审计逐步证据。
          </div>
        )}

        <div className="wf-history__replay-progress">
          <div className="wf-history__progress-bar" aria-hidden>
            {replaySteps.map((item, i) => {
              const isCompleted = i < step;
              const isCurrent = i === step;
              const failedIndex = selectedRun.nodeSteps?.findIndex((s) => s.status === 'failed') ?? -1;
              const isFailed = item.status === 'failed' || (selectedRun.status === 'failed' && i === (failedIndex >= 0 ? failedIndex : totalSteps - 1));
              return (
                <span
                  key={item.id}
                  style={{
                    background: isFailed && i <= step
                      ? 'var(--danger)'
                      : isCurrent
                        ? 'var(--brand)'
                        : isCompleted
                          ? 'var(--success)'
                          : undefined,
                  }}
                />
              );
            })}
          </div>
          <div className="wf-history__progress-meta">
            <span>当前步骤</span>
            <strong>{Math.min(step, totalSteps)} / {totalSteps}</strong>
          </div>
          {selectedRun.correlationId && (
            <div className="wf-history__corr">correlation: {selectedRun.correlationId}</div>
          )}
        </div>

        <div className="wf-history__steps">
          {replaySteps.map((item, i) => {
            const isDone = i < step;
            const isCurrent = i === step;
            const isFailedStep = item.status === 'failed' || (selectedRun.status === 'failed' && !hasRecordedEvidence && i === totalSteps - 1);
            return (
              <div
                key={item.id}
                className={cn(
                  'wf-history__step',
                  isCurrent && 'is-current',
                  isDone && !isFailedStep && 'is-done',
                  isFailedStep && 'is-failed',
                )}
              >
                <div className="wf-history__step-left">
                  <span className="wf-history__step-index">
                    {isDone && !isFailedStep ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                  </span>
                  <span className="wf-history__step-label">{item.label}</span>
                </div>
                {'kind' in item && item.kind && <span className="wf-history__step-kind">{item.kind}</span>}
                {isFailedStep && <Badge tone="error" className="text-[9px]">失败</Badge>}
              </div>
            );
          })}
          {selectedRun.error && (
            <div className="wf-history__error">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span><span className="font-semibold">异常：</span>{selectedRun.error}</span>
            </div>
          )}
        </div>

        <div className="wf-history__replay-controls">
          <div className="wf-history__transport">
            <button type="button" aria-label="回到开始" onClick={() => { setStep(0); setPlaying(false); }}><SkipBack className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="上一步" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}><StepBack className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label={playing ? '暂停' : '播放'} className="is-primary" onClick={() => setPlaying(!playing)} disabled={step >= totalSteps || totalSteps === 0}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
            <button type="button" aria-label="下一步" onClick={() => setStep((s) => Math.min(totalSteps, s + 1))} disabled={step >= totalSteps}><StepForward className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="跳到结束" onClick={() => { setStep(totalSteps); setPlaying(false); }}><SkipForward className="h-3.5 w-3.5" /></button>
          </div>
          <div className="wf-history__transport-note">单步 / 自动 800ms · {hasRecordedEvidence ? '基于节点快照' : '占位回放'}</div>
        </div>
      </>
    );
  };

  return (
    <div className="wf-history">
      <header className="wf-history__hero">
        <div className="wf-history__hero-main">
          <div className="wf-history__eyebrow"><History className="h-3.5 w-3.5" />执行证据与回放</div>
          <h2 className="wf-history__title">运行记录</h2>
          <p className="wf-history__lead">
            查看每次试运行与正式触发的结果。仅标注「节点快照证据」的记录可逐步回放核对；沙箱试运行成功后会自动聚焦到本页。
          </p>
        </div>
        <div className="wf-history__hero-meta">
          <div className="wf-history__stat"><strong>{isLoading ? '—' : runs.length}</strong><span>全部</span></div>
          <div className="wf-history__stat is-ok"><strong>{successCount}</strong><span>成功</span></div>
          <div className="wf-history__stat is-bad"><strong>{failedCount}</strong><span>失败</span></div>
          <div className="wf-history__stat is-run"><strong>{runningCount}</strong><span>运行中</span></div>
          <div className="wf-history__stat"><strong>{recordedCount}</strong><span>有快照</span></div>
          <Button size="sm" variant="ghost" onClick={onGoCanvas}>返回编排</Button>
        </div>
      </header>

      <div className="wf-history__layout">
        <section className="wf-history__panel" aria-labelledby="wf-history-list-title">
          <div className="wf-history__panel-head">
            <div>
              <h3 id="wf-history-list-title">运行列表</h3>
              <p>流程 <code className="font-mono text-[10px] text-[var(--text-secondary)]">{workflowId}</code> · 当前筛选 {visibleRuns.length} 条</p>
            </div>
          </div>

          <div className="wf-history__toolbar">
            <div className="wf-history__search">
              <Search />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索运行 ID、触发源、执行人或 correlation" />
            </div>
            <div className="wf-history__filters" role="group" aria-label="运行状态">
              {([['all', '全部'], ['success', '成功'], ['failed', '失败'], ['running', '运行中']] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setStatusFilter(key)} className={statusFilter === key ? 'is-active' : undefined}>{label}</button>
              ))}
            </div>
          </div>

          {visibleRuns.length > 0 ? (
            <>
              <div className="wf-history__list">
                {pagedRuns.map((r) => {
                  const recorded = r.evidenceMode === 'recorded' && Boolean(r.nodeSteps?.length);
                  return (
                    <div
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openRun(r.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openRun(r.id);
                        }
                      }}
                      className={cn('wf-history__row', selectedRunId === r.id && 'is-selected')}
                    >
                      <div className="wf-history__row-main">
                        <span className={cn('wf-history__dot', r.status === 'success' ? 'is-success' : r.status === 'failed' ? 'is-failed' : 'is-running')} />
                        <div className="min-w-0">
                          <div className="wf-history__row-title">
                            <strong className="truncate">{r.trigger}</strong>
                            <Badge tone={r.status === 'success' ? 'success' : r.status === 'failed' ? 'error' : 'info'} className="text-[9px]">{statusLabel(r.status)}</Badge>
                            <Badge tone={recorded ? 'success' : 'warn'} className="text-[9px]">{recorded ? '有快照' : '仅汇总'}</Badge>
                          </div>
                          <div className="wf-history__row-meta">
                            <code>{r.id}</code>
                            {r.revisionId && <><span className="wf-history__sep" /><code>{r.revisionId}</code></>}
                            <span className="wf-history__sep" /><span>{r.time}</span>
                            <span className="wf-history__sep" /><span>{r.who}</span>
                            {r.environment && <><span className="wf-history__sep" /><span>{r.environment}</span></>}
                            {r.attempt && r.attempt > 1 && <><span className="wf-history__sep" /><span>第 {r.attempt} 次</span></>}
                          </div>
                          {recorded && r.nodeSteps?.length ? (
                            <div className="wf-history__rail" aria-label="节点快照进度">
                              {r.nodeSteps.map((nodeStep) => (
                                <span
                                  key={nodeStep.id}
                                  className={
                                    nodeStep.status === 'failed' ? 'is-bad'
                                      : nodeStep.status === 'success' ? 'is-ok'
                                        : nodeStep.status === 'skipped' ? 'is-skip'
                                          : 'is-pending'
                                  }
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="mt-2 text-[10px] text-[var(--text-muted)]">{r.steps} 步 · 无节点快照</div>
                          )}
                        </div>
                      </div>

                      <div className="wf-history__metrics">
                        <div><div>耗时</div><strong>{r.status === 'running' ? '处理中' : `${r.duration}s`}</strong></div>
                        <div><div>步骤</div><strong>{r.steps}</strong></div>
                      </div>

                      <div className="wf-history__actions">
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openRun(r.id, true); }}><Eye className="h-3 w-3" />回放</Button>
                        {r.status === 'failed' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!canExecute}
                            title={canExecute ? undefined : '缺少 workflow.execute 权限'}
                            onClick={(e) => {
                              e.stopPropagation();
                              retryRunApi.mutate({ id: r.id, workflowId: r.workflowId ?? workflowId });
                            }}
                            loading={retryRunApi.isPending}
                          >
                            <RotateCcw className="h-3 w-3" />重跑
                          </Button>
                        )}
                      </div>

                      {r.error && (
                        <div className="wf-history__error">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span><span className="font-semibold">异常：</span>{r.error}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="wf-history__footer">
                <span>显示第 {firstItem}–{lastItem} 条，共 {visibleRuns.length} 条</span>
                <nav className="wf-history__pager" aria-label="运行记录分页">
                  <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="上一页"><ChevronLeft className="h-3.5 w-3.5" /></button>
                  {Array.from({ length: pageCount }, (_, index) => index + 1).map((item) => (
                    <button key={item} type="button" onClick={() => setPage(item)} className={item === currentPage ? 'is-current' : undefined} aria-current={item === currentPage ? 'page' : undefined}>{item}</button>
                  ))}
                  <button type="button" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} aria-label="下一页"><ChevronRight className="h-3.5 w-3.5" /></button>
                </nav>
              </div>
            </>
          ) : (
            <div className="wf-history__empty">
              <strong>{isLoading ? '正在加载运行记录…' : '没有符合条件的运行记录'}</strong>
              {!isLoading && (
                <>
                  <span>可调整筛选，或回到画布发起一次沙箱试运行。</span>
                  <Button size="sm" variant="secondary" onClick={onGoCanvas}>返回编排</Button>
                </>
              )}
            </div>
          )}
        </section>

        <aside className="wf-history__panel wf-history__replay" aria-label="运行回放">
          {renderReplayBody()}
        </aside>
      </div>

      <Drawer
        open={mobileReplayOpen}
        onClose={() => setMobileReplayOpen(false)}
        title="运行回放"
        description={selectedRun ? `${selectedRun.trigger} · ${selectedRun.time} · ${selectedRun.who}` : '未选择运行'}
        width={520}
      >
        <div className="flex min-h-[60vh] flex-col">
          {renderReplayBody(true)}
        </div>
      </Drawer>
    </div>
  );
}


function Mini({ label, value, tone }: { label: string; value: any; tone?: 'warn' }) {
  return (
    <div>
      <div className="text-[9px] text-[var(--text-muted)] uppercase">{label}</div>
      <div className={cn('text-[11px] font-mono font-semibold', tone === 'warn' ? 'text-amber-500' : 'text-[var(--text)]')}>{value}</div>
    </div>
  );
}
