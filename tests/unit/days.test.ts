import { describe, expect, it } from 'vitest';
import {
  addDaysISO,
  addMonthsAnchored,
  addYearsAnchored,
  daysInMonth,
  diffDays,
  enumerateDays,
  isValidISODate,
  weekdayIndex,
} from '../../src/domain/days';
import { nextOccurrenceDate } from '../../src/domain/occurrences';
import { makeFlow } from './fixtures';

describe('本地日期工具', () => {
  it('拒绝非法日期', () => {
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-2-1')).toBe(false);
    expect(isValidISODate('2026-02-28')).toBe(true);
  });

  it('闰年与月底', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(isValidISODate('2028-02-29')).toBe(true);
  });

  it('月度锚点不永久漂移', () => {
    const jan31 = '2026-01-31';
    const feb = addMonthsAnchored(jan31, 1, 31);
    expect(feb).toBe('2026-02-28');
    const mar = addMonthsAnchored(feb, 1, 31);
    expect(mar).toBe('2026-03-31');
    const apr = addMonthsAnchored(mar, 1, 31);
    expect(apr).toBe('2026-04-30');
  });

  it('年度重复按起始月日锚定', () => {
    expect(addYearsAnchored('2028-02-29', '2028-02-29', 1, 29)).toBe('2029-02-28');
    expect(addYearsAnchored('2026-06-15', '2026-06-15', 3, 15)).toBe('2029-06-15');
  });

  it('跨月跨年天数', () => {
    expect(diffDays('2026-02-01', '2026-03-01')).toBe(28);
    expect(diffDays('2026-12-31', '2027-01-01')).toBe(1);
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysISO('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('星期索引与枚举', () => {
    expect(weekdayIndex('2026-06-01')).toBe(1); // 周一
    expect(enumerateDays('2026-06-01', '2026-06-03')).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
  });

  it('月度计划实例在月底截断后仍回到 31 日', () => {
    const flow = makeFlow({ startDate: '2026-01-31', anchorDay: 31, rule: { unit: 'month', interval: 1 } });
    const feb = nextOccurrenceDate(flow, '2026-01-31');
    const mar = nextOccurrenceDate(flow, feb);
    expect(feb).toBe('2026-02-28');
    expect(mar).toBe('2026-03-31');
  });
});