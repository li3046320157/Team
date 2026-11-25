# MoneyFlow 动效系统重设计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 superpowers:executing-plans 按任务逐个实施（本会话原生执行）。步骤用 `- [ ]` 勾选语法跟踪。

**Goal:** 按已批准的「沉稳高端」动效设计，为全应用建立统一动效令牌体系并完成 10 个页面 + 登录/引导的编排与调校。

**Architecture:** 纯 CSS 动效令牌（`:root` 时长/缓动/错峰变量，全部乘 `--site-motion`）+ 少量 React 状态改动（高亮标记、塌缩延迟卸载、Switch 组件）。ECharts 经现有 `withMotion()` 读取运行时倍率。分三批实施，每批末尾为本地预览门槛，用户确认后才提交该批。

**Tech Stack:** React 19 + TS strict + Tailwind 4 + ECharts 6 + Vite；零新依赖。

**Spec:** [docs/superpowers/specs/2026-11-25-motion-system-design.md](../specs/2026-11-25-motion-system-design.md)

## Global Constraints

- 零新依赖（禁用 GSAP / framer-motion 及任何动画库）。
- 所有 CSS 动画时长一律 `calc(var(--dur-N) * var(--site-motion))`；ECharts 时长一律经 `withMotion()` 乘 `motionScale()`。
- 新动画仅用 transform/opacity/filter（例外：塌缩/展开用 max-height 或 grid-template-rows）。
- 幅度上限：位移 ≤12px、缩放 ≥0.98；CSS 入场编排总时长 ≤500ms；交互反馈 ≤200ms 内完成；图表单段绘制 ≤480ms。
- 不改业务逻辑与数据结构；金额以分（cents）为单位不动。
- 每个任务结束：`npm run typecheck` 通过 + `npm run test` 117 项全部通过。
- 提交规则：任务内不提交；每批经用户本地预览确认后一次性提交该批（含本批次与上轮遗留的未提交动效文件），提交身份为 GitHub noreply email（仓库已配置，勿改全局 git config）。
- `prefers-reduced-motion` 与 `--site-motion: 0` 必须全程生效。

## Review Focus

1. **reduced-motion 用户**：模拟 `prefers-reduced-motion: reduce` 时，所有新 class（`.rise`、`.fade-swap`、`.hl-fade`、`.row-collapse`、`.switch` 旋钮）不得播放动画 → 钉在 Task 1 验证步。
2. **`--site-motion: 0`**：全部时长归零（CSS 乘法 + `withMotion` 归零），界面瞬时呈现 → 钉在 Task 1、Task 2 验证步。
3. **TransactionForm 输入保留**：切换支出/收入/转账后，金额与日期输入值不得丢失（keyed 范围不得覆盖常驻字段）→ 钉在 Task 6 验证步。
4. **金币迸发仍触发且内敛**：记账成功 Toast 触发迸发，`.burst-coin` 恰为 10 粒、时长约 720ms → 钉在 Task 1 验证步。
5. **图表切换更新动画**：Forecast 切 30/60/90、Goals 切策略时，图表播放更新动画且单段 ≤480ms → 钉在 Task 9、Task 13 验证步。

---

# 第一批：令牌基座与既有动效调校

> 预览门槛 G1 见批末。第一批提交时将一并包含上轮已实现的动效文件（src/App.tsx、src/components/Chart.tsx、src/components/ui.tsx、src/index.css、src/pages/Dashboard.tsx、src/pages/Ledger.tsx、删除的 src/lib/useCountUp.ts）及用户对 package-lock.json 的最终决定。

### Task 1: 动效令牌与全局基础类（index.css）

**Files:**
- Modify: `src/index.css`（`:root` L29 附近；ripple L145-154；modal L320-357；auth-blob L379-402；card:hover L625-627；page-enter L535；ledger-day L566；balance-pulse L594；toast-burst L700-729；page-title L759-768；stat-in L782-795；reduced-motion 块 L810）

