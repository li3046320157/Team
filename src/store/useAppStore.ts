/** 应用状态：单一内存快照为 UI 真相源，写库成功后再更新状态。 */
import { create } from 'zustand';
import type { Dataset, DataMode } from '../domain/types';
import { todayISO } from '../domain/days';
import { clearDataset, describeDbError, readDataset, writeDataset, setPersonalDbName } from '../data/db';
import { clearSession, getUserById, loginUser, personalDbNameFor, readSession, registerUser, storeSession, type AuthUser } from '../data/auth';
import { createEmptyDataset } from '../data/defaults';
import { applyCleanSlateOnce } from '../data/wipe';
import { addAccount, applyOnboarding, type AccountInput } from '../services/mutations';
import { runCalibrationOnDataset, saveDailySnapshot, saveManualSnapshot, type CalibrationOutcome } from '../services/snapshots';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface AppState {
  mode: DataMode;
  user: AuthUser | null;
  authReady: boolean;
  dataset: Dataset | null;
  loading: boolean;
  ready: boolean;
  error: string | null;
  toast: Toast | null;
  boot: () => Promise<void>;
  register: (username: string, password: string) => Promise<string | null>;
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => void;
  init: () => Promise<void>;
  apply: (mutator: (dataset: Dataset) => Dataset, successMessage?: string) => Promise<boolean>;
  replaceDataset: (dataset: Dataset, successMessage?: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  completeOnboarding: (input: {
    accountName: string;
    openingBalance: number;
    safetyReserve: number;
    monthVariableBudget: number;
    coverageStart?: string;
  }) => Promise<boolean>;
  addAccount: (input: AccountInput) => Promise<boolean>;
  runCalibration: () => Promise<CalibrationOutcome | null>;
  makeSnapshot: () => Promise<boolean>;
  resetMode: (mode: DataMode) => Promise<void>;
  notify: (text: string, kind?: ToastKind) => void;
  clearToast: () => void;
  dismissError: () => void;
}

const TAB_ID = Math.random().toString(36).slice(2);
const CHANNEL_NAME = 'moneyflow-sync';
let channel: BroadcastChannel | null = null;
let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function setupChannel(): void {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<{ mode?: DataMode; source?: string; uid?: string | null }>) => {
    const data = event.data;
    if (!data || data.source === TAB_ID) return;
    const state = useAppStore.getState();
    if ((data.uid ?? null) !== (state.user?.id ?? null)) return;
    if (data.mode === state.mode) void state.refresh();
  };
}

function broadcast(mode: DataMode): void {
  try {
    channel?.postMessage({ mode, source: TAB_ID, uid: useAppStore.getState().user?.id ?? null });
  } catch {
    /* 广播失败不影响写入 */
  }
}

async function withWriteLock<T>(mode: DataMode, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (locks) return locks.request(`moneyflow-write-${mode}`, fn);
  return fn();
}

async function prepareDataset(mode: DataMode): Promise<Dataset> {
  const today = todayISO();
  let dataset = await readDataset(mode);
  if (!dataset) {
    dataset = createEmptyDataset(mode, today);
    await writeDataset(mode, dataset);
  }
  return dataset;
}

