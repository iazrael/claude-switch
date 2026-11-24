import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { Server } from 'http';
import type { Express } from 'express';
import { PID_PATH, SERVER_LOG_PATH, SERVE_CONFIG_PATH } from './config.js';
import { PidInfo, ServeConfig } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 未指定端口时优先尝试的默认端口
const DEFAULT_PORT = 3333;
// 自动模式下最多顺序尝试的端口数量，用尽后交给系统分配
const MAX_PORT_ATTEMPTS = 20;

export interface PortResolution {
  port: number;
  /** true: 用户显式指定（-p 或环境变量），端口冲突时直接失败 */
  explicit: boolean;
}

export interface StartOptions {
  /** 默认 true；false 表示端口冲突时自动尝试下一个端口 */
  explicit?: boolean;
}

interface ListenResult {
  server: Server;
  port: number;
}

// 跟踪当前注册的信号处理器，用于测试清理
const _activeSignalHandlers: Array<[string, (...args: any[]) => void]> = [];

// ─── 内部工具函数 ───

function parsePort(value: string | number): number {
  const port = typeof value === 'number' ? value : parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`错误: 端口必须是 0-65535 范围内的整数，收到: "${value}"`);
    process.exit(1);
  }
  return port;
}

// 端口优先级：-p > CLAUDE_SWITCH_PORT > 上次保存的端口 > 默认 3333
async function resolvePort(portStr?: string | number): Promise<PortResolution> {
  if (portStr !== undefined && portStr !== '') {
    return { port: parsePort(portStr), explicit: true };
  }
  if (process.env.CLAUDE_SWITCH_PORT) {
    return { port: parsePort(process.env.CLAUDE_SWITCH_PORT), explicit: true };
  }
  const saved = await readServeConfig();
  return { port: saved ?? DEFAULT_PORT, explicit: false };
}

// ─── 端口配置持久化 ───

async function readServeConfig(): Promise<number | null> {
  try {
    const content = await fs.readFile(SERVE_CONFIG_PATH, 'utf8');
    const data = JSON.parse(content) as Partial<ServeConfig> | null;
    const port = data?.port;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      console.error('警告: 端口配置文件内容无效，已忽略');
      return null;
    }
    return port;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.error(`警告: 端口配置文件损坏，已忽略 (${(err as Error).message})`);
    return null;
  }
}

async function writeServeConfig(port: number): Promise<void> {
  const tmpPath = SERVE_CONFIG_PATH + '.tmp';
  await fs.writeFile(tmpPath, JSON.stringify({ port }, null, 2));
  await fs.chmod(tmpPath, 0o600);
  await fs.move(tmpPath, SERVE_CONFIG_PATH, { overwrite: true });
}

// 启动成功后记住实际端口；显式 -p 0 表示一次性随机端口，不记忆
async function persistPort(actualPort: number, requestedPort: number): Promise<void> {
  if (requestedPort === 0) return;
  try {
    await writeServeConfig(actualPort);
  } catch (err: unknown) {
    console.error(`警告: 端口配置保存失败，下次启动将重新选择端口 (${(err as Error).message})`);
  }
}

// ─── 监听与端口回退 ───

function tryListen(app: Express, port: number): Promise<ListenResult> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);
    server.once('listening', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'string' ? port : (addr?.port ?? port);
      resolve({ server, port: actualPort });
    });
    server.once('error', (err: Error) => {
      server.removeAllListeners();
      // listen 失败后 server 未处于监听状态，close 仅用于释放内部资源
      server.close(() => {});
      reject(err);
    });
  });
}

function buildCandidatePorts(startPort: number): number[] {
  if (startPort === 0) return [0];
  const ports: number[] = [];
  for (let p = startPort; p <= 65535 && ports.length < MAX_PORT_ATTEMPTS; p++) {
    ports.push(p);
  }
  // 顺序尝试用尽后交给系统分配
  ports.push(0);
  return ports;
}

