import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadReminderPrefs, notifyIfDue, reminderPrefsKey, saveReminderPrefs, type ReminderPrefs } from '../../src/services/reminders';
import { collectReminders } from '../../src/domain/reminders';
import { makeFlow } from './fixtures';

const TODAY = '2026-11-25';
const USER = 'user-1';

type Fake = { title: string; options?: NotificationOptions; onclick: (() => void) | null };
const sent: Fake[] = [];
let store: Map<string, string>;
let permission: NotificationPermission;

class FakeNotification {
  static instances = sent;
  title: string;
  options?: NotificationOptions;
  onclick: (() => void) | null = null;
  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.options = options;
    sent.push(this);
  }
  close() {}
}

beforeEach(() => {
  sent.length = 0;
  store = new Map();
  permission = 'granted';
  vi.stubGlobal('Notification', FakeNotification);
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: FakeNotification,
    writable: true,
  });
  Object.defineProperty(globalThis.Notification, 'permission', {
    configurable: true,
    get: () => permission,
  });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('window', { focus: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const buckets = collectReminders({
  flows: [makeFlow({ kind: 'expense', title: '房租', amount: 450_000, rule: { unit: 'day', interval: 1 }, startDate: '2026-11-23', endDate: '2026-11-26' })],
  records: [],
  today: TODAY,
  advanceDays: 3,
});

function prefs(over: Partial<ReminderPrefs> = {}): ReminderPrefs {
  return { enabled: true, advanceDays: 3, notifyOnOpen: true, lastNotified: {}, ...over };
}

describe('reminders 服务层', () => {
  it('偏好按用户隔离存取；损坏数据回退默认值', () => {
    expect(reminderPrefsKey(USER)).toBe(`moneyflow.reminders.${USER}`);
    const p = prefs();
    saveReminderPrefs(USER, p);
    expect(loadReminderPrefs(USER)).toEqual(p);
    store.set(reminderPrefsKey(USER), '{ not json');
    expect(loadReminderPrefs(USER).enabled).toBe(false);
    expect(loadReminderPrefs(USER).advanceDays).toBe(0);
  });

  it('已授权且开启时发一条通知；同一天同一 reminderKey 只发一次', () => {
    const first = notifyIfDue({ prefs: prefs(), buckets, today: TODAY });
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toContain('4 项待处理');
    expect(sent[0].options?.tag).toBe('moneyflow-due');
    expect(Object.keys(first.lastNotified)).toHaveLength(4);
    sent.length = 0;
    const second = notifyIfDue({ prefs: first, buckets, today: TODAY });
    expect(sent).toHaveLength(0);
    expect(second.lastNotified).toEqual(first.lastNotified);
  });

  it('新条目出现时再次提醒，但只包含未通知过的条目', () => {
    const notified = notifyIfDue({ prefs: prefs(), buckets, today: TODAY });
    sent.length = 0;
    const extra = collectReminders({
      flows: [
        makeFlow({ id: 'flow_extra', kind: 'expense', title: '水电', amount: 30_000, rule: { unit: 'day', interval: 1 }, startDate: '2026-11-24', endDate: '2026-11-26' }),
      ],
      records: [],
      today: TODAY,
      advanceDays: 3,
    });
    const merged = {
      overdue: [...buckets.overdue, ...extra.overdue],
      dueToday: [...buckets.dueToday, ...extra.dueToday],
      upcoming: [...buckets.upcoming, ...extra.upcoming],
      total: buckets.total + extra.total,
    };
    const again = notifyIfDue({ prefs: notified, buckets: merged, today: TODAY });
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toContain('3 项待处理');
    expect(sent[0].options?.body).toContain('水电');
    expect(sent[0].options?.body).not.toContain('房租');
    expect(again.lastNotified).toEqual(expect.objectContaining(notified.lastNotified));
    expect(Object.keys(again.lastNotified)).toHaveLength(4 + 3);
  });

  it('权限被拒 / 未开启 / 不支持时静默不发', () => {
    permission = 'denied';
    expect(notifyIfDue({ prefs: prefs(), buckets, today: TODAY }).lastNotified).toEqual({});
    permission = 'granted';
    expect(notifyIfDue({ prefs: prefs({ enabled: false }), buckets, today: TODAY }).lastNotified).toEqual({});
    expect(notifyIfDue({ prefs: prefs({ notifyOnOpen: false }), buckets, today: TODAY }).lastNotified).toEqual({});
    expect(sent).toHaveLength(0);
  });

  it('清理 30 天前的 lastNotified 键', () => {
    const p = prefs({ lastNotified: { old: '2026-10-01', fresh: '2026-11-20' } });
    const next = notifyIfDue({ prefs: p, buckets, today: TODAY });
    expect(next.lastNotified.old).toBeUndefined();
    expect(next.lastNotified.fresh).toBe('2026-11-20');
  });
});
