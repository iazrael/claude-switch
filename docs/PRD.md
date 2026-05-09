# Claude Switch - 产品规格说明书

> 版本：3.1.0 | 最后更新：2026-05-09

---

## 1. 产品概述

### 1.1 一句话描述

Claude Switch 是一个 Claude Code 套餐管理工具，帮助用户在多个 LLM 服务商之间一键切换，无需手动编辑配置文件。

### 1.2 解决的问题

使用 Claude Code 时，用户可能需要在多个 LLM 服务商之间切换（如阿里云百炼、火山引擎、智谱AI、DeepSeek 等）。每次切换需要手动编辑 `~/.claude/settings.json`，修改 API Key、Base URL、模型名称等多个字段，容易出错且效率低下。

### 1.3 目标用户

- 使用 Claude Code 的开发者
- 同时订阅多个 LLM 服务商的用户
- 需要在不同模型间频繁切换进行对比测试的用户

---

## 2. 核心概念

### 2.1 套餐（Profile）

一个套餐是一组完整的环境变量配置，包含：

| 字段 | 说明 | 示例 |
|---|---|---|
| `ANTHROPIC_AUTH_TOKEN` | API 密钥 | `sk-abc123...` |
| `ANTHROPIC_BASE_URL` | 服务端点 | `https://coding.dashscope.aliyuncs.com/apps/anthropic` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | 复杂任务模型 | `qwen3.5-max` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | 日常任务模型 | `qwen3.5-plus` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 轻量任务模型 | `qwen3.5-turbo` |

### 2.2 模型分层体系

Claude Code 内部使用三级模型分工，Claude Switch 完整支持这一体系：

```
┌─────────────────────────────────────────────┐
│              Opus（特级教师）                 │
│  负责复杂架构设计、核心算法、深度推理          │
├─────────────────────────────────────────────┤
│              Sonnet（高级教师）               │
│  日常开发主力：接口开发、Bug修复、重构        │
├─────────────────────────────────────────────┤
│              Haiku（实习老师）                │
│  轻量高频任务：语法检查、代码补全、格式化     │
└─────────────────────────────────────────────┘
```

通过映射到第三方模型，用户可以在不同服务商之间获得一致的使用体验。

### 2.3 预设模板

内置主流服务商的默认配置，用户选择厂商后自动填充 Base URL 和三档模型名称：

| 厂商 | Opus | Sonnet | Haiku |
|---|---|---|---|
| 阿里云百炼 | qwen3.5-max | qwen3.5-plus | qwen3.5-turbo |
| 火山引擎方舟 | doubao-1.5-pro-256k | doubao-1.5-pro-32k | doubao-1.5-lite-32k |
| 智谱AI | GLM-5.1 | glm-4.7 | glm-4.7 |
| DeepSeek | deepseek-reasoner | deepseek-chat | deepseek-chat |

---

## 3. 功能规格

### 3.1 套餐管理

#### F1: 添加套餐
- 用户通过 Web 界面填写套餐名称、API Key、Base URL 和三档模型名称
- 可选择厂商模板自动填充
- API Key 使用 AES-256-CBC 加密后存储
- 支持手动填写所有字段

#### F2: 编辑套餐
- 点击列表中的编辑按钮，加载该套餐的信息到表单
- API Key 在列表中脱敏显示（`••••••••`），编辑时显示占位符「保持不变」
- 用户输入新 Key 值则覆盖，留空保留原值
- 采用合并更新策略：前端提交的非空字段覆盖原值，空字段保留原值

#### F3: 删除套餐
- 删除前弹出确认提示
- 删除操作自动创建备份，支持还原
- 删除不存在的套餐返回错误提示

#### F4: 切换套餐
- 点击「切换」按钮，将该套餐的环境变量写入 `~/.claude/settings.json`
- 切换前自动备份当前 settings.json
- 将 `profiles.json` 的 `active` 字段更新为该套餐名称
- 提示用户重启 Claude Code 以使配置生效

### 3.2 安全

#### F5: API Key 加密存储
- 使用 AES-256-CBC 算法加密
- 密钥由增强机器特征派生（machineId + hostname + username + platform + arch + totalmem + cpu_model + salt）
- 加密密钥与机器硬件深度绑定，更换机器后需重新输入
- 加密格式：`IV:ciphertext`（Base64 编码）
- 首次启动自动迁移明文旧数据为加密存储

#### F6: 配置文件权限
- profiles.json 和 settings.json 权限设为 `600`（仅所有者可读写）

