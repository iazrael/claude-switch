const fs = require('fs-extra');

// 跟踪当前注册的信号处理器，用于测试清理
const _activeSignalHandlers = [];
const path = require('path');
const { spawn } = require('child_process');
const { PID_PATH, SERVER_LOG_PATH } = require('./config');

// ─── 内部工具函数 ───

function resolvePort(portStr) {
  let port;
  let source;
  if (portStr) {
    port = parseInt(portStr, 10);
    source = portStr;
  } else if (process.env.CLAUDE_SWITCH_PORT) {
    port = parseInt(process.env.CLAUDE_SWITCH_PORT, 10);
    source = process.env.CLAUDE_SWITCH_PORT;
  } else {
    return 3333;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`错误: 端口必须是 1-65535 范围内的整数，收到: "${source}"`);
    process.exit(1);
  }
  return port;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分钟`);
  if (secs > 0) parts.push(`${secs}秒`);
  return parts.join('') || '0秒';
}

// ─── PID 管理 ───

async function readPidFile() {
  try {
    const content = await fs.readFile(PID_PATH, 'utf8');
    const data = JSON.parse(content);
    // 字段完整性验证：缺少 pid/port/startedAt 视为损坏
    if (!data || typeof data.pid !== 'number' || typeof data.port !== 'number' || !data.startedAt) {
      console.error('警告: PID 文件字段不完整，已忽略');
      return null;
    }
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    console.error(`警告: PID 文件损坏，已忽略 (${err.message})`);
    return null;
  }
}

async function writePidFile(port) {
  const data = {
    pid: process.pid,
    port,
    startedAt: new Date().toISOString(),
  };
  await fs.writeFile(PID_PATH, JSON.stringify(data, null, 2));
  await fs.chmod(PID_PATH, 0o600);
}

async function cleanupPid() {
  try {
    await fs.remove(PID_PATH);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

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

async function waitForPidFile(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pidInfo = await readPidFile();
    if (pidInfo) return pidInfo;
    await sleep(200);
  }
  return null;
}

async function waitForExit(pid, timeout, interval) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!isAlive(pid)) return true;
    await sleep(interval);
  }
  return false;
}

// ─── 日志轮转 ───

async function rotateLogIfNeeded(maxBytes) {
  try {
    const stat = await fs.stat(SERVER_LOG_PATH);
    if (stat.size >= maxBytes) {
      const backupPath = SERVER_LOG_PATH + '.old';
      await fs.move(SERVER_LOG_PATH, backupPath, { overwrite: true });
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // 文件不存在，无需处理
  }
}

// ─── 导出函数 ───

async function startForeground(port) {
  // 1. 防重复启动
  await ensureNotRunning();

  // 2. 确保 BASE_DIR 存在
  await fs.ensureDir(path.dirname(PID_PATH));

  // 3. 启动 Express（复用 server.js 导出的 app）
  // server.js 顶层 manager.init() 在 require 时已执行（模块缓存），不重复调用
  const app = require('../server');
  const server = app.listen(port, async () => {
    // PID 写入必须在 listen 成功回调内
    await writePidFile(port);
    console.log(`管理端已启动 → http://localhost:${port}`);
  });

  // listen 失败时 PID 尚未写入，无需清理
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

  const sigintHandler = () => shutdown('SIGINT');
  const sigtermHandler = () => shutdown('SIGTERM');
  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);
  _activeSignalHandlers.push(['SIGINT', sigintHandler], ['SIGTERM', sigtermHandler]);
}

async function startDaemon(port) {
  // 1. 防重复启动
  await ensureNotRunning();

  // 2. 确保 BASE_DIR 存在
  await fs.ensureDir(path.dirname(PID_PATH));

  // 3. 日志轮转：启动前检查日志文件大小，超过 10MB 则截断
  await rotateLogIfNeeded(10 * 1024 * 1024);

  // 4. 打开日志文件（追加写入）+ 设置权限
  const logFd = fs.openSync(SERVER_LOG_PATH, 'a');
  fs.fchmodSync(logFd, 0o600);

  // 5. spawn 子进程
  const child = spawn(
    process.execPath,
    [path.resolve(__dirname, 'serve.js'), '--daemon-child', String(port)],
    {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, CLAUDE_SWITCH_PORT: String(port) },
    }
  );

  // 6. 父进程关闭自身的 fd 副本（子进程通过 spawn stdio 继承了独立的 fd 副本，
  //    不受父进程 closeSync 影响。spawn 返回时子进程已完成 fd 继承/dup2，
  //    因此此时 closeSync 是安全的）
  child.unref();
  fs.closeSync(logFd);

  const pidInfo = await waitForPidFile(10000);
  if (!pidInfo) {
    console.error('错误: 后台进程启动失败，请检查日志:', SERVER_LOG_PATH);
    process.exit(1);
  }

  console.log(`管理端已后台启动 → PID: ${pidInfo.pid}, http://localhost:${port}, 日志: ${SERVER_LOG_PATH}`);
}

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
    await waitForExit(pid, 2000, 100);
  }

  // 5. 清理 PID 文件
  await cleanupPid();
  console.log(`服务已停止，PID: ${pid}`);
}

async function status() {
  const pidInfo = await readPidFile();
  if (!pidInfo) {
    console.log('服务未在运行');
    console.log('提示: 通过 node server.js 或 pm2 启动的服务不受 serve 命令管理');
    return;
  }

  const { pid, port, startedAt } = pidInfo;

  if (!isAlive(pid)) {
    // stale PID 自动清理
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

// ─── daemon 子进程入口 ───

async function daemonChildMain(port) {
  // require('../server') 触发 server.js 顶层代码执行
  // 其中包含 manager.init()，由于是首次 require 此模块，init 会执行
  const app = require('../server');

  const server = app.listen(port, async () => {
    // 仅在 listen 成功后写入 PID
    await writePidFile(port);
  });

  // listen 失败 → 退出，PID 未写入
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE'
      ? `端口 ${port} 已被占用`
      : `启动失败: ${err.message}`);
    process.exit(1);
  });

  // 优雅关闭
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    setTimeout(() => process.exit(1), 5000).unref();
    await cleanupPid();
    process.exit(0);
  };

  const sigintHandler = () => shutdown('SIGINT');
  const sigtermHandler = () => shutdown('SIGTERM');
  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);
  _activeSignalHandlers.push(['SIGINT', sigintHandler], ['SIGTERM', sigtermHandler]);
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

module.exports = {
  startForeground,
  startDaemon,
  stop,
  status,
  // 导出内部函数供测试使用
  _internal: {
    readPidFile,
    writePidFile,
    cleanupPid,
    ensureNotRunning,
    isAlive,
    resolvePort,
    formatUptime,
    rotateLogIfNeeded,
    waitForPidFile,
    waitForExit,
    _activeSignalHandlers,
    cleanupSignalHandlers() {
      for (const [signal, handler] of _activeSignalHandlers) {
        process.removeListener(signal, handler);
      }
      _activeSignalHandlers.length = 0;
    },
  },
};
