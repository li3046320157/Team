import { useMemo, useRef, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Database,
  FlaskConical,
  LayoutDashboard,
  LineChart,
  List,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
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
import { Badge, Button, Card, EmptyState, AnimatedMoney, Money, Progress, StatCard, cn } from '../components/ui';
import { gsap, isReducedMotion, useGSAP } from '../motion/gsap';
import { dueLabel, monthLabel, riskText } from '../lib/ui';
import { cssColor } from '../theme/palette';

const FEATURES = [
  { to: '/', icon: LayoutDashboard, title: '总览', desc: '今天余额、本月收支、今日待办与 90 天风险状态一眼看清。', hue: 'var(--tone-blue)' },
  { to: '/ledger', icon: List, title: '流水', desc: '表单或一句话速记，收入、支出、转账都记在同一本账。', hue: 'var(--tone-teal)' },
  { to: '/schedules', icon: Calendar, title: '计划', desc: '房租、订阅等固定收支建成计划，到期一键核销为真实流水。', hue: 'var(--tone-amber)' },
  { to: '/insights', icon: Sparkles, title: '洞察', desc: '聚合高频小额、标出异常消费，并从历史中识别周期收支。', hue: 'var(--tone-violet)' },
  { to: '/forecast', icon: LineChart, title: '预测', desc: '滚动预测未来 90 天余额，并明确标注假设、来源与限制。', hue: 'var(--tone-cyan)' },
  { to: '/assistant', icon: Bot, title: 'AI 分析', desc: '自带 API 密钥，让模型基于你的账本摘要给出可执行建议。', hue: 'var(--tone-rose)' },
  { to: '/sandbox', icon: FlaskConical, title: '决策沙盘', desc: '大额消费前先模拟：立即买、延后买、分阶段买的影响对比。', hue: 'var(--tone-orange)' },
  { to: '/goals', icon: Target, title: '目标', desc: '为旅行、应急金等目标预留资金，进度与截止日一目了然。', hue: 'var(--tone-green)' },
  { to: '/data', icon: Database, title: '数据中心', desc: '备份、恢复、导出 CSV，回看历史快照与校准结果。', hue: 'var(--tone-slate)' },
  { to: '/settings', icon: SlidersHorizontal, title: '设置', desc: '维护账户、安全储备线与预算，参数即时影响预测。', hue: 'var(--tone-stone)' },
];

export function DashboardPage() {
  const dataset = useAppStore((s) => s.dataset)!;
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
          lineStyle: { width: 2, color: cssColor('--accent', '#0e7568') },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `rgba(${cssColor('--accent-rgb', '14, 117, 104')},0.22)` },
                { offset: 1, color: `rgba(${cssColor('--accent-rgb', '14, 117, 104')},0.01)` },
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
  const heroRef = useRef<HTMLElement>(null);

  useGSAP(() => {
    if (!heroRef.current) return;
    const reduce = isReducedMotion();
    const items = gsap.utils.toArray<HTMLElement>('[data-hero-item]', heroRef.current);
    if (items.length === 0) return;
    gsap.from(items, {
      opacity: 0,
      y: reduce ? 0 : 18,
      duration: reduce ? 0.35 : 0.7,
      ease: 'power3.out',
      stagger: reduce ? 0.05 : 0.09,
      delay: 0.06,
      clearProps: 'transform,opacity',
    });
  }, { scope: heroRef });

  return (
    <div className="fade-in" data-testid="dashboard">
      <section ref={heroRef} className="card overflow-hidden" data-reveal="none" aria-labelledby="intro-heading">
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.25fr_0.75fr]">
          <div>
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10.5px] font-semibold text-[var(--accent-ink)]" data-hero-item>
              <Sparkles size={12} /> 关于 MoneyFlow 钱流
            </span>
            <h1 id="intro-heading" className="mt-3 text-[25px] font-semibold leading-[1.25] tracking-[-0.02em] sm:text-[30px]" data-hero-item>
              花钱之前，先把未来 90 天的现金流看清楚。
            </h1>
            <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[#5F5E57]" data-hero-item>
              我们做这套系统，是因为「这个月钱去哪了」「下个月会不会透支」不该靠猜。MoneyFlow 把真实流水、固定计划与目标预留放进同一本本地账本，
              用可解释的模型给出余额预测，让你在做大额消费之前就能评估影响，而不是月底才后悔。
            </p>
            <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-[#8A887F]" data-hero-item>
              所有账户与账单只保存在本机浏览器（IndexedDB），不上传服务器；预测只是规划参考，不构成收益承诺。
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2" data-hero-item>
              <Button variant="primary" onClick={() => navigate('/ledger?quick=1')} data-testid="quick-add">
                <Plus size={15} /> 记一笔
              </Button>
              <Button variant="secondary" onClick={() => navigate('/sandbox')}>
                <Sparkles size={15} /> 消费沙盘
              </Button>
              <span className="chip chip-teal">本地优先</span>
              <span className="chip">整数分记账</span>
              <span className="chip">可解释预测</span>
            </div>
          </div>
          <div className="rounded-2xl border border-[#E9E4DA] bg-[#FAF8F3] p-4" data-hero-item>
            <p className="text-[12px] font-semibold text-[#3A3D37]">推荐使用顺序</p>
            <ol className="mt-2.5 space-y-2 text-[11.5px] leading-relaxed text-[#6B6A63]">
              <li><span className="num mr-1.5 font-semibold text-[var(--accent-ink)]">1</span>建立账户，填写期初余额与安全储备线</li>
              <li><span className="num mr-1.5 font-semibold text-[var(--accent-ink)]">2</span>记录流水，把房租等固定收支建成计划</li>
              <li><span className="num mr-1.5 font-semibold text-[var(--accent-ink)]">3</span>看预测与洞察，用沙盘评估大额消费</li>
              <li><span className="num mr-1.5 font-semibold text-[var(--accent-ink)]">4</span>为目标预留资金，按节奏沉淀储蓄</li>
            </ol>
            <p className="mt-3 rounded-lg bg-white/70 px-2.5 py-2 text-[10.5px] leading-relaxed text-[#8A887F]">
              不需要一次填完：先记今天的一笔，系统会随数据逐步校准。
            </p>
          </div>
        </div>
        <div className="border-t border-[#EFECE6] p-5 sm:p-7">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2" data-reveal="">
            <h2 className="text-[15px] font-semibold">全部功能 · 每个模块解决什么问题</h2>
            <p className="text-[10.5px] text-[#8A887F]">点击卡片进入对应页面</p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {FEATURES.map((feature) => (
              <li key={feature.title} data-reveal="">
                <Link
                  to={feature.to}
                  className="group feature-tile flex h-full gap-2.5 rounded-xl border p-3"
                  style={{ '--tile-hue': feature.hue } as CSSProperties}
                >
                  <span className="feature-icon mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg">
                    <feature.icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 text-[12.5px] font-semibold">
                      {feature.title}
                      <ChevronRight size={12} className="text-[#A3A097] transition-transform duration-200 group-hover:translate-x-0.5" />
                    </span>
                    <span className="mt-0.5 block text-[10.5px] leading-relaxed text-[#7A786F]">{feature.desc}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="mb-3 mt-6 flex flex-wrap items-end justify-between gap-2" data-reveal="">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.01em]">账本速览</h2>
          <p className="mt-1 text-[12px] text-[#8A887F]">{formatCN(today)} · {monthLabel(month)} · 总余额、待办与未来走势</p>
        </div>
        <Link to="/forecast" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent-ink)] hover:underline">
          查看完整预测 <ChevronRight size={14} />
        </Link>
      </div>

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
            <StatCard label="总余额" value={<AnimatedMoney id="stat.balance" cents={summary.balance} />} hint={`${dataset.accounts.length} 个账户合计`} tone="accent" />
            <StatCard
              label="可用可支配"
              value={<AnimatedMoney id="stat.free" cents={summary.free} />}
              hint={`已扣目标预留 ${formatMoneyShort(summary.reserved)} 与安全储备`}
              tone={summary.free < 0 ? 'danger' : 'positive'}
            />
            <StatCard
              label={`${monthLabel(month)}结余`}
              value={<AnimatedMoney id="stat.net" cents={summary.monthStats.net} />}
              hint={
                <span className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-0.5 text-[var(--tone-green)]"><TrendingUp size={12} />{formatMoneyShort(summary.monthStats.income)}</span>
                  <span className="inline-flex items-center gap-0.5 text-[#98362E]"><TrendingDown size={12} />{formatMoneyShort(summary.monthStats.expense)}</span>
                </span>
              }
              tone={summary.monthStats.net >= 0 ? 'accent2' : 'danger'}
            />
            <StatCard
              label="现金流状态"
              value={
                <span className="flex items-center gap-2 text-[var(--stat-ink)]">
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
              tone={riskLevel === 'danger' ? 'danger' : riskLevel === 'warning' ? 'warning' : 'positive'}
            />
          </div>

          {(riskLevel !== 'safe' || forecast.coverageRisks.length > 0) && (
            <div className="rise mt-3 flex flex-col gap-2 rounded-xl border border-[#EEDCB9] bg-[#FBF4E4] px-4 py-3 sm:flex-row sm:items-center sm:justify-between" style={{ '--d': '40ms' } as CSSProperties}>
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
              action={<Link className="text-[12px] font-semibold text-[var(--accent-ink)] hover:underline" to="/forecast">90 天详情</Link>}
            >
              <EChart option={option} height={260} ariaLabel="未来 30 天预计余额折线图" />
            </Card>

            <div className="grid gap-4">
              <Card
                className="rise"
                style={{ '--i': 0 } as CSSProperties}
                title="今日待办"
                subtitle="逾期支出会按今日待付保守计入预测"
                action={summary.tasks.length > 0 ? <Badge tone="amber">{summary.tasks.length} 项</Badge> : <Badge tone="teal">已清</Badge>}
              >
                {summary.tasks.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--accent-soft)] px-3 py-3 text-[12.5px] text-[var(--accent-ink)]">
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
                          <Money cents={task.amount} className={cn('text-[13px] font-semibold', task.flow.kind === 'income' ? 'text-[var(--accent-ink)]' : '')} />
                          <Button size="xs" variant="secondary" onClick={() => navigate('/schedules')}>处理</Button>
                        </div>
                      </li>
                    ))}
                    {summary.tasks.length > 4 && (
                      <li className="pt-1 text-center">
                        <Link to="/schedules" className="text-[11.5px] font-medium text-[var(--accent-ink)] hover:underline">其余 {summary.tasks.length - 4} 项</Link>
                      </li>
                    )}
                  </ul>
                )}
              </Card>

              <Card className="rise" style={{ '--i': 1 } as CSSProperties} title="接下来" subtitle="未来 30 天的固定计划" action={<Button size="xs" variant="ghost" onClick={() => navigate('/schedules')}>全部 <ArrowRight size={13} /></Button>}>
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
                        <Money cents={view.amount} className={cn('shrink-0 text-[12.5px] font-semibold', view.flow.kind === 'income' ? 'text-[var(--accent-ink)]' : '')} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card
              className="rise"
              style={{ '--i': 0 } as CSSProperties}
              title="目标进度"
              subtitle="目标预留是可自由支配金额的 earmark，不改变账户余额"
              action={<Link to="/goals" className="text-[12px] font-semibold text-[var(--accent-ink)] hover:underline">管理目标</Link>}
            >
              {summary.goals.length === 0 ? (
                <p className="text-[12px] text-[#8A887F]">还没有储蓄目标。</p>
              ) : (
                <ul className="space-y-4">
                  {summary.goals.slice(0, 3).map((g) => (
                    <li key={g.goal.id}>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]"><Wallet size={14} /></span>
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

            <Card className="rise" style={{ '--i': 1 } as CSSProperties} title="账户" subtitle="转账会在账户间同时记一笔，不改变总余额">
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