**Interfaces:**
- Produces（后续任务全部依赖）：
  - `:root` 令牌：`--dur-1: 120ms`、`--dur-2: 200ms`、`--dur-3: 280ms`、`--dur-4: 380ms`、`--stagger-step: 28ms`、`--ease-standard: cubic-bezier(0.2,0,0,1)`、`--ease-enter: cubic-bezier(0,0,0.2,1)`、`--ease-soft: cubic-bezier(0.3,1.15,0.4,1)`、`--ease-digit: cubic-bezier(0.2,0.85,0.25,1)`
  - 新 class：`.rise`（入场 fade + 8px 上移，`--dur-3`、`--ease-enter`，延迟 `animation-delay: var(--d, calc(var(--i, 0) * var(--stagger-step)))`——列表项组用 `--i`，粗粒度段落延迟可直接用 `--d: 60ms` 等；用法 `className="rise" style={{ '--i': n }}` 或 `style={{ '--d': '60ms' }}`）；`.fade-swap`（keyed 重挂载时 180ms 淡入，仅入场无退出）；`.hl-fade`（keyframes `hlFade` 1200ms：teal 浅色背景峰值后淡出至透明）；`.row-collapse`（opacity 0 + scale(0.98)，200ms `--ease-standard`，配合组件 200ms 延迟卸载）；`.switch`/`.switch-knob`（开关轨道 36×20、旋钮 16px、`translateX(0→16px)` 180ms `--ease-soft`、选中轨道 `#0E7568`）
  - 调校后的既有 class：`page-enter`（位移 10px、scale 0.99、blur 2.5px、380ms）；`stat-in`（位移 8px、scale 0.99）；`ledger-day`（位移 10px、scale 0.98、`--ease-enter`、步长 28ms）；`modal-panel`（位移 16px、scale 0.97、300ms、`--ease-soft`）；`.ripple`（opacity 峰值 0.10、420ms）；`balance-pulse`（600ms）；`page-title` sheen（2600ms）；odometer `digit-col` 步长 28ms、`digitIn` 用 `--ease-digit`；`toast-burst` 金币（见 Task 1 步骤 3）；`auth-blob` 漂移时长 ×1.2
- 删除：`.card:hover` 的 teal 发光描边环（box-shadow 中 `rgba(14,117,104,…)` 光环项），只保留阴影加深

- [ ] **Step 1: 在 `:root` 加令牌**：Global Constraints 中 4 个时长 + 错峰步长 + 4 条缓动，与现有 `--site-motion` 并列
- [ ] **Step 2: 调校既有入场与交互 class**：`page-enter`、`stat-in`、`ledger-day`、`modal-panel`/`modal-scrim`、`.ripple`、`balance-pulse`、`page-title`、`.card:hover`（去发光描边）、`.btn` 新增 `:active { transform: scale(0.985) }` 100ms、`auth-blob` 漂移 ×1.2——按 Interfaces 中的数值，时长统一换成令牌表达式
- [ ] **Step 3: 调校金币迸发与数字翻转**：`ui.tsx` 的 `burstCoins` 改为 10 粒、dx ±30-110、dy 36-80、上抛 -40px、尺寸 10-15px、透明度峰值 0.9；`coinFly` 900ms→720ms；odometer `--d` 步长 42→28ms、`digitIn` 缓动换 `--ease-digit`（改 `src/components/ui.tsx` L357 附近与 index.css）
- [ ] **Step 4: 新增基础 class**：`.rise`、`.fade-swap`、`.hl-fade`、`.row-collapse`、`.switch`/`.switch-knob` 按 Interfaces 规格
- [ ] **Step 5: 扩展 reduced-motion 降级块（L810）**：新 class 全部加入（`.rise/.fade-swap/.hl-fade/.row-collapse` → `animation: none`；`.switch-knob` → `transition: none`）
- [ ] **Step 6: 验证**：`npm run typecheck`、`npm run test`（117 通过）；浏览器：DevTools 模拟 `prefers-reduced-motion: reduce` 后刷新，确认首页无任何入场动画、`--site-motion: 0` 时瞬时呈现；记一笔保存，evaluate 确认 `.burst-coin` 数量 = 10

