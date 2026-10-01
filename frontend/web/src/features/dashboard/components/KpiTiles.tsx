/**
 * M01 · KPI 6 tile 网格 — 在岗专家 / 进行中 / 需关注 / 已完成 / 成功率 / 健康度
 *
 * 数据由 HomePage 通过 props 注入；本组件只负责呈现与点击跳转，
 * 计算口径（employeeHealthScore / taskSuccessRate）保留在 features/dashboard/lib/home-metrics.ts。
 */
import { Activity, CheckCircle2, HeartPulse, Target, TrendingUp, Users } from 'lucide-react';
import { cn } from '@qzda/web-utils';

export type KpiTone = 'brand' | 'info' | 'success' | 'warn' | 'neutral';
export type KpiKey = 'agents' | 'doing' | 'attention' | 'done' | 'success' | 'health';

export type Kpi = {
  key: KpiKey;
  label: string;
  value: number | string;
  sub?: string;
  icon: typeof Users;
  tone: KpiTone;
  to: string;
};

type Props = {
  kpis: Kpi[];
  onNavigate: (to: string) => void;
};

export function KpiTiles({ kpis, onNavigate }: Props) {
  return (
    <section className="home-kpis" aria-label="运营指标">
      {kpis.map((kpi) => (
        <button
          key={kpi.key}
          type="button"
          className={cn('home-kpi', `home-kpi--${kpi.tone}`)}
          onClick={() => onNavigate(kpi.to)}
        >
          <span className="home-kpi__icon"><kpi.icon className="h-4 w-4" /></span>
          <span className="home-kpi__body">
            <span>{kpi.label}</span>
            <strong>
              {kpi.value}
              {kpi.sub && <small>{kpi.sub}</small>}
            </strong>
          </span>
        </button>
      ))}
    </section>
  );
}

// Re-export for backward references inside HomePage (legacy import shape).
export { Activity, CheckCircle2, HeartPulse, Target, TrendingUp, Users };
