# 实现方案：Serve 命令（F20-F25）

> 版本：1.1 | 编写日期：2026-05-06 | 修订日期：2026-05-06
> 对应 SPEC：3.6 节 F20-F25
> 评审基线：REVIEW-SERVE.md v1.0

---

## 1. 架构设计

### 1.1 模块划分

```
index.js              [+改动] 注册 serve 子命令，确保 init 完成后再 parse
lib/config.js         [+改动] 新增 PID_PATH、SERVER_LOG_PATH 常量
lib/serve.js          [新增]   serve 命令全部逻辑（PID 管理、daemon spawn、stop、status、前台启动）
server.js             [不变]   零改动，保持 module.exports + require.main 兼容
```

### 1.2 调用关系

```
用户输入 `claude-switch serve [...]`
       │
       ▼
  index.js (Commander serve 命令)
       │  await manager.init() 完成 → 解析参数 → 校验互斥
       ▼
  lib/serve.js
       │
       ├── startForeground(port) ──► require('../server') + app.listen() + listen 成功后写 PID + 信号处理
       ├── startDaemon(port)     ──► spawn('node', ['lib/serve.js', '--daemon-child'], { detached }) + 轮询 PID 文件 + unref
       ├── stop()                ──► 读 PID → SIGTERM → 轮询 → SIGKILL → 清理
       └── status()              ──► 读 PID → process.kill(pid,0) → 打印信息 / stale 自动清理
```

### 1.3 设计原则

- **server.js 零改动**：前台/后台都通过 `require('../server')` 获取 Express app 实例，复用 `module.exports = app`。`require.main === module` 的直接运行路径不受影响。
- **lib/serve.js 独立**：所有 serve 逻辑（PID 读写、daemon spawn、信号处理）封装在此模块，不污染 server.js。
- **不引入新依赖**：纯 Node.js 标准库（`child_process`、`fs`、`path`、`signal`）。
- **manager.init() 安全**：serve 子进程复用 Node 模块缓存，`require('../server')` 时 server.js 顶层的 `manager.init()` 已在模块加载阶段执行，serve 代码中不重复调用。[❌-3]

---

## 2. 文件修改清单

### 2.1 `lib/config.js` — 新增 2 个路径常量

```diff
+ const PID_PATH = path.join(BASE_DIR, 'server.pid');
+ const SERVER_LOG_PATH = path.join(BASE_DIR, 'server.log');

  module.exports = {
    SETTINGS_PATH,
    PROFILES_PATH,
    BACKUP_DIR,
    LOG_DIR,
+   PID_PATH,
+   SERVER_LOG_PATH,
  };
```

### 2.2 `lib/serve.js` — 新增文件（~220 行）

导出 4 个 async 函数：

| 函数 | 签名 | 职责 |
|------|------|------|
| `startForeground` | `(port: number) => Promise<void>` | 前台启动 Express，listen 成功后写 PID，注册信号处理 |
| `startDaemon` | `(port: number) => Promise<void>` | spawn 子进程后台运行，轮询 PID 文件确认启动，父进程 unref 退出 |
| `stop` | `() => Promise<void>` | 读取 PID → SIGTERM → 轮询 → 清理 |
| `status` | `() => Promise<void>` | 读取 PID → 检测存活 → 打印状态（stale 自动清理） |
| `writePidFile` | `(port: number) => Promise<void>` | 内部：写入 PID 文件（仅 listen 成功回调内调用）[❌-1] |
| `readPidFile` | `() => Promise<{pid, port, startedAt} \| null>` | 内部：读取并解析 PID 文件（损坏时返回 null + 警告）[⚠️-6] |
| `cleanupPid` | `() => Promise<void>` | 内部：删除 PID 文件 |

### 2.3 `index.js` — 注册 serve 子命令 + init 时序修正（~35 行改动）[❌-3]

在现有命令注册之后、无参数处理之前，新增 Commander 子命令。

**关键变更**：`else` 分支中 `manager.init()` 改为 await 后再 `program.parse()`，确保所有命令（含 serve）在 init 完成后执行。

