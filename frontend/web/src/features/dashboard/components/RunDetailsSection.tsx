/**
 * M01 · 运行细节可折叠区（RunDetailsSection）
 *
 * 三块内容：
 *  1. 进行中任务（带 SLA 倒计时）
 *  2. 24h 健康趋势 area chart
 *  3. 智能建议（admin only）
 *
 * `<details>` 折叠状态由 HomePage 通过 props 注入；本组件不持有折叠态。
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ArrowRight, Brain, Check, CheckCircle2, ChevronDown,
  Clock, Lightbulb,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Avatar } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { Task } from '@qzda/web-types';
import { EmptyState } from '@/components/shared';

type Suggestion = { id: string; tone?: string; text: string; action: string; to?: string };
type TrendPoint = { time: string; tasks?: number; collab?: number; alerts?: number; health?: number };

type Props = {
  isAdministrator: boolean;
  inProgress: Task[];
  suggestions: Suggestion[];
  healthData: TrendPoint[];
  runtimeOpen: boolean;
  onToggleRuntime: (open: boolean) => void;
};

const chartTheme = {
  grid: 'var(--chart-grid)',
  tooltipBackground: 'var(--surface-1)',
  tooltipBorder: 'var(--border)',
  tooltipText: 'var(--text)',
};

function useCountdown(targetSec: number) {
  const [sec, setSec] = useState(targetSec);
  useEffect(() => { setSec(targetSec); }, [targetSec]);
  useEffect(() => {
    const id = setInterval(() => setSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return {
    text: h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
    raw: sec,
  };
}

function InProgressTask({ t }: { t: Task }) {
  const slaSec = (t.slaRemainingMin ?? 60) * 60;
  const sla = useCountdown(slaSec);
  const pct = Math.round((t.progress.done / Math.max(1, t.progress.total)) * 100);
  const slaWarn = sla.raw < 60 * 60;
  const slaError = sla.raw < 30 * 60;
  return (
    <Link
      to={`/tasks?task=${encodeURIComponent(t.code)}`}
      className={cn(
        'task-list__item block transition-colors hover:border-[var(--brand)]',
        slaError ? 'task-tile--danger' : slaWarn ? 'task-tile--warning' : 'task-tile--success',
      )}
    >
      <div className="task-list__header">
        <span className="task-list__id">{t.code}</span>
        <Badge tone={t.priority === 'P0' ? 'error' : t.priority === 'P1' ? 'warn' : 'neutral'} className="text-[10px]">{t.priority}</Badge>
      </div>
      <div className="task-list__title">{t.title}</div>
      <div className="task-list__meta">
        <Avatar name={t.assignee ?? t.digitalPartnerName ?? '?'} size={18} />
        {t.digitalPartnerName && (
          <span className="task-list__meta-item"><Check className="h-3 w-3 text-[var(--brand)]" />{t.digitalPartnerName}</span>
        )}
        <span className={cn('task-list__meta-item ml-auto font-mono', slaError ? 'text-[var(--danger)]' : slaWarn ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]')}>
          <Clock className="h-3 w-3" />{sla.text}
        </span>
      </div>
      <div className="task-list__progress">
        <div className="task-list__progress-bar"><div className="task-list__progress-fill" style={{ width: `${pct}%` }} /></div>
        <div className="task-list__progress-text">{t.progress.done}/{t.progress.total} · {pct}%</div>
      </div>
    </Link>
  );
}

export function RunDetailsSection({ isAdministrator, inProgress, suggestions, healthData, runtimeOpen, onToggleRuntime }: Props) {
  return (
    <details
      className="home-runtime de-employee-shell"
      open={runtimeOpen}
      onToggle={(e) => onToggleRuntime((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="inline-flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          运行细节
          <span className="font-normal text-[var(--text-muted)]">
            24h 趋势 · 进行中任务{isAdministrator ? ' · 建议' : ''}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 text-[var(--text-muted)] transition-transform', runtimeOpen && 'rotate-180')} />
      </summary>
      <div className="home-runtime__body">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="list-card">
            <div className="list-card__header">
              <div className="list-card__title"><Clock className="h-4 w-4" />进行中任务</div>
              <Link to="/tasks" className="chart-card__action">全部</Link>
            </div>
            <div className="space-y-2 p-3 pt-0">
              {inProgress.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="没有进行中的任务" />
              ) : inProgress.slice(0, 4).map((t) => <InProgressTask key={t.id} t={t} />)}
            </div>
          </div>
          <div className="chart-card">
            <div className="list-card__header">
              <div className="list-card__title"><Activity className="h-4 w-4" />24h 健康趋势</div>
            </div>
            {healthData.length === 0 ? (
              <EmptyState icon={Brain} title="暂无趋势数据" />
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={healthData}>
                  <defs>
                    <linearGradient id="home-health" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-success)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--chart-success)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" />
                  <XAxis dataKey="time" hide />
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: chartTheme.tooltipBackground, border: `1px solid ${chartTheme.tooltipBorder}`, color: chartTheme.tooltipText, borderRadius: 6, fontSize: 11 }} />
                  <Area type="monotone" dataKey="health" stroke="var(--chart-success)" strokeWidth={1.8} fill="url(#home-health)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        {isAdministrator && suggestions.length > 0 && (
          <div className="list-card mt-3">
            <div className="list-card__header">
              <div className="list-card__title"><Lightbulb className="h-3.5 w-3.5 text-[var(--warning)]" />智能建议</div>
            </div>
            <div className="space-y-2 p-3 pt-0">
              {suggestions.slice(0, 4).map((s) => (
                <Link key={s.id} to={s.to ?? '/'} className="suggestion-item">
                  <div className="suggestion-item__icon suggestion-item__icon--info"><Lightbulb className="h-3.5 w-3.5" /></div>
                  <div className="suggestion-item__body">
                    <div className="suggestion-item__text">{s.text}</div>
                    <span className="suggestion-item__action">{s.action}<ArrowRight className="h-3 w-3" /></span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
