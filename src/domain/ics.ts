/** iCalendar (.ics) 生成：纯函数。行尾 \r\n、每行 75 字节折行、RFC 5545 转义。 */
import type { Account, ISODate, OccurrenceView, ScheduleOccurrence, ScheduledFlow } from './types';
import { addDaysISO } from './days';
import { buildOccurrenceViews } from './occurrences';

function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** RFC 5545 折行：每行最多 75 字节，续行以单个空格开头。 */
function foldLine(line: string): string {
  if (utf8Bytes(line) <= 75) return line;
  const chunks: string[] = [];
  let cur = '';
  let cap = 75;
  for (const ch of line) {
    if (cur !== '' && utf8Bytes(cur) + utf8Bytes(ch) > cap) {
      chunks.push(cur);
      cur = '';
      cap = 74;
    }
    cur += ch;
  }
  if (cur !== '') chunks.push(cur);
  return chunks.join('\r\n ');
}

function shortYuan(cents: number): string {
  return (cents / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function dueLabel(view: OccurrenceView): string {
  if (view.daysUntilDue < 0) return `逾期 ${-view.daysUntilDue} 天`;
  if (view.daysUntilDue === 0) return '今日到期';
  return `${view.daysUntilDue} 天后到期`;
}

function dateCompact(iso: ISODate): string {
  return iso.replace(/-/g, '');
}

export function buildICS(input: {
  flows: ScheduledFlow[];
  records: ScheduleOccurrence[];
  today: ISODate;
  days?: number;
  calendarName?: string;
  accounts?: Account[];
}): string {
  const { flows, records, today } = input;
  const days = input.days ?? 90;
  const calendarName = input.calendarName ?? 'MoneyFlow 到期提醒';
  const accountNames = new Map((input.accounts ?? []).map((a) => [a.id, a.name]));
  const views = buildOccurrenceViews(
    flows.filter((f) => f.kind === 'expense'),
    records,
    addDaysISO(today, -90),
    addDaysISO(today, days),
    today,
  ).filter((v) => v.status === 'pending');

  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MoneyFlow//CN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${calendarName}`];
  for (const view of views) {
    const title = view.flow.title;
    const summary = `¥${shortYuan(view.amount)} ${title}（MoneyFlow）`;
    const accountName = accountNames.get(view.flow.accountId);
    const base = ['固定支出'];
    if (accountName) base.push(accountName);
    base.push(dueLabel(view));
    const description = view.flow.note ? `${base.join(' · ')}\n备注：${view.flow.note}` : base.join(' · ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${view.id}@moneyflow`,
      `DTSTART;VALUE=DATE:${dateCompact(view.dueDate)}`,
      `DTEND;VALUE=DATE:${dateCompact(addDaysISO(view.dueDate, 1))}`,
      `SUMMARY:${icsEscape(summary)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      'BEGIN:VALARM',
      'TRIGGER:PT9H',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(`到期提醒：${title}`)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
