/** 账单导入写入层：全量预校验 + 一次性不可变写入，原子失败。 */
import type { Dataset, ISODate, Transaction } from '../domain/types';
import type { PlannedRow } from '../domain/importPlan';
import { makeId, nowISOString } from '../domain/ids';
import { invalidateCalibrationsForDate } from '../domain/calibration';
import { todayISO } from '../domain/days';
import { validateTxnInput } from './mutations';

const RECURRING_HINTS = /房租|话费|会员/;

function toTransaction(row: PlannedRow): Transaction {
  const now = nowISOString();
  const merchant = row.merchant?.trim() || undefined;
  return {
    id: makeId('txn'),
    kind: row.kind,
    date: row.date,
    amount: row.amount,
    accountId: row.accountId,
    categoryId: row.categoryId,
    merchant,
    note: row.note?.trim() || undefined,
    nature: row.kind === 'income' ? 'one_off' : RECURRING_HINTS.test(merchant ?? '') ? 'recurring' : 'variable',
    createdAt: now,
    updatedAt: now,
  };
}

export function importBills(dataset: Dataset, rows: PlannedRow[], today: ISODate = todayISO()): Dataset {
  const newRows = rows.filter((r) => r.status === 'new');
  // 先全部校验：任一失败整体抛错，不写半截
  for (const row of newRows) {
    validateTxnInput(
      dataset,
      { kind: row.kind, date: row.date, amount: row.amount, accountId: row.accountId, categoryId: row.categoryId, nature: 'variable' },
      today,
    );
  }
  const nextTxns = newRows.map(toTransaction);
  const next: Dataset = { ...dataset, transactions: [...dataset.transactions, ...nextTxns] };
  // 逐日失效校准：不去用 min/max 区间，避免误伤没有导入数据的日期
  const dates = [...new Set(newRows.map((r) => r.date))];
  let calibrations = next.calibrations;
  for (const d of dates) calibrations = invalidateCalibrationsForDate(calibrations, d);
  return { ...next, calibrations };
}
