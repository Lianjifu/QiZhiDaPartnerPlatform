import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, LoaderCircle, Pause, Play, TimerReset } from 'lucide-react';
import type { DigitalPartner, ScheduleCadence, ScheduledTask, ScheduledTaskRun } from '@qzda/web-types';
import { Badge, Button, Input, KpiCard } from '@qzda/web-ui';
import { Drawer } from '@/components/shared';
import { useApiMutation, useApiQuery } from '@/services/query';
import { cadenceLabel, scheduleStatusLabel, scheduleWhen } from '@/features/tasks/schedule-ui';
import { workspaceErrorMessage } from '@/features/role-nav/role-nav';

type Draft = {
  title: string;
  description: string;
  cadence: ScheduleCadence;
  hour: number;
  minute: number;
  weekday: number;
  digitalPartnerId: string;
  digitalPartnerName?: string;
};

const emptyDraft = (): Draft => ({ title: '', description: '', cadence: 'daily', hour: 9, minute: 0, weekday: 1, digitalPartnerId: '' });

export function TasksTabSchedule({ canMutate, createSignal }: { canMutate: boolean; createSignal: number }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | ScheduledTask['status']>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [selected, setSelected] = useState<ScheduledTask | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { if (createSignal > 0) { setDraft(emptyDraft()); setFormOpen(true); } }, [createSignal]);

  const listQuery = useMemo(() => {
    const q: Record<string, string> = {};
    if (query.trim()) q.q = query.trim();
    if (status !== 'all') q.status = status;
    return q;
  }, [query, status]);
  const { data: jobs = [], isLoading, error, refetch } = useApiQuery<ScheduledTask[]>(['scheduled-tasks', listQuery], '/api/scheduled-tasks', { query: listQuery }, { refetchInterval: 8_000 });
  const { data: partners = [] } = useApiQuery<DigitalPartner[]>(['digital-employees'], '/api/partners');
  const { data: runs = [] } = useApiQuery<ScheduledTaskRun[]>(
    ['scheduled-task-runs', selected?.id ?? 'none'],
    selected ? `/api/scheduled-tasks/${selected.id}/runs` : '/api/scheduled-tasks/none/runs',
    undefined,
    { enabled: Boolean(selected?.id), refetchInterval: 8_000 },
  );
  const create = useApiMutation<ScheduledTask, Draft>('/api/scheduled-tasks', { onSuccess: () => { setFormOpen(false); setMessage('已创建定时任务。'); } });
  const pause = useApiMutation<ScheduledTask, { id: string }>(({ id }) => `/api/scheduled-tasks/${id}/pause`, { onSuccess: () => setMessage('已暂停。') });
  const resume = useApiMutation<ScheduledTask, { id: string }>(({ id }) => `/api/scheduled-tasks/${id}/resume`, { onSuccess: () => setMessage('已恢复。') });
  const runNow = useApiMutation<ScheduledTaskRun, { id: string }>(({ id }) => `/api/scheduled-tasks/${id}/run`, { onSuccess: (run) => setMessage(run.message ?? '已立即执行。') });

  const counts = useMemo(() => ({
    total: jobs.length,
    active: jobs.filter((item) => item.status === 'active').length,
    paused: jobs.filter((item) => item.status === 'paused').length,
    failed: jobs.filter((item) => item.lastStatus === 'failed').length,
  }), [jobs]);

  const submit = () => {
    const partner = partners.find((item) => item.id === draft.digitalPartnerId);
    create.mutate({ ...draft, digitalPartnerName: partner?.role ?? partner?.name } as Draft);
  };

  const errorText = error instanceof Error ? workspaceErrorMessage(error.message) : '请求失败';

  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="定时任务" value={counts.total} sub="个" icon={TimerReset} tone="brand" size="comfortable" />
        <KpiCard label="进行中" value={counts.active} sub="个" icon={Play} tone="success" size="comfortable" />
        <KpiCard label="已暂停" value={counts.paused} sub="个" icon={Pause} tone="warn" size="comfortable" />
        <KpiCard label="最近失败" value={counts.failed} sub="次" icon={AlertCircle} tone={counts.failed ? 'warn' : 'success'} size="comfortable" />
      </section>
      <section className="de-employee-shell overflow-hidden rounded-xl bg-[var(--surface-1)]">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索定时任务、编号或数字伙伴" className="de-employee-input h-9 min-w-[220px] flex-1 rounded-lg bg-[var(--bg)] px-3 text-xs outline-none" />
          {(['all', 'active', 'paused', 'expired'] as const).map((item) => (
            <button key={item} type="button" onClick={() => setStatus(item)} className={`de-employee-chip rounded-md px-3 py-1.5 text-xs ${status === item ? 'is-active' : ''}`}>
              {item === 'all' ? '全部' : scheduleStatusLabel(item)}
            </button>
          ))}
        </div>
      </section>
      {message && <div className="task-feedback" role="status">{message}<button type="button" onClick={() => setMessage(null)}>关闭</button></div>}
      {isLoading ? (
        <div className="task-loading"><LoaderCircle className="animate-spin" />正在加载定时任务…</div>
      ) : error ? (
        <div className="task-loading error" role="alert"><AlertCircle />无法加载定时任务：{errorText}<button type="button" onClick={() => refetch()}>重试</button></div>
      ) : jobs.length === 0 ? (
        <div className="de-employee-shell rounded-xl bg-[var(--surface-1)] px-5 py-10 text-center text-xs text-[var(--text-muted)]">还没有定时任务。可按天/周调度数字伙伴，到期会自动创建团队协助。</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {jobs.map((job) => (
            <article key={job.id} className="de-employee-shell cursor-pointer rounded-xl bg-[var(--surface-1)] p-4" onClick={() => setSelected(job)}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-[10px] text-[var(--text-muted)]">{job.code}</p>
                  <h3 className="mt-0.5 text-sm font-semibold text-[var(--text)]">{job.title}</h3>
                </div>
                <Badge tone={job.status === 'active' ? 'success' : job.status === 'paused' ? 'warn' : 'neutral'}>{scheduleStatusLabel(job.status)}</Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{job.description || '到期后自动创建团队协助。'}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--text-muted)]">
                <div>周期 <b className="text-[var(--text)]">{cadenceLabel(job.cadence)} · {scheduleWhen(job)}</b></div>
                <div>数字伙伴 <b className="text-[var(--text)]">{job.digitalPartnerName ?? '未绑定'}</b></div>
                <div>下次 <b className="text-[var(--text)]">{job.nextRunAt ? new Date(job.nextRunAt).toLocaleString('zh-CN') : '—'}</b></div>
                <div>已运行 <b className="text-[var(--text)]">{job.runCount} 次</b></div>
              </dl>
              {canMutate && (
                <div className="mt-3 flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
                  {job.status === 'active' ? (
                    <Button size="sm" variant="outline" onClick={() => pause.mutate({ id: job.id })}><Pause className="h-3.5 w-3.5" />暂停</Button>
                  ) : job.status !== 'expired' ? (
                    <Button size="sm" variant="outline" onClick={() => resume.mutate({ id: job.id })}><Play className="h-3.5 w-3.5" />恢复</Button>
                  ) : null}
                  <Button size="sm" onClick={() => runNow.mutate({ id: job.id })} disabled={job.status === 'expired'}>立即执行</Button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <Drawer open={formOpen} onClose={() => setFormOpen(false)} title="新建定时任务" description="按日历调度数字伙伴；每次触发会生成一条团队协助。" width={460} footer={<button type="button" className="task-create-btn" disabled={!draft.title.trim() || create.isPending} onClick={submit}>{create.isPending ? '创建中…' : '创建定时任务'}</button>}>
        <label className="task-new-label">名称<Input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：每日缓存巡检" /></label>
        <label className="task-new-label mt-3">说明<Input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="触发后创建的协助摘要" /></label>
        <label className="task-new-label mt-3">周期
          <select className="de-employee-input mt-1 h-9 w-full rounded-lg bg-[var(--bg)] px-2 text-xs" value={draft.cadence} onChange={(event) => setDraft({ ...draft, cadence: event.target.value as ScheduleCadence })}>
            <option value="hourly">每小时</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
            <option value="once">单次</option>
          </select>
        </label>
        {draft.cadence !== 'hourly' && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="task-new-label">时<input type="number" min={0} max={23} className="de-employee-input mt-1 h-9 w-full rounded-lg bg-[var(--bg)] px-2 text-xs" value={draft.hour} onChange={(event) => setDraft({ ...draft, hour: Number(event.target.value) })} /></label>
            <label className="task-new-label">分<input type="number" min={0} max={59} className="de-employee-input mt-1 h-9 w-full rounded-lg bg-[var(--bg)] px-2 text-xs" value={draft.minute} onChange={(event) => setDraft({ ...draft, minute: Number(event.target.value) })} /></label>
          </div>
        )}
        {draft.cadence === 'weekly' && (
          <label className="task-new-label mt-3">星期
            <select className="de-employee-input mt-1 h-9 w-full rounded-lg bg-[var(--bg)] px-2 text-xs" value={draft.weekday} onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })}>
              {['日', '一', '二', '三', '四', '五', '六'].map((label, index) => <option key={label} value={index}>周{label}</option>)}
            </select>
          </label>
        )}
        <label className="task-new-label mt-3">数字伙伴
          <select className="de-employee-input mt-1 h-9 w-full rounded-lg bg-[var(--bg)] px-2 text-xs" value={draft.digitalPartnerId} onChange={(event) => setDraft({ ...draft, digitalPartnerId: event.target.value })}>
            <option value="">不绑定</option>
            {partners.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.role}</option>)}
          </select>
        </label>
      </Drawer>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.title} description={selected ? `${selected.code} · ${cadenceLabel(selected.cadence)}` : undefined} width={480}>
        {selected && (
          <div className="space-y-3 text-xs">
            <p className="leading-5 text-[var(--text-muted)]">{selected.description || '到期后自动创建团队协助。'}</p>
            <p>下次执行：{selected.nextRunAt ? new Date(selected.nextRunAt).toLocaleString('zh-CN') : '—'}</p>
            <h4 className="text-sm font-semibold">最近运行</h4>
            {runs.length === 0 ? <p className="text-[var(--text-muted)]">暂无运行记录。</p> : (
              <ol className="space-y-2">
                {runs.slice(0, 12).map((run) => (
                  <li key={run.id} className="rounded-lg bg-[var(--bg)] px-3 py-2">
                    <strong>{run.status === 'success' ? '成功' : run.status}</strong>
                    <span className="ml-2 text-[var(--text-muted)]">{run.message}</span>
                    <div className="mt-1 text-[10px] text-[var(--text-muted)]">{new Date(run.startedAt).toLocaleString('zh-CN')}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
