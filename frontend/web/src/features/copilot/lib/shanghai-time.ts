/**
 * Shanghai timezone formatting helpers (used across Copilot and other modules).
 */
export const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

export function parseDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatShanghaiTime(value: string | number | Date): string {
  const date = parseDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: SHANGHAI_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function formatShanghaiDate(value: string | number | Date): string {
  const date = parseDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: SHANGHAI_TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric' }).format(date);
}