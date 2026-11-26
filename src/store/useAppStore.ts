/** 应用状态：单一内存快照为 UI 真相源，写库成功后再更新状态。 */
import { create } from 'zustand';
import type { Dataset, DataMode } from '../domain/types';
import { todayISO } from '../domain/days';
import { clearDataset, describeDbError, readDataset, writeDataset, setPersonalDbName, setDemoDbName } from '../data/db';
import {
  apiBindPhone,
  apiChangePassword,
  apiDeleteAccount,
  apiLogin,
  apiLogout,
  apiMe,
  apiRegister,
  apiUpdateProfile,
  apiUpdateRecovery,
} from '../data/account-api';
import { ApiError, apiErrorMessage, setSessionExpiredHandler } from '../data/api-core';
import { personalDbNameFor, type AuthUser, type RegistrationDetails } from '../data/auth';
import { createEmptyDataset } from '../data/defaults';
import { createDemoDataset } from '../data/sample';
import { applyCleanSlateOnce, destroyUserLocalData, retireLegacyLocalAuth } from '../data/wipe';
import { clearAiChat } from '../services/ai';
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
  authError: string | null;
  dataset: Dataset | null;
  loading: boolean;
  ready: boolean;
  error: string | null;
  toast: Toast | null;
  introPending: boolean;
  finishIntro: () => void;
  boot: () => Promise<void>;
  register: (username: string, password: string, details: RegistrationDetails) => Promise<string | null>;
  login: (identifier: string, password: string) => Promise<string | null>;
  updateProfile: (username: string) => Promise<string | null>;
  bindPhone: (phone: string) => Promise<string | null>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
  updateRecovery: (currentPassword: string, question: string, answer: string) => Promise<string | null>;
  deleteAccount: (currentPassword: string, confirmUsername: string) => Promise<string | null>;
  applyUser: (user: AuthUser) => void;
  logout: () => Promise<string | null>;
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
  enterDemo: () => Promise<boolean>;
  exitDemo: () => Promise<boolean>;
  regenerateDemo: () => Promise<boolean>;
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
  channel.onmessage = (event: MessageEvent<{ mode?: DataMode; source?: string; uid?: string | null; deleted?: boolean }>) => {
    const data = event.data;
    if (!data || data.source === TAB_ID) return;
    const state = useAppStore.getState();
    if ((data.uid ?? null) !== (state.user?.id ?? null)) return;
    if (data.deleted) {
      if (data.uid) clearAiChat(data.uid);
      setPersonalDbName('moneyflow-personal');
      useAppStore.setState({ ...signedOutPatch() });
      state.notify('账号已在其他标签页注销，本机数据已销毁', 'info');
      return;
    }
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

function broadcastDeletion(uid: string): void {
  try {
    channel?.postMessage({ deleted: true, source: TAB_ID, uid });
  } catch {
    /* 广播失败不影响注销 */
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

function signedOutPatch() {
  return {
    user: null,
    dataset: null,
    ready: false,
    loading: false,
    error: null,
    introPending: false,
    authError: null,
  } as const;
}

export const useAppStore = create<AppState>((set, get) => ({
  mode: 'personal',
  user: null,
  authReady: false,
  authError: null,
  dataset: null,
  loading: false,
  ready: false,
  error: null,
  toast: null,
  introPending: false,

  finishIntro: () => set({ introPending: false }),

  boot: async () => {
    set({ authReady: false, authError: null });
    try {
      await Promise.all([applyCleanSlateOnce(), retireLegacyLocalAuth()]);
    } catch {
      // 本地清理失败不应阻断云端登录。
    }
    setupChannel();
    try {
      const user = await apiMe();
      if (!user) {
        setPersonalDbName('moneyflow-personal');
        set({ ...signedOutPatch(), authReady: true });
        return;
      }
      if (user.role === 'admin') {
        setPersonalDbName('moneyflow-personal');
        set({ ...signedOutPatch(), user, authReady: true });
        return;
      }
      setPersonalDbName(personalDbNameFor(user.id));
      set({ user, authReady: true, dataset: null, ready: false, loading: false, error: null, authError: null });
      await get().init();
    } catch (error) {
      set({
        ...signedOutPatch(),
        authReady: true,
        authError: apiErrorMessage(error, '无法连接账户服务，请检查网络后重试'),
      });
    }
  },

  register: async (username, password, details) => {
    try {
      await apiRegister(username, password, details);
      return null;
    } catch (error) {
      return apiErrorMessage(error, '注册失败，请重试');
    }
  },

  login: async (identifier, password) => {
    try {
      const user = await apiLogin(identifier, password);
      // 每次登录开启新的对话周期；接口配置不受影响。
      clearAiChat(user.id);
      if (user.role === 'admin') {
        setPersonalDbName('moneyflow-personal');
        set({ user, dataset: null, ready: false, loading: false, error: null, authError: null, introPending: false });
        return null;
      }
      setPersonalDbName(personalDbNameFor(user.id));
      set({ user, dataset: null, ready: false, loading: false, error: null, authError: null, introPending: true });
      await get().init();
      get().notify(`欢迎回来，${user.username}`, 'success');
      return null;
    } catch (error) {
      return apiErrorMessage(error, '登录失败，请重试');
    }
  },

  updateProfile: async (username) => {
    const state = get();
    if (!state.user) return '请先登录';
    try {
      const user = await apiUpdateProfile(username);
      set({ user });
      return null;
    } catch (error) {
      return apiErrorMessage(error, '修改失败，请重试');
    }
  },

  bindPhone: async (phone) => {
    const state = get();
    if (!state.user) return '请先登录';
    try {
      const user = await apiBindPhone(phone);
      set({ user });
      return null;
    } catch (error) {
      return apiErrorMessage(error, '绑定手机号失败，请重试');
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    const state = get();
    if (!state.user) return '请先登录';
    try {
      await apiChangePassword(currentPassword, newPassword);
      return null;
    } catch (error) {
      return apiErrorMessage(error, '修改密码失败，请重试');
    }
  },

  updateRecovery: async (currentPassword, question, answer) => {
    const state = get();
    if (!state.user) return '请先登录';
    try {
      const user = await apiUpdateRecovery(currentPassword, question, answer);
      set({ user });
      return null;
    } catch (error) {
      return apiErrorMessage(error, '保存找回问题失败，请重试');
    }
  },

  deleteAccount: async (currentPassword, confirmUsername) => {
    const state = get();
    if (!state.user) return '请先登录';
    const user = state.user;
    try {
      await apiDeleteAccount(currentPassword, confirmUsername);
    } catch (error) {
      return apiErrorMessage(error, '注销账号失败，请稍后重试');
    }
    clearAiChat(user.id);
    broadcastDeletion(user.id);
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      await destroyUserLocalData(user.id);
    } catch {
      // 浏览器存储受限时仍保留已完成的云端注销结果与本机登出。
    }
    setPersonalDbName('moneyflow-personal');
    set({ ...signedOutPatch() });
    get().notify('账号已注销，本机数据已销毁', 'success');
    return null;
  },

  applyUser: (user) => set({ user }),

  logout: async () => {
    const uid = get().user?.id ?? null;
    try {
      await apiLogout();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'logout_unconfirmed') {
        // 服务端已下发清除 Cookie，但会话撤销未确认；本机仍先退出。
        if (uid) clearAiChat(uid);
        setPersonalDbName('moneyflow-personal');
        set({ ...signedOutPatch() });
        get().notify('已退出本机登录，服务器会话撤销未确认', 'info');
        return null;
      }
      const message = apiErrorMessage(error, '退出登录失败，请检查网络后重试');
      get().notify(message, 'error');
      return message;
    }
    if (uid) clearAiChat(uid);
    setPersonalDbName('moneyflow-personal');
    set({ ...signedOutPatch() });
    get().notify('已退出登录', 'info');
    return null;
  },

  init: async () => {
    setupChannel();
    const state = get();
    if (!state.user || state.user.role !== 'user') {
      set({ loading: false });
      return;
    }
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

  enterDemo: async () => {
    const state = get();
    if (!state.user) return false;
    try {
      setDemoDbName(`moneyflow-demo-${state.user.id}`);
      const today = todayISO();
      let dataset = await readDataset('demo');
      if (!dataset || dataset.meta.demoDate !== today) {
        const fresh = createDemoDataset(today);
        await withWriteLock('demo', () => writeDataset('demo', fresh));
        dataset = fresh;
      }
      set({ mode: 'demo', dataset, ready: true, error: null });
      broadcast('demo');
      get().notify('已进入示例账本，示例数据不会影响你的个人账本', 'success');
      return true;
    } catch (error) {
      get().notify(describeDbError(error), 'error');
      return false;
    }
  },

  exitDemo: async () => {
    const state = get();
    if (!state.user) return false;
    setDemoDbName(`moneyflow-demo-${state.user.id}`);
    setPersonalDbName(personalDbNameFor(state.user.id));
    set({ mode: 'personal' });
    await get().init();
    return true;
  },

  regenerateDemo: async () => {
    try {
      await clearDataset('demo');
      const dataset = createDemoDataset(todayISO());
      await withWriteLock('demo', () => writeDataset('demo', dataset));
      set({ dataset, error: null });
      broadcast('demo');
      get().notify('示例数据已重新生成', 'success');
      return true;
    } catch (error) {
      get().notify(describeDbError(error), 'error');
      return false;
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

setSessionExpiredHandler(() => {
  const state = useAppStore.getState();
  if (!state.user) return;
  clearAiChat(state.user.id);
  setPersonalDbName('moneyflow-personal');
  useAppStore.setState({ ...signedOutPatch() });
  state.notify('登录已过期，请重新登录', 'error');
});

