import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import http from 'http';
import net from 'net';

// 临时目录
const TMP_DIR = path.join(os.tmpdir(), 'claude-switch-serve-test-' + process.pid);

// 覆盖 config 路径 — 必须在引入模块之前设置
process.env.CLAUDE_SWITCH_DIR = TMP_DIR;

const config = await import('../src/lib/config.js');
const serve = await import('../src/lib/serve.js');

const { readPidFile, writePidFile, cleanupPid, ensureNotRunning, isAlive, resolvePort, readServeConfig, writeServeConfig, formatUptime, rotateLogIfNeeded, waitForExit, _activeSignalHandlers, cleanupSignalHandlers } = serve._internal;

describe('serve 命令', () => {
  beforeEach(async () => {
    await fs.ensureDir(TMP_DIR);
    await fs.remove(config.PID_PATH).catch(() => {});
    await fs.remove(config.SERVER_LOG_PATH).catch(() => {});
    await fs.remove(config.SERVE_CONFIG_PATH).catch(() => {});
  });

  afterEach(async () => {
    await fs.rm(TMP_DIR, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
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

    it('readPidFile 字段不完整返回 null', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // 缺少 port
      await fs.writeFile(config.PID_PATH, JSON.stringify({ pid: 123, startedAt: '2026-05-06T10:00:00.000Z' }));
      expect(await readPidFile()).toBeNull();
      // 缺少 startedAt
      await fs.writeFile(config.PID_PATH, JSON.stringify({ pid: 123, port: 8080 }));
      expect(await readPidFile()).toBeNull();
      // 空对象
      await fs.writeFile(config.PID_PATH, JSON.stringify({}));
      expect(await readPidFile()).toBeNull();
      expect(consoleSpy).toHaveBeenCalledTimes(3);
      consoleSpy.mockRestore();
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
    it('formatUptime 格式化正确', () => {
      expect(formatUptime(0)).toBe('0秒');
      expect(formatUptime(1000)).toBe('1秒');
      expect(formatUptime(61000)).toBe('1分钟1秒');
      expect(formatUptime(3661000)).toBe('1小时1分钟1秒');
      expect(formatUptime(90061000)).toBe('1天1小时1分钟1秒');
    });
  });

  // ─── 端口配置持久化 ───

  describe('端口配置', () => {
    it('writeServeConfig / readServeConfig 往返并设置 600 权限', async () => {
      await writeServeConfig(3334);
      expect(await readServeConfig()).toBe(3334);
      const stat = await fs.stat(config.SERVE_CONFIG_PATH);
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('配置文件不存在返回 null', async () => {
      expect(await readServeConfig()).toBeNull();
    });

    it('配置文件损坏返回 null 并警告', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await fs.writeFile(config.SERVE_CONFIG_PATH, 'not-json{{{');
      expect(await readServeConfig()).toBeNull();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('端口越界或非整数返回 null', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      for (const bad of [{ port: 0 }, { port: 70000 }, { port: 'x' }, {}, null]) {
        await fs.writeFile(config.SERVE_CONFIG_PATH, JSON.stringify(bad));
        expect(await readServeConfig()).toBeNull();
      }
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // ─── 端口优先级 ───

  describe('resolvePort 优先级', () => {
    const origEnv = process.env.CLAUDE_SWITCH_PORT;
    afterEach(() => {
      if (origEnv) process.env.CLAUDE_SWITCH_PORT = origEnv;
      else delete process.env.CLAUDE_SWITCH_PORT;
    });

    it('-p 优先，标记为显式', async () => {
      process.env.CLAUDE_SWITCH_PORT = '9999';
      await writeServeConfig(4444);
      expect(await resolvePort('8080')).toEqual({ port: 8080, explicit: true });
    });

    it('环境变量次之，标记为显式', async () => {
      process.env.CLAUDE_SWITCH_PORT = '9999';
      await writeServeConfig(4444);
      expect(await resolvePort()).toEqual({ port: 9999, explicit: true });
    });

    it('未显式指定时使用保存的端口，标记为自动', async () => {
      delete process.env.CLAUDE_SWITCH_PORT;
      await writeServeConfig(4444);
      expect(await resolvePort()).toEqual({ port: 4444, explicit: false });
    });

    it('无任何配置时默认 3333，标记为自动', async () => {
      delete process.env.CLAUDE_SWITCH_PORT;
      expect(await resolvePort()).toEqual({ port: 3333, explicit: false });
    });

    it('非数字端口报错', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code: any) => {
        throw new Error(`process.exit(${code})`);
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(resolvePort('abc')).rejects.toThrow(/process\.exit/);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('0-65535'));
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('超范围端口报错，0 合法表示系统随机', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code: any) => {
        throw new Error(`process.exit(${code})`);
      });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(resolvePort('99999')).rejects.toThrow(/process\.exit/);
      await expect(resolvePort('-1')).rejects.toThrow(/process\.exit/);
      expect(await resolvePort('0')).toEqual({ port: 0, explicit: true });
      exitSpy.mockRestore();
      errorSpy.mockRestore();
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
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code: any) => { return code as never; });

      serve.startForeground(port);

      // 等待 PID 文件出现
      const pidInfo = await serve._internal.waitForPidFile(3000);
      expect(pidInfo).not.toBeNull();
      expect(pidInfo!.port).toBe(port);
      expect(isAlive(pidInfo!.pid)).toBe(true);

      // 验证 HTTP 可访问
      await new Promise<void>((resolve, reject) => {
        http.get(`http://localhost:${port}/api/presets`, (res) => {
          expect(res.statusCode).toBe(200);
          resolve();
        }).on('error', reject);
      });

      // 验证 PID 文件在 listen 成功后才出现（此时 HTTP 已经可达）
      const pidContent = await readPidFile();
      expect(pidContent).not.toBeNull();

      // 清理信号处理器（只移除当前注册的，不影响其他测试）
      cleanupSignalHandlers();

      exitSpy.mockRestore();
    }, 10000);

    it('前台启动（端口为 0）时自动分配随机端口并写入 PID', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code: any) => { return code as never; });

      serve.startForeground(0);

      // 等待 PID 文件出现
      const pidInfo = await serve._internal.waitForPidFile(3000);
      expect(pidInfo).not.toBeNull();
      expect(pidInfo!.port).toBeGreaterThan(0);
      expect(isAlive(pidInfo!.pid)).toBe(true);

      // 验证 HTTP 可访问
      await new Promise<void>((resolve, reject) => {
        http.get(`http://localhost:${pidInfo!.port}/api/presets`, (res) => {
          expect(res.statusCode).toBe(200);
          resolve();
        }).on('error', reject);
      });

      cleanupSignalHandlers();
      exitSpy.mockRestore();
    }, 10000);

    it('前台启动端口冲突时 PID 未写入', async () => {
      const port = 19000 + Math.floor(Math.random() * 1000);
      const blocker = net.createServer().listen(port);
      await new Promise(resolve => blocker.once('listening', resolve));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code: any) => { return code as never; });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      serve.startForeground(port);

      // 等待 error 事件触发（server.on('error') 是异步的）
      await new Promise(resolve => setTimeout(resolve, 500));

      const pidInfo = await readPidFile();
      expect(pidInfo).toBeNull();
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('已被占用'));

      errorSpy.mockRestore();
      cleanupSignalHandlers();
      await new Promise(resolve => blocker.close(resolve));
    });
  });

  // ─── 端口回退 ───

  describe('端口回退', () => {
    it('自动模式下起始端口被占用时改用下一个端口并持久化', async () => {
      const basePort = 21000 + Math.floor(Math.random() * 500);
      const blocker = net.createServer().listen(basePort);
      await new Promise(resolve => blocker.once('listening', resolve));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code: any) => { return code as never; });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      serve.startForeground(basePort, { explicit: false });

      const pidInfo = await serve._internal.waitForPidFile(3000);
      expect(pidInfo).not.toBeNull();
      expect(pidInfo!.port).toBe(basePort + 1);
      expect(await readServeConfig()).toBe(basePort + 1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`端口 ${basePort} 已被占用`));

      await new Promise<void>((resolve, reject) => {
        http.get(`http://localhost:${pidInfo!.port}/api/presets`, (res) => {
          expect(res.statusCode).toBe(200);
          resolve();
        }).on('error', reject);
      });

      cleanupSignalHandlers();
      exitSpy.mockRestore();
      errorSpy.mockRestore();
      await new Promise(resolve => blocker.close(resolve));
    }, 10000);

    it('显式端口被占用时报错退出且不写入配置', async () => {
      const port = 22000 + Math.floor(Math.random() * 500);
      const blocker = net.createServer().listen(port);
      await new Promise(resolve => blocker.once('listening', resolve));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code: any) => { return code as never; });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      serve.startForeground(port, { explicit: true });

      await new Promise(resolve => setTimeout(resolve, 500));

      expect(await readPidFile()).toBeNull();
      expect(await readServeConfig()).toBeNull();
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('已被占用'));

      exitSpy.mockRestore();
      errorSpy.mockRestore();
      cleanupSignalHandlers();
      await new Promise(resolve => blocker.close(resolve));
    }, 10000);

    it('端口 0（系统随机）成功后不持久化', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code: any) => { return code as never; });

      serve.startForeground(0, { explicit: true });

      const pidInfo = await serve._internal.waitForPidFile(3000);
      expect(pidInfo).not.toBeNull();
      expect(pidInfo!.port).toBeGreaterThan(0);
      expect(await readServeConfig()).toBeNull();

      cleanupSignalHandlers();
      exitSpy.mockRestore();
    }, 10000);
  });

  // ─── 6.4 stop 测试 ───

  describe('stop', () => {
    it('停止不存在的服务时报错退出', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code: any) => {
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
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('未通过 serve 命令启动'));
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

  // ─── daemon 端到端测试 ───

  describe('startDaemon 端到端', () => {
    it('daemon 启动后 PID 文件正确创建', async () => {
      const port = 20000 + Math.floor(Math.random() * 1000);

      await serve.startDaemon(port);

      // 验证 PID 文件存在且内容正确
      const pidInfo = await readPidFile();
      expect(pidInfo).not.toBeNull();
      expect(pidInfo!.port).toBe(port);
      expect(typeof pidInfo!.pid).toBe('number');
      expect(pidInfo!.startedAt).toBeDefined();

      // 验证进程存活
      expect(isAlive(pidInfo!.pid)).toBe(true);

      // 验证 HTTP 可访问
      await new Promise<void>((resolve, reject) => {
        http.get(`http://localhost:${port}/api/presets`, (res) => {
          expect(res.statusCode).toBe(200);
          resolve();
        }).on('error', reject);
      });

      // 停止 daemon
      await serve.stop();
      const pidInfoAfter = await readPidFile();
      expect(pidInfoAfter).toBeNull();
    }, 20000);

    it('daemon 启动（端口为 0）后自动分配随机端口并正确创建 PID', async () => {
      await serve.startDaemon(0);

      // 验证 PID 文件存在且内容正确
      const pidInfo = await readPidFile();
      expect(pidInfo).not.toBeNull();
      expect(pidInfo!.port).toBeGreaterThan(0);
      expect(typeof pidInfo!.pid).toBe('number');
      expect(pidInfo!.startedAt).toBeDefined();

      // 验证进程存活
      expect(isAlive(pidInfo!.pid)).toBe(true);

      // 验证 HTTP 可访问
      await new Promise<void>((resolve, reject) => {
        http.get(`http://localhost:${pidInfo!.port}/api/presets`, (res) => {
          expect(res.statusCode).toBe(200);
          resolve();
        }).on('error', reject);
      });

      // 停止 daemon
      await serve.stop();
      const pidInfoAfter = await readPidFile();
      expect(pidInfoAfter).toBeNull();
    }, 20000);

    it('自动模式下起始端口被占用时 daemon 改用下一个端口', async () => {
      const basePort = 23000 + Math.floor(Math.random() * 500);
      const blocker = net.createServer().listen(basePort);
      await new Promise(resolve => blocker.once('listening', resolve));

      await serve.startDaemon(basePort, { explicit: false });

      const pidInfo = await readPidFile();
      expect(pidInfo).not.toBeNull();
      expect(pidInfo!.port).toBe(basePort + 1);
      expect(await readServeConfig()).toBe(basePort + 1);

      await serve.stop();
      await new Promise(resolve => blocker.close(resolve));
    }, 20000);
  });

});
