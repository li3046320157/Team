/** 金额工具：全部以整数分保存，禁止用浮点累加。 */

export const MAX_CENTS = 100_000_000_000; // 10 亿元上限，防溢出

export interface MoneyParseOk {
  ok: true;
  cents: number;
}
export interface MoneyParseErr {
  ok: false;
  error: string;
}

function normalizeDigits(input: string): string {
  // 全角数字与符号转半角
  return input.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/** 解析用户输入的金额字符串为分。仅接受非负、最多两位小数，拒绝科学计数法与非法字符。 */
export function parseMoneyInput(raw: string): MoneyParseOk | MoneyParseErr {
  if (typeof raw !== 'string') return { ok: false, error: '金额格式无效' };
  let s = normalizeDigits(raw).trim();
  s = s.replace(/^[¥￥\s]+/, '').replace(/[¥￥\s]+$/, '');
  if (/[\s¥￥]/.test(s)) return { ok: false, error: '金额中不能包含空格' };
  s = s.replace(/[,，]/g, '');
  if (s === '') return { ok: false, error: '请填写金额' };
  if (/[eE]/.test(s)) return { ok: false, error: '不支持科学计数法' };
  if (s.startsWith('+') || s.startsWith('-')) return { ok: false, error: '金额必须大于零' };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, error: '最多两位小数，且只能包含数字' };
  const [intPart, decPart = ''] = s.split('.');
  if (intPart.length > 12) return { ok: false, error: '金额过大' };
  const cents = Number(intPart) * 100 + Number((decPart + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0) return { ok: false, error: '金额必须大于零' };
  if (cents > MAX_CENTS) return { ok: false, error: '金额超出支持范围' };
  return { ok: true, cents };
}

export function isValidCents(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) <= MAX_CENTS;
}

const groupFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 分 → 元字符串，不带货币符号。 */
export function centsToYuan(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  const str = `${groupFmt.format(yuan).replace(/\.00$/, '')}.${String(fen).padStart(2, '0')}`;
  return `${neg ? '-' : ''}${str}`;
}

/** 分 → ¥ 显示，带千分位。 */
export function formatMoney(cents: number): string {
  const neg = cents < 0;
  return `${neg ? '-' : ''}¥${centsToYuan(Math.abs(cents))}`;
}

/** 图表轴用的紧凑金额。 */
export function formatMoneyShort(cents: number): string {
  const yuan = cents / 100;
  const abs = Math.abs(yuan);
  const sign = yuan < 0 ? '-' : '';
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}亿`;
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(abs >= 100_000 ? 0 : 1)}万`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${Math.round(abs)}`;
}

export function sumCents(values: number[]): number {
  let total = 0;
  for (const v of values) {
    if (!Number.isSafeInteger(v)) throw new Error('金额必须为整数分');
    total += v;
    if (!Number.isSafeInteger(total) || Math.abs(total) > Number.MAX_SAFE_INTEGER / 2) {
      throw new Error('金额累计溢出');
    }
  }
  return total;
}

export function clampCents(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 按权重把整数分预算确定性分配到各需求上（最大余数法，保证合计精确）。 */
export function allocateByWeights(demands: number[], weights: number[], budget: number): number[] {
  const n = demands.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0 || budget <= 0) return out;
  const totalDemand = demands.reduce((a, b) => a + Math.max(0, Math.floor(b)), 0);
  const target = Math.min(Math.max(0, Math.floor(budget)), totalDemand);
  if (target === 0) return out;

  const safeWeights: number[] = weights.map((w, i) => (Number.isFinite(w) && w > 0 && demands[i] > 0 ? w : 0));
  let effectiveWeights: number[] = safeWeights;
  if (safeWeights.every((w) => w === 0)) {
    // 无有效权重：按需求缺口比例退化
    effectiveWeights = demands.map((demand) => (demand > 0 ? 1 : 0));
  }

  const f = (lambda: number) =>
    demands.reduce((acc, d, i) => acc + Math.min(Math.max(0, d), lambda * effectiveWeights[i]), 0);

  let lo = 0;
  let hi = 1;
  while (f(hi) < target && hi < 1e15) hi *= 2;
  for (let iter = 0; iter < 100; iter += 1) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  const lambda = (lo + hi) / 2;

  const raw = demands.map((d, i) => Math.min(Math.max(0, d), lambda * effectiveWeights[i]));
  let assigned = 0;
  const fracs: { i: number; frac: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const base = Math.floor(raw[i] + 1e-9);
    out[i] = base;
    assigned += base;
    fracs.push({ i, frac: raw[i] - base });
  }
  let rest = target - assigned;
  fracs.sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.i - b.i));
  let guard = 0;
  while (rest > 0 && guard < 1_000_000) {
    let progressed = false;
    for (const { i } of fracs) {
      if (rest <= 0) break;
      if (out[i] < Math.floor(demands[i])) {
        out[i] += 1;
        rest -= 1;
        progressed = true;
      }
    }
    if (!progressed) break;
    guard += 1;
  }
  return out;
}