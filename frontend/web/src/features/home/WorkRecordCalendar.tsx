import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@qzda/web-utils';
import {
  type CalendarCell,
  WEEKDAY_LABELS_MON,
  aggregateByHour,
  buildMonthCalendar,
  buildWeekCalendar,
  cellActivityTotal,
  toDateKey,
  type CalendarSource,
} from './home-metrics';

export type WorkRecordPeriod = 'day' | 'week' | 'month';

export type SelectDateOptions = { drillToDay?: boolean };

export type DayScheduleEvent = {
  id: string;
  kind: 'collab' | 'task' | 'alert';
  title: string;
  subtitle?: string;
  hour: number;
  minute: number;
  dateKey: string;
  to?: string;
  tone?: 'success' | 'error' | 'warn' | 'info' | 'neutral';
};

type Props = {
  period: WorkRecordPeriod;
  source: CalendarSource;
  selectedDateKey: string;
  onSelectDate: (dateKey: string, options?: SelectDateOptions) => void;
  /** 日视图日程事件（按小时落格） */
  dayEvents?: DayScheduleEvent[];
};

function dateFromKey(dateKey: string, fallback: Date): Date {
  const d = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function dayAriaLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return `查看 ${dateKey} 日程`;
  return `查看 ${d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })} 日程`;
}

function ActivityDots({ cell }: { cell: CalendarCell }) {
  const total = cellActivityTotal(cell);
  if (total <= 0) return <span className="home-cal__dots home-cal__dots--empty" aria-hidden />;
  return (
    <span className="home-cal__dots" aria-label={`协作 ${cell.collab} · 任务 ${cell.tasks} · 告警 ${cell.alerts}`}>
      {cell.collab > 0 && <i className="home-cal__dot home-cal__dot--collab" />}
      {cell.tasks > 0 && <i className="home-cal__dot home-cal__dot--tasks" />}
      {cell.alerts > 0 && <i className="home-cal__dot home-cal__dot--alerts" />}
    </span>
  );
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  d.setDate(d.getDate() + deltaDays);
  return toDateKey(d);
}

function kindLabel(kind: DayScheduleEvent['kind']) {
  if (kind === 'collab') return '协作';
  if (kind === 'alert') return '告警';
  return '任务';
}

