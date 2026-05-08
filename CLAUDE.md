# CLAUDE.md — claude-switch 项目指南

## 项目概述

Claude Code 套餐快速切换工具 (v3.0.0)，支持多服务商配置管理。提供 CLI 和 Web 两种操作模式，API Key 加密存储，操作自动备份和日志记录，serve 守护进程管理。

核心场景：在阿里云百炼、火山引擎、智谱AI、DeepSeek 等 Anthropic API 兼容服务商之间一键切换 Claude Code 的环境变量配置。

## 技术栈

- **运行时**: Node.js（无 ESM，全部 CommonJS）
- **CLI 框架**: Commander.js + Inquirer.js
- **Web 框架**: Express + 原生 HTML/CSS/JS（三文件结构，无构建步骤）
- **加密**: Node.js 内置 `crypto`，AES-256-CBC（增强密钥派生：machineId + 硬件特征 + salt）
- **文件操作**: fs-extra
- **测试**: Vitest (forks pool) + supertest
- **前端**: 零依赖原生 JS，暗色模式通过 CSS `prefers-color-scheme` 实现

## 项目架构

```
index.js                 CLI 入口（Commander 命令定义 + Inquirer 交互 + serve 子命令注册）
server.js                Web 服务器（Express，端口通过 CLAUDE_SWITCH_PORT 配置，默认 3333）
lib/
├── config.js            路径常量（支持 CLAUDE_SWITCH_DIR / CLAUDE_SETTINGS_PATH 环境变量覆盖，新增 PID_PATH / SERVER_LOG_PATH）
├── crypto-utils.js      AES-256-CBC 加解密（增强密钥派生：machineId + 硬件特征 + salt）
├── profile-manager.js   核心业务（套餐 CRUD、切换、迁移、预设模板、备份预览）
├── backup.js            文件级备份与还原（含原因标注）
├── diff.js              JSON diff 工具（敏感字段脱敏）
├── logger.js            按日追加的操作日志
└── serve.js             守护进程管理（PID 管理、日志轮转、前台/后台启动、停止、状态检查）
public/
├── index.html           HTML 结构（含 <link>/<script> 引用）
├── styles.css           CSS 样式（暗色模式，prefers-color-scheme）
└── app.js               前端逻辑（零依赖原生 JS，SPA）
tests/
├── index.test.js        集成测试（Profile Manager + Crypto + API Endpoints）
└── serve.test.js        serve 命令测试（PID 管理、端口解析、启动/停止/状态）
```

**数据流**:
- `profiles.json`（加密存储）← `profile-manager` ↔ `crypto-utils`
- `settings.json`（Claude Code 配置）← `switchProfile` 合并写入
- 所有写操作 → `backup` 自动备份 + `logger` 追加日志

## 开发指南

### 运行

```bash
pnpm install
# CLI 模式
node index.js              # 无参数进入交互式切换
node index.js list         # 列出套餐
node index.js add my-pro   # 添加套餐

# Web 模式（直接启动，进程阻塞）
CLAUDE_SWITCH_PORT=8080 node server.js  # 自定义端口
node server.js                        # 默认 http://localhost:3333

# serve 守护进程模式（PID 管理、后台运行）
node index.js serve                    # 后台启动（daemon）
node index.js serve --foreground       # 前台启动
node index.js serve stop               # 停止服务
node index.js serve status             # 查看状态
```

### 测试

```bash
# 运行全部测试（使用 forks pool，因为测试涉及文件系统和环境变量）
pnpm test

# 监听模式
pnpm test:watch
```

测试使用 `process.env.CLAUDE_SWITCH_DIR` 重定向数据目录到临时目录，避免污染真实数据。

### 调试

- 日志文件位于 `~/.claude-switch/logs/YYYY-MM-DD.log`
- 备份文件位于 `~/.claude-switch/backups/`
- 守护进程日志位于 `~/.claude-switch/server.log`（超过 10MB 自动轮转为 `.old`）
- PID 文件位于 `~/.claude-switch/server.pid`，记录 PID、端口、启动时间
- 加密后的 profiles.json 可直接查看，Token 字段格式为 `base64IV:base64Ciphertext`

## 代码规范与约定

