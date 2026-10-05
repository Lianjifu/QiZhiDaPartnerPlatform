import { describe, expect, it } from 'vitest';
import {
  docQualityBarValue,
  formatDocQualityAverage,
  formatEvalMs,
  formatEvalPercent,
  formatHealthLatencySub,
  formatHealthPercent,
  normalizeEvalMetrics,
  normalizeRetrievalResults,
  normalizeSourceStatus,
  bumpPackageVersion,
  packageReadyToPublish,
  packageStatusLabel,
  PACKAGE_LIFECYCLE_STEPS,
} from './knowledge-ui';

describe('knowledge-ui', () => {
  it('normalizes eval metrics with recall percent or recallAtK fallback', () => {
    expect(normalizeEvalMetrics({ recall: 91, precision: 87, p95Latency: 280, hitRate: 40 })).toEqual({
      recall: 91,
      precision: 87,
      p95Latency: 280,
      hitRate: 40,
      citationAccuracy: null,
    });
    expect(normalizeEvalMetrics({ recallAtK: 0.86, p95Latency: 410 })).toEqual({
      recall: 86,
      precision: null,
      p95Latency: 410,
      hitRate: null,
      citationAccuracy: null,
    });
    expect(normalizeEvalMetrics(null)).toBeNull();
  });

  it('formats retrieval health KPI without fake defaults', () => {
    expect(formatHealthPercent(null)).toBe('暂无评测');
    expect(formatHealthPercent(normalizeEvalMetrics({ recall: 92.4 }))).toBe('92%');
    expect(formatHealthLatencySub(normalizeEvalMetrics({ p95Latency: 320 }))).toBe('320ms P95');
    expect(formatHealthLatencySub(null)).toBe('—');
    expect(formatEvalPercent(undefined)).toBe('—');
    expect(formatEvalMs(undefined)).toBe('—');
  });

  it('maps alternate retrieve result fields to chunk shape', () => {
    expect(normalizeRetrievalResults([
      { docId: 'k1', title: 'Redis Runbook', snippet: 'flush memory', score: 0.91 },
      { idx: 2, source: 'CVE', text: 'known issue', score: 0.75, docId: 'k3' },
    ])).toEqual([
      { idx: 1, source: 'Redis Runbook', text: 'flush memory', score: 0.91, docId: 'k1', page: null },
      { idx: 2, source: 'CVE', text: 'known issue', score: 0.75, docId: 'k3', page: null },
    ]);
  });

  it('treats backend ready source status as healthy', () => {
    expect(normalizeSourceStatus('ready')).toBe('healthy');
    expect(normalizeSourceStatus('healthy')).toBe('healthy');
    expect(normalizeSourceStatus('syncing')).toBe('syncing');
    expect(normalizeSourceStatus('attention')).toBe('attention');
  });

  it('shows dashes for missing doc quality instead of fake defaults', () => {
    expect(formatDocQualityAverage(undefined)).toBe('—');
    expect(formatDocQualityAverage({ completeness: 96, freshness: 92 })).toBe('94%');
    expect(docQualityBarValue(undefined)).toBeNull();
    expect(docQualityBarValue(96)).toBe(96);
  });

  it('bumps package versions and gates publish readiness', () => {
    expect(bumpPackageVersion('v3.2')).toBe('v3.2.1');
    expect(bumpPackageVersion('3.1.0')).toBe('3.1.1');
    expect(packageStatusLabel('review')).toBe('加工中');
    expect(packageReadyToPublish({ documentCount: 0 }).ok).toBe(false);
    expect(packageReadyToPublish({ documentIds: ['a'], status: 'draft' }).ok).toBe(true);
    expect(packageReadyToPublish({ documentIds: ['a'], status: 'archived' }).ok).toBe(false);
  });

  it('names package lifecycle steps in user language', () => {
    expect(PACKAGE_LIFECYCLE_STEPS.map((item) => item.label)).toEqual([
      '基本信息', '添加内容', '加工处理', '检索验证', '知识图谱', '发布上线',
    ]);
  });
});
