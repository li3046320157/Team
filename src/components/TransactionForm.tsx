import { useEffect, useMemo, useState } from 'react';
import type { Dataset, TxnKind, TxnNature, Transaction } from '../domain/types';
import { parseMoneyInput } from '../domain/money';
import { todayISO } from '../domain/days';
import { amountInputValue } from '../lib/ui';
import type { TxnInput } from '../services/mutations';
import { Button, Field, Modal, Segmented } from './ui';

export function TransactionForm({
  open,
  dataset,
  initial,
  editing,
  onClose,
  onSubmit,
}: {
  open: boolean;
  dataset: Dataset;
  initial?: Partial<TxnInput>;
  editing?: Transaction;
  onClose: () => void;
  onSubmit: (input: TxnInput) => Promise<boolean>;
}) {
  const today = todayISO();
  const [kind, setKind] = useState<TxnKind>(initial?.kind ?? 'expense');
  const [amount, setAmount] = useState(amountInputValue(initial?.amount));
  const [date, setDate] = useState(initial?.date ?? today);
  const [accountId, setAccountId] = useState(initial?.accountId ?? dataset.accounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState(initial?.toAccountId ?? dataset.accounts[1]?.id ?? '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [merchant, setMerchant] = useState(initial?.merchant ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [nature, setNature] = useState<TxnNature>(initial?.nature ?? (initial?.kind === 'income' ? 'one_off' : 'variable'));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(initial?.kind ?? editing?.kind ?? 'expense');
    setAmount(amountInputValue(initial?.amount ?? editing?.amount));
    setDate(initial?.date ?? editing?.date ?? today);
    setAccountId(initial?.accountId ?? editing?.accountId ?? dataset.accounts[0]?.id ?? '');
    setToAccountId(initial?.toAccountId ?? editing?.toAccountId ?? dataset.accounts[1]?.id ?? '');
    setCategoryId(initial?.categoryId ?? editing?.categoryId ?? '');
    setMerchant(initial?.merchant ?? editing?.merchant ?? '');
    setNote(initial?.note ?? editing?.note ?? '');
    setNature(initial?.nature ?? editing?.nature ?? ((initial?.kind ?? editing?.kind) === 'income' ? 'one_off' : 'variable'));
    setError(null);
    // 仅在打开时同步初值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const categories = useMemo(
    () => dataset.categories.filter((c) => !c.archived && (kind === 'expense' ? c.kind === 'expense' : c.kind === 'income')),
    [dataset.categories, kind],
  );

  useEffect(() => {
    if (kind === 'transfer') {
      setCategoryId('');
      return;
    }
    if (categoryId && !categories.some((c) => c.id === categoryId)) setCategoryId('');
  }, [kind, categories, categoryId]);

  const submit = async () => {
    const parsed = parseMoneyInput(amount);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (kind !== 'transfer' && !categoryId) {
      setError('请选择分类');
      return;
    }
    setSaving(true);
    const ok = await onSubmit({
      kind,
      amount: parsed.cents,
      date,
      accountId,
      toAccountId: kind === 'transfer' ? toAccountId : undefined,
      categoryId: kind === 'transfer' ? undefined : categoryId,
      merchant,
      note,
      nature,
    });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open={open}
      title={editing ? '编辑流水' : '记一笔'}
      subtitle={editing ? '修改后会影响余额与预测，并失效当天校准记录' : '实际交易不能记在未来日期'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={saving || dataset.accounts.length === 0}>
            {saving ? '保存中…' : editing ? '保存修改' : '确认记账'}
          </Button>
        </>
      }
    >
      {dataset.accounts.length === 0 ? (
        <p className="text-sm text-[#6B6A63]">请先在「设置」或引导页创建账户。</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Segmented<TxnKind>
              value={kind}
              onChange={(v) => {
                setKind(v);
                setError(null);
              }}
              options={[
                { value: 'expense', label: '支出' },
                { value: 'income', label: '收入' },
                { value: 'transfer', label: '转账' },
              ]}
            />
            {kind !== 'transfer' && (
              <span key={`kind-${kind}-nature`} className="fade-swap">
                <select className="select !w-auto !py-1.5 text-xs" value={nature} onChange={(e) => setNature(e.target.value as TxnNature)} aria-label="支出性质">
                  <option value="variable">可变消费</option>
                  <option value="recurring">固定重复</option>
                  <option value="one_off">一次性</option>
                </select>
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="金额（元）">
              <input className="input num" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </Field>
            <Field label="日期">
              <input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={kind === 'transfer' ? '转出账户' : '账户'}>
              <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {dataset.accounts.filter((a) => !a.archived).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <span key={`kind-${kind}-field`} className="fade-swap">
              {kind === 'transfer' ? (
                <Field label="转入账户">
                  <select className="select" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                    {dataset.accounts.filter((a) => !a.archived).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="分类">
                  <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">请选择</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="商户 / 对方（可选）">
              <input className="input" placeholder="例如：瑞幸咖啡" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
            </Field>
            <Field label="备注（可选）">
              <input className="input" placeholder="这笔钱花在哪里" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>

          {error && <p className="rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]">{error}</p>}
        </div>
      )}
    </Modal>
  );
}