#### F7: Web 端脱敏
- 套餐列表 API 返回的 Token 统一替换为 `••••••••`
- Web 端不提供获取明文 API Key 的接口，编辑时 Key 以占位符显示

### 3.3 备份与还原

#### F8: 自动备份
- 每次写入 profiles.json 或 settings.json 前自动备份
- 备份文件存储在 `~/.claude-switch/backups/`
- 文件命名格式：`{type}-{ISO-timestamp}.json`

#### F9: 手动还原
- Web 界面可查看历史备份列表
- 选择备份文件点击还原
- 还原前自动备份当前版本（双重保险）

### 3.4 操作日志

#### F10: 日志记录
- 所有写操作自动记录：新增、修改、删除、切换、还原
- 日志按日期存储在 `~/.claude-switch/logs/YYYY-MM-DD.log`
- Web 界面支持按日期查询日志

### 3.5 双模式访问

#### F11: Web 管理端
- 启动 HTTP 服务器，默认端口 3333
- 响应式设计，支持手机浏览器访问
- 局域网内可通过 IP 访问
- 推荐使用 pm2 常驻后台

#### F12: CLI 命令行
- `claude-switch current` — 查看当前环境变量
- `claude-switch list` — 列出所有套餐
- `claude-switch add` — 交互式添加套餐
- `claude-switch switch` — 交互式切换套餐
- `claude-switch serve` — 启动 Web 管理服务（见 F20-F25）

#### F13: 备份原因标注
- 备份文件名格式改为 `{type}-{timestamp}_{reason}.json`（下划线分隔 reason）
- reason 取值：`switch-{profileName}` / `add-{name}` / `remove-{name}` / `update-{name}` / `restore` / `migration`
- 备份列表 API 返回解析后的 reason 信息，前端展示
- 示例：`profiles-2026-05-03T13-22-00_switch-aliyun-pro.json`

#### F14: 还原前 Diff 预览
- 新增独立工具模块 `lib/diff.js`（JSON diff 工具）
- diff 工具功能：输入两个 JSON 对象，输出 `{ added: [...], removed: [...], changed: [...{key, oldValue, newValue}], unchanged: [...] }`
- 敏感字段（包含 TOKEN 的 key）的值统一脱敏为 `••••••••`
- API: `GET /api/backups/:type/:fileName/preview` 返回 diff 结果
- 前端：备份列表加「预览」按钮，弹窗展示 diff，高亮差异，底部「确认还原」

#### F15: 首次安装导入
- 首次运行（profiles.json 不存在）时，自动检测 `~/.claude/settings.json` 中已有的 Claude 相关环境变量
- 如检测到有效配置，提示用户是否导入为第一个套餐
- 用户输入套餐名称（默认 "default"），确认后自动创建
- CLI 无参启动时自动触发检测，也可在 Web 端首次访问时引导

#### F16: 另存为新套餐（Clone）
- 编辑已有套餐时，修改参数后可点击「另存为新套餐」按钮
- 服务端克隆源套餐完整配置（含真实 API Key），再用修改值覆盖
- 前端不接触真实 API Key，通过 `POST /api/profiles/clone` 在服务端闭环
- 用途：基于现有套餐快速创建变体（如同厂商不同模型组合）

#### F17: 当前套餐状态管理（v3.0 重构）
- `profiles.json` 新增 `active` 字段，记录当前选中的套餐名称
- `profiles.json` 结构调整为 `{ active, profiles: { name: { env } } }`
- 切换套餐时自动更新 `active` 字段
- **判断优先级**：
  1. 读 `active` 字段，若指向的套餐存在于 `profiles` 中 → 直接标记为「当前」
  2. `active` 为空或指向的套餐不存在 → fallback 到环境变量全量比对（BASE_URL + 三档模型名）
  3. 均无法匹配 → 显示「未知」
- 最多只有一个套餐显示「当前」标签

#### F18: 环境一致性检测
- 每次加载套餐列表时，将 `active` 对应套餐的 env 与 `settings.json` 实际 env 做 diff
- **一致**：正常显示「当前」标签
- **不一致**（用户手动改过 settings.json）：
  - Web 端：在当前套餐卡片上显示⚠️警告标识 + 提示文案「当前环境与选中套餐不一致」
  - CLI：`list` 命令输出中标注「[环境已变更]」
- 不一致时不改变 `active` 的值，仅提示

