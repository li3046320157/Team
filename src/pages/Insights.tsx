import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, CalendarClock, CircleHelp, Coffee, EyeOff, Info, Repeat2, ShieldAlert, Sparkles, TrendingUp } from 'lucide-react';
import type { RecurringCandidate } from '../domain/types';
import { useAppStore } from '../store/useAppStore';
import { todayISO } from '../domain/days';
import { detectRecurringCandidates } from '../domain/insights/recurring';
import { detectAnomalies } from '../domain/insights/anomaly';
import { detectSmallSpending } from '../domain/insights/small';
import { confirmCandidate, setCandidateStatus, setReview } from '../services/mutations';
import { Badge, Button, Card, EmptyState, Field, Modal, Money, PageHeader, cn } from '../components/ui';
import { formatCN } from '../domain/days';
import { frequencyLabel, pct } from '../lib/ui';

export function InsightsPage() {
  const dataset = useAppStore((s) => s.dataset)!;
  const apply = useAppStore((s) => s.apply);
  const today = todayISO();
  const [confirming, setConfirming] = useState<RecurringCandidate | null>(null);

  const candidates = useMemo(
    () => detectRecurringCandidates({ transactions: dataset.transactions, asOfDate: today, settings: dataset.settings, flows: dataset.flows, previous: dataset.candidates }),
    [dataset, today],
  );
  const anomalies = useMemo(
    () => detectAnomalies({ transactions: dataset.transactions, categories: dataset.categories, asOfDate: today, settings: dataset.settings, reviews: dataset.reviews }),
    [dataset, today],
  );
  const small = useMemo(
    () => detectSmallSpending({
      transactions: dataset.transactions,
      asOfDate: today,
      threshold: dataset.settings.smallThreshold,
      windowDays: dataset.settings.smallWindowDays,
      categories: dataset.categories,
    }),
    [dataset, today],
  );

  const openCandidates = candidates.filter((c) => c.status === 'open');
  const reviewed = candidates.filter((c) => c.status !== 'open');
  const openAnomalies = anomalies.insights.filter((i) => !i.review || i.review.status === 'open');
  const handledAnomalies = anomalies.insights.filter((i) => i.review && i.review.status !== 'open');

  return (
    <div className="fade-in" data-testid="insights">
      <PageHeader
        title="洞察"
        description="自动帮你发现异常大额消费、疑似周期性订阅与小额高频支出，每条都附证据。周期识别是规则匹配程度而非概率；异常检测只用当天之前的历史。"
        actions={<Badge tone="teal"><Sparkles size={11} /> 本地计算</Badge>}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="周期支出候选"
          subtitle="同商户、金额稳定、间隔接近周/月/年；确认后才创建计划"
          action={<Badge tone={openCandidates.length ? 'amber' : 'teal'}>{openCandidates.length} 个待确认</Badge>}
        >
          {openCandidates.length === 0 ? (
            <EmptyState
              title="没有新的周期候选"
              description={dataset.transactions.length < 30 ? '至少需要约 3 次同商户消费才能判断。' : '现有候选已处理，或近期消费间隔不稳定。'}
            />
          ) : (
            <ul className="space-y-3">
              {openCandidates.slice(0, 6).map((c) => (
                <li key={c.id} className="rounded-xl border border-[#EFECE6] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg bg-[#E3F1ED] text-[#0B6357]"><Repeat2 size={15} /></span>
                      <div>
                        <p className="text-[13px] font-semibold">{c.merchantLabel}</p>
                        <p className="text-[11px] text-[#8A887F]">{frequencyLabel(c.unit, c.interval)} · 约 <Money cents={c.estimatedAmount} /> · 下次 {formatCN(c.nextDate)}</p>
                      </div>
                    </div>
                    <Badge tone="white">匹配度 {pct(c.score)}</Badge>
                  </div>
                  <div className="mt-2.5 grid grid-cols-3 gap-2 rounded-lg bg-[#FAF8F3] px-2.5 py-2 text-[10.5px] text-[#6B6A63]">
                    <span>间隔 {pct(c.scoreParts.interval)}</span>
                    <span>金额 {pct(c.scoreParts.amount)}</span>
                    <span>样本 {pct(c.scoreParts.sample)}</span>
                  </div>
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-[#A3A097]">
                    最近一次 {formatCN(c.lastDate)} · 金额波动 {pct(c.amountCv, 1)} · 样本 {c.sampleIds.length} 笔
                  </p>
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <Button size="xs" variant="ghost" onClick={() => void apply((d) => setCandidateStatus(d, c.id, 'ignored'), '已忽略该候选')}>
                      <EyeOff size={11} /> 忽略
                    </Button>
                    <Button size="xs" variant="primary" onClick={() => setConfirming(c)}>
                      <BadgeCheck size={12} /> 确认为计划
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="异常消费"
          subtitle="MAD 稳健 Z 为主，MAD=0 时退回 IQR 或倍数规则；只用该笔之前的历史"
          action={<Badge tone={openAnomalies.length ? 'amber' : 'teal'}>{openAnomalies.length} 条待复核</Badge>}
        >
          {openAnomalies.length === 0 ? (
            <EmptyState
              title="最近 60 天没有待复核异常"
              description={anomalies.insufficient > 0 ? `有 ${anomalies.insufficient} 笔因同类历史不足而跳过，不硬判异常。` : '支出金额与历史分布接近，或异常已全部复核。'}
            />
          ) : (
            <ul className="space-y-3">
              {openAnomalies.slice(0, 5).map((a) => (
                <li key={a.txId} className="rounded-xl border border-[#EEDCB9] bg-[#FDFAF3] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[13px] font-semibold">{a.merchant || a.categoryName || '一笔支出'}</p>
                      <p className="text-[11px] text-[#8A887F]">{formatCN(a.date)} · {a.categoryName ?? '未分类'} · <Money cents={a.amount} className="font-semibold" /></p>
                    </div>
                    <Badge tone="amber"><ShieldAlert size={11} /> 异常</Badge>
                  </div>
                  <div className="mt-2 rounded-lg bg-white/70 px-2.5 py-2 text-[10.5px] leading-relaxed text-[#6B6A63]">
                    <p>同类历史中位数 <Money cents={a.median} />，MAD <Money cents={a.mad} />，IQR <Money cents={a.iqr} />。</p>
                    <p>
                      规则：{a.rule === 'mad' ? `稳健 Z = ${a.robustZ ?? '-'}（阈值 ${dataset.settings.anomalyRobustZ}）` : a.rule === 'iqr' ? 'IQR 上界规则' : '中位数 3 倍且高出 100 元'} · 参照样本 {a.poolSize} 笔
                    </p>
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <Button size="xs" variant="ghost" onClick={() => void apply((d) => setReview(d, a.txId, 'ignored'), '已忽略该异常提醒')}>忽略</Button>
                    <Button size="xs" variant="secondary" onClick={() => void apply((d) => setReview(d, a.txId, 'confirmed'), '已确认异常，仅做标记')}>确认异常</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {handledAnomalies.length > 0 && (
            <p className="mt-3 text-[10.5px] text-[#A3A097]">已有 {handledAnomalies.length} 条异常被复核（确认或忽略），不会重复提醒。</p>
          )}
        </Card>

        <Card
          title="高频小额"
          subtitle={`最近 ${small.windowDays} 天，单笔不超过 ¥${(small.threshold / 100).toFixed(0)} 的消费聚合`}
          action={<Badge tone={small.reminder ? 'amber' : 'teal'}>{small.count} 笔</Badge>}
        >
          {small.count === 0 ? (
            <EmptyState title="这段时间没有小额消费" description="把阈值调低，或先记录几笔真实流水。" />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-[#FAF8F3] px-3 py-3 text-center">
                <div><p className="text-[10.5px] text-[#8A887F]">合计</p><p className="num mt-1 text-[16px] font-semibold"><Money cents={small.total} /></p></div>
                <div><p className="text-[10.5px] text-[#8A887F]">笔数</p><p className="num mt-1 text-[16px] font-semibold">{small.count}</p></div>
                <div><p className="text-[10.5px] text-[#8A887F]">占期初</p><p className="num mt-1 text-[16px] font-semibold">{small.total >= 0 ? '' : ''}{dataset.accounts.length ? pct(small.total / Math.max(1, dataset.accounts.reduce((a, acc) => a + acc.openingBalance, 0)), 1) : '—'}</p></div>
              </div>
              <ul className="mt-3 space-y-2">
                {small.byMerchant.slice(0, 5).map((g) => (
                  <li key={g.key} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="flex min-w-0 items-center gap-2"><Coffee size={13} className="shrink-0 text-[#8A887F]" /><span className="truncate">{g.label}</span></span>
                    <span className="num shrink-0 text-[#6B6A63]">{g.count} 笔 · 每周 {g.perWeek} 次 · <Money cents={g.total} /></span>
                  </li>
                ))}
              </ul>
              {small.reminder && (
                <div className="mt-3 rounded-lg bg-[#FBF4E4] px-3 py-2 text-[11px] leading-relaxed text-[#7A5517]">
                  小额消费已出现 {small.count} 笔，合计 <Money cents={small.total} />。金额不大但频率高，建议在预测中按真实频率估计。
                </div>
              )}
            </>
          )}
        </Card>

        <Card title="已处理与口径" subtitle="不强行制造“洞察”">
          <div className="space-y-3 text-[11.5px] leading-relaxed text-[#6B6A63]">
            <div className="flex items-start gap-2 rounded-lg bg-[#FAF8F3] px-3 py-2.5">
              <CircleHelp size={14} className="mt-0.5 shrink-0" />
              <span>异常检测不把「金额小」当异常，也不把新商户的首笔大额直接判定为异常；样本不足会明确跳过。</span>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-[#FAF8F3] px-3 py-2.5">
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>周期识别只使用未核销、非一次性的支出；核销流水已由计划表示，不重复建议。</span>
            </div>
            {reviewed.length > 0 && (
              <div>
                <p className="mb-1.5 font-semibold text-[#3A3D37]">已处理候选</p>
                <ul className="space-y-1.5">
                  {reviewed.slice(-4).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{c.merchantLabel} · {frequencyLabel(c.unit, c.interval)}</span>
                      <Badge tone={c.status === 'confirmed' ? 'teal' : 'gray'}>{c.status === 'confirmed' ? '已建计划' : '已忽略'}</Badge>
                    </li>
                  ))}
                </ul>
                {reviewed.some((c) => c.status === 'confirmed') && (
                  <Link to="/schedules" className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#0B6357] hover:underline">
                    <CalendarClock size={12} /> 去计划页查看
                  </Link>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      <ConfirmCandidateModal candidate={confirming} onClose={() => setConfirming(null)} />
    </div>
  );
}

function ConfirmCandidateModal({ candidate, onClose }: { candidate: RecurringCandidate | null; onClose: () => void }) {
  const dataset = useAppStore((s) => s.dataset)!;
  const apply = useAppStore((s) => s.apply);
  const [accountId, setAccountId] = useState(dataset.accounts[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState(dataset.categories.find((c) => c.kind === 'expense')?.id ?? '');
  const [amount, setAmount] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [lastId, setLastId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (candidate && lastId !== candidate.id) {
    setLastId(candidate.id);
    setAmount((candidate.estimatedAmount / 100).toFixed(2).replace(/\.00$/, ''));
    setNextDate(candidate.nextDate);
    setAccountId(dataset.accounts[0]?.id ?? '');
    setError(null);
  }

  const submit = async () => {
    if (!candidate) return;
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0 || !Number.isInteger(cents)) return setError('金额无效');
    if (!categoryId) return setError('请选择分类');
    const ok = await apply(
      (d) => confirmCandidate(d, candidate, { accountId, categoryId, amount: cents, nextDate }),
      '已创建计划，后续可在此计划下核销',
    );
    if (ok) onClose();
    else setError('创建失败，请稍后重试');
  };

  return (
    <Modal
      open={Boolean(candidate)}
      title="确认为固定计划"
      subtitle="确认后会创建一条固定支出计划，并停止对同一商户继续提醒。"
      onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" onClick={() => void submit()}>创建计划</Button></>}
    >
      {candidate && (
        <div className="space-y-3.5">
          <div className="rounded-lg bg-[#FAF8F3] px-3 py-2.5 text-[12px]">
            <span className="font-semibold">{candidate.merchantLabel}</span>
            <span className="ml-2 text-[#6B6A63]">{frequencyLabel(candidate.unit, candidate.interval)} · 证据 {candidate.sampleIds.length} 笔</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="账户">
              <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {dataset.accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="分类">
              <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {dataset.categories.filter((c) => c.kind === 'expense').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="每期金额（元）"><input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="下一期日期"><input className="input" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} /></Field>
          </div>
          {error && <p className="text-[12px] text-[#98362E]">{error}</p>}
          <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-[#8A887F]"><TrendingUp size={12} className="mt-0.5 shrink-0" /> 预测只会在核销后计入真实流水；未核销期次仍按计划推导。</p>
        </div>
      )}
    </Modal>
  );
}