### Task 2: ECharts 默认动效收敛（Chart.tsx）

**Files:**
- Modify: `src/components/Chart.tsx`（L18-19 默认值）

**Interfaces:**
- Consumes: 无
- Produces: `withMotion()` 新默认值 `animationDuration: 480×scale`、`animationDurationUpdate: 320×scale`、`animationDelay: idx×32×scale`（签名不变，后续页面任务删除各自的自定义 duration 后即生效）

- [ ] **Step 1: 修改 `withMotion` 默认值**：900→480、420→320、55→32（`scale` 逻辑不变）
- [ ] **Step 2: 验证**：`npm run typecheck`、`npm run test`；`--site-motion: 0` 时图表瞬时呈现（浏览器 evaluate `motionScale()` 行为）

### Task 3: Dashboard 级联补齐（Dashboard.tsx）

**Files:**
- Modify: `src/pages/Dashboard.tsx`（L87 图表自定义时长；现金流状态行、待办、目标进度、账户卡片区）

**Interfaces:**
- Consumes: Task 1 的 `.rise`、`--stagger-step`
- Produces: 无新接口

- [ ] **Step 1: 删除 L87 的 `animationDuration: 500`**（让 withMotion 默认 480 生效）
- [ ] **Step 2: 给现金流状态行与「接下来/目标进度/账户」卡片挂 `.rise`**，`--i` 依次递增（标题 0 → 3 张 StatCard 由 stat-in 负责 → 状态行 → 图表 → 右侧卡片组），单组内最大延迟 ≤200ms
- [ ] **Step 3: 验证**：`npm run typecheck`、`npm run test`；浏览器看首页：标题 sheen → 统计卡 → 状态行 → 图表绘制 → 卡片依次入场，总入场 ≤500ms

### Task 4: 流水新行高亮（Ledger.tsx）

**Files:**
- Modify: `src/pages/Ledger.tsx`（L255 行渲染；保存路径 L122/131）

**Interfaces:**
- Consumes: Task 1 的 `.hl-fade`
- Produces: 无新接口

- [ ] **Step 1: 加 `justAddedId` 状态**：保存成功后记录新交易唯一 id（`apply(addTransaction)` 回调中取得；若 API 不返回 id，用交易对象唯一键），`setTimeout` 1200ms 后清除
- [ ] **Step 2: 行渲染挂 class**：行 id === `justAddedId` 时 className 追加 `hl-fade`
- [ ] **Step 3: 验证**：`npm run typecheck`、`npm run test`；浏览器：流水页新增交易，新行出现 teal 背景淡出，不影响日分组 stagger

### Task 5: Switch 开关与 EmptyState 统一（ui.tsx）

**Files:**
- Modify: `src/components/ui.tsx`（Segmented 附近，L252 前后；EmptyState 组件）

**Interfaces:**
- Consumes: Task 1 的 `.switch`/`.switch-knob`
- Produces: `export function Switch({ checked, onChange, 'aria-label': ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; 'aria-label'?: string })` —— `role="switch"` + `aria-checked`，点击切换，旋钮动画由 CSS 承担。Task 12、Task 15 消费。EmptyState 确认/补充 fade-in 240ms（对齐 `--dur-2` 令牌）

- [ ] **Step 1: 实现 `Switch` 组件**（规格见 Interfaces；选中轨道色 `#0E7568`）
- [ ] **Step 2: EmptyState 确认/补充 fade-in 240ms**（若组件已有淡入则仅把时长对齐令牌）
- [ ] **Step 3: 验证**：`npm run typecheck`、`npm run test`；浏览器可在临时场景确认旋钮 180ms 轻弹（reduced-motion 时无过渡）

