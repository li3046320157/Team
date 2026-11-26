/** CSV 导出：UTF-8 BOM、正确引号转义、公式注入防护。 */
import type { Account, Category, FinancialGoal, ScheduledFlow, Transaction } from './types';
import { centsToYuan } from './money';

const DANGEROUS = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | undefined | null, numeric = false): string {
  if (value === undefined || value === null) return '';
  if (numeric && typeof value === 'number') return String(value);
  let s = String(value);
  if (DANGEROUS.test(s)) s = `'${s}`; // 防公式注入
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const CSV_HEADER = [
  '日期',
  '类型',
  '金额(元)',
  '账户',
  '转入账户',
  '分类',
  '商户',
  '备注',
  '关联计划',
  '关联目标',
  '支出性质',
];

export function transactionsToCSV(params: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  flows: ScheduledFlow[];
  goals: FinancialGoal[];
}): string {
  const { transactions, accounts, categories, flows, goals } = params;
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const flowTitle = new Map(flows.map((f) => [f.id, f.title]));
  const goalName = new Map(goals.map((g) => [g.id, g.name]));
  const kindLabel: Record<string, string> = { income: '收入', expense: '支出', transfer: '转账' };
  const natureLabel: Record<string, string> = { variable: '可变', recurring: '周期', one_off: '一次性' };

  const rows = [CSV_HEADER.join(',')];
  const sorted = [...transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const t of sorted) {
    const flowId = t.occurrenceId ? t.occurrenceId.split(':')[1] : '';
    rows.push(
      [
        csvCell(t.date),
        csvCell(kindLabel[t.kind] ?? t.kind),
        csvCell(centsToYuan(t.amount)),
        csvCell(accName.get(t.accountId) ?? ''),
        csvCell(t.toAccountId ? accName.get(t.toAccountId) ?? '' : ''),
        csvCell(t.categoryId ? catName.get(t.categoryId) ?? '' : ''),
        csvCell(t.merchant ?? ''),
        csvCell(t.note ?? ''),
        csvCell(flowId ? flowTitle.get(flowId) ?? '' : ''),
        csvCell(t.goalId ? goalName.get(t.goalId) ?? '' : ''),
        csvCell(natureLabel[t.nature] ?? t.nature),
      ].join(','),
    );
  }
  return '\uFEFF' + rows.join('\r\n');
}

export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}