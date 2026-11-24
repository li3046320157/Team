import { describe, expect, it } from 'vitest';
import { parseQuickEntry } from '../../src/domain/quickEntry';

const today = '2026-11-24';

describe('快速记账解析', () => {
  it('今天午餐花了28元', () => {
    const r = parseQuickEntry('今天午餐花了28元', today);
    expect(r.ok).toBe(true);
    expect(r.amount).toBe(2800);
    expect(r.kind).toBe('expense');
    expect(r.date).toBe('2026-11-24');
    expect(r.categoryHint).toBe('餐饮');
    expect(r.merchant).toBe('午餐');
  });

  it('昨天买咖啡18.5元', () => {
    const r = parseQuickEntry('昨天买咖啡18.5元', today);
    expect(r.ok).toBe(true);
    expect(r.amount).toBe(1850);
    expect(r.date).toBe('2026-11-23');
    expect(r.categoryHint).toBe('咖啡茶饮');
    expect(r.merchant).toBe('咖啡');
  });

  it('11月20日交通支出6元', () => {
    const r = parseQuickEntry('11月20日交通支出6元', today);
    expect(r.amount).toBe(600);
    expect(r.date).toBe('2026-11-20');
    expect(r.categoryHint).toBe('交通');
  });

  it('今天兼职收入300元', () => {
    const r = parseQuickEntry('今天兼职收入300元', today);
    expect(r.ok).toBe(true);
    expect(r.amount).toBe(30000);
    expect(r.kind).toBe('income');
    expect(r.categoryHint).toBe('兼职');
  });

  it('缺金额不自动落库', () => {
    const r = parseQuickEntry('今天去超市', today);
    expect(r.ok).toBe(false);
    expect(r.amount).toBeUndefined();
    expect(r.issues.join('')).toContain('金额');
  });

  it('多个金额要求手动确认', () => {
    const r = parseQuickEntry('今天午餐28元，打车12元', today);
    expect(r.ok).toBe(false);
    expect(r.issues.join('')).toContain('多个金额');
  });

  it('退款等语义不直接记为支出', () => {
    const r = parseQuickEntry('昨天退款28元', today);
    expect(r.ok).toBe(false);
    expect(r.issues.join('')).toContain('退款');
  });

  it('未来日期被拒绝', () => {
    const r = parseQuickEntry('明天聚餐花100元', today);
    expect(r.ok).toBe(false);
    expect(r.date).toBe(today);
  });

  it('两类词同时出现时不猜测', () => {
    const r = parseQuickEntry('今天兼职收入300元买书', today);
    expect(r.ok).toBe(false);
    expect(r.issues.join('')).toContain('类型');
  });
});