export const useAppStore = create<AppState>((set, get) => ({
  mode: 'personal',
  user: null,
  authReady: false,
  dataset: null,
  loading: false,
  ready: false,
  error: null,
  toast: null,

  boot: async () => {
    await applyCleanSlateOnce();
    setupChannel();
    const sessionId = readSession();
    const user = sessionId ? await getUserById(sessionId).catch(() => null) : null;
    if (user) setPersonalDbName(personalDbNameFor(user.id));
    set({ user, authReady: true });
    if (user) await get().init();
  },

  register: async (username, password) => {
    try {
      await registerUser(username, password);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : '注册失败，请重试';
    }
  },

  login: async (username, password) => {
    try {
      const user = await loginUser(username, password);
      setPersonalDbName(personalDbNameFor(user.id));
      storeSession(user.id);
      set({ user, error: null });
      await get().init();
      get().notify(`欢迎回来，${user.username}`, 'success');
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : '登录失败，请重试';
    }
  },

  logout: () => {
    clearSession();
    setPersonalDbName('moneyflow-personal');
    set({ user: null, dataset: null, ready: false, loading: false, error: null });
    get().notify('已退出登录', 'info');
  },

  init: async () => {
    setupChannel();
    const state = get();
    if (state.mode === 'personal' && !state.user) return;
    set({ loading: true, error: null });
    try {
      const mode = get().mode;
      const dataset = await prepareDataset(mode);
      set({ dataset, loading: false, ready: true });
    } catch (error) {
      set({ loading: false, error: describeDbError(error), ready: true });
    }
  },

  apply: async (mutator, successMessage) => {
    const state = get();
    const current = state.dataset;
    if (!current) return false;
    try {
      let next = mutator(current);
      const todaySnapExists = next.snapshots.some((s) => s.id === `snap:${state.mode}:${todayISO()}` && s.auto);
      if (!todaySnapExists) next = saveDailySnapshot(next, state.mode);
      await withWriteLock(state.mode, () => writeDataset(state.mode, next));
      set({ dataset: next, error: null });
      broadcast(state.mode);
      if (successMessage) get().notify(successMessage, 'success');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : describeDbError(error);
      get().notify(message, 'error');
      set({ error: message });
      return false;
    }
  },

  replaceDataset: async (dataset, successMessage) => {
    const mode = get().mode;
    try {
      await withWriteLock(mode, () => writeDataset(mode, dataset));
      set({ dataset, error: null });
      broadcast(mode);
      if (successMessage) get().notify(successMessage, 'success');
      return true;
    } catch (error) {
      const message = describeDbError(error);
      get().notify(message, 'error');
      set({ error: message });
      return false;
    }
  },

  refresh: async () => {
    const mode = get().mode;
    try {
      const dataset = await readDataset(mode);
      if (dataset) set({ dataset });
    } catch {
      /* 刷新失败时保留当前内存快照 */
    }
  },

  completeOnboarding: async (input) => {
    const state = get();
    if (!state.dataset) return false;
    try {
      const next = applyOnboarding(state.dataset, input);
      const withSnap = saveDailySnapshot(next, state.mode);
      await withWriteLock(state.mode, () => writeDataset(state.mode, withSnap));
      set({ dataset: withSnap, error: null });
      broadcast(state.mode);
      return true;
    } catch (error) {
      get().notify(describeDbError(error), 'error');
      return false;
    }
  },

  addAccount: async (input) => {
    return get().apply((dataset) => addAccount(dataset, input), '账户已添加');
  },

  runCalibration: async () => {
    const state = get();
    if (!state.dataset) return null;
    try {
      const outcome = runCalibrationOnDataset(state.dataset);
      await withWriteLock(state.mode, () => writeDataset(state.mode, outcome.dataset));
      set({ dataset: outcome.dataset });
      broadcast(state.mode);
      get().notify(`校准完成：评估 ${outcome.evaluated} 天，新增 ${outcome.records.length} 条记录`, 'success');
      return outcome;
    } catch (error) {
      get().notify(describeDbError(error), 'error');
      return null;
    }
  },

  makeSnapshot: async () => {
    const state = get();
    if (!state.dataset) return false;
    try {
      const next = saveManualSnapshot(state.dataset, state.mode);
      await withWriteLock(state.mode, () => writeDataset(state.mode, next));
      set({ dataset: next });
      broadcast(state.mode);
      get().notify('已保存手动预测快照', 'success');
      return true;
    } catch (error) {
      get().notify(describeDbError(error), 'error');
      return false;
    }
  },

  resetMode: async (mode) => {
    try {
      await clearDataset(mode);
      if (mode === get().mode) {
        const dataset = await prepareDataset(mode);
        set({ dataset });
      }
      get().notify('个人数据已清空', 'success');
      broadcast(mode);
    } catch (error) {
      get().notify(describeDbError(error), 'error');
    }
  },

  notify: (text, kind = 'info') => {
    toastSeq += 1;
    const id = toastSeq;
    set({ toast: { id, text, kind } });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (useAppStore.getState().toast?.id === id) set({ toast: null });
    }, 3600);
  },

  clearToast: () => set({ toast: null }),
  dismissError: () => set({ error: null }),
}));

