/** 运营总览指标：与列表同源、禁止演示回填 */

export function asPercent(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

export function employeeHealthScore(active: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((active / total) * 100);
}

export function taskSuccessRate(completed: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((completed / total) * 100);
}

export type TimelineBucket = { label: string; collab: number; tasks: number; alerts: number };

/** @deprecated 保留兼容；日视图已改为纵向小时日历表 */
export function dayTimelineFromTrend(
  rows: Array<{ time: string; collab?: number; tasks?: number; alerts?: number }>,
): TimelineBucket[] {
  return rows.map((d) => ({
    label: d.time,
    collab: Number(d.collab ?? 0),
    tasks: Number(d.tasks ?? 0),
    alerts: Number(d.alerts ?? 0),
  }));
}

export type CalendarCell = {
  key: string;
  label: string;
  /** YYYY-MM-DD；日视图为当天 */
  dateKey: string;
  /** 0–23；仅日视图有值 */
  hour?: number;
  inMonth?: boolean;
  isToday?: boolean;
  isSelected?: boolean;
  collab: number;
  tasks: number;
  alerts: number;
};

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 周一为一周起始（0=周一 … 6=周日） */
export function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function startOfWeekMonday(d: Date): Date {
  const base = startOfDay(d);
  base.setDate(base.getDate() - mondayIndex(base));
  return base;
}

function emptyCounts() {
  return { collab: 0, tasks: 0, alerts: 0 };
}

function parseTs(value?: string): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

export type CalendarSource = {
  tasks: Array<{ updatedAt?: string; createdAt?: string }>;
  alerts: Array<{ time?: string }>;
  /** 今日协作次数（仅落到当天） */
  todayCollab?: number;
  /** 日视图可选：24h 趋势桶 */
  trend?: Array<{ time: string; collab?: number; tasks?: number; alerts?: number }>;
  now?: Date;
};

function bump(map: Map<string, ReturnType<typeof emptyCounts>>, key: string, field: 'collab' | 'tasks' | 'alerts', n = 1) {
  const cur = map.get(key) ?? emptyCounts();
  cur[field] += n;
  map.set(key, cur);
}

/** 按日聚合任务 / 告警 / 今日协作 */
export function aggregateByDate(source: CalendarSource): Map<string, ReturnType<typeof emptyCounts>> {
  const now = source.now ?? new Date();
  const todayKey = toDateKey(now);
  const map = new Map<string, ReturnType<typeof emptyCounts>>();
  for (const t of source.tasks) {
    const ts = parseTs(t.updatedAt || t.createdAt);
    if (ts == null) continue;
    bump(map, toDateKey(new Date(ts)), 'tasks');
  }
  for (const a of source.alerts) {
    const ts = parseTs(a.time);
    if (ts == null) continue;
    bump(map, toDateKey(new Date(ts)), 'alerts');
  }
  if ((source.todayCollab ?? 0) > 0) bump(map, todayKey, 'collab', source.todayCollab);
  return map;
}

/** 按小时聚合（当日）；优先用 trend，否则从任务/告警时间戳推算 */
export function aggregateByHour(source: CalendarSource, day: Date): CalendarCell[] {
  const dayKey = toDateKey(day);
  const todayKey = toDateKey(source.now ?? new Date());
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    key: `${dayKey}-h${hour}`,
    label: `${String(hour).padStart(2, '0')}:00`,
    dateKey: dayKey,
    hour,
    isToday: dayKey === todayKey,
    ...emptyCounts(),
  }));

  const trend = source.trend ?? [];
  if (trend.length > 0 && dayKey === todayKey) {
    for (const row of trend) {
      const match = String(row.time).match(/(\d{1,2})/);
      if (!match) continue;
      const hour = Math.min(23, Math.max(0, Number(match[1])));
      const cell = hours[hour]!;
      cell.collab += Number(row.collab ?? 0);
      cell.tasks += Number(row.tasks ?? 0);
      cell.alerts += Number(row.alerts ?? 0);
    }
    return hours;
  }

  for (const t of source.tasks) {
    const ts = parseTs(t.updatedAt || t.createdAt);
    if (ts == null) continue;
    const d = new Date(ts);
    if (toDateKey(d) !== dayKey) continue;
    hours[d.getHours()]!.tasks += 1;
  }
  for (const a of source.alerts) {
    const ts = parseTs(a.time);
    if (ts == null) continue;
    const d = new Date(ts);
    if (toDateKey(d) !== dayKey) continue;
    hours[d.getHours()]!.alerts += 1;
  }
  if (dayKey === todayKey && (source.todayCollab ?? 0) > 0) {
    hours[(source.now ?? new Date()).getHours()]!.collab += source.todayCollab!;
  }
  return hours;
}

/** 当前周（周一 → 周日） */
export function buildWeekCalendar(source: CalendarSource, anchor = source.now ?? new Date()): CalendarCell[] {
  const now = source.now ?? new Date();
  const weekStart = startOfWeekMonday(anchor);
  const byDate = aggregateByDate(source);
  const todayKey = toDateKey(now);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const dateKey = toDateKey(d);
    const counts = byDate.get(dateKey) ?? emptyCounts();
    return {
      key: dateKey,
      label: String(d.getDate()),
      dateKey,
      isToday: dateKey === todayKey,
      inMonth: true,
      ...counts,
    };
  });
}

/** 当月月历格子（含上下月补齐，周一开头） */
export function buildMonthCalendar(source: CalendarSource, anchor = source.now ?? new Date()): CalendarCell[] {
  const now = source.now ?? new Date();
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const gridStart = startOfWeekMonday(first);
  const byDate = aggregateByDate(source);
  const todayKey = toDateKey(now);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const dateKey = toDateKey(d);
    const counts = byDate.get(dateKey) ?? emptyCounts();
    return {
      key: dateKey,
      label: String(d.getDate()),
      dateKey,
      inMonth: d.getMonth() === month,
      isToday: dateKey === todayKey,
      ...counts,
    };
  });
}

export function cellActivityTotal(cell: Pick<CalendarCell, 'collab' | 'tasks' | 'alerts'>): number {
  return cell.collab + cell.tasks + cell.alerts;
}

export const WEEKDAY_LABELS_MON = ['一', '二', '三', '四', '五', '六', '日'] as const;