function DaySchedule({
  source,
  selectedDateKey,
  onSelectDate,
  dayEvents = [],
}: Omit<Props, 'period'>) {
  const now = source.now ?? new Date();
  const todayKey = toDateKey(now);
  const isToday = selectedDateKey === todayKey;
  const scrollerRef = useRef<HTMLDivElement>(null);

  const dayEventsForDate = useMemo(
    () => dayEvents
      .filter((e) => e.dateKey === selectedDateKey)
      .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute)),
    [dayEvents, selectedDateKey],
  );

  const hours = useMemo(() => {
    const day = new Date(`${selectedDateKey}T12:00:00`);
    return aggregateByHour(source, Number.isNaN(day.getTime()) ? now : day);
  }, [source, selectedDateKey, now]);

  /** 有事件时聚焦事件前后 1 小时；否则展示工作时段 08–20 */
  const visibleHours = useMemo(() => {
    if (dayEventsForDate.length > 0) {
      const minH = Math.max(0, Math.min(...dayEventsForDate.map((e) => e.hour)) - 1);
      const maxH = Math.min(23, Math.max(...dayEventsForDate.map((e) => e.hour)) + 1);
      return hours.filter((h) => (h.hour ?? 0) >= minH && (h.hour ?? 0) <= maxH);
    }
    return hours.filter((h) => (h.hour ?? 0) >= 8 && (h.hour ?? 0) <= 20);
  }, [hours, dayEventsForDate]);

  const eventsByHour = useMemo(() => {
    const map = new Map<number, DayScheduleEvent[]>();
    for (const event of dayEventsForDate) {
      const list = map.get(event.hour) ?? [];
      list.push(event);
      map.set(event.hour, list);
    }
    return map;
  }, [dayEventsForDate]);

  const summary = useMemo(() => {
    let collab = 0;
    let tasks = 0;
    let alerts = 0;
    for (const e of dayEventsForDate) {
      if (e.kind === 'collab') collab += 1;
      else if (e.kind === 'alert') alerts += 1;
      else tasks += 1;
    }
    // 无明细事件时回退小时聚合（含今日协作计数）
    if (dayEventsForDate.length === 0) {
      for (const h of hours) {
        collab += h.collab;
        tasks += h.tasks;
        alerts += h.alerts;
      }
    }
    return { collab, tasks, alerts, total: collab + tasks + alerts };
  }, [dayEventsForDate, hours]);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const targetHour = isToday ? now.getHours() : (dayEventsForDate[0]?.hour ?? 9);
    const row = root.querySelector<HTMLElement>(`[data-hour="${targetHour}"]`);
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [selectedDateKey, isToday, now, dayEventsForDate]);

  const dateTitle = useMemo(() => {
    const d = new Date(`${selectedDateKey}T12:00:00`);
    if (Number.isNaN(d.getTime())) return selectedDateKey;
    return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
  }, [selectedDateKey]);

  return (
    <div className="home-cal home-cal--day" aria-label="日视图日程">
      <div className="home-cal__day-toolbar">
        <div className="home-cal__day-nav">
          <button type="button" className="home-cal__nav-btn" aria-label="前一天" onClick={() => onSelectDate(shiftDateKey(selectedDateKey, -1))}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={cn('home-cal__day-title', isToday && 'is-today')}
            onClick={() => onSelectDate(todayKey)}
            title="回到今天"
          >
            {dateTitle}
            {isToday && <em>今天</em>}
          </button>
          <button type="button" className="home-cal__nav-btn" aria-label="后一天" onClick={() => onSelectDate(shiftDateKey(selectedDateKey, 1))}>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="home-cal__legend">
          <span><i className="home-cal__dot home-cal__dot--collab" />协作 {summary.collab}</span>
          <span><i className="home-cal__dot home-cal__dot--tasks" />任务 {summary.tasks}</span>
          <span><i className="home-cal__dot home-cal__dot--alerts" />告警 {summary.alerts}</span>
        </div>
      </div>

      <div className="home-cal__schedule" ref={scrollerRef}>
        {visibleHours.map((cell) => {
          const hour = cell.hour ?? 0;
          const slotEvents = eventsByHour.get(hour) ?? [];
          const isNow = isToday && hour === now.getHours();
          const countOnly = slotEvents.length === 0 && cellActivityTotal(cell) > 0;

          return (
            <div
              key={cell.key}
              data-hour={hour}
              className={cn('home-cal__schedule-row', isNow && 'is-now', (slotEvents.length > 0 || countOnly) && 'has-activity')}
            >
              <div className="home-cal__schedule-hour">
                <span>{cell.label}</span>
              </div>
              <div className="home-cal__schedule-lane">
                {isNow && (
                  <div
                    className="home-cal__now-line"
                    style={{ top: `${Math.min(90, Math.max(8, (now.getMinutes() / 60) * 100))}%` }}
                    aria-hidden
                  />
                )}
                {slotEvents.length > 0 ? (
                  <div className="home-cal__event-stack">
                    {slotEvents.map((event) => {
                      const body = (
                        <>
                          <span className="home-cal__event-meta">
                            <em>{kindLabel(event.kind)}</em>
                            <time>{`${String(event.hour).padStart(2, '0')}:${String(event.minute).padStart(2, '0')}`}</time>
                          </span>
                          <strong className="home-cal__event-title">{event.title}</strong>
                          {event.subtitle && <span className="home-cal__event-sub">{event.subtitle}</span>}
                        </>
                      );
                      const className = cn('home-cal__event', `home-cal__event--${event.kind}`, event.tone && `is-${event.tone}`);
                      return event.to ? (
                        <Link key={event.id} to={event.to} className={className}>{body}</Link>
                      ) : (
                        <div key={event.id} className={className}>{body}</div>
                      );
                    })}
                  </div>
                ) : countOnly ? (
                  <div className="home-cal__event-stack">
                    {cell.collab > 0 && <div className="home-cal__event home-cal__event--collab home-cal__event--ghost">协作 · {cell.collab}</div>}
                    {cell.tasks > 0 && <div className="home-cal__event home-cal__event--task home-cal__event--ghost">任务 · {cell.tasks}</div>}
                    {cell.alerts > 0 && <div className="home-cal__event home-cal__event--alert home-cal__event--ghost">告警 · {cell.alerts}</div>}
                  </div>
                ) : (
                  <span className="home-cal__schedule-empty" aria-hidden />
                )}
              </div>
            </div>
          );
        })}

        {summary.total === 0 && (
          <div className="home-cal__day-empty">
            <p>当日暂无运行痕迹</p>
            <span>可切换到「周 / 月」查看有活动的日期，或用上方箭头换一天</span>
          </div>
        )}
      </div>
    </div>
  );
}