1. **CommonJS**: 所有模块使用 `require/module.exports`，无 ESM
2. **async/await**: 所有文件 I/O 操作使用 async 函数
3. **错误处理**: 业务层抛 `Error`（带中文消息），Express 路由层 catch 后返回 `{ error }` JSON
4. **文件权限**: 配置文件写入后立即 `chmod 600`
5. **脱敏**: API 列表接口对 `ANTHROPIC_AUTH_TOKEN` 替换为 `••••••••`，Web 端不提供获取明文 Key 的接口；编辑时占位符显示，新值覆盖、留空保留
6. **合并策略**: `switchProfile` 只覆写套餐定义的变量，保留 settings.json 中的其他环境变量
7. **前端**: HTML/CSS/JS 三文件分离，无框架无构建，API 前缀 `/api`，Toast 提示代替 alert

## 关键设计决策

| 决策 | 原因 |
|---|---|
| AES-256-CBC + 本机特征派生密钥 | 平衡安全与便利：本机使用无需输入密码，文件泄露不可解密 |
| 合并写入而非覆盖 | 保护用户在 settings.json 中的自定义变量不被套餐切换清空 |
| 每次保存前自动备份 | 误操作可一键还原，零风险 |
| 预设模板硬编码 | 厂商 URL 和模型映射变化频率低，硬编码最简单可靠 |
| serve 守护进程 | 通过 PID 文件 + spawn detached 子进程实现后台运行，支持优雅关闭和日志轮转 |
| 前端三文件分离 | 项目体量适中，HTML/CSS/JS 分离便于维护，无构建链降低复杂度 |
| try-decrypt 迁移检测 | 替代脆弱的 `!includes(':')` 判断，解密结果等于原文则视为明文 |

## 已知问题与改进建议

### ✅ 已修复问题

1. ~~**明文 API Key 接口**~~: 已移除 `GET /api/profiles/:name/plain`，编辑改为 PUT 合并更新
2. ~~**路径穿越**~~: `restoreFile`/`listBackups` 已加 type 白名单 + 文件名校验
3. ~~**密钥派生熵低**~~: 已增强为 machineId + hostname + platform + arch + totalmem + cpu + salt
4. ~~**SETTINGS_PATH 不可覆盖**~~: 支持 `CLAUDE_SETTINGS_PATH` 环境变量
5. ~~**备份无限增长**~~: 自动清理，保留最近 20 份
6. ~~**日志无轮转**~~: 自动清理，保留 30 天
7. ~~**明文检测逻辑**~~: 改为 try-decrypt 判断
8. ~~**type 参数未校验**~~: 已加白名单
9. ~~**前端 XSS**~~: innerHTML 全改 textContent
10. ~~**Express body 无限制**~~: 已设 1mb limit
11. ~~**CLI 异常未兜底**~~: 无参入口已加 try-catch
12. ~~**当前套餐误标**~~: 改为全量 env 对比（BASE_URL + 三个模型名），不再只对比 SONNET_MODEL
13. ~~**另存为丢失 API Key**~~: 新增 clone API 在服务端复制真实 token，前端不接触明文

### 🟡 待改进

1. **Web 端无认证**: 所有 API 端点无认证机制，依赖局域网隔离，不建议公网暴露。

### 测试覆盖不足

- `switchProfile` 的实际写入行为测试待增强（SETTINGS_PATH 已支持环境变量覆盖）
- `restoreFile` 还原流程未被测试
- 并发操作场景未测试
- `migrateIfNeeded` 迁移逻辑未单独测试
- CLI 各命令的集成测试缺失
- 前端功能无自动化测试

> **已覆盖**: serve 命令 22 个测试（PID 管理、端口解析、前台/后台启动、停止、状态、日志轮转、信号处理）

## 模型分层参考

Claude Code 使用三级模型分工，套餐管理的核心环境变量：

| 变量 | 角色 | 用途 |
|---|---|---|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | 复杂任务 | 架构设计、核心算法 |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | 日常主力 | 开发、Bug 修复 |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 轻量高频 | 快速补全、格式化 |
| `ANTHROPIC_AUTH_TOKEN` | 认证 | API Key（加密存储） |
| `ANTHROPIC_BASE_URL` | 端点 | 服务商 API 地址 |
