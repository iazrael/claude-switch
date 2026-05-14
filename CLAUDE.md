# CLAUDE.md — claude-switch 开发指南

## 项目概述

Claude Code 套餐快速切换工具 (v3.3.0)，支持多服务商配置管理。提供 CLI 和 Web 两种操作模式，API Key 加密存储，操作自动备份和日志记录，serve 守护进程管理。

核心场景：在阿里云百炼、火山引擎、智谱AI、DeepSeek 等 Anthropic API 兼容服务商之间一键切换 Claude Code 的环境变量配置。

## 技术栈

- **运行时**: Node.js 24+ (ESM)
- **语言**: TypeScript (strict mode)
- **构建**: tsup (ESM output)
- **CLI 框架**: Commander.js + Inquirer.js
- **Web 框架**: Express + React 19 + Vite（前端组件化，开发时代理 /api 到后端）
- **加密**: Node.js 内置 `crypto`，AES-256-CBC（增强密钥派生：machineId + 硬件特征 + salt）
- **文件操作**: fs-extra
- **并发保护**: proper-lockfile
- **测试**: Vitest (forks pool) + supertest
- **前端**: React 19 + Vite，CSS Modules，API 通过 Vite proxy 转发

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
frontend/
├── src/
│   ├── App.tsx             根组件
│   ├── main.tsx            入口
│   ├── components/         UI 组件（ProfileItem, Modal, Toast 等）
│   ├── hooks/              自定义 Hook（useProfiles, useBackups 等）
│   ├── context/            React Context（AppContext）
│   ├── styles/             CSS Modules
│   ├── types/              前端类型定义
│   └── utils/              API 请求工具
├── vite.config.ts          Vite 配置（开发 proxy → :3333）
└── tsconfig.json
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

# 开发模式（前后端同时启动，使用 concurrently）
pnpm dev                       # 同时启动后端 (tsx) + 前端 (vite dev)

# 单独启动
pnpm dev:backend               # 仅后端 (tsx src/server.ts)
pnpm dev:frontend              # 仅前端 (vite dev, proxy → :3333)

# CLI 开发模式（使用 tsx 直接运行 TypeScript）
tsx src/index.ts              # 无参数进入交互式切换
tsx src/index.ts list         # 列出套餐
tsx src/index.ts add my-pro   # 添加套餐

# 构建后运行
pnpm build                    # 构建：tsup(后端) + vite(前端) → dist/
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
pnpm build              # 构建：tsup(后端) → dist/ + vite(前端) → dist/public/
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
9. **前端**: React 19 + Vite，CSS Modules，开发时 Vite proxy 转发 /api
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
| 前端 React 组件化 | 原生三文件已无法支撑交互复杂度，React + Vite 提供更好的开发体验 |

## v3.3.0 变更：edit CLI + copy CLI

### updateProfile 语义增强

v3.3.0 增强了 `updateProfile` 的合并语义，使其同时支持 CLI edit 和 API update 场景：

| 输入值 | 行为 | 说明 |
|--------|------|------|
| `undefined` | 跳过 | 未传入的字段不修改 |
| `''`（空字符串） | 清除 | 删除该字段 |
| 非空字符串 | 更新 | 覆写该字段 |

旧版行为（只处理非空值，空值跳过）已废弃。新语义由 CLI edit 命令和 Web API 共用。

### profile-manager.ts 新增导出

```typescript
// 复制套餐：深拷贝源套餐到目标名
export async function copyProfile(
  source: string,
  target: string
): Promise<void>
```

### copyProfile 实现要点

1. `withLock` 内读取解密数据
2. 源套餐不存在 → 抛 `Error('套餐 "xxx" 不存在')`
3. 深拷贝源 env：`{ ...sourceEnv }` 展开后逐字段复制
4. 写入目标名（如果目标已存在则覆盖，由 CLI 层负责确认）
5. 调用 `saveProfilesSafe` + `logAction('copy', ...)`

### index.ts 新增命令

```typescript
// edit 命令（底层调用 updateProfile）
program
  .command('edit [name]')
  .alias('ed')
  .description('编辑套餐')
  .action(editProfileUI);

// copy 命令
program
  .command('copy [source] [target]')
  .alias('cp')
  .description('复制套餐')
  .option('--exact', '纯复制，不进入编辑')
  .action(copyProfileUI);
```

### editProfileUI 交互流程

1. 未指定 name → `getAllProfileNames` + Inquirer list
2. 读取当前套餐 env（解密，Token 显示 `***`）
3. Inquirer checkbox 多选要编辑的字段
4. 对选中字段逐个 input（默认值=当前值，Token 默认值=`***`）
5. 构建 `updates: Partial<ClaudeEnv>`，只包含实际修改的字段
6. 调用 `manager.updateProfile(name, updates)`

### copyProfileUI 交互流程

1. 确定源（未指定 → Inquirer list 选择）
2. 确定目标名（未指定 → Inquirer input）
3. 目标已存在 → Inquirer confirm 覆盖
4. 调用 `manager.copyProfile(source, target)`
5. 非 `--exact` 模式 → 直接进入 editProfileUI(target)

## 模型分层参考

Claude Code 使用三级模型分工，套餐管理的核心环境变量：

| 变量 | 角色 | 用途 |
|---|---|---|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | 复杂任务 | 架构设计、核心算法 |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | 日常主力 | 开发、Bug 修复 |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 轻量高频 | 快速补全、格式化 |
| `ANTHROPIC_AUTH_TOKEN` | 认证 | API Key（加密存储） |
| `ANTHROPIC_BASE_URL` | 端点 | 服务商 API 地址 |
