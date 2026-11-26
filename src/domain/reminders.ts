/** 到期提醒分桶：纯函数，不依赖 React / Dexie / store。 */
import type { ISODate, OccurrenceView, ScheduleOccurrence, ScheduledFlow } from './types';
import { addDaysISO } from './days';
import { buildOccurrenceViews } from './occurrences';

export interface ReminderBuckets {
  overdue: OccurrenceView[];
  dueToday: OccurrenceView[];
  upcoming: OccurrenceView[];
  total: number;
}

export function collectReminders(input: {
  flows: ScheduledFlow[];
  records: ScheduleOccurrence[];
  today: ISODate;
  advanceDays?: number;
  includeIncome?: boolean;
}): ReminderBuckets {
  const { flows, records, today } = input;
  const advanceDays = input.advanceDays === 1 || input.advanceDays === 3 ? input.advanceDays : 0;
  const includeIncome = input.includeIncome ?? false;
  const candidates = includeIncome ? flows : flows.filter((f) => f.kind === 'expense');
  const views = buildOccurrenceViews(candidates, records, addDaysISO(today, -90), addDaysISO(today, advanceDays), today);
  const pending = views.filter((v) => v.status === 'pending');
  return {
    overdue: pending.filter((v) => v.dueDate < today),
    dueToday: pending.filter((v) => v.dueDate === today),
    upcoming: pending.filter((v) => v.dueDate > today),
    total: pending.length,
  };
}

export function reminderKey(view: OccurrenceView, today: ISODate): string {
  return `${view.id}@${today}`;
}

function shortYuan(cents: number): string {
  return (cents / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function dueSuffix(view: OccurrenceView): string {
  if (view.daysUntilDue < 0) return `逾期 ${-view.daysUntilDue} 天`;
  if (view.daysUntilDue === 0) return '今日到期';
  return `${view.daysUntilDue} 天后到期`;
}

export function reminderTitle(buckets: ReminderBuckets): string {
  if (buckets.total === 0) return '暂无待处理计划';
  const parts: string[] = [];
  if (buckets.overdue.length > 0) parts.push(`${buckets.overdue.length} 笔逾期`);
  if (buckets.dueToday.length > 0) parts.push(`${buckets.dueToday.length} 笔今日到期`);
  if (buckets.upcoming.length > 0) parts.push(`${buckets.upcoming.length} 笔即将到期`);
  return `${buckets.total} 项待处理：${parts.join('、')}`;
}

export function reminderBody(buckets: ReminderBuckets, max = 3): string {
  const all = [...buckets.overdue, ...buckets.dueToday, ...buckets.upcoming];
  const lines = all.slice(0, max).map((v) => `${v.flow.title} ¥${shortYuan(v.amount)}（${dueSuffix(v)}）`);
  if (all.length > max) lines.push(`等 ${all.length} 项`);
  return lines.join('\n');
}
