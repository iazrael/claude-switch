# ⚡ Claude Switch

Claude Code 套餐快速切换工具。支持多服务商配置管理，Web 管理界面，API Key 加密存储。

## 功能

- 🔄 **一键切换** — 在不同服务商套餐间快速切换（阿里云百炼、火山引擎、智谱AI、DeepSeek 等），采用合并策略，仅更新套餐定义的变量，不影响 settings.json 中的其他环境变量
- 🔐 **加密存储** — API Key 使用 AES-256-CBC 基于机器唯一标识和硬件特征派生密钥加密，文件泄露也无法读取
- 📱 **Web 管理端** — 手机友好的响应式界面，局域网内可直接操作
- 💻 **CLI 模式** — 终端交互式操作
- 📋 **操作日志** — 所有写操作自动记录，可追溯
- ⏪ **备份还原** — 每次修改前自动备份，误操作可一键还原，自动保留最近 20 份
- 🏷️ **备份原因标注** — 备份文件名包含操作原因（切换/新增/删除/更新等），便于追溯
- 🔍 **还原前 Diff 预览** — 还原前可预览当前配置与备份的差异，敏感字段自动脱敏，确认后再执行
- 🧩 **预设模板** — 内置主流服务商模型映射，选厂商自动填充
- 📥 **首次安装导入** — 首次运行自动检测现有 Claude Code 配置，一键导入为第一个套餐
- 📋 **另存为新套餐** — 编辑套餐时修改参数后可另存为新套餐，API Key 自动复制
- 🚀 **内置服务管理** — `claude-switch serve` 一条命令管理 Web 服务，支持前台/后台运行、停止、状态查询，无需 pm2

## 模型分层体系

Claude Code 使用三级模型分工：

| 变量 | 角色 | 说明 |
|---|---|---|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | 特级教师 | 复杂架构、核心算法 |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | 高级教师 | 日常开发、Bug 修复 |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 实习老师 | 轻量高频任务 |

## 项目结构

```
claude-switch/
├── lib/
│   ├── config.js           # 路径常量
│   ├── crypto-utils.js     # AES-256-CBC 加解密
│   ├── profile-manager.js  # 核心业务逻辑
│   ├── backup.js           # 备份还原
│   ├── diff.js             # JSON diff 工具
│   ├── logger.js           # 操作日志
│   └── serve.js            # serve 命令（PID 管理、daemon、停止、状态）
├── public/
│   └── index.html          # Web 管理页面（单文件 SPA）
├── index.js                # CLI 入口
├── server.js               # Web 服务器
└── package.json
```

## 安装

```bash
git clone https://github.com/AzraelYan/claude-switch.git
cd claude-switch
pnpm install
pnpm link
```

执行后 `claude-switch` 命令可在任意目录直接使用。不再需要时执行 `npm unlink -g claude-switch` 即可移除。

## 使用

### CLI 模式

安装时执行了 `pnpm link` 后，可在任意终端直接使用：

```bash
# 无参数直接运行 → 首次运行会检测并导入现有配置，之后进入交互式切换菜单
claude-switch

# 查看当前 settings.json 中的环境变量
claude-switch current

# 列出所有已保存的套餐
claude-switch list
# 或简写
claude-switch ls

# 交互式添加套餐（会逐项询问 API Key、Base URL、模型等）
claude-switch add
# 也可以直接指定名称
claude-switch add aliyun-pro

# 交互式切换套餐（方向键选择）
claude-switch switch
# 直接切换到指定套餐
claude-switch switch aliyun-pro

# 删除套餐
claude-switch remove aliyun-pro
# 或简写
claude-switch rm aliyun-pro

# 查看帮助
claude-switch --help
```

> **提示**：如果觉得 `claude-switch` 太长，可以在 `~/.zshrc` 或 `~/.bashrc` 中加个别名：
> ```bash
> alias cs='claude-switch'
> ```
> 之后输入 `cs` 就能直接调出切换菜单。

### Web 模式（推荐）

使用内置 `serve` 命令：

```bash
# 前台运行
claude-switch serve
# 浏览器打开 http://localhost:3333
# 手机同局域网访问 http://<你的IP>:3333

# 后台运行（daemon）
claude-switch serve -d

# 指定端口
claude-switch serve -p 8080

# 查看运行状态
claude-switch serve --status

# 停止后台服务
claude-switch serve --stop
```

也可以直接启动（兼容旧方式）：

```bash
node server.js
```

或用 pm2 常驻后台：

```bash
pm2 start server.js --name claude-switch
pm2 save
```

## 数据存储

所有数据存储在 `~/.claude-switch/` 目录下：

```
~/.claude-switch/
├── profiles.json    # 套餐配置（Token 加密存储）
├── server.pid       # serve 运行状态（自动管理）
├── server.log       # serve 后台日志（自动管理）
├── backups/         # 自动备份（含操作原因标注）
└── logs/            # 操作日志
```

Claude Code 的 `settings.json` 路径：`~/.claude/settings.json`（可通过 `CLAUDE_SETTINGS_PATH` 环境变量覆盖）

## 安全说明

- API Key 使用增强密钥派生（machineId + hostname + username + platform + arch + totalmem + cpu_model + salt）进行 AES-256-CBC 加密，密钥与机器硬件深度绑定
- 所有配置文件权限设为 `600`
- Web 管理端 Token 脱敏显示，不提供获取明文 API Key 的接口；编辑时 Key 以占位符显示，输入新值则覆盖，留空保留原值
- 首次启动自动迁移明文旧数据为加密存储
- 更换机器后需重新输入 API Key（加密密钥与机器绑定）
- 备份自动保留最近 20 份，超过自动清理最旧的
- 操作日志自动保留 30 天，超过自动清理
- 备份文件名包含操作原因（如 `profiles-2026-05-03T13-22-00_switch-aliyun-pro.json`），方便追溯
- 还原前可预览 diff，敏感字段（含 TOKEN 的 key）自动脱敏为 `••••••••`

## License

MIT
