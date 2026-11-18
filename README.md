# Team

三人团队协作仓库。

## 项目简介

待补充：项目目标、要解决的问题、预期成果。

## 目录结构

待补充：确定技术栈后补充各目录用途。

## 本地开发

待补充：技术栈确定后补充环境要求、安装依赖和启动命令。

## 协作流程

1. `main` 分支始终保持可运行，不直接提交。
2. 每次改动从最新 `main` 切出 `feature/功能名` 或 `fix/问题描述` 分支。
3. 完成一个可运行的小改动就提交并推送，不要积攒大量改动。
4. 在 GitHub 上发起 Pull Request，至少一位队友 review 后合并。
5. 每天开工前先拉取最新代码。

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

## 提交信息约定

- `feat:` 新功能
- `fix:` 修复问题
- `docs:` 文档
- `refactor:` 重构，不改变功能
- `chore:` 配置、依赖等杂项

## 队友接入

1. 在 GitHub 接受仓库协作邀请。
2. 在自己电脑生成 SSH 密钥，把**公钥**添加到自己的 GitHub 账号（Settings → SSH and GPG keys），不要使用他人的密钥。
3. 克隆仓库：

```bash
git clone git@github.com:li3046320157/Team.git
```

## 注意

- 不要提交依赖目录、构建产物、`.env` 等本地文件，规则见 `.gitignore`。
- 三人尽量按模块分工，避免同时修改同一个文件。
