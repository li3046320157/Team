# MoneyFlow 动效系统重设计（沉稳高端方向）

日期：2026-11-25
状态：待用户批准 —— 未经批准不得实施（含代码改动）

## 意图

用户要求重新设计整个项目的动态页面与动态交互 UI，方向是「像高档记账工具那样沉稳」——即 Monarch Money / Copilot Money 一类产品的质感：动效克制、快速、服务于信息层级，而非装饰性表演。现有动效（金币迸发、数字翻转、涟漪等）是上一轮「炫酷」阶段的产物，本轮将其纳入统一体系并重新调校为内敛形态，同时补齐 8 个没有内部动效的页面（计划、洞察、预测、AI 分析、决策沙盘、目标、数据中心、设置）。

## 目标 / 非目标 / 反目标

**目标**
- 一套统一、可复用的动效设计令牌（时长、缓动、错峰步长），全部页面与组件共用。
- 全应用覆盖：10 个页面 + 登录/注册/引导 + 所有交互状态（按钮、开关、弹窗、Toast、列表增删、图表更新、数字变化、空状态）。
- 「沉稳」质感：动效幅度小（位移 ≤12px、缩放 ≥0.98）、时长短（120–400ms）、缓动以标准减速曲线为主。
- 保留品牌性「情绪时刻」：记账成功的金币迸发、金额数字翻转，但重新调校得更精致。
- 尊重现有 `--site-motion` 令牌与 `prefers-reduced-motion` 降级。

**非目标**
- 不引入任何新依赖（不用 GSAP / framer-motion）。
- 不做滚动触发动画——页面高度有限，入场即全部呈现。
- 不重写视觉样式（颜色、间距、圆角均不动），只动「动」的部分（仅一处例外：卡片 hover 的发光描边，见「交互反馈」）。
- 不改动业务逻辑与数据结构。

**反目标（失败标准）**
- 动效让用户「等」：CSS 入场编排总时长超过约 500ms、任何交互反馈超过约 200ms 才完成。图表绘制属「渐进呈现」（首帧即有内容、数据逐条画出），不占用入场时长上限，但单段绘制仍以 480ms 为限。
- 动效抢戏：信息页面出现弹跳、大幅位移、大面积粒子。
- 性能劣化：动画使用非 transform/opacity 属性导致滚动卡顿。
- 破坏现有 117 个测试与 typecheck。

## 约束

- React 19 + TS strict + Tailwind 4 + ECharts 6；零新依赖。
- ECharts 动画时长需在 JS 侧乘以 `--site-motion`（CSS var() 无法控制 canvas），已有 `withMotion()` 基础设施。
- 路由切换时整页重挂载（`key={location.pathname}`），入场编排依赖 CSS 动画即可，无需 JS 编排器。
- 模块级 `lastMoney` Map 已用于数字翻转的跨挂载记忆，保留。
- 用户规则：UI 改动必须先本地预览、用户确认后才能提交 git；本文档与所有改动在批准前不提交。

## 方案（Approaches）

**A. 纯 CSS 动效令牌 + 少量 React 助手（选定）**
在 `:root` 定义时长/缓动/错峰令牌，所有动画 class 引用 `var()`；ECharts 经 `withMotion()` 读取 `--site-motion`。
- 收益：零依赖、与现有架构一致（`--site-motion`、reduced-motion 块已存在）、性能最好、团队仓库无负担。
- 代价：复杂多段编排（如元素移除后的塌缩）需要少量 JS；本设计将其限制在极少数交互点，并允许降级为直接移除。

**B. GSAP**
- 收益：时间线编排、FLIP 能力强。
- 代价：新依赖（体积约 70KB）、JS 驱动动画与 React 严格模式/整页重挂载摩擦大；「沉稳」风格用 CSS 缓动完全够用。舍弃。

**C. framer-motion（声明式动画库）**
- 收益：React 内声明式动画。
- 代价：同类依赖成本，且大幅改变组件代码风格，与现有 Tailwind + CSS 体系割裂。舍弃。

## 设计令牌（Motion Tokens）

`:root` 新增（与现有 `--site-motion` 设计令牌体系并列；CSS 中一律 `calc(var(--dur-N) * var(--site-motion))`）：

- 时长：`--dur-1: 120ms`（按压/焦点）；`--dur-2: 200ms`（hover/徽标）；`--dur-3: 280ms`（卡片/列表项入场）；`--dur-4: 380ms`（页面级/图表）。
- 缓动：
  - `--ease-standard: cubic-bezier(0.2, 0, 0, 1)`（默认，信息类过渡）
  - `--ease-enter: cubic-bezier(0, 0, 0.2, 1)`（入场）
  - `--ease-soft: cubic-bezier(0.3, 1.15, 0.4, 1)`（仅弹窗/Toast 等物理感场景，过冲约 3%）
  - `--ease-digit: cubic-bezier(0.2, 0.85, 0.25, 1)`（数字翻转，无过冲、利落）
