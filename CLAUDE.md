# CLAUDE.md — claude-switch 项目指南

## 项目概述

Claude Code 套餐快速切换工具 (v2.0.0)，支持多服务商配置管理。提供 CLI 和 Web 两种操作模式，API Key 加密存储，操作自动备份和日志记录。

核心场景：在阿里云百炼、火山引擎、智谱AI、DeepSeek 等 Anthropic API 兼容服务商之间一键切换 Claude Code 的环境变量配置。

## 技术栈

- **运行时**: Node.js（无 ESM，全部 CommonJS）
- **CLI 框架**: Commander.js + Inquirer.js
- **Web 框架**: Express + 原生 HTML/CSS/JS（无构建步骤的单文件 SPA）
- **加密**: Node.js 内置 `crypto`，AES-256-CBC
- **文件操作**: fs-extra
- **测试**: Vitest (forks pool) + supertest
- **前端**: 零依赖原生 JS，暗色模式通过 CSS `prefers-color-scheme` 实现

## 项目架构

```
index.js                 CLI 入口（Commander 命令定义 + Inquirer 交互）
server.js                Web 服务器（Express，端口 3333）
lib/
├── config.js            路径常量（支持 CLAUDE_SWITCH_DIR 环境变量覆盖）
├── crypto-utils.js      AES-256-CBC 加解密（基于本机特征派生密钥）
├── profile-manager.js   核心业务（套餐 CRUD、切换、迁移、预设模板）
├── backup.js            文件级备份与还原
└── logger.js            按日追加的操作日志
public/
└── index.html           单文件 SPA（含 HTML + CSS + JS，约 400 行）
tests/
└── index.test.js        集成测试（Profile Manager + Crypto + API Endpoints）
```

**数据流**:
- `profiles.json`（加密存储）← `profile-manager` ↔ `crypto-utils`
- `settings.json`（Claude Code 配置）← `switchProfile` 合并写入
- 所有写操作 → `backup` 自动备份 + `logger` 追加日志

## 开发指南

### 运行

```bash
npm install
# CLI 模式
node index.js              # 无参数进入交互式切换
node index.js list         # 列出套餐
node index.js add my-pro   # 添加套餐

# Web 模式
node server.js             # http://localhost:3333
```

### 测试

```bash
# 运行全部测试（使用 forks pool，因为测试涉及文件系统和环境变量）
npm test

# 监听模式
npm run test:watch
```

测试使用 `process.env.CLAUDE_SWITCH_DIR` 重定向数据目录到临时目录，避免污染真实数据。

### 调试

- 日志文件位于 `~/.claude-switch/logs/YYYY-MM-DD.log`
- 备份文件位于 `~/.claude-switch/backups/`
- 加密后的 profiles.json 可直接查看，Token 字段格式为 `base64IV:base64Ciphertext`

## 代码规范与约定

1. **CommonJS**: 所有模块使用 `require/module.exports`，无 ESM
2. **async/await**: 所有文件 I/O 操作使用 async 函数
3. **错误处理**: 业务层抛 `Error`（带中文消息），Express 路由层 catch 后返回 `{ error }` JSON
4. **文件权限**: 配置文件写入后立即 `chmod 600`
5. **脱敏**: API 列表接口对 `ANTHROPIC_AUTH_TOKEN` 替换为 `••••••••`，编辑接口 `/plain` 返回真实值
6. **合并策略**: `switchProfile` 只覆写套餐定义的变量，保留 settings.json 中的其他环境变量
7. **前端**: 单文件 SPA，无框架无构建，API 前缀 `/api`，Toast 提示代替 alert

## 关键设计决策

