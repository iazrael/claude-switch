# Claude Switch v3.0 实施计划

> 版本：1.0 | 日期：2026-05-06 | 基于 SPEC v3.0

---

## 1. 变更概述

v3.0 包含三个核心功能（F17/F18/F19），围绕 `profiles.json` 结构重构：

| 功能 | ID | 描述 |
|------|----|------|
| 当前套餐状态管理 | F17 | profiles.json 新增 `active` 字段 + 结构调整 |
| 环境一致性检测 | F18 | active 套餐与 settings.json 实际 env 做 diff |
| 旧格式自动迁移 | F19 | 检测旧格式并自动迁移，active 置空后 fallback |

### 结构变更

```json
// 旧格式（v2）
{ "aliyun-pro": { "env": { ... } }, "deepseek": { "env": { ... } } }

// 新格式（v3）
{ "active": "aliyun-pro", "profiles": { "aliyun-pro": { "env": { ... } }, "deepseek": { "env": { ... } } } }
```

---

## 2. 文件修改清单（按依赖顺序）

### 顺序 1: `lib/profile-manager.js`（核心层，无前置依赖）

**改动点：**

#### 2.1.1 新增迁移函数 `migrateFormat(raw)`
- **位置**：`readJSON` 之后、`migrateIfNeeded` 之前
- **逻辑**：
  1. 读取 raw 对象，判断是否为旧格式（顶层 key 不含 `profiles` 且不含 `active`）
  2. 旧格式检测条件：`raw` 存在且 `raw.profiles === undefined`
  3. 若为旧格式：
     - 调用 `backupFile(PROFILES_PATH, 'migration')` 备份
     - 转换为 `{ active: "", profiles: { ...oldRaw } }`
     - 写回磁盘
  4. 返回新格式对象
- **风险**：🔴 高 — 迁移错误可能导致数据丢失
- **前置**：无

#### 2.1.2 新增 `getActive()` 函数
- **逻辑**：读取 profiles.json，返回 `active` 字段值（空字符串表示无选中）
- **风险**：🟢 低

#### 2.1.3 新增 `setActive(name)` 函数
- **逻辑**：读取 profiles.json，更新 `active` 字段，写回磁盘
- **风险**：🟢 低
- **注意**：不触发备份（active 变更不是关键操作）

#### 2.1.4 新增 `getActiveProfile()` 函数（F17 判断优先级）
- **逻辑**：
  1. 读取 `active` 字段，若指向的套餐存在于 `profiles` 中 → 返回该套餐名
  2. `active` 为空或指向不存在 → fallback 环境变量全量比对（BASE_URL + 三档模型名）
  3. 均无法匹配 → 返回 `null`
- **风险**：🟡 中 — fallback 比对逻辑需准确
- **依赖**：`getActive()`、`getProfiles()`、`getCurrentEnv()`

#### 2.1.5 新增 `checkMismatch()` 函数（F18 一致性检测）
- **逻辑**：
  1. 调用 `getActiveProfile()` 获取当前 active 套餐
  2. 若无 active 套餐 → 返回 `{ active: null, mismatch: null }`
  3. 比较 active 套餐的 env 与 `getCurrentEnv()`（忽略 TOKEN，比对 BASE_URL + 三档模型）
  4. 一致 → `{ active: name, mismatch: false }`
  5. 不一致 → `{ active: name, mismatch: true }`
- **风险**：🟡 中
- **依赖**：`getActiveProfile()`

#### 2.1.6 修改 `getProfilesDecrypted()` 
- **改动**：内部调用 `migrateFormat(raw)` 确保返回新格式
- **返回值**：从 `{ name: { env } }` 改为 `{ active: string, profiles: { name: { env } } }`
- **风险**：🔴 高 — 所有调用方依赖此函数的返回格式

#### 2.1.7 修改 `saveProfilesSafe(profiles, reason)`
- **改动**：接受新格式 `{ active, profiles }` 并正确写入
- **风险**：🔴 高 — 写入逻辑直接影响磁盘数据

#### 2.1.8 修改 `getProfiles()`（对外 API）
- **改动**：返回新格式 `{ active, profiles }`
- **风险**：🔴 高 — 所有外部调用方（server.js、index.js）依赖此函数

#### 2.1.9 修改 `addProfile(name, env)`
- **改动**：
  1. 读取新格式，在 `profiles` 子对象中操作
  2. 如果是第一个套餐，自动设置 `active` 为该套餐名（可选，看需求）
  3. 保存时传递新格式
