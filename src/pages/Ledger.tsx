import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeftRight,
  Check,
  CircleAlert,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
  Zap,
} from 'lucide-react';
import type { Transaction } from '../domain/types';
import { useAppStore } from '../store/useAppStore';
import { formatCN, todayISO } from '../domain/days';
import { parseMoneyInput } from '../domain/money';
import { isInPeriod, periodLabel, previousPeriod } from '../domain/period';
import { categoryTotals, compareTotals, periodBreakdown, periodTotals } from '../domain/periodStats';
import { usePeriodParams } from '../lib/usePeriodParams';
import { PeriodPicker } from '../components/PeriodPicker';
import { parseQuickEntry } from '../domain/quickEntry';
import { addTransaction, deleteTransaction, updateTransaction, type TxnInput } from '../services/mutations';
import { TransactionForm } from '../components/TransactionForm';
import { Badge, Button, Card, CategoryIcon, EmptyState, Field, Modal, Money, PageHeader, Segmented, cn } from '../components/ui';
import { kindLabel, natureLabel } from '../lib/ui';

function txToInput(t: Transaction): TxnInput {
  return {
    kind: t.kind,
    date: t.date,
    amount: t.amount,
    accountId: t.accountId,
    toAccountId: t.toAccountId,
    categoryId: t.categoryId,
    merchant: t.merchant,
    note: t.note,
    nature: t.nature,
  };
}