```diff
  } else {
-   manager.init().catch(() => {});
-   program.parse(process.argv);
+   manager.init().then(() => {
+     program.parse(process.argv);
+   }).catch(err => {
+     console.error(chalk.red('初始化失败: ' + err.message));
+     process.exit(1);
+   });
  }
```

### 2.4 `server.js` — 不改动

`server.js` 已通过 `module.exports = app` 导出 Express 实例，`require.main === module` 分支独立处理直接运行场景。serve 命令通过 `require('./server')` 获取 app，无需修改。

---

## 3. 核心流程伪代码

### 3.1 index.js — serve action handler

```javascript
async function serveAction(opts) {
  const serve = require('./lib/serve');
  const { stop, status, daemon, port: portStr } = opts;

  // --- 互斥校验 ---
  const controlFlags = [stop, status].filter(Boolean).length;
  const runFlags = [daemon, portStr].filter(Boolean).length;
  if (controlFlags > 1) {
    console.error('错误: --stop 和 --status 不能同时指定');
    process.exit(1);
  }
  if (controlFlags === 1 && runFlags > 0) {
    console.error('错误: --stop/--status 与 -d/-p 互斥');
    process.exit(1);
  }

  // --- 端口解析 ---
  const port = resolvePort(portStr);
  // resolvePort: -p > CLAUDE_SWITCH_PORT > 3333

  // --- 分发 ---
  if (stop)    return serve.stop();
  if (status)  return serve.status();
  if (daemon)  return serve.startDaemon(port);
  return serve.startForeground(port);
}
```

### 3.2 lib/serve.js — startForeground

> **[❌-1 修订]** PID 写入移到 `app.listen()` 成功回调内。listen 失败时不写 PID，无需清理。

```javascript
async function startForeground(port) {
  // 1. 防重复启动
  await ensureNotRunning();

  // 2. 确保 BASE_DIR 存在
  await fse.ensureDir(path.dirname(PID_PATH));

  // 3. 启动 Express（复用 server.js 导出的 app）
  const app = require('../server');
  // 注意：server.js 顶层 manager.init() 在 require 时已执行（模块缓存），不重复调用 [❌-3]
  const server = app.listen(port, async () => {
    // [❌-1] PID 写入必须在 listen 成功回调内
    await writePidFile(port);
    console.log(`管理端已启动 → http://localhost:${port}`);
  });

  // [❌-1] listen 失败时 PID 尚未写入，无需清理
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE'
      ? `端口 ${port} 已被占用`
      : `启动失败: ${err.message}`);
    process.exit(1);
  });

  // 4. 优雅关闭
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n收到 ${signal}，正在关闭...`);
    server.close();
    const timeout = setTimeout(() => {
      console.log('等待超时，强制退出');
      process.exit(1);
    }, 5000);
    timeout.unref();
    await cleanupPid();
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
```

### 3.3 lib/serve.js — startDaemon

> **[❌-2 修订]** 父进程 spawn 后轮询 PID 文件（超时 10s），出现才报成功并退出；超时以非零退出码退出。不再使用 `child.pid`，改用 PID 文件中的 PID。
> **[⚠️-7 修订]** spawn 路径简化为 `__dirname + 'serve.js'`。
> **[⚠️-5 修订]** 日志文件创建时设置 600 权限。

