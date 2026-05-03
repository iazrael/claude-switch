# Claude Switch - 产品规格说明书

> 版本：2.1.0 | 最后更新：2026-05-03

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
- `node index.js current` — 查看当前环境变量
- `node index.js list` — 列出所有套餐
- `node index.js add` — 交互式添加套餐
- `node index.js switch` — 交互式切换套餐

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
├── lib/
│   ├── config.js           # 路径常量，支持 CLAUDE_SWITCH_DIR 环境变量覆盖
│   ├── crypto-utils.js     # AES-256-CBC 加解密
│   ├── profile-manager.js  # 核心业务逻辑（CRUD、切换、预设模板）
│   ├── backup.js           # 备份还原管理
│   └── logger.js           # 操作日志
├── public/
│   └── index.html          # Web 管理页面（单文件 SPA，420行）
├── tests/
│   └── index.test.js       # Vitest 测试用例（33个）
├── docs/
│   └── SPEC.md             # 本文档
├── index.js                # CLI 入口（Commander.js）
├── server.js               # Express Web 服务器
├── package.json
├── README.md
└── vitest.config.js
```

### 4.3 依赖项

| 包名 | 版本 | 用途 |
|---|---|---|
| express | ^4.21 | HTTP 服务器 |
| cors | ^2.8 | 跨域支持 |
| fs-extra | ^11.2 | 文件系统操作（Promise 化） |
| commander | ^11.1 | CLI 命令解析 |
| inquirer | ^8.2 | CLI 交互式提示 |
| chalk | ^4.1 | CLI 彩色输出 |

### 4.4 数据存储

所有数据存储在 `~/.claude-switch/` 目录（可通过 `CLAUDE_SWITCH_DIR` 环境变量覆盖）：

```
~/.claude-switch/
├── profiles.json     # 套餐配置（Token 加密存储）
├── backups/          # 自动备份（按时间戳命名）
│   ├── profiles-2026-04-26T14-30-00-000Z.json
│   └── settings-2026-04-26T14-30-00-000Z.json
└── logs/             # 操作日志（按日期命名）
    └── 2026-04-26.log
```

Claude Code 配置文件：`~/.claude/settings.json`

### 4.5 API 接口

| 方法 | 路径 | 说明 | 请求体 | 返回 |
|---|---|---|---|---|
| GET | `/api/profiles` | 套餐列表（Token 脱敏） | — | `{ name: { env: {...} } }` |
| PUT | `/api/profiles/:name` | 编辑套餐（合并更新） | `{ env }` | `{ success: true }` |
| POST | `/api/profiles` | 新增/更新套餐 | `{ name, env }` | `{ success: true }` |
| DELETE | `/api/profiles/:name` | 删除套餐 | — | `{ success: true }` |
| POST | `/api/switch` | 切换套餐 | `{ name }` | `{ success: true }` |
| GET | `/api/current` | 当前环境（Token 脱敏） | — | `{ key: value }` |
| GET | `/api/presets` | 预设模板列表 | — | `{ key: { label, baseUrl, ... } }` |
| GET | `/api/backups/:type` | 备份列表 | — | `[filename, ...]` |
| POST | `/api/restore` | 还原备份 | `{ type, backupFileName }` | `{ success: true }` |
| GET | `/api/logs?date=` | 操作日志 | — | `[{ date, content }]` |

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

共 33 个测试用例，分为 4 个测试套件：

| 套件 | 用例数 | 覆盖范围 |
|---|---|---|
| Profile Manager | 13 | CRUD、加密验证、备份、错误处理 |
| Crypto Utils | 3 | 加解密往返、向后兼容、随机 IV |
| Preset Templates | 2 | 模板完整性、字段校验 |
| API Endpoints | 15 | 全部 REST 接口、脱敏、合并更新、安全防护、完整工作流 |

### 5.2 测试隔离策略

- 通过 `CLAUDE_SWITCH_DIR` 环境变量将数据目录指向临时目录
- 每个测试用例前后清理临时目录
- 不依赖真实的 `~/.claude/` 或 `~/.claude-switch/` 数据

---

## 6. 部署规格

### 6.1 系统要求

- Node.js >= 18
- macOS / Linux（Windows 理论上可用但未测试）
- Claude Code 已安装

### 6.2 安装步骤

```bash
git clone https://github.com/iazrael/claude-switch.git
cd claude-switch
npm install
```

### 6.3 启动方式

```bash
# 前台运行
node server.js

# 后台常驻（推荐）
pm2 start server.js --name claude-switch
pm2 save

# CLI 使用
node index.js list
node index.js switch
```

### 6.4 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CLAUDE_SWITCH_DIR` | `~/.claude-switch` | 数据存储目录（仅影响 profiles/backups/logs） |
| `CLAUDE_SETTINGS_PATH` | `~/.claude/settings.json` | Claude Code 配置文件路径 |
| `PORT` | 3333 | Web 服务器端口（需修改代码） |

---

## 7. 限制与已知问题

1. **机器绑定**：加密密钥基于机器特征，更换机器后需重新输入 API Key
2. **无鉴权**：Web 管理端无登录机制，依赖局域网隔离，不建议公网暴露
3. **单实例**：不支持多用户并发，同一时间只能有一个用户操作
4. **settings.json 合并**：切换套餐采用合并策略写入 `settings.json` 中的 `env` 字段，仅更新套餐定义的变量，不影响其他 env 变量
5. **备份上限**：自动备份保留最近 20 份，超出自动清理最旧的
6. **日志保留**：操作日志保留 30 天，超出自动清理
7. **Windows 兼容性**：未在 Windows 上测试，path 处理可能存在问题

---

## 8. 路线图

### v2.1（计划）
- [ ] 导入/导出套餐配置（JSON 文件）
- [ ] 支持自定义环境变量（超出默认 5 个字段）
- [x] 密钥派生增强（machineId + 硬件特征 + salt）
- [x] API Key 编辑方式改为占位符模式
- [x] 移除明文 API Key 接口
- [x] 前端 XSS 修复（innerHTML → textContent）
- [x] 备份自动清理（20 份上限）
- [x] 日志自动清理（30 天保留）

### v3.0（远期）
- [ ] 多语言支持
- [ ] 自动检测可用模型（调用厂商 API）
- [ ] 定时自动切换（按时间段使用不同套餐）
- [ ] 用量统计与成本估算
