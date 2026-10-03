/**
 * SettingsTab.Billing — 平台设置 / 用量:订阅信息 + 配额用量进度条。
 * M09 P1 拆分:从 pages/Settings.tsx 行 638-715 抽出。
 */
import {
  Activity, AlertTriangle, Bot, Building2, CheckCircle2,
  Clock3, Coins, CreditCard, Download, Users,
} from 'lucide-react';
import { Badge, Button, KpiCard, Progress } from '@qzda/web-ui';
import { BillingFact, PanelHeader, panelClass } from './SettingsShared';

type Billing = {
  plan?: string;
  price?: string;
  nextBilling?: string;
  usage: any;
};

export function BillingPanel({ billing }: { billing: Billing }) {
  const usage = billing.usage ?? { cost: 0, budget: 1, tokens: 0, tokenBudget: 1, seats: 0, seatLimit: 1, agents: 0, agentLimit: 1 };
  const quotas = [
    {
      key: 'cost', label: '本月成本', used: `$${usage.cost}`, limit: `$${usage.budget}`,
      pct: (usage.cost / usage.budget) * 100,
      tone: usage.cost / usage.budget >= 0.8 ? ('warn' as const) : ('success' as const),
      icon: Coins,
    },
    {
      key: 'tokens', label: 'Token 消耗', used: `${(usage.tokens / 1e6).toFixed(1)}M`, limit: `${(usage.tokenBudget / 1e6).toFixed(0)}M`,
      pct: (usage.tokens / usage.tokenBudget) * 100,
      tone: 'primary' as const, icon: Activity,
    },
    {
      key: 'seats', label: '席位', used: String(usage.seats), limit: String(usage.seatLimit),
      pct: (usage.seats / usage.seatLimit) * 100,
      tone: 'primary' as const, icon: Users,
    },
    {
      key: 'agents', label: '数字伙伴', used: String(usage.agents), limit: String(usage.agentLimit),
      pct: (usage.agents / usage.agentLimit) * 100,
      tone: usage.agents / usage.agentLimit >= 0.8 ? ('warn' as const) : ('success' as const),
      icon: Bot,
    },
  ];
  const budgetPct = Math.round((usage.cost / usage.budget) * 100);
  const warnCount = quotas.filter((q) => q.pct >= 80).length;

  return (
    <div className="settings-section">
      <section className="settings-kpis">
        <KpiCard label="订阅方案" value={billing.plan === 'Enterprise Plus' ? 'Ent+' : billing.plan} icon={CreditCard} tone="brand" size="comfortable" />
        <KpiCard label="固定月费" value={billing.price} icon={Building2} tone="info" size="comfortable" />
        <KpiCard label="预算消耗" value={budgetPct} sub="%" icon={Coins} tone={budgetPct >= 80 ? 'warn' : 'success'} size="comfortable" />
        <KpiCard label="下次扣款" value={billing.nextBilling?.slice(5) ?? ''} icon={Clock3} tone="warn" size="comfortable" />
      </section>

      <div className="settings-split settings-split--billing">
        <section className={panelClass}>
          <PanelHeader icon={CreditCard} title="订阅信息" trailing={<Badge tone="brand">{billing.plan}</Badge>} />
          <div className="settings-billing-facts">
            <BillingFact label="方案" value={billing.plan} />
            <BillingFact label="月费" value={<span className="font-mono font-semibold text-[var(--brand)]">{billing.price}</span>} />
            <BillingFact label="计费周期" value="按月 · 自然月结算" />
            <BillingFact label="下次扣款" value={billing.nextBilling} />
            <BillingFact label="席位上限" value={`${usage.seatLimit} 席`} />
            <BillingFact label="数字伙伴上限" value={`${usage.agentLimit} 个`} />
          </div>
          <div className="settings-panel__foot">
            <Button size="sm" variant="secondary"><Download className="h-3 w-3" />导出账单</Button>
          </div>
        </section>

        <section className={panelClass}>
          <PanelHeader
            icon={Bot}
            title="配额用量"
            description="按租户聚合席位、数字伙伴与 Token 消耗。"
            trailing={warnCount > 0 ? (
              <Badge tone="warn"><AlertTriangle className="mr-1 inline h-3 w-3" />{warnCount} 项接近上限</Badge>
            ) : (
              <Badge tone="success"><CheckCircle2 className="mr-1 inline h-3 w-3" />用量正常</Badge>
            )}
          />
          <div className="settings-table-head settings-table-head--quota">
            <span>配额项</span><span>已用 / 上限</span><span>占用</span><span>进度</span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {quotas.map((item) => (
              <article key={item.key} className="settings-table-row settings-table-row--quota">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <item.icon className="h-3.5 w-3.5 text-[var(--brand)]" />
                  {item.label}
                </div>
                <div className="font-mono text-[11px] text-[var(--text-secondary)]">{item.used} / {item.limit}</div>
                <div>
                  <Badge tone={item.pct >= 90 ? 'error' : item.pct >= 80 ? 'warn' : item.tone === 'success' ? 'success' : 'brand'}>
                    {Math.round(item.pct)}%
                  </Badge>
                </div>
                <div className="min-w-0">
                  <Progress value={item.pct} tone={item.pct >= 90 ? 'error' : item.pct >= 80 ? 'warn' : item.tone === 'success' ? 'success' : 'primary'} />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className={`${panelClass} settings-panel__foot`}>
        套餐用量按租户聚合；Token 与运行成本达 80% 时将触发预算告警。升级方案或扩容数字伙伴席位请联系企业客户成功经理。
      </section>
    </div>
  );
}
