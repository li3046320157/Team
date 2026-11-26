/** 账单 CSV 解析层：纯函数，不依赖 React / Dexie / store。 */
import type { ISODate } from './types';

export type BillFormat = 'moneyflow' | 'alipay' | 'wechat' | 'generic';

export interface RawBillRow {
  date: string;
  kindText: string;
  amountText: string;
  merchant: string;
  note: string;
  status?: string;
  categoryText?: string;
  line: number;
}

export interface ParsedBill {
  format: BillFormat;
  rows: RawBillRow[];
  headerLine: number;
  warnings: string[];
  skippedLines: number;
  /** 实际解码编码；UI 摘要展示用。 */
  encoding: 'utf-8' | 'gbk';
}

export interface DecodeResult {
  text: string;
  encoding: 'utf-8' | 'gbk';
  /** 真：UTF-8 严格解码失败且运行环境不支持 GBK，已按 UTF-8 兜底（上层应提示可能乱码）。 */
  gbkFallbackFailed?: boolean;
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];

export function decodeBillBytes(buffer: ArrayBuffer): DecodeResult {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === UTF8_BOM[0] && bytes[1] === UTF8_BOM[1] && bytes[2] === UTF8_BOM[2]) {
    return { text: new TextDecoder('utf-8').decode(buffer), encoding: 'utf-8' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' };
  } catch {
    try {
      return { text: new TextDecoder('gbk').decode(buffer), encoding: 'gbk' };
    } catch {
      return { text: new TextDecoder('utf-8').decode(buffer), encoding: 'utf-8', gbkFallbackFailed: true };
    }
  }
}

/** RFC4180 状态机：引号、双引号转义、字段内逗号/换行、CRLF。 */
export function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const finishField = () => {
    row.push(field);
    field = '';
  };
  const finishRow = () => {
    finishField();
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      finishField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') i += 1;
      finishRow();
      i += 1;
      continue;
    }
    if (c === '\n') {
      finishRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field !== '' || row.length > 0) finishRow();
  return rows;
}

/** 在前 40 行里找同时含「交易时间/日期」与「金额」的行；找不到返回 -1。 */
export function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i += 1) {
    const cells = rows[i];
    const hasMoney = cells.some((c) => c.includes('金额'));
    const hasDate = cells.some((c) => c.includes('交易时间') || c.includes('日期'));
    if (hasMoney && hasDate) return i;
  }
  return -1;
}

/** 表头名归一化：去空白、全角括号转半角、小写。 */
function normHeader(cell: string): string {
  return cell.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')').toLowerCase();
}

const has = (cells: string[], token: string): boolean => cells.some((c) => c.includes(token));

/** 按表头签名判断格式（容忍全角括号与空格）。 */
export function detectFormat(header: string[]): BillFormat {
  const cells = header.map(normHeader);
  if (has(cells, '日期') && has(cells, '类型') && has(cells, '金额(元)') && has(cells, '账户')) return 'moneyflow';
  if (
    has(cells, '交易时间') &&
    has(cells, '交易分类') &&
    has(cells, '交易对方') &&
    has(cells, '商品说明') &&
    has(cells, '收/支') &&
    has(cells, '金额') &&
    has(cells, '收付款方式')
  ) {
    return 'alipay';
  }
  if (
    has(cells, '交易时间') &&
    has(cells, '交易类型') &&
    has(cells, '交易对方') &&
    has(cells, '商品') &&
    has(cells, '收/支') &&
    has(cells, '金额(元)') &&
    has(cells, '支付方式') &&
    has(cells, '当前状态')
  ) {
    return 'wechat';
  }
  return 'generic';
}

const COLUMN_KEYS: { field: keyof Pick<RawBillRow, 'date' | 'kindText' | 'amountText' | 'merchant' | 'note' | 'status' | 'categoryText'>; candidates: string[] }[] = [
  { field: 'date', candidates: ['交易时间', '日期'] },
  { field: 'kindText', candidates: ['收/支', '类型'] },
  { field: 'amountText', candidates: ['金额'] },
  { field: 'merchant', candidates: ['交易对方', '商户'] },
  { field: 'note', candidates: ['商品说明', '商品', '备注'] },
  { field: 'status', candidates: ['当前状态', '交易状态'] },
  { field: 'categoryText', candidates: ['交易分类', '分类', '交易类型'] },
];

function buildColumnMap(header: string[]): Map<string, number> {
  const norm = header.map(normHeader);
  const map = new Map<string, number>();
  for (const { field, candidates } of COLUMN_KEYS) {
    for (const key of candidates) {
      const nk = normHeader(key);
      const idx = norm.findIndex((c) => c === nk || c.includes(nk));
      if (idx >= 0) {
        map.set(field, idx);
        break;
      }
    }
  }
  return map;
}

/** 入口：解码 → 去 BOM → 切行 → 找表头 → 识别格式 → 映射列。 */
export function parseBillCsv(buffer: ArrayBuffer): ParsedBill {
  const decoded = decodeBillBytes(buffer);
  const warnings: string[] = [];
  if (decoded.encoding === 'gbk') warnings.push('已按 GBK 解码（支付宝/微信导出常用编码）');
  if (decoded.gbkFallbackFailed) warnings.push('当前浏览器不支持 GBK 解码，已按 UTF-8 处理；若预览出现乱码，请用文本工具转存为 UTF-8 后重试');
  let text = decoded.text;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const grid = parseDelimited(text);
  const headerLine = findHeaderRow(grid);
  if (headerLine < 0) {
    warnings.push('未找到表头行：需要同时包含「交易时间/日期」与「金额」列');
    return { format: 'generic', rows: [], headerLine: -1, warnings, skippedLines: grid.length, encoding: decoded.encoding };
  }
  if (headerLine > 0) warnings.push(`跳过了 ${headerLine} 行说明文字`);

  const header = grid[headerLine];
  const format = detectFormat(header);
  const norm = header.map(normHeader);
  if (format === 'generic' && (!has(norm, '日期') || !has(norm, '金额'))) {
    warnings.push('未识别的账单格式：通用格式至少需要「日期」与「金额」两列');
  }

  const cols = buildColumnMap(header);
  const get = (row: string[], field: string): string => {
    const idx = cols.get(field);
    return idx === undefined ? '' : (row[idx] ?? '').trim();
  };

  const rows: RawBillRow[] = [];
  let emptyLines = 0;
  for (let r = headerLine + 1; r < grid.length; r += 1) {
    const cells = grid[r];
    if (cells.every((c) => c.trim() === '')) {
      emptyLines += 1;
      continue;
    }
    rows.push({
      date: get(cells, 'date'),
      kindText: get(cells, 'kindText'),
      amountText: get(cells, 'amountText'),
      merchant: get(cells, 'merchant'),
      note: get(cells, 'note'),
      status: get(cells, 'status') || undefined,
      categoryText: get(cells, 'categoryText') || undefined,
      line: r + 1,
    });
  }
  return { format, rows, headerLine, warnings, skippedLines: headerLine + emptyLines, encoding: decoded.encoding };
}

/** 从日期时间文本中提取 YYYY-MM-DD（兼容 2026/11/20、2026-11-20 12:33:01）。 */
export function extractISODate(raw: string): ISODate | null {
  const m = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(raw);
  if (!m) return null;
  const pad = (n: string) => n.padStart(2, '0');
  return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
}
