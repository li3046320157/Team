/** 统一统计周期模型：日/周/月/年 + 锚点。纯日历运算，不依赖 React / Dexie / 业务对象。 */
import type { ISODate } from './types';
import {
  addDaysISO,
  addMonthsAnchored,
  diffDays,
  endOfMonthISO,
  formatCN,
  parseISODate,
  startOfMonthISO,
  weekdayIndex,
} from './days';

export type PeriodUnit = 'day' | 'week' | 'month' | 'year';

export interface Period {
  unit: PeriodUnit;
  start: ISODate;
  end: ISODate; // 含端点
  key: string; // `${unit}:${start}`，用于 useMemo 依赖与 URL
}

export const PERIOD_UNITS: ReadonlyArray<{ value: PeriodUnit; label: string }> = [
  { value: 'day', label: '日' },
  { value: 'week', label: '周' },
  { value: 'month', label: '月' },
  { value: 'year', label: '年' },
];

const UNIT_SET = new Set<string>(PERIOD_UNITS.map((u) => u.value));

export function isPeriodUnit(v: string): v is PeriodUnit {
  return UNIT_SET.has(v);
}

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function periodOf(unit: PeriodUnit, anchor: ISODate): Period {
  let start: ISODate;
  let end: ISODate;
  if (unit === 'day') {
    start = anchor;
    end = anchor;
  } else if (unit === 'week') {
    // 中国习惯：周一为首日
    const offset = (weekdayIndex(anchor) + 6) % 7;
    start = addDaysISO(anchor, -offset);
    end = addDaysISO(start, 6);
  } else if (unit === 'month') {
    start = startOfMonthISO(anchor);
    end = endOfMonthISO(anchor);
  } else if (unit === 'year') {
    start = `${anchor.slice(0, 4)}-01-01`;
    end = `${anchor.slice(0, 4)}-12-31`;
  } else {
    throw new Error(`非法周期单位：${String(unit)}`);
  }
  return { unit, start, end, key: `${unit}:${start}` };
}

/** 月份翻页必须先归一到 1 号再位移，避免 31 号持续漂移。 */
export function shiftAnchor(unit: PeriodUnit, anchor: ISODate, delta: number): ISODate {
  if (unit === 'day') return addDaysISO(anchor, delta);
  if (unit === 'week') return addDaysISO(anchor, 7 * delta);
  if (unit === 'month') return addMonthsAnchored(startOfMonthISO(anchor), delta, 1);
  if (unit === 'year') return `${Number(anchor.slice(0, 4)) + delta}-01-01`;
  throw new Error(`非法周期单位：${String(unit)}`);
}

export function shiftPeriod(period: Period, delta: number): Period {
  return periodOf(period.unit, shiftAnchor(period.unit, period.start, delta));
}

export function previousPeriod(period: Period): Period {
  return shiftPeriod(period, -1);
}

export function periodDays(period: Period): number {
  return diffDays(period.start, period.end) + 1;
}

export function isInPeriod(date: ISODate, period: Period): boolean {
  return date >= period.start && date <= period.end;
}

export function clampAnchor(anchor: ISODate, today: ISODate): ISODate {
  return anchor > today ? today : anchor;
}

function cnFull(iso: ISODate): string {
  const d = parseISODate(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function compactDate(iso: ISODate): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}.${Number(d)}`;
}

function yearCompact(iso: ISODate): string {
  const [y, m, d] = iso.split('-');
  return `${y}.${Number(m)}.${Number(d)}`;
}

export function periodLabel(period: Period): string {
  if (period.unit === 'day') {
    return `${formatCN(period.start)} ${WEEKDAY_CN[weekdayIndex(period.start)]}`;
  }
  if (period.unit === 'week') {
    if (period.start.slice(0, 4) === period.end.slice(0, 4)) {
      return `${formatCN(period.start)}–${formatCN(period.end)}`;
    }
    return `${cnFull(period.start)}–${cnFull(period.end)}`;
  }
  if (period.unit === 'month') {
    const d = parseISODate(period.start);
    return `${d.getFullYear()}年${d.getMonth() + 1}月`;
  }
  return `${period.start.slice(0, 4)}年`;
}

/** 短标签（StatCard 用）：当前年份省略年份，避免换行；today 缺省时始终带年份信息。 */
export function periodCardLabel(period: Period, today?: ISODate): string {
  const sameYear = !today || period.start.slice(0, 4) === today.slice(0, 4);
  switch (period.unit) {
    case 'day':
      return sameYear ? formatCN(period.start) : cnFull(period.start);
    case 'week': {
      if (period.start.slice(0, 4) !== period.end.slice(0, 4)) {
        return `${yearCompact(period.start)}–${yearCompact(period.end)}`;
      }
      const rest = `${compactDate(period.start)}–${compactDate(period.end)}`;
      return sameYear ? rest : `${period.start.slice(0, 4)}.${rest}`;
    }
    case 'month': {
      const m = Number(period.start.slice(5, 7));
      return sameYear ? `${m}月` : `${period.start.slice(0, 4)}年${m}月`;
    }
    default:
      return `${period.start.slice(0, 4)}年`;
  }
}
