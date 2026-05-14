# PRD — Claude Switch

Claude Code 套餐快速切换工具。

## 核心场景

在多个 Anthropic API 兼容服务商（阿里云百炼、火山引擎、智谱AI、DeepSeek 等）之间一键切换 Claude Code 的环境变量配置。

## 功能清单

### ✅ 已实现

| 命令 | 别名 | 说明 |
|------|------|------|
| `current` | — | 查看当前环境变量 |
| `list` | `ls` | 列出所有套餐 |
| `add [name]` | — | 交互式添加套餐 |
| `remove [name]` | `rm` | 交互式删除套餐 |
| `switch [name]` | `sw` | 切换套餐 |
| `serve` | — | Web 管理服务（前台/后台/停止/状态） |

### ✨ v3.3.0 新增

#### `edit [name]` — 编辑已有套餐

**问题**：已保存的套餐无法修改单个字段，只能删除重建。当 API Key 过期或模型名变更时，操作繁琐且容易填错其他字段。

**方案**：

```
claude-switch edit              # 交互选择套餐 → 选择字段 → 逐个修改
claude-switch edit aliyun       # 直接编辑指定套餐
```

**交互流程**：

1. 未指定 name → Inquirer list 选择套餐
2. 显示当前套餐所有字段（Token 脱敏为 `***`）
3. Inquirer list 多选要编辑的字段
4. 对选中字段逐个弹出 input，默认值为当前值，回车跳过
5. Token 字段：当前值显示 `***`，输入新值则更新，回车不修改
6. 确认变更 → 自动备份 → 写入 → 日志记录

**规则**：
- 只更新有变化的字段
- 底层复用 `withLock` + `saveProfilesSafe`
- 套餐不存在 → 报错退出
- 没有任何修改 → 提示"无变更"

#### `copy [source] [target]` — 复制套餐

**问题**：不同套餐经常只有 API Key 和 Base URL 不同（如同服务商的不同账号），手动 add 重复填写模型名容易出错。

**方案**：

```
claude-switch copy                            # 交互选择源 → 输入目标名
claude-switch copy aliyun aliyun-pro          # 直接指定
claude-switch copy aliyun                     # 源确定，交互输入目标名
```

**交互流程**：

1. 确定源套餐（未指定 → Inquirer list 选择）
2. 输入目标名（未指定 → Inquirer input）
3. 目标名已存在 → 确认覆盖 or 取消
4. 复制所有字段，进入编辑模式微调
5. `--exact` 标志：纯复制，不进入编辑

**规则**：
- 默认进入"复制后编辑"模式，方便修改 API Key 等差异化字段
- 源套餐不存在 → 报错退出
- 自动备份 + 日志记录

## 非功能需求

- 所有写操作自动备份（最近 20 份）
- 所有写操作记录日志（保留 30 天）
- API Key AES-256-CBC 加密存储
- 配置文件权限 `600`
- 并发写入保护（proper-lockfile）
- 合并写入：切换套餐只覆写套餐定义的变量，保留其他自定义变量

## 用户画像

Claude Code 重度用户，同时使用多家 API 服务商，频繁在终端操作。偏好简洁高效的 CLI 交互，无参数运行进入引导式选择。
