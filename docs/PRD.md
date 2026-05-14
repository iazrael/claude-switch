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
| `edit [name]` | `ed` | 编辑已有套餐（底层复用 updateProfile） |
| `copy [source] [target]` | `cp` | 复制套餐 |
| `remove [name]` | `rm` | 交互式删除套餐 |
| `switch [name]` | `sw` | 切换套餐 |
| `serve` | — | Web 管理服务（前台/后台/停止/状态） |

### v3.3.0 变更

#### `edit [name]` CLI 命令

**问题**：已保存的套餐无法修改单个字段，只能删除重建。API Key 过期或模型名变更时操作繁琐。

**方案**：新增 `edit` CLI 命令，交互式选择并修改字段。底层复用 `updateProfile` SDK 接口。

`updateProfile` 语义增强：
- `undefined` 值 → 跳过，不修改该字段
- 空字符串 `''` → 清除该字段
- 非空字符串 → 更新该字段

交互流程：
1. 未指定 name → Inquirer list 选择套餐
2. 显示当前套餐所有字段（Token 脱敏为 `***`）
3. Inquirer checkbox 多选要编辑的字段
4. 对选中字段逐个弹出 input，默认值为当前值，回车跳过
5. Token 字段输入 `***` 视为不修改

#### `copy [source] [target]` CLI 命令

**问题**：不同套餐经常只有 API Key 和 Base URL 不同，手动 add 重复填写模型名容易出错。

交互流程：
1. 确定源套餐（未指定 → Inquirer list 选择）
2. 输入目标名（未指定 → Inquirer input）
3. 目标名已存在 → 确认覆盖 or 取消
4. 复制所有字段，默认进入编辑模式微调
5. `--exact` 标志：纯复制，不进入编辑

## 非功能需求

- 所有写操作自动备份（最近 20 份）
- 所有写操作记录日志（保留 30 天）
- API Key AES-256-CBC 加密存储
- 配置文件权限 `600`
- 并发写入保护（proper-lockfile）
- 合并写入：切换套餐只覆写套餐定义的变量，保留其他自定义变量

## 用户画像

Claude Code 重度用户，同时使用多家 API 服务商，频繁在终端操作。偏好简洁高效的 CLI 交互，无参数运行进入引导式选择。
