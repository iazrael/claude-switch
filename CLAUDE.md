# CLAUDE.md — claude-switch 开发指南

## 项目概述

Claude Code 套餐快速切换工具 (v3.1.0)，支持多服务商配置管理。提供 CLI 和 Web 两种操作模式，API Key 加密存储，操作自动备份和日志记录，serve 守护进程管理。

核心场景：在阿里云百炼、火山引擎、智谱AI、DeepSeek 等 Anthropic API 兼容服务商之间一键切换 Claude Code 的环境变量配置。

## 技术栈

- **运行时**: Node.js 24+ (ESM)
- **语言**: TypeScript (strict mode)
- **构建**: tsup (ESM output)
- **CLI 框架**: Commander.js + Inquirer.js
- **Web 框架**: Express + 原生 HTML/CSS/JS（三文件结构，无构建步骤）
- **加密**: Node.js 内置 `crypto`，AES-256-CBC（增强密钥派生：machineId + 硬件特征 + salt）
- **文件操作**: fs-extra
- **并发保护**: proper-lockfile
- **测试**: Vitest (forks pool) + supertest
- **前端**: 零依赖原生 JS，暗色模式通过 CSS `prefers-color-scheme` 实现

## 项目架构

```
src/
├── index.ts                CLI 入口（Commander 命令定义 + Inquirer 交互 + serve 子命令）
├── server.ts               Web 服务器（Express，端口通过 CLAUDE_SWITCH_PORT 配置）
├── env.d.ts                环境变量类型声明
└── lib/
    ├── config.ts           路径常量（支持环境变量覆盖）
    ├── crypto-utils.ts     AES-256-CBC 加解密（增强密钥派生）
    ├── profile-manager.ts  核心业务（套餐 CRUD、切换、迁移、预设模板）
    ├── backup.ts           文件级备份与还原（含原因标注）
    ├── diff.ts             JSON diff 工具（敏感字段脱敏）
    ├── logger.ts           按日追加的操作日志
    ├── serve.ts            守护进程管理（PID 管理、日志轮转）
    └── types.ts            TypeScript 类型定义
public/
├── index.html              HTML 结构
├── styles.css              CSS 样式（暗色模式）
└── app.js                  前端逻辑（零依赖原生 JS）
tests/
├── index.test.ts           集成测试
└── serve.test.ts           serve 命令测试
tsconfig.json               TypeScript 配置（strict, NodeNext）
tsup.config.ts              构建配置（ESM, minify, sourcemap）
vitest.config.ts            测试配置
```

**数据流**:
- `profiles.json`（加密存储）← `profile-manager` ↔ `crypto-utils`
- `settings.json`（Claude Code 配置）← `switchProfile` 合并写入
- 所有写操作 → `backup` 自动备份 + `logger` 追加日志

## 开发指南

### 运行

```bash
pnpm install

# 开发模式（使用 tsx 直接运行 TypeScript）
tsx src/index.ts              # 无参数进入交互式切换
tsx src/index.ts list         # 列出套餐
tsx src/index.ts add my-pro   # 添加套餐

# 构建后运行
pnpm build                    # 构建到 dist/
node dist/index.js            # 运行构建后的 CLI

# serve 服务管理
tsx src/index.ts serve                    # 后台启动（默认端口 3333）
tsx src/index.ts serve --foreground       # 前台启动
tsx src/index.ts serve -p 4444            # 指定端口
tsx src/index.ts serve stop               # 停止服务
tsx src/index.ts serve status             # 查看状态
```

### 测试

```bash
# 运行全部测试（使用 forks pool，因为测试涉及文件系统和环境变量）
pnpm test

# 监听模式
pnpm test:watch
```

测试使用 `process.env.CLAUDE_SWITCH_DIR` 重定向数据目录到临时目录，避免污染真实数据。

### 构建

```bash
pnpm build              # 构建到 dist/
                        # 输出: dist/index.js, dist/server.js, dist/lib/*.js
                        # 同时复制 public/ 和 package.json 到 dist/
```

### 调试

- 日志文件位于 `~/.claude-switch/logs/YYYY-MM-DD.log`
- 备份文件位于 `~/.claude-switch/backups/`
- 守护进程日志位于 `~/.claude-switch/server.log`（超过 10MB 自动轮转为 `.old`）
- PID 文件位于 `~/.claude-switch/server.pid`，记录 PID、端口、启动时间
- 加密后的 profiles.json 可直接查看，Token 字段格式为 `base64IV:base64Ciphertext`

## 代码规范与约定

