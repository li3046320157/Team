/** 本地日历日期工具。业务日期为 YYYY-MM-DD，不经过 UTC 截断，避免跨时区偏移。 */

export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`非法日期：${s}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d, 12, 0, 0, 0);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    throw new Error(`非法日期：${s}`);
  }
  return date;
}

export function isValidISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string') return false;
  try {
    parseISODate(s);
    return true;
  } catch {
    return false;
  }
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISO(now);
}

export function addDaysISO(iso: ISODate, days: number): ISODate {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

/** 0=周日 ... 6=周六 */
export function weekdayIndex(iso: ISODate): number {
  return parseISODate(iso).getDay();
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0, 12, 0, 0, 0).getDate();
}

export function monthKey(iso: ISODate): string {
  return iso.slice(0, 7);
}

export function startOfMonthISO(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonthISO(iso: ISODate): ISODate {
  const d = parseISODate(iso);
  const dim = daysInMonth(d.getFullYear(), d.getMonth() + 1);
  return `${iso.slice(0, 7)}-${pad(dim)}`;
}

export function clampDayToMonth(year: number, month1: number, day: number): ISODate {
  const dim = daysInMonth(year, month1);
  return `${year}-${pad(month1)}-${pad(Math.min(Math.max(1, day), dim))}`;
}

export function daysInMonthOf(iso: ISODate): number {
  const d = parseISODate(iso);
  return daysInMonth(d.getFullYear(), d.getMonth() + 1);
}

/** 以 anchorDay 为原始日号，向后推移 n 个月；月底自动截断，不永久漂移。 */
export function addMonthsAnchored(iso: ISODate, months: number, anchorDay: number): ISODate {
  const d = parseISODate(iso);
  const total = d.getFullYear() * 12 + d.getMonth() + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return clampDayToMonth(y, m, anchorDay);
}

export function addYearsAnchored(iso: ISODate, startISO: ISODate, years: number, anchorDay: number): ISODate {
  const s = parseISODate(startISO);
  const y = s.getFullYear() + years;
  return clampDayToMonth(y, s.getMonth() + 1, anchorDay);
}

export function minISO(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}
export function maxISO(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

export function enumerateDays(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  if (start > end) return out;
  const total = diffDays(start, end);
  for (let i = 0; i <= total && i < 4000; i += 1) {
    out.push(addDaysISO(start, i));
  }
  return out;
}

export function formatCN(iso: ISODate): string {
  if (!isValidISODate(iso)) return iso;
  const [, m, d] = iso.split('-');
  return `${Number(m)}月${Number(d)}日`;
}

export function listMonthStarts(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let cur = startOfMonthISO(start);
  while (cur <= end && out.length < 400) {
    out.push(cur);
    const d = parseISODate(cur);
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1, 12);
    cur = toISO(next);
  }
  return out;
}

export function isWeekend(iso: ISODate): boolean {
  const w = weekdayIndex(iso);
  return w === 0 || w === 6;
}

export function overlapDays(aStart: ISODate, aEnd: ISODate, bStart: ISODate, bEnd: ISODate): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}