function WeekCalendar({ source, selectedDateKey, onSelectDate }: Omit<Props, 'period' | 'dayEvents'>) {
  const anchor = useMemo(() => dateFromKey(selectedDateKey, source.now ?? new Date()), [selectedDateKey, source.now]);
  const cells = buildWeekCalendar(source, anchor);
  return (
    <div className="home-cal home-cal--week" role="grid" aria-label="周视图">
      <div className="home-cal__weekdays">
        {WEEKDAY_LABELS_MON.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="home-cal__week-grid">
        {cells.map((cell) => (
          <button
            key={cell.key}
            type="button"
            role="gridcell"
            className={cn(
              'home-cal__cell',
              cell.isToday && 'is-today',
              cell.dateKey === selectedDateKey && 'is-selected',
              cellActivityTotal(cell) > 0 && 'has-activity',
            )}
            aria-label={dayAriaLabel(cell.dateKey)}
            title="查看当日日程"
            onClick={() => onSelectDate(cell.dateKey, { drillToDay: true })}
          >
            <span className="home-cal__cell-day">{cell.label}</span>
            <ActivityDots cell={cell} />
            {cellActivityTotal(cell) > 0 && (
              <span className="home-cal__cell-count">{cellActivityTotal(cell)}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function MonthCalendar({ source, selectedDateKey, onSelectDate }: Omit<Props, 'period' | 'dayEvents'>) {
  const anchor = useMemo(() => dateFromKey(selectedDateKey, source.now ?? new Date()), [selectedDateKey, source.now]);
  const cells = buildMonthCalendar(source, anchor);
  return (
    <div className="home-cal home-cal--month" role="grid" aria-label="月视图">
      <div className="home-cal__weekdays">
        {WEEKDAY_LABELS_MON.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="home-cal__month-grid">
        {cells.map((cell) => (
          <button
            key={cell.key}
            type="button"
            role="gridcell"
            className={cn(
              'home-cal__cell home-cal__cell--month',
              !cell.inMonth && 'is-outside',
              cell.isToday && 'is-today',
              cell.dateKey === selectedDateKey && 'is-selected',
              cellActivityTotal(cell) > 0 && 'has-activity',
            )}
            aria-label={dayAriaLabel(cell.dateKey)}
            title="查看当日日程"
            onClick={() => onSelectDate(cell.dateKey, { drillToDay: true })}
          >
            <span className="home-cal__cell-day">{cell.label}</span>
            <ActivityDots cell={cell} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function WorkRecordCalendar({ period, source, selectedDateKey, onSelectDate, dayEvents }: Props) {
  const now = source.now ?? new Date();
  const resolvedKey = selectedDateKey || toDateKey(now);

  if (period === 'day') {
    return (
      <DaySchedule
        source={source}
        selectedDateKey={resolvedKey}
        onSelectDate={onSelectDate}
        dayEvents={dayEvents}
      />
    );
  }
  if (period === 'week') {
    return <WeekCalendar source={source} selectedDateKey={resolvedKey} onSelectDate={onSelectDate} />;
  }
  return <MonthCalendar source={source} selectedDateKey={resolvedKey} onSelectDate={onSelectDate} />;
}
