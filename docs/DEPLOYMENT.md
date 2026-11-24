# 部署说明

MoneyFlow 是纯前端单页应用：所有账本数据保存在浏览器 IndexedDB 中，构建产物是静态文件，不需要数据库或后端服务。

## 本地开发

```bash
cd moneyflow
npm install
npm run dev
```

默认地址为 `http://127.0.0.1:5173/`。若端口被占用，Vite 会提示实际端口。

## 本地预览生产构建

```bash
npm run build
npm run preview
```

`npm run build` 输出到 `dist/`。可以直接用任意静态服务器托管，例如：

```bash
npx serve dist
```

## 部署到静态托管

1. 执行 `npm run build`；
2. 将 `dist/` 目录整体上传到托管服务；
3. 无需配置服务端路由：应用使用 HashRouter（`/#/...`），刷新任意页面都能回到 `index.html`。

适用于 GitHub Pages、Cloudflare Pages、Netlify、Vercel、对象存储静态站点等。若托管在子路径（如 `https://example.com/moneyflow/`），需要在 `vite.config.ts` 中设置 `base: '/moneyflow/'` 后重新构建。

## Qoder Sites 发布记录

本项目已通过 Qoder Sites 发布：

| 项 | 值 |
| --- | --- |
| 站点地址 | `https://moneyflow-cashflow-gaolmlqh78h.qoder.zone` |
| 发布状态 | 已发布（`published: true`） |
| 访问模式 | **私有**（`access_mode: private`） |
| 就绪状态 | `publication_completed` |

重要说明：

- 该地址**需要登录 Qoder 后才能访问**。未登录的匿名请求会返回 `401 Unauthorized`（响应头 `x-qoder-error: sites_gateway_login_required`）。这是私有站点的预期行为，不代表部署失败。
- 本站没有改为公开访问；如需分享给他人，请在 Qoder Sites 中调整访问策略，并确认这样做不会暴露任何真实账单数据。
- 站点使用的仍是浏览器本地存储：部署后每个访问者看到的是自己浏览器中的数据，示例数据可以随时从引导页重新生成。

## 发布产物与配置

- `.MoneyFlow 钱流.qoder.site` 是 Qoder Sites 生成的站点描述文件，由工具维护，请勿手工编辑。
- 设计变量已在 `src/index.css` 中实现：`--site-bg`、`--site-fg`、`--site-accent`、`--site-on-accent`、`--site-surface`、`--site-muted`、`--site-border`、`--site-font`、`--site-radius`、`--site-space`、`--site-type`、`--site-motion`。
- 站点注册的页面与能力与实际实现一致；未声明未实现的能力。

## 安全与隐私检查清单

发布前应确认：

- 仓库与构建产物中不包含真实账单、个人信息、密钥或 `.env` 文件；
- 示例数据由固定种子生成，明确标注为合成数据；
- 备份 JSON 仅用于本人迁移，不要上传到公开仓库或公共网盘；
- 私有站点不要随意改为公开；
- `dist/`、`test-results/`、`playwright-report/` 等生成目录不提交。

## 回滚

静态托管可直接回滚到上一个构建产物。Qoder Sites 场景下重新发布上一版本源码即可；账本数据保存在用户浏览器中，不会因重新部署而丢失（但清理站点数据会丢失，务必先导出 JSON 备份）。