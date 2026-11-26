import { useState, type CSSProperties } from 'react';
import { ArrowRight, ShieldCheck, Sparkles, Wallet } from 'lucide-react';
import { parseMoneyInput } from '../domain/money';
import { todayISO } from '../domain/days';
import { useAppStore } from '../store/useAppStore';
import { Button, Field } from './ui';

export function Onboarding() {
  const complete = useAppStore((s) => s.completeOnboarding);
  const enterDemo = useAppStore((s) => s.enterDemo);
  const loading = useAppStore((s) => s.loading);
  const [accountName, setAccountName] = useState('');
  const [opening, setOpening] = useState('');
  const [safety, setSafety] = useState('');
  const [budget, setBudget] = useState('');
  const [coverageStart, setCoverageStart] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const today = todayISO();

  const submit = async () => {
    const parseZero = (value: string): number | null => {
      if (value.trim() === '') return 0;
      if (/^0+(\.0{0,2})?$/.test(value.trim())) return 0;
      const parsed = parseMoneyInput(value);
      return parsed.ok ? parsed.cents : null;
    };
    const open = parseZero(opening);
    const safe = parseZero(safety);
    const bud = parseZero(budget);
    if (open === null) return setError('期初余额格式无效（可填 0）');
    if (safe === null) return setError('安全储备格式无效（可填 0）');
    if (bud === null) return setError('月预算格式无效（可填 0）');
    setSaving(true);
    const ok = await complete({
      accountName: accountName.trim() || '日常账户',
      openingBalance: open,
      safetyReserve: safe,
      monthVariableBudget: bud,
      coverageStart: coverageStart || undefined,
    });
    setSaving(false);
    if (!ok) setError('保存失败，请检查浏览器存储权限');
  };

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6 sm:py-14">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="pt-2">
          <div className="rise flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--accent)] text-[22px] font-bold text-white">¥</div>
            <div>
              <p className="text-[22px] font-semibold tracking-tight">金钱流水</p>
              <p className="text-[11.5px] tracking-[0.16em] text-[#8A887F]">看清现金流向，再做消费决定</p>
            </div>
          </div>
          <h1 className="rise mt-9 text-[30px] font-semibold leading-[1.2] tracking-[-0.02em] sm:text-[36px]" style={{ '--d': '28ms' } as CSSProperties}>
            每一笔小钱，
            <br />
            都放进日、月、年的账里。
          </h1>
          <p className="rise mt-4 max-w-xl text-[13.5px] leading-relaxed text-[#6B6A63]" style={{ '--d': '56ms' } as CSSProperties}>
            金钱流水把真实流水、固定计划、目标预留放进同一本账，按日、月、年回看收支，并给出可追溯的余额预测。所有数据仅保存在本机浏览器。
          </p>
          <ul className="mt-6 space-y-3.5">
            {[
              { icon: ShieldCheck, title: '本地优先，不上传账单', desc: '使用浏览器 IndexedDB 存储；导出备份由你控制。' },
              { icon: Wallet, title: '整数分记账，余额守恒', desc: '收入、支出、转账与目标预留分开建模，不出现浮点误差。' },
              { icon: Sparkles, title: '预测标注假设与来源', desc: '历史不足时明确「未估计」；校准与回测结果如实展示。' },
            ].map((item, i) => (
              <li key={item.title} className="rise flex gap-3" style={{ '--i': i } as CSSProperties}>
                <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
                  <item.icon size={16} />
                </div>
                <div>
                  <p className="text-[13.5px] font-semibold">{item.title}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[#6B6A63]">{item.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="card rise h-fit p-5 sm:p-6" style={{ '--d': '120ms' } as CSSProperties}>
          <p className="text-[15px] font-semibold">建立你的账本</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[#6B6A63]">三步就能开始；之后可在设置里修改。</p>
          <div className="mt-5 space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="主账户名称">
                <input className="input" value={accountName} maxLength={20} onChange={(e) => setAccountName(e.target.value)} placeholder="例如：日常账户（留空用默认名）" />
              </Field>
              <Field label="期初余额（元）">
                <input className="input num" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0.00" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="安全储备（元）" hint="低于这条线会提示风险，例如 5000；可留空表示不设">
                <input className="input num" inputMode="decimal" value={safety} onChange={(e) => setSafety(e.target.value)} placeholder="例如：5000" />
              </Field>
              <Field label="月可变预算（元）" hint="可留空，用历史估计，例如 3000">
                <input className="input num" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="例如：3000" />
              </Field>
            </div>
            <Field label="已整理完整的起始日期（可选）" hint={`留空表示从今天开始整理。最晚 ${today}。`}>
              <input className="input" type="date" max={today} value={coverageStart} onChange={(e) => setCoverageStart(e.target.value)} />
            </Field>
            {error && <p className="rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]">{error}</p>}
            <Button variant="primary" className="w-full !py-3" onClick={() => void submit()} disabled={saving || loading}>
              {saving ? '正在建立…' : '开始记账'}
              {!saving && <ArrowRight size={15} />}
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => void enterDemo()} data-testid="start-demo">
              先看 6 个月示例数据
            </Button>
            <p className="text-center text-[10.5px] leading-relaxed text-[#A3A097]">
              示例完全合成，与你的个人账本分开保存；随时可退出。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}