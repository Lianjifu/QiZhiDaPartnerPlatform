/**
 * M01 · "需要关注" 面板（AttentionPanel）
 *
 * 数据源：ops.pending → alerts → review（依次降级，最多 5 条）
 * admin 看「需要关注」+ attentionCount badge；user 看「我的待办」；
 * 顶栏 unread 通知可一键已读（仅前端状态）。
 */
import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, ChevronRight, Inbox } from 'lucide-react';
import { Badge } from '@qzda/web-ui';

export type PendingItem = { id: string; title: string; to: string };

type Props = {
  isAdministrator: boolean;
  attentionCount: number;
  unreadNotifications: Array<{ id: string; text: string }>;
  pendingItems: PendingItem[];
  onMarkAllRead: () => void;
};

export function AttentionPanel({
  isAdministrator,
  attentionCount,
  unreadNotifications,
  pendingItems,
  onMarkAllRead,
}: Props) {
  const handleMarkRead = useCallback(() => onMarkAllRead(), [onMarkAllRead]);
  return (
    <div className="home-panel de-employee-shell">
      <div className="home-panel__head">
        <div className="flex items-center gap-2 min-w-0">
          <Inbox className="h-4 w-4 shrink-0 text-[var(--brand)]" />
          <h3>{isAdministrator ? '需要关注' : '我的待办'}</h3>
          {attentionCount > 0 && <Badge tone="error">{attentionCount}</Badge>}
        </div>
        <Link to="/tasks?risk=attention" className="home-link">全部</Link>
      </div>
      {unreadNotifications.length > 0 && (
        <div className="home-notice">
          <BellRing className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
          <span className="min-w-0 flex-1 truncate">{unreadNotifications[0]?.text}</span>
          <button type="button" className="home-link" onClick={handleMarkRead}>
            已读
          </button>
        </div>
      )}
      <div className="home-pending">
        {pendingItems.slice(0, 5).map((item) => (
          <Link key={item.id} to={item.to} className="home-pending__row">
            <span className="home-pending__dot" />
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          </Link>
        ))}
        {pendingItems.length === 0 && (
          <p className="home-empty">当前没有待处理事项</p>
        )}
      </div>
    </div>
  );
}
