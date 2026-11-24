/** 周期计划实例：确定性推导 + 用户处理记录合并。 */
import type {
  ISODate,
  OccurrenceView,
  ScheduleOccurrence,
  ScheduledFlow,
} from './types';
import { addDaysISO, addMonthsAnchored, addYearsAnchored, diffDays } from './days';

export function occurrenceId(flowId: string, originalDueDate: ISODate): string {
  return `occ:${flowId}:${originalDueDate}`;
}

export function nextOccurrenceDate(flow: ScheduledFlow, current: ISODate): ISODate {
  const { unit, interval } = flow.rule;
  const step = Math.max(1, interval);
  let next: ISODate;
  if (unit === 'day') next = addDaysISO(current, step);
  else if (unit === 'week') next = addDaysISO(current, 7 * step);
  else if (unit === 'month') next = addMonthsAnchored(current, step, flow.anchorDay);
  else next = addYearsAnchored(current, flow.startDate, step, flow.anchorDay);
  if (next <= current) return addDaysISO(current, unit === 'day' ? step : unit === 'week' ? 7 * step : 365);
  return next;
}

export function expandFlowDates(flow: ScheduledFlow, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let cur = flow.startDate;
  let guard = 0;
  while (cur <= to && guard < 4000) {
    guard += 1;
    if (flow.endDate && cur > flow.endDate) break;
    if (cur >= from) out.push(cur);
    cur = nextOccurrenceDate(flow, cur);
  }
  return out;
}

/** 合并计划推导与用户处理记录，返回范围内的实例视图。 */
export function buildOccurrenceViews(
  flows: ScheduledFlow[],
  records: ScheduleOccurrence[],
  from: ISODate,
  to: ISODate,
  asOf: ISODate,
): OccurrenceView[] {
  const recById = new Map(records.map((r) => [r.id, r]));
  const views: OccurrenceView[] = [];
  for (const flow of flows) {
    if (!flow.enabled) continue;
    const dates = expandFlowDates(flow, from, to);
    for (const date of dates) {
      const id = occurrenceId(flow.id, date);
      const rec = recById.get(id);
      const dueDate = rec?.dueDate ?? date;
      const amount = rec?.amount ?? flow.amount;
      const status = rec?.status ?? 'pending';
      if (dueDate < from || dueDate > to) continue;
      views.push({
        id,
        flow,
        dueDate,
        originalDueDate: date,
        amount,
        status,
        transactionId: rec?.transactionId,
        overdue: status === 'pending' && dueDate < asOf,
        daysUntilDue: diffDays(asOf, dueDate),
      });
    }
  }
  views.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return a.flow.title.localeCompare(b.flow.title, 'zh-CN');
  });
  return views;
}

export function occurrenceLabel(view: OccurrenceView): string {
  if (view.status === 'settled') return '已核销';
  if (view.status === 'skipped') return '已跳过';
  if (view.status === 'canceled') return '已取消';
  if (view.overdue) return '逾期待确认';
  return '待发生';
}

export function pendingInRange(views: OccurrenceView[]): OccurrenceView[] {
  return views.filter((v) => v.status === 'pending');
}