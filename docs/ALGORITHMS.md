# 算法说明

本文描述实现中真实生效的计算口径。所有金额单位为分，所有日期为本地 `YYYY-MM-DD`，解析锚定中午。

## 1. 余额与预留

对账户 `a` 在日期 `d` 的余额：

```
balance(a, d) = openingBalance
              + Σ income  (accountId = a, openingDate ≤ date ≤ d)
              − Σ expense (accountId = a, openingDate ≤ date ≤ d)
              − Σ transfer out (accountId = a)
              + Σ transfer in  (toAccountId = a)
```

总余额只汇总未归档账户。转账不进入收入/支出统计。

目标已预留：

```
reservedByGoal(g, d) = Σ reserve(g, date ≤ d) − Σ release(g, date ≤ d) − Σ consume(g, date ≤ d)
```

预留金额钳制在 `[0, target]`。总预留为全部目标已预留之和（不小于 0）。

```
free = totalBalance − totalReserved − safetyReserve
maxReservable = max(0, free)
```

安全储备只参与风险判断与可支配金额，不改变账户余额。

## 2. 计划期次

期次 ID：

```
occ:${flowId}:${originalDueDate}
```

重复规则：

- 日：`+ step` 天；
- 周：`+ 7 × step` 天；
- 月：以下一期当前日期为锚，推进 `step` 个月，并把日号钳制到原始 `anchorDay` 与目标月份最大天数；
- 年：以 `startDate` 为锚推进年份，同样钳制日号。

月度锚定示例：1 月 31 日 → 2 月 28/29 日 → 3 月 31 日，不会永久漂移到 28 日。

用户处理记录按 `occ:` ID 合并：

- `pending`：待发生；
- `settled`：已核销，带 `transactionId`，金额/到期日可被实际值覆盖；
- `skipped`：已跳过，不产生流水；
- 改期只改 `dueDate`，`originalDueDate` 不变。

## 3. 可变消费模型

训练窗口：`asOf − 42 天` 到 `asOf − 1 天`。只统计：

```
kind = expense
nature = variable
occurrenceId 为空（排除固定账单）
goalId 为空（排除目标购买）
日期落在已登记覆盖区间内
```

每个覆盖日都会进入样本（零消费日记为 0），因此中位数包含「不消费日」。

逐日预测：

1. 该星期几样本数 ≥ 3 且中位数存在 → `weekday`，取中位数；
2. 月可变预算 > 0 → `budget`，`round(预算 / 当月天数)`；
3. 训练日 ≥ 7 → `daily_avg`，`round(训练期总可变支出 / 训练日数)`；
4. 否则 → `none`，预测值为 `null`（UI 显示「未估计」）。

中位数为偶数样本时取中间两数平均后四舍五入。

校准偏置：

```
predicted = max(0, raw + weekdayBias[weekday])
```

## 4. 预测引擎

输入：账户、流水、计划、处理记录、目标事件、覆盖区间、设置、可选场景。

起始余额与基础预留按 `asOf` 计算。计划视图覆盖 `asOf − 400` 到 `asOf + horizon`。

每个待发生期次：

- 收入：
  - 到期 < 今天：忽略（不默认到账）；
  - 到期 = 今天：计入今日收入与今日待办；
  - 到期 > 今天：计入对应日期收入。
- 支出：
  - 到期 ≤ 今天：计入今日支出与今日待办；逾期时追加假设说明；
  - 到期 > 今天：计入对应日期固定支出。

今日日终余额：

```
balance_today_end = startBalance + todayIncome − todayExpense − scenarioPurchase(today)
```

未来第 `i` 天：

```
balance_i = balance_{i−1}
          + income_i
          − fixedExpense_i
          − variable_i
          − scenarioExpense_i
```

其中 `variable_i` 为可变模型预测（`null` 按 0 计入余额，但 UI 明确标记未估计）。

预留：

```
reserved_i = max(0, baseReserved + Σ scenarioReserve(d ≤ i) + Σ consumeReserved(d ≤ i))
free_i = balance_i − reserved_i − safetyReserve
```

### 风险指标

- 最低余额及日期；
- 最低可用金额（`free`）及日期；
- 首次低于安全储备日期；
- 首次为负日期；
- 低于安全储备天数；
- 第 30/60/90 天余额。

### 同日覆盖风险

日终余额按净额计算，但额外检查：

```
dip = 当日开始前余额 − 当日固定支出
若 dip < 安全储备 且 日终余额 ≥ 安全储备 → 记录覆盖缺口
缺口 = 安全储备 − dip
```

即「支出先于收入到账」会短暂击穿安全线，即使日终恢复。

## 5. 消费沙盘

### 基准

直接运行预测引擎。

### 立即购买

场景购买：`date = today, amount = price`。若关联目标：

```
consumeReserved = min(goalReserved, price)
```

预测引擎在购买日扣减余额，同时减少预留，避免双重扣减。

### 延期购买

购买日取用户计划日；若超出预测窗口，则钳制到窗口末尾。购买日不早于今天。

### 最早安全购买日

在 90 天窗口内，对每天 `d` 定义：

```
safe(d) = min_{t ≥ d} balance(t) − price ≥ safetyReserve
```

实现用后缀最小值从后向前计算，再从前向后找第一个满足条件的日期，复杂度 `O(window)`。

### 分阶段预留

从今天起按周/月节奏：

```
free = balance(cursor) − baseReserved − accumulated − safetyReserve
amount = clamp(remaining, 0, free)
```

