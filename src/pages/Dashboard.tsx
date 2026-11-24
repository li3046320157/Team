import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Plus,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { EChartsOption } from 'echarts';
import { useAppStore } from '../store/useAppStore';
import { addDaysISO, formatCN, startOfMonthISO, todayISO } from '../domain/days';
import { freeDisposable, goalViews, monthIncomeExpense, totalBalanceAt, totalReservedAt } from '../domain/ledger';
import { runForecast } from '../domain/forecasting/engine';
import { buildOccurrenceViews } from '../domain/occurrences';
import { formatMoneyShort } from '../domain/money';
import { EChart } from '../components/Chart';
import { Badge, Button, Card, EmptyState, Money, PageHeader, Progress, StatCard, cn } from '../components/ui';
import { dueLabel, monthLabel, riskText } from '../lib/ui';

export function DashboardPage() {
  const dataset = useAppStore((s) => s.dataset)!;
  const mode = useAppStore((s) => s.mode);
  const navigate = useNavigate();
  const today = todayISO();
  const month = today.slice(0, 7);

  const summary = useMemo(() => {
    const balance = totalBalanceAt(dataset.accounts, dataset.transactions, today);
    const reserved = totalReservedAt(dataset.goalEvents, today);
    const free = freeDisposable(balance, reserved, dataset.settings.safetyReserve);
    const monthStats = monthIncomeExpense(dataset.transactions, month);
    const forecast = runForecast({
      asOfDate: today,
      horizonDays: 90,
      dataset,
      coverage: dataset.settings.coverage,
      settings: dataset.settings,
    });
    const views = buildOccurrenceViews(
      dataset.flows,
      dataset.occurrenceRecords,
      addDaysISO(today, -90),
      addDaysISO(today, 30),
      today,
    );
    const tasks = views.filter((v) => v.status === 'pending' && v.dueDate <= today);
    const upcoming = views.filter((v) => v.status === 'pending' && v.dueDate > today).slice(0, 5);
    const goals = goalViews(dataset.goals, dataset.goalEvents, today).filter((g) => g.goal.status === 'active');
    return { balance, reserved, free, monthStats, forecast, tasks, upcoming, goals };
  }, [dataset, today, month]);

  const { forecast } = summary;
  const riskLevel = forecast.risk.firstNegative ? 'danger' : forecast.risk.firstBelowSafety ? 'warning' : 'safe';

  const chartDays = forecast.days.filter((d) => !d.isToday).slice(0, 31);
  const option = useMemo<EChartsOption>(() => {
    const dates = chartDays.map((d) => d.date);
    return {
      animationDuration: 500,
      grid: { left: 46, right: 14, top: 18, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#FFFDF9',
        borderColor: '#E4E0D8',
        textStyle: { color: '#1F2421', fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = params as { axisValue: string; value: number }[];
          const p = arr[0];
          if (!p) return '';
          return `${formatCN(p.axisValue)}<br/>预计余额 ¥${(p.value / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
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
          interval: Math.max(0, Math.floor(dates.length / 6) - 1),
        },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#8A887F', fontSize: 10, formatter: (v: number) => formatMoneyShort(v) },
        splitLine: { lineStyle: { color: '#F0EDE6' } },
      },
      series: [
        {
          type: 'line',
          smooth: 0.25,
          showSymbol: false,
          data: chartDays.map((d) => d.balance),
          lineStyle: { width: 2, color: '#0E7568' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(14,117,104,0.22)' },
                { offset: 1, color: 'rgba(14,117,104,0.01)' },
              ],
            },
          },
          markLine: dataset.settings.safetyReserve > 0
            ? {
                silent: true,
                symbol: 'none',
                label: {
                  formatter: `安全线 ${formatMoneyShort(dataset.settings.safetyReserve)}`,
                  color: '#B7791F',
                  fontSize: 10,
                  position: 'insideEndTop',
                },
                lineStyle: { color: '#D8A64F', type: 'dashed', width: 1 },
                data: [{ yAxis: dataset.settings.safetyReserve }],
              }
            : undefined,
        },
      ],
    };
  }, [chartDays, dataset.settings.safetyReserve]);

  const noAccounts = dataset.accounts.length === 0;

  return (
    <div className="fade-in" data-testid="dashboard">
      <PageHeader
        title={mode === 'demo' ? '示例总览' : '今天，钱流如何'}
        description={
          <>
            你的财务主页：今天余额、本月收支、待办与未来走势一目了然。{formatCN(today)} · {monthLabel(month)}。{mode === 'demo' ? '当前展示合成示例数据，个人账本独立保存。' : '所有预测基于本机账本，预测不是收益承诺。'}
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/sandbox')}>
              <Sparkles size={15} /> 消费沙盘
            </Button>
            <Button variant="primary" onClick={() => navigate('/ledger?quick=1')} data-testid="quick-add">
              <Plus size={15} /> 记一笔
            </Button>
          </>
        }
      />

      {noAccounts ? (
        <Card>
          <EmptyState
            title="还没有账户"
            description="先创建一个账户并填写期初余额，才能开始预测。"
            action={<Button variant="primary" onClick={() => navigate('/settings')}>去添加账户</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="总余额" value={<Money cents={summary.balance} />} hint={`${dataset.accounts.length} 个账户合计`} />
            <StatCard
              label="可用可支配"
              value={<Money cents={summary.free} />}
              hint={`已扣目标预留 ${formatMoneyShort(summary.reserved)} 与安全储备`}
              tone={summary.free < 0 ? 'danger' : 'teal'}
            />
            <StatCard
              label={`${monthLabel(month)}结余`}
              value={<Money cents={summary.monthStats.net} />}
              hint={
                <span className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-0.5 text-[#0B6357]"><TrendingUp size={12} />{formatMoneyShort(summary.monthStats.income)}</span>
                  <span className="inline-flex items-center gap-0.5 text-[#98362E]"><TrendingDown size={12} />{formatMoneyShort(summary.monthStats.expense)}</span>
                </span>
              }
              tone={summary.monthStats.net >= 0 ? 'teal' : 'amber'}
            />
            <StatCard
              label="现金流状态"
              value={
                <span className={cn('flex items-center gap-2', riskLevel === 'danger' && 'text-[#98362E]', riskLevel === 'warning' && 'text-[#8A5A13]', riskLevel === 'safe' && 'text-[#0B6357]')}>
                  {riskLevel === 'danger' ? <TrendingDown size={20} /> : riskLevel === 'warning' ? <CalendarClock size={20} /> : <ShieldCheck size={20} />}
                  <span className="text-[19px]">{riskText(riskLevel)}</span>
                </span>
              }
              hint={
                forecast.risk.firstNegative
                  ? `预计 ${formatCN(forecast.risk.firstNegative)} 可能透支`
                  : forecast.risk.firstBelowSafety
                    ? `预计 ${formatCN(forecast.risk.firstBelowSafety)} 首次低于安全线`
                    : '90 天预测期内不低于安全线'
              }
              tone={riskLevel === 'danger' ? 'danger' : riskLevel === 'warning' ? 'amber' : 'default'}
            />
          </div>

          {(riskLevel !== 'safe' || forecast.coverageRisks.length > 0) && (
            <div className="mt-3 flex flex-col gap-2 rounded-xl border border-[#EEDCB9] bg-[#FBF4E4] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2 text-[12.5px] leading-relaxed text-[#7A5517]">
                <CalendarClock size={16} className="mt-0.5 shrink-0" />
                <span>
                  预测期内最低余额 <Money cents={forecast.risk.minBalance} />（{formatCN(forecast.risk.minBalanceDate)}）。
                  {forecast.coverageRisks.length > 0 && ' 有同日收支按“支出优先”检查会短暂不足，详见预测页假设。'}
                </span>
              </div>
              <Link to="/forecast" className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-[#7A5517] hover:underline">
                查看预测 <ChevronRight size={14} />
              </Link>
            </div>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.55fr_1fr]">
            <Card
              title="未来 30 天余额"
              subtitle="实线为日终预计余额；虚线为安全储备。首版不估计当天新增零散消费。"
              action={<Link className="text-[12px] font-semibold text-[#0B6357] hover:underline" to="/forecast">90 天详情</Link>}
            >
              <EChart option={option} height={260} ariaLabel="未来 30 天预计余额折线图" />
            </Card>

            <div className="grid gap-4">
              <Card
                title="今日待办"
                subtitle="逾期支出会按今日待付保守计入预测"
                action={summary.tasks.length > 0 ? <Badge tone="amber">{summary.tasks.length} 项</Badge> : <Badge tone="teal">已清</Badge>}
              >
                {summary.tasks.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-lg bg-[#F1FAF7] px-3 py-3 text-[12.5px] text-[#0B6357]">
                    <CheckCircle2 size={16} /> 今天没有待确认的计划支出或收入。
                  </div>
                ) : (
                  <ul className="space-y-2.5">
                    {summary.tasks.slice(0, 4).map((task) => (
                      <li key={task.id} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium">{task.flow.title}</p>
                          <p className="text-[11px] text-[#8A887F]">
                            {task.overdue ? dueLabel(task.daysUntilDue) : '今天'} · {task.flow.kind === 'income' ? '收入' : '支出'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Money cents={task.amount} className={cn('text-[13px] font-semibold', task.flow.kind === 'income' ? 'text-[#0B6357]' : '')} />
                          <Button size="xs" variant="secondary" onClick={() => navigate('/schedules')}>处理</Button>
                        </div>
                      </li>
                    ))}
                    {summary.tasks.length > 4 && (
                      <li className="pt-1 text-center">
                        <Link to="/schedules" className="text-[11.5px] font-medium text-[#0B6357] hover:underline">其余 {summary.tasks.length - 4} 项</Link>
                      </li>
                    )}
                  </ul>
                )}
              </Card>

              <Card title="接下来" subtitle="未来 30 天的固定计划" action={<Button size="xs" variant="ghost" onClick={() => navigate('/schedules')}>全部 <ArrowRight size={13} /></Button>}>
                {summary.upcoming.length === 0 ? (
                  <p className="text-[12px] text-[#8A887F]">未来 30 天没有固定计划。</p>
                ) : (
                  <ul className="space-y-2.5">
                    {summary.upcoming.map((view) => (
                      <li key={view.id} className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#F4F1EA] text-[10px] font-semibold text-[#6B6A63]">
                            {view.dueDate.slice(8, 10)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[12.5px] font-medium">{view.flow.title}</p>
                            <p className="text-[10.5px] text-[#8A887F]">{dueLabel(view.daysUntilDue)}</p>
                          </div>
                        </div>
                        <Money cents={view.amount} className={cn('shrink-0 text-[12.5px] font-semibold', view.flow.kind === 'income' ? 'text-[#0B6357]' : '')} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card
              title="目标进度"
              subtitle="目标预留是可自由支配金额的 earmark，不改变账户余额"
              action={<Link to="/goals" className="text-[12px] font-semibold text-[#0B6357] hover:underline">管理目标</Link>}
            >
              {summary.goals.length === 0 ? (
                <p className="text-[12px] text-[#8A887F]">还没有储蓄目标。</p>
              ) : (
                <ul className="space-y-4">
                  {summary.goals.slice(0, 3).map((g) => (
                    <li key={g.goal.id}>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#E3F1ED] text-[#0B6357]"><Wallet size={14} /></span>
                          <span className="truncate text-[13px] font-medium">{g.goal.name}</span>
                          {g.status === 'overdue' && <Badge tone="danger">逾期</Badge>}
                        </div>
                        <span className="num shrink-0 text-[11.5px] text-[#6B6A63]">
                          {formatMoneyShort(g.reserved)} / {formatMoneyShort(g.goal.targetAmount)}
                        </span>
                      </div>
                      <Progress value={g.reserved} max={g.goal.targetAmount} tone={g.status === 'overdue' ? 'amber' : 'teal'} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="账户" subtitle="转账会在账户间同时记一笔，不改变总余额">
              <ul className="space-y-3">
                {dataset.accounts.filter((a) => !a.archived).map((account) => {
                  const balance = totalBalanceAt([account], dataset.transactions, today);
                  return (
                    <li key={account.id} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#F4F1EA] text-[#6B6A63]">
                          <CircleDollarSign size={15} />
                        </span>
                        <div>
                          <p className="text-[12.5px] font-medium">{account.name}</p>
                          <p className="text-[10.5px] text-[#8A887F]">{account.type === 'savings' ? '储蓄' : account.type === 'cash' ? '现金' : '电子钱包'}</p>
                        </div>
                      </div>
                      <Money cents={balance} className="text-[13px] font-semibold" />
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 rounded-lg bg-[#FAF8F3] px-3 py-2.5 text-[11px] leading-relaxed text-[#8A887F]">
                余额 = 期初余额 + 收入 − 支出 ± 转账。目标预留与安全储备只影响可支配金额。
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}