1. **ESM + TypeScript**: 所有模块使用 ESM `import/export`，TypeScript strict mode
2. **导入路径**: 本地导入使用 `.js` 扩展名（ESM 要求，即使源文件是 `.ts`）
3. **async/await**: 所有文件 I/O 操作使用 async 函数
4. **类型安全**: 禁止 `any` 类型，使用 `unknown` + 安全断言 `(err as Error).message`
5. **错误处理**: 业务层抛 `Error`（带中文消息），Express 路由层 catch 后返回 `{ error }` JSON
6. **文件权限**: 配置文件写入后立即 `chmod 600`
7. **脱敏**: API 列表接口对 `ANTHROPIC_AUTH_TOKEN` 替换为 `••••••••`
8. **合并策略**: `switchProfile` 只覆写套餐定义的变量，保留 settings.json 中的其他环境变量
9. **前端**: HTML/CSS/JS 三文件分离，无框架无构建，API 前缀 `/api`
10. **空 catch 块**: 必须添加注释说明忽略原因

## 类型系统

核心类型定义在 `src/lib/types.ts`：

```typescript
interface ClaudeEnv {
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
}

interface Profile {
  env: ClaudeEnv;
}

interface ProfileData {
  active: string;
  profiles: Record<string, Profile>;
}

interface SettingsJson {
  env?: Record<string, string | undefined>;
  [key: string]: unknown;
}

interface PresetTemplate {
  label: string;
  baseUrl: string;
  opus: string;
  sonnet: string;
  haiku: string;
}

interface PidInfo {
  pid: number;
  port: number;
  startedAt: string;  // ISO-8601 格式
}

interface DiffChange {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}
```

## 关键设计决策

| 决策 | 原因 |
|---|---|
| TypeScript strict mode | 类型安全，消除 `any`，IDE 支持更好 |
| ESM + NodeNext | 现代 Node.js 标准，tsup 构建简单 |
| AES-256-CBC + 本机特征派生密钥 | 平衡安全与便利：本机使用无需输入密码，文件泄露不可解密 |
| proper-lockfile 文件锁 | 防止并发写入冲突，保护数据完整性 |
| 合并写入而非覆盖 | 保护用户在 settings.json 中的自定义变量不被套餐切换清空 |
| 每次保存前自动备份 | 误操作可一键还原，零风险 |
| 预设模板硬编码 | 厂商 URL 和模型映射变化频率低，硬编码最简单可靠 |
| serve 守护进程 | 通过 PID 文件 + spawn detached 子进程实现后台运行 |
| 前端三文件分离 | 项目体量适中，无构建链降低复杂度 |

## 已知问题与改进建议

### ✅ 已修复问题（v3.1.0）

1. ~~**明文 API Key 接口**~~: 已移除，编辑改为 PUT 合并更新
2. ~~**路径穿越**~~: 已加 type 白名单 + 文件名校验
3. ~~**密钥派生熵低**~~: 已增强为 machineId + 硬件特征 + salt
4. ~~**SETTINGS_PATH 不可覆盖**~~: 支持 `CLAUDE_SETTINGS_PATH` 环境变量
5. ~~**备份无限增长**~~: 自动保留最近 20 份
6. ~~**日志无轮转**~~: 自动保留 30 天
7. ~~**CommonJS 模块**~~: 已迁移到 ESM + TypeScript
8. ~~**any 类型泛滥**~~: 全部替换为 `unknown` + 安全断言
9. ~~**前端 XSS**~~: innerHTML 全改 textContent
10. ~~**当前套餐误标**~~: 改为全量 env 对比（BASE_URL + 三个模型名）

### 🟡 待改进

1. **Web 端无认证**: 所有 API 端点无认证机制，依赖局域网隔离

### 测试覆盖

- ✅ Profile Manager: 24 个测试
- ✅ Crypto Utils: 5 个测试
- ✅ Diff Utils: 8 个测试
- ✅ Preset Templates: 2 个测试
- ✅ API Endpoints: 19 个测试
- ✅ Serve 命令: 22 个测试
- **总计**: 82 个测试通过

## 模型分层参考

Claude Code 使用三级模型分工，套餐管理的核心环境变量：

| 变量 | 角色 | 用途 |
|---|---|---|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | 复杂任务 | 架构设计、核心算法 |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | 日常主力 | 开发、Bug 修复 |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 轻量高频 | 快速补全、格式化 |
| `ANTHROPIC_AUTH_TOKEN` | 认证 | API Key（加密存储） |
| `ANTHROPIC_BASE_URL` | 端点 | 服务商 API 地址 |
