import { useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import type { EChartsOption } from 'echarts';
import { useAppStore } from '../store/useAppStore';
import { todayISO } from '../domain/days';
import { formatMoney, formatMoneyShort } from '../domain/money';
import { previousPeriod } from '../domain/period';
import { compareTotals, periodTotals } from '../domain/periodStats';
import {
  budgetExecution,
  categoryTrend,
  reportToCSV,
  savingsRate,
  SERIES_COUNT,
  seriesTotals,
  type SeriesPoint,
} from '../domain/reportSeries';
import { usePeriodParams } from '../lib/usePeriodParams';
import { PeriodPicker } from '../components/PeriodPicker';
import { downloadTextFile } from '../domain/csv';
import { Badge, Button, Card, EmptyState, InfoNote, Money, PageHeader, Progress, StatCard } from '../components/ui';
import { EChart } from '../components/Chart';

const CAT_COLORS = ['#0E7568', '#B7791F', '#98362E', '#3A6B8A', '#6B6A63', '#7A8B5A', '#A3A097'];

function DeltaHint({ empty, amount, pct, invert = false }: { empty: string; amount: number; pct: number | null; invert?: boolean }) {
  if (pct === null) return <span className="text-[#8A887F]">{empty}</span>;
  const up = amount >= 0;
  const good = invert ? amount <= 0 : amount >= 0;
  const color = amount === 0 ? 'text-[#8A887F]' : good ? 'text-[#0B6357]' : 'text-[#98362E]';
  const sign = pct >= 0 ? `+${pct}` : `${pct}`;
  return (
    <span className={color}>
      较上期 {up ? '↑' : '↓'} ¥{formatMoney(Math.abs(amount))}（{sign}%）
    </span>
  );
}

function rateText(rate: number | null): string {
  return rate === null ? '—' : `${rate}%`;
}

function execPctText(point: SeriesPoint): string {
  return point.budget > 0 ? `${Math.round((point.variableExpense / point.budget) * 1000) / 10}%` : '—';
}

function execPctClass(point: SeriesPoint): string {
  if (point.budget <= 0) return 'text-[#8A887F]';
  const r = point.variableExpense / point.budget;
  if (r > 1) return 'text-[#98362E] font-semibold';
  if (r >= 0.8) return 'text-[#8A5A13]';
  return 'text-[#3A3D37]';
}

function expenseDeltaPct(points: SeriesPoint[], idx: number): number | null {
  if (idx <= 0 || points[idx - 1].expense === 0) return null;
  return Math.round(((points[idx].expense - points[idx - 1].expense) / points[idx - 1].expense) * 100);
}

export function ReportsPage() {
  const dataset = useAppStore((s) => s.dataset)!;
  const { unit, anchor, period, setPeriod } = usePeriodParams('month');
  const today = todayISO();
  const monthlyBudget = dataset.settings.budget.monthVariableBudget;

  const points = useMemo(
    () =>
      seriesTotals({
        transactions: dataset.transactions,
        unit,
        anchor,
        count: SERIES_COUNT[unit],
        monthlyBudget,
        today,
      }),
    [dataset.transactions, unit, anchor, monthlyBudget, today],
  );

  const current = useMemo(() => periodTotals(dataset.transactions, period), [dataset.transactions, period.key]);
  const prev = useMemo(() => periodTotals(dataset.transactions, previousPeriod(period)), [dataset.transactions, period.key]);
  const delta = useMemo(() => compareTotals(current, prev), [current, prev]);
  const rate = useMemo(() => savingsRate(current.income, current.expense), [current]);

  const budget = useMemo(
    () => budgetExecution({ transactions: dataset.transactions, period, monthlyBudget, today }),
    [dataset.transactions, period.key, monthlyBudget, today],
  );

  const trend = useMemo(
    () =>
      categoryTrend({
        transactions: dataset.transactions,
        categories: dataset.categories,
        unit,
        anchor,
        count: SERIES_COUNT[unit],
        today,
      }),
    [dataset.transactions, dataset.categories, unit, anchor, today],
  );

  const exportCSV = () => {
    downloadTextFile(`moneyflow-report-${unit}-${period.start}.csv`, reportToCSV(points), 'text/csv;charset=utf-8');
  };

  if (dataset.accounts.length === 0) {
    return (
      <div className="fade-in" data-testid="reports">
        <PageHeader title="报表" description="按周期汇总收入、支出与预算执行；趋势按同类周期回看，只统计已记录流水。" />
        <EmptyState
          title="还没有账户"
          description="报表需要至少一个账户来汇总流水，先去设置页添加。"
          action={
            <Link to="/settings" className="btn btn-primary btn-sm">去添加账户</Link>
          }
        />
      </div>
    );
  }

  const rows = [...points].reverse();
  const totals = {
    income: points.reduce((a, p) => a + p.income, 0),
    expense: points.reduce((a, p) => a + p.expense, 0),
    variableExpense: points.reduce((a, p) => a + p.variableExpense, 0),
    budget: points.reduce((a, p) => a + p.budget, 0),
    count: points.reduce((a, p) => a + p.count, 0),
  };
  const totalsNet = totals.income - totals.expense;

  const chartOption: EChartsOption = {
    color: CAT_COLORS,
    tooltip: { trigger: 'axis', valueFormatter: (v) => formatMoney(Number(v)) },
    legend: {
      bottom: 0,
      type: 'scroll',
      textStyle: { fontSize: 11, color: '#6B6A63' },
      pageTextStyle: { color: '#6B6A63' },
    },
    grid: { left: 8, right: 8, top: 16, bottom: 64, containLabel: true },
    xAxis: {
      type: 'category',
      data: trend.buckets.map((b) => b.label),
      axisLabel: { fontSize: 10.5, color: '#8A887F', interval: 0, rotate: unit === 'year' ? 0 : 28 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 10.5, color: '#8A887F', formatter: (v: number) => formatMoneyShort(v) },
      splitLine: { lineStyle: { color: '#EFECE6' } },
    },
    series: trend.series.map((s) => ({ name: s.name, type: 'bar' as const, stack: 'cat', data: s.values, barMaxWidth: 40 })),
  };

  return (
    <div className="fade-in" data-testid="reports">
      <PageHeader
        title="报表"
        description="按周期汇总收入、支出与预算执行；趋势按同类周期回看，只统计已记录流水。"
        actions={
          <>
            <PeriodPicker unit={unit} anchor={anchor} today={today} onChange={setPeriod} testIdPrefix="reports-period" />
            <Button size="sm" variant="secondary" onClick={exportCSV} data-testid="report-export">
              <Download size={13} /> 导出 CSV
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="reports-kpi">
        <div data-testid="report-kpi-income">
          <StatCard
            label="收入"
            value={<Money cents={current.income} />}
            hint={<DeltaHint empty="上期无收入" amount={delta.incomeDelta} pct={delta.incomePct} />}
          />
        </div>
        <div data-testid="report-kpi-expense">
          <StatCard
            label="支出"
            value={<Money cents={current.expense} />}
            hint={<DeltaHint empty="上期无支出" amount={delta.expenseDelta} pct={delta.expensePct} invert />}
          />
        </div>
        <div data-testid="report-kpi-net">
          <StatCard
            label="结余"
            value={<Money cents={current.net} />}
            tone={current.net >= 0 ? 'teal' : 'amber'}
            hint={<span>储蓄率 {rateText(rate)}</span>}
          />
        </div>
        <div data-testid="report-kpi-rate">
          <StatCard label="储蓄率" value={<span className="text-[24px]">{rateText(rate)}</span>} hint={<span>净储蓄 ÷ 总收入 · 收入为 0 时不计算</span>} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card
          className="rise xl:col-span-2"
          style={{ '--i': 0 } as CSSProperties}
          title="预算执行"
          subtitle="只统计可变消费；房租等固定支出请用「计划」管理"
          action={budget.status === 'unset' ? undefined : (
            <Badge tone={budget.status === 'safe' ? 'teal' : budget.status === 'near' ? 'amber' : 'danger'}>
              {budget.status === 'safe' ? '预算充足' : budget.status === 'near' ? '接近预算上限' : `已超出预算 ¥${formatMoney(budget.used - budget.budget)}`}
            </Badge>
          )}
        >
          {budget.status === 'unset' ? (
            <EmptyState
              title="未设置月预算"
              description="到设置页填写「每月可变消费预算」后，这里会展示折算、执行率与月底预计。"
              action={
                <Link to="/settings" className="btn btn-primary btn-sm">去设置月预算</Link>
              }
            />
          ) : (
            <div data-testid="report-budget">
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#FAF8F3] px-3 py-3 sm:grid-cols-4">
                <div><p className="text-[10.5px] text-[#8A887F]">月预算</p><p data-testid="report-budget-monthly" className="num mt-0.5 text-[14px] font-semibold"><Money cents={budget.monthlyBudget} /></p></div>
                <div><p className="text-[10.5px] text-[#8A887F]">本期折算</p><p data-testid="report-budget-prorated" className="num mt-0.5 text-[14px] font-semibold"><Money cents={budget.budget} /></p></div>
                <div><p className="text-[10.5px] text-[#8A887F]">已用</p><p data-testid="report-budget-used" className="num mt-0.5 text-[14px] font-semibold text-[#98362E]"><Money cents={budget.used} /></p></div>
                <div><p className="text-[10.5px] text-[#8A887F]">剩余</p><p data-testid="report-budget-remaining" className="num mt-0.5 text-[14px] font-semibold"><Money cents={budget.remaining} /></p></div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <Progress value={budget.used} max={budget.budget} tone={budget.status === 'safe' ? 'teal' : budget.status === 'near' ? 'amber' : 'danger'} />
                </div>
                <span className={budget.ratio! > 1 ? 'font-semibold text-[#98362E]' : budget.ratio! >= 0.8 ? 'text-[#8A5A13]' : 'text-[#3A3D37]'}>
                  {budget.budget > 0 ? `${Math.round(budget.ratio! * 1000) / 10}%` : '—'}
                </span>
              </div>
              <p className="mt-2 text-[11px] text-[#6B6A63]">
                本期总支出 <Money cents={budget.totalExpense} className="font-semibold" />（含固定支出）· 可变消费 {budget.variableCount} 笔
              </p>
              {budget.pacing && (
                <p className="mt-1.5 text-[11px] text-[#6B6A63]">
                  已过 {budget.pacing.elapsedDays}/{budget.pacing.totalDays} 天 · 按当前速度月底将花 ¥{formatMoney(budget.pacing.projected)}
                  {budget.pacing.projectedOverspend > 0
                    ? <>（超 ¥{formatMoney(budget.pacing.projectedOverspend)}）</>
                    : <>（余 ¥{formatMoney(budget.budget - budget.pacing.projected)}）</>}
                </p>
              )}
              {period.end < today && <p className="mt-1.5 text-[11px] text-[#A3A097]">历史周期仅回看，不显示预计。</p>}
              {budget.status === 'over' && (
                <p className="mt-2 text-[11px]">
                  <Link to={`/ledger?unit=${unit}&anchor=${period.start}`} className="font-semibold text-[#98362E] hover:underline">
                    建议查看本期可变消费分类 →
                  </Link>
                </p>
              )}
            </div>
          )}
        </Card>

        <Card className="rise" style={{ '--i': 1 } as CSSProperties} title="分类趋势" subtitle="窗口内支出按分类堆叠，Top6 之外的并入「其他」">
          {trend.series.length === 0 ? (
            <EmptyState title="这个窗口还没有支出记录" description="先记几笔支出，或切换到更长的周期。" />
          ) : (
            <EChart option={chartOption} height={260} ariaLabel="分类支出趋势堆叠柱状图" />
          )}
        </Card>

        <Card className="rise" style={{ '--i': 2 } as CSSProperties} title="口径说明" subtitle="报表不写数据、不重算预测">
          <div className="space-y-2.5">
            <InfoNote>转账不计入收入/支出/预算；只改变账户分布。</InfoNote>
            <InfoNote>预算只统计可变消费；固定计划核销、目标购买、一次性支出不计入。</InfoNote>
            <InfoNote>预算按天折算：跨月周/单日查看时预算会小于月预算。</InfoNote>
            <InfoNote>未登记「历史覆盖区间」时，趋势只反映已记录流水，不代表完整消费（与洞察页口径一致）。</InfoNote>
          </div>
        </Card>

        <Card className="rise xl:col-span-2" style={{ '--i': 3 } as CSSProperties} title={`近 ${points.length} 期明细`} subtitle="行按时间倒序；点击期数可跳到该周期流水">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12px]" data-testid="report-table">
              <thead>
                <tr className="border-b border-[#EFECE6] text-[11px] text-[#8A887F]">
                  <th className="py-2 pr-3 font-medium">期数</th>
                  <th className="py-2 pr-3 text-right font-medium">收入</th>
                  <th className="py-2 pr-3 text-right font-medium">支出</th>
                  <th className="py-2 pr-3 text-right font-medium">结余</th>
                  <th className="py-2 pr-3 text-right font-medium">储蓄率</th>
                  <th className="py-2 pr-3 text-right font-medium">可变支出</th>
                  <th className="py-2 pr-3 text-right font-medium">预算</th>
                  <th className="py-2 pr-3 text-right font-medium">执行率</th>
                  <th className="py-2 text-right font-medium">支出环比</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, ri) => {
                  const chronIdx = points.length - 1 - ri;
                  const ePct = expenseDeltaPct(points, chronIdx);
                  const isCurrent = p.key === period.key;
                  return (
                    <tr key={p.key} className={isCurrent ? 'border-b border-[#E4E0D8] bg-[#F7FCFA]' : 'border-b border-[#EFECE6]'}>
                      <td className="py-2 pr-3">
                        <Link to={`/ledger?unit=${unit}&anchor=${p.start}`} className="font-semibold text-[#0B6357] hover:underline">
                          {p.label}
                        </Link>
                        {isCurrent && <span className="chip chip-teal ml-2 !px-1.5 !py-0 text-[10px]">本期</span>}
                      </td>
                      <td className="num py-2 pr-3 text-right"><Money cents={p.income} /></td>
                      <td className="num py-2 pr-3 text-right"><Money cents={p.expense} /></td>
                      <td className="num py-2 pr-3 text-right font-medium"><Money cents={p.net} /></td>
                      <td className="num py-2 pr-3 text-right">{rateText(savingsRate(p.income, p.expense))}</td>
                      <td className="num py-2 pr-3 text-right"><Money cents={p.variableExpense} /></td>
                      <td className="num py-2 pr-3 text-right">{p.budget > 0 ? <Money cents={p.budget} /> : '—'}</td>
                      <td className={`num py-2 pr-3 text-right ${execPctClass(p)}`}>{execPctText(p)}</td>
                      <td className="num py-2 text-right">
                        {ePct === null ? (
                          <span className="text-[#A3A097]">—</span>
                        ) : (
                          <span className={ePct > 0 ? 'text-[#98362E]' : ePct < 0 ? 'text-[#0B6357]' : 'text-[#8A887F]'}>
                            {ePct > 0 ? '+' : ''}{ePct}%
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#E4E0D8] font-semibold" data-testid="report-total-row">
                  <td className="py-2 pr-3">窗口合计（{points.length} 期）</td>
                  <td className="num py-2 pr-3 text-right"><Money cents={totals.income} /></td>
                  <td className="num py-2 pr-3 text-right"><Money cents={totals.expense} /></td>
                  <td className="num py-2 pr-3 text-right"><Money cents={totalsNet} /></td>
                  <td className="num py-2 pr-3 text-right">{rateText(savingsRate(totals.income, totals.expense))}</td>
                  <td className="num py-2 pr-3 text-right"><Money cents={totals.variableExpense} /></td>
                  <td className="num py-2 pr-3 text-right">{totals.budget > 0 ? <Money cents={totals.budget} /> : '—'}</td>
                  <td className={`num py-2 pr-3 text-right ${totals.budget > 0 && totals.variableExpense / totals.budget > 1 ? 'text-[#98362E]' : ''}`}>
                    {totals.budget > 0 ? `${Math.round((totals.variableExpense / totals.budget) * 1000) / 10}%` : '—'}
                  </td>
                  <td className="py-2 text-right text-[#A3A097]">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
