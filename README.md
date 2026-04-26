# Codex Local Account Switcher

一个本地 macOS 桌面工具，用来管理多个 OpenAI Codex CLI 登录态快照，并快速切换账号。

它只操作本机文件，不上传 `auth.json`、token、cookie 或账号信息。

## 功能

- 保存当前 Codex 登录态为账号快照。
- 在多个账号快照之间一键切换。
- 切换前自动备份当前 `~/.codex/auth.json`。
- 显示当前登录态和账号快照状态，不展示敏感内容。
- 手动记录 Codex 额度剩余、重置时间和备注。（无法获取具体额度信息）
- 打开 ChatGPT Codex Usage 页面。
- 诊断切换后 Codex 启动慢、卡封面等问题。
- 可选备份并重置 Codex App 本地会话缓存。

## 安装

```bash
git clone <your-repo-url>
cd codex-local-account-switcher
npm install
```

## 运行

开发模式：

```bash
npm run dev
```

构建：

```bash
npm run build
```

检查：

```bash
npm run typecheck
npm audit --audit-level=high
```

## 使用方法

### 1. 先登录 Codex

先通过官方方式完成 Codex 登录：

```bash
codex login
```

登录后本机会生成：

```text
~/.codex/auth.json
```

### 2. 保存当前账号

打开应用，在左侧输入账号昵称，例如：

```text
work
personal
account_1
```

点击“保存”，应用会把当前 `~/.codex/auth.json` 保存为：

```text
~/.codex/accounts/<昵称>.json
```

### 3. 切换账号（自我测试好像两个账号切换是没有问题的，三个及其以上可能会有问题）

在账号列表中选择一个快照，点击“切换到此账号”。

应用会先备份当前 `auth.json`，再把选中的快照复制为新的：

```text
~/.codex/auth.json
```

切换完成后，请重启 Codex CLI / Codex App / IDE 插件。即可自动切换账号（自我测试有时候可能会过期，如果过期就重新登一下然后保存一下相关信息就行）

### 4. 记录额度

目前 Codex 额度没有稳定公开的自动查询 API，所以应用提供手动记录：

- 5 小时额度剩余
- 周额度剩余
- 重置时间
- 备注

记录保存在本机：

```text
~/.codex/usage-cache.json
```

## 安全提醒

- `auth.json` 和 `~/.codex/accounts/*.json` 等同于密码级敏感文件。
- 不要把真实账号快照提交到 GitHub。
- 不要把 token、cookie、`auth.json` 内容贴到 issue 或截图里。
- 本工具不保存 OpenAI 账号密码。
- 本工具不绕过 OpenAI 登录流程或额度限制。

## 常见问题

### 切换后 Codex App 一直卡在封面怎么办？

先完全退出 Codex App，再切换账号，然后重新打开。

如果仍然卡住，可以在应用里点击“诊断启动慢”。确认 Codex App 已退出后，再使用“备份并重置 App 会话缓存”。

这个操作只会把本机 Codex App 缓存移动到：

```text
~/.codex/app-session-backups/
```

不会读取、显示或上传缓存内容。
