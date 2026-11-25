import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Camera, CircleHelp, Info, TriangleAlert } from 'lucide-react';
import type { EChartsOption } from 'echarts';
import { useAppStore } from '../store/useAppStore';
import { addDaysISO, formatCN, todayISO, weekdayIndex } from '../domain/days';
import { runForecast } from '../domain/forecasting/engine';
import { formatMoneyShort } from '../domain/money';
import { EChart } from '../components/Chart';
import { Badge, Button, Card, InfoNote, Money, PageHeader, Segmented, StatCard, cn } from '../components/ui';
import { dueLabel, riskText, weekdayCN } from '../lib/ui';

const SOURCE_LABEL: Record<string, string> = {
  weekday: '同星期中位数',
  budget: '月预算日均',
  daily_avg: '近期日均',
  none: '未估计',
};

export function ForecastPage() {
  const dataset = useAppStore((s) => s.dataset)!;
  const makeSnapshot = useAppStore((s) => s.makeSnapshot);
  const today = todayISO();
  const [horizon, setHorizon] = useState<30 | 60 | 90>(90);

  const forecast = useMemo(
    () => runForecast({ asOfDate: today, horizonDays: horizon, dataset, coverage: dataset.settings.coverage, settings: dataset.settings }),
    [dataset, today, horizon],
  );
  const risk = forecast.risk;
  const level = risk.firstNegative ? 'danger' : risk.firstBelowSafety ? 'warning' : 'safe';
  const end = horizon === 30 ? risk.end30 : horizon === 60 ? risk.end60 : risk.end90;

  const chartDays = forecast.days.filter((d) => !d.isToday).slice(0, horizon + 1);
  const option = useMemo<EChartsOption>(() => {
    const dates = chartDays.map((d) => d.date);
    const minIndex = chartDays.reduce((best, d, i) => (d.balance < (chartDays[best]?.balance ?? Number.POSITIVE_INFINITY) ? i : best), 0);
    return {
      grid: { left: 50, right: 18, top: 26, bottom: 30 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#FFFDF9',
        borderColor: '#E4E0D8',
        textStyle: { color: '#1F2421', fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = params as { axisValue: string; dataIndex: number }[];
          const p = arr[0];
          if (!p) return '';
          const day = chartDays[p.dataIndex];
          if (!day) return '';
          const lines = [
            `<b>${formatCN(day.date)}</b>`,
            `预计余额 ¥${(day.balance / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`,
            `目标预留 ¥${(day.reserved / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`,
            `可用 ¥${(day.free / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`,
          ];
          if (day.income) lines.push(`收入 +¥${(day.income / 100).toFixed(2)}`);
          if (day.fixedExpense) lines.push(`固定支出 −¥${(day.fixedExpense / 100).toFixed(2)}`);
          if (day.variableEstimate !== null) lines.push(`可变估计 −¥${(day.variableEstimate / 100).toFixed(2)}（${SOURCE_LABEL[day.variableSource]}）`);
          if (day.scenarioExpense) lines.push(`方案支出 −¥${(day.scenarioExpense / 100).toFixed(2)}`);
          return lines.join('<br/>');
        },
      },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#E4E0D8' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#8A887F',
          fontSize: 10,
          formatter: (value: string) => `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`,
          interval: Math.max(1, Math.floor(dates.length / 7) - 1),
        },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#8A887F', fontSize: 10, formatter: (v: number) => formatMoneyShort(v) },
        splitLine: { lineStyle: { color: '#F0EDE6' } },
      },
      series: [
        {
          name: '预计余额',
          type: 'line',
          smooth: 0.22,
          showSymbol: false,
          data: chartDays.map((d) => d.balance),
          lineStyle: { width: 2.2, color: '#0E7568' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(14,117,104,0.2)' },
                { offset: 1, color: 'rgba(14,117,104,0.01)' },
              ],
            },
          },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { color: '#B7791F', fontSize: 10, formatter: `安全线 ${formatMoneyShort(dataset.settings.safetyReserve)}`, position: 'insideEndTop' },
            lineStyle: { color: '#D8A64F', type: 'dashed', width: 1 },
            data: [{ yAxis: dataset.settings.safetyReserve }],
          },
          markPoint: chartDays.length
            ? {
                symbol: 'circle',
                symbolSize: 7,
                itemStyle: { color: '#B5453C' },
                label: {
                  show: true,
                  position: 'top',
                  color: '#98362E',
                  fontSize: 10,
                  formatter: () => `最低 ${formatMoneyShort(chartDays[minIndex]?.balance ?? 0)}`,
                },
                data: [{ name: '最低点', coord: [minIndex, chartDays[minIndex]?.balance ?? 0] }],
              }
            : undefined,
        },
      ],
    };
  }, [chartDays, dataset.settings.safetyReserve, horizon]);

  const recent = forecast.days.filter((d) => !d.isToday).slice(0, 14);
  const todayItems = forecast.todayItems;

  return (
    <div className="fade-in" data-testid="forecast">
      <PageHeader
        title="现金流预测"
        description="推算未来 30/60/90 天每天的余额，提前发现钱不够用的日子。同一条引擎同时服务于总览、沙盘与目标投影。假设、覆盖率、可变估计来源与校准状态全部可见。"
        actions={
          <>
            <Segmented<'30' | '60' | '90'>
              value={String(horizon) as '30' | '60' | '90'}
              onChange={(v) => setHorizon(Number(v) as 30 | 60 | 90)}
              options={[{ value: '30', label: '30 天' }, { value: '60', label: '60 天' }, { value: '90', label: '90 天' }]}
            />
            <Button variant="secondary" onClick={() => void makeSnapshot()}><Camera size={14} /> 保存快照</Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard key={horizon} className="balance-pulse" label={`${horizon} 天后余额`} value={<Money cents={end} />} hint="按当前计划与消费模型推算" tone={end < 0 ? 'danger' : 'default'} />
        <StatCard key={horizon} className="balance-pulse" label="预测期最低余额" value={<Money cents={risk.minBalance} />} hint={`${formatCN(risk.minBalanceDate)} · 最低可用 ${formatMoneyShort(risk.minFree)}`} tone={level === 'danger' ? 'danger' : level === 'warning' ? 'amber' : 'teal'} />
        <StatCard
          key={horizon}
          className="balance-pulse"
          label="现金流状态"
          value={<span className="text-[18px]">{riskText(level)}</span>}
          hint={
            risk.firstBelowSafety
              ? `${formatCN(risk.firstBelowSafety)} 首次低于安全线，共 ${risk.daysBelowSafety} 天`
              : '预测期内不会低于安全储备'
          }
          tone={level === 'danger' ? 'danger' : level === 'warning' ? 'amber' : 'default'}
        />
        <StatCard key={horizon} className="balance-pulse" label="目标预留合计" value={<Money cents={forecast.baseReserved} />} hint="可用 = 余额 − 预留 − 安全储备" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card
          className="rise"
          style={{ '--i': 0 } as CSSProperties}
          title={`未来 ${horizon} 天余额曲线`}
          subtitle="红线标记预测期最低点；悬停可看每日收入、固定支出与可变估计。"
          action={
            <span key={forecast.model.trainingDayCount} className="balance-pulse inline-flex">
              <Badge tone="white">{forecast.model.trainingDayCount} 个训练日</Badge>
            </span>
          }
        >
          <EChart option={option} height={330} ariaLabel="未来余额预测曲线" />
          {forecast.coverageRisks.length > 0 && (
            <div className="mt-2 space-y-1 rounded-lg border border-[#EEDCB9] bg-[#FBF4E4] px-3 py-2 text-[11px] leading-relaxed text-[#7A5517]">
              <p className="font-semibold">同日收支覆盖风险（按支出先于收入到账检查）</p>
              {forecast.coverageRisks.slice(0, 3).map((c) => (
                <p key={`${c.date}-${c.shortfall}`}>
                  {formatCN(c.date)}：支出 <Money cents={c.expense} />，当日收入 <Money cents={c.income} />，支出后距安全线缺口 <Money cents={c.shortfall} />。
                </p>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="rise" style={{ '--i': 1 } as CSSProperties} title="今日待付 / 待收" subtitle="逾期支出按今日计入；逾期收入不默认到账" action={<Link to="/schedules" className="text-[11.5px] font-semibold text-[#0B6357] hover:underline">处理</Link>}>
            {todayItems.length === 0 ? (
              <p className="text-[12px] text-[#8A887F]">今天没有待处理的固定计划。</p>
            ) : (
              <ul className="space-y-2.5">
                {todayItems.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 text-[12px]">
                    <div>
                      <p className="font-medium">{v.flow.title}</p>
                      <p className="text-[10.5px] text-[#8A887F]">{v.overdue ? dueLabel(v.daysUntilDue) : '今天'} · {v.flow.kind === 'income' ? '收入' : '支出'}</p>
                    </div>
                    <Money cents={v.amount} className={cn('font-semibold', v.flow.kind === 'income' && 'text-[#0B6357]')} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="rise" style={{ '--i': 2 } as CSSProperties} title="可变消费模型" subtitle="最近 6 周；每个星期几至少 3 个样本才用中位数">
            <div className="grid grid-cols-7 gap-1">
              {[1, 2, 3, 4, 5, 6, 0].map((w, i) => {
                const stat = forecast.model.weekdayStats[w];
                const bias = dataset.settings.calibration.weekdayBias[w] ?? 0;
                return (
                  <div key={w} className="rise rounded-lg bg-[#FAF8F3] px-1 py-2 text-center" style={{ '--d': `${i * 20}ms` } as CSSProperties}>
                    <p className="text-[10px] text-[#8A887F]">{weekdayCN(w)}</p>
                    <p className="num mt-1 text-[11px] font-semibold">{stat?.median === null || stat?.median === undefined ? '—' : formatMoneyShort(stat.median)}</p>
                    <p className="mt-0.5 text-[9.5px] text-[#A3A097]">{stat?.samples ?? 0} 样本</p>
                    {bias !== 0 && <p className={cn('num text-[9px]', bias > 0 ? 'text-[#98362E]' : 'text-[#0B6357]')}>{bias > 0 ? '+' : ''}{formatMoneyShort(bias)}</p>}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 space-y-1.5 text-[11px] leading-relaxed text-[#6B6A63]">
              <p>平均日消费：{forecast.model.avgDaily === null ? '样本不足' : formatMoneyShort(forecast.model.avgDaily)}；月预算：{dataset.settings.budget.monthVariableBudget > 0 ? formatMoneyShort(dataset.settings.budget.monthVariableBudget) : '未设置'}。</p>
              <p>覆盖率：{forecast.summary.coveredDays} 天；校准偏置：{Object.values(dataset.settings.calibration.weekdayBias).some((v) => v !== 0) ? '已启用' : '暂无显著偏置'}。</p>
              {forecast.model.sourceByWeekday.some((s) => s === 'none') && (
                <p className="text-[#8A5A13]">部分星期几因历史不足且未设置预算，标为「未估计」，不会当成零消费。</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Card className="rise" style={{ '--i': 0 } as CSSProperties} title="未来 14 天明细" subtitle="日终净额与可变估计来源" padded={false}>
          <div key={`detail-${horizon}`} className="table-wrap fade-swap">
            <table className="data">
              <thead><tr><th>日期</th><th className="text-right">收入</th><th className="text-right">固定支出</th><th className="text-right">可变估计</th><th className="text-right">日终余额</th></tr></thead>
              <tbody>
                {recent.map((d) => (
                  <tr key={d.date}>
                    <td className="whitespace-nowrap text-[12px]">{formatCN(d.date)}<span className="ml-1 text-[10px] text-[#A3A097]">{weekdayCN(weekdayIndex(d.date))}</span></td>
                    <td className="num text-right text-[12px] text-[#0B6357]">{d.income ? formatMoneyShort(d.income) : '—'}</td>
                    <td className="num text-right text-[12px] text-[#98362E]">{d.fixedExpense ? formatMoneyShort(d.fixedExpense) : '—'}</td>
                    <td className="num text-right text-[12px]">{d.variableEstimate === null ? <span className="text-[#B7791F]">未估计</span> : formatMoneyShort(d.variableEstimate)}<span className="ml-1 text-[9.5px] text-[#A3A097]">{d.variableEstimate !== null ? SOURCE_LABEL[d.variableSource] : ''}</span></td>
                    <td className={cn('num text-right text-[12px] font-semibold', d.balance < dataset.settings.safetyReserve && 'text-[#98362E]')}>{formatMoneyShort(d.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="rise" style={{ '--i': 1 } as CSSProperties} title="预测假设与限制" subtitle="这些文字会随当前数据变化">
          <ul className="space-y-2">
            {forecast.assumptions.map((a) => (
              <li key={a} className="flex items-start gap-2 text-[11.5px] leading-relaxed text-[#6B6A63]">
                <Info size={13} className="mt-0.5 shrink-0 text-[#8A887F]" /> {a}
              </li>
            ))}
            <li className="flex items-start gap-2 text-[11.5px] leading-relaxed text-[#6B6A63]">
              <CalendarClock size={13} className="mt-0.5 shrink-0 text-[#8A887F]" /> 月度计划按原始日号推进，月底自动截断，不会永久漂移。
            </li>
            <li className="flex items-start gap-2 text-[11.5px] leading-relaxed text-[#6B6A63]">
              <TriangleAlert size={13} className="mt-0.5 shrink-0 text-[#8A887F]" /> 预测是规划参考，不构成收益承诺或消费建议。
            </li>
          </ul>
          <div className="mt-3">
            <InfoNote>
              预测完成校准后，偏置记录在数据中心可查。历史不足时，模型不会假装精准；它会明确显示「未估计」或使用月预算降级。
            </InfoNote>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[10.5px] text-[#A3A097]">
            <CircleHelp size={12} /> 快照会自动按天保存；也可手动保存用于回顾当时的判断。
          </div>
        </Card>
      </div>
    </div>
  );
}