- 错峰步长：`--stagger-step: 28ms`；单组最多 8 项，最大延迟约 200ms。
- 幅度常量（注释形式，供实现参考）：入场位移 8–12px、缩放 0.98–0.99、模糊 ≤2.5px。

## 动效语言（Motion Language）

### 1. 页面入场（已存在，重新调校）
`page-enter`：fade + 位移 16px→10px、scale 0.985→0.99、blur 4px→2.5px、400ms→380ms、`--ease-enter`。标题 sheen 保留（高级质感），2200ms→2600ms 更缓。

### 2. 内容编排（新增，核心工作）
每页按「标题 → 关键数字/统计卡 → 明细内容」顺序入场：
- 统一 class `.rise`：fade + 8px 位移，`--dur-3`，`--ease-enter`；延迟由内联 `--d` 变量给出（`calc(var(--i) * var(--stagger-step))`）。
- StatCard 组：现有 `stat-in` 改为引用令牌（位移 12px→8px、scale 0.97→0.99）。
- Card 网格（2×2 等）：卡片依次 `.rise`，延迟 = 视觉列序 × 28ms（从左到右）。
- 列表项（流水/计划/候选等）：逐项 `.rise`，步长 24ms，超过 8 项后封顶。

### 3. 数字与数据变化
- 金额数字翻转（AnimatedMoney odometer）：保留。每列延迟 42ms→28ms；`digitIn` 缓动换 `--ease-digit`。
- 余额脉冲 `balance-pulse`：保留，700ms→600ms。
- 进度条（Goals Progress 等）：挂载与数值变化时 400ms `--ease-enter` 过渡（现有 transition 统一时长，确保从旧值动画）。
- 统计数值变化（Insights 3 格、Goals/DataCenter/Forecast 各 4 格统计卡）：复用 `balance-pulse` 微脉冲。

### 4. 交互反馈
- 按钮：`:active` 按压 scale(0.985) 100ms（新增）；ripple 保留，不透明度 0.16→0.10、520ms→420ms。
- 卡片 hover：上浮 -2px 已有，统一 180ms `--ease-standard`；**去掉现有 teal 发光描边环**（沉稳方向：只保留阴影加深，去掉发光描边）。
- 输入聚焦：现有 140ms 焦点环保留。
- 开关/复选框（Settings 速记开关、Sandbox 允许延期）：新增旋钮位移 180ms `--ease-soft` 轻弹。
- Segmented（TransactionForm 收支类型、Forecast 30/60/90、Goals 策略）：不做滑动底块（需 JS 测量，沉稳产品少用）；改为**仅对切换所影响的内容区**做 180ms 淡入淡出（keyed crossfade），选中态即时切换。TransactionForm 中 keyed 范围严格限定于分类/转入账户字段组——金额、日期等常驻字段绝不重挂载（防输入丢失）。
- 弹窗 Modal：`modalPop` 保留，位移 28px→16px、scale 0.94→0.97、360ms→300ms、`--ease-soft`；遮罩 220ms 不变。
- Toast：220ms 上浮淡入；成功对勾描边动画保留。
- 金币迸发（记账成功）：保留为唯一「庆祝时刻」，重新调校——粒数 16→10、散布半径 ±34-166px→±30-110px、上抛高度 -58px→-40px、尺寸 10-18px→10-15px、时长 900ms→720ms、透明度峰值 1→0.9。

### 5. 列表增删
不引入 FLIP 库。两类模式：
- 可明确「转移到别处」的（核销/跳过 → 移入「最近处理」）：源行快速淡出（140ms），目标区新行 highlight 淡入（300ms 后回落）。
- 原地消失的（忽略/确认候选、删除计划）：行 opacity+scale 塌缩 200ms 后卸载（组件内 200ms 延迟删除；若某页实现过重，允许降级为直接移除）。

### 6. 图表（ECharts）
`withMotion` 默认值调校：animationDuration 900→480×motion、animationDurationUpdate 420→320×motion、逐项 delay 55→32ms。各页面自定义 duration（Forecast 500、Sandbox 450、Goals 400）统一收敛到 480。图表绘制为渐进呈现，不计入入场时长上限。

### 7. 加载与空状态
- EmptyState 统一 fade-in 240ms。
- Spinner、saving 按钮态保留。

## 逐页编排（Choreography）

### 总览 Dashboard（已有：stat-in、chart-enter）
标题 → 3 张 StatCard（stat-in 调校后）→ 现金流状态行 → 图表 → 待办/目标/账户卡（.rise 级联）。仅调校 + 补齐卡片级联。