### Task 6: TransactionForm 收支切换字段组淡入（TransactionForm.tsx）

**Files:**
- Modify: `src/components/TransactionForm.tsx`（L126-132 支出性质 select；L154-174 转入账户/分类三元组）

**Interfaces:**
- Consumes: Task 1 的 `.fade-swap`
- Produces: 无新接口

- [ ] **Step 1: 给两处 kind 相关字段组包 keyed 包裹层**：`<span key={`kind-${kind}-nature`} className="fade-swap block">`（支出性质组）与 `<span key={`kind-${kind}-field`} className="fade-swap block">`（转入账户/分类组）。金额、日期输入**不得**进入包裹层
- [ ] **Step 2: 验证**：`npm run typecheck`、`npm run test`；浏览器：输入金额 123.45 与日期 → 切换 支出/收入/转账 → 字段组 180ms 淡入且**金额与日期输入值保留**

---

## 第一批预览门槛 G1

完成 Task 1-6 后，本地 `npm run dev`（localhost:5173），请用户按清单预览：

- 首页/流水入场：标题 sheen、stat-in、级联、图表 480ms、ledger-day 10px stagger、行 hover
- 记一笔保存：Toast 对勾 + 10 粒金币迸发（720ms）+ 数字翻转无过冲 + 新行高亮淡出
- 弹窗、按钮 ripple、卡片 hover（无发光描边）
- 收支/转账切换字段组淡入且输入不丢
- reduced-motion 模拟与 `--site-motion: 0` 全部降级

用户确认后：提交第一批（Task 1-6 涉及文件 + 上轮遗留动效文件），commit message 建议 `feat: 动效令牌体系与既有动效沉稳化调校`；package-lock.json 是否纳入由用户决定。

---

# 第二批：核心信息页编排

> 预览门槛 G2 见批末。

### Task 7: 计划页编排（Schedules.tsx）

**Files:**
- Modify: `src/pages/Schedules.tsx`

**Interfaces:**
- Consumes: Task 1 的 `.rise`、`.hl-fade`、`.row-collapse`
- Produces: 无新接口

- [ ] **Step 1: 左列 3 Card 挂 `.rise`**（`--d` 分别为 0/60ms/120ms）；卡片内列表项逐项 `.rise` 步长 24ms（`--i` 递增）、8 项封顶
- [ ] **Step 2: 核销/改期/跳过走「转移」模式**：源行 `.row-collapse` 200ms 后移除，「最近处理」新行 `.hl-fade`；todo Badge 计数变化时挂 `balance-pulse`
- [ ] **Step 3: 停用计划 Badge 淡入**（复用 `.fade-swap` 或 `.rise`）
- [ ] **Step 4: 验证**：`npm run typecheck`、`npm run test`；浏览器走一遍核销/改期/跳过/停用流程

### Task 8: 洞察页编排（Insights.tsx）

**Files:**
- Modify: `src/pages/Insights.tsx`

**Interfaces:**
- Consumes: Task 1 的 `.rise`、`.row-collapse`、`balance-pulse`
- Produces: 无新接口

- [ ] **Step 1: 2×2 Card 按列序 `.rise`**（`--i` 0/1/2/3）；候选列表行 stagger 24ms、8 项封顶
- [ ] **Step 2: 忽略/确认候选**：行 `.row-collapse` 200ms 后从列表移除；计数 Badge 变化挂 `balance-pulse`
- [ ] **Step 3: 高频小额 3 格统计挂载时 `balance-pulse`**（三格依次延迟 0/28/56ms，复用 `--i`）
- [ ] **Step 4: 验证**：`npm run typecheck`、`npm run test`；浏览器走忽略/确认流程

### Task 9: 预测页编排（Forecast.tsx）

**Files:**
- Modify: `src/pages/Forecast.tsx`（L39 自定义 duration）

