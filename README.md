# ⚡ Claude Switch

Claude Code 套餐快速切换工具。支持多服务商配置管理，Web 管理界面，API Key 加密存储。

## 功能

- 🔄 **一键切换** — 在不同服务商套餐间快速切换（阿里云百炼、火山引擎、智谱AI、DeepSeek 等）
- 🔐 **加密存储** — API Key 使用 AES-256-CBC 基于机器特征加密
- 📱 **Web 管理端** — 响应式界面，局域网内可直接操作
- 💻 **CLI 模式** — 终端交互式操作
- 📋 **操作日志** — 所有写操作自动记录
- ⏪ **备份还原** — 自动备份，支持 Diff 预览
- 🧩 **预设模板** — 内置主流服务商模型映射
- 📥 **首次导入** — 自动检测现有配置并导入

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
├── src/
│   ├── lib/
│   │   ├── config.ts           # 路径常量
│   │   ├── crypto-utils.ts     # AES-256-CBC 加解密
│   │   ├── profile-manager.ts  # 核心业务逻辑
│   │   ├── backup.ts           # 备份还原
│   │   ├── diff.ts             # JSON diff 工具
│   │   ├── logger.ts           # 操作日志
│   │   ├── serve.ts            # serve 命令（PID 管理、daemon、停止、状态）
│   │   └── types.ts            # TypeScript 类型定义
│   ├── index.ts                # CLI 入口
│   ├── server.ts               # Web 服务器
│   └── env.d.ts                # 环境变量类型声明
├── public/
│   ├── index.html              # Web 管理页面 HTML 结构
│   ├── styles.css              # CSS 样式（暗色模式）
│   └── app.js                  # 前端逻辑（零依赖原生 JS）
├── tests/
│   ├── index.test.ts           # 集成测试
│   └── serve.test.ts           # serve 命令测试
├── tsconfig.json               # TypeScript 配置
├── tsup.config.ts              # 构建配置
├── vitest.config.ts            # 测试配置
└── package.json
```

## 安装

```bash
git clone https://github.com/AzraelYan/claude-switch.git
cd claude-switch
pnpm install
pnpm build      # 构建 TypeScript
pnpm link       # 全局安装命令
```

执行后 `claude-switch` 命令可在任意目录直接使用。移除时执行 `pnpm unlink -g claude-switch`。

## 使用

### CLI 模式

```bash
claude-switch              # 无参数运行，显示当前环境
claude-switch current      # 查看当前环境变量
claude-switch list         # 列出所有套餐（别名: ls）
claude-switch add          # 添加套餐
claude-switch switch       # 切换套餐（别名: sw）
claude-switch remove       # 删除套餐（别名: rm）
claude-switch --help       # 查看帮助
```

> 提示：可加别名 `alias cs='claude-switch'` 简化输入，如 `cs sw aliyun`。

### Web 模式（推荐）

```bash
claude-switch serve        # 前台运行，http://localhost:3333
claude-switch serve -d     # 后台运行
claude-switch serve -p 8080  # 指定端口
claude-switch serve --status  # 查看状态
claude-switch serve --stop    # 停止服务
```

手机同局域网访问 `http://<你的IP>:3333`。

## 数据存储

```
~/.claude-switch/
├── profiles.json    # 套餐配置（Token 加密）
├── server.pid       # serve 运行状态
├── server.log       # serve 日志
├── backups/         # 自动备份
└── logs/            # 操作日志
```

Claude Code 配置：`~/.claude/settings.json`

## 安全说明

- API Key AES-256-CBC 加密，密钥与机器绑定
- 配置文件权限 `600`
- Web 端 Token 脱敏显示
- 备份保留最近 20 份，日志保留 30 天
- 更换机器需重新输入 API Key

## License

MIT
