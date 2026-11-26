/** 到期提醒副作用层：localStorage 偏好 + 系统通知。任何异常都必须静默降级，不影响主流程。 */
import type { ISODate } from '../domain/types';
import { addDaysISO } from '../domain/days';
import { reminderBody, reminderKey, reminderTitle, type ReminderBuckets } from '../domain/reminders';

export interface ReminderPrefs {
  enabled: boolean;
  advanceDays: 0 | 1 | 3;
  notifyOnOpen: boolean;
  lastNotified: Record<string, ISODate>;
}

const DEFAULT_PREFS: ReminderPrefs = { enabled: false, advanceDays: 0, notifyOnOpen: false, lastNotified: {} };

export function reminderPrefsKey(userId: string): string {
  return `moneyflow.reminders.${userId}`;
}

export function loadReminderPrefs(userId: string): ReminderPrefs {
  try {
    const raw = localStorage.getItem(reminderPrefsKey(userId));
    if (!raw) return { ...DEFAULT_PREFS, lastNotified: {} };
    const parsed = JSON.parse(raw) as Partial<ReminderPrefs>;
    return {
      enabled: parsed.enabled === true,
      advanceDays: parsed.advanceDays === 1 || parsed.advanceDays === 3 ? parsed.advanceDays : 0,
      notifyOnOpen: parsed.notifyOnOpen === true,
      lastNotified: parsed.lastNotified && typeof parsed.lastNotified === 'object' ? parsed.lastNotified : {},
    };
  } catch {
    return { ...DEFAULT_PREFS, lastNotified: {} };
  }
}

export function saveReminderPrefs(userId: string, prefs: ReminderPrefs): void {
  try {
    localStorage.setItem(reminderPrefsKey(userId), JSON.stringify(prefs));
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  try {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  try {
    if (typeof Notification === 'undefined') return 'unsupported';
    return await Notification.requestPermission();
  } catch {
    return 'unsupported';
  }
}

export function notifyIfDue(input: {
  prefs: ReminderPrefs;
  buckets: ReminderBuckets;
  today: ISODate;
  onClick?: () => void;
}): ReminderPrefs {
  const { prefs, buckets, today } = input;
  const cutoff = addDaysISO(today, -30);
  const lastNotified: Record<string, ISODate> = {};
  for (const [key, date] of Object.entries(prefs.lastNotified)) {
    if (date >= cutoff) lastNotified[key] = date;
  }
  const next: ReminderPrefs = { ...prefs, lastNotified };
  if (!prefs.enabled || !prefs.notifyOnOpen || buckets.total === 0) return next;
  if (notificationPermission() !== 'granted') return next;

  const fresh: ReminderBuckets = {
    overdue: buckets.overdue.filter((v) => lastNotified[reminderKey(v, today)] !== today),
    dueToday: buckets.dueToday.filter((v) => lastNotified[reminderKey(v, today)] !== today),
    upcoming: buckets.upcoming.filter((v) => lastNotified[reminderKey(v, today)] !== today),
    total: 0,
  };
  fresh.total = fresh.overdue.length + fresh.dueToday.length + fresh.upcoming.length;
  if (fresh.total === 0) return next;

  for (const v of [...fresh.overdue, ...fresh.dueToday, ...fresh.upcoming]) {
    lastNotified[reminderKey(v, today)] = today;
  }
  try {
    const notification = new Notification(reminderTitle(fresh), {
      body: reminderBody(fresh, 3),
      tag: 'moneyflow-due',
      icon: './icons/icon-192.png',
    });
    notification.onclick = () => {
      window.focus();
      input.onClick?.();
    };
  } catch {
    /* 通知构造失败静默降级 */
  }
  return next;
}
