/**
 * MemoryShared — 常量、helper、Row 展示组件(被 MemoryPage + 各 Tab 复用)。
 * M07 P1 拆分原因:原 pages/Memory.tsx 单文件 1043L。
 */
import { Archive, BrainCircuit, Clock3, FileUp, Layers3, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { MemoryLayer, MemoryPolicy, MemoryRecord, MemoryStatus } from '@qzda/web-types';

export type MemoryTabKey = 'overview' | 'short_term' | 'working' | 'long_term' | 'candidates' | 'governance';
export type MemoryStatusFilter = 'active' | 'all' | MemoryStatus;

export const MEMORY_TABS: Array<{ key: MemoryTabKey; labelKey: string; icon: LucideIcon }> = [
  { key: 'overview', labelKey: 'module.memory.tabs.overview', icon: BrainCircuit },
  { key: 'short_term', labelKey: 'module.memory.tabs.shortTerm', icon: Clock3 },
  { key: 'working', labelKey: 'module.memory.tabs.working', icon: Layers3 },
  { key: 'long_term', labelKey: 'module.memory.tabs.longTerm', icon: Archive },
  { key: 'candidates', labelKey: 'module.memory.tabs.candidates', icon: FileUp },
  { key: 'governance', labelKey: 'module.memory.tabs.governance', icon: ShieldCheck },
];

export const MEMORY_LAYER: Record<MemoryLayer, { label: string; tone: 'brand' | 'warn' | 'success'; desc: string }> = {
  short_term: { label: '短期', tone: 'brand', desc: '单次会话上下文，按 TTL 自动清除' },
  working: { label: '工作', tone: 'warn', desc: '任务与工作流过程证据，随执行生命周期归档' },
  long_term: { label: '长期', tone: 'success', desc: '可复用经验，必须审核后才能转为知识' },
};

export const MEMORY_CLASSIFICATION_LABEL: Record<MemoryRecord['classification'], string> = {
  internal: '内部',
  confidential: '机密',
  restricted: '受限',
};

export const MEMORY_STATUS_LABEL: Record<MemoryStatus, string> = {
  active: '生效中',
  pending_review: '待审',
  expired: '已失效',
  revoked: '已撤销',
  promoted: '已晋升',
};

export const MEMORY_SCOPE_LABEL: Record<MemoryRecord['scope'], string> = {
  user: '个人',
  team: '团队',
  workspace: '工作区',
  agent: '数字伙伴',
};

export const MEMORY_SOURCE_LABEL: Record<MemoryRecord['sourceType'], string> = {
  conversation: '会话',
  task: '任务',
  workflow: '工作流',
  manual: '手工',
};

export const MEMORY_LAYER_TAB: Record<MemoryLayer, MemoryTabKey> = {
  short_term: 'short_term',
  working: 'working',
  long_term: 'long_term',
};

export function memorySourcePath(record: MemoryRecord): string | null {
  if (record.sourceType === 'task') return '/tasks';
  if (record.sourceType === 'workflow') return '/workflows';
  if (record.sourceType === 'conversation') {
    return record.digitalPartnerId ? `/copilot?employeeId=${record.digitalPartnerId}` : '/copilot';
  }
  return null;
}

export function memoryFormatTime(value?: string): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function memoryFormatFullTime(value?: string): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN');
}

export function memoryCapacityRatio(policy?: Pick<MemoryPolicy, 'usedCapacity' | 'longTermCapacity'>): number {
  const capacity = policy?.longTermCapacity ?? 0;
  if (!capacity) return 0;
  return (policy?.usedCapacity ?? 0) / capacity;
}

export function MemoryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="memory-kv">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