- **风险**：🟡 中

#### 2.1.10 修改 `updateProfile(name, env)`
- **改动**：同上，在 `profiles` 子对象中操作
- **风险**：🟡 中

#### 2.1.11 修改 `removeProfile(name)`
- **改动**：
  1. 在 `profiles` 子对象中操作
  2. 如果删除的是 `active` 套餐 → 将 `active` 置空
- **风险**：🟡 中

#### 2.1.12 修改 `switchProfile(name)`
- **改动**：
  1. 原有逻辑不变（写 settings.json）
  2. 新增：调用 `setActive(name)` 更新 profiles.json 的 active 字段
- **风险**：🟡 中

#### 2.1.13 修改 `getBackupPreview()` 中的 profiles diff 逻辑
- **改动**：
  1. 当前逻辑直接遍历顶层对象为套餐名 → 改为遍历 `.profiles` 子对象
  2. 处理旧格式备份文件（可能是旧格式的 profiles.json）
- **风险**：🟡 中

#### 2.1.14 新增导出
- 导出 `getActive`、`setActive`、`getActiveProfile`、`checkMismatch`

---

### 顺序 2: `server.js`（依赖 profile-manager.js）

**改动点：**

#### 2.2.1 修改 `GET /api/profiles` 返回值
- **当前**：返回 `{ name: { env: {...} } }`
- **目标**：返回 `{ active: string|null, profiles: { name: { env: {...} } }, mismatch: boolean|null }`
- **逻辑**：
  1. 调用 `manager.getProfiles()` 获取新格式数据
  2. 调用 `manager.checkMismatch()` 获取 mismatch 状态
  3. 组装响应，profiles 中的 TOKEN 仍脱敏
- **风险**：🔴 高 — 前端依赖此接口格式

#### 2.2.2 修改 `GET /api/current` 返回值
- **当前**：返回 `{ key: value, ... }`（纯 env 对象）
- **目标**：返回 `{ env: { key: value }, activeProfile: string|null, mismatch: boolean|null }`
- **风险**：🔴 高 — 前端依赖此接口格式

#### 2.2.3 修改 `POST /api/switch`
- **改动**：无需改动，`manager.switchProfile(name)` 内部已更新 active
- **风险**：🟢 低

#### 2.2.4 修改 `POST /api/profiles/clone`
- **改动**：`manager.getProfiles()` 返回新格式，取 `profiles` 子对象操作
- **风险**：🟡 中

#### 2.2.5 修改 `DELETE /api/profiles/:name` 
- **改动**：无需改动，`manager.removeProfile()` 内部已处理 active 清理
- **风险**：🟢 低

---

### 顺序 3: `public/index.html`（依赖 server.js API 变更）

**改动点：**

#### 2.3.1 修改 `loadProfiles()` 函数
- **改动**：
  1. 解析新格式 `{ active, profiles, mismatch }` 的响应
  2. 不再通过 envMatches 本地比对来识别当前套餐 → 直接使用 `active` 字段
  3. 根据 `mismatch` 状态决定是否显示⚠️警告
- **风险**：🟡 中

#### 2.3.2 修改 `loadCurrent()` 函数
- **改动**：
  1. 解析新格式 `{ env, activeProfile, mismatch }` 的响应
  2. 使用 `activeProfile` 显示当前套餐名
  3. 根据 `mismatch` 显示不一致提示
- **风险**：🟡 中

#### 2.3.3 新增不一致提示 UI
- **改动**：
  1. 在当前套餐卡片上：若 `mismatch === true`，显示⚠️图标 + 提示文案「当前环境与选中套餐不一致」
  2. 在 subtitle 区域：显示 active 套餐名 + 模型名
  3. CSS 新增 `.mismatch-badge` 样式（⚠️ 警告色）
- **风险**：🟢 低

#### 2.3.4 移除 `envMatches()` 函数
- **改动**：不再需要本地 env 比对，由后端 `active` + `mismatch` 替代
- **风险**：🟢 低

---

### 顺序 4: `index.js`（依赖 profile-manager.js）

**改动点：**

#### 2.4.1 修改 `listProfiles()` 函数
- **改动**：
  1. 解析新格式 `{ active, profiles }`
  2. 当前套餐通过 `active` 字段识别（不再通过 env 比对）
  3. 调用 `manager.checkMismatch()` 检测一致性
  4. 若 mismatch → 标注 `[环境已变更]`
