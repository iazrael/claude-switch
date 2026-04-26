# ⚡ Claude Switch

Claude Code 套餐快速切换工具。支持多服务商配置管理，Web 管理界面，API Key 加密存储。

## 功能

- 🔄 **一键切换** — 在不同服务商套餐间快速切换（阿里云百炼、火山引擎、智谱AI、DeepSeek 等）
- 🔐 **加密存储** — API Key 使用 AES-256-CBC 基于本机特征加密，文件泄露也无法读取
- 📱 **Web 管理端** — 手机友好的响应式界面，局域网内可直接操作
- 💻 **CLI 模式** — 终端交互式操作
- 📋 **操作日志** — 所有写操作自动记录，可追溯
- ⏪ **备份还原** — 每次修改前自动备份，误操作可一键还原
- 🧩 **预设模板** — 内置主流服务商模型映射，选厂商自动填充

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
│   └── logger.js           # 操作日志
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
npm install
```

## 使用

### Web 模式（推荐）

```bash
node server.js
# 浏览器打开 http://localhost:3333
# 手机同局域网访问 http://<你的IP>:3333
```

用 pm2 常驻后台：

```bash
npm install -g pm2
pm2 start server.js --name claude-switch
pm2 save
```

### CLI 模式

```bash
# 查看当前环境
node index.js current

# 列出所有套餐
node index.js list

# 交互式添加套餐
node index.js add

# 交互式切换
node index.js switch
```

## 数据存储

所有数据存储在 `~/.claude-switch/` 目录下：

```
~/.claude-switch/
├── profiles.json    # 套餐配置（Token 加密存储）
├── backups/         # 自动备份
└── logs/            # 操作日志
```

Claude Code 的 `settings.json` 路径：`~/.claude/settings.json`

## 安全说明

- API Key 使用本机特征（hostname + username + platform + arch）派生的密钥进行 AES-256-CBC 加密
- 所有配置文件权限设为 `600`
- Web 管理端列表页 Token 脱敏显示，编辑时才解密展示
- 首次启动自动迁移明文旧数据为加密存储
- 更换机器后需重新输入 API Key（加密密钥与机器绑定）

## License

MIT
