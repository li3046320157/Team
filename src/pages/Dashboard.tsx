import { useMemo, useRef, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Database,
  FlaskConical,
  LayoutDashboard,
  LineChart,
  List,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { EChartsOption } from 'echarts';
import type { Transaction } from '../domain/types';
import { useAppStore } from '../store/useAppStore';
import { addDaysISO, diffDays, enumerateDays, formatCN, todayISO } from '../domain/days';
import { freeDisposable, goalViews, totalBalanceAt, totalReservedAt } from '../domain/ledger';
import type { Period } from '../domain/period';
import { periodLabel, previousPeriod } from '../domain/period';
import { compareTotals, periodTotals } from '../domain/periodStats';
import { usePeriodParams } from '../lib/usePeriodParams';
import { buildOccurrenceViews } from '../domain/occurrences';
import { formatMoneyShort } from '../domain/money';
import { EChart } from '../components/Chart';
import { PeriodPicker } from '../components/PeriodPicker';
import { Badge, Button, Card, EmptyState, Money, Progress, StatCard, cn } from '../components/ui';
import { CountUpMoney, Marquee, ScrambleText, ScrollStory } from '../components/TextFx';
import { gsap, isReducedMotion, useGSAP } from '../motion/gsap';
import { dueLabel } from '../lib/ui';
import { cssColor } from '../theme/palette';

type DashUnit = 'day' | 'week' | 'month' | 'year';

const UNIT_META: Record<DashUnit, { label: string; caption: string; trendTitle: string; trendNote: string }> = {
  day: {
    label: '今日',
    caption: '今天',
    trendTitle: '近 14 天收支趋势',
    trendNote: '按日汇总实际发生的收入与支出，转账不计入收支。',
  },
  week: {
    label: '本周',
    caption: '本周',
    trendTitle: '本周按日收支趋势',
    trendNote: '按日汇总本周实际发生的收入与支出，转账不计入收支。',
  },
  month: {
    label: '本月',
    caption: '本月',
    trendTitle: '今年按月收支趋势',
    trendNote: '按自然月汇总实际流水，可对照每月收支结构。',
  },
  year: {
    label: '今年',
    caption: '本年',
    trendTitle: '近 5 年收支趋势',
    trendNote: '按自然年汇总，用更长的视角观察收支变化。',
  },
};

interface TrendBucket {
  label: string;
  income: number;
  expense: number;
}

function buildTrend(transactions: Transaction[], unit: DashUnit, period: Period, today: string): TrendBucket[] {
  if (unit === 'day') {
    const days = enumerateDays(addDaysISO(today, -13), today);
    const map = new Map(days.map((day) => [day, { income: 0, expense: 0 }]));
    for (const t of transactions) {
      if (t.kind === 'transfer') continue;
      const slot = map.get(t.date);
      if (!slot) continue;
      if (t.kind === 'income') slot.income += t.amount;
      else slot.expense += t.amount;
    }
    return days.map((day) => ({
      label: `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`,
      ...map.get(day)!,
    }));
  }

  if (unit === 'week') {
    const end = period.end < today ? period.end : today;
    const days = enumerateDays(period.start, end);
    const map = new Map(days.map((day) => [day, { income: 0, expense: 0 }]));
    for (const t of transactions) {
      if (t.kind === 'transfer') continue;
      const slot = map.get(t.date);
      if (!slot) continue;
      if (t.kind === 'income') slot.income += t.amount;
      else slot.expense += t.amount;
    }
    return days.map((day) => ({
      label: `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`,
      ...map.get(day)!,
    }));
  }

  if (unit === 'month') {
    const year = today.slice(0, 4);
    const currentMonth = Number(today.slice(5, 7));
    const keys = Array.from({ length: currentMonth }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const map = new Map(keys.map((key) => [key, { income: 0, expense: 0 }]));
    for (const t of transactions) {
      if (t.kind === 'transfer') continue;
      const slot = map.get(t.date.slice(0, 7));
      if (!slot) continue;
      if (t.kind === 'income') slot.income += t.amount;
      else slot.expense += t.amount;
    }
    return keys.map((key) => ({
      label: `${Number(key.slice(5, 7))}月`,
      ...map.get(key)!,
    }));
  }

  const currentYear = Number(today.slice(0, 4));
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 4 + i);
  const map = new Map(years.map((year) => [String(year), { income: 0, expense: 0 }]));
  for (const t of transactions) {
    if (t.kind === 'transfer') continue;
    const slot = map.get(t.date.slice(0, 4));
    if (!slot) continue;
    if (t.kind === 'income') slot.income += t.amount;
    else slot.expense += t.amount;
  }
  return years.map((year) => ({
    label: `${year}`,
    ...map.get(String(year))!,
  }));
}

const FEATURES = [
  { to: '/', icon: LayoutDashboard, title: '总览', desc: '日、周、月、年的收入、支出与结余一眼看清，今日待办与目标进度同步呈现。', hue: 'var(--tone-blue)' },
  { to: '/ledger', icon: List, title: '流水', desc: '表单或一句话速记，收入、支出、转账都记在同一本账。', hue: 'var(--tone-teal)' },
  { to: '/schedules', icon: Calendar, title: '计划', desc: '房租、订阅等固定收支建成计划，到期一键核销为真实流水。', hue: 'var(--tone-amber)' },
  { to: '/insights', icon: Sparkles, title: '洞察', desc: '聚合高频小额、标出异常消费，并从历史中识别周期收支。', hue: 'var(--tone-violet)' },
  { to: '/forecast', icon: LineChart, title: '预测', desc: '滚动预测未来余额，并明确标注假设、来源与限制。', hue: 'var(--tone-cyan)' },
  { to: '/assistant', icon: Bot, title: 'AI 分析', desc: '自带 API 密钥，让模型基于你的账本摘要给出可执行建议。', hue: 'var(--tone-rose)' },
  { to: '/sandbox', icon: FlaskConical, title: '决策沙盘', desc: '大额消费前先模拟：立即买、延后买、分阶段买的影响对比。', hue: 'var(--tone-orange)' },
  { to: '/goals', icon: Target, title: '目标', desc: '为旅行、应急金等目标预留资金，进度与截止日一目了然。', hue: 'var(--tone-green)' },
  { to: '/data', icon: Database, title: '数据中心', desc: '备份、恢复、导出 CSV，回看历史快照与校准结果。', hue: 'var(--tone-slate)' },
  { to: '/settings', icon: SlidersHorizontal, title: '设置', desc: '维护账户、安全储备线与预算，参数即时影响预测。', hue: 'var(--tone-stone)' },
];

export function DashboardPage() {
  const dataset = useAppStore((s) => s.dataset)!;
  const mode = useAppStore((s) => s.mode);
  const exitDemo = useAppStore((s) => s.exitDemo);
  const navigate = useNavigate();
  const today = todayISO();
  const { unit, anchor, period, setPeriod } = usePeriodParams('month');

  const summary = useMemo(() => {
    const balance = totalBalanceAt(dataset.accounts, dataset.transactions, today);
    const reserved = totalReservedAt(dataset.goalEvents, today);
    const free = freeDisposable(balance, reserved, dataset.settings.safetyReserve);
    const views = buildOccurrenceViews(
      dataset.flows,
      dataset.occurrenceRecords,
      addDaysISO(today, -90),
      addDaysISO(today, 30),
      today,
    );
    const tasks = views.filter((v) => v.status === 'pending' && v.dueDate <= today);
    const overdue = tasks.filter((t) => t.overdue);
    const upcoming = views.filter((v) => v.status === 'pending' && v.dueDate > today).slice(0, 5);
    const goals = goalViews(dataset.goals, dataset.goalEvents, today).filter((g) => g.goal.status === 'active');
    const stats = periodTotals(dataset.transactions, period);
    const prevStats = periodTotals(dataset.transactions, previousPeriod(period));
    const delta = compareTotals(stats, prevStats);
    return { balance, reserved, free, tasks, overdue, upcoming, goals, stats, prevStats, delta };
  }, [dataset, today, period.key]);

  const periodData = useMemo(() => {
    const start = period.start;
    const stats = periodTotals(dataset.transactions, period);
    let count = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    for (const t of dataset.transactions) {
      if (t.kind === 'transfer' || t.date < start || t.date > today) continue;
      count += 1;
      if (t.kind === 'income') incomeCount += 1;
      else expenseCount += 1;
    }
    const days = diffDays(start, today) + 1;
    return {
      start,
      ...stats,
      count,
      incomeCount,
      expenseCount,
      days,
      avgExpense: Math.round(stats.expense / days),
      trend: buildTrend(dataset.transactions, unit, period, today),
    };
  }, [dataset.transactions, unit, period.key, today]);

  const meta = UNIT_META[unit];

  const option = useMemo<EChartsOption>(() => {
    const labels = periodData.trend.map((bucket) => bucket.label);
    return {
      grid: { left: 46, right: 12, top: 34, bottom: 26 },
      legend: {
        top: 2,
        right: 4,
        itemWidth: 10,
        itemHeight: 8,
        icon: 'roundRect',
        textStyle: { color: '#6B6A63', fontSize: 11 },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: '#FFFDF9',
        borderColor: '#E4E0D8',
        textStyle: { color: '#1F2421', fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = params as { seriesName?: string; axisValue?: string; value?: number }[];
          if (!arr.length) return '';
          const head = unit === 'year' ? `${arr[0].axisValue} 年` : arr[0].axisValue ?? '';
          const rows = arr.map((p) => {
            const cents = typeof p.value === 'number' ? p.value : 0;
            return `${p.seriesName} ¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
          });
          return `${head}<br/>${rows.join('<br/>')}`;
        },
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: '#E4E0D8' } },
        axisTick: { show: false },
        axisLabel: { color: '#8A887F', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#8A887F', fontSize: 10, formatter: (v: number) => formatMoneyShort(v) },
        splitLine: { lineStyle: { color: '#F0EDE6' } },
      },
      series: [
        {
          name: '收入',
          type: 'bar',
          data: periodData.trend.map((bucket) => bucket.income),
          barMaxWidth: unit === 'day' || unit === 'week' ? 16 : 28,
          itemStyle: { color: cssColor('--accent', '#0e7568'), borderRadius: [4, 4, 0, 0] },
        },
        {
          name: '支出',
          type: 'bar',
          data: periodData.trend.map((bucket) => bucket.expense),
          barMaxWidth: unit === 'day' || unit === 'week' ? 16 : 28,
          itemStyle: { color: cssColor('--accent-2', '#b7791f'), borderRadius: [4, 4, 0, 0] },
        },
      ],
    };
  }, [unit, periodData.trend]);

  const noAccounts = dataset.accounts.length === 0;
  const heroRef = useRef<HTMLElement>(null);
  const marqueeItems = [
    `总余额 ${formatMoneyShort(summary.balance)}`,
    `可用可支配 ${formatMoneyShort(summary.free)}`,
    `${meta.label}收入 ${formatMoneyShort(periodData.income)}`,
    `${meta.label}支出 ${formatMoneyShort(periodData.expense)}`,
    `${meta.label}结余 ${formatMoneyShort(periodData.net)}`,
    `目标预留 ${formatMoneyShort(summary.reserved)}`,
    '账本流水只保存在本机浏览器',
    '整数分记账 · 日 / 周 / 月 / 年监测',
  ];

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
      <section ref={heroRef} className="card hero-card relative overflow-hidden" data-reveal="none" aria-labelledby="intro-heading">
        <span className="hero-orbit hero-orbit-a" data-parallax="0.1" aria-hidden="true" />
        <span className="hero-orbit hero-orbit-b" data-parallax="0.2" aria-hidden="true" />
        <span className="hero-coin-mark" data-parallax="0.28" aria-hidden="true">¥</span>
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.25fr_0.75fr]">
          <div>
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10.5px] font-semibold text-[var(--accent-ink)]" data-hero-item>
              <Sparkles size={12} /> 关于金钱流水
            </span>
            <h1
              id="intro-heading"
              className="mt-3 text-[25px] font-semibold leading-[1.25] tracking-[-0.02em] sm:text-[30px]"
              aria-label="花钱之前，先看清今天、这个月和这一年的现金流。"
              data-hero-item
            >
              <ScrambleText text="花钱之前，先看清今天、这个月和这一年的现金流。" duration={1.05} />
            </h1>
            <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[#5F5E57]" data-hero-item>
              金钱流水把真实流水、固定计划与目标预留放进同一本本地账本。总览按日、周、月、年汇总收入与支出，
              你可以随时切换粒度，回看钱从哪来、又去了哪，而不是月底才对着账单发呆。
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
              <span className="chip chip-teal">日 / 周 / 月 / 年</span>
              <span className="chip">整数分记账</span>
              <span className="chip">本地优先</span>
            </div>
          </div>
          <div className="rounded-2xl border border-[#E9E4DA] bg-[#FAF8F3] p-4" data-hero-item>
            <p className="text-[12px] font-semibold text-[#3A3D37]">推荐使用顺序</p>
            <ol className="mt-2.5 space-y-2 text-[11.5px] leading-relaxed text-[#6B6A63]">
              <li><span className="num mr-1.5 font-semibold text-[var(--accent-ink)]">1</span>建立账户，填写期初余额与安全储备线</li>
              <li><span className="num mr-1.5 font-semibold text-[var(--accent-ink)]">2</span>记录流水，把房租等固定收支建成计划</li>
              <li><span className="num mr-1.5 font-semibold text-[var(--accent-ink)]">3</span>按日、周、月、年回看收支，再用预测与沙盘评估大额消费</li>
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

      <div className="mt-4" data-reveal="">
        <Marquee items={marqueeItems} speed={34} label="账本关键数字滚动摘要" />
      </div>

      {mode === 'demo' && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#F0DFC0] bg-[#FBF3E3] px-4 py-3">
          <p className="flex items-center gap-2 text-[12.5px] font-medium text-[#8A5A16]">
            <FlaskConical size={15} className="shrink-0" />
            当前为 6 个月合成示例数据，所有操作不会写入你的个人账本。
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void exitDemo()}>
            退出示例
          </button>
        </div>
      )}

      <div className="mb-3 mt-6 flex flex-wrap items-end justify-between gap-3" data-reveal="">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.01em]">现金流监测 · 日 / 周 / 月 / 年</h2>
          <p className="mt-1 text-[12px] text-[#8A887F]">{formatCN(today)} · {periodLabel(period)} · 切换粒度查看真实收支</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker unit={unit} anchor={anchor} today={today} onChange={setPeriod} compact testIdPrefix="dashboard-period" />
          <Link to="/ledger" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent-ink)] hover:underline">
            流水明细 <ChevronRight size={14} />
          </Link>
        </div>
      </div>

      {noAccounts ? (
        <Card>
          <EmptyState
            title="还没有账户"
            description="先创建一个账户并填写期初余额，才能开始记录与统计收支。"
            action={<Button variant="primary" onClick={() => navigate('/settings')}>去添加账户</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <StatCard label="总余额" value={<CountUpMoney cents={summary.balance} delay={0.05} />} hint={`${dataset.accounts.length} 个账户合计`} tone="accent" />
            <StatCard
              label="可用可支配"
              value={<CountUpMoney cents={summary.free} delay={0.14} />}
              hint={`已扣目标预留 ${formatMoneyShort(summary.reserved)} 与安全储备`}
              tone={summary.free < 0 ? 'danger' : 'positive'}
            />
            <StatCard
              label={`${meta.label}收入`}
              value={<CountUpMoney cents={periodData.income} delay={0.23} />}
              hint={`${periodData.incomeCount} 笔收入 · ${periodData.days} 天`}
              tone="accent2"
            />
            <StatCard
              label={`${meta.label}支出`}
              value={<CountUpMoney cents={periodData.expense} delay={0.32} />}
              hint={`${periodData.expenseCount} 笔支出 · 日均 ${formatMoneyShort(periodData.avgExpense)}`}
              tone="warning"
            />
            <StatCard
              label={`${meta.label}结余`}
              value={<CountUpMoney cents={periodData.net} delay={0.41} />}
              hint={
                <span className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-0.5 text-[var(--tone-green)]"><TrendingUp size={12} />{formatMoneyShort(periodData.income)}</span>
                  <span className="inline-flex items-center gap-0.5 text-[#98362E]"><TrendingDown size={12} />{formatMoneyShort(periodData.expense)}</span>
                  <span className="inline-flex items-center gap-0.5 text-[#8A887F]">
                    {summary.prevStats.count === 0
                      ? '上期无数据'
                      : <>较上期 {summary.delta.netDelta >= 0 ? '↑' : '↓'} {summary.delta.netDelta >= 0 ? '+' : '−'}{formatMoneyShort(Math.abs(summary.delta.netDelta))}</>}
                  </span>
                </span>
              }
              tone={periodData.net >= 0 ? 'positive' : 'danger'}
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[#8A887F]" data-reveal="">
            统计口径：{meta.caption}实际发生的收入与支出（{periodData.days} 天，{periodData.count} 笔），转账不计入收支；目标预留只影响可支配金额。
          </p>

          <ScrollStory
            className="scroll-story-home mt-5"
            kicker="滚动叙事 · 账本的四个动作"
            title="从一笔流水，到一本看得懂的账"
            steps={[
              { label: '记一笔', text: '先把今天真实发生的收支入账，保留每一枚小钱的去向。' },
              { label: '排计划', text: '房租、订阅等固定收支提前排进账本，到期一键核销。' },
              { label: '看结构', text: '按日、周、月、年回看现金流，看清收入与支出如何变化。' },
              { label: '做预留', text: '先给目标留出资金，再决定这笔大额消费要不要花。' },
            ]}
          />

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.55fr_1fr]">
            <Card
              title={meta.trendTitle}
              subtitle={meta.trendNote}
              action={<span className="chip chip-teal">{meta.caption}</span>}
            >
              <EChart option={option} height={262} ariaLabel={`${meta.trendTitle}柱状图`} />
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
                    {summary.overdue.length > 0 && (
                      <li className="border-t border-[#EFECE6] pt-2 text-center">
                        <Link to="/schedules" className="text-[11.5px] font-medium text-[#98362E] hover:underline">另有 {summary.overdue.length} 笔逾期，点此批量处理</Link>
                      </li>
                    )}
                  </ul>
                )}
              </Card>

              <Card className="rise" style={{ '--i': 1 } as CSSProperties} title="接下来" subtitle="近期固定收支计划" action={<Button size="xs" variant="ghost" onClick={() => navigate('/schedules')}>全部 <ArrowRight size={13} /></Button>}>
                {summary.upcoming.length === 0 ? (
                  <p className="text-[12px] text-[#8A887F]">近期没有固定计划。</p>
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