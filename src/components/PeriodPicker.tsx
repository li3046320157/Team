import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ISODate } from '../domain/days';
import { PERIOD_UNITS, periodLabel, periodOf, shiftAnchor, type Period, type PeriodUnit } from '../domain/period';
import { Button, Segmented } from './ui';

function mobileShortLabel(period: Period): string {
  const [sy, sm, sd] = period.start.split('-');
  const [, em, ed] = period.end.split('-');
  if (period.unit === 'day') return `${Number(sm)}/${Number(sd)}`;
  if (period.unit === 'week') return `${Number(sm)}/${Number(sd)}–${Number(em)}/${Number(ed)}`;
  if (period.unit === 'month') return `${sy}/${Number(sm)}`;
  return sy;
}

export function PeriodPicker({
  unit,
  anchor,
  today,
  onChange,
  compact = false,
  testIdPrefix = 'period',
}: {
  unit: PeriodUnit;
  anchor: ISODate;
  today: ISODate;
  onChange: (next: { unit: PeriodUnit; anchor: ISODate }) => void;
  compact?: boolean;
  testIdPrefix?: string;
}) {
  const period = periodOf(unit, anchor);
  const nextDisabled = period.end >= today;
  const label = periodLabel(period);
  return (
    <div role="group" aria-label="统计周期" className="flex flex-wrap items-center gap-2">
      <Segmented
        size="sm"
        value={unit}
        onChange={(u) => onChange({ unit: u, anchor })}
        options={[...PERIOD_UNITS]}
      />
      <span className="flex items-center gap-0.5">
        <button
          type="button"
          className="btn btn-ghost btn-xs !px-1.5"
          aria-label="上一周期"
          data-testid={`${testIdPrefix}-prev`}
          onClick={() => onChange({ unit, anchor: shiftAnchor(unit, anchor, -1) })}
        >
          <ChevronLeft size={14} />
        </button>
        <span data-testid={`${testIdPrefix}-label`} className="min-w-[110px] text-center text-[11.5px] font-medium text-[#3A3D37]">
          <span className="sm:hidden">{mobileShortLabel(period)}</span>
          <span className="hidden sm:inline">{label}</span>
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-xs !px-1.5 disabled:cursor-not-allowed disabled:opacity-35"
          aria-label="下一周期"
          data-testid={`${testIdPrefix}-next`}
          disabled={nextDisabled}
          onClick={() => onChange({ unit, anchor: shiftAnchor(unit, anchor, 1) })}
        >
          <ChevronRight size={14} />
        </button>
      </span>
      {anchor !== today && (
        <Button size="xs" variant="ghost" data-testid={`${testIdPrefix}-today`} onClick={() => onChange({ unit, anchor: today })}>
          回到今天
        </Button>
      )}
      {!compact && (
        <input
          type="date"
          className="input hidden !w-auto !py-1.5 text-xs sm:block"
          max={today}
          value={anchor}
          aria-label="周期日期"
          data-testid={`${testIdPrefix}-date`}
          onChange={(e) => {
            if (e.target.value) onChange({ unit, anchor: e.target.value });
          }}
        />
      )}
    </div>
  );
}