#### F19: 旧格式自动迁移
- 首次加载时检测 profiles.json 格式
- **旧格式**（顶层直接是套餐对象）：自动迁移为新格式 `{ active: "", profiles: { ... } }`
- 迁移时 `active` 置空，首次打开 Web/CLI 时通过 fallback 环境变量比对自动填充
- 迁移前自动备份（reason: `migration`）

### 3.6 Serve 命令（内置服务管理）

#### F20: claude-switch serve
- 在 CLI 中新增 `serve` 子命令，统一管理 Web 服务的启动、停止、状态查询
- 替代原有的 pm2 守护方案，不引入外部依赖，纯 Node.js 标准库实现
- **命令接口**：
  - `claude-switch serve` — 前台运行，默认端口 3333
  - `claude-switch serve -p <port>` — 指定端口
  - `claude-switch serve -d` — 后台运行（daemon）
  - `claude-switch serve -d -p <port>` — 后台 + 指定端口
  - `claude-switch serve --stop` — 停止运行中的服务
  - `claude-switch serve --status` — 查看服务状态（PID、端口、运行时长）
- **端口优先级**：`-p` 参数 > `CLAUDE_SWITCH_PORT` 环境变量 > 默认值 3333
- **互斥规则**：`--stop` / `--status` 与 `-d` / `-p` 互斥，同时指定报错退出；`--stop` 与 `--status` 本身互斥

#### F21: 防重复启动
- 使用 PID 文件 `~/.claude-switch/server.pid` 记录运行中的进程
- PID 文件内容为 JSON：`{ "pid": 12345, "port": 3333, "startedAt": "ISO-8601" }`
- 启动前检查：
  - PID 文件不存在 → 正常启动
  - PID 文件存在 → `process.kill(pid, 0)` 检测进程存活
    - 存活 → 报错退出，提示「服务已在运行，PID: xxx，端口: xxx」
    - 不存活 → 清理 stale PID 文件，正常启动
- 前台和后台模式均写入 PID 文件

#### F22: 前台运行
- 启动 Express 服务，绑定到指定端口
- 写入 PID 文件
- 捕获 `SIGINT` / `SIGTERM`，优雅关闭：停止接受新连接 → 等待现有请求完成（最多 5s） → 删除 PID 文件 → 退出
- 打印：`管理端已启动 → http://localhost:PORT`

#### F23: 后台运行（daemon）
- 使用 `child_process.spawn` 启动子进程，传入内部参数 `--daemon-child`（用户不可直接使用）
- 子进程 `detached: true`，父进程 `unref()` 后退出
- 子进程 stdout/stderr 重定向到 `~/.claude-switch/server.log`
- 父进程打印：`管理端已后台启动 → PID: xxx, http://localhost:PORT, 日志: ~/.claude-switch/server.log`
- PID 文件由子进程写入（与前台模式共享同一逻辑）

#### F24: 停止服务（--stop）
- 读取 PID 文件，不存在 → 报错「服务未在运行」
- 发送 `SIGTERM`，轮询进程退出（每 200ms，最多 5s）
- 超时未退出 → `SIGKILL`
- 清理 PID 文件
- 打印「服务已停止，PID: xxx」

#### F25: 状态查询（--status）
- 读取 PID 文件，不存在 → 打印「服务未在运行」
- 进程存活 → 打印：PID、端口、运行时长（从 startedAt 计算）
- 进程不存活 → 打印「PID 文件存在但进程已退出（stale）」，建议执行 `serve --stop` 清理

---

## 4. 技术规格

### 4.1 系统架构

```
┌──────────────┐     HTTP/REST      ┌──────────────┐
│   Browser    │ ◄──────────────► │   Express     │
│  (SPA HTML)  │                    │   Server      │
└──────────────┘                    └──────┬───────┘
                                           │
                                    ┌──────▼───────┐
                                    │  Profile      │
                                    │  Manager      │
                                    └──┬───┬───┬───┘
                                       │   │   │
                              ┌────────┘   │   └────────┐
                              ▼            ▼            ▼
                         ┌────────┐  ┌────────┐  ┌────────┐
                         │ Crypto │  │ Backup  │  │ Logger │
                         │ Utils  │  │         │  │        │
                         └────────┘  └────────┘  └────────┘
```

### 4.2 项目结构

