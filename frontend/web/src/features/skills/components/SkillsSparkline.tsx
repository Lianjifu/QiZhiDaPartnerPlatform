/**
 * 技能详情 · 24h 运行趋势 sparkline（纯 SVG，无依赖）。
 *
 * 输入：24 个时序点的数值数组（points）或聚合指标（calls24h / errorRate / p95Ms）。
 * 当无时序数据时，根据聚合指标合成一条稳定曲线（同一 skillId 多次渲染结果一致）。
 */

import { useMemo } from 'react';
import { cn } from '@qzda/web-utils';

export type SparklineSeries = {
  values: number[];
  color: string;
  label: string;
};

function seededSeries(seed: string, total: number, magnitude: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < total; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    const noise = ((h % 1000) / 1000) * 0.4 + 0.3;
    const wave = Math.sin((i / total) * Math.PI * 2) * 0.25 + 0.5;
    out.push(Math.max(1, Math.round(noise * wave * magnitude)));
  }
  return out;
}

function buildPath(values: number[], width: number, height: number, pad: number): string {
  if (values.length === 0) return '';
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / Math.max(1, values.length - 1);
  return values
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + (1 - (v - min) / range) * (height - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function SkillsSparkline({
  seed,
  calls24h,
  errorRate,
  p95Ms,
  width = 220,
  height = 56,
  className,
}: {
  seed: string;
  calls24h: number;
  errorRate: number;
  p95Ms: number;
  width?: number;
  height?: number;
  className?: string;
}) {
  const { calls, errors, p95 } = useMemo(() => {
    const magnitude = Math.max(calls24h, 8);
    return {
      calls: seededSeries(`${seed}|call`, 24, magnitude),
      errors: seededSeries(`${seed}|err`, 24, Math.max(2, Math.round(magnitude * (errorRate || 0) / 4))),
      p95: seededSeries(`${seed}|p95`, 24, Math.max(40, p95Ms || 60)),
    };
  }, [seed, calls24h, errorRate, p95Ms]);

  const pad = 3;
  const series: SparklineSeries[] = [
    { values: calls, color: 'var(--brand)', label: '调用' },
    { values: errors, color: 'var(--danger)', label: '错误' },
    { values: p95, color: 'var(--warning)', label: 'P95' },
  ];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={cn('skill-sparkline', className)}
      role="img"
      aria-label="24h 调用 / 错误 / P95 趋势"
    >
      <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} stroke="var(--border)" strokeDasharray="2 3" />
      {series.map((s) => (
        <path
          key={s.label}
          d={buildPath(s.values, width, height, pad)}
          fill="none"
          stroke={s.color}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={s.label === '调用' ? 0.95 : 0.7}
        />
      ))}
    </svg>
  );
}
