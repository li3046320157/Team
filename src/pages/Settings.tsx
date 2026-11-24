import { useState } from 'react';
import { CalendarRange, Check, Info, Landmark, Plus, Save, Settings2, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { addDaysISO, formatCN, todayISO } from '../domain/days';
import { formatMoney, parseMoneyInput } from '../domain/money';
import { validateCoverage } from '../domain/ledger';
import { wipeAllLocalData } from '../data/wipe';
import type { AccountType, CoverageInterval } from '../domain/types';
import { Badge, Button, Card, Field, InfoNote, Modal, Money, PageHeader, cn } from '../components/ui';

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = { cash: '现金', savings: '储蓄卡', ewallet: '电子钱包' };

function parseZero(text: string): { ok: true; cents: number } | { ok: false; error: string } {
  const t = text.trim();
  if (!t || t === '0') return { ok: true, cents: 0 };
  return parseMoneyInput(t);
}

function intervalDays(c: CoverageInterval): number {
  const ms = new Date(`${c.end}T12:00:00`).getTime() - new Date(`${c.start}T12:00:00`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function SettingsPage() {
  const dataset = useAppStore((s) => s.dataset)!;
  const apply = useAppStore((s) => s.apply);
  const addAccountAction = useAppStore((s) => s.addAccount);
  const today = todayISO();
  const s = dataset.settings;
  const [safety, setSafety] = useState(s.safetyReserve ? (s.safetyReserve / 100).toFixed(2) : '');
  const [budget, setBudget] = useState(s.budget.monthVariableBudget ? (s.budget.monthVariableBudget / 100).toFixed(2) : '');
  const [savingsCap, setSavingsCap] = useState(s.budget.monthlySavingsCap ? (s.budget.monthlySavingsCap / 100).toFixed(2) : '');
  const [allocDay, setAllocDay] = useState(String(s.goalAllocDay));
  const [quickInput, setQuickInput] = useState(s.quickInputEnabled);
  const [smallThreshold, setSmallThreshold] = useState((s.smallThreshold / 100).toFixed(2));
  const [smallWindow, setSmallWindow] = useState(String(s.smallWindowDays));
  const [anomalyWindow, setAnomalyWindow] = useState(String(s.anomalyWindowDays));
  const [anomalySamples, setAnomalySamples] = useState(String(s.anomalyMinSamples));
  const [anomalyZ, setAnomalyZ] = useState(String(s.anomalyRobustZ));
  const [recurringTol, setRecurringTol] = useState(String(s.recurringToleranceDays));
  const [recurringCv, setRecurringCv] = useState(String(Math.round(s.recurringMaxCv * 100)));
  const [coverage, setCoverage] = useState<CoverageInterval[]>(() => s.coverage.map((c) => ({ ...c })));
  const [newStart, setNewStart] = useState(addDaysISO(today, -90));
  const [newEnd, setNewEnd] = useState(addDaysISO(today, -1));
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<AccountType>('savings');
  const [accBalance, setAccBalance] = useState('');
  const [accDate, setAccDate] = useState(addDaysISO(today, -30));
  const [accError, setAccError] = useState<string | null>(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wiping, setWiping] = useState(false);

  const save = async () => {
    setError(null);
    const safetyParsed = parseZero(safety);
    if (!safetyParsed.ok) return setError(`安全储备：${safetyParsed.error}`);
    const budgetParsed = parseZero(budget);
    if (!budgetParsed.ok) return setError(`月消费预算：${budgetParsed.error}`);
    const capParsed = parseZero(savingsCap);
    if (!capParsed.ok) return setError(`月储蓄上限：${capParsed.error}`);
    const smallParsed = parseZero(smallThreshold);
    if (!smallParsed.ok) return setError(`小额阈值：${smallParsed.error}`);
    const day = Number(allocDay);
    if (!Number.isInteger(day) || day < 1 || day > 31) return setError('目标分配日需为 1-31');
    const sw = Number(smallWindow);
    if (!Number.isInteger(sw) || sw < 1 || sw > 365) return setError('小额统计窗口需为 1-365 天');
    const aw = Number(anomalyWindow);
    if (!Number.isInteger(aw) || aw < 7 || aw > 730) return setError('异常检测窗口需为 7-730 天');
    const as = Number(anomalySamples);
    if (!Number.isInteger(as) || as < 3 || as > 100) return setError('异常最少样本需为 3-100');
    const az = Number(anomalyZ);
    if (!Number.isFinite(az) || az < 1 || az > 20) return setError('稳健 Z 阈值需在 1-20 之间');
    const rt = Number(recurringTol);
    if (!Number.isInteger(rt) || rt < 1 || rt > 15) return setError('周期容差需为 1-15 天');
    const rc = Number(recurringCv);
    if (!Number.isFinite(rc) || rc <= 0 || rc > 100) return setError('金额波动上限需在 1%-100%');
    const covError = validateCoverage(coverage);
    if (covError) return setError(covError);
    if (coverage.some((c) => c.end >= today)) return setError('覆盖区间必须早于今天（只登记完整历史）');

    const ok = await apply(
      (d) => ({
        ...d,
        settings: {
          ...d.settings,
          safetyReserve: safetyParsed.cents,
          budget: { monthVariableBudget: budgetParsed.cents, monthlySavingsCap: capParsed.cents },
          smallThreshold: smallParsed.cents,
          smallWindowDays: sw,
          anomalyWindowDays: aw,
          anomalyMinSamples: as,
          anomalyRobustZ: az,
          recurringToleranceDays: rt,
          recurringMaxCv: rc / 100,
          goalAllocDay: day,
          coverage: coverage.map((c) => ({ ...c })).sort((a, b) => a.start.localeCompare(b.start)),
          quickInputEnabled: quickInput,
          settingsVersion: d.settings.settingsVersion + 1,
        },
      }),
      '设置已保存，新的预测与洞察将使用新参数',
    );
    if (ok) setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
  };

  const addCoverage = () => {
    setError(null);
    if (!newStart || !newEnd) return setError('请选择覆盖区间的开始与结束日期');
    if (newEnd >= today) return setError('覆盖区间结束日期必须早于今天');
    if (newStart > newEnd) return setError('覆盖区间开始日期不能晚于结束日期');
    const next = [...coverage, { start: newStart, end: newEnd }].sort((a, b) => a.start.localeCompare(b.start));
    const covError = validateCoverage(next);
    if (covError) return setError(covError);
    setCoverage(next);
  };

  const submitAccount = async () => {
    const balance = parseZero(accBalance);
    if (!balance.ok) return setAccError(balance.error);
    if (!accName.trim()) return setAccError('请填写账户名称');
    const ok = await addAccountAction({ name: accName.trim(), type: accType, openingBalance: balance.cents, openingDate: accDate });
    if (ok) {
      setAccountOpen(false);
      setAccName('');
      setAccBalance('');
      setAccError(null);
    }
  };

  const coveredDays = coverage.reduce((sum, c) => sum + Math.max(0, intervalDays(c)), 0);

  const wipeLocal = async () => {
    setWiping(true);
    try {
      await wipeAllLocalData();
      window.location.reload();
    } catch {
      setWiping(false);
      setError('清除失败，请检查浏览器存储权限');
      setWipeOpen(false);
    }
  };

  return (
    <div className="fade-in" data-testid="settings">
      <PageHeader
        title="设置"
        description="调整安全线、月预算、账户和检测参数，让预测与提醒更符合你的实际情况。参数会影响预测、异常检测、周期识别、目标分配与沙盘。所有金额以整数分存储。"
        actions={(
          <>
            {savedAt && <Badge tone="teal"><Check size={11} /> {savedAt} 已保存</Badge>}
            <Button variant="primary" onClick={() => void save()} data-testid="save-settings"><Save size={14} /> 保存设置</Button>
          </>
        )}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="现金流与预算" subtitle="安全储备参与风险判断，不参与余额计算" action={<ShieldCheck size={15} className="text-[#0B6357]" />}>
          <div className="space-y-3.5">
            <Field label="安全储备（元）" hint="预测余额低于该值时提示「低于安全线」。建议至少覆盖 1-2 个月固定支出。">
              <input className="input num" inputMode="decimal" value={safety} onChange={(e) => setSafety(e.target.value)} placeholder="0" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="每月可变消费预算（元）" hint="0 表示不设置，预测将改用星期中位数模型。">
                <input className="input num" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" />
              </Field>
              <Field label="每月储蓄上限（元）" hint="0 表示不限制目标分配上限。">
                <input className="input num" inputMode="decimal" value={savingsCap} onChange={(e) => setSavingsCap(e.target.value)} placeholder="0" />
              </Field>
            </div>
            <Field label="目标分配日（1-31）" hint="每月在该日附近获得一次储蓄分配机会；月末不足时按当月最后一天处理。">
              <input className="input num" type="number" min={1} max={31} value={allocDay} onChange={(e) => setAllocDay(e.target.value)} />
            </Field>
            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[#E4E0D8] bg-[#FCFBF8] px-3 py-2.5">
              <span>
                <span className="flex items-center gap-1.5 text-[12.5px] font-medium"><Sparkles size={13} className="text-[#B7791F]" /> 自然语言速记</span>
                <span className="mt-0.5 block text-[10.5px] leading-relaxed text-[#8A887F]">在记账页显示输入框，本地解析金额/商户/分类，确认后才写入。</span>
              </span>
              <input type="checkbox" checked={quickInput} onChange={(e) => setQuickInput(e.target.checked)} className="h-4 w-4 accent-[#0E7568]" />
            </label>
          </div>
        </Card>

        <Card title="账户" subtitle="账户期初 + 交易 = 余额；归档账户不影响历史">
          <ul className="space-y-2">
            {dataset.accounts.map((acc) => (
              <li key={acc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#EFECE6] px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#F4F1EA] text-[#0B6357]"><Landmark size={13} /></span>
                  <div>
                    <p className="text-[12px] font-medium">{acc.name} <span className="font-normal text-[#8A887F]">· {ACCOUNT_TYPE_LABEL[acc.type]}</span></p>
                    <p className="text-[10px] text-[#8A887F]">期初 {formatCN(acc.openingDate)} · {formatMoney(acc.openingBalance)}</p>
                  </div>
                </div>
                {acc.archived ? <Badge>已归档</Badge> : <Badge tone="teal">使用中</Badge>}
              </li>
            ))}
            {dataset.accounts.length === 0 && <p className="text-[12px] text-[#8A887F]">还没有账户，请先新增一个。</p>}
          </ul>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => { setAccError(null); setAccountOpen(true); }} data-testid="add-account"><Plus size={13} /> 新增账户</Button>
          <InfoNote>账户本身不支持归档操作入口；期初日期决定余额计算的起点，历史交易不会早于期初。</InfoNote>
        </Card>

        <Card title="历史覆盖区间" subtitle="只有登记为覆盖的日期才参与模型训练、异常与回测，避免把「没记账」误判为「没消费」" action={<CalendarRange size={15} className="text-[#0B6357]" />}>
          <div className="space-y-2">
            {coverage.map((c) => (
              <div key={`${c.start}:${c.end}`} className="flex items-center justify-between rounded-lg border border-[#EFECE6] px-3 py-2 text-[11.5px]">
                <span>{formatCN(c.start)} — {formatCN(c.end)} <span className="text-[#8A887F]">（{intervalDays(c)} 天）</span></span>
                <Button size="xs" variant="ghost" onClick={() => setCoverage(coverage.filter((x) => !(x.start === c.start && x.end === c.end)))}><Trash2 size={12} /></Button>
              </div>
            ))}
            {coverage.length === 0 && <p className="text-[12px] text-[#D97706]">尚未登记任何覆盖区间：预测将无法可靠训练可变消费模型。</p>}
          </div>
          <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <Field label="开始"><input className="input" type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} /></Field>
            <Field label="结束"><input className="input" type="date" max={addDaysISO(today, -1)} value={newEnd} onChange={(e) => setNewEnd(e.target.value)} /></Field>
            <Button variant="secondary" onClick={addCoverage}><Plus size={13} /> 添加</Button>
          </div>
          <p className="mt-2 text-[10.5px] text-[#8A887F]">合计覆盖 {coveredDays} 天 · 区间不可重叠、不可包含今天或未来 · 修改后需保存。</p>
        </Card>

        <Card title="小额消费聚合" subtitle="把高频小钱汇总起来看，避免「每笔都不贵」的错觉" action={<Info size={15} className="text-[#B7791F]" />}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="小额阈值（元）"><input className="input num" inputMode="decimal" value={smallThreshold} onChange={(e) => setSmallThreshold(e.target.value)} /></Field>
            <Field label="统计窗口（天）"><input className="input num" type="number" min={1} max={365} value={smallWindow} onChange={(e) => setSmallWindow(e.target.value)} /></Field>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-[#8A887F]">
            低于等于阈值的可变支出会被聚合，展示笔数、金额与占可变消费比例；不会修改或合并真实交易。
          </p>
        </Card>

        <Card title="异常消费检测" subtitle="基于同分类历史池的 MAD 稳健 Z 分数 + IQR 兜底">
          <div className="grid grid-cols-3 gap-3">
            <Field label="历史窗口（天）"><input className="input num" type="number" min={7} max={730} value={anomalyWindow} onChange={(e) => setAnomalyWindow(e.target.value)} /></Field>
            <Field label="最少样本"><input className="input num" type="number" min={3} max={100} value={anomalySamples} onChange={(e) => setAnomalySamples(e.target.value)} /></Field>
            <Field label="Z 阈值"><input className="input num" type="number" min={1} max={20} step={0.1} value={anomalyZ} onChange={(e) => setAnomalyZ(e.target.value)} /></Field>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-[#8A887F]">
            只使用该笔交易之前的历史，避免未来数据泄漏；样本不足时不出异常，宁缺毋滥。
          </p>
        </Card>

        <Card title="周期收支识别" subtitle="商户 + 金额稳定 + 间隔规律的候选计划">
          <div className="grid grid-cols-2 gap-3">
            <Field label="间隔容差（天）"><input className="input num" type="number" min={1} max={15} value={recurringTol} onChange={(e) => setRecurringTol(e.target.value)} /></Field>
            <Field label="金额波动上限（%）"><input className="input num" type="number" min={1} max={100} value={recurringCv} onChange={(e) => setRecurringCv(e.target.value)} /></Field>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-[#8A887F]">
            识别结果只作为候选出现在洞察页，确认前不会生成计划或自动记账。分数 = 0.45×间隔稳定 + 0.35×金额稳定 + 0.20×样本量。
          </p>
        </Card>

        <Card title="本机数据" subtitle="账户、账本与 AI 配置都只存在于当前浏览器" action={<Trash2 size={15} className="text-[#98362E]" />}>
          <p className="text-[11.5px] leading-relaxed text-[#6B6A63]">
            清除后会删除本机所有账户、账本、目标与 AI 接口配置，并回到登录页；此操作无法撤销，请先到数据中心导出备份。
          </p>
          <Button variant="danger" size="sm" className="mt-3" onClick={() => setWipeOpen(true)} data-testid="wipe-local-data">
            <Trash2 size={13} /> 清除本机全部数据
          </Button>
        </Card>

        <Card title="关于与数据原则" subtitle="MoneyFlow 钱流 · 本地优先的个人现金流工作台" action={<Settings2 size={15} className="text-[#8A887F]" />}>
          <ul className="space-y-2 text-[11.5px] leading-relaxed text-[#6B6A63]">
            <li>版本 1.0.0 · 数据格式 v1 · 设置版本 v{s.settingsVersion}</li>
            <li>所有数据存于浏览器 IndexedDB，不上传；备份文件由你自行保管。</li>
            <li>金额一律整数分；日期一律本地 YYYY-MM-DD，避免时区漂移。</li>
            <li>预测快照不可修改，用于事后校准与滚动回测；校准只影响未来预测。</li>
            <li>退出登录不会删除本机数据；彻底重置请使用下方「清除本机全部数据」。</li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge tone="teal">React 19</Badge>
            <Badge tone="teal">TypeScript</Badge>
            <Badge tone="teal">IndexedDB</Badge>
            <Badge tone="teal">ECharts</Badge>
            <Badge tone="teal">无云端</Badge>
          </div>
          <InfoNote>
            设置保存后会立即影响预测与洞察，但不会篡改历史交易或已保存的预测快照；旧快照仍以生成时参数为准。
          </InfoNote>
        </Card>
      </div>

      {error && <p className="mt-4 rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]">{error}</p>}

      <div className="mt-4 flex justify-end">
        <Button variant="primary" onClick={() => void save()} data-testid="save-settings-bottom"><Save size={14} /> 保存全部设置</Button>
      </div>

      <Modal
        open={accountOpen}
        title="新增账户"
        onClose={() => setAccountOpen(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setAccountOpen(false)}>取消</Button>
            <Button variant="primary" onClick={() => void submitAccount()} data-testid="confirm-add-account">添加账户</Button>
          </>
        )}
      >
        <div className="space-y-3.5">
          <Field label="账户名称"><input className="input" value={accName} maxLength={20} onChange={(e) => setAccName(e.target.value)} placeholder="例如：工资卡" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="类型">
              <select className="select" value={accType} onChange={(e) => setAccType(e.target.value as AccountType)}>
                {(['savings', 'cash', 'ewallet'] as AccountType[]).map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field label="期初余额（元）"><input className="input num" inputMode="decimal" value={accBalance} onChange={(e) => setAccBalance(e.target.value)} placeholder="0" /></Field>
          </div>
          <Field label="期初日期"><input className="input" type="date" max={today} value={accDate} onChange={(e) => setAccDate(e.target.value)} /></Field>
          <p className={cn('text-[10.5px] text-[#8A887F]')}>新增账户后可直接在记账页选择它；期初余额会立即计入总余额。</p>
          {accError && <p className="rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]">{accError}</p>}
        </div>
      </Modal>

      <Modal
        open={wipeOpen}
        title="清除本机全部数据？"
        subtitle="所有账户、账本、目标与 AI 配置都会被永久删除。"
        onClose={() => setWipeOpen(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setWipeOpen(false)} disabled={wiping}>取消</Button>
            <Button variant="danger" onClick={() => void wipeLocal()} disabled={wiping} data-testid="confirm-wipe-local-data">
              {wiping ? '正在清除…' : '确认清除'}
            </Button>
          </>
        )}
      >
        <p className="text-[12px] leading-relaxed text-[#6B6A63]">
          清除后会回到登录页，需要重新注册账户。如果还需要这些数据，请先取消并到「数据中心」导出 JSON 备份。
        </p>
      </Modal>
    </div>
  );
}