### 流水 Ledger（已有：ledger-day stagger、行 hover）
- `ledger-day` 保留，位移 14px→10px、scale 0.95→0.98、缓动 springy→`--ease-enter`、步长 38ms→28ms。
- 新增交易保存后新行 highlight 淡入 300ms（若无则补）。

### 计划 Schedules（全新编排）
- 左列 3 Card（待处理 → 未来 60 天 → 最近处理）依次 `.rise`（0/60/120ms）；列表项逐项 24ms。
- 核销/改期/跳过：行塌缩（第 5 节模式），「最近处理」新行 highlight；todo Badge 计数微脉冲。
- 停用计划 Badge 淡入。

### 洞察 Insights（全新编排）
- 2×2 Card 按列序 `.rise`（0/28/56/84ms）；候选列表行 stagger 24ms。
- 忽略/确认：行塌缩 + 计数 Badge 脉冲；确认弹窗走 Modal 体系。
- 高频小额 3 格统计挂载时呈现（数字滚动或微脉冲，二选一，见「留给实施者」）。

### 预测 Forecast（核心编排点：horizon 切换）
- 初始：4 StatCard stat-in → 余额曲线 chart-enter → 今日待付/待收 `.rise` → 星期面板 7 格 stagger 20ms → 明细表格 `.rise` → 假设列表 `.rise`。
- 切换 30/60/90：图表 setOption 更新动画（360ms）+ StatCard 数值脉冲 + 表格 keyed 淡入（180ms）；训练日 Badge 统一微脉冲。

### AI 分析 Assistant（部分已有：typing-caret、animate-spin）
- 配置 Card 展开/收起：grid-template-rows 0fr→1fr 过渡 240ms（新增，替换无动画切换）。
- 消息气泡：新消息上浮淡入 160ms；用户/助手气泡偏移方向相反（+6px/-6px）。
- 快捷问题 chips 淡入；停止时气泡移除走塌缩。
- typing-caret、清空、发送按钮按压反馈保留。

### 决策沙盘 Sandbox（核心编排点：运行模拟）
- 表单 Card → 右列 EmptyState。
- 运行后：4 张 ScenarioCard 依次 `.rise`（0/40/80/120ms）→ 对比 EChart chart-enter → 结论 Card `.rise`。
- 已保存方案列表 stagger；套用回填后表单字段微脉冲。

### 目标 Goals（部分已有：Progress transition）
- 4 统计卡 stat-in → 目标卡列级联 → 右列 3 Card `.rise`。
- 进度条：挂载从 0 → 目标值 400ms；预留/释放后从旧值动画。
- 策略 Segmented 切换：推演图表更新动画 + 表格 keyed 淡入。
- 归档：卡片 opacity 0.55 过渡 240ms。

### 数据中心 DataCenter（全新编排）
- 4 统计卡 stat-in → 2×2 Card 级联。
- 导入预览面板插入：展开淡入 240ms；busy 按钮保留 spinner。
- 回测结果面板同上；校准 7 格偏差 stagger。

### 设置 Settings（全新编排）
- 8 张 Card 依次 `.rise`，封顶 8 项（延迟 0–196ms）。
- 「已保存」Badge：保存成功后 pop-in（scale 0.9→1，`--ease-soft`）。
- 覆盖区间列表增删：新增行淡入，删除行塌缩。

### 登录 / 注册 / 引导
- AuthPage：品牌硬币 blobs 保留，漂移时长统一调慢约 20%（沉稳）；表单 Card 统一时长令牌。
- Onboarding：入场编排——品牌区标题 → 特性列表（3 行 stagger）→ 表单 Card（`--dur-4` 延迟 120ms 淡入上浮）。

## 无障碍与降级

- 所有新动画 class 加入 `prefers-reduced-motion` 降级块：`animation: none` 或 softFade。
- `--site-motion: 0` 时全部动画时长归零（CSS 乘法自然为 0；JS 侧 `withMotion` 已处理）。
- 新动画只用 transform/opacity/filter（少量 max-height/grid-rows 塌缩除外），避免布局抖动；同屏连续动画元素数封顶。

## 留给实施者的部分

- 具体 class 命名与 CSS 组织方式（建议：index.css 内按「令牌 → 入场 → 交互 → 列表 → 降级」分区）。
- 每页 `.rise` 挂载位置与 `--i` 序号。
- 列表塌缩的降级策略（某页实现过重时退化为直接移除）。
- Insights 高频小额 3 格的具体呈现（数字滚动或微脉冲，二选一）。
- 测试：无需新测试；保证现有 117 项通过 + typecheck 干净 + 本地浏览器验收（含 reduced-motion 检查）。
