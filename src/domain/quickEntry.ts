/** 本地规则快速记账解析：可解释、可编辑，歧义时不落库。 */
import type { Cents, ISODate } from './types';
import { addDaysISO, isValidISODate, parseISODate, todayISO } from './days';
import { parseMoneyInput } from './money';

export interface QuickParseResult {
  raw: string;
  ok: boolean;
  amount?: Cents;
  kind?: 'income' | 'expense';
  date?: ISODate;
  merchant?: string;
  categoryHint?: string;
  issues: string[];
  confidence: 'high' | 'medium' | 'low';
}

const INCOME_WORDS = /(收入|工资|发薪|兼职|奖金|补贴|补助|报销|到账|入账|赚了|赚|收到)/;
const EXPENSE_WORDS = /(花了|花|支出|消费|买|付了|付|缴|充值|打车|吃了|喝|午餐|晚餐|早餐|咖啡|奶茶|房租|话费)/;
const NEGATIVE_WORDS = /(退|没|不|未|取消|失败|借给|还钱)/;

const CATEGORY_HINTS: { re: RegExp; category: string }[] = [
  { re: /(咖啡|奶茶|茶饮|星巴克|瑞幸)/, category: '咖啡茶饮' },
  { re: /(早餐|午餐|晚餐|吃饭|食堂|外卖|餐饮|饭)/, category: '餐饮' },
  { re: /(地铁|公交|打车|出租|交通|高铁|火车|加油)/, category: '交通' },
  { re: /(超市|购物|网购|淘宝|京东|买衣服)/, category: '购物' },
  { re: /(房租|住宿|水费|电费|物业)/, category: '居住' },
  { re: /(话费|流量|宽带|通讯)/, category: '通讯' },
  { re: /(会员|订阅|视频|游戏|娱乐|电影)/, category: '娱乐' },
  { re: /(药|医院|体检|医疗)/, category: '医疗' },
  { re: /(书|课程|学习|培训|考试)/, category: '学习' },
  { re: /(工资|发薪)/, category: '工资' },
  { re: /(兼职|奖金|补贴)/, category: '兼职' },
];

export function parseQuickEntry(raw: string, today: ISODate = todayISO()): QuickParseResult {
  const issues: string[] = [];
  const text = (raw ?? '').trim();
  const result: QuickParseResult = { raw: text, ok: false, issues, confidence: 'low' };
  if (!text) {
    issues.push('请输入一句话账单');
    return result;
  }
  if (NEGATIVE_WORDS.test(text)) {
    issues.push('包含退款、否定或借贷语义，不能简单记为支出，请改用表单确认');
  }

  let working = text;
  let date: ISODate | undefined;

  const rel = /(大前天|前天|昨天|今天|明天|后天)/.exec(working);
  if (rel) {
    const map: Record<string, number> = { 今天: 0, 昨天: -1, 前天: -2, 大前天: -3, 明天: 1, 后天: 2 };
    date = addDaysISO(today, map[rel[1]]);
    working = working.replace(rel[1], ' ');
  } else {
    const ymd = /(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*[日号]?/.exec(working);
    const md = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/.exec(working);
    const slash = /(\d{1,2})\/(\d{1,2})/.exec(working);
    if (ymd) {
      const iso = `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
      if (isValidISODate(iso)) date = iso;
      else issues.push('日期无效');
      working = working.replace(ymd[0], ' ');
    } else if (md) {
      const year = today.slice(0, 4);
      const iso = `${year}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`;
      if (isValidISODate(iso)) date = iso;
      else issues.push('日期无效');
      working = working.replace(md[0], ' ');
    } else if (slash) {
      const year = today.slice(0, 4);
      const iso = `${year}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
      if (isValidISODate(iso)) date = iso;
      working = working.replace(slash[0], ' ');
    }
  }
  if (date) {
    try {
      if (parseISODate(date) > parseISODate(today)) {
        issues.push('日期在未来：实际交易不能记录未来日期，请用固定账单');
        date = undefined;
      }
    } catch {
      issues.push('日期无效');
      date = undefined;
    }
  }

  const numMatches = working.match(/\d+(?:\.\d{1,2})?/g) ?? [];
  if (numMatches.length === 0) {
    issues.push('没有识别到金额');
  } else if (numMatches.length > 1) {
    issues.push(`识别到多个金额（${numMatches.join('、')}），请手动确认`);
  }
  if (numMatches.length >= 1) {
    const parsed = parseMoneyInput(numMatches[0] ?? '');
    if (parsed.ok) result.amount = parsed.cents;
    else issues.push(parsed.error);
    if (numMatches.length === 1 && numMatches[0]) working = working.replace(numMatches[0], '');
  }

  const hasIncome = INCOME_WORDS.test(text);
  const hasExpense = EXPENSE_WORDS.test(text);
  if (hasIncome && !hasExpense) result.kind = 'income';
  else if (hasExpense && !hasIncome) result.kind = 'expense';
  else if (hasIncome && hasExpense) issues.push('同时出现收入与支出词，请手动选择类型');
  else issues.push('无法判断收入或支出');

  const merchantPatterns = [
    /在([^\s，。0-9]{1,12}?)(?:买|花|消费|付)/,
    /买(?:了)?([^\s，。0-9]{1,12}?)(?:元|块|钱|花|付|用了|，|,|$)/,
    /^([^\s，。0-9]{1,8}?)(?:花了|花|支出|消费了?|付了?)/,
  ];
  const merchantText = working.trim();
  for (const re of merchantPatterns) {
    const m = re.exec(merchantText);
    if (m && m[1]) {
      result.merchant = m[1].trim();
      break;
    }
  }

  for (const hint of CATEGORY_HINTS) {
    if (hint.re.test(text)) {
      result.categoryHint = hint.category;
      break;
    }
  }

  result.date = date ?? today;
  result.issues = [...new Set(issues)];
  result.ok = result.issues.length === 0 && result.amount !== undefined && result.kind !== undefined;
  result.confidence =
    result.ok && result.amount !== undefined
      ? 'high'
      : result.amount !== undefined
        ? 'medium'
        : 'low';
  return result;
}

export const QUICK_ENTRY_EXAMPLES = [
  '今天午餐花了28元',
  '昨天买咖啡18.5元',
  '11月20日交通支出6元',
  '今天兼职收入300元',
];