```
claude-switch/
├── src/
│   ├── lib/
│   │   ├── config.ts           # 路径常量，支持环境变量覆盖
│   │   ├── crypto-utils.ts     # AES-256-CBC 加解密
│   │   ├── profile-manager.ts  # 核心业务逻辑（CRUD、切换、预设模板）
│   │   ├── backup.ts           # 备份还原管理
│   │   ├── diff.ts             # JSON diff 工具
│   │   ├── logger.ts           # 操作日志
│   │   ├── serve.ts            # serve 命令逻辑
│   │   └── types.ts            # TypeScript 类型定义
│   ├── index.ts                # CLI 入口
│   ├── server.ts               # Express Web 服务器
│   └── env.d.ts                # 环境变量类型声明
├── public/
│   ├── index.html              # Web 管理页面
│   ├── styles.css              # CSS 样式（暗色模式）
│   └── app.js                  # 前端逻辑（原生 JS）
├── tests/
│   ├── index.test.ts           # 集成测试
│   └── serve.test.ts           # serve 命令测试
├── docs/
│   └── PRD.md                  # 本文档
├── tsconfig.json               # TypeScript 配置
├── tsup.config.ts              # 构建配置
├── vitest.config.ts            # 测试配置
├── package.json
├── README.md                   # 用户指南
└── CLAUDE.md                   # 开发指南
```

### 4.3 依赖项

| 包名 | 版本 | 用途 |
|---|---|---|
| express | ^4.21 | HTTP 服务器 |
| cors | ^2.8 | 跨域支持 |
| fs-extra | ^11.2 | 文件系统操作 |
| commander | ^11.1 | CLI 命令解析 |
| inquirer | ^8.2 | CLI 交互式提示 |
| chalk | ^5.6 | CLI 彩色输出 |
| proper-lockfile | ^4.1 | 文件锁（并发保护） |

### 4.4 开发依赖

| 包名 | 版本 | 用途 |
|---|---|---|
| typescript | ^6.0 | TypeScript 编译器 |
| tsup | ^8.5 | TypeScript 构建工具 |
| tsx | ^4.21 | TypeScript 执行器 |
| vitest | ^4.1 | 测试框架 |
| supertest | ^7.2 | API 测试 |

### 4.4 数据存储

所有数据存储在 `~/.claude-switch/` 目录（可通过 `CLAUDE_SWITCH_DIR` 环境变量覆盖）：

```
~/.claude-switch/
├── profiles.json     # 套餐配置（Token 加密存储），结构见 4.4.1
├── server.pid        # serve 运行状态（JSON，启动时写入，停止时删除）
├── server.log        # serve 后台模式日志（追加写入）
├── backups/          # 自动备份（按时间戳命名）
│   ├── profiles-2026-04-26T14-30-00-000Z.json
│   └── settings-2026-04-26T14-30-00-000Z.json
└── logs/             # 操作日志（按日期命名）
    └── 2026-04-26.log
```

#### 4.4.1 profiles.json 结构（v3.0）

```json
{
  "active": "aliyun-pro",
  "profiles": {
    "aliyun-pro": {
      "env": {
        "ANTHROPIC_AUTH_TOKEN": "加密密文",
        "ANTHROPIC_BASE_URL": "https://coding.dashscope.aliyuncs.com/apps/anthropic",
        "ANTHROPIC_DEFAULT_OPUS_MODEL": "qwen3.5-max",
        "ANTHROPIC_DEFAULT_SONNET_MODEL": "qwen3.5-plus",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": "qwen3.5-turbo"
      }
    },
    "deepseek": {
      "env": { ... }
    }
  }
}
```

- `active`：当前选中的套餐名称（字符串），无选中时为空字符串
- `profiles`：套餐集合，key 为套餐名
- 旧格式（顶层直接是 `{ name: { env } }`）在首次加载时自动迁移

Claude Code 配置文件：`~/.claude/settings.json`

### 4.5 API 接口

