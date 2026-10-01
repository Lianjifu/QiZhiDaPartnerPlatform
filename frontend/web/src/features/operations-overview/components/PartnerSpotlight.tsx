/**
 * M01 · 今日特色数字伙伴卡片（Partner Spotlight）
 *
 * 从活跃员工池（active lifecycle / released.status）中挑 1 个焦点 + ≤3 个团队头像；
 * 显示职责、能力装配统计与 24h 调用量。审计员不显示「协作」按钮。
 */
import { ArrowRight, Bot, MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { DigitalPartnerAvatar } from '@/components/DigitalPartnerAvatar';
import { employeePrimaryLabel, employeeSecondaryLabel } from '@/lib/partners';
import type { DigitalPartner } from '@qzda/web-types';

type Props = {
  featured: DigitalPartner | null;
  /** 同岗位其他活跃员工头像组（≤4） */
  featuredPool: DigitalPartner[];
  /** 全部员工（含非活跃）— 仅用于溢出 +N 显示 */
  totalEmployees: DigitalPartner[];
  isAuditor: boolean;
  featureStats: { knowledge: number; skills: number; workflows: number };
  onNavigate: (to: string) => void;
};

export function PartnerSpotlight({
  featured,
  featuredPool,
  totalEmployees,
  isAuditor,
  featureStats,
  onNavigate,
}: Props) {
  if (!featured) {
    return (
      <section className="home-spotlight de-employee-shell">
        <div className="flex flex-col items-center gap-2 p-6 text-center">
          <Bot className="h-6 w-6 text-[var(--text-muted)]" />
          <p className="text-sm">尚未装配数字伙伴</p>
          <p className="text-[11px] text-[var(--text-muted)]">
            先创建或从上岗模板引入岗位，运营总览将展示在岗专家
          </p>
          <Link to="/partners" className="text-xs text-[var(--brand)] hover:underline">打开数字伙伴</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="home-spotlight de-employee-shell">
      <div className="home-spotlight__head">
        <div className="home-spotlight__identity">
          <DigitalPartnerAvatar employee={featured} size={52} />
          <div className="min-w-0">
            <p className="home-spotlight__label">数字伙伴 · 今日焦点</p>
            <h2 className="home-spotlight__name">{employeePrimaryLabel(featured)}</h2>
            <p className="home-spotlight__meta">{employeeSecondaryLabel(featured)} · {featured.department}</p>
          </div>
        </div>
        <div className="home-spotlight__cta">
          {featured.lifecycle === 'active' && <Badge tone="success" className="text-[10px]">在岗</Badge>}
          <Button size="sm" variant="secondary" onClick={() => onNavigate(`/partners?employeeId=${featured.id}`)}>
            档案 <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          {!isAuditor && (
            <Button size="sm" onClick={() => onNavigate(`/copilot?employee=${featured.id}`)}>
              <MessageSquare className="h-3.5 w-3.5" />协作
            </Button>
          )}
        </div>
      </div>

      <div className="home-spotlight__chips">
        {(featured.responsibilities ?? []).slice(0, 3).map((item) => (
          <span key={item} className="home-chip">{item}</span>
        ))}
      </div>

      <div className="home-spotlight__stats">
        <div><span>知识</span><strong>{featureStats.knowledge}</strong></div>
        <div><span>技能/工具</span><strong>{featureStats.skills}</strong></div>
        <div><span>流程</span><strong>{featureStats.workflows}</strong></div>
        <div><span>24h 调用</span><strong>{featured.runtime?.calls24h ?? 0}</strong></div>
      </div>

      {featuredPool.length > 1 && (
        <div className="home-spotlight__team">
          <span className="home-spotlight__team-label">在岗团队</span>
          <div className="home-spotlight__avatars">
            {featuredPool.map((emp) => (
              <button
                key={emp.id}
                type="button"
                className={cn('home-spotlight__avatar', emp.id === featured.id && 'is-active')}
                title={employeePrimaryLabel(emp)}
                onClick={() => onNavigate(`/partners?employeeId=${emp.id}`)}
              >
                <DigitalPartnerAvatar employee={emp} size={28} rounded="full" />
              </button>
            ))}
            {totalEmployees.length > featuredPool.length && (
              <Link to="/partners" className="home-spotlight__more">+{totalEmployees.length - featuredPool.length}</Link>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
