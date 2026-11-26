/** 本机数据清理：删除账本、偏好与旧版本地账户；云端账户不受影响。 */
import { closeAllDbs } from './db';
import { personalDbNameFor } from './auth';

const CLEAN_SLATE_KEY = 'moneyflow.cleanSlate.v1';
const LEGACY_SESSION_KEY = 'moneyflow.session';
const KNOWN_DBS = ['moneyflow-auth', 'moneyflow-personal', 'moneyflow-demo'];

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export async function wipeAllLocalData(): Promise<void> {
  closeAllDbs();
  const names = new Set(KNOWN_DBS);
  try {
    const factory = indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> };
    if (factory.databases) {
      for (const info of await factory.databases()) {
        if (info.name?.startsWith('moneyflow')) names.add(info.name);
      }
    }
  } catch {
    /* 浏览器不支持枚举时按已知库名清理 */
  }
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('moneyflow.')) localStorage.removeItem(key);
    }
  } catch {
    /* 隐私模式下忽略存储清理失败 */
  }
  await Promise.all([...names].map(deleteDatabase));
}

/** 注销账户后销毁该账户在本机的专属账本、AI 配置与对话；设备级配色与动效偏好不受影响。 */
export async function destroyUserLocalData(userId: string): Promise<void> {
  closeAllDbs();
  try {
    localStorage.removeItem(`moneyflow.ai.${userId}`);
    localStorage.removeItem(`moneyflow.ai.chat.${userId}`);
  } catch {
    /* 隐私模式下忽略存储清理失败 */
  }
  await deleteDatabase(personalDbNameFor(userId));
}

let legacyRetired: Promise<void> | null = null;

/** 退出旧版本地账户机制：只移除旧会话与旧账户库，保留本机账本。 */
export function retireLegacyLocalAuth(): Promise<void> {
  if (legacyRetired) return legacyRetired;
  legacyRetired = (async () => {
    try {
      localStorage.removeItem(LEGACY_SESSION_KEY);
    } catch {
      /* 隐私模式下忽略 */
    }
    await deleteDatabase('moneyflow-auth');
  })();
  return legacyRetired;
}

let cleanSlate: Promise<void> | null = null;

/** 新版本首次启动时清空旧版遗留数据（含旧账户与示例库），仅执行一次。 */
export function applyCleanSlateOnce(): Promise<void> {
  if (cleanSlate) return cleanSlate;
  cleanSlate = (async () => {
    try {
      if (localStorage.getItem(CLEAN_SLATE_KEY) === '1') return;
    } catch {
      return;
    }
    await wipeAllLocalData();
    try {
      localStorage.setItem(CLEAN_SLATE_KEY, '1');
    } catch {
      /* 忽略 */
    }
  })();
  return cleanSlate;
}