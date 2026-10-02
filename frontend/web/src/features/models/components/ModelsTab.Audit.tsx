/**
 * 模型中心 · 审计工作区（控制面操作审计列表）。
 *
 * M08 P1 拆分：原 pages/Models.tsx 中的 AuditWorkspace 拆出。
 * 状态由 useModelsController 提供；本组件只消费控制器并渲染 UI。
 */
import { Badge } from '@qzda/web-ui';
import type { ModelAuditEvent } from '@qzda/web-types';
import { cn } from '@qzda/web-utils';
import { EmptyState } from '@/components/shared';
import { History } from 'lucide-react';

type Props = {
  events: ModelAuditEvent[];
  description: string;
  resultFilter: 'all' | 'success' | 'failed';
  actionFilter: string;
  actions: string[];
  onResultFilter: (value: 'all' | 'success' | 'failed') => void;
  onActionFilter: (value: string) => void;
};

export function ModelsTabAudit({ events, description, resultFilter, actionFilter, actions, onResultFilter, onActionFilter }: Props) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">模型控制面审计</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="审计结果筛选">
            {([
              ['all', '全部'],
              ['success', '成功'],
              ['failed', '失败'],
            ] as const).map(([item, label]) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={resultFilter === item}
                onClick={() => onResultFilter(item)}
                className={cn('de-employee-chip shrink-0 rounded-md px-3 py-1.5 text-xs transition-colors', resultFilter === item && 'is-active')}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={actionFilter}
            onChange={(event) => onActionFilter(event.target.value)}
            className="de-employee-input h-8 rounded-lg bg-[var(--bg)] px-2 text-xs text-[var(--text-secondary)]"
          >
            <option value="all">全部动作</option>
            {actions.map((action) => <option key={action} value={action}>{action}</option>)}
          </select>
          <span className="text-xs text-[var(--text-muted)]">{events.length} 条</span>
        </div>
      </div>
      {events.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={History} title="暂无模型控制面审计事件" />
        </div>
      ) : (
        <div className="space-y-2 p-4">
          {events.map((event) => (
            <article key={event.id} className="de-employee-card rounded-xl bg-[var(--surface-1)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone={event.result === 'success' ? 'success' : 'error'}>{event.result === 'success' ? '成功' : '失败'}</Badge>
                  <strong className="text-xs text-[var(--text)]">{event.action}</strong>
                </div>
                <time className="font-mono text-[11px] text-[var(--text-muted)]">{new Date(event.time).toLocaleString('zh-CN')}</time>
              </div>
              <div className="mt-2 text-xs text-[var(--text-secondary)]">目标：{event.target}{event.reason ? ` · 原因：${event.reason}` : ''}</div>
              <div className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
                关联 {event.correlationId}{event.policyVersion ? ` · 版本 ${event.policyVersion}` : ''} · {event.actor}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