async function listenWithFallback(
  app: Express,
  startPort: number,
  explicit: boolean
): Promise<ListenResult> {
  // 显式指定的端口不回退，避免脚本静默连到错误地址
  if (explicit) return tryListen(app, startPort);

  const candidates = buildCandidatePorts(startPort);
  let lastError: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      return await tryListen(app, candidate);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
      lastError = err;
      const next = candidates[i + 1];
      if (next !== undefined) {
        console.error(
          next === 0
            ? `端口 ${candidate} 已被占用，改用系统分配端口`
            : `端口 ${candidate} 已被占用，尝试 ${next}`
        );
      }
    }
  }
  throw lastError;
}

// 返回 void 而非 never，便于测试 mock process.exit 后继续走后续分支
function exitOnListenError(err: unknown, port: number): void {
  const code = (err as NodeJS.ErrnoException).code;
  console.error(code === 'EADDRINUSE'
    ? `端口 ${port} 已被占用`
    : `启动失败: ${(err as Error).message}`);
  process.exit(1);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatUptime(ms: number): string {
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

async function readPidFile(): Promise<PidInfo | null> {
  try {
    const content = await fs.readFile(PID_PATH, 'utf8');
    const data = JSON.parse(content);
    // 字段完整性验证：缺少 pid/port/startedAt 视为损坏
    if (!data || typeof data.pid !== 'number' || typeof data.port !== 'number' || !data.startedAt) {
      console.error('警告: PID 文件字段不完整，已忽略');
      return null;
    }
    return data;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.error(`警告: PID 文件损坏，已忽略 (${(err as Error).message})`);
    return null;
  }
}

async function writePidFile(port: number): Promise<void> {
  const data: PidInfo = {
    pid: process.pid,
    port,
    startedAt: new Date().toISOString(),
  };
  await fs.writeFile(PID_PATH, JSON.stringify(data, null, 2));
  await fs.chmod(PID_PATH, 0o600);
}

async function cleanupPid(): Promise<void> {
  try {
    await fs.remove(PID_PATH);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

async function ensureNotRunning(): Promise<void> {
  const pidInfo = await readPidFile();
  if (!pidInfo) return;
  if (isAlive(pidInfo.pid)) {
    console.error(`服务已在运行，PID: ${pidInfo.pid}，端口: ${pidInfo.port}`);
    process.exit(1);
  }
  // stale → 清理后继续
  await cleanupPid();
}

async function waitForPidFile(timeoutMs: number): Promise<PidInfo | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pidInfo = await readPidFile();
    if (pidInfo) return pidInfo;
    await sleep(200);
  }
  return null;
}

async function waitForExit(pid: number, timeout: number, interval: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!isAlive(pid)) return true;
    await sleep(interval);
  }
  return false;
}

// ─── 日志轮转 ───

