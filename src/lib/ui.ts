import { formatMoney } from '../domain/money';
import type { FreqUnit, ISODate, TxnKind, TxnNature } from '../domain/types';
import { formatCN } from '../domain/days';
import type { DataSufficiencyInfo, ForecastRisk } from '../domain/forecasting/engine';

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

export type RiskLevel = 'unknown' | 'safe' | 'warning' | 'danger';

export function riskLevelOf(input: { risk: ForecastRisk; sufficiency: DataSufficiencyInfo }): RiskLevel {
  if (input.sufficiency.level === 'insufficient') return 'unknown';
  if (input.risk.firstNegative) return 'danger';
  if (input.risk.firstBelowSafety) return 'warning';
  return 'safe';
}

export function riskText(level: RiskLevel): string {
  if (level === 'danger') return '可能透支';
  if (level === 'warning') return '低于安全线';
  if (level === 'unknown') return '数据不足';
  return '现金流安全';
}

export function amountInputValue(cents: number | undefined): string {
  if (cents === undefined || cents === null || cents === 0) return '';
  return (cents / 100).toFixed(2).replace(/\.00$/, '');
}

export function truncate(text: string, max = 24): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}