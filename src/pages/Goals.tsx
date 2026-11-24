import { useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { Archive, ArchiveRestore, CalendarClock, Pencil, PiggyBank, Plus, ShoppingBag, Target, Undo2 } from 'lucide-react';
import type { FinancialGoal } from '../domain/types';
import { useAppStore } from '../store/useAppStore';
import { addDaysISO, diffDays, formatCN, todayISO } from '../domain/days';
import { formatMoney, parseMoneyInput } from '../domain/money';
import { reservedByGoal } from '../domain/ledger';
import { planAllocation, STRATEGY_LABELS, type AllocationStrategy, type AllocGoalInput } from '../domain/allocation/allocate';
import { projectGoals } from '../domain/allocation/plan';
import {
  addGoal,
  consumeGoal,
  maxReservable,
  releaseFromGoal,
  reserveForGoal,
  setGoalArchived,
  updateGoal,
  type GoalInput,
} from '../services/mutations';
import { EChart } from '../components/Chart';
import { Badge, Button, Card, EmptyState, Field, InfoNote, Modal, Money, PageHeader, Progress, Segmented, cn } from '../components/ui';

type ActionMode = 'reserve' | 'release' | 'consume' | null;

const LINE_COLORS = ['#0E7568', '#B7791F', '#3F6E9A', '#8C6A9E', '#7A8B4A', '#B5453C'];

function daysLeft(deadline: string, today: string): number {
  return diffDays(today, deadline);
}

export function GoalsPage() {
  const dataset = useAppStore((s) => s.dataset)!;
  const apply = useAppStore((s) => s.apply);
  const today = todayISO();
  const reservedMap = useMemo(() => reservedByGoal(dataset.goalEvents, today), [dataset.goalEvents, today]);
  const maxReserve = maxReservable(dataset, today);
  const [strategy, setStrategy] = useState<AllocationStrategy>('balanced');
  const [goalModal, setGoalModal] = useState<{ open: boolean; editing: FinancialGoal | null }>({ open: false, editing: null });
  const [form, setForm] = useState<GoalInput>({ name: '', targetAmount: 0, deadline: addDaysISO(today, 180), priority: 3 });
  const [targetText, setTargetText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [action, setAction] = useState<{ goal: FinancialGoal; mode: ActionMode } | null>(null);
  const [amountText, setAmountText] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [consumeAccount, setConsumeAccount] = useState('');
  const [consumeCategory, setConsumeCategory] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const activeGoals = dataset.goals.filter((g) => g.status === 'active');
  const totalTarget = activeGoals.reduce((s, g) => s + g.targetAmount, 0);
  const totalReserved = activeGoals.reduce((s, g) => s + (reservedMap.get(g.id) ?? 0), 0);

  const goalInputs: AllocGoalInput[] = useMemo(
    () => dataset.goals.map((g) => ({
      goalId: g.id,
      name: g.name,
      target: g.targetAmount,
      reserved: reservedMap.get(g.id) ?? 0,
      deadline: g.deadline,
      priority: g.priority,
      overdue: g.deadline < today,
      archived: g.status === 'archived',
    })),
    [dataset.goals, reservedMap, today],
  );

  const monthlyBudget = dataset.settings.budget.monthlySavingsCap > 0
    ? Math.min(dataset.settings.budget.monthlySavingsCap, maxReserve)
    : maxReserve;
  const allocation = useMemo(
    () => planAllocation({ goals: goalInputs, asOfDate: today, budget: monthlyBudget, allocDay: dataset.settings.goalAllocDay, strategy }),
    [goalInputs, today, monthlyBudget, dataset.settings.goalAllocDay, strategy],
  );

  const projection = useMemo(
    () => projectGoals({
      goals: goalInputs,
      asOfDate: today,
      dataset,
      coverage: dataset.settings.coverage,
      settings: dataset.settings,
      strategy,
      months: 24,
    }),
    [goalInputs, today, dataset, strategy],
  );

  const chartOption = useMemo<EChartsOption>(() => {
    const active = dataset.goals.filter((g) => g.status === 'active');
    const dates = new Set<string>([today]);
    for (const o of projection.outcomes) for (const p of o.series) dates.add(p.date);
    const sorted = [...dates].sort();
    const series = active.map((g, i) => {
      const outcome = projection.outcomes.find((o) => o.goalId === g.id);
      const rows = outcome?.series ?? [];
      let cursor = reservedMap.get(g.id) ?? 0;
      let idx = 0;
      const data = sorted.map((date) => {
        while (idx < rows.length && rows[idx].date <= date) {
          cursor = rows[idx].reserved;
          idx += 1;
        }
        return [date, cursor] as [string, number];
      });
      return {
        name: g.name,
        type: 'line' as const,
        step: 'end' as const,
        showSymbol: false,
        data,
        lineStyle: { width: 2, color: LINE_COLORS[i % LINE_COLORS.length] },
        itemStyle: { color: LINE_COLORS[i % LINE_COLORS.length] },
      };
    });
    return {
      animationDuration: 400,
      legend: { top: 0, textStyle: { fontSize: 10, color: '#6B6A63' }, itemWidth: 14, itemHeight: 3 },
      grid: { left: 52, right: 16, top: 32, bottom: 30 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#FFFDF9',
        borderColor: '#E4E0D8',
        textStyle: { color: '#1F2421', fontSize: 12 },
        valueFormatter: (v: unknown) => (typeof v === 'number' ? `¥${(v / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` : '—'),
      },
      xAxis: {
        type: 'category',
        data: sorted,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#E4E0D8' } },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 10,
          color: '#8A887F',
          interval: Math.max(1, Math.floor(sorted.length / 8) - 1),
          formatter: (v: string) => `${v.slice(0, 4)}/${Number(v.slice(5, 7))}`,
        },
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, color: '#8A887F', formatter: (v: number) => `¥${Math.round(v / 100 / 1000)}k` },
        splitLine: { lineStyle: { color: '#F0EDE6' } },
      },
      series,
    };
  }, [dataset.goals, projection.outcomes, reservedMap, today]);

  const openCreate = () => {
    setForm({ name: '', targetAmount: 0, deadline: addDaysISO(today, 180), priority: 3 });
    setTargetText('');
    setFormError(null);
    setGoalModal({ open: true, editing: null });
  };

  const openEdit = (goal: FinancialGoal) => {
    setForm({ name: goal.name, targetAmount: goal.targetAmount, deadline: goal.deadline, priority: goal.priority });
    setTargetText((goal.targetAmount / 100).toFixed(2));
    setFormError(null);
    setGoalModal({ open: true, editing: goal });
  };

  const submitGoal = async () => {
    const parsed = parseMoneyInput(targetText);
    if (!parsed.ok) return setFormError(parsed.error);
    const input: GoalInput = { ...form, targetAmount: parsed.cents, name: form.name.trim() };
    if (!input.name) return setFormError('请填写目标名称');
    const ok = await apply(
      (d) => (goalModal.editing ? updateGoal(d, goalModal.editing.id, input) : addGoal(d, input, today)),
      goalModal.editing ? '目标已更新' : '目标已创建',
    );
    if (ok) setGoalModal({ open: false, editing: null });
  };

  const openAction = (goal: FinancialGoal, mode: ActionMode) => {
    const reserved = reservedMap.get(goal.id) ?? 0;
    let preset = 0;
    if (mode === 'reserve') preset = Math.min(goal.targetAmount - reserved, maxReserve);
    if (mode === 'release') preset = reserved;
    if (mode === 'consume') preset = reserved;
    setAmountText(preset > 0 ? (preset / 100).toFixed(2) : '');
    setActionNote('');
    setConsumeAccount(dataset.accounts[0]?.id ?? '');
    setConsumeCategory(dataset.categories.find((c) => c.kind === 'expense' && !c.archived)?.id ?? '');
    setActionError(null);
    setAction({ goal, mode });
  };

  const submitAction = async () => {
    if (!action || !action.mode) return;
    const parsed = parseMoneyInput(amountText);
    if (!parsed.ok) return setActionError(parsed.error);
    const { goal, mode } = action;
    const ok = await apply((d) => {
      if (mode === 'reserve') return reserveForGoal(d, goal.id, parsed.cents, actionNote || undefined, today);
      if (mode === 'release') return releaseFromGoal(d, goal.id, parsed.cents, actionNote || undefined, today);
      return consumeGoal(d, goal.id, parsed.cents, { accountId: consumeAccount, categoryId: consumeCategory || undefined, note: actionNote || undefined }, today);
    }, mode === 'reserve' ? '预留成功' : mode === 'release' ? '已释放预留' : '已从预留中支出并记账');
    if (ok) setAction(null);
  };

  const goalEvents = [...dataset.goalEvents].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 12);
  const goalById = new Map(dataset.goals.map((g) => [g.id, g]));

  return (
    <div className="fade-in" data-testid="goals">
      <PageHeader
        title="储蓄目标"
        description="为旅行、大件购物等设定存钱目标：系统按你的现金流推算每月该存多少、何时能达成。预留不是扣款：它只降低可支配金额，钱仍在你的账户里；从预留中消费才真正记账。"
        actions={<Button variant="primary" onClick={openCreate} data-testid="add-goal"><Plus size={14} /> 新建目标</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card px-4 py-3">
          <p className="text-[10.5px] font-semibold tracking-wide text-[#8A887F]">进行中目标</p>
          <p className="num mt-1 text-[20px] font-semibold">{activeGoals.length}</p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[10.5px] font-semibold tracking-wide text-[#8A887F]">目标总额</p>
          <p className="num mt-1 text-[20px] font-semibold"><Money cents={totalTarget} /></p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[10.5px] font-semibold tracking-wide text-[#8A887F]">已预留</p>
          <p className="num mt-1 text-[20px] font-semibold text-[#0B6357]"><Money cents={totalReserved} /></p>
        </div>
        <div className="card px-4 py-3">
          <p className="text-[10.5px] font-semibold tracking-wide text-[#8A887F]">当前最多可再预留</p>
          <p className="num mt-1 text-[20px] font-semibold"><Money cents={maxReserve} /></p>
          <p className="text-[10px] text-[#8A887F]">余额 − 总预留 − 安全储备</p>
        </div>
      </div>

      {dataset.goals.length === 0 ? (
        <Card>
          <EmptyState
            title="还没有目标"
            description="比如旅行、新电脑、应急金。目标会参与每月储蓄分配和 24 个月完成时间推演。"
            action={<Button variant="primary" onClick={openCreate}><Plus size={14} /> 新建第一个目标</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-3">
            {dataset.goals.map((goal) => {
              const reserved = reservedMap.get(goal.id) ?? 0;
              const remaining = Math.max(0, goal.targetAmount - reserved);
              const left = daysLeft(goal.deadline, today);
              const pct = goal.targetAmount > 0 ? Math.round((reserved / goal.targetAmount) * 100) : 0;
              const archived = goal.status === 'archived';
              return (
                <Card key={goal.id} className={cn(archived && 'opacity-70')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#E8F3F0] text-[#0B6357]"><Target size={15} /></span>
                        <div>
                          <p className="truncate text-[13.5px] font-semibold">{goal.name}</p>
                          <p className="text-[10.5px] text-[#8A887F]">
                            截止 {formatCN(goal.deadline)} · {left >= 0 ? `剩 ${left} 天` : `已逾期 ${-left} 天`} · 重要性 {goal.priority}/5
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {archived ? <Badge>已归档</Badge> : left < 0 ? <Badge tone="danger">逾期</Badge> : remaining === 0 ? <Badge tone="teal">已筹足</Badge> : <Badge tone="amber">进行中</Badge>}
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 flex items-end justify-between text-[11px] text-[#6B6A63]">
                      <span>已预留 <Money cents={reserved} /> / <Money cents={goal.targetAmount} /></span>
                      <span className="num font-semibold text-[#0B6357]">{pct}%</span>
                    </div>
                    <Progress value={reserved} max={goal.targetAmount} tone={left < 0 && remaining > 0 ? 'danger' : pct >= 100 ? 'teal' : 'amber'} />
                    <p className="mt-1 text-[10.5px] text-[#8A887F]">还差 <Money cents={remaining} /></p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="xs" variant="primary" disabled={archived || remaining === 0} onClick={() => openAction(goal, 'reserve')}><PiggyBank size={12} /> 预留</Button>
                    <Button size="xs" variant="secondary" disabled={archived || reserved === 0} onClick={() => openAction(goal, 'release')}><Undo2 size={12} /> 释放</Button>
                    <Button size="xs" variant="secondary" disabled={archived || reserved === 0} onClick={() => openAction(goal, 'consume')}><ShoppingBag size={12} /> 支出</Button>
                    <span className="flex-1" />
                    <Button size="xs" variant="ghost" onClick={() => openEdit(goal)}><Pencil size={12} /></Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void apply((d) => setGoalArchived(d, goal.id, !archived), archived ? '目标已恢复' : '目标已归档')}
                    >
                      {archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="space-y-4">
            <Card
              title="本月分配预览"
              subtitle={`按每月 ${dataset.settings.goalAllocDay} 日的分配节奏，本期可分配 ${formatMoney(monthlyBudget)}`}
              action={<Segmented size="sm" value={strategy} onChange={setStrategy} options={(['balanced', 'deadline', 'priority'] as AllocationStrategy[]).map((v) => ({ value: v, label: STRATEGY_LABELS[v] }))} />}
            >
              <div className="overflow-x-auto">
                <table className="data">
                  <thead>
                    <tr>
                      <th>目标</th>
                      <th className="text-right">月度需求</th>
                      <th className="text-right">权重</th>
                      <th className="text-right">本期分配</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocation.goals.map((row) => (
                      <tr key={row.goalId}>
                        <td>
                          <p className="font-medium">{row.name}</p>
                          <p className="text-[10px] text-[#8A887F]">剩余 {formatMoney(row.remaining)} · {row.opportunities} 次机会</p>
                        </td>
                        <td className="num text-right"><Money cents={row.monthlyNeed} /></td>
                        <td className="num text-right text-[#8A887F]">{row.weight.toFixed(2)}</td>
                        <td className="num text-right font-semibold"><Money cents={row.allocated} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>合计</td>
                      <td className="num text-right"><Money cents={allocation.totalDemand} /></td>
                      <td />
                      <td className="num text-right"><Money cents={allocation.allocatedTotal} /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {allocation.notes.length > 0 && (
                <ul className="mt-2 space-y-1 text-[10.5px] leading-relaxed text-[#8A5A13]">
                  {allocation.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              )}
              <p className="mt-2 text-[10.5px] leading-relaxed text-[#8A887F]">
                {strategy === 'balanced' && '均衡型：所有目标按相同权重分配，先补齐月度需求。'}
                {strategy === 'deadline' && '期限优先：剩余机会越少，权重越高。'}
                {strategy === 'priority' && '重要性优先：高优先级 × 紧迫度获得更高权重。'}
                分配是建议值，不会自动执行；请用「预留」手动确认。
              </p>
            </Card>

            <Card title="24 个月完成推演" subtitle="沿同一条预测现金路径滚动预留，策略切换会改变推演结果">
              {activeGoals.length === 0 ? (
                <p className="text-[12px] text-[#8A887F]">没有进行中的目标。</p>
              ) : (
                <>
                  <EChart option={chartOption} height={260} ariaLabel="各目标预留金额的24个月累积推演" />
                  <div className="mt-2 overflow-x-auto">
                    <table className="data">
                      <thead>
                        <tr><th>目标</th><th>预计完成</th><th className="text-right">需月数</th><th className="text-right">期末预留</th></tr>
                      </thead>
                      <tbody>
                        {projection.outcomes.map((o) => {
                          const g = goalById.get(o.goalId);
                          return (
                            <tr key={o.goalId}>
                              <td>{g?.name ?? o.goalId}</td>
                              <td>{o.completionDate ? formatCN(o.completionDate) : '窗口内无法完成'}</td>
                              <td className="num text-right">{o.monthsNeeded === null ? '—' : `${o.monthsNeeded} 月`}</td>
                              <td className="num text-right"><Money cents={o.finalReserved} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {projection.notes.length > 0 && (
                    <ul className="mt-2 space-y-1 text-[10.5px] leading-relaxed text-[#8A5A13]">
                      {projection.notes.map((n) => <li key={n}>{n}</li>)}
                    </ul>
                  )}
                </>
              )}
              <InfoNote>
                推演假设：沿用当前计划收支与可变消费模型；只考虑每月一次分配机会；不包含未来加薪、失业或大额意外支出。
              </InfoNote>
            </Card>

            <Card title="目标资金流水" subtitle="预留 / 释放 / 消费事件">
              {goalEvents.length === 0 ? (
                <p className="text-[12px] text-[#8A887F]">暂无事件。</p>
              ) : (
                <ul className="divide-y divide-[#F1EEE8]">
                  {goalEvents.map((ev) => {
                    const g = goalById.get(ev.goalId ?? '');
                    const label = ev.type === 'reserve' ? '预留' : ev.type === 'release' ? '释放' : '消费';
                    const tone = ev.type === 'reserve' ? 'text-[#0B6357]' : ev.type === 'consume' ? 'text-[#98362E]' : 'text-[#8A5A13]';
                    return (
                      <li key={ev.id} className="flex items-center justify-between gap-2 py-1.5 text-[11.5px]">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <CalendarClock size={11} className="shrink-0 text-[#8A887F]" />
                          <span className="shrink-0 text-[#8A887F]">{formatCN(ev.date)}</span>
                          <span className="truncate text-[#6B6A63]">{g?.name ?? '（已删除目标）'}</span>
                          <span className={cn('shrink-0', tone)}>{label}</span>
                        </span>
                        <span className={cn('num shrink-0 font-medium', tone)}>
                          {ev.type === 'release' ? '−' : ev.type === 'consume' ? '−' : '+'}<Money cents={ev.amount} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      <Modal
        open={goalModal.open}
        title={goalModal.editing ? '编辑目标' : '新建储蓄目标'}
        subtitle="目标金额为整数分存储，这里输入元。"
        onClose={() => setGoalModal({ open: false, editing: null })}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setGoalModal({ open: false, editing: null })}>取消</Button>
            <Button variant="primary" onClick={() => void submitGoal()} data-testid="save-goal">{goalModal.editing ? '保存修改' : '创建目标'}</Button>
          </>
        )}
      >
        <div className="space-y-3.5">
          <Field label="名称"><input className="input" value={form.name} maxLength={20} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：日本旅行" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="目标金额（元）"><input className="input num" inputMode="decimal" value={targetText} onChange={(e) => setTargetText(e.target.value)} placeholder="6000.00" /></Field>
            <Field label="截止日期"><input className="input" type="date" min={today} value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field>
          </div>
          <Field label="重要性（1-5）" hint="重要性越高，在「重要性优先」策略中获得越多权重。">
            <input className="input num" type="number" min={1} max={5} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
          </Field>
          {formError && <p className="rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]">{formError}</p>}
        </div>
      </Modal>

      <Modal
        open={!!action}
        title={action ? `${action.mode === 'reserve' ? '为目标预留' : action.mode === 'release' ? '释放预留' : '从预留中支出'} · ${action.goal.name}` : ''}
        subtitle={action ? `当前已预留 ${formatMoney(reservedMap.get(action.goal.id) ?? 0)}，最多可再预留 ${formatMoney(maxReserve)}` : undefined}
        onClose={() => setAction(null)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setAction(null)}>取消</Button>
            <Button variant="primary" onClick={() => void submitAction()} data-testid="confirm-goal-action">确认</Button>
          </>
        )}
      >
        <div className="space-y-3.5">
          <Field label="金额（元）"><input className="input num" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0.00" /></Field>
          {action?.mode === 'consume' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="账户">
                <select className="select" value={consumeAccount} onChange={(e) => setConsumeAccount(e.target.value)}>
                  {dataset.accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="分类">
                <select className="select" value={consumeCategory} onChange={(e) => setConsumeCategory(e.target.value)}>
                  <option value="">不分类</option>
                  {dataset.categories.filter((c) => c.kind === 'expense' && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            </div>
          )}
          <Field label="备注（可选）"><input className="input" value={actionNote} onChange={(e) => setActionNote(e.target.value)} maxLength={40} placeholder="例如：工资到账后预留" /></Field>
          {action?.mode === 'consume' && (
            <InfoNote>支出会写入真实账本（收入支出 → 支出），同时等额消耗预留；可支配金额不会因此再下降。</InfoNote>
          )}
          {actionError && <p className="rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]">{actionError}</p>}
        </div>
      </Modal>
    </div>
  );
}