/**
 * M01 · 功能入口栏（Functional Rail）
 *
 * 三角色差异：
 *  - user / admin：数字伙伴 / 专家协作 / 知识记忆 / 任务 SLA
 *  - auditor：审计中心 / 持续验证 / 任务核查 / 协作记录
 */
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@qzda/web-utils';

export type ModuleEntry = {
  title: string;
  desc: string;
  to: string;
  icon: typeof ChevronRight;
  tone: 'brand' | 'info' | 'success' | 'warn';
};

type Props = {
  modules: ModuleEntry[];
};

export function FunctionalRail({ modules }: Props) {
  return (
    <nav className="home-rail" aria-label="功能入口">
      {modules.map((mod) => (
        <Link key={mod.to} to={mod.to} className={cn('home-rail__item', `home-rail__item--${mod.tone}`)}>
          <span className="home-rail__icon"><mod.icon className="h-4 w-4" /></span>
          <span className="home-rail__copy">
            <strong>{mod.title}</strong>
            <span>{mod.desc}</span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-35" />
        </Link>
      ))}
    </nav>
  );
}
