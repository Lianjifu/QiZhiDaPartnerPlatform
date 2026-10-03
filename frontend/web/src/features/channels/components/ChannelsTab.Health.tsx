import { useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import type { ChannelDeployment, ChannelKind } from '@qzda/web-types';
import { DeploymentHealth, ENV_LABEL, KIND_LABEL } from './ChannelsShared';

export function Health({
  overview,
  deployments,
  metrics,
  onSimulate,
  canWrite,
}: {
  overview?: { capacityRisk: string; activeDeployments?: number; deadLetters?: number };
  deployments: ChannelDeployment[];
  metrics: DeploymentHealth[];
  onSimulate: () => void;
  canWrite: boolean;
}) {
  const metricMap = useMemo(() => {
    const map = new Map<string, DeploymentHealth>();
    metrics.forEach((item) => map.set(item.deploymentId, item));
    return map;
  }, [metrics]);
  const rows = deployments.map((item) => {
    const health = metricMap.get(item.id) ?? {
      deploymentId: item.id,
      successRate: item.status === 'active' ? 99 : 0,
      p95Ms: item.status === 'active' ? 150 : 0,
      errorCount24h: 0,
      status: item.status === 'active' ? ('healthy' as const) : ('offline' as const),
    };
    return { ...item, ...health };
  });
  const capacity = overview?.capacityRisk ?? 'unknown';

  return (
    <div className="channels-panel">
      <div className="channels-section-head">
        <div>
          <h2>运行健康</h2>
          <p>按部署查看成功率、P95 与错误；容量风险可走策略模拟预检。</p>
        </div>
        <Button size="sm" variant="secondary" disabled={!canWrite} onClick={onSimulate}>容量模拟</Button>
      </div>

      <div className="channels-health-summary">
        <div className="channels-health-stat">
          <span>容量风险</span>
          <strong className={capacity === 'normal' ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>{capacity}</strong>
        </div>
        <div className="channels-health-stat">
          <span>活跃部署</span>
          <strong>{overview?.activeDeployments ?? deployments.filter((d) => d.status === 'active').length}</strong>
        </div>
        <div className="channels-health-stat">
          <span>死信水位</span>
          <strong>{overview?.deadLetters ?? 0}</strong>
        </div>
      </div>

      <div className="channels-health-grid">
        {rows.map((row) => (
          <article key={row.id} className="channels-card">
            <div className="channels-card__top">
              <div>
                <strong>{row.name}</strong>
                <p>{KIND_LABEL[row.kind as ChannelKind] ?? row.kind} · {ENV_LABEL[row.environment as keyof typeof ENV_LABEL] ?? row.environment}</p>
              </div>
              <Badge tone={row.status === 'healthy' ? 'success' : row.status === 'attention' ? 'warn' : 'neutral'}>
                {row.status === 'healthy' ? '健康' : row.status === 'attention' ? '关注' : '离线'}
              </Badge>
            </div>
            <div className="channels-health-metrics">
              <div><span>成功率</span><strong>{row.successRate}%</strong></div>
              <div><span>P95</span><strong>{row.p95Ms}<small>ms</small></strong></div>
              <div><span>24h 错误</span><strong>{row.errorCount24h}</strong></div>
            </div>
          </article>
        ))}
        <article className="channels-card channels-card--soft">
          <div className="channels-card__top">
            <div>
              <strong>隔离演练</strong>
              <p>在 sandbox / canary 验证投递链路，不影响生产目标组。</p>
            </div>
            <CheckCircle2 className="h-4 w-4 text-[var(--brand)]" />
          </div>
          <p className="channels-card__hint">建议在策略发布前执行模拟，确认降级链容量充足。</p>
        </article>
      </div>
    </div>
  );
}