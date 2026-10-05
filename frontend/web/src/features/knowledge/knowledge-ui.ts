import type { KnowledgePackageStatus, KnowledgeRetrievalResult } from '@qzda/web-types';

export type DisplaySourceStatus = 'healthy' | 'syncing' | 'attention';

export interface NormalizedEvalMetrics {
  recall: number | null;
  precision: number | null;
  p95Latency: number | null;
  hitRate: number | null;
  citationAccuracy: number | null;
}

export interface DocQualityFields {
  completeness?: number;
  freshness?: number;
  citationAccuracy?: number;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

/** Normalize eval metrics from API; recallAtK (0–1) fills recall when recall is absent. */
export function normalizeEvalMetrics(raw: unknown): NormalizedEvalMetrics | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  let recall = readNumber(record.recall);
  if (recall == null) {
    const recallAtK = readNumber(record.recallAtK);
    if (recallAtK != null) recall = recallAtK <= 1 ? recallAtK * 100 : recallAtK;
  }

  return {
    recall,
    precision: readNumber(record.precision),
    p95Latency: readNumber(record.p95Latency),
    hitRate: readNumber(record.hitRate),
    citationAccuracy: readNumber(record.citationAccuracy),
  };
}

/** Map backend retrieve payloads (docId/title/snippet) to UI chunk shape. */
export function normalizeRetrievalResults(raw: unknown): KnowledgeRetrievalResult[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, index) => {
    const record = item as Record<string, unknown>;
    const idx = readNumber(record.idx) ?? index + 1;
    const docId = String(record.docId ?? record.id ?? `chunk-${index + 1}`);
    const source = String(record.source ?? record.title ?? docId);
    const text = String(record.text ?? record.snippet ?? '');
    const score = readNumber(record.score) ?? 0;
    const page = readNumber(record.page);
    return {
      idx,
      source,
      text,
      score,
      docId,
      page,
    };
  });
}

/** Backend may emit `ready`; UI treats it as healthy. */
export function normalizeSourceStatus(status: unknown): DisplaySourceStatus {
  const normalized = String(status ?? '').toLowerCase();
  if (normalized === 'healthy' || normalized === 'ready') return 'healthy';
  if (normalized === 'syncing') return 'syncing';
  return 'attention';
}

/** KPI primary value for retrieval health. */
export function formatHealthPercent(metrics: NormalizedEvalMetrics | null | undefined): string {
  if (!metrics || metrics.recall == null) return '暂无评测';
  return `${Math.round(metrics.recall)}%`;
}

export function formatHealthLatencySub(metrics: NormalizedEvalMetrics | null | undefined): string {
  if (!metrics || metrics.p95Latency == null) return '—';
  return `${metrics.p95Latency}ms P95`;
}

export function formatEvalPercent(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${Math.round(value)}%`;
}

export function formatEvalMs(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value}ms`;
}

export function docQualityBarValue(value: number | undefined | null): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return value;
}

export function formatDocQualityAverage(quality: DocQualityFields | undefined | null): string {
  if (!quality) return '—';
  const values = [quality.completeness, quality.freshness, quality.citationAccuracy]
    .filter((item): item is number => typeof item === 'number' && !Number.isNaN(item));
  if (!values.length) return '—';
  return `${Math.round(values.reduce((total, item) => total + item, 0) / values.length)}%`;
}

const PACKAGE_STATUS_LABEL: Record<KnowledgePackageStatus, string> = {
  draft: '草稿',
  review: '加工中',
  published: '已发布',
  deprecated: '已废弃',
  archived: '已归档',
};

export const PACKAGE_LIFECYCLE_STEPS = [
  { key: 'info', index: '01', label: '基本信息', hint: '名称、分级与说明' },
  { key: 'members', index: '02', label: '添加内容', hint: '上传文件或接入来源' },
  { key: 'processing', index: '03', label: '加工处理', hint: '切片并建立索引' },
  { key: 'eval', index: '04', label: '检索验证', hint: '用问题检查召回质量' },
  { key: 'graph', index: '05', label: '知识图谱', hint: '看实体与关联' },
  { key: 'versions', index: '06', label: '发布上线', hint: '版本供伙伴引用' },
] as const;

export type KnowledgePackageStep = (typeof PACKAGE_LIFECYCLE_STEPS)[number]['key'];

export function packageStatusLabel(status: KnowledgePackageStatus | string | undefined): string {
  if (!status) return '未知';
  return PACKAGE_STATUS_LABEL[status as KnowledgePackageStatus] ?? String(status);
}

export function packageStatusTone(status: KnowledgePackageStatus | string | undefined): 'success' | 'warn' | 'neutral' | 'error' | 'info' {
  if (status === 'published') return 'success';
  if (status === 'review') return 'warn';
  if (status === 'deprecated' || status === 'archived') return 'error';
  return 'neutral';
}

/** Bump patch for semver-like strings (`v3.2` / `3.1.0` / `0.1.0`). */
export function bumpPackageVersion(version: string | undefined | null): string {
  const raw = String(version ?? '0.1.0').trim();
  const prefix = raw.startsWith('v') || raw.startsWith('V') ? raw[0] : '';
  const body = prefix ? raw.slice(1) : raw;
  const parts = body.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.some((n) => Number.isNaN(n))) {
    return `${prefix || ''}${body || '0.1'}.1`;
  }
  while (parts.length < 3) parts.push(0);
  parts[parts.length - 1] += 1;
  return `${prefix}${parts.join('.')}`;
}

export function packageReadyToPublish(input: {
  status?: KnowledgePackageStatus | string;
  documentCount?: number;
  documentIds?: string[];
}): { ok: boolean; reason?: string } {
  const count = input.documentIds?.length ?? input.documentCount ?? 0;
  if (count <= 0) return { ok: false, reason: '请先纳管至少一篇文档' };
  if (input.status === 'archived' || input.status === 'deprecated') {
    return { ok: false, reason: '已归档/废弃的知识包不可直接发布' };
  }
  return { ok: true };
}
