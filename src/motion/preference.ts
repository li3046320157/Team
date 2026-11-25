export type MotionLevel = 'full' | 'reduced';

const STORAGE_KEY = 'moneyflow.motion';

/** 动效偏好由应用内决定，默认完整展示，不受系统减弱动态设置影响。 */
export function getMotionLevel(): MotionLevel {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'reduced' ? 'reduced' : 'full';
  } catch {
    return 'full';
  }
}

export function applyMotionLevel(level: MotionLevel = getMotionLevel()): void {
  document.documentElement.dataset.motion = level;
}

export function setMotionLevel(level: MotionLevel): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // 隐私模式下不可写时仍按当前会话生效
  }
  applyMotionLevel(level);
}