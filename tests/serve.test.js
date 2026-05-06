import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import http from 'http';
import net from 'net';

// 临时目录
const TMP_DIR = path.join(os.tmpdir(), 'claude-switch-serve-test-' + process.pid);

// 覆盖 config 路径 — 必须在 require config 之前
process.env.CLAUDE_SWITCH_DIR = TMP_DIR;

// 用 createRequire 加载 CJS 模块
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const config = require('../lib/config');
const serve = require('../lib/serve');
const { readPidFile, writePidFile, cleanupPid, ensureNotRunning, isAlive, resolvePort, formatUptime, rotateLogIfNeeded, waitForExit } = serve._internal;

describe('serve 命令', () => {
  beforeEach(async () => {
    await fs.ensureDir(TMP_DIR);
    await fs.remove(config.PID_PATH).catch(() => {});
    await fs.remove(config.SERVER_LOG_PATH).catch(() => {});
  });

  afterEach(async () => {
    await fs.remove(TMP_DIR).catch(() => {});
  });

  // ─── 6.1 PID 管理单元测试 ───

  describe('PID 管理', () => {
    it('writePidFile 写入正确 JSON', async () => {
      await writePidFile(3333);
      const content = await fs.readFile(config.PID_PATH, 'utf8');
      const data = JSON.parse(content);
      expect(data.pid).toBe(process.pid);
      expect(data.port).toBe(3333);
      expect(data.startedAt).toBeDefined();
    });

    it('writePidFile 设置 600 权限', async () => {
      await writePidFile(3333);
      const stat = await fs.stat(config.PID_PATH);
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('readPidFile 正常读取', async () => {
      const data = { pid: 12345, port: 8080, startedAt: '2026-05-06T10:00:00.000Z' };
      await fs.writeFile(config.PID_PATH, JSON.stringify(data));
      const result = await readPidFile();
      expect(result).toEqual(data);
    });

    it('readPidFile 文件不存在返回 null', async () => {
      const result = await readPidFile();
      expect(result).toBeNull();
    });

    it('readPidFile 文件内容损坏返回 null', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await fs.writeFile(config.PID_PATH, 'not-json{{{');
      const result = await readPidFile();
      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('cleanupPid 删除 PID 文件', async () => {
      await fs.writeFile(config.PID_PATH, '{}');
      await cleanupPid();
      const exists = await fs.pathExists(config.PID_PATH);
      expect(exists).toBe(false);
    });

    it('ensureNotRunning PID 不存在时正常返回', async () => {
      await expect(ensureNotRunning()).resolves.toBeUndefined();
    });

    it('ensureNotRunning PID 存在但进程不存活时清理', async () => {
      const data = { pid: 99999999, port: 3333, startedAt: new Date().toISOString() };
      await fs.writeFile(config.PID_PATH, JSON.stringify(data));
      await ensureNotRunning();
      const exists = await fs.pathExists(config.PID_PATH);
      expect(exists).toBe(false);
    });

    it('isAlive 检测当前进程返回 true', () => {
      expect(isAlive(process.pid)).toBe(true);
    });

    it('isAlive 检测不存在的 PID 返回 false', () => {
      expect(isAlive(99999999)).toBe(false);
    });
  });

  // ─── 工具函数测试 ───

  describe('工具函数', () => {
    it('resolvePort: -p > env > 3333', () => {
      expect(resolvePort('8080')).toBe(8080);
      const orig = process.env.CLAUDE_SWITCH_PORT;
      delete process.env.CLAUDE_SWITCH_PORT;
      expect(resolvePort()).toBe(3333);
      process.env.CLAUDE_SWITCH_PORT = '9999';
      expect(resolvePort()).toBe(9999);
      if (orig) process.env.CLAUDE_SWITCH_PORT = orig;
      else delete process.env.CLAUDE_SWITCH_PORT;
    });

    it('formatUptime 格式化正确', () => {
      expect(formatUptime(0)).toBe('0秒');
      expect(formatUptime(1000)).toBe('1秒');
      expect(formatUptime(61000)).toBe('1分钟1秒');
      expect(formatUptime(3661000)).toBe('1小时1分钟1秒');
      expect(formatUptime(90061000)).toBe('1天1小时1分钟1秒');
    });
  });

  // ─── 日志轮转测试 ───

  describe('日志轮转', () => {
    it('日志超过阈值时移至 .old', async () => {
      await fs.writeFile(config.SERVER_LOG_PATH, 'x'.repeat(100));
      await rotateLogIfNeeded(50);
      const oldExists = await fs.pathExists(config.SERVER_LOG_PATH + '.old');
      expect(oldExists).toBe(true);
      const currentExists = await fs.pathExists(config.SERVER_LOG_PATH);
      expect(currentExists).toBe(false);
    });

    it('日志未超阈值时不处理', async () => {
      await fs.writeFile(config.SERVER_LOG_PATH, 'small');
      await rotateLogIfNeeded(10 * 1024 * 1024);
      const exists = await fs.pathExists(config.SERVER_LOG_PATH);
      expect(exists).toBe(true);
    });

    it('日志文件不存在时不报错', async () => {
      await expect(rotateLogIfNeeded(10 * 1024 * 1024)).resolves.toBeUndefined();
    });
  });

  // ─── 6.2 startForeground 测试 ───

  describe('startForeground', () => {
    it('前台启动成功并写入 PID', async () => {
      const port = 18000 + Math.floor(Math.random() * 1000);

      // mock process.exit 防止测试进程退出
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});

      serve.startForeground(port);

      // 等待 PID 文件出现
      const pidInfo = await serve._internal.waitForPidFile(3000);
      expect(pidInfo).not.toBeNull();
      expect(pidInfo.port).toBe(port);
      expect(isAlive(pidInfo.pid)).toBe(true);

      // 验证 HTTP 可访问
      await new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}/api/presets`, (res) => {
          expect(res.statusCode).toBe(200);
          resolve();
        }).on('error', reject);
      });

      // 验证 PID 文件在 listen 成功后才出现（此时 HTTP 已经可达）
      const pidContent = await readPidFile();
      expect(pidContent).not.toBeNull();

      // 直接清理：关闭 server 并删除 PID 文件
      await cleanupPid();
      // 由于 startForeground 注册了信号处理，我们手动触发关闭流程不太方便
      // 直接移除信号监听器避免干扰后续测试
      process.removeAllListeners('SIGINT');
      process.removeAllListeners('SIGTERM');

      exitSpy.mockRestore();
    }, 10000);

    it('前台启动端口冲突时 PID 未写入', async () => {
      const port = 19000 + Math.floor(Math.random() * 1000);
      const blocker = net.createServer().listen(port);
      await new Promise(resolve => blocker.once('listening', resolve));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      serve.startForeground(port);

      // 等待 error 事件触发（server.on('error') 是异步的）
      await new Promise(resolve => setTimeout(resolve, 500));

      const pidInfo = await readPidFile();
      expect(pidInfo).toBeNull();
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('已被占用'));

      exitSpy.mockRestore();
      errorSpy.mockRestore();
      process.removeAllListeners('SIGINT');
      process.removeAllListeners('SIGTERM');
      await new Promise(resolve => blocker.close(resolve));
    });
  });

  // ─── 6.4 stop 测试 ───

  describe('stop', () => {
    it('停止不存在的服务时报错退出', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit(${code})`);
      });
      await expect(serve.stop()).rejects.toThrow(/process\.exit/);
      exitSpy.mockRestore();
    });

    it('停止 stale PID 时清理', async () => {
      const data = { pid: 99999999, port: 3333, startedAt: new Date().toISOString() };
      await fs.writeFile(config.PID_PATH, JSON.stringify(data));

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await serve.stop();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('stale'));

      const exists = await fs.pathExists(config.PID_PATH);
      expect(exists).toBe(false);
      logSpy.mockRestore();
    });
  });

  // ─── 6.5 status 测试 ───

  describe('status', () => {
    it('查询未运行的服务', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await serve.status();
      expect(logSpy).toHaveBeenCalledWith('服务未在运行');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('node server.js'));
      logSpy.mockRestore();
    });

    it('查询 stale PID 时自动清理', async () => {
      const data = { pid: 99999999, port: 3333, startedAt: new Date().toISOString() };
      await fs.writeFile(config.PID_PATH, JSON.stringify(data));

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await serve.status();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('已自动清理'));

      const exists = await fs.pathExists(config.PID_PATH);
      expect(exists).toBe(false);
      logSpy.mockRestore();
    });
  });

  // ─── 文件权限测试 ───

  describe('文件权限', () => {
    it('PID 文件权限 600', async () => {
      await writePidFile(3333);
      const stat = await fs.stat(config.PID_PATH);
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });
});
