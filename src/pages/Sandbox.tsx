import { useMemo, useState, type CSSProperties } from 'react';
import type { EChartsOption } from 'echarts';
import { FlaskConical, Play, Save, Trash2, TriangleAlert } from 'lucide-react';
import type { PurchasePlan } from '../domain/types';
import { useAppStore } from '../store/useAppStore';
import { addDaysISO, formatCN, todayISO } from '../domain/days';
import { parseMoneyInput } from '../domain/money';
import { reservedByGoal } from '../domain/ledger';
import { runSandbox, riskLevelFor, type SandboxResult, type ScenarioOutcome } from '../domain/sandbox';
import { savePlan, deletePlan, type PlanInput } from '../services/mutations';
import { EChart } from '../components/Chart';
import { Badge, Button, Card, EmptyState, Field, InfoNote, Money, PageHeader, Switch, cn } from '../components/ui';
import { amountInputValue, riskText } from '../lib/ui';

const SCENARIO_COLOR: Record<string, string> = {
  baseline: '#8A887F',
  immediate: '#B5453C',
  delayed: '#B7791F',
  staged: '#0E7568',
};

function ScenarioCard({ outcome, price, baseline, className, style }: { outcome: ScenarioOutcome; price: number; baseline: ScenarioOutcome; className?: string; style?: CSSProperties }) {
  const level = riskLevelFor(outcome.risk, baseline.forecast.summary.safetyReserve);
  return (
    <div className={cn('rounded-xl border p-3', outcome.type === 'staged' ? 'border-[#BFE0D7] bg-[#F7FCFA]' : 'border-[#EFECE6] bg-white', className)} style={style} data-testid={`scenario-${outcome.type}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold">{outcome.title}</p>
        <Badge tone={level === 'danger' ? 'danger' : level === 'warning' ? 'amber' : 'teal'}>{riskText(level)}</Badge>
      </div>
      <p className="num mt-2 text-[20px] font-semibold">
        <Money cents={outcome.risk.minBalance} />
        <span className="ml-1 text-[10.5px] font-normal text-[#8A887F]">预测期最低</span>
      </p>
      <div className="mt-2 space-y-1 text-[10.5px] leading-relaxed text-[#6B6A63]">
        <p>购买日：{outcome.purchaseDates[0] ? formatCN(outcome.purchaseDates[0]) : '未完成'} {outcome.type === 'immediate' ? '（立即）' : ''}</p>
        <p>购买时已预留：<Money cents={outcome.reservedAtPurchase} /></p>
        {outcome.reason && <p className="text-[#8A5A13]">{outcome.reason}</p>}
        <p>最低点日期：{formatCN(outcome.risk.minBalanceDate)}</p>
      </div>
      <div className="mt-2 border-t border-[#EFECE6] pt-2 text-[10.5px] leading-relaxed text-[#8A887F]">
        {outcome.summary.map((line) => <p key={line}>{line}</p>)}
      </div>
    </div>
  );
}

export function SandboxPage() {
  const dataset = useAppStore((s) => s.dataset)!;
  const apply = useAppStore((s) => s.apply);
  const notify = useAppStore((s) => s.notify);
  const today = todayISO();
  const [name, setName] = useState('新相机');
  const [price, setPrice] = useState('7990');
  const [purchaseDate, setPurchaseDate] = useState(addDaysISO(today, 20));
  const [allowDelay, setAllowDelay] = useState(true);
  const [goalId, setGoalId] = useState('');
  const [reserveUnit, setReserveUnit] = useState<'week' | 'month'>('month');
  const [reserveInterval, setReserveInterval] = useState('1');
  const [result, setResult] = useState<SandboxResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState('');
  const [formStamp, setFormStamp] = useState(0);

  const goalReserved = goalId ? (reservedByGoal(dataset.goalEvents, today).get(goalId) ?? 0) : 0;
  const activeGoals = dataset.goals.filter((g) => g.status === 'active');

  const run = () => {
    const parsed = parseMoneyInput(price);
    if (!parsed.ok) return setError(parsed.error);
    if (!purchaseDate) return setError('请选择购买日期');
    const interval = Number(reserveInterval);
    if (!Number.isInteger(interval) || interval < 1) return setError('预留间隔无效');
    setError(null);
    const res = runSandbox({
      asOfDate: today,
      dataset,
      coverage: dataset.settings.coverage,
      settings: dataset.settings,
      purchase: {
        name,
        price: parsed.cents,
        purchaseDate,
        allowDelay,
        goalId: goalId || undefined,
        reserveUnit,
        reserveInterval: interval,
      },
      goalReserved,
      horizonDays: 90,
    });
    setResult(res);
    setLastRun(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
  };

  const save = async () => {
    const parsed = parseMoneyInput(price);
    if (!parsed.ok) return setError(parsed.error);
    const input: PlanInput = {
      name,
      price: parsed.cents,
      purchaseDate,
      allowDelay,
      goalId: goalId || undefined,
      reserveUnit,
      reserveInterval: Number(reserveInterval) || 1,
    };
    await apply((d) => savePlan(d, input), '方案已保存，可随时重新模拟');
  };

  const usePlan = (plan: PurchasePlan) => {
    setName(plan.name);
    setPrice(amountInputValue(plan.price));
    setPurchaseDate(plan.purchaseDate);
    setAllowDelay(plan.allowDelay);
    setGoalId(plan.goalId ?? '');
    setReserveUnit(plan.reserveUnit);
    setReserveInterval(String(plan.reserveInterval));
    setResult(null);
    setError(null);
    setFormStamp((s) => s + 1);
  };

  const chartOption = useMemo<EChartsOption>(() => {
    if (!result) return {};
    const scenarios = [result.baseline, result.immediate, result.delayed, result.staged];
    const dates = result.baseline.forecast.days.filter((d) => !d.isToday).map((d) => d.date);
    const byDate = (s: ScenarioOutcome) => {
      const map = new Map(s.forecast.days.filter((d) => !d.isToday).map((d) => [d.date, d.balance]));
      return dates.map((d) => map.get(d) ?? null);
    };
    return {
      legend: { top: 0, textStyle: { fontSize: 10, color: '#6B6A63' }, itemWidth: 14, itemHeight: 3 },
      grid: { left: 50, right: 16, top: 30, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#FFFDF9',
        borderColor: '#E4E0D8',
        textStyle: { color: '#1F2421', fontSize: 12 },
        valueFormatter: (v: unknown) => (typeof v === 'number' ? `¥${(v / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` : '—'),
      },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#E4E0D8' } },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 10,
          color: '#8A887F',
          interval: Math.max(1, Math.floor(dates.length / 7) - 1),
          formatter: (v: string) => `${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}`,
        },
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, color: '#8A887F', formatter: (v: number) => `¥${Math.round(v / 100 / 1000)}k` },
        splitLine: { lineStyle: { color: '#F0EDE6' } },
      },
      series: scenarios.map((s) => ({
        name: s.title.replace('（不购买）', ''),
        type: 'line' as const,
        data: byDate(s),
        smooth: 0.2,
        showSymbol: false,
        lineStyle: { width: s.type === 'staged' ? 2.4 : 1.8, color: SCENARIO_COLOR[s.type], type: s.type === 'staged' ? 'solid' : s.type === 'delayed' ? 'dashed' : 'solid' },
        itemStyle: { color: SCENARIO_COLOR[s.type] },
        ...(s.type === 'baseline'
          ? {
              markLine: {
                silent: true,
                symbol: 'none',
                label: { fontSize: 9, color: '#B7791F', formatter: `安全线` },
                lineStyle: { color: '#D8A64F', type: 'dashed' as const, width: 1 },
                data: [{ yAxis: dataset.settings.safetyReserve }],
              },
            }
          : {}),
      })),
    };
  }, [result, dataset.settings.safetyReserve]);

  return (
    <div className="fade-in" data-testid="sandbox">
      <PageHeader
        title="消费决策沙盘"
        description="想买大件？先在这里试算：对比立即购买、延期购买、分阶段预留后购买对现金流的影响，再决定怎么买。模拟不会写入真实账本。"
        actions={<Badge tone="teal"><FlaskConical size={11} /> 只读模拟</Badge>}
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_1.65fr]">
        <Card key={formStamp} className="rise balance-pulse" title="购买方案" subtitle="价格、日期与预留节奏">
          <div className="space-y-3.5">
            <Field label="名称"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="例如：新电脑" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="价格（元）"><input className="input num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="5000.00" /></Field>
              <Field label="计划购买日"><input className="input" type="date" min={today} value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="预留节奏">
                <select className="select" value={reserveUnit} onChange={(e) => setReserveUnit(e.target.value as 'week' | 'month')}>
                  <option value="month">每月</option>
                  <option value="week">每周</option>
                </select>
              </Field>
              <Field label="每隔几次"><input className="input num" inputMode="numeric" value={reserveInterval} onChange={(e) => setReserveInterval(e.target.value)} placeholder="1" /></Field>
            </div>
            <Field label="关联目标（可选）" hint={goalId ? `该目标已预留 ¥${(goalReserved / 100).toFixed(2)}，会作为起始预留计入分阶段方案。` : '关联后，已有预留可直接用于本次购买。'}>
              <select className="select" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                <option value="">不关联</option>
                {activeGoals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-[12px] text-[#6B6A63]">
              <Switch checked={allowDelay} onChange={setAllowDelay} aria-label="允许延期购买" />
              允许延期购买（搜索 90 天内最早安全日）
            </label>
            {error && <p className="rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]">{error}</p>}
            <div className="flex gap-2">
              <Button variant="primary" className="flex-1" onClick={run} data-testid="run-sandbox"><Play size={14} /> 运行模拟</Button>
              <Button variant="secondary" onClick={() => void save()}><Save size={14} /> 保存</Button>
            </div>
            <InfoNote>
              分阶段预留会把钱在自由余额中 earmark，余额不变但可支配金额下降；购买时消耗预留，不会二次扣减可支配金额。
            </InfoNote>
          </div>
        </Card>

        <div className="space-y-4">
          {!result ? (
            <Card>
              <EmptyState
                title="还没有模拟结果"
                description="填写左侧方案并点击「运行模拟」。立即、延期与分阶段预留三种路径会并列比较。"
                action={<Button variant="primary" onClick={run}><Play size={14} /> 运行模拟</Button>}
              />
            </Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <ScenarioCard className="rise" style={{ '--i': 0 } as CSSProperties} outcome={result.baseline} price={result.baseline.risk.minBalance} baseline={result.baseline} />
                <ScenarioCard className="rise" style={{ '--i': 1 } as CSSProperties} outcome={result.immediate} price={result.immediate.risk.minBalance} baseline={result.baseline} />
                <ScenarioCard className="rise" style={{ '--i': 2 } as CSSProperties} outcome={result.delayed} price={result.delayed.risk.minBalance} baseline={result.baseline} />
                <ScenarioCard className="rise" style={{ '--i': 3 } as CSSProperties} outcome={result.staged} price={result.staged.risk.minBalance} baseline={result.baseline} />
              </div>

              <Card
                title="四条路径对比"
                subtitle={`模拟时间 ${lastRun || '刚刚'} · 历史安全购买日搜索窗口 ${result.safeWindowDays} 天`}
                action={
                  result.earliestSafeDate
                    ? <Badge tone="teal">最早安全日 {formatCN(result.earliestSafeDate)}</Badge>
                    : <Badge tone="danger"><TriangleAlert size={11} /> 90 天内无安全购买日</Badge>
                }
              >
                <EChart option={chartOption} height={310} ariaLabel="四种购买方案的余额路径对比" />
                <p className="mt-1 text-[10.5px] text-[#8A887F]">图表固定使用最近一次运行参数；修改左侧后请重新运行以更新。</p>
              </Card>

              <Card className="rise" title="结论与限制" subtitle="沙盘不是推荐购买，只是把不同选择的现金流后果摊开">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-[#FAF8F3] px-3 py-2.5">
                    <p className="text-[10.5px] font-semibold text-[#8A887F]">立即购买</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-[#3A3D37]">
                      {result.immediate.risk.firstBelowSafety ? `会在 ${formatCN(result.immediate.risk.firstBelowSafety)} 触及安全线以下。` : '不会低于安全储备。'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#FAF8F3] px-3 py-2.5">
                    <p className="text-[10.5px] font-semibold text-[#8A887F]">最早安全日</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-[#3A3D37]">
                      {result.earliestSafeDate ? `${formatCN(result.earliestSafeDate)}，按该日购买后 90 天内最低余额仍高于安全线。` : '当前收入与支出结构下，90 天内没有满足安全条件的时点。'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#FAF8F3] px-3 py-2.5">
                    <p className="text-[10.5px] font-semibold text-[#8A887F]">分阶段预留</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-[#3A3D37]">
                      {result.staged.completed ? `可在 ${result.staged.purchaseDates[0] ? formatCN(result.staged.purchaseDates[0]) : '计划日'} 筹足并购买。` : result.staged.reason ?? '未能在窗口内筹足。'}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-start gap-2 text-[10.5px] leading-relaxed text-[#8A887F]">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                  未计入信用卡账单日、分期与突发医疗等未建模事件；如果这些对你重要，请先补充计划或提高安全储备。
                </div>
              </Card>
            </>
          )}

          <Card title="已保存方案" subtitle="保存后不会自动扣款或改变账本">
            {dataset.plans.length === 0 ? (
              <p className="text-[12px] text-[#8A887F]">还没有保存的计划。</p>
            ) : (
              <ul className="space-y-2">
                {dataset.plans.map((plan, i) => (
                  <li key={plan.id} className="rise flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#EFECE6] px-3 py-2.5" style={{ '--d': `${Math.min(i, 7) * 24}ms` } as CSSProperties}>
                    <div>
                      <p className="text-[12.5px] font-medium">{plan.name}</p>
                      <p className="text-[10.5px] text-[#8A887F]">
                        <Money cents={plan.price} /> · {formatCN(plan.purchaseDate)} · {plan.goalId ? '关联目标' : '不关联目标'} · {plan.reserveUnit === 'week' ? '按周' : '按月'}预留
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="xs" variant="secondary" onClick={() => usePlan(plan)}>套用</Button>
                      <Button size="xs" variant="ghost" onClick={() => void apply((d) => deletePlan(d, plan.id), '方案已删除')}><Trash2 size={12} /></Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}