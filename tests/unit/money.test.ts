import { describe, expect, it } from 'vitest';
import { allocateByWeights, centsToYuan, formatMoney, parseMoneyInput } from '../../src/domain/money';

describe('金额解析与格式化', () => {
  it('解析常见金额', () => {
    expect(parseMoneyInput('28')).toEqual({ ok: true, cents: 2800 });
    expect(parseMoneyInput('18.5')).toEqual({ ok: true, cents: 1850 });
    expect(parseMoneyInput('1,234.56')).toEqual({ ok: true, cents: 123456 });
    expect(parseMoneyInput('￥ 300')).toEqual({ ok: true, cents: 30000 });
    expect(parseMoneyInput('０.０１')).toEqual({ ok: true, cents: 1 });
  });

  it('拒绝非法金额', () => {
    for (const bad of ['', 'abc', '1e3', '1.234', '-5', '0', '0.00', '1 2']) {
      expect(parseMoneyInput(bad).ok).toBe(false);
    }
  });

  it('格式化保持精确', () => {
    expect(formatMoney(123456)).toBe('¥1,234.56');
    expect(formatMoney(-500)).toBe('-¥5.00');
    expect(centsToYuan(100)).toBe('1.00');
    expect(centsToYuan(99)).toBe('0.99');
  });
});

describe('加权分配（手算例）', () => {
  it('R1=100, R2=300，预算200，均衡', () => {
    expect(allocateByWeights([10000, 30000], [1, 1], 20000)).toEqual([10000, 10000]);
  });

  it('R1=50, R2=300，预算200，先满足上限', () => {
    expect(allocateByWeights([5000, 30000], [1, 1], 20000)).toEqual([5000, 15000]);
  });

  it('总需求150，预算200，只分配150', () => {
    const result = allocateByWeights([15000], [1], 20000);
    expect(result).toEqual([15000]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(15000);
  });

  it('1 分预算也能确定性分配', () => {
    const r = allocateByWeights([100, 100, 100], [1, 1, 1], 1);
    expect(r.reduce((a, b) => a + b, 0)).toBe(1);
    expect(r).toEqual([1, 0, 0]);
  });

  it('零预算与零需求', () => {
    expect(allocateByWeights([100, 200], [1, 1], 0)).toEqual([0, 0]);
    expect(allocateByWeights([0, 0], [1, 1], 500)).toEqual([0, 0]);
  });

  it('避免超过单个需求', () => {
    const r = allocateByWeights([1000, 1000], [100, 1], 2000);
    expect(r[0]).toBeLessThanOrEqual(1000);
    expect(r[1]).toBeLessThanOrEqual(1000);
    expect(r.reduce((a, b) => a + b, 0)).toBe(2000);
  });

  it('无有效权重时按需求比例退化', () => {
    const r = allocateByWeights([1000, 3000], [0, 0], 4000);
    expect(r).toEqual([1000, 3000]);
  });
});