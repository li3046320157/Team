import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisContext,
  chatEndpoint,
  createSseParser,
  maskKey,
  modelsEndpoint,
  normalizeApiBase,
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

  it('包含余额、预测、目标与固定计划摘要', () => {
    const text = buildAnalysisContext(dataset, 'personal');
    expect(text).toContain('用户个人账本');
    expect(text).toContain('总余额');
    expect(text).toContain('未来 90 天预测');
    expect(text).toContain('旅行基金');
    expect(text).toContain('房租');
  });

  it('示例模式明确标注合成数据', () => {
    expect(buildAnalysisContext(dataset, 'demo')).toContain('合成示例数据');
  });

  it('系统提示词约束单位、结论先行与非投资建议', () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('人民币元');
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('先给结论');
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('不构成投资建议');
  });
});