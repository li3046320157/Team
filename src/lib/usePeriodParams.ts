import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isValidISODate, todayISO, type ISODate } from '../domain/days';
import { clampAnchor, isPeriodUnit, periodOf, type Period, type PeriodUnit } from '../domain/period';

/** 跨页面共享周期记忆：URL 是当前页来源，localStorage 兜底让「流水 → 洞察」切换时周期保持不变。 */
const PERIOD_STORE_KEY = 'moneyflow.period';

interface StoredPeriod {
  unit: PeriodUnit;
  anchor: ISODate;
}

function readStored(): StoredPeriod | null {
  try {
    const raw = localStorage.getItem(PERIOD_STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPeriod>;
    if (typeof parsed.unit === 'string' && isPeriodUnit(parsed.unit) && isValidISODate(parsed.anchor)) {
      return { unit: parsed.unit, anchor: parsed.anchor };
    }
  } catch {
    // 损坏数据静默回退
  }
  return null;
}

function writeStored(next: StoredPeriod): void {
  try {
    localStorage.setItem(PERIOD_STORE_KEY, JSON.stringify(next));
  } catch {
    // 存储不可用时静默降级
  }
}

export function usePeriodParams(defaultUnit: PeriodUnit = 'month'): {
  unit: PeriodUnit;
  anchor: ISODate;
  period: Period;
  setPeriod: (next: { unit: PeriodUnit; anchor: ISODate }) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayISO();

  const unitRaw = searchParams.get('unit');
  const stored = readStored();
  const unit: PeriodUnit = isPeriodUnit(unitRaw ?? '') ? (unitRaw as PeriodUnit) : (stored?.unit ?? defaultUnit);
  const anchorRaw = searchParams.get('anchor');
  const anchor = clampAnchor(isValidISODate(anchorRaw) ? anchorRaw : (stored?.anchor ?? today), today);

  // unit 与 anchor 必须在同一次 setSearchParams 中写入：分开调用会在事件批处理里互相覆盖。
  const setPeriod = (next: { unit: PeriodUnit; anchor: ISODate }) => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('unit', next.unit);
        p.set('anchor', clampAnchor(next.anchor, today));
        return p;
      },
      { replace: true },
    );
  };

  useEffect(() => {
    writeStored({ unit, anchor });
  }, [unit, anchor]);

  return {
    unit,
    anchor,
    period: periodOf(unit, anchor),
    setPeriod,
  };
}
