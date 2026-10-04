import type { ControlledTask, ScheduledTask, ScheduledTaskRun } from '@qzda/web-types';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function sid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export const mockScheduledTasks: ScheduledTask[] = [
  {
    id: 'sch-1', workspaceId: 'w1', code: 'SCH-1001', title: '每日缓存巡检',
    description: '工作日 09:00 触发数字伙伴巡检 Redis 命中率。',
    cadence: 'daily', hour: 9, minute: 0, timezone: 'Asia/Shanghai',
    nextRunAt: '2099-01-01T01:00:00Z', enabled: true, status: 'active',
    digitalPartnerId: 'de-sre', digitalPartnerName: 'SRE 故障处置专员',
    owner: '平台管理员', createdBy: 'u1', runCount: 12, failCount: 0,
    lastRunAt: '2026-07-22T01:00:00Z', lastStatus: 'success',
    createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-22T01:00:00Z',
  },
  {
    id: 'sch-2', workspaceId: 'w1', code: 'SCH-1002', title: '每周容量盘点',
    description: '每周一 10:00 汇总集群容量并创建团队协助待办。',
    cadence: 'weekly', hour: 10, minute: 0, weekday: 1, timezone: 'Asia/Shanghai',
    nextRunAt: '2099-01-06T02:00:00Z', enabled: true, status: 'active',
    digitalPartnerId: 'de-capacity', digitalPartnerName: '容量与性能专员',
    owner: '平台管理员', createdBy: 'u1', runCount: 4, failCount: 1,
    lastRunAt: '2026-07-21T02:00:00Z', lastStatus: 'success',
    createdAt: '2026-06-02T00:00:00Z', updatedAt: '2026-07-21T02:00:00Z',
  },
];

export function nextMockScheduleRun(item: Pick<ScheduledTask, 'cadence' | 'hour' | 'minute' | 'weekday' | 'runAt'>, from = new Date()): string | undefined {
  const hour = item.hour ?? 9;
  const minute = item.minute ?? 0;
  if (item.cadence === 'hourly') {
    const n = new Date(from);
    n.setMinutes(0, 0, 0);
    n.setHours(n.getHours() + 1);
    return n.toISOString();
  }
  if (item.cadence === 'once') {
    if (!item.runAt) return undefined;
    return new Date(item.runAt).getTime() > from.getTime() ? item.runAt : undefined;
  }
  const candidate = new Date(from);
  candidate.setHours(hour, minute, 0, 0);
  if (item.cadence === 'weekly') {
    const want = item.weekday ?? 1;
    for (let i = 0; i < 8; i += 1) {
      if (candidate.getDay() === want && candidate.getTime() > from.getTime()) return candidate.toISOString();
      candidate.setDate(candidate.getDate() + 1);
    }
    return undefined;
  }
  if (candidate.getTime() <= from.getTime()) candidate.setDate(candidate.getDate() + 1);
  return candidate.toISOString();
}

export function createScheduleDomain(seed: ScheduledTask[] = mockScheduledTasks) {
  let jobs = seed.map((item) => clone(item));
  let runs: ScheduledTaskRun[] = [
    { id: 'schr-1', scheduleId: 'sch-1', workspaceId: 'w1', startedAt: '2026-07-22T01:00:00Z', finishedAt: '2026-07-22T01:00:08Z', status: 'success', message: '已创建团队协助 TSK-20260713-001', taskId: 't1', taskCode: 'TSK-20260713-001' },
  ];
  const find = (id: string) => {
    const job = jobs.find((item) => item.id === id);
    if (!job) throw new Error('定时任务不存在');
    return job;
  };
  return {
    list: () => jobs.map((item) => clone(item)),
    get: (id: string) => clone(find(id)),
    runs: (id: string) => runs.filter((item) => item.scheduleId === id).map((item) => clone(item)),
    create: (input: Partial<ScheduledTask> & Pick<ScheduledTask, 'title'>) => {
      const now = new Date().toISOString();
      const job: ScheduledTask = {
        id: input.id ?? sid('sch'),
        workspaceId: input.workspaceId ?? 'w1',
        code: input.code ?? `SCH-${String(jobs.length + 1003).padStart(4, '0')}`,
        title: input.title,
        description: input.description,
        cadence: input.cadence ?? 'daily',
        hour: input.hour ?? 9,
        minute: input.minute ?? 0,
        weekday: input.weekday,
        runAt: input.runAt,
        timezone: input.timezone ?? 'Asia/Shanghai',
        enabled: input.enabled ?? true,
        status: input.enabled === false ? 'paused' : 'active',
        digitalPartnerId: input.digitalPartnerId,
        digitalPartnerName: input.digitalPartnerName,
        workflowId: input.workflowId,
        workflowName: input.workflowName,
        owner: input.owner,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
        runCount: 0,
        failCount: 0,
        nextRunAt: nextMockScheduleRun({ cadence: input.cadence ?? 'daily', hour: input.hour ?? 9, minute: input.minute ?? 0, weekday: input.weekday, runAt: input.runAt }),
      };
      jobs.unshift(job);
      return clone(job);
    },
    patch: (id: string, body: Partial<ScheduledTask>) => {
      const job = find(id);
      Object.assign(job, body, { updatedAt: new Date().toISOString() });
      if (body.enabled === false) job.status = 'paused';
      if (body.enabled === true) job.status = 'active';
      job.nextRunAt = nextMockScheduleRun(job);
      return clone(job);
    },
    remove: (id: string) => {
      find(id);
      jobs = jobs.filter((item) => item.id !== id);
      return { ok: true, id };
    },
    run: (id: string, spawn: (title: string) => ControlledTask) => {
      const job = find(id);
      const task = spawn(`定时：${job.title}`);
      const run: ScheduledTaskRun = {
        id: sid('schr'), scheduleId: job.id, workspaceId: job.workspaceId,
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        status: 'success', message: `已创建团队协助 ${task.code}`, taskId: task.id, taskCode: task.code,
      };
      runs.unshift(run);
      job.updatedAt = new Date().toISOString();
      job.lastRunAt = run.startedAt;
      job.lastStatus = 'success';
      job.runCount += 1;
      if (job.cadence === 'once') {
        job.status = 'expired';
        job.enabled = false;
        job.nextRunAt = undefined;
      } else {
        job.nextRunAt = nextMockScheduleRun(job, new Date(Date.now() + 1000));
      }
      return clone(run);
    },
    reset: () => {
      jobs = seed.map((item) => clone(item));
      runs = [{ id: 'schr-1', scheduleId: 'sch-1', workspaceId: 'w1', startedAt: '2026-07-22T01:00:00Z', finishedAt: '2026-07-22T01:00:08Z', status: 'success', message: '已创建团队协助 TSK-20260713-001', taskId: 't1', taskCode: 'TSK-20260713-001' }];
      return { ok: true };
    },
  };
}
