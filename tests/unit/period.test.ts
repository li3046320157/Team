import { describe, expect, it } from 'vitest';
import { defaultGroupFor, groupKey, groupLabel, rangeDayCount, rangeStart } from '../../src/lib/period';

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