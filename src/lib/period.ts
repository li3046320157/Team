import { addDaysISO, addMonthsAnchored, diffDays, parseISODate } from '../domain/days';
import type { ISODate } from '../domain/types';

export type MonitorRange = 'day' | 'week' | 'month' | 'quarter' | 'half' | 'year';
export type GroupUnit = 'day' | 'month' | 'year';

export const RANGE_OPTIONS: { value: MonitorRange; label: string }[] = [
  { value: 'day', label: '1 天' },
  { value: 'week', label: '1 周' },
  { value: 'month', label: '1 个月' },
  { value: 'quarter', label: '3 个月' },
  { value: 'half', label: '半年' },
  { value: 'year', label: '1 年' },
];

export const GROUP_OPTIONS: { value: GroupUnit; label: string }[] = [
  { value: 'day', label: '按日' },
  { value: 'month', label: '按月' },
  { value: 'year', label: '按年' },
];

const MONTH_SPAN: Partial<Record<MonitorRange, number>> = { month: 1, quarter: 3, half: 6, year: 12 };

/** 以 end 为截止日，返回包含 end 的监测区间起点（闭区间）。 */
export function rangeStart(end: ISODate, range: MonitorRange): ISODate {
  if (range === 'day') return end;
  if (range === 'week') return addDaysISO(end, -6);
  const months = MONTH_SPAN[range] ?? 0;
  const anchor = parseISODate(end).getDate();
  return addDaysISO(addMonthsAnchored(end, -months, anchor), 1);
}

export function rangeDayCount(start: ISODate, end: ISODate): number {
  return Math.max(1, diffDays(start, end) + 1);
}

export function defaultGroupFor(range: MonitorRange): GroupUnit {
  return range === 'day' || range === 'week' || range === 'month' ? 'day' : 'month';
}

export function groupKey(date: ISODate, unit: GroupUnit): string {
  if (unit === 'day') return date;
  if (unit === 'month') return date.slice(0, 7);
  return date.slice(0, 4);
}

export function fullDateCN(iso: ISODate): string {
  const [y, m, d] = iso.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
}

export function groupLabel(key: string, unit: GroupUnit): string {
  if (unit === 'day') return fullDateCN(key);
  if (unit === 'month') return `${key.slice(0, 4)} 年 ${Number(key.slice(5, 7))} 月`;
  return `${key} 年`;
}