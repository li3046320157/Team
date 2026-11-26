import { useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ChangeEvent } from 'react';
import { BrainCircuit, Download, FileJson, FileSpreadsheet, FlaskConical, HardDriveDownload, History, RotateCcw, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { formatCN, todayISO } from '../domain/days';
import { formatMoney } from '../domain/money';
import { createBackup, validateBackupText, type BackupValidation } from '../domain/backup';
import { downloadTextFile, transactionsToCSV } from '../domain/csv';
import { parseBillCsv, type BillFormat, type ParsedBill } from '../domain/billCsv';
import { buildImportPlan, type DuplicatePolicy, type ImportPlan } from '../domain/importPlan';
import { importBills } from '../services/bills';
import { resetCalibration, recentSnapshots, runBacktest } from '../services/snapshots';
import type { BacktestResult } from '../domain/calibration';
import { Badge, Button, Card, Field, InfoNote, Modal, Money, PageHeader, Segmented, StatCard, cn } from '../components/ui';
import { weekdayCN } from '../lib/ui';

const FORMAT_LABEL: Record<BillFormat, string> = {
  moneyflow: 'MoneyFlow',
  alipay: '支付宝',
  wechat: '微信',
  generic: '银行通用',
};

export function DataCenterPage() {
  const mode = useAppStore((s) => s.mode);
  const dataset = useAppStore((s) => s.dataset)!;
  const replaceDataset = useAppStore((s) => s.replaceDataset);
  const resetMode = useAppStore((s) => s.resetMode);
  const enterDemo = useAppStore((s) => s.enterDemo);
  const exitDemo = useAppStore((s) => s.exitDemo);
  const regenerateDemo = useAppStore((s) => s.regenerateDemo);
  const runCalibration = useAppStore((s) => s.runCalibration);
  const makeSnapshot = useAppStore((s) => s.makeSnapshot);
  const applyState = useAppStore((s) => s.apply);
  const notify = useAppStore((s) => s.notify);
  const today = todayISO();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<BackupValidation | null>(null);
  const [importName, setImportName] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [backtest, setBacktest] = useState<{ result: BacktestResult; at: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmCalReset, setConfirmCalReset] = useState(false);
  const [confirmDemoRestore, setConfirmDemoRestore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const billFileRef = useRef<HTMLInputElement>(null);
  const [billFileName, setBillFileName] = useState('');
  const [parsedBill, setParsedBill] = useState<ParsedBill | null>(null);
  const [billError, setBillError] = useState<string | null>(null);
  const [billImportedNote, setBillImportedNote] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [duplicatePolicy, setDuplicatePolicy] = useState<DuplicatePolicy>('skip');
  const expenseCats = dataset.categories.filter((c) => c.kind === 'expense' && !c.archived);
  const incomeCats = dataset.categories.filter((c) => c.kind === 'income' && !c.archived);
  const [targetAccountId, setTargetAccountId] = useState(() => dataset.accounts.find((a) => !a.archived)?.id ?? '');
  const [defaultExpenseCategoryId, setDefaultExpenseCategoryId] = useState(() => expenseCats.find((c) => c.id === 'cat_other_exp')?.id ?? expenseCats[0]?.id ?? '');
  const [defaultIncomeCategoryId, setDefaultIncomeCategoryId] = useState(() => incomeCats.find((c) => c.id === 'cat_other_inc')?.id ?? incomeCats[0]?.id ?? '');

  const plan = useMemo<ImportPlan | null>(() => {
    if (!parsedBill) return null;
    const account = dataset.accounts.find((a) => a.id === targetAccountId);
    if (!account) return null;
    return buildImportPlan({
      parsed: parsedBill,
      existing: dataset.transactions,
      categories: dataset.categories,
      account,
      today,
      defaultExpenseCategoryId,
      defaultIncomeCategoryId,
      duplicatePolicy,
      categoryOverrides: overrides,
    });
  }, [parsedBill, dataset, targetAccountId, defaultExpenseCategoryId, defaultIncomeCategoryId, duplicatePolicy, overrides, today]);

  const snapshots = useMemo(() => recentSnapshots(dataset, 10), [dataset]);
  const gapCount = dataset.settings.coverage.length;
  const calibrations = [...dataset.calibrations].sort((a, b) => b.evaluatedDate.localeCompare(a.evaluatedDate)).slice(0, 10);
  const activeCal = dataset.calibrations.filter((c) => !c.invalidated).length;

  const exportBackup = () => {
    const content = createBackup(dataset);
    downloadTextFile(`moneyflow-backup-${today}.json`, content, 'application/json;charset=utf-8');
    notify('备份文件已开始下载，请妥善保存', 'success');
  };

  const exportCSV = () => {
    const content = transactionsToCSV(dataset);
    downloadTextFile(`moneyflow-transactions-${today}.csv`, content, 'text/csv;charset=utf-8');
    notify(`已导出 ${dataset.transactions.length} 笔交易`, 'success');
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError(null);
    setImportResult(null);
    if (file.size > 20 * 1024 * 1024) {
      setImportError('文件超过 20MB 限制');
      return;
    }
    try {
      const text = await file.text();
      const result = validateBackupText(text, mode);
      setImportName(file.name);
      setImportResult(result);
    } catch {
      setImportError('读取文件失败，请确认文件可访问');
    }
  };

  const restore = async () => {
    if (!importResult?.ok || !importResult.dataset) return;
    setBusy('restore');
    const restored = {
      ...importResult.dataset,
      meta: { ...importResult.dataset.meta, kind: 'personal' as const, demoDate: undefined, restoredAt: new Date().toISOString() },
    };
    try {
      const ok = await replaceDataset(restored, '备份已恢复（覆盖了当前数据集）');
      if (ok) {
        setImportResult(null);
        setImportName('');
        setBacktest(null);
        setConfirmDemoRestore(false);
      }
    } finally {
      setBusy(null);
    }
  };

  const doBacktest = () => {
    setBusy('backtest');
    try {
      const result = runBacktest(dataset, today);
      setBacktest({ result, at: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) });
      if (!result.sufficient) notify(result.reason ?? '历史覆盖不足，回测仅作参考', 'info');
    } catch (error) {
      notify(error instanceof Error ? error.message : '回测失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const resetBill = () => {
    setParsedBill(null);
    setBillFileName('');
    setBillError(null);
    setBillImportedNote(false);
    setShowPreview(false);
    setOverrides({});
    setDuplicatePolicy('skip');
  };

  const onBillFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBillError(null);
    setBillImportedNote(false);
    setShowPreview(false);
    setOverrides({});
    setParsedBill(null);
    setBillFileName('');
    if (file.size > 10 * 1024 * 1024) {
      setBillError('文件超过 10MB 限制');
      return;
    }
    try {
      const parsed = parseBillCsv(await file.arrayBuffer());
      if (parsed.rows.length === 0) {
        setBillError('没有解析到任何数据行：请确认文件包含「交易时间/日期」与「金额」列');
        return;
      }
      if (parsed.rows.length > 5000) {
        setBillError(`账单共 ${parsed.rows.length} 行，超过 5000 行上限；请拆分文件后分批导入`);
        return;
      }
      setBillFileName(file.name);
      setParsedBill(parsed);
    } catch {
      setBillError('读取文件失败，请确认文件可访问');
    }
  };

  const doImportBills = async () => {
    if (!plan || plan.summary.newCount === 0) return;
    setBusy('bill');
    setBillError(null);
    try {
      // 先本地预校验拿到中文错误就地显示；apply 内部的失败只会走全局 toast
      importBills(dataset, plan.rows, today);
    } catch (error) {
      setBillError(error instanceof Error ? error.message : '导入校验失败');
      setBusy(null);
      return;
    }
    try {
      const ok = await applyState(
        (d) => importBills(d, plan.rows, today),
        `已导入 ${plan.summary.newCount} 笔，跳过 ${plan.summary.skippedCount} 笔`,
      );
      if (ok) {
        setParsedBill(null);
        setBillFileName('');
        setShowPreview(false);
        setOverrides({});
        setBillImportedNote(true);
      }
    } finally {
      setBusy(null);
    }
  };

  const doCalibration = async () => {
    setBusy('calibrate');
    try {
      const outcome = await runCalibration();
      if (outcome) setBacktest(null);
    } finally {
      setBusy(null);
    }
  };

  const resetCal = async () => {
    await applyState((d) => resetCalibration(d), '校准状态已重置，历史校准记录已标记失效');
    setConfirmCalReset(false);
  };

  const doReset = async () => {
    setBusy('reset');
    try {
      await resetMode(mode);
      setImportResult(null);
      setBacktest(null);
    } finally {
      setBusy(null);
      setConfirmReset(false);
    }
  };

  const lastSnapshot = snapshots[0];
  const lastBalance = lastSnapshot?.days[lastSnapshot.days.length - 1]?.balance;
  const isDemoBackup = importResult?.ok && importResult.dataset?.meta.kind === 'demo';

  return (
    <div className="fade-in" data-testid="data-center">
      <PageHeader
        title="数据中心"
        description="备份与恢复你的账本、导出 CSV、回看预测快照与校准记录。换电脑或清理浏览器前请先导出备份。所有数据只保存在当前浏览器的 IndexedDB 中，不上传服务器。"
        actions={(
          <>
            <Button variant="secondary" onClick={exportBackup} data-testid="export-backup"><Download size={14} /> 备份 JSON</Button>
            <Button variant="primary" onClick={exportCSV} data-testid="export-csv"><FileSpreadsheet size={14} /> 导出 CSV</Button>
          </>
        )}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="账户 / 交易" value={`${dataset.accounts.length} / ${dataset.transactions.length}`} />
        <StatCard label="计划 / 目标 / 方案" value={`${dataset.flows.length} / ${dataset.goals.length} / ${dataset.plans.length}`} />
        <StatCard label="预测快照" value={dataset.snapshots.length} hint={lastBalance !== undefined ? `最近期末余额 ${formatMoney(lastBalance)}` : undefined} />
        <StatCard label="校准记录（有效）" value={activeCal} hint={gapCount === 0 ? '未登记历史覆盖区间' : `${gapCount} 个覆盖区间`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="rise" style={{ '--i': 0 } as CSSProperties} title="JSON 完整备份" subtitle="包含账本、计划、目标、快照与校准；恢复会覆盖当前数据集">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={exportBackup}><Download size={14} /> 下载备份</Button>
            <Button variant="secondary" onClick={() => fileRef.current?.click()} data-testid="import-backup"><Upload size={14} /> 选择备份文件</Button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void onFile(e)} />
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-[#8A887F]">
            先在本机校验结构、金额与引用完整性，再显示预览；校验失败不会写入任何内容。
          </p>

          {importError && <p className="mt-3 rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]">{importError}</p>}

          {importResult && (
            <div className="mt-3 rounded-xl border border-[#EFECE6] p-3 fade-swap" data-testid="import-preview">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[12px] font-medium"><FileJson size={12} className="mr-1 inline" />{importName || '备份文件'}</p>
                {importResult.ok ? <Badge tone="teal">校验通过</Badge> : <Badge tone="danger">校验失败</Badge>}
              </div>
              {importResult.preview && (
                <div className="mt-2 grid grid-cols-3 gap-2 text-[10.5px] text-[#6B6A63]">
                  <p>账户：{importResult.preview.accounts}</p>
                  <p>交易：{importResult.preview.transactions}</p>
                  <p>计划：{importResult.preview.flows}</p>
                  <p>目标：{importResult.preview.goals}</p>
                  <p>快照：{importResult.preview.snapshots}</p>
                  <p className="col-span-3">
                    日期范围：{importResult.preview.startDate ? `${formatCN(importResult.preview.startDate)} — ${formatCN(importResult.preview.endDate!)}` : '无交易'}
                  </p>
                </div>
              )}
              {importResult.warnings.map((w) => <p key={w} className="mt-1 text-[10.5px] text-[#8A5A13]">{w}</p>)}
              {importResult.errors.length > 0 && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[10.5px] text-[#98362E]">
                  {importResult.errors.map((e) => <li key={e}>· {e}</li>)}
                </ul>
              )}
              {importResult.ok && isDemoBackup && (
                <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-[#FBF3E3] px-2.5 py-2 text-[10.5px] leading-relaxed text-[#8A5A16]">
                  <ShieldAlert size={12} className="mt-0.5 shrink-0" />
                  这份备份来自示例数据，恢复后会被标记为个人账本
                </p>
              )}
              {importResult.ok && (
                <Button
                  variant="danger"
                  size="sm"
                  className="mt-2"
                  disabled={busy === 'restore'}
                  onClick={() => (isDemoBackup ? setConfirmDemoRestore(true) : void restore())}
                  data-testid="confirm-restore"
                >
                  <HardDriveDownload size={13} />
                  覆盖当前数据集
                </Button>
              )}
            </div>
          )}

          <InfoNote>
            不要把真实账单、密钥或含个人隐私的备份提交到公开仓库。建议把备份存放在你自己的加密存储中。
          </InfoNote>
        </Card>

        <div data-testid="bill-import">
          <Card className="rise" style={{ '--i': 1 } as CSSProperties} title="账单导入" subtitle="支付宝 / 微信 / 银行 CSV；先解析去重预览，确认后一次写入">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => billFileRef.current?.click()}><Upload size={14} /> 选择账单 CSV</Button>
              <input ref={billFileRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="import-bill-file" onChange={(e) => void onBillFile(e)} />
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-[#8A887F]">
              支持支付宝/微信/银行导出的 CSV（GBK 或 UTF-8 均可），也支持本应用导出的 CSV 原样导回。
            </p>

            {billError && <p className="mt-3 rounded-lg bg-[#FCF1EF] px-3 py-2 text-[12px] text-[#98362E]" data-testid="bill-import-error">{billError}</p>}

            {parsedBill && (
              <div className="mt-3 rounded-xl border border-[#EFECE6] p-3 fade-swap" data-testid="bill-mapping">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[12px] font-medium">{billFileName || '账单文件'}</p>
                  <Badge tone="teal">{FORMAT_LABEL[parsedBill.format]}</Badge>
                </div>
                <p className="mt-1 text-[10.5px] text-[#6B6A63]">
                  编码 {parsedBill.encoding === 'gbk' ? 'GBK' : 'UTF-8'} · {parsedBill.rows.length} 行数据 · 表头第 {parsedBill.headerLine + 1} 行
                </p>
                {parsedBill.warnings.map((w) => <p key={w} className="mt-1 text-[10.5px] leading-relaxed text-[#8A5A13]">{w}</p>)}

                <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                  <Field label="目标账户">
                    <select className="input" value={targetAccountId} onChange={(e) => setTargetAccountId(e.target.value)} data-testid="bill-account">
                      {dataset.accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </Field>
                  <Field label="重复策略">
                    <Segmented
                      value={duplicatePolicy}
                      onChange={setDuplicatePolicy}
                      size="sm"
                      options={[{ value: 'skip', label: '跳过重复' }, { value: 'keep', label: '仍然导入' }]}
                    />
                  </Field>
                  <Field label="支出默认分类">
                    <select className="input" value={defaultExpenseCategoryId} onChange={(e) => setDefaultExpenseCategoryId(e.target.value)}>
                      {expenseCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label="收入默认分类">
                    <select className="input" value={defaultIncomeCategoryId} onChange={(e) => setDefaultIncomeCategoryId(e.target.value)}>
                      {incomeCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" onClick={() => setShowPreview(true)} disabled={!plan} data-testid="bill-build-plan">生成预览</Button>
                  <Button variant="ghost" size="sm" onClick={resetBill}>取消</Button>
                </div>
                {!plan && dataset.accounts.length === 0 && (
                  <p className="mt-2 text-[10.5px] text-[#8A5A13]">还没有可用账户，请先到「账户」页面创建账户。</p>
                )}
              </div>
            )}

            {plan && showPreview && (
              <div className="mt-3 rounded-xl border border-[#EFECE6] p-3 fade-swap" data-testid="bill-preview">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-semibold">导入预览</p>
                  <Button variant="ghost" size="sm" onClick={() => setShowPreview(false)}>收起</Button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone="teal">新增 {plan.summary.newCount} 笔</Badge>
                  <Badge tone="amber">重复 {plan.summary.duplicateCount} 笔</Badge>
                  <Badge tone="gray">跳过 {plan.summary.skippedCount} 笔</Badge>
                </div>
                <p className="mt-1.5 text-[11px] text-[#6B6A63]">
                  收入 {formatMoney(plan.summary.income)} · 支出 {formatMoney(plan.summary.expense)}
                  {plan.summary.dateRange && <> · {formatCN(plan.summary.dateRange.start)} — {formatCN(plan.summary.dateRange.end)}</>}
                </p>

                <div className="mt-2 max-h-72 overflow-auto">
                  <table className="data">
                    <thead>
                      <tr><th>日期</th><th>收/支</th><th className="text-right">金额</th><th>商户</th><th>分类</th><th>状态</th></tr>
                    </thead>
                    <tbody>
                      {plan.rows.slice(0, 50).map((row) => {
                        const cats = row.kind === 'income' ? incomeCats : expenseCats;
                        const skipped = row.status === 'skipped';
                        return (
                          <tr key={row.draftId} className={cn(row.status === 'duplicate' && 'opacity-70')}>
                            <td className="whitespace-nowrap">{formatCN(row.date)}</td>
                            <td className="whitespace-nowrap">{row.kind === 'income' ? '收入' : '支出'}</td>
                            <td className="num whitespace-nowrap text-right">{formatMoney(row.amount)}</td>
                            <td className="max-w-[9rem] truncate">{row.merchant || '—'}</td>
                            <td>
                              <select
                                className="input !py-0.5 text-[11px]"
                                value={row.categoryId ?? ''}
                                disabled={skipped}
                                onChange={(e) => setOverrides((prev) => ({ ...prev, [row.draftId]: e.target.value }))}
                              >
                                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            </td>
                            <td className="whitespace-nowrap">
                              {row.status === 'new' && !row.reason && <Badge tone="teal">新增</Badge>}
                              {row.status === 'new' && row.reason && <Badge tone="amber">重复</Badge>}
                              {row.status === 'duplicate' && <Badge tone="amber">重复</Badge>}
                              {skipped && (
                                <span className="inline-flex items-center gap-1">
                                  <Badge tone="gray">跳过</Badge>
                                  {row.reason && <span className="text-[9.5px] text-[#8A887F]">{row.reason}</span>}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {plan.rows.length > 50 && <p className="mt-1 text-[10.5px] text-[#8A887F]">还有 {plan.rows.length - 50} 行未展示</p>}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" disabled={plan.summary.newCount === 0 || busy === 'bill'} onClick={() => void doImportBills()} data-testid="bill-import-confirm">
                    {busy === 'bill' ? '导入中…' : `导入 ${plan.summary.newCount} 笔`}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={resetBill}>取消</Button>
                </div>
              </div>
            )}

            {billImportedNote && (
              <InfoNote>
                覆盖区间未包含这些日期时，预测不会把它们算进训练集——到「设置 → 历史覆盖区间」补齐。
              </InfoNote>
            )}
          </Card>
        </div>

        <Card className="rise" style={{ '--i': 2 } as CSSProperties} title="CSV 交易导出" subtitle="UTF-8 BOM，Excel 可直接打开；以 = + - @ 开头的文本会加前缀防公式注入">
          <div className="rounded-lg border border-dashed border-[#DED9CF] px-3 py-4 text-center">
            <FileSpreadsheet size={22} className="mx-auto text-[var(--accent-ink)]" />
            <p className="mt-1.5 text-[12px] font-medium">{dataset.transactions.length} 笔交易</p>
            <p className="text-[10.5px] text-[#8A887F]">列：日期 / 类型 / 金额 / 账户 / 分类 / 商户 / 备注 / 关联</p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={exportCSV}><Download size={13} /> 下载 CSV</Button>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-[#8A887F]">
            支持把账单 CSV 导回账本（见上方「账单导入」卡片），导入前会先在本地预览校验，确认后才写入。
          </p>
        </Card>

        <Card className="rise" style={{ '--i': 3 } as CSSProperties} title="预测快照与校准" subtitle={lastSnapshot ? `最近快照：${formatCN(lastSnapshot.asOfDate)} · ${lastSnapshot.auto ? '每日自动' : '手动'} · ${lastSnapshot.horizonDays} 天` : '还没有快照'}>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void makeSnapshot()} data-testid="manual-snapshot"><History size={13} /> 保存手动快照</Button>
            <Button size="sm" variant="primary" disabled={busy === 'calibrate'} onClick={() => void doCalibration()} data-testid="run-calibration"><BrainCircuit size={13} /> 运行校准</Button>
            <Button size="sm" variant="secondary" disabled={busy === 'backtest'} onClick={doBacktest} data-testid="run-backtest">滚动回测</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmCalReset(true)}><RotateCcw size={12} /> 重置校准</Button>
          </div>

          <div className="mt-3 rounded-lg bg-[#FAF8F3] px-3 py-2 text-[10.5px] leading-relaxed text-[#6B6A63]">
            <span className="font-semibold text-[#3A3D37]">校准状态</span> · alpha {dataset.settings.calibration.alpha.toFixed(2)} · 版本 {dataset.settings.calibration.version}
            <div className="mt-1 flex flex-wrap gap-1.5">
              {[0, 1, 2, 3, 4, 5, 6].map((wd) => (
                <span key={wd} className="rise inline-block rounded bg-white px-1.5 py-0.5 num" style={{ '--d': `${wd * 28}ms` } as CSSProperties}>
                  {weekdayCN(wd)} {formatMoney(dataset.settings.calibration.weekdayBias[wd] ?? 0)}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-3 max-h-56 overflow-auto">
            <table className="data">
              <thead><tr><th>快照日</th><th>类型</th><th className="text-right">期初</th><th className="text-right">期末</th></tr></thead>
              <tbody>
                {snapshots.map((snap) => (
                  <tr key={snap.id}>
                    <td className="whitespace-nowrap">{formatCN(snap.asOfDate)}</td>
                    <td><Badge tone={snap.auto ? 'gray' : 'teal'}>{snap.auto ? '自动' : '手动'}</Badge></td>
                    <td className="num text-right">{formatMoney(snap.days[0]?.balance ?? 0)}</td>
                    <td className="num text-right">{formatMoney(snap.days[snap.days.length - 1]?.balance ?? 0)}</td>
                  </tr>
                ))}
                {snapshots.length === 0 && <tr><td colSpan={4} className="text-center text-[11px] text-[#8A887F]">尚无快照；完成开户后每日自动生成。</td></tr>}
              </tbody>
            </table>
          </div>

          {backtest && (
            <div className="mt-3 rounded-xl border border-[#E4E0D8] p-3 fade-swap" data-testid="backtest-result">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-semibold">回测结果 <span className="font-normal text-[#8A887F]">({backtest.at})</span></p>
                <Badge tone={backtest.result.sufficient ? 'teal' : 'amber'}>{backtest.result.sufficient ? `样本 ${backtest.result.calibrated.samples} 天` : '样本不足'}</Badge>
              </div>
              {backtest.result.sufficient ? (
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded bg-[#FAF8F3] px-2 py-1.5">
                    <p className="text-[10px] text-[#8A887F]">未校准 MAE / RMSE</p>
                    <p className="num">{formatMoney(backtest.result.uncalibrated.mae)} / {formatMoney(backtest.result.uncalibrated.rmse)}</p>
                  </div>
                  <div className="rounded bg-[#F0F8F5] px-2 py-1.5">
                    <p className="text-[10px] text-[#8A887F]">校准后 MAE / RMSE</p>
                    <p className="num">{formatMoney(backtest.result.calibrated.mae)} / {formatMoney(backtest.result.calibrated.rmse)}</p>
                  </div>
                  <p className="col-span-2 text-[10px] leading-relaxed text-[#8A887F]">
                    区间 {backtest.result.calibrated.start ? `${formatCN(backtest.result.calibrated.start)} — ${formatCN(backtest.result.calibrated.end!)}` : '—'} · {backtest.result.note}
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-[10.5px] leading-relaxed text-[#8A5A13]">{backtest.result.reason}</p>
              )}
            </div>
          )}

          <div className="mt-3 overflow-auto">
            <table className="data">
              <thead><tr><th>评估日</th><th className="text-right">实际</th><th className="text-right">预测</th><th className="text-right">残差</th><th>状态</th></tr></thead>
              <tbody>
                {calibrations.map((r) => (
                  <tr key={r.id} className={cn(r.invalidated && 'opacity-50')}>
                    <td className="whitespace-nowrap">{formatCN(r.evaluatedDate)}<span className="ml-1 text-[9.5px] text-[#8A887F]">{weekdayCN(r.weekday)}</span></td>
                    <td className="num text-right">{formatMoney(r.actual)}</td>
                    <td className="num text-right">{formatMoney(r.predicted)}</td>
                    <td className={cn('num text-right', r.residual > 0 ? 'text-[#8A5A13]' : '')}>{formatMoney(r.residual)}</td>
                    <td><Badge tone={r.invalidated ? 'gray' : 'teal'}>{r.invalidated ? '失效' : '有效'}</Badge></td>
                  </tr>
                ))}
                {calibrations.length === 0 && <tr><td colSpan={5} className="text-center text-[11px] text-[#8A887F]">尚无可学习的历史快照与实际覆盖。</td></tr>}
              </tbody>
            </table>
          </div>
          <InfoNote>
            校准只调整「可变消费」的星期偏差，不会修改历史交易；残差 = 实际 − 预测，正残差表示实际花得更多。
          </InfoNote>
        </Card>

        <Card className="rise" style={{ '--i': 4 } as CSSProperties} title="数据模式" subtitle={mode === 'demo' ? '当前正在查看 6 个月合成示例数据' : '当前正在使用个人账本'}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={mode === 'demo' ? 'amber' : 'teal'}>{mode === 'demo' ? '示例数据' : '个人账本'}</Badge>
            {mode === 'personal' && (
              <Button size="sm" variant="secondary" onClick={() => void enterDemo()} data-testid="view-demo">
                <FlaskConical size={13} /> 查看示例
              </Button>
            )}
            {mode === 'demo' && (
              <>
                <Button size="sm" variant="secondary" onClick={() => void regenerateDemo()} data-testid="regenerate-demo">
                  <RotateCcw size={13} /> 重新生成示例
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void exitDemo()} data-testid="exit-demo-data">
                  退出示例
                </Button>
              </>
            )}
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-[#8A887F]">
            示例数据独立存储，重置示例不会影响个人账本。
          </p>
        </Card>

        <Card className="rise" style={{ '--i': 5 } as CSSProperties} title="危险操作" subtitle="以下操作不可撤销，执行前请先下载备份">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#F3D9D5] bg-[#FDF7F6] px-3 py-2.5">
              <div>
                <p className="text-[12px] font-medium text-[#98362E]">重置个人数据</p>
                <p className="text-[10.5px] text-[#8A887F]">清空个人账本并回到开户引导，账户与配置会一并重置。</p>
              </div>
              <Button size="sm" variant="danger" onClick={() => setConfirmReset(true)}><Trash2 size={13} /> 重置</Button>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-[#FAF8F3] px-3 py-2 text-[10.5px] leading-relaxed text-[#6B6A63]">
              <ShieldAlert size={13} className="mt-0.5 shrink-0 text-[#B7791F]" />
              浏览器清理站点数据、无痕模式关闭或更换设备都可能导致数据丢失；JSON 备份是你唯一的迁移手段。
            </div>
          </div>
        </Card>
      </div>

      <Modal
        open={confirmReset}
        title="重置个人数据？"
        subtitle="当前数据集将被永久删除，建议先导出 JSON 备份。"
        onClose={() => setConfirmReset(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>取消</Button>
            <Button variant="danger" disabled={busy === 'reset'} onClick={() => void doReset()} data-testid="confirm-reset">确认重置</Button>
          </>
        )}
      >
        <p className="text-[12px] leading-relaxed text-[#6B6A63]">
          个人数据将被清空并重新进入开户设置。该操作无法通过应用内撤销，只能从备份恢复。
        </p>
      </Modal>

      <Modal
        open={confirmDemoRestore}
        title="恢复示例备份？"
        subtitle="这份备份来自示例数据，恢复后会被标记为个人账本。"
        onClose={() => setConfirmDemoRestore(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmDemoRestore(false)}>取消</Button>
            <Button variant="danger" disabled={busy === 'restore'} onClick={() => void restore()} data-testid="confirm-demo-restore">确认恢复</Button>
          </>
        )}
      >
        <p className="text-[12px] leading-relaxed text-[#6B6A63]">
          示例数据是合成的演示内容，恢复后将成为你的个人账本数据。若只想体验功能，可在「数据模式」卡片中进入示例。
        </p>
      </Modal>

      <Modal
        open={confirmCalReset}
        title="重置校准状态？"
        onClose={() => setConfirmCalReset(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmCalReset(false)}>取消</Button>
            <Button variant="danger" onClick={() => void resetCal()} data-testid="confirm-cal-reset">确认重置</Button>
          </>
        )}
      >
        <p className="text-[12px] leading-relaxed text-[#6B6A63]">
          星期偏差会归零、alpha 恢复默认，历史校准记录标记为失效但保留审计痕迹。随后的预测将先使用未校准模型。
        </p>
      </Modal>
    </div>
  );
}