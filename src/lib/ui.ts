import { formatMoney } from '../domain/money';
import type { FreqUnit, ISODate, TxnKind, TxnNature } from '../domain/types';
import { formatCN } from '../domain/days';

export { formatMoney };

export function weekdayCN(index: number): string {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][index] ?? '';
}

export function frequencyLabel(unit: FreqUnit, interval: number): string {
  if (interval === 1) return { day: '每天', week: '每周', month: '每月', year: '每年' }[unit];
  return { day: `每 ${interval} 天`, week: `每 ${interval} 周`, month: `每 ${interval} 个月`, year: `每 ${interval} 年` }[unit];
}

export function kindLabel(kind: TxnKind): string {
  return { income: '收入', expense: '支出', transfer: '转账' }[kind];
}

export function natureLabel(nature: TxnNature): string {
  return { variable: '可变消费', recurring: '固定重复', one_off: '一次性' }[nature];
}

export function dueLabel(daysUntil: number): string {
  if (daysUntil === 0) return '今天';
  if (daysUntil === 1) return '明天';
  if (daysUntil === 2) return '后天';
  if (daysUntil < 0) return `逾期 ${Math.abs(daysUntil)} 天`;
  return `${daysUntil} 天后`;
}

export function cnDate(date: ISODate): string {
  return formatCN(date);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${y} 年 ${Number(m)} 月`;
}

export function pct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function riskText(level: 'safe' | 'warning' | 'danger'): string {
  return level === 'danger' ? '可能透支' : level === 'warning' ? '低于安全线' : '现金流安全';
}

export function amountInputValue(cents: number | undefined): string {
  if (cents === undefined || cents === null || cents === 0) return '';
  return (cents / 100).toFixed(2).replace(/\.00$/, '');
}

export function truncate(text: string, max = 24): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}