- **风险**：🟡 中

#### 2.4.2 修改 `showCurrent()` 函数
- **改动**：
  1. 调用 `manager.checkMismatch()` 获取状态
  2. 若有 active 套餐 → 显示「当前套餐: xxx」
  3. 若 mismatch → 显示⚠️「环境已变更」提示
- **风险**：🟡 中

#### 2.4.3 修改 `switchProfileUI()` 函数
- **改动**：无需改动，`manager.switchProfile()` 内部已更新 active
- **风险**：🟢 低

#### 2.4.4 更新版本号
- **改动**：`.version('2.3.0')` → `.version('3.0.0')`
- **风险**：🟢 低

---

### 顺序 5: `tests/index.test.js`（依赖所有代码变更）

详见第 5 节测试策略。

---

## 3. 依赖关系图

```
lib/profile-manager.js ─────┬──→ server.js ────→ public/index.html
  (顺序 1, 核心层)          │
                            ├──→ index.js
                            │
                            └──→ tests/index.test.js
                                    (最后改)
```

**严格顺序**：profile-manager → server.js → index.html + index.js（可并行） → tests

---

## 4. 风险评估总览

| 文件 | 风险 | 原因 |
|------|------|------|
| `lib/profile-manager.js` | 🔴 高 | 数据格式迁移 + 所有 CRUD 方法适配 + 核心导出接口变更 |
| `server.js` | 🔴 高 | API 返回格式变更，前端直接依赖 |
| `public/index.html` | 🟡 中 | UI 逻辑重写但可回退，无数据风险 |
| `index.js` | 🟡 中 | 显示逻辑变更，无数据风险 |
| `tests/index.test.js` | 🟡 中 | 测试用例需全面覆盖新格式 |

---

## 5. 测试策略

### 5.1 需要更新的现有测试

#### Profile Manager 套件
| 现有测试 | 改动 |
|----------|------|
| `应该能添加套餐` | `getProfiles()` 返回新格式，断言改为 `profiles['test-profile']` |
| `应该能获取所有套餐名` | 适配新格式内部结构 |
| `应该能删除套餐` | 同上 |
| `应该能切换套餐` | 新增断言验证 active 字段更新 |
| `updateProfile 测试` | 适配新格式 |
| `profiles.json 中 Token 加密` | raw 对象结构变为 `{ active, profiles }`，断言改为 `raw.profiles['xxx']` |
| `备份测试` | 适配新格式 |

#### API Endpoints 套件
| 现有测试 | 改动 |
|----------|------|
| `GET /api/profiles 空列表` | 返回 `{ active: null, profiles: {}, mismatch: null }` |
| `GET /api/profiles 列表脱敏` | 断言改为 `res.body.profiles['test-api']` |
| `完整工作流` | 所有 `list['xxx']` 改为 `list.profiles['xxx']` |

### 5.2 需要新增的测试

#### Profile Manager 新增测试

| 测试 | 覆盖功能 |
|------|----------|
| `旧格式 profiles.json 应自动迁移` | F19：写入旧格式 → getProfiles() → 验证新格式 + 备份存在 |
| `迁移后 active 应为空字符串` | F19：旧格式迁移后 active="" |
| `getActiveProfile 通过 active 字段识别` | F17：设置 active → 返回正确套餐名 |
| `getActiveProfile active 指向不存在时 fallback` | F17：active 指向已删除套餐 → fallback 到 env 比对 |
| `getActiveProfile 全部无法匹配返回 null` | F17：无 active + 无 env 匹配 |
| `checkMismatch 一致时返回 false` | F18：active 套餐 env 与 settings 一致 |
| `checkMismatch 不一致时返回 true` | F18：手动改了 settings.json 后检测到不一致 |
| `checkMismatch 无 active 时返回 null` | F18：mismatch=null 表示无 active 可比较 |
| `switchProfile 应更新 active` | F17：切换后 active 字段更新 |
| `removeProfile 删除 active 套餐应清空 active` | F17：删除当前套餐 → active="" |
| `迁移应产生 migration 备份` | F19：验证备份文件 reason 为 migration |

#### API Endpoints 新增测试

