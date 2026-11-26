import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANALYSIS_SYSTEM_PROMPT,
  aiChatKey,
  buildAnalysisContext,
  chatEndpoint,
  clearAiChat,
  createSseParser,
  loadAiChat,
  maskKey,
  modelsEndpoint,
  normalizeApiBase,
  saveAiChat,
  validateAiConfig,
  type AiConfig,
} from '../../src/services/ai';
import { makeDataset, makeFlow, makeGoal, makeGoalEvent, makeTxn } from './fixtures';

const config: AiConfig = { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-1234567890', model: 'gpt-4o-mini' };

describe('API 地址归一化与校验', () => {
  it('去掉末尾斜杠与误填的 /chat/completions 后缀', () => {
    expect(normalizeApiBase(' https://api.example.com/v1/ ')).toBe('https://api.example.com/v1');
    expect(normalizeApiBase('https://api.example.com/v1/chat/completions')).toBe('https://api.example.com/v1');
    expect(normalizeApiBase('https://api.example.com/v1///')).toBe('https://api.example.com/v1');
  });

  it('拼接对话与模型列表端点', () => {
    expect(chatEndpoint(config)).toBe('https://api.example.com/v1/chat/completions');
    expect(modelsEndpoint(config)).toBe('https://api.example.com/v1/models');
  });

  it('逐项提示缺失配置', () => {
    expect(validateAiConfig({ ...config, baseUrl: '' })).toContain('地址');
    expect(validateAiConfig({ ...config, baseUrl: 'api.example.com/v1' })).toContain('http');
    expect(validateAiConfig({ ...config, apiKey: ' ' })).toContain('密钥');
    expect(validateAiConfig({ ...config, model: '' })).toContain('模型');
    expect(validateAiConfig(config)).toBeNull();
  });

  it('密钥脱敏只露首尾', () => {
    expect(maskKey('short')).toBe('••••••••');
    const masked = maskKey('sk-abcdefghijklmnop');
    expect(masked.startsWith('sk-a')).toBe(true);
    expect(masked.endsWith('mnop')).toBe(true);
    expect(masked).not.toContain('bcdefghijkl');
  });
});

describe('SSE 增量解析', () => {
  it('跨 chunk 缓冲不完整行并输出增量', () => {
    const parser = createSseParser();
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: '你好' } }] })}\n`;
    expect(parser.push(line.slice(0, 12))).toEqual([]);
    expect(parser.push(line.slice(12))).toEqual(['你好']);
    expect(parser.done).toBe(false);
  });

  it('识别 [DONE] 与多行批量', () => {
    const parser = createSseParser();
    const chunk = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'A' } }] })}`,
      ': keep-alive',
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'B' } }] })}`,
      'data: [DONE]',
      '',
    ].join('\n');
    expect(parser.push(chunk)).toEqual(['A', 'B']);
    expect(parser.done).toBe(true);
  });

  it('兼容非流式 message.content，忽略坏 JSON', () => {
    const parser = createSseParser();
    const chunk = [
      'data: {broken',
      `data: ${JSON.stringify({ choices: [{ message: { content: '整段' } }] })}`,
      '',
    ].join('\n');
    expect(parser.push(chunk)).toEqual(['整段']);
  });
});

describe('账本分析上下文', () => {
  const dataset = makeDataset({
    transactions: [
      makeTxn({ id: 't1', amount: 2800, date: '2026-06-01', categoryId: 'cat_food' }),
      makeTxn({ id: 't2', kind: 'income', amount: 300000, date: '2026-06-10' }),
    ],
    flows: [makeFlow()],
    goals: [makeGoal()],
    goalEvents: [makeGoalEvent()],
  });

  it('包含余额、周期统计、预测、目标与固定计划摘要', () => {
    const text = buildAnalysisContext(dataset, 'personal');
    expect(text).toContain('用户个人账本');
    expect(text).toContain('总余额');
    expect(text).toContain('统计周期：日/周/月/年');
    expect(text).toContain('今日（');
    expect(text).toContain('本周（');
    expect(text).toContain('本月（');
    expect(text).toContain('本年（');
    expect(text).toContain('近 12 个月');
    expect(text).toContain('未来 90 天预测');
    expect(text).toContain('旅行基金');
    expect(text).toContain('房租');
  });

  it('示例模式明确标注合成数据', () => {
    expect(buildAnalysisContext(dataset, 'demo')).toContain('合成示例数据');
  });

  it('系统提示词约束周期口径、单位、结论先行与非投资建议', () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('人民币元');
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('日/周/月/年');
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('先给结论');
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('不构成投资建议');
  });
});

describe('对话按登录周期留存', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('同一账户可恢复对话，且不同账户互相隔离', () => {
    const messages = [
      { role: 'user' as const, content: '本月支出结构如何？' },
      { role: 'assistant' as const, content: '餐饮占比最高，建议…' },
    ];
    saveAiChat('u1', messages);
    expect(loadAiChat('u1')).toEqual(messages);
    expect(loadAiChat('u2')).toEqual([]);
    expect(store.has(aiChatKey('u1'))).toBe(true);
  });

  it('清空、损坏数据与不可用存储都不抛错', () => {
    store.set(aiChatKey('u1'), '{broken');
    expect(loadAiChat('u1')).toEqual([]);
    saveAiChat('u1', []);
    expect(store.has(aiChatKey('u1'))).toBe(false);
    clearAiChat('u1');
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    });
    expect(loadAiChat('u1')).toEqual([]);
    expect(() => saveAiChat('u1', [{ role: 'user', content: 'x' }])).not.toThrow();
    expect(() => clearAiChat('u1')).not.toThrow();
  });

  it('过滤非法消息并只保留最近 100 条', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
    store.set(aiChatKey('u1'), JSON.stringify([...many, { role: 'system', content: 'x' }, { role: 'user', content: 1 }]));
    const loaded = loadAiChat('u1');
    expect(loaded).toHaveLength(100);
    expect(loaded[0]?.content).toBe('m20');
    expect(loaded[99]?.content).toBe('m119');
  });
});