/** 本机数据清理：删除全部账户、账本与本地配置，回到首次打开的状态。 */
import { closeAllDbs } from './db';
import { closeAuthDb } from './auth';

const CLEAN_SLATE_KEY = 'moneyflow.cleanSlate.v1';
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
  closeAuthDb();
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