**Interfaces:**
- Consumes: Task 1 的 `.rise`、`.fade-swap`、`balance-pulse`；Task 2 的 withMotion 默认值
- Produces: 无新接口

- [ ] **Step 1: 删除 L39 `animationDuration: 500`**
- [ ] **Step 2: 初始编排**：4 StatCard 走 stat-in → 余额曲线 chart-enter → 今日待付/待收 `.rise` → 星期面板 7 格 `.rise` 步长 20ms → 明细表格 `.rise` → 假设列表 `.rise`（后段 `--i` 从 0 重新计）
- [ ] **Step 3: horizon 切换**：表格包 keyed `.fade-swap`（key 含 horizon）；StatCard 数值变化挂 `balance-pulse`；训练日 Badge 出现时 `balance-pulse`
- [ ] **Step 4: 验证**：`npm run typecheck`、`npm run test`；浏览器切 30/60/90：图表更新动画（evaluate `getAnimations` 或观察绘制）、表格淡入、统计脉冲

### Task 10: AI 分析页编排（Assistant.tsx）

**Files:**
- Modify: `src/pages/Assistant.tsx`

**Interfaces:**
- Consumes: Task 1 的 `.rise`、`.fade-swap`、`.row-collapse`
- Produces: 无新接口

- [ ] **Step 1: 配置 Card 展开/收起**：内容包 grid 容器，`grid-template-rows: 0fr→1fr` 过渡 240ms（收起/展开各一个 class 或 inline style 切换）
- [ ] **Step 2: 消息气泡**：新消息挂 `.rise`（位移 6px 变体：用户 +6px、助手 -6px，可用 `--rise-x` 自定义属性实现）；快捷问题 chips 淡入
- [ ] **Step 3: 停止生成时气泡移除走 `.row-collapse` 模式**
- [ ] **Step 4: 验证**：`npm run typecheck`、`npm run test`；浏览器发消息观察气泡上浮、展开收起配置卡

### Task 11: 引导页编排（Onboarding.tsx）

**Files:**
- Modify: `src/components/Onboarding.tsx`

**Interfaces:**
- Consumes: Task 1 的 `.rise`
- Produces: 无新接口

- [ ] **Step 1: 入场编排**：品牌区标题 → 3 行特性列表 `.rise`（步长 28ms）→ 表单 Card（延迟 120ms 淡入上浮，可复用 `.rise` + 自定义 `--d`）
- [ ] **Step 2: 验证**：`npm run typecheck`、`npm run test`；浏览器以新本地账号走到引导页确认编排

---

## 第二批预览门槛 G2

请用户预览：计划（级联/核销转移/徽标脉冲）、洞察（2×2 级联/忽略塌缩）、预测（初始编排/切 horizon 全联动）、AI 分析（配置卡展开/气泡）、引导页编排。确认后提交第二批，建议 message `feat: 计划/洞察/预测/AI/引导页动效编排`。

---

# 第三批：决策与工具页编排

> 预览门槛 G3（最终验收）见批末。

### Task 12: 沙盘页编排（Sandbox.tsx）

**Files:**
- Modify: `src/pages/Sandbox.tsx`（L130 自定义 duration；L213 checkbox）

**Interfaces:**
- Consumes: Task 1 的 `.rise`；Task 5 的 `Switch`
- Produces: 无新接口

- [ ] **Step 1: 删除 L130 `animationDuration: 450`**
- [ ] **Step 2: 运行模拟后的结果区编排**：4 张 ScenarioCard 依次 `.rise`（`--i` 0/1/2/3）→ 对比 EChart chart-enter → 结论 Card `.rise`；已保存方案列表 stagger
- [ ] **Step 3: 套用方案回填后表单字段微脉冲**（`balance-pulse`）
- [ ] **Step 4: L213 原生 checkbox 换成 `Switch`**（`checked={allowDelay}`）
- [ ] **Step 5: 验证**：`npm run typecheck`、`npm run test`；浏览器运行一次模拟看级联，操作开关