| 决策 | 原因 |
|---|---|
| AES-256-CBC + 本机特征派生密钥 | 平衡安全与便利：本机使用无需输入密码，文件泄露不可解密 |
| 合并写入而非覆盖 | 保护用户在 settings.json 中的自定义变量不被套餐切换清空 |
| 每次保存前自动备份 | 误操作可一键还原，零风险 |
| 预设模板硬编码 | 厂商 URL 和模型映射变化频率低，硬编码最简单可靠 |
| 单文件 SPA | 项目体量小，不需要 React/Vue 构建链，降低维护成本 |
| 明文迁移检测 `!includes(':')` | 兼容 v1 旧数据：无冒号的是明文，有冒号的是密文 |

## 已知问题与改进建议

### 🔴 安全（建议优先处理）

1. **Web 端无认证**: 所有 API 端点无任何认证机制。局域网内任何人可读取/修改套餐配置，`GET /api/profiles/:name/plain` 可直接获取明文 API Key。建议：增加 Bearer Token 或 Local Auth Token 机制。
2. **备份文件名路径穿越**: `restoreFile(type, backupFileName)` 未校验 `backupFileName` 是否包含 `../`，攻击者可构造路径读取/覆盖任意文件。建议：校验文件名不含路径分隔符，或使用白名单。
3. **密钥派生熵低**: `getMachineKey()` 仅用 `hostname + username + platform + arch` 做 SHA-256，这些值高度可预测。如需更高安全性，应引入额外熵源（如机器 ID）。

### 🟡 架构（建议改进）

4. **SETTINGS_PATH 不可覆盖**: `config.js` 中只有 `BASE_DIR` 支持 `CLAUDE_SWITCH_DIR` 环境变量覆盖，`SETTINGS_PATH` 始终指向 `~/.claude/settings.json`，导致 `switchProfile` 无法在测试中完整验证（测试中该 case 实际是跳过的）。
5. **无文件锁**: 多进程/多标签页并发操作 profiles.json 可能导致数据竞争。建议使用 `proper-lockfile` 或类似方案。
6. **备份无限增长**: 每次保存都创建备份文件，无清理机制，长期使用会累积大量备份。建议：限制备份数量（如最多保留 20 份）或按时间清理。
7. **日志无轮转**: 日志按天一个文件，无自动清理，长期运行会占用磁盘。

### 🟢 代码质量（可选优化）

8. **明文检测逻辑脆弱**: `migrateIfNeeded` 用 `!env[key].includes(':')` 判断是否为明文，如果原始 API Key 恰好包含冒号则会被误判为已加密而跳过迁移。建议：使用独立标记字段（如 `_encrypted: true`）或固定前缀（如 `enc:`）。
9. **`type` 参数未校验**: `restoreFile(type, ...)` 和 `listBackups(type)` 接受任意字符串作为 type，非 `settings`/`profiles` 时行为未定义。建议：白名单校验。
10. **前端 XSS 风险**: `loadProfiles()` 中使用 `innerHTML` 拼接套餐名，如果套餐名包含 `<script>` 标签可导致 XSS。建议：使用 `textContent` 或转义 HTML。
11. **Express body size 无限制**: 未配置 `express.json({ limit })`，极端情况下大 body 可能导致内存问题。
12. **CLI 默认命令未 catch 异常**: `index.js` 末尾直接调用 `switchProfileUI()` 无 try-catch，未处理异常时 Node 会打印完整栈到终端。

### 测试覆盖不足

- `switchProfile` 的实际写入行为未被测试（因 SETTINGS_PATH 硬编码）
- `restoreFile` 还原流程未被测试
- 并发操作场景未测试
- `migrateIfNeeded` 迁移逻辑未单独测试
- CLI 各命令的集成测试缺失
- 前端功能无自动化测试

## 模型分层参考

Claude Code 使用三级模型分工，套餐管理的核心环境变量：

| 变量 | 角色 | 用途 |
|---|---|---|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | 复杂任务 | 架构设计、核心算法 |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | 日常主力 | 开发、Bug 修复 |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 轻量高频 | 快速补全、格式化 |
| `ANTHROPIC_AUTH_TOKEN` | 认证 | API Key（加密存储） |
| `ANTHROPIC_BASE_URL` | 端点 | 服务商 API 地址 |