| 方法 | 路径 | 说明 | 请求体 | 返回 |
|---|---|---|---|---|
| GET | `/api/profiles` | 套餐列表 + 活跃状态（Token 脱敏） | — | `{ active: string \| null, profiles: { name: { env: {...} } }, mismatch: boolean \| null }` |
| PUT | `/api/profiles/:name` | 编辑套餐（合并更新） | `{ env }` | `{ success: true }` |
| POST | `/api/profiles` | 新增/更新套餐 | `{ name, env }` | `{ success: true }` |
| POST | `/api/profiles/clone` | 克隆套餐（含真实 Key） | `{ source, name, overrides }` | `{ success: true }` |
| DELETE | `/api/profiles/:name` | 删除套餐 | — | `{ success: true }` |
| POST | `/api/switch` | 切换套餐 | `{ name }` | `{ success: true }` |
| GET | `/api/current` | 当前环境（Token 脱敏）+ 一致性状态 | — | `{ env: { key: value }, activeProfile: string \| null, mismatch: boolean \| null }` |
| GET | `/api/presets` | 预设模板列表 | — | `{ key: { label, baseUrl, ... } }` |
| GET | `/api/backups/:type` | 备份列表 | — | `[{fileName, reason, timestamp}, ...]` |
| GET | `/api/backups/:type/:fileName/preview` | 备份 diff 预览 | — | diff 结果 |
| POST | `/api/restore` | 还原备份 | `{ type, backupFileName }` | `{ success: true }` |
| GET | `/api/logs?date=` | 操作日志 | — | `[{ date, content }]` |
| GET | `/api/first-install` | 首次安装检测 | — | `{ firstInstall, hasExisting, config }` |

### 4.6 加密实现

```
密钥派生:
  machineId = UUID(machine-id) 或 fallback
  seed = machineId + hostname + username + platform + arch + totalmem + cpu_model + salt
  key = SHA-256(seed) → 取前 32 字节

加密流程:
  IV = crypto.randomBytes(16)
  cipher = AES-256-CBC(key, IV)
  ciphertext = cipher.update(plaintext) + cipher.final()
  stored = Base64(IV) + ':' + Base64(ciphertext)

解密流程:
  [ivB64, ctB64] = stored.split(':')
  若无 ':' → 视为明文直接返回（向后兼容）
  plaintext = decipher(Base64(ivB64), Base64(ctB64))
```

---

## 5. 测试规格

### 5.1 测试覆盖率

共 38+ 个测试用例，分为 5 个测试套件：

| 套件 | 用例数 | 覆盖范围 |
|---|---|---|
| Profile Manager | 13 | CRUD、加密验证、备份、错误处理 |
| Crypto Utils | 5 | 加解密往返、向后兼容、随机 IV、重加密检测 |
| Diff Utils | 7 | 空对象、相同对象、新增/删除/变更 key、敏感字段脱敏、嵌套对象 |
| Preset Templates | 2 | 模板完整性、字段校验 |
| API Endpoints | 15+ | 全部 REST 接口、脱敏、合并更新、安全防护、完整工作流、备份预览 |

### 5.2 测试隔离策略

- 通过 `CLAUDE_SWITCH_DIR` 环境变量将数据目录指向临时目录
- 每个测试用例前后清理临时目录
- 不依赖真实的 `~/.claude/` 或 `~/.claude-switch/` 数据

---

## 6. 部署规格

### 6.1 系统要求

- Node.js >= 24（支持 ESM + TypeScript）
- macOS / Linux（Windows 理论上可用但未测试）
- Claude Code 已安装

### 6.2 安装步骤

```bash
git clone https://github.com/iazrael/claude-switch.git
cd claude-switch
pnpm install
pnpm build      # 构建 TypeScript
pnpm link       # 全局安装命令
```

### 6.3 启动方式

```bash
# 推荐：使用 serve 命令
claude-switch serve                  # 前台运行
claude-switch serve -d               # 后台运行
claude-switch serve -d -p 8080       # 后台 + 指定端口
claude-switch serve --stop           # 停止
claude-switch serve --status         # 查看状态

# 直接启动（开发模式）
node dist/server.js                  # 构建后运行
tsx server.ts                        # 开发时运行
```

### 6.4 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CLAUDE_SWITCH_DIR` | `~/.claude-switch` | 数据存储目录（仅影响 profiles/backups/logs） |
| `CLAUDE_SETTINGS_PATH` | `~/.claude/settings.json` | Claude Code 配置文件路径 |
| `CLAUDE_SWITCH_PORT` | `3333` | Web 服务器端口 |

---

## 7. 限制与已知问题

1. **机器绑定**：加密密钥基于机器特征，更换机器后需重新输入 API Key
2. **无鉴权**：Web 管理端无登录机制，依赖局域网隔离，不建议公网暴露
3. **单实例**：不支持多用户并发，同一时间只能有一个用户操作
4. **settings.json 合并**：切换套餐采用合并策略写入 `settings.json` 中的 `env` 字段，仅更新套餐定义的变量，不影响其他 env 变量
5. **备份上限**：自动备份保留最近 20 份，超出自动清理最旧的
6. **日志保留**：操作日志保留 30 天，超出自动清理
7. **Windows 兼容性**：未在 Windows 上测试，path 处理可能存在问题


