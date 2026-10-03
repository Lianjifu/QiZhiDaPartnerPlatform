/**
 * 知识中心共享类型 / 常量 / 小组件（M07 P1 拆分）。
 *
 * 原 pages/Knowledge.tsx 中跨 tab 复用的小部件 + KB_TYPE_OPTIONS / PIPELINE
 * / OWNER_LABEL 常量集中到本文件；表单小工具 `Field` 沿用 ConnectSourceModal 样式。
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { KnowledgeDoc } from '@qzda/web-types';
import { Brain, FileText, Layers, Search, Upload } from 'lucide-react';
import { cn } from '@qzda/web-utils';

/** 文档分类选项，与 mock 数据 + 后端一致；保持选项顺序以避免重构造成 UI 抖动。 */
export const KB_TYPE_OPTIONS = ['Runbook', 'CMDB', 'CVE', 'SIEM', 'Postmortem', '变更方案', '合规文档'];

/** 内容文档列表每页条数，与原 pages/Knowledge.tsx 保持一致。 */
export const CONTENT_PAGE_SIZE = 10;

const OWNER_LABEL: Record<string, string> = { u1: '平台管理员', u2: '业务构建者', u3: '合规审计员' };

/** 从文档标题里解析版本号；解析失败回退 `v1.0`。 */
export function docVersionFromTitle(title: string) {
  return title.match(/v[\d.]+/i)?.[0] ?? 'v1.0';
}

/** 把 ownerId 映射成中文角色文案；找不到则回退「未指定」。 */
export function docOwnerLabel(doc: KnowledgeDoc) {
  return OWNER_LABEL[doc.ownerId ?? 'u1'] ?? '未指定';
}

/** 知识流水线阶段定义，复用于 ProcessingTab + 检索面板。 */
export const PIPELINE: Array<{
  key: string;
  label: string;
  icon: LucideIcon;
  capability: string;
  target: 'sources' | 'jobs' | 'retrieval';
}> = [
  { key: 'ingest', label: '接入', icon: Upload, capability: 'Tika + PaddleOCR', target: 'sources' },
  { key: 'chunk', label: '切片', icon: FileText, capability: '512 tokens · 64 overlap', target: 'jobs' },
  { key: 'embed', label: '向量化', icon: Brain, capability: 'BGE-M3 · 1024 维', target: 'jobs' },
  { key: 'index', label: '索引', icon: Layers, capability: 'Milvus HNSW', target: 'jobs' },
  { key: 'retrieve', label: '检索', icon: Search, capability: 'Top-K=8 + Rerank', target: 'retrieval' },
];

/** 紧凑表单字段：与 ConnectSourceModal 内的 Field 样式一致。 */
export function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
        {label}{required && <span className="text-[var(--danger)]"> *</span>}
      </label>
      {children}
    </div>
  );
}

/** 文档详情侧栏的质量条（综合/完整度/时效性/引用正确率）。 */
export function QualityBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-[var(--text-muted)]">{label}</span>
        <span className="font-mono font-semibold text-[var(--text)]">{value == null ? '—' : `${value}%`}</span>
      </div>
      {value != null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
          <div className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
        </div>
      )}
    </div>
  );
}

/** 检索面板的评测指标卡（颜色 tone 由外部传入）。 */
export function EvalCard({ label, value, tone }: { label: string; value: string; tone: 'success' | 'info' | 'primary' | 'purple' }) {
  const color = tone === 'success' ? 'text-[var(--success)]' : tone === 'info' ? 'text-[var(--info)]' : tone === 'primary' ? 'text-[var(--brand)]' : 'text-[var(--purple)]';
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-2">
      <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
      <div className={cn('text-sm font-bold font-mono', color)}>{value}</div>
    </div>
  );
}

/** 评测摘要里的小指标单元（Recall@K / MRR / nDCG / ...）。 */
export function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <small className="block truncate text-[var(--text-muted)]">{label}</small>
      <strong className="mt-0.5 block font-mono text-[11px]">{value}</strong>
    </span>
  );
}