import { describe, expect, it } from 'vitest';
import { defaultGroupFor, groupKey, groupLabel, rangeDayCount, rangeStart } from '../../src/lib/period';
import {
  PERIOD_UNITS,
  clampAnchor,
  isInPeriod,
  periodCardLabel,
  periodDays,
  periodLabel,
  periodOf,
  previousPeriod,
  shiftAnchor,
  shiftPeriod,
  type PeriodUnit,
} from '../../src/domain/period';

describe('统一周期模型', () => {
  it('周：锚点所在周的周一到周日', () => {
    const p = periodOf('week', '2026-11-26');
    expect(p.start).toBe('2026-11-23');
    expect(p.end).toBe('2026-11-29');
    expect(p.key).toBe('week:2026-11-23');
  });

  it('跨年周：起止跨两个年份，长标签带两个年份', () => {
    const p = periodOf('week', '2026-01-01');
    expect(p.start).toBe('2025-12-29');
    expect(p.end).toBe('2026-01-04');
    const label = periodLabel(p);
    expect(label).toContain('2025');
    expect(label).toContain('2026');
    expect(label).toBe('2025年12月29日–2026年1月4日');
  });

  it('闰年 2 月：月周期收在 2 月 29 日', () => {
    const p = periodOf('month', '2024-02-29');
    expect(p.start).toBe('2024-02-01');
    expect(p.end).toBe('2024-02-29');
  });

  it('闰年全年 366 天', () => {
    expect(periodDays(periodOf('year', '2024-06-01'))).toBe(366);
  });

  it('月份翻页先归一到 1 号，1 月 31 日不漂移到 28 号', () => {
    expect(shiftAnchor('month', '2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftAnchor('month', '2026-01-31', 2)).toBe('2026-03-01');
    expect(shiftAnchor('month', '2026-11-15', -1)).toBe('2026-10-01');
  });

  it('shiftPeriod 连续 +1/-1 回到原值', () => {
    const base = periodOf('week', '2026-11-26');
    const next = shiftPeriod(base, 1);
    expect(next.key).toBe('week:2026-11-30');
    const back = shiftPeriod(next, -1);
    expect(back.key).toBe(base.key);
    expect(back.start).toBe(base.start);
    expect(back.end).toBe(base.end);
  });

  it('previousPeriod 跨年：2026-01 的上期是 2025-12', () => {
    const prev = previousPeriod(periodOf('month', '2026-01-15'));
    expect(prev.start).toBe('2025-12-01');
    expect(prev.end).toBe('2025-12-31');
  });

  it('isInPeriod 含端点：起止两天为 true，前后一天为 false', () => {
    const p = periodOf('month', '2026-11-26');
    expect(isInPeriod('2026-11-01', p)).toBe(true);
    expect(isInPeriod('2026-11-30', p)).toBe(true);
    expect(isInPeriod('2026-10-31', p)).toBe(false);
    expect(isInPeriod('2026-12-01', p)).toBe(false);
  });

  it('clampAnchor：未来锚点夹回今天', () => {
    expect(clampAnchor('2030-01-01', '2026-11-26')).toBe('2026-11-26');
    expect(clampAnchor('2026-11-20', '2026-11-26')).toBe('2026-11-20');
  });

  it('非法 unit 抛错', () => {
    expect(() => periodOf('quarter' as PeriodUnit, '2026-11-26')).toThrow();
  });

  it('标签：日带星期，月与年带年份，跨月周省略年份', () => {
    expect(periodLabel(periodOf('day', '2026-11-26'))).toBe('11月26日 周四');
    expect(periodLabel(periodOf('month', '2026-11-26'))).toBe('2026年11月');
    expect(periodLabel(periodOf('year', '2026-11-26'))).toBe('2026年');
    const crossMonth = periodOf('week', '2026-12-01');
    expect(periodLabel(crossMonth)).toBe('11月30日–12月6日');
  });

  it('卡片短标签：当前年省略年份，跨年周带完整日期', () => {
    const today = '2026-11-26';
    expect(periodCardLabel(periodOf('day', '2026-11-26'), today)).toBe('11月26日');
    expect(periodCardLabel(periodOf('day', '2025-11-26'), today)).toBe('2025年11月26日');
    expect(periodCardLabel(periodOf('week', '2026-11-26'), today)).toBe('11.23–11.29');
    expect(periodCardLabel(periodOf('week', '2026-01-01'), today)).toBe('2025.12.29–2026.1.4');
    expect(periodCardLabel(periodOf('month', '2026-11-26'), today)).toBe('11月');
    expect(periodCardLabel(periodOf('month', '2025-11-26'), today)).toBe('2025年11月');
    expect(periodCardLabel(periodOf('year', '2026-11-26'), today)).toBe('2026年');
  });

  it('PERIOD_UNITS 顺序为日/周/月/年', () => {
    expect(PERIOD_UNITS.map((u) => u.value)).toEqual(['day', 'week', 'month', 'year']);
    expect(PERIOD_UNITS.map((u) => u.label)).toEqual(['日', '周', '月', '年']);
  });
});

describe('流水监测区间', () => {
  it('以截止日为终点计算 1 天、1 周、1 个月、3 个月、半年与 1 年', () => {
    expect(rangeStart('2026-11-25', 'day')).toBe('2026-11-25');
    expect(rangeStart('2026-11-25', 'week')).toBe('2026-11-19');
    expect(rangeStart('2026-11-25', 'month')).toBe('2026-10-26');
    expect(rangeStart('2026-11-25', 'quarter')).toBe('2026-08-26');
    expect(rangeStart('2026-11-25', 'half')).toBe('2026-05-26');
    expect(rangeStart('2026-11-25', 'year')).toBe('2025-11-26');
  });

  it('区间天数包含首尾日期', () => {
    expect(rangeDayCount('2026-11-25', '2026-11-25')).toBe(1);
    expect(rangeDayCount('2026-11-19', '2026-11-25')).toBe(7);
  });

  it('默认分组随跨度切换，并支持日/月/年个体单位', () => {
    expect(defaultGroupFor('week')).toBe('day');
    expect(defaultGroupFor('quarter')).toBe('month');
    expect(defaultGroupFor('year')).toBe('month');
    expect(groupKey('2026-11-25', 'day')).toBe('2026-11-25');
    expect(groupKey('2026-11-25', 'month')).toBe('2026-11');
    expect(groupKey('2026-11-25', 'year')).toBe('2026');
    expect(groupLabel('2026-11', 'month')).toContain('2026');
    expect(groupLabel('2026', 'year')).toContain('2026');
  });
});