- 每次把 `amount` 记入预留日期与金额；
- 累计达到价格即完成，购买日 = 完成后的下一个节奏点；
- 90 天窗口内未筹足则 `completed = false`，并给出缺口。

当自由余额一次足够时，可能首个节奏点即完成，因此「分阶段」路径会接近「立即」路径。

### 沙盘风险

三条购买路径与基准分别用同一引擎运行，得到各自的最低余额、首次低于安全线、购买时已预留金额。沙盘不写账本。

## 6. 目标分配

### 剩余机会数

从当前月到截止月逐月检查分配日（`goalAllocDay`，月底截断）：

```
本月从今天起仍有一次机会；
之后每个月若分配日 ≥ 今天且 ≤ 截止日，机会 +1；
上限 600。
```

逾期目标按 1 次处理，缺口即全部剩余。

### 月度需求

```
monthlyNeed = min(remaining, ceil(remaining / opportunities))
```

### 策略权重

- 均衡：`1`
- 期限优先：`1 / max(opportunities, 1)`
- 重要性优先：`clamp(priority, 1, 5) / sqrt(max(opportunities, 1))`

### 带上限的加权分配

预算 `B`，每个目标有需求 `d_i` 与权重 `w_i`。按权重比例分配，但不超过 `d_i`；被上限截断的剩余预算继续按权重分给未满足的目标，直到预算用尽或所有需求满足。

整数分使用最大余数法：先按比例取整，再把剩余的分按小数余数从大到小分配，保证合计精确等于预算。

### 24 个月推演

1. 运行一条 24 个月预测现金路径；
2. 每个分配日计算未来 90 天内的最小 headroom：

```
headroom = min(balance(t) − baseReserved − virtualTotal − safety)
```

3. 本期预算 = `min(headroom, monthlySavingsCap)`（上限为 0 表示不限制）；
4. 按当前策略分配，累加到虚拟预留；
5. 达到目标即记录完成日期；最多 24 个月。

## 7. 校准与回测

### 快照

快照保存预测日、horizon、输入摘要、每日预测、校准状态、算法版本、参数版本。快照不可变。

### 逐日校准

对最近 N 天（默认 60）的每个已覆盖日期 `d`：

1. 找 `asOf = d − 1` 的快照；
2. 取该快照对 `d` 的可变预测 `predicted`；
3. 还原快照当时的偏置，得到 raw：

```
raw = max(0, predicted − snapshotBias[weekday])
```

4. 实际可变支出 `actual`；
5. 残差 `residual = actual − raw`，并截断到 `[−max(5000, 2×raw), +max(5000, 2×raw)]`；
6. 指数平滑：

```
bias_after = round((1 − α) × bias_before + α × residual)
```

默认 `α = 0.4`。同一实际日期只学习一次；修改历史流水会失效该日校准记录。

### 回测

滚动回测比较「前一日快照对当日的预测」与「当日实际可变支出」，输出：

```
MAE  = Σ|error| / n
RMSE = sqrt(Σerror² / n)
```

样本不足或覆盖不足时返回 `sufficient = false` 与原因，不伪造精度。

## 8. 洞察

### 周期候选

按商户聚合历史支出，检查：

- 至少 3 笔；
- 金额变异系数 ≤ 阈值（默认 0.35）；
- 相邻间隔的天数接近周（7）、月（28–31）或年（365），容差默认 ±2 天；
- 间隔稳定；
- 未与已有计划重复。

匹配度由间隔一致性、金额稳定性、样本量加权。确认后创建计划，来源标记 `recurring_candidate`。

### 异常消费

对每笔可变支出，取同分类在窗口内、且日期早于该笔的历史：

- 样本 ≥ `anomalyMinSamples`（默认 5）；
- 中位数 `med`，MAD：

```
MAD = median(|x_i − med|)
```

- 若 MAD > 0：

```
robustZ = 0.6745 × (x − med) / MAD
```

超过阈值（默认 3.5）判为异常；
- 若 MAD = 0，回退 IQR 规则（超出 `Q3 + 1.5×IQR` 或低于 `Q1 − 1.5×IQR`），IQR 也为 0 时用倍数规则（例如超过中位数若干倍）。

结果包含中位数、MAD、IQR、样本数、规则与阈值，用户可确认或忽略。

### 小额高频

在窗口内统计低于阈值的支出笔数与金额，辅助识别「咖啡/外卖」类泄漏。

## 9. 快速记账

本地规则解析（无网络）：

- 金额：`数字 + 元/块/¥`，支持小数；
- 类型：`收入/工资/兼职/报销` → 收入，`买/花/吃` → 支出；
- 日期：`今天/昨天/前天`、`M月D日`；未来日期不自动落库；
- 商户：已知商户词典或「在/去/买了」后的短语；
- 分类提示：按关键词映射到内置分类。

解析结果包含置信度与问题列表；只有 `ok = true` 且匹配到分类时才允许一键记账。歧义时引导使用表单。

## 10. 备份校验

导入前依次检查：

1. JSON 可解析；
2. 顶层结构与 `formatVersion`；
3. Zod schema 校验各实体字段；
4. 金额为安全整数且非负（允许的字段）；
5. 引用完整性：流水账户/分类、计划账户/分类、目标事件目标、计划期次计划与流水、方案目标；
6. 日期合法且不晚于今天（适用字段）；
7. 模式与当前模式的关系（可切换）；
8. 交易日期范围、覆盖区间重叠等警告。

任何错误都阻止恢复；警告不阻止，但会在预览中显示。恢复为整体覆盖当前同模式数据集。