import { useMemo, useState } from 'react';
import {
  CalendarClock,
  Check,
  Clock,
  Pencil,
  Plus,
  RefreshCw,
  SkipForward,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { OccurrenceView, ScheduledFlow } from '../domain/types';
import { useAppStore } from '../store/useAppStore';
import { addDaysISO, formatCN, todayISO } from '../domain/days';
import { buildOccurrenceViews } from '../domain/occurrences';
import { formatMoneyShort } from '../domain/money';
import { parseMoneyInput } from '../domain/money';
import {
  addFlow,
  deleteFlow,
  rescheduleOccurrence,
  settleOccurrence,
  skipOccurrence,
  splitFlow,
  toggleFlow,
  updateFlow,
  type FlowInput,
} from '../services/mutations';
import { Badge, Button, Card, EmptyState, Field, Modal, Money, PageHeader, Segmented, cn } from '../components/ui';
import { amountInputValue, dueLabel, frequencyLabel } from '../lib/ui';

function FlowForm({
  open,
  dataset,
  flow,
  nextPendingDate,
  onClose,
}: {
  open: boolean;
  dataset: ReturnType<typeof useAppStore.getState>['dataset'];
  flow?: ScheduledFlow;
  nextPendingDate?: string;
  onClose: () => void;
}) {
  const apply = useAppStore((s) => s.apply);
  const notify = useAppStore((s) => s.notify);
  const today = todayISO();
  const [kind, setKind] = useState<'expense' | 'income'>(flow?.kind ?? 'expense');
  const [title, setTitle] = useState(flow?.title ?? '');
  const [amount, setAmount] = useState(amountInputValue(flow?.amount));
  const [accountId, setAccountId] = useState(flow?.accountId ?? dataset?.accounts[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(flow?.categoryId ?? '');
  const [merchant, setMerchant] = useState(flow?.merchant ?? '');
  const [note, setNote] = useState(flow?.note ?? '');
  const [startDate, setStartDate] = useState(flow?.startDate ?? today);
  const [endDate, setEndDate] = useState(flow?.endDate ?? '');
  const [unit, setUnit] = useState<'day' | 'week' | 'month' | 'year'>(flow?.rule.unit ?? 'month');
  const [interval, setIntervalCount] = useState(String(flow?.rule.interval ?? 1));
  const [enabled, setEnabled] = useState(flow?.enabled ?? true);
  const [scope, setScope] = useState<'all' | 'fromNext'>('all');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const categories = dataset?.categories.filter((c) => !c.archived && c.kind === (kind === 'expense' ? 'expense' : 'income')) ?? [];

  const submit = async () => {
    if (!dataset) return;
    const parsed = parseMoneyInput(amount);
    if (!parsed.ok) return setError(parsed.error);
    const parsedInterval = Number(interval);
    if (!Number.isInteger(parsedInterval) || parsedInterval < 1) return setError('重复间隔需为大于 0 的整数');
    if (!categoryId) return setError('请选择分类');
    const input: FlowInput = {
      kind,
      title,
      amount: parsed.cents,
      accountId,
      categoryId,
      merchant,
      note,
      startDate,
      endDate: endDate || undefined,
      rule: { unit, interval: parsedInterval },
      enabled,
    };
    setSaving(true);
    let ok = false;
    if (flow) {
      if (scope === 'fromNext' && nextPendingDate) {
        ok = await apply((d) => splitFlow(d, flow.id, nextPendingDate, input), '已从下一期起生效');
      } else {
        ok = await apply((d) => updateFlow(d, flow.id, input), '计划已更新');
      }
    } else {
      ok = await apply((d) => addFlow(d, input), '计划已创建');
    }
    setSaving(false);
    if (ok) onClose();
    else notify('保存失败，请检查输入', 'error');
  };

  if (!dataset) return null;

  return (
    <Modal
      open={open}
      title={flow ? '编辑计划' : '新建固定计划'}
      subtitle={flow ? '固定计划会按规则推导未来各期；核销时才产生真实流水。' : '工资、房租、订阅等重复收支，请建成计划而不是未来日期的流水。'}
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving}>{saving ? '保存中…' : '保存计划'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Segmented<'expense' | 'income'>
            value={kind}
            onChange={(v) => { setKind(v); setCategoryId(''); }}
            options={[{ value: 'expense', label: '固定支出' }, { value: 'income', label: '固定收入' }]}
          />
          <label className="flex items-center gap-2 text-[12px] text-[#6B6A63]">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> 启用
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="名称"><input className="input" maxLength={30} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：房租" /></Field>
          <Field label="金额（元）"><input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="账户">
            <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {dataset.accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="分类">
            <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">请选择</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="开始日期"><input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <Field label="结束日期（可选）"><input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="重复频率">
            <select className="select" value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
              <option value="week">每周</option>
              <option value="month">每月</option>
              <option value="year">每年</option>
              <option value="day">每天 / 一次性</option>
            </select>
          </Field>
          <Field label="每隔几次" hint="月/年重复会按原始日号自动处理月底，如 31 日在 2 月截断。">
            <input className="input num" inputMode="numeric" value={interval} onChange={(e) => setIntervalCount(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="商户 / 对方（可选）"><input className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} /></Field>
          <Field label="备注（可选）"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        {flow && nextPendingDate && (
          <Field label="修改范围">
            <select className="select" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="all">全部（含历史规则描述，已核销流水不改变）</option>
              <option value="fromNext">从下一期 {formatCN(nextPendingDate)} 起生效</option>
            </select>
          </Field>
        )}
        {error && <p className="rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]">{error}</p>}
      </div>
    </Modal>
  );
}

export function SchedulesPage() {
  const dataset = useAppStore((s) => s.dataset)!;
  const apply = useAppStore((s) => s.apply);
  const today = todayISO();
  const [formOpen, setFormOpen] = useState(false);
  const [editingFlow, setEditingFlow] = useState<ScheduledFlow | undefined>(undefined);
  const [settling, setSettling] = useState<OccurrenceView | null>(null);
  const [skipView, setSkipView] = useState<OccurrenceView | null>(null);
  const [rescheduling, setRescheduling] = useState<OccurrenceView | null>(null);

  const views = useMemo(
    () => buildOccurrenceViews(dataset.flows, dataset.occurrenceRecords, addDaysISO(today, -120), addDaysISO(today, 60), today),
    [dataset.flows, dataset.occurrenceRecords, today],
  );
  const pending = views.filter((v) => v.status === 'pending');
  const todo = pending.filter((v) => v.dueDate <= today);
  const upcoming = pending.filter((v) => v.dueDate > today);
  const recent = views.filter((v) => v.status === 'settled' || v.status === 'skipped').slice(-6).reverse();

  const nextPendingFor = (flowId: string) => pending.find((v) => v.flow.id === flowId && v.dueDate >= today)?.originalDueDate;

  const toggle = async (flow: ScheduledFlow) => {
    await apply((d) => toggleFlow(d, flow.id, !flow.enabled), flow.enabled ? '计划已停用，未来期不再计入预测' : '计划已启用');
  };

  const remove = async (flow: ScheduledFlow) => {
    const ok = await apply((d) => deleteFlow(d, flow.id), '计划已删除');
    if (!ok) {
      // 错误提示已由 store 处理；保留该计划
    }
  };

  const processSkip = async () => {
    if (!skipView) return;
    const ok = await apply((d) => skipOccurrence(d, skipView), '本期已跳过，不计入流水');
    if (ok) setSkipView(null);
  };

  return (
    <div className="fade-in" data-testid="schedules">
      <PageHeader
        title="计划"
        description="固定收支按规则推导；只有核销才写入真实流水。逾期支出会在预测中按今日待付保守计入。"
        actions={<Button variant="primary" onClick={() => { setEditingFlow(undefined); setFormOpen(true); }}><Plus size={15} /> 新建计划</Button>}
      />

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Card
            title="待处理"
            subtitle="核销会按今天日期生成真实流水；也可跳过或改期"
            action={<Badge tone={todo.length > 0 ? 'amber' : 'teal'}>{todo.length} 项到期或逾期</Badge>}
          >
            {todo.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg bg-[#F1FAF7] px-3 py-3 text-[12.5px] text-[#0B6357]">
                <Check size={16} /> 没有到期计划，保持记录即可。
              </div>
            ) : (
              <ul className="space-y-2">
                {todo.map((view) => (
                  <li key={view.id} className={cn('flex flex-col gap-2 rounded-xl border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between', view.overdue ? 'border-[#EBCBC6] bg-[#FCF5F3]' : 'border-[#EEDCB9] bg-[#FBF7EC]')}>
                    <div className="flex items-start gap-2.5">
                      <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg', view.flow.kind === 'income' ? 'bg-[#E3F1ED] text-[#0B6357]' : 'bg-[#F8E7E4] text-[#98362E]')}>
                        {view.overdue ? <TriangleAlert size={15} /> : <Clock size={15} />}
                      </span>
                      <div>
                        <p className="text-[13px] font-semibold">{view.flow.title}</p>
                        <p className="text-[11px] text-[#8A887F]">
                          {formatCN(view.dueDate)} · {dueLabel(view.daysUntilDue)} · {view.flow.kind === 'income' ? '收入' : '支出'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 pl-10 sm:pl-0">
                      <Money cents={view.amount} className="text-[13px] font-semibold" />
                      <div className="flex gap-1.5">
                        <Button size="xs" variant="primary" onClick={() => setSettling(view)}>核销</Button>
                        <Button size="xs" variant="secondary" onClick={() => setRescheduling(view)}><RefreshCw size={11} /> 改期</Button>
                        <Button size="xs" variant="ghost" onClick={() => setSkipView(view)}><SkipForward size={11} /> 跳过</Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="未来 60 天" subtitle="按日期排序，含今天之后的所有待发生期">
            {upcoming.length === 0 ? (
              <EmptyState title="未来没有待发生的计划" description="可以新建工资、房租或订阅计划。" action={<Button size="sm" variant="secondary" onClick={() => setFormOpen(true)}><Plus size={13} /> 新建计划</Button>} />
            ) : (
              <div className="table-wrap -mx-5">
                <table className="data">
                  <thead>
                    <tr><th>日期</th><th>计划</th><th>类型</th><th className="text-right">金额</th><th></th></tr>
                  </thead>
                  <tbody>
                    {upcoming.slice(0, 20).map((view) => (
                      <tr key={view.id}>
                        <td className="whitespace-nowrap text-[12px]">{formatCN(view.dueDate)}<span className="ml-1 text-[10.5px] text-[#A3A097]">{dueLabel(view.daysUntilDue)}</span></td>
                        <td><p className="text-[12.5px] font-medium">{view.flow.title}</p><p className="text-[10.5px] text-[#A3A097]">{frequencyLabel(view.flow.rule.unit, view.flow.rule.interval)}</p></td>
                        <td><Badge tone={view.flow.kind === 'income' ? 'teal' : 'gray'}>{view.flow.kind === 'income' ? '收入' : '支出'}</Badge></td>
                        <td className="num text-right text-[12.5px] font-semibold">{formatMoneyShort(view.amount)}</td>
                        <td className="text-right">
                          <div className="flex justify-end gap-1">
                            <button type="button" className="btn btn-ghost btn-xs !p-1.5" aria-label="改期" onClick={() => setRescheduling(view)}><RefreshCw size={12} /></button>
                            <button type="button" className="btn btn-ghost btn-xs !p-1.5" aria-label="跳过" onClick={() => setSkipView(view)}><SkipForward size={12} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {recent.length > 0 && (
            <Card title="最近处理记录" subtitle="已核销或跳过的期次">
              <ul className="space-y-2">
                {recent.map((view) => (
                  <li key={view.id} className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="flex items-center gap-2">
                      <span className={cn('grid h-6 w-6 place-items-center rounded-md', view.status === 'settled' ? 'bg-[#E3F1ED] text-[#0B6357]' : 'bg-[#F0EDE6] text-[#8A887F]')}>
                        {view.status === 'settled' ? <Check size={12} /> : <SkipForward size={12} />}
                      </span>
                      {view.flow.title} · {formatCN(view.originalDueDate)}
                    </span>
                    <span className="text-[#8A887F]">{view.status === 'settled' ? '已核销' : '已跳过'}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="全部计划" subtitle={`${dataset.flows.length} 个计划 · 可随时停用`}>
            {dataset.flows.length === 0 ? (
              <EmptyState title="还没有固定计划" description="把工资、房租等重复收支建成计划，预测才会更准。" />
            ) : (
              <ul className="space-y-2.5">
                {dataset.flows.map((flow) => {
                  const next = pending.find((v) => v.flow.id === flow.id);
                  return (
                    <li key={flow.id} className="group rounded-xl border border-[#EFECE6] px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className={cn('truncate text-[13px] font-medium', !flow.enabled && 'text-[#A3A097] line-through')}>{flow.title}</p>
                            {flow.source === 'recurring_candidate' && <Badge tone="teal"><CalendarClock size={10} /> 洞察</Badge>}
                            {!flow.enabled && <Badge tone="gray">已停用</Badge>}
                          </div>
                          <p className="mt-0.5 text-[10.5px] text-[#8A887F]">
                            {frequencyLabel(flow.rule.unit, flow.rule.interval)} · {flow.kind === 'income' ? '收入' : '支出'} · {flow.accountId === dataset.accounts[0]?.id ? dataset.accounts[0]?.name : dataset.accounts.find((a) => a.id === flow.accountId)?.name}
                          </p>
                          {next && <p className="mt-0.5 text-[10.5px] text-[#8A887F]">下一期 {formatCN(next.dueDate)} · {dueLabel(next.daysUntilDue)}</p>}
                        </div>
                        <Money cents={flow.amount} className="shrink-0 text-[12.5px] font-semibold" />
                      </div>
                      <div className="mt-2 flex items-center justify-end gap-1">
                        <Button size="xs" variant="ghost" onClick={() => void toggle(flow)}>{flow.enabled ? '停用' : '启用'}</Button>
                        <button type="button" className="btn btn-ghost btn-xs !p-1.5" aria-label="编辑计划" onClick={() => { setEditingFlow(flow); setFormOpen(true); }}><Pencil size={12} /></button>
                        <button type="button" className="btn btn-ghost btn-xs !p-1.5 text-[#98362E]" aria-label="删除计划" onClick={() => void remove(flow)}><Trash2 size={12} /></button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="规则说明" subtitle="计划的推导与处理">
            <ul className="space-y-2 text-[11.5px] leading-relaxed text-[#6B6A63]">
              <li>• 未处理的期次只是「预计」，不改变余额，也不写入流水。</li>
              <li>• 核销时可按实际金额与日期调整；差异会作为真实流水记录。</li>
              <li>• 「改期」只影响本次；编辑计划可选择「从下一期起」拆分新旧规则。</li>
              <li>• 月度计划保持原始日号，2 月自动截断到月末，3 月恢复到 31 日。</li>
              <li>• 已核销的计划不能整条删除，避免历史流水失去来源。</li>
            </ul>
          </Card>
        </div>
      </div>

      {formOpen && (
        <FlowForm
          open={formOpen}
          dataset={dataset}
          flow={editingFlow}
          nextPendingDate={editingFlow ? nextPendingFor(editingFlow.id) : undefined}
          onClose={() => { setFormOpen(false); setEditingFlow(undefined); }}
        />
      )}

      <SettleModal
        view={settling}
        dataset={dataset}
        onClose={() => setSettling(null)}
      />

      <Modal
        open={Boolean(skipView)}
        title="跳过这一期？"
        subtitle="跳过不会产生流水；该期不会再次提醒。之后的期次不受影响。"
        onClose={() => setSkipView(null)}
        footer={<><Button variant="ghost" onClick={() => setSkipView(null)}>取消</Button><Button variant="primary" onClick={() => void processSkip()}>确认跳过</Button></>}
      >
        {skipView && <p className="rounded-lg bg-[#FAF8F3] px-3 py-3 text-[12.5px]">{skipView.flow.title} · {formatCN(skipView.dueDate)} · {formatMoneyShort(skipView.amount)}</p>}
      </Modal>

      <RescheduleModal view={rescheduling} onClose={() => setRescheduling(null)} />
    </div>
  );
}

function SettleModal({ view, dataset, onClose }: { view: OccurrenceView | null; dataset: NonNullable<ReturnType<typeof useAppStore.getState>['dataset']>; onClose: () => void }) {
  const apply = useAppStore((s) => s.apply);
  const today = todayISO();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);

  if (view && lastId !== view.id) {
    setLastId(view.id);
    setAmount(amountInputValue(view.amount));
    setDate(today);
    setAccountId(view.flow.accountId);
    setNote('');
    setError(null);
  }

  const submit = async () => {
    if (!view) return;
    const parsed = parseMoneyInput(amount);
    if (!parsed.ok) return setError(parsed.error);
    const ok = await apply(
      (d) => settleOccurrence(d, view, { date, amount: parsed.cents, accountId, note }),
      '已核销并写入流水',
    );
    if (ok) onClose();
    else setError('核销失败，请刷新后重试');
  };

  return (
    <Modal
      open={Boolean(view)}
      title="核销计划"
      subtitle="核销后按实际日期与金额生成真实流水，并从待处理中移除。"
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" onClick={() => void submit()}>确认核销</Button></>}
    >
      {view && (
        <div className="space-y-4">
          <div className="rounded-lg bg-[#FAF8F3] px-3 py-2.5 text-[12px]">
            <span className="font-semibold">{view.flow.title}</span>
            <span className="ml-2 text-[#6B6A63]">原到期 {formatCN(view.dueDate)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="实际金额（元）"><input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="记账日期"><input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="账户">
              <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {dataset.accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="备注（可选）"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：本月水电" /></Field>
          </div>
          {error && <p className="rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

function RescheduleModal({ view, onClose }: { view: OccurrenceView | null; onClose: () => void }) {
  const apply = useAppStore((s) => s.apply);
  const today = todayISO();
  const [date, setDate] = useState(addDaysISO(today, 1));
  const [lastId, setLastId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (view && lastId !== view.id) {
    setLastId(view.id);
    setDate(view.dueDate >= today ? view.dueDate : addDaysISO(today, 1));
    setError(null);
  }

  const submit = async () => {
    if (!view) return;
    if (!date || date < today) return setError('改期日期不能早于今天');
    const ok = await apply((d) => rescheduleOccurrence(d, view, date), '本期已改期');
    if (ok) onClose();
    else setError('改期失败，请刷新后重试');
  };

  return (
    <Modal
      open={Boolean(view)}
      title="改期（仅本次）"
      subtitle="只移动这一期，不改变计划的重复规则。"
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" onClick={() => void submit()}>确认改期</Button></>}
    >
      {view && (
        <div className="space-y-3">
          <p className="rounded-lg bg-[#FAF8F3] px-3 py-2.5 text-[12px]">{view.flow.title} · 原到期 {formatCN(view.dueDate)} · {formatMoneyShort(view.amount)}</p>
          <Field label="新日期"><input className="input" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          {error && <p className="text-[12px] text-[#98362E]">{error}</p>}
        </div>
      )}
    </Modal>
  );
}