### Task 13: 目标页编排（Goals.tsx）

**Files:**
- Modify: `src/pages/Goals.tsx`（L117 自定义 duration）；`src/components/ui.tsx`（Progress L177）

**Interfaces:**
- Consumes: Task 1 的 `.rise`、`balance-pulse`、`.fade-swap`
- Produces: Progress 行为变更（挂载从 0 动画到目标值；更新时从旧值过渡 400ms）——Sandbox/Goals 所有 Progress 消费方自动生效

- [ ] **Step 1: 删除 L117 `animationDuration: 400`**
- [ ] **Step 2: Progress 挂载动画**：ui.tsx Progress 内部以 state 承接 width，`useEffect` 内 `requestAnimationFrame` 把 width 从 0 置为目标值（更新时经现有 transition 从旧值过渡），transition 时长统一 400ms `--ease-enter`
- [ ] **Step 3: 页面编排**：4 统计卡 stat-in → 目标卡列 `.rise` 级联 → 右列 3 Card `.rise`
- [ ] **Step 4: 策略 Segmented 切换**：推演图表更新动画（withMotion 已覆盖）+ 表格 keyed `.fade-swap`；归档目标卡片 opacity 0.55 过渡 240ms
- [ ] **Step 5: 验证**：`npm run typecheck`、`npm run test`；浏览器：挂载进度条动画、预留/释放后进度过渡、切策略图表更新、归档

### Task 14: 数据中心编排（DataCenter.tsx）

**Files:**
- Modify: `src/pages/DataCenter.tsx`

**Interfaces:**
- Consumes: Task 1 的 `.rise`
- Produces: 无新接口

- [ ] **Step 1: 4 统计卡 stat-in → 2×2 Card `.rise` 级联（`--i` 0/1/2/3）**
- [ ] **Step 2: 导入预览面板与回测结果面板插入时 240ms 展开淡入**（复用 `.fade-swap` 或 grid-rows 展开，二者取实现更简者）
- [ ] **Step 3: 校准 7 格偏差 stagger**（步长 28ms）
- [ ] **Step 4: 验证**：`npm run typecheck`、`npm run test`；浏览器选文件触发预览面板、跑回测看结果面板

### Task 15: 设置页编排（Settings.tsx）

**Files:**
- Modify: `src/pages/Settings.tsx`（L182 checkbox）

**Interfaces:**
- Consumes: Task 1 的 `.rise`、`.row-collapse`；Task 5 的 `Switch`
- Produces: 无新接口

- [ ] **Step 1: 8 张 Card 依次 `.rise`**（`--i` 0-7，封顶 196ms）
- [ ] **Step 2: 「已保存」Badge 出现时 pop-in**（scale 0.9→1，`--ease-soft`，可复用 `.fade-swap` 加自定义 class）
- [ ] **Step 3: 覆盖区间增删**：新增行淡入、删除行 `.row-collapse` 模式
- [ ] **Step 4: L182 原生 checkbox 换成 `Switch`**（`checked={quickInput}`）
- [ ] **Step 5: 验证**：`npm run typecheck`、`npm run test`；浏览器操作开关、保存看徽标、增删覆盖区间

---

## 第三批预览门槛 G3（最终验收）

请用户全站预览：沙盘（结果级联/开关）、目标（进度条动画/策略切换/归档）、数据中心（级联/面板展开）、设置（八卡级联/徽标/开关）。随后全站扫尾检查：

- `npm run typecheck` + `npm run test`（117 通过）
- DevTools 全站走查：`prefers-reduced-motion: reduce` 下无动画残留；`--site-motion: 0` 瞬时呈现
- 确认无任何新依赖进入 package.json

用户确认后提交第三批，建议 message `feat: 沙盘/目标/数据中心/设置页动效编排`。
