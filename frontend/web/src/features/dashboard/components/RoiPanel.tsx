/**
 * M01 · 投入产出（RoiPanel）— UsageMeters 实计量 + 完成数 / 成功率 / 健康度
 *
 * 行为契约：
 *  - 没有 usage-meters 时显示 "—" 与"仅展示 UsageMeters 实计量；无计量数据时不显示金额"
 *  - 有 usage-meters 时显示 used/budget 比 + 进度条
 *  - 完成 / 成功率 / 健康度 数字与 KPI tile 同源
 */
type Props = {
  costSource: string;
  costUsed: number;
  costBudget: number;
  costPct: number;
  tc: { done: number; doing: number; review: number; todo: number };
  successRate: number | null;
  healthScore: number | null;
};

export function RoiPanel({ costSource, costUsed, costBudget, costPct, tc, successRate, healthScore }: Props) {
  return (
    <div className="home-panel de-employee-shell">
      <div className="home-panel__head">
        <h3>投入产出</h3>
        <span className="text-[11px] text-[var(--text-muted)]">
          {costSource === 'usage-meters' ? '本月计量' : '暂无计量'}
        </span>
      </div>
      <div className="home-roi">
        <div className="home-roi__value">
          <strong>{costUsed > 0 ? `¥${costUsed}` : '—'}</strong>
          <span>{costBudget > 0 ? `/ ¥${costBudget}` : ''}</span>
        </div>
        {costBudget > 0 && costUsed > 0 ? (
          <div className="home-roi__bar" aria-hidden>
            <div style={{ width: `${costPct}%` }} />
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">仅展示 UsageMeters 实计量；无计量数据时不显示金额。</p>
        )}
        <div className="home-roi__grid">
          <div><span>完成</span><strong>{tc.done}</strong></div>
          <div><span>成功率</span><strong>{successRate == null ? '—' : `${Math.round(successRate)}%`}</strong></div>
          <div><span>健康度</span><strong>{healthScore ?? '—'}</strong></div>
        </div>
      </div>
    </div>
  );
}