export function LedgerPage() {
  const dataset = useAppStore((s) => s.dataset)!;
  const apply = useAppStore((s) => s.apply);
  const notify = useAppStore((s) => s.notify);
  const [params] = useSearchParams();
  const today = todayISO();
  const { unit, anchor, period, setPeriod } = usePeriodParams('month');
  const [kind, setKind] = useState<'all' | 'income' | 'expense' | 'transfer'>('all');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [quickText, setQuickText] = useState('');
  const quickRef = useRef<HTMLTextAreaElement | null>(null);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const addedTimer = useRef<number | null>(null);

  const markAdded = (id: string) => {
    setJustAddedId(id);
    if (addedTimer.current !== null) window.clearTimeout(addedTimer.current);
    addedTimer.current = window.setTimeout(() => {
      setJustAddedId((cur) => (cur === id ? null : cur));
      addedTimer.current = null;
    }, 1200);
  };

  const addWithHighlight = (input: TxnInput, message: string) =>
    apply((d) => {
      const next = addTransaction(d, input);
      if (next.transactions.length > d.transactions.length) {
        const prev = new Set(d.transactions.map((t) => t.id));
        const added = next.transactions.find((t) => !prev.has(t.id));
        if (added) markAdded(added.id);
      }
      return next;
    }, message);

  useEffect(() => {
    if (params.get('quick') === '1') {
      setFormOpen(false);
      setTimeout(() => quickRef.current?.focus(), 80);
    }
  }, [params]);

  const accountName = useMemo(() => new Map(dataset.accounts.map((a) => [a.id, a.name])), [dataset.accounts]);
  const categoryById = useMemo(() => new Map(dataset.categories.map((c) => [c.id, c])), [dataset.categories]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dataset.transactions
      .filter((t) => isInPeriod(t.date, period))
      .filter((t) => (kind === 'all' ? true : t.kind === kind))
      .filter((t) => (categoryId ? t.categoryId === categoryId : true))
      .filter((t) => {
        if (!q) return true;
        return [t.merchant, t.note, categoryById.get(t.categoryId ?? '')?.name].some((v) => v?.toLowerCase().includes(q));
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1));
  }, [dataset.transactions, period.key, kind, categoryId, search, categoryById]);

  const stats = useMemo(() => periodTotals(dataset.transactions, period), [dataset.transactions, period.key]);
  const prevStats = useMemo(() => periodTotals(dataset.transactions, previousPeriod(period)), [dataset.transactions, period.key]);
  const delta = useMemo(() => compareTotals(stats, prevStats), [stats, prevStats]);
  const quick = useMemo(() => (quickText.trim() ? parseQuickEntry(quickText, today) : null), [quickText, today]);
  const listKey = `${period.key}|${kind}|${categoryId}`;

  // 年视图可能上千条：默认渲染前 200 条，可追加
  const [visible, setVisible] = useState(200);
  useEffect(() => {
    setVisible(200);
  }, [listKey]);
  const visibleTxns = filtered.slice(0, visible);

  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of visibleTxns) {
      const list = map.get(t.date) ?? [];
      list.push(t);
      map.set(t.date, list);
    }
    return [...map.entries()];
  }, [visibleTxns]);

  const quickCategory = quick?.categoryHint
    ? dataset.categories.find((c) => c.name === quick.categoryHint && c.kind === quick.kind)
    : undefined;

  const allCatRows = useMemo(
    () => categoryTotals(dataset.transactions, period, 'expense'),
    [dataset.transactions, period.key],
  );
  const catRows = allCatRows.slice(0, 8);
  const catTotal = allCatRows.reduce((sum, r) => sum + r.amount, 0);
  const prevCatMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of categoryTotals(dataset.transactions, previousPeriod(period), 'expense')) {
      map.set(r.categoryId ?? 'none', r.amount);
    }
    return map;
  }, [dataset.transactions, period.key]);
  const breakdown = useMemo(
    () => periodBreakdown(dataset.transactions, period),
    [dataset.transactions, period.key],
  );

  const acceptQuick = async () => {
    if (!quick || !quick.ok || quick.amount === undefined || !quick.kind) return;
    const input: TxnInput = {
      kind: quick.kind,
      amount: quick.amount,
      date: quick.date ?? today,
      accountId: dataset.accounts[0]?.id ?? '',
      categoryId: quickCategory?.id,
      merchant: quick.merchant,
      note: `快速记账：${quick.raw}`,
      nature: quick.kind === 'income' ? 'one_off' : 'variable',
    };
    if (input.kind !== 'transfer' && !input.categoryId) {
      notify('未匹配到分类，请用表单选择分类后再保存', 'error');
      return;
    }
    const ok = await addWithHighlight(input, '已按解析结果记一笔');
    if (ok) setQuickText('');
  };

  const onFormSubmit = async (input: TxnInput) => {
    if (editing) {
      const ok = await apply((d) => updateTransaction(d, editing.id, input), '流水已更新');
      return ok;
    }
    const ok = await addWithHighlight(input, '已记一笔');
    return ok;
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const linked = Boolean(deleting.occurrenceId);
    const ok = await apply((d) => deleteTransaction(d, deleting.id), linked ? '流水已删除，计划该期恢复待发生' : '流水已删除');
    if (ok) setDeleting(null);
  };

  return (
    <div className="fade-in" data-testid="ledger">
      <PageHeader
        title="流水"
        description="记录每天真实发生的收入、支出和转账，可按分类与账户筛选回看。金额以整数分计算，转账不计入收支。"
        actions={
          <Button variant="primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus size={15} /> 记一笔
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          {dataset.settings.quickInputEnabled && (
            <Card
              title="一句话快速记账"
              subtitle="本地规则解析，歧义或未来日期不会自动落库；确认前可修改。"
              action={<Badge tone="teal"><Zap size={11} /> 可解释</Badge>}
            >
              <textarea
                ref={quickRef}
                className="textarea min-h-[64px] resize-y"
                placeholder="例如：昨天买咖啡18.5元 / 今天兼职收入300元"
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                data-testid="quick-input"
              />
              {quick && (
                <div className="mt-3 rounded-xl border border-[#E4E0D8] bg-[#FAF8F3] p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                    <Badge tone={quick.ok ? 'teal' : 'amber'}>{quick.ok ? `置信度：${quick.confidence === 'high' ? '高' : quick.confidence === 'medium' ? '中' : '低'}` : '需要确认'}</Badge>
                    {quick.amount !== undefined && <span className="num font-semibold">¥{(quick.amount / 100).toFixed(2)}</span>}
                    {quick.kind && <span>{kindLabel(quick.kind)}</span>}
                    {quick.date && <span>{formatCN(quick.date)}</span>}
                    {quick.merchant && <span>商户：{quick.merchant}</span>}
                    {quick.categoryHint && <span>分类提示：{quick.categoryHint}</span>}
                  </div>
                  {quick.issues.length > 0 && (
                    <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-[#8A5A13]">
                      {quick.issues.map((issue) => (
                        <li key={issue} className="flex items-start gap-1.5">
                          <CircleAlert size={12} className="mt-0.5 shrink-0" /> {issue}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2.5 flex items-center gap-2">
                    <Button size="sm" variant="primary" disabled={!quick.ok} onClick={() => void acceptQuick()}>
                      <Check size={14} /> 按解析结果记账
                    </Button>
                    <span className="text-[10.5px] text-[#8A887F]">使用第一个账户与匹配分类；如需调整请用「记一笔」。</span>
                  </div>
                </div>
              )}
            </Card>
          )}

          <Card padded={false}>
            <div className="flex flex-wrap items-center gap-2 border-b border-[#EFECE6] px-4 py-3">
              <PeriodPicker
                unit={unit}
                anchor={anchor}
                today={today}
                onChange={setPeriod}
                testIdPrefix="ledger-period"
              />
              <Segmented
                value={kind}
                onChange={setKind}
                size="sm"
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'expense', label: '支出' },
                  { value: 'income', label: '收入' },
                  { value: 'transfer', label: '转账' },
                ]}
              />
              <select className="select !w-auto !py-1.5 text-xs" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="分类筛选">
                <option value="">全部分类</option>
                {dataset.categories.filter((c) => !c.archived).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <div className="relative ml-auto min-w-[160px] flex-1 sm:flex-none">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A3A097]" />
                <input className="input !py-1.5 !pl-8 text-xs" placeholder="搜商户或备注" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="num flex w-full flex-wrap items-center justify-between gap-3 border-t border-[#F0EDE6] pt-2 text-[11.5px] text-[#6B6A63] sm:w-auto sm:border-0 sm:pt-0">
                <span>收入 <span className="font-semibold text-[#0B6357]">{formatMoney(stats.income)}</span></span>
                <span>支出 <span className="font-semibold text-[#98362E]">{formatMoney(stats.expense)}</span></span>
                <span>结余 <span className="font-semibold text-[#1F2421]">{formatMoney(stats.net)}</span></span>
                <span
                  className={cn('shrink-0', delta.netDelta > 0 ? 'text-[#0B6357]' : delta.netDelta < 0 ? 'text-[#98362E]' : 'text-[#A3A097]')}
                  title={prevStats.count === 0 ? '上一周期没有流水' : `上期：收入 ${formatMoney(prevStats.income)} · 支出 ${formatMoney(prevStats.expense)} · 结余 ${formatMoney(prevStats.net)}`}
                >
                  {prevStats.count === 0 ? (
                    '较上期 上期无数据'
                  ) : (
                    <>较上期 {delta.netDelta >= 0 ? '↑' : '↓'} {delta.netDelta >= 0 ? '+' : '−'}{formatMoney(Math.abs(delta.netDelta))}{delta.expensePct !== null ? `（支出 ${delta.expensePct >= 0 ? '+' : '−'}${Math.abs(delta.expensePct)}%）` : ''}</>
                  )}
                </span>
              </div>
            </div>

            {grouped.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title={unit === 'day' ? '这一天还没有流水' : unit === 'week' ? '这一周还没有流水' : '这个周期还没有流水'}
                  description={dataset.transactions.length === 0 ? '从「记一笔」或快速记账开始。' : `上期有 ${prevStats.count} 笔，点「上一周期」看看。`}
                  action={<Button variant="primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus size={14} /> 记一笔</Button>}
                />
              </div>
            ) : (
              <div key={listKey} className="divide-y divide-[#F0EDE6]">
                {grouped.map(([date, txns], dayIndex) => {
                  const dayNet = txns.reduce((sum, t) => sum + (t.kind === 'income' ? t.amount : t.kind === 'expense' ? -t.amount : 0), 0);
                  return (
                    <div key={date} className="ledger-day px-4 py-3" style={{ '--stagger': Math.min(dayIndex, 10) } as CSSProperties}>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[11.5px] font-semibold text-[#6B6A63]">{formatCN(date)}</p>
                        <span className={cn('num text-[10.5px]', dayNet >= 0 ? 'text-[#0B6357]' : 'text-[#98362E]')}>
                          {dayNet >= 0 ? '+' : ''}{formatMoney(dayNet)}
                        </span>
                      </div>
                      <ul className="space-y-1">
                        {txns.map((t) => {
                          const cat = t.categoryId ? categoryById.get(t.categoryId) : undefined;
                          return (
                            <li key={t.id} className={cn('ledger-row group flex items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-[#FAF8F3]', t.id === justAddedId && 'hl-fade')}>
                              <span className="row-icon grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#F4F1EA] text-[#6B6A63]">
                                {t.kind === 'transfer' ? <ArrowLeftRight size={14} /> : <CategoryIcon icon={cat?.icon ?? 'shapes'} />}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <p className="truncate text-[13px] font-medium">
                                    {t.merchant || t.note || (t.kind === 'transfer' ? '账户互转' : cat?.name ?? '未命名')}
                                  </p>
                                  {t.occurrenceId && <Badge tone="white">计划</Badge>}
                                  {t.goalId && <Badge tone="teal"><Target size={10} /> 目标</Badge>}
                                  {t.nature === 'one_off' && <Badge tone="gray">一次性</Badge>}
                                </div>
                                <p className="truncate text-[10.5px] text-[#8A887F]">
                                  {t.kind === 'transfer' ? `${accountName.get(t.accountId)} → ${accountName.get(t.toAccountId ?? '')}` : `${accountName.get(t.accountId)} · ${cat?.name ?? '未分类'}`}
                                  {t.note && t.merchant ? ` · ${t.note}` : ''}
                                </p>
                              </div>
                              <span className={cn('num shrink-0 text-[13px] font-semibold', t.kind === 'income' ? 'text-[#0B6357]' : t.kind === 'expense' ? 'text-[#1F2421]' : 'text-[#6B6A63]')}>
                                {t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : '⇄'}{formatMoney(t.amount)}
                              </span>
                              <div className="flex shrink-0 gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                                <button type="button" className="btn btn-ghost btn-xs !p-1.5" aria-label="编辑流水" onClick={() => { setEditing(t); setFormOpen(true); }}>
                                  <Pencil size={13} />
                                </button>
                                <button type="button" className="btn btn-ghost btn-xs !p-1.5 text-[#98362E]" aria-label="删除流水" onClick={() => setDeleting(t)}>
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
                <div className="px-4 py-3 text-center text-[11px] text-[#A3A097]">共 {filtered.length} 笔，按日期倒序显示。</div>
                {visible < filtered.length && (
                  <div className="border-t border-[#F0EDE6] px-4 py-2.5 text-center">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVisible((v) => v + 200)}>
                      加载更多（还有 {filtered.length - visible} 笔）
                    </button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="本期分类" subtitle={`${periodLabel(period)} · 不含转账`}>
            {catRows.length === 0 ? (
              <p className="text-[12px] text-[#8A887F]">本期还没有支出。</p>
            ) : (
              <ul className="space-y-3">
                {catRows.map((row) => {
                  const key = row.categoryId ?? 'none';
                  const cat = categoryById.get(key);
                  const prev = prevCatMap.get(key);
                  const diff = prev === undefined ? 0 : row.amount - prev;
                  return (
                    <li key={key}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-[12px]">
                        <span className="flex min-w-0 items-center gap-1.5 text-[#3A3D37]"><CategoryIcon icon={cat?.icon ?? 'shapes'} /> {cat?.name ?? '未分类'}</span>
                        <span className="num flex shrink-0 items-center gap-1.5 text-[#6B6A63]">
                          {prev !== undefined && (
                            <span className="text-[10.5px]" title={`上期 ${formatMoney(prev)}`}>
                              {diff > 0 ? <span className="text-[#98362E]">↑</span> : diff < 0 ? <span className="text-[#0B6357]">↓</span> : <span className="text-[#A3A097]">＝</span>}
                            </span>
                          )}
                          <span>{formatMoney(row.amount)}</span>
                          <span className="text-[10px] text-[#A3A097]">{catTotal > 0 ? `${Math.round((row.amount / catTotal) * 100)}%` : ''}</span>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[#EFECE6]">
                        <div className="h-full rounded-full bg-[#0E7568]/70" style={{ width: `${catTotal > 0 ? (row.amount / catTotal) * 100 : 0}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {(unit === 'year' || unit === 'month') && breakdown.length > 1 && (
              <div className="mt-4 border-t border-[#EFECE6] pt-3">
                <p className="mb-2 text-[11px] font-semibold text-[#6B6A63]">期内分解（支出）</p>
                <ul className="space-y-1.5">
                  {breakdown.map((b) => {
                    const max = Math.max(1, ...breakdown.map((x) => x.expense));
                    return (
                      <li key={b.key} className="flex items-center gap-2 text-[10px] text-[#8A887F]">
                        <span className="w-14 shrink-0 text-right">{b.label}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EFECE6]">
                          <div className="h-full rounded-full bg-[#0E7568]/60" style={{ width: `${(b.expense / max) * 100}%` }} />
                        </div>
                        <span className="num w-20 shrink-0 text-right">{b.expense > 0 ? formatMoney(b.expense) : ''}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Card>

          <Card title="记账口径" subtitle="避免把未来的计划当成已发生">
            <ul className="space-y-2 text-[11.5px] leading-relaxed text-[#6B6A63]">
              <li>• 实际交易日期不能晚于今天；未来支出请在「计划」中建立。</li>
              <li>• 转账只改变账户分布，不进入收入/支出统计。</li>
              <li>• 来自计划核销的流水会带「计划」标记；删除它会撤销核销。</li>
              <li>• 目标购买流水带「目标」标记，预留同步消耗，可支配金额不重复减少。</li>
              <li>• 修改或删除某天流水会失效该日已有校准记录。</li>
            </ul>
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#E3F1ED]/60 px-3 py-2 text-[11px] leading-relaxed text-[#0B6357]">
              <Sparkles size={13} className="mt-0.5 shrink-0" />
              快速记账只做规则解析，不会自动提交；退款、否定语义会被拦截。
            </div>
          </Card>
        </div>
      </div>

      <TransactionForm
        open={formOpen}
        dataset={dataset}
        editing={editing ?? undefined}
        initial={editing ? txToInput(editing) : undefined}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSubmit={onFormSubmit}
      />

      <Modal
        open={Boolean(deleting)}
        title="删除这笔流水？"
        subtitle={deleting?.occurrenceId ? '该流水来自计划核销，删除后会撤销核销并恢复为待发生。' : '删除后余额与预测会立即重算；当天已有校准记录将被标记失效。'}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>取消</Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>确认删除</Button>
          </>
        }
      >
        {deleting && (
          <div className="rounded-lg bg-[#FAF8F3] px-3 py-3 text-[12.5px]">
            <p className="font-medium">{deleting.merchant || deleting.note || kindLabel(deleting.kind)}</p>
            <p className="mt-1 text-[#6B6A63]">{formatCN(deleting.date)} · {kindLabel(deleting.kind)} · {formatMoney(deleting.amount)}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function formatMoney(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const fen = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}¥${yuan.toLocaleString('zh-CN')}.${fen}`;
}