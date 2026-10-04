/**
 * 任务中心：定时任务与团队协助。
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, ListChecks, Plus, Users } from 'lucide-react';
import { Badge } from '@qzda/web-ui';
import { RoleReadonlyBanner } from '@/components/shared';
import { cn } from '@qzda/web-utils';
import { roleCanMutate, rolePageCopy } from '@/features/role-nav/role-nav';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { TasksTabSchedule } from './TasksTab.Schedule';
import { TasksTabCollab } from './TasksTab.Collab';

type HubTab = 'schedule' | 'collab';

export default function Tasks() {
  const user = useAuthStore((state) => state.user);
  const canMutate = roleCanMutate(user?.role);
  const copy = rolePageCopy('tasks', user?.role);
  const workspaceName = useWorkspaceStore((state) => state.current?.name ?? '当前工作区');
  const [params, setParams] = useSearchParams();
  const tab: HubTab = params.get('tab') === 'collab' || params.get('task') ? 'collab' : params.get('tab') === 'schedule' ? 'schedule' : 'schedule';
  const [createSignal, setCreateSignal] = useState(0);

  const go = (next: HubTab) => {
    const q = new URLSearchParams(params);
    q.set('tab', next);
    if (next !== 'collab') q.delete('task');
    setParams(q, { replace: true });
  };

  const tabs = useMemo(() => ([
    { key: 'schedule' as const, label: '定时任务', icon: CalendarClock },
    { key: 'collab' as const, label: '团队协助', icon: ListChecks },
  ]), []);

  return (
    <div className="de-employee-page h-full min-w-0 overflow-y-auto overscroll-contain bg-[var(--bg-elevated)] p-3 md:p-4 lg:p-5" data-testid="page-tasks">
      <div className="space-y-3">
        <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
          <div className="flex items-start justify-between gap-4 px-4 py-3.5 md:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="de-employee-icon-tile grid h-8 w-8 place-items-center rounded-lg">
                  <Users className="h-4 w-4" />
                </div>
                <h1 className="text-base font-semibold text-[var(--text)]">{copy.title}</h1>
              </div>
              <p className="mt-1.5 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">{copy.subtitle}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Badge tone="info">{workspaceName}</Badge>
              {!canMutate && <Badge tone="neutral">只读</Badge>}
              {canMutate && (
                <button
                  type="button"
                  className="de-employee-btn de-employee-btn--primary"
                  onClick={() => { if (tab !== 'schedule' && tab !== 'collab') return; setCreateSignal((n) => n + 1); }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {tab === 'schedule' ? '新建定时任务' : '新建协助'}
                </button>
              )}
            </div>
          </div>
          <div className="px-4 md:px-5">
            <RoleReadonlyBanner className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]" />
          </div>
          <div className="de-employee-tabs flex overflow-x-auto px-3" role="tablist" aria-label="任务中心">
            {tabs.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.key}
                  role="tab"
                  aria-selected={tab === item.key}
                  onClick={() => go(item.key)}
                  className={cn('de-employee-tab flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs transition-colors', tab === item.key && 'is-active')}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </section>
        {tab === 'schedule' ? <TasksTabSchedule canMutate={canMutate} createSignal={createSignal} /> : <TasksTabCollab canMutate={canMutate} createSignal={createSignal} />}
      </div>
    </div>
  );
}
