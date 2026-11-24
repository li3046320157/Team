# MoneyFlow 钱流

面向大学生与年轻职场人的本地优先个人现金流规划 Web 应用。它把真实流水、固定收支计划、储蓄目标预留放进同一本账，用同一条可解释的预测引擎生成未来 30/60/90 天余额曲线，并提供消费决策沙盘。

所有账本数据只保存在当前浏览器的 IndexedDB 中，不上传服务器；本地账户注册登录，每个用户拥有独立账本。

## 能做什么

- **总览**：研发目的与全部功能说明、总余额、本月收支、目标预留、未来 30 天余额曲线、今日待办、账户分布。
- **流水**：按月筛选、搜索、分类过滤；表单记账；一句话本地规则解析快速记账；编辑/删除（删除计划关联流水会恢复该期待发生状态）。
- **计划**：固定收支按月/周/年/日推导；核销写入真实流水；跳过、仅本次改期、停用/启用、编辑并按「从下一期起」拆分规则。
- **洞察**：周期支出候选（同商户/金额稳定/间隔稳定）、异常消费（MAD 稳健 Z，MAD=0 回退 IQR 或倍数规则）、小额高频统计；每条结论都给出证据并可忽略/确认。
- **预测**：同星期中位数 → 月预算日均 → 近期日均 → 「未估计」的四级可变消费模型；安全储备风险线；同日「支出先于收入」覆盖检查；假设与数据来源可见。
- **决策沙盘**：基准 / 立即购买 / 延期购买 / 分阶段预留后购买，四条路径共用预测引擎；给出最早安全购买日、最低余额、购买时已预留金额与结论限制；方案可保存复用。
- **目标**：目标 CRUD、预留/释放/消费（预留只是资金 earmark，不改变账户余额）；均衡/期限优先/重要性优先三种分配策略；按月滚动 24 个月完成推演。
- **AI 分析**：用户自带 API 地址与密钥（OpenAI 兼容，官方或中转均可），把本机账本摘要发给用户指定的模型进行对话分析；密钥只存本机。
- **数据中心**：JSON 完整备份与校验后恢复、CSV 导出（UTF-8 BOM + 公式注入防护）、预测快照、滚动回测、校准状态与记录、重置账本。
- **设置**：安全储备、月可变预算、月储蓄上限、目标分配日、小额阈值/窗口、异常窗口/样本/阈值、周期容差/金额波动上限、历史覆盖区间、账户新增、清除本机全部数据。

桌面端使用左侧导航，移动端使用底部主导航 + 「更多」抽屉；页面在 390px 宽度下可用。

## 技术栈

React 19 · TypeScript 7（strict）· Vite 8 · Tailwind CSS 4 · ECharts 6 · Dexie 4（IndexedDB）· Zustand 5 · React Router 7（HashRouter）· Zod 4 · Vitest 5 · Playwright 1.65。

金额统一以**整数分**存储和计算；日期使用本地 `YYYY-MM-DD` 字符串，解析时锚定中午，避免时区跨日。

## 快速开始

```bash
cd moneyflow
npm install
npm run dev
```

打开终端输出的地址（默认 `http://localhost:5173`）。首次进入先注册本地账户，登录后按引导建立账户与安全储备线；之后可在总览页查看系统用途与全部功能说明。

其他命令：

```bash
npm run typecheck     # tsc --noEmit
npm test              # Vitest 单元测试
npm run build         # 类型检查 + 生产构建到 dist/
npm run preview       # 预览生产构建
npx playwright install chromium chromium-headless-shell
npm run test:e2e      # Playwright 端到端测试（自动启动 5174 端口）
```

## 本地账户与数据重置

- 账户注册与登录完全在本机完成：密码经 PBKDF2-SHA256 加盐哈希后存入 IndexedDB，不保存明文、不上传。
- 每个用户使用独立的 Dexie 数据库（`moneyflow-user-<id>`），新注册用户从空账本开始，不会继承其他账号或旧版本数据。
- 本版本首次启动会自动清理旧版遗留的本机数据（含旧账户、旧账本与演示库）。
- 设置页提供「清除本机全部数据」，清除后回到登录页；换设备或清理浏览器前请先在数据中心导出备份。

## 数据与隐私

- 每个用户使用独立 Dexie 数据库；同一浏览器的多个账户互不影响。
- 写入通过 Zustand + 事务式批量写完成，使用 `navigator.locks` 串行化写入，`BroadcastChannel` 同步多标签页刷新。
- 备份 JSON 在导入前做结构、金额、引用完整性校验，预览通过后才允许覆盖。
- 项目源码不包含任何密钥、真实账单或个人信息。请勿把导出的备份提交到公开仓库。

## 目录结构

```text
moneyflow/
  src/
    components/        应用壳、通用 UI、图表、交易表单、引导页
    data/              本地账户、默认分类与设置、数据清理
    domain/            纯领域逻辑（无 React/DB 依赖）
      forecasting/     统一预测引擎与可变消费模型
      allocation/      多目标分配与水位数分配
      insights/        周期、异常、小额洞察
      sandbox.ts       四路径消费决策沙盘
      calibration.ts   快照校准与滚动回测
      backup.ts        JSON 备份校验/恢复
      ledger.ts        余额、预留、覆盖区间校验
    pages/             10 个页面
    services/          Dexie 持久化、事务写入、快照服务、AI 接口
    store/             Zustand 应用状态
  tests/unit/          97 个领域/服务单元测试
  e2e/                 Playwright 端到端测试
  docs/                实现清单、算法、测试报告、部署与演示文档
```

## 文档

- [实现清单](docs/IMPLEMENTATION_CHECKLIST.md)
- [关键决策](docs/DECISIONS.md)
- [算法说明](docs/ALGORITHMS.md)
- [使用指南](docs/USER_GUIDE.md)
- [测试报告](docs/TEST_REPORT.md)
- [部署说明](docs/DEPLOYMENT.md)
- [演示脚本](docs/DEMO_SCRIPT.md)
- [已知限制](docs/KNOWN_LIMITATIONS.md)
- [社区分享草稿](docs/FORUM_POST.md)（未自动提交）

## 发布状态

已通过 Qoder Sites 发布为私有站点，未登录时会返回 401。发布地址与访问方式见[部署说明](docs/DEPLOYMENT.md)。

预测是规划参考，不构成收益承诺或消费建议。

## 团队协作

- `main` 分支保持可运行，不直接提交；
- 从最新 `main` 切出 `feature/功能名` 或 `fix/问题描述` 分支；
- 完成一个可运行的小改动就提交并推送，不要积攒大量改动；
- 通过 Pull Request 合并，至少一位队友 review；
- 每天开工前先拉取最新代码。

```bash
# 开工前
git switch main
git pull

# 开新分支开发
git switch -c feature/功能名
git add <文件>
git commit -m "feat: 完成某功能"
git push -u origin feature/功能名
```

提交信息约定：`feat:` 新功能、`fix:` 修复、`docs:` 文档、`refactor:` 重构、`chore:` 配置与依赖。
