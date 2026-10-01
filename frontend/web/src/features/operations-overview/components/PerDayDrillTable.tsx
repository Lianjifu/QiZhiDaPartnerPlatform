/**
 * M01 · 工作记录下钻表（PerDayDrillTable）
 *
 * 父组件负责筛选（tab + 日期）；本组件只负责渲染表头/空态/行。
 * 每行：标题 / 状态 badge / 归因 / 时间，点击跳转 task 详情。
 */
import { Link } from 'react-router-dom';
import { Badge } from '@qzda/web-ui';

export type WorkRecord = {
  id: string;
  title: string;
  status: string;
  statusTone: 'success' | 'error' | 'warn' | 'info' | 'neutral';
  attribution?: string;
  time: string;
  dateKey?: string;
  to: string;
  kind: 'task' | 'activity' | 'alert';
};

type Props = {
  filteredRecords: WorkRecord[];
};

export function PerDayDrillTable({ filteredRecords }: Props) {
  return (
    <div className="home-records__table">
      <div className="home-records__thead">
        <span>记录</span><span>状态</span><span>归因</span><span>时间</span>
      </div>
      {filteredRecords.length === 0 ? (
        <div className="home-empty">当前筛选下暂无记录</div>
      ) : filteredRecords.slice(0, 10).map((row) => (
        <Link key={row.id} to={row.to} className="home-records__row">
          <span className="home-records__title">{row.title}</span>
          <Badge tone={row.statusTone} className="text-[9px]">{row.status}</Badge>
          <span className="truncate text-[var(--text-muted)]">{row.attribution}</span>
          <span className="tabular-nums text-[var(--text-muted)]">{row.time}</span>
        </Link>
      ))}
    </div>
  );
}
