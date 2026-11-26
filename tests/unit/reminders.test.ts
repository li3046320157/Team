import { describe, expect, it } from 'vitest';
import { collectReminders, reminderBody, reminderKey, reminderTitle } from '../../src/domain/reminders';
import { buildOccurrenceViews } from '../../src/domain/occurrences';
import type { ScheduledFlow, ScheduleOccurrence } from '../../src/domain/types';
import { makeFlow } from './fixtures';

const TODAY = '2026-11-25';

function flow(over: Partial<ScheduledFlow>): ScheduledFlow {
  return makeFlow({ kind: 'expense', rule: { unit: 'day', interval: 1 }, ...over });
}

describe('collectReminders', () => {
  it('3 笔逾期 + 1 笔今日到期 + 2 笔未来 → 分桶正确、total 正确', () => {
    const flows = [flow({ id: 'flow_a', title: '房租', amount: 450_000, startDate: '2026-11-22', endDate: '2026-11-27' })];
    const buckets = collectReminders({ flows, records: [], today: TODAY, advanceDays: 3 });
    expect(buckets.overdue.map((v) => v.dueDate)).toEqual(['2026-11-22', '2026-11-23', '2026-11-24']);
    expect(buckets.dueToday.map((v) => v.dueDate)).toEqual(['2026-11-25']);
    expect(buckets.upcoming.map((v) => v.dueDate)).toEqual(['2026-11-26', '2026-11-27']);
    expect(buckets.total).toBe(6);
  });

  it('advanceDays=3 时未来 3 天内的进入 upcoming，更远的排除；advanceDays=0 时 upcoming 为空', () => {
    const flows = [flow({ id: 'flow_b', startDate: '2026-11-26' })];
    const three = collectReminders({ flows, records: [], today: TODAY, advanceDays: 3 });
    expect(three.upcoming.map((v) => v.dueDate)).toEqual(['2026-11-26', '2026-11-27', '2026-11-28']);
    const one = collectReminders({ flows, records: [], today: TODAY, advanceDays: 1 });
    expect(one.upcoming.map((v) => v.dueDate)).toEqual(['2026-11-26']);
    const zero = collectReminders({ flows, records: [], today: TODAY, advanceDays: 0 });
    expect(zero.upcoming).toEqual([]);
  });

  it('已 settled / skipped / canceled 的实例不进入任何桶', () => {
    const flows = [flow({ id: 'flow_c', startDate: '2026-11-22', endDate: '2026-11-27' })];
    const records: ScheduleOccurrence[] = [
      { id: 'occ:flow_c:2026-11-22', flowId: 'flow_c', originalDueDate: '2026-11-22', dueDate: '2026-11-22', amount: 200_000, status: 'settled' },
      { id: 'occ:flow_c:2026-11-23', flowId: 'flow_c', originalDueDate: '2026-11-23', dueDate: '2026-11-23', amount: 200_000, status: 'skipped' },
      { id: 'occ:flow_c:2026-11-24', flowId: 'flow_c', originalDueDate: '2026-11-24', dueDate: '2026-11-24', amount: 200_000, status: 'canceled' },
    ];
    const buckets = collectReminders({ flows, records, today: TODAY, advanceDays: 3 });
    expect(buckets.overdue).toEqual([]);
    expect(buckets.dueToday.map((v) => v.dueDate)).toEqual(['2026-11-25']);
    expect(buckets.upcoming.map((v) => v.dueDate)).toEqual(['2026-11-26', '2026-11-27']);
    expect(buckets.total).toBe(3);
  });

  it('默认不提醒收入；includeIncome=true 时收入进入分桶', () => {
    const flows = [flow({ id: 'flow_inc', kind: 'income', startDate: '2026-11-20' })];
    const def = collectReminders({ flows, records: [], today: TODAY, advanceDays: 3 });
    expect(def.total).toBe(0);
    const withIncome = collectReminders({ flows, records: [], today: TODAY, advanceDays: 3, includeIncome: true });
    expect(withIncome.overdue.length).toBe(5);
    expect(withIncome.overdue.every((v) => v.flow.kind === 'income')).toBe(true);
  });
});

describe('reminderKey / reminderTitle / reminderBody', () => {
  it('reminderKey 同一天稳定、跨天变化', () => {
    const flows = [flow({ id: 'flow_k', startDate: '2026-11-24' })];
    const [view] = buildOccurrenceViews(flows, [], '2026-11-24', TODAY, TODAY);
    expect(view).toBeDefined();
    expect(reminderKey(view!, TODAY)).toBe(reminderKey(view!, TODAY));
    expect(reminderKey(view!, TODAY)).toBe(`${view!.id}@${TODAY}`);
    expect(reminderKey(view!, '2026-11-26')).toBe(`${view!.id}@2026-11-26`);
    expect(reminderKey(view!, TODAY)).not.toBe(reminderKey(view!, '2026-11-26'));
  });

  it('reminderTitle 组合各桶计数；reminderBody 逐条列出并受 max 截断', () => {
    const flows = [flow({ id: 'flow_t', title: '房租', amount: 450_000, startDate: '2026-11-23', endDate: '2026-11-26' })];
    const buckets = collectReminders({ flows, records: [], today: TODAY, advanceDays: 3 });
    expect(reminderTitle(buckets)).toBe('4 项待处理：2 笔逾期、1 笔今日到期、1 笔即将到期');
    const body = reminderBody(buckets, 2);
    const lines = body.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('房租');
    expect(lines[0]).toContain('¥4,500');
    expect(lines[0]).toContain('逾期 2 天');
    expect(lines[1]).toContain('逾期 1 天');
    expect(lines[2]).toBe('等 4 项');
    const empty = { overdue: [], dueToday: [], upcoming: [], total: 0 };
    expect(reminderTitle(empty)).toBe('暂无待处理计划');
  });
});