async function rotateLogIfNeeded(maxBytes: number): Promise<void> {
  try {
    const stat = await fs.stat(SERVER_LOG_PATH);
    if (stat.size >= maxBytes) {
      const backupPath = SERVER_LOG_PATH + '.old';
      await fs.move(SERVER_LOG_PATH, backupPath, { overwrite: true });
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // 文件不存在，无需处理
  }
}

// ─── 优雅关闭辅助 ───

function registerShutdown(server: Server): void {
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
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

// ─── 导出函数 ───

export async function startForeground(port: number, options: StartOptions = {}): Promise<void> {
  const explicit = options.explicit ?? true;

  // 1. 防重复启动
  await ensureNotRunning();

  // 2. 确保 BASE_DIR 存在
  await fs.ensureDir(path.dirname(PID_PATH));

  // 3. 启动 Express（复用 server.js 导出的 app）
  // server.js 顶层 manager.init() 在 require 时已执行（模块缓存），不重复调用
  const { default: app } = await import('../server.js');

  let result: ListenResult;
  try {
    result = await listenWithFallback(app, port, explicit);
  } catch (err: unknown) {
    // listen 失败时 PID 尚未写入，无需清理
    exitOnListenError(err, port);
    return;
  }

  // 4. 仅在 listen 成功后写入 PID 与端口配置
  await writePidFile(result.port);
  await persistPort(result.port, port);
  console.log(`管理端已启动 → http://localhost:${result.port}`);

  // 5. 优雅关闭
  registerShutdown(result.server);
}

export async function startDaemon(port: number, options: StartOptions = {}): Promise<void> {
  const explicit = options.explicit ?? true;

  // 1. 防重复启动
  await ensureNotRunning();

  // 2. 确保 BASE_DIR 存在
  await fs.ensureDir(path.dirname(PID_PATH));

  // 3. 日志轮转：启动前检查日志文件大小，超过 10MB 则截断
  await rotateLogIfNeeded(10 * 1024 * 1024);

  // 4. 打开日志文件（追加写入）+ 设置权限
  const logFd = fs.openSync(SERVER_LOG_PATH, 'a');
  fs.fchmodSync(logFd, 0o600);

  // 5. spawn 子进程（端口回退在子进程内完成，父进程从 PID 文件读取实际端口）
  // 端口通过参数而非环境变量传递，避免子进程把自动模式误判为显式指定
  const isTs = __filename.endsWith('.ts');
  const explicitArg = explicit ? '1' : '0';
  const execArgs = isTs
    ? ['--import', 'tsx', __filename, '--daemon-child', String(port), explicitArg]
    : [process.argv[1], 'serve', '--daemon-child', '-p', String(port), '--daemon-explicit', explicitArg];

  const child = spawn(
    process.execPath,
    execArgs,
    {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env },
    }
  );

  // 6. 父进程关闭自身的 fd 副本
  child.unref();
  fs.closeSync(logFd);

  const pidInfo = await waitForPidFile(10000);
  if (!pidInfo) {
    console.error('错误: 后台进程启动失败，请检查日志:', SERVER_LOG_PATH);
    if (fs.existsSync(SERVER_LOG_PATH)) {
      console.error(fs.readFileSync(SERVER_LOG_PATH, 'utf8'));
    }
    process.exit(1);
  }

  if (!explicit && port !== 0 && pidInfo.port !== port) {
    console.log(`提示: 端口 ${port} 已被占用，已改用 ${pidInfo.port}`);
  }
  console.log(`管理端已后台启动 → PID: ${pidInfo.pid}, http://localhost:${pidInfo.port}, 日志: ${SERVER_LOG_PATH}`);
}

export async function stop(): Promise<void> {
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
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
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

export async function status(): Promise<void> {
  const pidInfo = await readPidFile();
  if (!pidInfo) {
    console.log('服务未在运行');
    console.log('提示: 服务未通过 serve 命令启动');
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

export async function daemonChildMain(port: number, options: StartOptions = {}): Promise<void> {
  const explicit = options.explicit ?? true;

  // require('../server') 触发 server.js 顶层代码执行
  // 其中包含 manager.init()，由于是首次 require 此模块，init 会执行
  const { default: app } = await import('../server.js');

  let result: ListenResult;
  try {
    result = await listenWithFallback(app, port, explicit);
  } catch (err: unknown) {
    // listen 失败 → 退出，PID 未写入
    exitOnListenError(err, port);
    return;
  }

  // 仅在 listen 成功后写入 PID 与端口配置
  await writePidFile(result.port);
  await persistPort(result.port, port);

  // 优雅关闭
  registerShutdown(result.server);
}

// Node ESM 的入口检测 - 在 TS 环境测试时需要
import { fileURLToPath as _fileURLToPath } from 'url';
const _filename = _fileURLToPath(import.meta.url);
if (process.argv[1] === _filename) {
  const args = process.argv.slice(2);
  if (args[0] === '--daemon-child') {
    const port = parseInt(args[1] || process.env.CLAUDE_SWITCH_PORT || String(DEFAULT_PORT), 10);
    // 缺省视为显式，保持旧行为
    const explicit = args[2] !== '0';
    daemonChildMain(port, { explicit }).catch(err => {
      console.error('daemon 启动失败:', err.message);
      process.exit(1);
    });
  }
}

export const _internal = {
  DEFAULT_PORT,
  parsePort,
  readPidFile,
  writePidFile,
  cleanupPid,
  ensureNotRunning,
  isAlive,
  resolvePort,
  readServeConfig,
  writeServeConfig,
  listenWithFallback,
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
};
