import { describe, expect, it } from 'vitest';
import {
  asPercent,
  buildMonthCalendar,
  buildWeekCalendar,
  dayTimelineFromTrend,
  employeeHealthScore,
  mondayIndex,
  startOfWeekMonday,
  taskSuccessRate,
  toDateKey,
  aggregateByHour,
} from './home-metrics';

describe('home-metrics', () => {
  it('asPercent treats fractions and percents', () => {
    expect(asPercent(0.96)).toBe(96);
    expect(asPercent(96)).toBe(96);
    expect(asPercent(null)).toBeNull();
  });

  it('empty workforce yields null health', () => {
    expect(employeeHealthScore(0, 0)).toBeNull();
    expect(employeeHealthScore(2, 4)).toBe(50);
  });

  it('empty tasks yield null success rate', () => {
    expect(taskSuccessRate(0, 0)).toBeNull();
    expect(taskSuccessRate(1, 4)).toBe(25);
  });

  it('day timeline does not invent bars', () => {
    expect(dayTimelineFromTrend([])).toEqual([]);
    expect(dayTimelineFromTrend([{ time: '10:00', tasks: 2, collab: 0, alerts: 1 }])).toEqual([
      { label: '10:00', tasks: 2, collab: 0, alerts: 1 },
    ]);
  });

  it('week starts on Monday', () => {
    const sunday = new Date('2026-08-16T12:00:00');
    expect(mondayIndex(sunday)).toBe(6);
    expect(toDateKey(startOfWeekMonday(sunday))).toBe('2026-08-10');
  });

  it('builds a 7-day week calendar with activity counts', () => {
    const now = new Date('2026-08-18T10:00:00');
    const week = buildWeekCalendar({
      now,
      todayCollab: 2,
      tasks: [
        { updatedAt: '2026-08-17T08:00:00' },
        { updatedAt: '2026-08-18T09:00:00' },
      ],
      alerts: [{ time: '2026-08-18T11:00:00' }],
    }, now);
    expect(week).toHaveLength(7);
    expect(week[0]!.dateKey).toBe('2026-08-17'); // Monday of that week
    const tue = week.find((c) => c.dateKey === '2026-08-18');
    expect(tue?.tasks).toBe(1);
    expect(tue?.alerts).toBe(1);
    expect(tue?.collab).toBe(2);
    expect(tue?.isToday).toBe(true);
  });

  it('builds a 42-cell month calendar grid', () => {
    const now = new Date('2026-08-18T10:00:00');
    const month = buildMonthCalendar({
      now,
      tasks: [{ updatedAt: '2026-08-05T12:00:00' }],
      alerts: [],
    }, now);
    expect(month).toHaveLength(42);
    expect(month[0]!.dateKey).toBe('2026-07-27'); // Monday before Aug 1 2026 (Sat)
    const day5 = month.find((c) => c.dateKey === '2026-08-05');
    expect(day5?.inMonth).toBe(true);
    expect(day5?.tasks).toBe(1);
  });

  it('aggregates day hours from timestamps', () => {
    const now = new Date('2026-08-18T15:30:00');
    const hours = aggregateByHour({
      now,
      todayCollab: 1,
      tasks: [{ updatedAt: '2026-08-18T09:10:00' }],
      alerts: [{ time: '2026-08-18T09:40:00' }],
    }, now);
    expect(hours).toHaveLength(24);
    expect(hours[9]).toMatchObject({ tasks: 1, alerts: 1 });
    expect(hours[15]?.collab).toBe(1);
  });
});
