import { describe, expect, it } from 'vitest';
import { buildICS } from '../../src/domain/ics';
import type { ScheduledFlow } from '../../src/domain/types';
import { makeFlow } from './fixtures';

const TODAY = '2026-11-25';

function expense(over: Partial<ScheduledFlow>): ScheduledFlow {
  return makeFlow({ kind: 'expense', rule: { unit: 'day', interval: 1 }, ...over });
}

const flows = [
  expense({ id: 'flow_rent', title: '房租', amount: 450_000, startDate: '2026-11-23', endDate: '2026-11-26' }),
  expense({ id: 'flow_shop', title: '商户,含逗号;分号', amount: 12_300, startDate: '2026-11-25', endDate: '2026-11-25' }),
];

describe('buildICS', () => {
  it('以 BEGIN:VCALENDAR 开头、END:VCALENDAR 结尾，VEVENT 数量 = 待处理实例数', () => {
    const ics = buildICS({ flows, records: [], today: TODAY });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(5);
  });

  it('含逗号/分号的文本被正确转义', () => {
    const ics = buildICS({ flows, records: [], today: TODAY });
    expect(ics).toContain('SUMMARY:¥123 商户\\,含逗号\\;分号（MoneyFlow）');
  });

  it('超长描述按 75 字节折行，续行以空格开头，所有物理行不超过 75 字节', () => {
    const long = expense({ id: 'flow_long', title: '超长商户名称'.repeat(8), amount: 1, startDate: '2026-11-25', endDate: '2026-11-25' });
    const ics = buildICS({ flows: [long], records: [], today: TODAY });
    const lines = ics.split('\r\n');
    expect(lines.some((l) => l.startsWith(' '))).toBe(true);
    for (const l of lines) {
      expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    }
  });

  it('行尾均为 \\r\\n', () => {
    const ics = buildICS({ flows, records: [], today: TODAY });
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.split('\r\n').some((l) => l.includes('\n'))).toBe(false);
  });

  it('DTSTART 与到期日一致、DTEND 为次日；VALARM 在到期日 09:00 触发', () => {
    const ics = buildICS({ flows, records: [], today: TODAY });
    expect(ics).toContain('DTSTART;VALUE=DATE:20261123');
    expect(ics).toContain('DTEND;VALUE=DATE:20261124');
    expect(ics).toContain('TRIGGER:PT9H');
  });

  it('已核销/跳过实例不生成事件；收入计划默认不导出', () => {
    const records = [
      { id: 'occ:flow_rent:2026-11-23', flowId: 'flow_rent', originalDueDate: '2026-11-23', dueDate: '2026-11-23', amount: 450_000, status: 'settled' as const },
    ];
    const inc = expense({ id: 'flow_inc', kind: 'income', startDate: '2026-11-24', endDate: '2026-11-24' });
    const ics = buildICS({ flows: [...flows, inc], records, today: TODAY });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4);
  });
});