| 测试 | 覆盖功能 |
|------|----------|
| `GET /api/profiles 返回 active 和 mismatch` | F17/F18：验证返回格式 |
| `GET /api/current 返回 activeProfile 和 mismatch` | F17/F18：验证返回格式 |
| `POST /api/switch 后 active 更新` | F17：切换后重新获取 profiles 验证 active |

### 5.3 测试执行顺序建议

1. 先跑现有测试确认当前状态全绿
2. 改 profile-manager.js → 先跑 Profile Manager 套件
3. 改 server.js → 跑 API Endpoints 套件
4. 全部改完 → 全量回归

---

## 6. 迁移策略

### 6.1 旧格式检测算法

```javascript
function isOldFormat(raw) {
  // 空对象 / 不存在 → 新格式（或首次使用）
  if (!raw || typeof raw !== 'object') return false;
  // 新格式必须含 profiles 字段
  return raw.profiles === undefined;
}
```

### 6.2 迁移流程

```
读取 profiles.json
  │
  ├─ 文件不存在 → 首次使用，创建空新格式 { active: "", profiles: {} }
  │
  ├─ isOldFormat(raw) === false → 已是新格式，跳过
  │
  └─ isOldFormat(raw) === true → 执行迁移
       │
       ├─ 1. backupFile(PROFILES_PATH, 'migration')
       │
       ├─ 2. const migrated = { active: "", profiles: raw }
       │     // raw 本身就是 { name: { env } } 结构，直接赋给 profiles
       │
       ├─ 3. writeJSON(PROFILES_PATH, migrated)
       │
       └─ 4. return migrated
```

### 6.3 迁移安全性保障

1. **迁移前备份**：reason 为 `migration`，备份文件名示例 `profiles-2026-05-06T07-30-00_migration.json`
2. **迁移是幂等的**：重复执行不会重复迁移（isOldFormat 只在旧格式时返回 true）
3. **fallback 机制**：迁移后 `active` 为空，首次加载时通过 `getActiveProfile()` 的 fallback 环境比对自动填充
4. **不主动回写 active**：迁移后 `active` 保持空字符串，由用户下一次 `switch` 操作自然设置，或 fallback 临时识别

### 6.4 备份还原兼容性

- `getBackupPreview()` 需兼容两种格式的备份文件
- 检测备份文件格式：有 `profiles` 字段 → 新格式，否则 → 旧格式
- 还原旧格式备份后，下次读取时自动触发迁移

---

## 7. 实施步骤（建议顺序）

### Phase 1: 核心层（profile-manager.js）
1. 新增 `isOldFormat()` 和 `migrateFormat()` 函数
2. 修改 `getProfilesDecrypted()` 调用迁移 + 返回新格式
3. 修改 `saveProfilesSafe()` 接受新格式
4. 修改所有 CRUD 方法（add/update/remove/switch）
5. 新增 `getActive()`、`setActive()`、`getActiveProfile()`、`checkMismatch()`
6. 修改 `getBackupPreview()` 兼容新格式
7. **checkpoint**: 跑单元测试确认 Profile Manager 全部通过

### Phase 2: API 层（server.js）
1. 修改 `GET /api/profiles` 返回值
2. 修改 `GET /api/current` 返回值
3. 修改 `POST /api/profiles/clone` 适配新格式
4. **checkpoint**: 用 curl/Postman 验证 API 响应格式

### Phase 3: 前端（public/index.html）
1. 修改 `loadProfiles()` 解析新格式
2. 修改 `loadCurrent()` 解析新格式
3. 移除 `envMatches()` 函数
4. 新增不一致提示 UI
5. **checkpoint**: 浏览器手动测试完整流程

### Phase 4: CLI（index.js）
1. 修改 `listProfiles()` 适配新格式 + mismatch 提示
2. 修改 `showCurrent()` 适配新格式
3. 更新版本号
4. **checkpoint**: 命令行手动测试

### Phase 5: 测试（tests/index.test.js）
1. 更新所有现有测试适配新格式
2. 新增迁移测试（F19）
3. 新增 active 状态测试（F17）
4. 新增一致性检测测试（F18）
5. 新增 API 返回格式测试
6. **最终**: 全量回归测试 `npx vitest run`

---

## 8. 回滚方案

如果迁移后出现严重问题：

1. 从 `~/.claude-switch/backups/` 找到最新的 `migration` 备份
2. 复制备份文件覆盖 `profiles.json`
3. 回退代码到 v2 分支

代码层面建议在 v2.x 分支打 tag 后再开始 v3.0 开发。
