import { describe, expect, it } from 'vitest';
import { decodeBillBytes, detectFormat, findHeaderRow, parseBillCsv, parseDelimited } from '../../src/domain/billCsv';
import { transactionsToCSV } from '../../src/domain/csv';
import { makeAccount, makeCategory, makeTxn } from './fixtures';
import alipayCsv from '../fixtures/bills/alipay-utf8.csv?raw';
import wechatCsv from '../fixtures/bills/wechat-utf8.csv?raw';

function bytesOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe('账单 CSV 解析层', () => {
  it('GBK 字节解码为中文（环境不支持 GBK 时给出回退标记）', () => {
    const res = decodeBillBytes(new Uint8Array([0xd6, 0xa7, 0xb3, 0xf6]).buffer);
    if (res.gbkFallbackFailed) {
      expect(res.encoding).toBe('utf-8');
    } else {
      expect(res.text).toBe('支出');
      expect(res.encoding).toBe('gbk');
    }
  });

  it('UTF-8 BOM 优先识别', () => {
    const bytes = new TextEncoder().encode('\uFEFF日期,金额\n2026-11-20,1.00');
    const res = decodeBillBytes(bytes.buffer);
    expect(res.encoding).toBe('utf-8');
    expect(res.text.startsWith('日期')).toBe(true);
  });

  it('parseDelimited 支持引号内逗号、双引号转义、字段内换行与 CRLF', () => {
    expect(parseDelimited('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
    expect(parseDelimited('"he said ""hi""",x')).toEqual([['he said "hi"', 'x']]);
    expect(parseDelimited('"line1\nline2",z')).toEqual([['line1\nline2', 'z']]);
    expect(parseDelimited('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseDelimited('"",b')).toEqual([['', 'b']]);
  });

  it('findHeaderRow 跳过说明行，定位到同时含交易时间/日期与金额的行', () => {
    const rows = parseDelimited('支付宝交易记录明细查询\n起始日期：[2026-11-01]\n交易时间,交易分类,金额\n2026-11-20,餐饮,1.00');
    expect(findHeaderRow(rows)).toBe(2);
    const none = parseDelimited('只有说明\n没有表头');
    expect(findHeaderRow(none)).toBe(-1);
  });

  it('detectFormat 识别四种格式', () => {
    expect(detectFormat(['日期', '类型', '金额(元)', '账户'])).toBe('moneyflow');
    expect(detectFormat(['交易时间', '交易分类', '交易对方', '商品说明', '收/支', '金额', '收付款方式'])).toBe('alipay');
    expect(detectFormat(['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付方式', '当前状态'])).toBe('wechat');
    expect(detectFormat(['日期', '金额', '商户'])).toBe('generic');
  });

  it('parseBillCsv 解析支付宝样例：跳过 3 行说明、商户含逗号完整保留', () => {
    const parsed = parseBillCsv(bytesOf(alipayCsv));
    expect(parsed.format).toBe('alipay');
    expect(parsed.headerLine).toBe(3);
    expect(parsed.rows).toHaveLength(8);
    expect(parsed.warnings).toContain('跳过了 3 行说明文字');
    const coffee = parsed.rows.find((r) => r.merchant.includes('瑞幸咖啡'));
    expect(coffee?.merchant).toBe('瑞幸咖啡,望京店');
    expect(coffee?.kindText).toBe('支出');
    expect(coffee?.amountText).toBe('18.50');
    expect(coffee?.categoryText).toBe('餐饮美食');
    const refundish = parsed.rows.find((r) => r.amountText === '¥1,234.50');
    expect(refundish?.merchant).toBe('京东');
    const future = parsed.rows.find((r) => r.date.startsWith('2026-12-01'));
    expect(future?.status).toBe('交易成功');
  });

  it('parseBillCsv 解析微信样例：格式、列映射与状态', () => {
    const parsed = parseBillCsv(bytesOf(wechatCsv));
    expect(parsed.format).toBe('wechat');
    expect(parsed.headerLine).toBe(0);
    expect(parsed.rows).toHaveLength(6);
    const transfer = parsed.rows.find((r) => r.merchant === '张三');
    expect(transfer?.categoryText).toBe('转账');
    expect(transfer?.kindText).toBe('支出');
    const refunded = parsed.rows.find((r) => r.merchant === '淘宝');
    expect(refunded?.status).toBe('已退款');
    const income = parsed.rows.find((r) => r.kindText === '收入');
    expect(income?.amountText).toBe('66.00');
  });

  it('MoneyFlow 导出 CSV 可原样解析回（round-trip）', () => {
    const csv = transactionsToCSV({
      transactions: [
        makeTxn({ id: 't1', amount: 12345, date: '2026-06-01', merchant: '瑞幸咖啡,望京店', note: '含"引号"备注', categoryId: 'cat_food', kind: 'expense' }),
        makeTxn({ id: 't2', amount: 500000, date: '2026-06-02', kind: 'income', merchant: '示例公司' }),
      ],
      accounts: [makeAccount({ name: '日常账户' })],
      categories: [makeCategory({ id: 'cat_food', name: '餐饮' })],
      flows: [],
      goals: [],
    });
    const parsed = parseBillCsv(new TextEncoder().encode(csv).buffer);
    expect(parsed.format).toBe('moneyflow');
    expect(parsed.rows).toHaveLength(2);
    const row1 = parsed.rows.find((r) => r.merchant === '瑞幸咖啡,望京店');
    expect(row1?.amountText).toBe('123.45');
    expect(row1?.categoryText).toBe('餐饮');
    expect(row1?.note).toBe('含"引号"备注');
    const row2 = parsed.rows.find((r) => r.kindText === '收入');
    // 导出层保留千分位（"5,000.00"），解析层原样保留，由计划层去逗号
    expect(row2?.amountText).toBe('5,000.00');
  });
});
