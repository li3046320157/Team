import { describe, expect, it } from 'vitest';
import { csvCell, transactionsToCSV } from '../../src/domain/csv';
import { makeAccount, makeCategory, makeTxn } from './fixtures';

describe('CSV 导出', () => {
  it('BOM、表头与金额数值语义', () => {
    const csv = transactionsToCSV({
      transactions: [makeTxn({ id: 't1', amount: 2800, date: '2026-06-01' })],
      accounts: [makeAccount()],
      categories: [makeCategory()],
      flows: [],
      goals: [],
    });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('日期,类型,金额(元)');
    expect(csv).toContain('28.00');
    expect(csv).toContain('支出');
  });

  it('逗号、引号与换行正确转义', () => {
    expect(csvCell('现金,钱包')).toBe('"现金,钱包"');
    expect(csvCell('他说"好"')).toBe('"他说""好"""');
    expect(csvCell('第一行\n第二行')).toBe('"第一行\n第二行"');
  });

  it('公式注入防护', () => {
    expect(csvCell('=SUM(A1:B2)')).toBe("'=SUM(A1:B2)");
    expect(csvCell('+8613800138000')).toBe("'+8613800138000");
    expect(csvCell('-5+6')).toBe("'-5+6");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });

  it('商户与备注中的危险内容被转义，金额保持数值', () => {
    const csv = transactionsToCSV({
      transactions: [
        makeTxn({
          id: 't1',
          amount: 12345,
          date: '2026-06-01',
          merchant: '=HYPERLINK("http://x")',
          note: '备注,含逗号',
        }),
      ],
      accounts: [makeAccount()],
      categories: [makeCategory()],
      flows: [],
      goals: [],
    });
    expect(csv).toContain('\'=HYPERLINK');
    expect(csv).toContain('"备注,含逗号"');
    expect(csv).toContain('123.45');
    expect(csv).not.toContain('"123.45"');
  });

  it('中文与关联字段导出', () => {
    const csv = transactionsToCSV({
      accounts: [makeAccount({ name: '招商银行' })],
      categories: [makeCategory({ name: '餐饮' })],
      transactions: [makeTxn({ id: 't1', occurrenceId: 'occ:flow_rent:2026-06-01', nature: 'recurring', categoryId: 'cat_food' })],
      flows: [{ id: 'flow_rent', title: '房租' } as never],
      goals: [],
    });
    expect(csv).toContain('招商银行');
    expect(csv).toContain('餐饮');
    expect(csv).toContain('房租');
    expect(csv).toContain('周期');
  });
});