```javascript
async function startDaemon(port) {
  // 1. 防重复启动
  await ensureNotRunning();

  // 2. 确保 BASE_DIR 存在
  await fse.ensureDir(path.dirname(PID_PATH));

  // 3. [⚠️-1] 日志轮转：启动前检查日志文件大小，超过 10MB 则截断
  await rotateLogIfNeeded(10 * 1024 * 1024); // 10MB

  // 4. 打开日志文件（追加写入）+ 设置权限 [⚠️-5]
  const logFd = fs.openSync(SERVER_LOG_PATH, 'a');
  fs.fchmodSync(logFd, 0o600);

  // 5. spawn 子进程
  //    [⚠️-7] 路径简化：__dirname 已是 lib/，直接引用 serve.js
  //    process.execPath 在大多数场景下指向正确的 node 二进制
  const child = spawn(
    process.execPath,
    [path.resolve(__dirname, 'serve.js'), '--daemon-child', String(port)],
    {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, CLAUDE_SWITCH_PORT: String(port) },
    }
  );

  // 6. [❌-2] 等待 PID 文件出现（轮询，最多 10s），确认子进程启动成功
  child.unref();
  fs.closeSync(logFd);

  const pidInfo = await waitForPidFile(10000);
  if (!pidInfo) {
    // [❌-2] 超时 → 非零退出码，打印错误
    console.error('错误: 后台进程启动失败，请检查日志:', SERVER_LOG_PATH);
    process.exit(1);
  }

  // [❌-2] 使用 PID 文件中的 PID（而非 child.pid），确保一致性
  console.log(`管理端已后台启动 → PID: ${pidInfo.pid}, http://localhost:${port}, 日志: ${SERVER_LOG_PATH}`);
}
```

### 3.4 lib/serve.js — daemonChildMain（子进程入口）

> **[❌-1 修订]** PID 写入移到 listen 成功回调内。
> **[❌-3 修订]** 不重复调用 manager.init()，依赖 require('../server') 触发的模块顶层 init。

```javascript
// 当通过 `node lib/serve.js --daemon-child <port>` 运行时：
async function daemonChildMain(port) {
  // [❌-3] require('../server') 触发 server.js 顶层代码执行
  // 其中包含 manager.init()，由于是首次 require 此模块，init 会执行
  // serve.js 代码中不重复调用 manager.init()
  const app = require('../server');

  const server = app.listen(port, async () => {
    // [❌-1] 仅在 listen 成功后写入 PID
    await writePidFile(port);
    // 子进程不打印到 stdout（已重定向到日志文件）
  });

  // [❌-1] listen 失败 → 退出，PID 未写入
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE'
      ? `端口 ${port} 已被占用`
      : `启动失败: ${err.message}`);
    process.exit(1);
  });

  // 优雅关闭（同前台模式）
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    setTimeout(() => process.exit(1), 5000).unref();
    await cleanupPid();
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// 底部自执行检测
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--daemon-child') {
    const port = parseInt(args[1] || process.env.CLAUDE_SWITCH_PORT || '3333', 10);
    daemonChildMain(port).catch(err => {
      console.error('daemon 启动失败:', err.message);
      process.exit(1);
    });
  }
}
```

### 3.5 lib/serve.js — stop

```javascript
async function stop() {
  const pidInfo = await readPidFile();
  if (!pidInfo) {
    console.log('服务未在运行');
    process.exit(1);
  }

  const { pid, port } = pidInfo;

  // 1. 检查进程是否存活
  if (!isAlive(pid)) {
    await cleanupPid();
    console.log(`PID 文件存在但进程 ${pid} 已退出（stale），已清理`);
    return;
  }

  // 2. 发送 SIGTERM
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    if (err.code === 'ESRCH') {
      await cleanupPid();
      console.log('进程已退出，已清理 PID 文件');
      return;
    }
    throw err;
  }

  // 3. 轮询等待退出（每 200ms，最多 5s）
  const exited = await waitForExit(pid, 5000, 200);

  if (!exited) {
    // 4. 超时 → SIGKILL
    console.log('SIGTERM 超时，发送 SIGKILL...');
    try {
      process.kill(pid, 'SIGKILL');
    } catch (e) {
      // ESRCH: 已退出，忽略
    }
    await waitForExit(pid, 2000, 100); // 再等 2s
  }

  // 5. 清理 PID 文件
  await cleanupPid();
  console.log(`服务已停止，PID: ${pid}`);
}
```

### 3.6 lib/serve.js — status

> **[⚠️-4 修订]** 检测到 stale PID 时自动清理，减少用户操作步骤。
> **[⚠️-3 修订]** 增加兼容方式启动的提示。

```javascript
async function status() {
  const pidInfo = await readPidFile();
  if (!pidInfo) {
    console.log('服务未在运行');
    // [⚠️-3] 提示兼容启动方式
    console.log('提示: 通过 node server.js 或 pm2 启动的服务不受 serve 命令管理');
    return;
  }

  const { pid, port, startedAt } = pidInfo;

  if (!isAlive(pid)) {
    // [⚠️-4] stale PID 自动清理，不再让用户多一步操作
    await cleanupPid();
    console.log(`PID 文件存在但进程已退出（stale），已自动清理`);
    console.log(`  PID: ${pid}, 端口: ${port}`);
    return;
  }

  const uptime = Date.now() - new Date(startedAt).getTime();
  const uptimeStr = formatUptime(uptime);

  console.log('服务运行中');
  console.log(`  PID:   ${pid}`);
  console.log(`  端口:  ${port}`);
  console.log(`  地址:  http://localhost:${port}`);
  console.log(`  启动:  ${startedAt}`);
  console.log(`  运行:  ${uptimeStr}`);
  console.log(`  日志:  ${SERVER_LOG_PATH}`);
}
```

### 3.7 辅助函数

#### readPidFile（含损坏处理）

> **[⚠️-6 修订]** JSON 解析失败时返回 null 并打印警告，而非抛出异常。

```javascript
async function readPidFile() {
  try {
    const content = await fse.readFile(PID_PATH, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    // [⚠️-6] 文件损坏（非 JSON），返回 null 并打印警告
    console.error(`警告: PID 文件损坏，已忽略 (${err.message})`);
    return null;
  }
}
```

#### writePidFile（含权限设置）

> **[⚠️-5 修订]** 写入后设置 600 权限。

```javascript
async function writePidFile(port) {
  const data = {
    pid: process.pid,
    port,
    startedAt: new Date().toISOString(),
  };
  await fse.writeFile(PID_PATH, JSON.stringify(data, null, 2));
  // [⚠️-5] 与项目规范一致，设置 600 权限
  await fse.chmod(PID_PATH, 0o600);
}
```

#### waitForPidFile

> **[❌-2 修订]** 超时返回 null，由调用方决定退出策略。

```javascript
async function waitForPidFile(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pidInfo = await readPidFile();
    if (pidInfo) return pidInfo;
    await sleep(200); // 每 200ms 轮询一次
  }
  return null;
}
```

#### rotateLogIfNeeded

> **[⚠️-1 修订]** daemon 启动时检查日志大小，超阈值截断。

```javascript
async function rotateLogIfNeeded(maxBytes) {
  try {
    const stat = await fse.stat(SERVER_LOG_PATH);
    if (stat.size >= maxBytes) {
      // 截断：备份旧日志，清空当前文件
      const backupPath = SERVER_LOG_PATH + '.old';
      await fse.move(SERVER_LOG_PATH, backupPath, { overwrite: true });
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // 文件不存在，无需处理
  }
}
```

---

## 4. 边界情况处理

### 4.1 Stale PID 文件

**场景**：进程异常退出（kill -9、系统崩溃），PID 文件残留。

**处理**：
- `startForeground` / `startDaemon` 启动前调用 `ensureNotRunning()`：
  ```javascript
  async function ensureNotRunning() {
    const pidInfo = await readPidFile();
    if (!pidInfo) return;
    if (isAlive(pidInfo.pid)) {
      console.error(`服务已在运行，PID: ${pidInfo.pid}，端口: ${pidInfo.port}`);
      process.exit(1);
    }
    // stale → 清理后继续
    await cleanupPid();
  }
  ```
- `--status` 检测到 stale 时**自动清理**并提示。[⚠️-4]
- `--stop` 检测到进程已退出时直接清理 PID 文件。

### 4.2 EADDRINUSE — 端口被占用

**场景**：其他进程占用了目标端口。

**处理**：
- PID 写入在 `listen` 成功回调内，listen 失败时 PID 尚未写入，无需清理。[❌-1]
- `server.on('error', ...)` 捕获 `EADDRINUSE`，打印错误信息并 `process.exit(1)`。

### 4.3 信号竞态

**场景**：快速连续发送多个 SIGINT/SIGTERM。

**处理**：
- 使用 `let shuttingDown = false` 标志位，防止重复执行 shutdown。

### 4.4 SIGTERM 后进程不退出

**场景**：Express 的 `server.close()` 等待长连接完成，进程卡住。

**处理**：
- 5 秒 `setTimeout` 强制 `process.exit(1)`，`unref()` 确保不阻止正常退出。

### 4.5 daemon 子进程启动失败

**场景**：子进程启动失败（端口冲突、权限问题等），PID 文件不出现。

**处理**：
- 父进程 `waitForPidFile(10000)` 轮询等待 PID 文件出现。[❌-2]
- 超时 10s 后以**非零退出码**退出，打印错误提示。
- PID 文件出现后，从文件读取 PID 打印（不使用 `child.pid`）。

### 4.6 多用户 / 权限问题

**场景**：不同用户运行 `serve`，PID 文件写入冲突。

**处理**：
- PID 文件在用户级 `~/.claude-switch/` 目录下，天然隔离。不额外处理。

### 4.7 `node server.js` 向后兼容

**场景**：用户仍使用 `node server.js` 直接启动，不走 serve 命令。

**处理**：
- `server.js` 完全不改动，`require.main === module` 分支照常工作。
- 这种方式不写 PID 文件，不参与 serve 的管理。两套方式互不干扰。
- `serve --status` 在服务未运行时增加提示：`提示: 通过 node server.js 或 pm2 启动的服务不受 serve 命令管理`。[⚠️-3]

### 4.8 Windows 兼容

**场景**：Windows 上 `detached` + `unref` 行为不同，信号机制不同。

**处理**：
- SPEC 明确标注"Windows 理论上可用但未测试"。
- daemon 模式在 Windows 上可能表现为新窗口进程，不阻塞主进程即可。
- 不额外适配。

### 4.9 PID 回收风险

**场景**：PID 文件中记录的 PID 被系统回收分配给无关进程。

**影响评估**：
- `process.kill(pid, 0)` 只检查进程是否存在，不验证是否是原 server 进程。
- 理论场景：服务异常退出 → PID 被回收 → `serve --status` 误报 → `serve --stop` 误杀。
- 实际概率：PID 空间大（macOS 默认 99999），短期回收概率极低。

**处理**：[⚠️-2]
- 在 SPEC「限制与已知问题」章节中明确说明此风险。
- 可选增强（后续版本）：PID 文件中记录启动时间，status/stop 时比对进程启动时间验证身份。本版本不实现。

### 4.10 manager.init() 并发安全

**场景**：index.js 的 else 分支中 `manager.init()` 未完成时，serve action handler 中的 `require('../server')` 触发 server.js 顶层另一次 `manager.init()`。

**处理**：[❌-3]
- **方案 A（已采用）**：修改 index.js else 分支，`await manager.init()` 完成后再 `program.parse()`。这样 serve action 执行时 init 已完成。当 `require('../server')` 触发 server.js 顶层 `manager.init()` 时，由于 Node.js 模块缓存机制，`require('./lib/profile-manager')` 返回的是同一实例——但 `manager.init()` 是否幂等取决于其实现。
- **方案 B（备用）**：在 serve action handler 中显式 await `manager.initReady`（如果 manager 暴露 init promise）。但需要改动 profile-manager.js。
- **推荐**：方案 A 已足够，并在 daemonChildMain 中同样不重复调用 init（server.js 顶层 init 在首次 require 时自动执行）。

---

## 5. 文件内容详细设计

### 5.1 `lib/serve.js` 完整结构

```
lib/serve.js
├── const/imports
│   ├── fs (fs-extra)
│   ├── path
│   ├── child_process.spawn
│   ├── { PID_PATH, SERVER_LOG_PATH } from config
│
├── 内部工具函数
│   ├── resolvePort(portStr)        // -p > env > 3333
│   ├── isAlive(pid)                // process.kill(pid, 0) try-catch
│   ├── sleep(ms)                   // Promise resolve
│   ├── formatUptime(ms)            // → "2天3小时15分钟" 或 "5分钟12秒"
│   ├── rotateLogIfNeeded(maxBytes) // [⚠️-1] 日志轮转检查
│
├── PID 管理
│   ├── readPidFile()               // → {pid, port, startedAt} | null（损坏返回 null + 警告）[⚠️-6]
│   ├── writePidFile(port)          // 写入 JSON + chmod 600 [⚠️-5]
│   ├── cleanupPid()                // 删除 PID 文件
│   ├── ensureNotRunning()          // 读 PID → 存活则 exit(1)，不存活则清理
│   ├── waitForPidFile(timeoutMs)   // 轮询等待 PID 文件出现（超时返回 null）[❌-2]
│   ├── waitForExit(pid, timeout, interval)  // 轮询等待进程退出
│
├── 4 个导出函数
│   ├── startForeground(port)       // PID 在 listen 回调内写入 [❌-1]
│   ├── startDaemon(port)           // 轮询 PID 文件确认启动，失败非零退出 [❌-2]
│   ├── stop()
│   └── status()                    // stale PID 自动清理 [⚠️-4]，兼容方式提示 [⚠️-3]
│
├── daemonChildMain(port)           // 子进程入口，PID 在 listen 回调内写入 [❌-1]，不重复 init [❌-3]
│
└── 自执行检测（require.main === module）
    └── 检测 --daemon-child → daemonChildMain()
```

### 5.2 PID 文件格式

```json
{
  "pid": 12345,
  "port": 3333,
  "startedAt": "2026-05-06T10:30:00.000Z"
}
```

文件权限：`600`（`writePidFile` 写入后 `chmod`）。[⚠️-5]

---

## 6. 测试用例清单

新增测试文件 `tests/serve.test.js`，使用 Vitest + 临时目录隔离。

### 6.1 PID 管理单元测试

| # | 用例 | 验证点 |
|---|------|--------|
| 1 | `writePidFile` 写入正确 JSON | 文件存在，内容可解析，字段完整 |
| 2 | `writePidFile` 设置 600 权限 | 文件权限为 0o600 [⚠️-5] |
| 3 | `readPidFile` 正常读取 | 返回正确的 pid/port/startedAt |
| 4 | `readPidFile` 文件不存在 | 返回 null |
| 5 | `readPidFile` 文件内容损坏（非 JSON） | 返回 null，打印警告 [⚠️-6] |
| 6 | `cleanupPid` 删除 PID 文件 | 文件不存在 |
| 7 | `ensureNotRunning` PID 不存在 | 正常返回（不抛错） |
| 8 | `ensureNotRunning` PID 存在但进程不存活 | 清理 PID 文件后返回 |
| 9 | `isAlive` 检测当前进程 | 返回 true |
| 10 | `isAlive` 检测不存在的 PID | 返回 false |

### 6.2 startForeground 测试

| # | 用例 | 验证点 |
|---|------|--------|
| 11 | 前台启动成功 | Express 可访问，PID 文件写入 |
| 12 | 前台启动成功 → PID 在 listen 回调后写入 | PID 文件仅在 HTTP 请求可达后出现 [❌-1] |
| 13 | 前台启动端口冲突 | EADDRINUSE 错误处理，PID 文件未写入 [❌-1] |
| 14 | 前台启动时已有运行实例 | 打印错误信息，exit(1) |
| 15 | SIGTERM 优雅关闭 | PID 文件清理，进程退出 |

### 6.3 startDaemon 测试

| # | 用例 | 验证点 |
|---|------|--------|
| 16 | daemon 启动成功 | 子进程存活，PID 文件写入，Express 可访问 |
| 17 | daemon 启动 → 父进程打印 PID 文件中的 PID | 使用 readPidFile 返回值，非 child.pid [❌-2] |
| 18 | daemon 启动后父进程退出 | 父进程退出码 0，子进程继续运行 |
| 19 | daemon 启动时已有运行实例 | 打印错误信息，不 spawn 子进程 |
| 20 | daemon 日志重定向 | 子进程 stdout/stderr 写入 server.log |
| 21 | daemon 启动失败（端口冲突）→ 父进程非零退出 | PID 文件不出现，父进程 exit(1) [❌-2] |
| 22 | daemon 启动超时（PID 文件 10s 未出现） | 父进程打印错误，exit(1) [❌-2] |
| 23 | daemon 日志超过 10MB 时截断 | 旧日志移至 .old，新文件为空 [⚠️-1] |

### 6.4 stop 测试

| # | 用例 | 验证点 |
|---|------|--------|
| 24 | 停止运行中的服务 | 进程退出，PID 文件清理 |
| 25 | 停止不存在的服务 | 打印"服务未在运行"，exit(1) |
| 26 | 停止 stale PID | 清理 PID 文件，打印提示 |
| 27 | SIGTERM 超时后 SIGKILL | 进程被 SIGKILL 终止，PID 清理 |

### 6.5 status 测试

| # | 用例 | 验证点 |
|---|------|--------|
| 28 | 查询运行中的服务 | 输出包含 PID、端口、运行时长 |
| 29 | 查询未运行的服务 | 输出"服务未在运行" + 兼容方式提示 [⚠️-3] |
| 30 | 查询 stale PID → 自动清理 | 输出"已自动清理"，PID 文件已删除 [⚠️-4] |

### 6.6 index.js 集成测试

| # | 用例 | 验证点 |
|---|------|--------|
| 31 | `--stop` 与 `--status` 互斥 | 报错退出 |
| 32 | `--stop` 与 `-d` 互斥 | 报错退出 |
| 33 | `-p` 端口优先级 | 覆盖 CLAUDE_SWITCH_PORT 环境变量 |
| 34 | 默认端口 3333 | 无 -p 无环境变量时使用 3333 |
| 35 | init 完成后才执行 serve action | manager.init() resolve 后 program.parse 才执行 [❌-3] |

### 6.7 向后兼容测试

| # | 用例 | 验证点 |
|---|------|--------|
| 36 | `node server.js` 仍可启动 | Express 正常监听，不写 PID 文件 |
| 37 | `node server.js` + `serve` 不冲突 | 两者可分别独立运行（不同端口） |

### 6.8 文件权限测试

| # | 用例 | 验证点 |
|---|------|--------|
| 38 | PID 文件权限 600 | 写入后 stat.mode & 0o777 === 0o600 [⚠️-5] |
| 39 | server.log 权限 600 | daemon 创建后 stat.mode & 0o777 === 0o600 [⚠️-5] |

---

## 7. 实现顺序建议

| 步骤 | 内容 | 预估 |
|------|------|------|
| 1 | `lib/config.js` 新增常量 | 5 分钟 |
| 2 | `lib/serve.js` — PID 管理函数 + 工具函数（含 readPidFile 损坏处理、writePidFile 权限、rotateLogIfNeeded） | 40 分钟 |
| 3 | `lib/serve.js` — startForeground + 信号处理（PID 在 listen 回调内写入） | 20 分钟 |
| 4 | `lib/serve.js` — stop + status（stale 自动清理、兼容提示） | 25 分钟 |
| 5 | `lib/serve.js` — startDaemon + daemonChildMain（PID 轮询确认、日志轮转） | 35 分钟 |
| 6 | `index.js` — 注册 serve 子命令 + init 时序修正 | 15 分钟 |
| 7 | 单元测试 | 35 分钟 |
| 8 | 集成测试（daemon 流程） | 30 分钟 |
| **总计** | | **~3.5 小时** |

---

## 8. 风险与注意事项

1. **daemon spawn 路径**：子进程入口为 `lib/serve.js`（不是 `server.js`），因为需要传入 `--daemon-child` 参数。[⚠️-7] 路径简化为 `path.resolve(__dirname, 'serve.js')`。
2. **server.js 的 `manager.init()`**：每次 `require('../server')` 都会触发 Express 模块顶层代码中的 `manager.init()`。由于 Node.js 模块缓存，多次 require 只执行一次。serve 子进程（daemonChildMain）中不重复调用 init。[❌-3]
3. **index.js init 时序**：else 分支改为 `manager.init().then(() => program.parse())`，确保所有命令（含 serve）在 init 完成后执行。这改变了所有命令的初始化方式，需要回归验证其他命令（current、list、add、remove、switch）不受影响。[❌-3]
4. **环境变量传递**：daemon spawn 时需要将父进程的环境变量完整传递（`{ ...process.env }`），并显式设置 `CLAUDE_SWITCH_PORT`，确保子进程能获取正确的端口和路径配置。
5. **fs-extra vs fs**：项目已依赖 `fs-extra`，`lib/serve.js` 应使用 `fs-extra` 以保持一致性，并利用其 `ensureDir`、`remove` 等 Promise 化 API。
6. **chalk 输出**：CLI 输出使用 `chalk`（项目已依赖），与现有命令风格一致。
7. **PID 回收风险**：已在 4.9 节和 SPEC 限制章节说明。本版本不实现启动时间验证增强。[⚠️-2]
8. **process.execPath**：在大多数场景下指向正确的 node 二进制。通过 npm link 或 npx 安装时可能指向全局 npm 的 node，但实际行为一致（都是 node 运行 JS 文件）。保持使用，在代码中加注释说明。[⚠️-7]

---

## 9. 评审修订记录

> 以下记录评审报告（REVIEW-SERVE.md v1.0）中每个问题的处理方式。

### ❌ 必须修改（3 个）

| 编号 | 问题 | 处理方式 | 影响章节 |
|------|------|----------|----------|
| ❌-1 | PID 写入时序：伪代码在 listen 回调外写 PID | PID 写入移到 `app.listen()` 成功回调内，`daemonChildMain` 同理。listen 失败时 PID 未写入，无需清理。移除了 4.2 节中"PID 文件在 listen 回调前写入，失败需要清理"的旧描述。 | 3.2, 3.4, 4.2 |
| ❌-2 | daemon 启动确认：父进程 unref 后立即退出，无法感知子进程失败 | `waitForPidFile` 超时从 3s 增加到 10s，超时后父进程以非零退出码退出。成功消息使用 PID 文件中的 PID（非 `child.pid`）。移除了"打印警告即可"的旧描述。 | 3.3, 4.5 |
| ❌-3 | manager.init() 并发：index.js else 分支 fire-and-forget init + server.js 顶层 init | 双管齐下：(1) index.js else 分支改为 `init().then(() => parse())`，确保所有命令在 init 完成后执行；(2) serve action 和 daemonChildMain 中不重复调用 init，依赖 require('../server') 触发的模块缓存。 | 2.3, 3.2, 3.4, 4.10 |

### ⚠️ 建议修改（7 个）

| 编号 | 问题 | 处理方式 | 影响章节 |
|------|------|----------|----------|
| ⚠️-1 | server.log 无轮转机制 | 新增 `rotateLogIfNeeded(maxBytes)` 函数，daemon 启动前检查日志大小，超过 10MB 移至 `.old` 备份并清空。 | 3.3, 3.7, 测试 #23 |
| ⚠️-2 | PID 回收风险未说明 | 新增 4.9 节详细说明风险和影响评估。标注为已知限制，可选增强方案留待后续版本。 | 4.9, 8 |
| ⚠️-3 | node server.js 与 serve --status 信息不对称 | `status()` 在服务未运行时追加提示"通过 node server.js 或 pm2 启动的服务不受 serve 命令管理"。 | 3.6, 4.7, 测试 #29 |
| ⚠️-4 | --status stale PID 处理不一致 | `status()` 检测到 stale PID 时直接清理并打印"已自动清理"，不再建议用户手动执行 --stop。 | 3.6, 测试 #30 |
| ⚠️-5 | PID/日志文件缺少权限设置 | `writePidFile` 写入后 `chmod 600`。daemon 日志文件 `openSync` 后 `fchmodSync(0o600)`。新增测试用例验证。 | 3.7, 测试 #38-39 |
| ⚠️-6 | readPidFile 损坏处理不明确 | `readPidFile` 在 JSON 解析失败时返回 `null` 并打印警告（与文件不存在同等处理），不抛出异常。 | 3.7, 测试 #5 |
| ⚠️-7 | daemon spawn 路径冗余 | spawn 参数从 `path.resolve(__dirname, '..', 'lib', 'serve.js')` 简化为 `path.resolve(__dirname, 'serve.js')`。`process.execPath` 保持不变，加注释说明。 | 3.3, 8 |
