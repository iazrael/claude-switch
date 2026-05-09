import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import * as manager from './lib/profile-manager.js';
import { getLogs } from './lib/logger.js';
import { BackupType } from './lib/backup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 启动时执行一次迁移
manager.init().catch(err => console.error('初始化迁移失败:', err.message));

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 套餐列表（脱敏）+ active + mismatch（一次性读取）
app.get('/api/profiles', async (req: Request, res: Response) => {
  try {
    const { data, mismatchInfo } = await manager.getProfilesWithMismatch();
    const safe: Record<string, { env: Record<string, string | undefined> }> = {};
    for (const [name, pData] of Object.entries(data.profiles)) {
      safe[name] = { env: { ...pData.env } };
      if (safe[name].env.ANTHROPIC_AUTH_TOKEN) {
        safe[name].env.ANTHROPIC_AUTH_TOKEN = '••••••••';
      }
    }
    res.json({
      active: mismatchInfo.active,
      profiles: safe,
      mismatch: mismatchInfo.mismatch,
    });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// 新增套餐
app.post('/api/profiles', async (req: Request, res: Response) => {
  try {
    const { name, env } = req.body as { name: string; env: Record<string, string> };
    if (!name || !env) throw new Error('缺少参数');
    await manager.addProfile(name, env);
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// 更新套餐（合并：非空字段覆盖，空字段保留原值）
app.put('/api/profiles/:name', async (req: Request, res: Response) => {
  try {
    const { env } = req.body as { env: Record<string, string> };
    if (!env) throw new Error('缺少参数');
    await manager.updateProfile(String(req.params.name), env);
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// 克隆套餐（服务端复制，保留真实 token）
app.post('/api/profiles/clone', async (req: Request, res: Response) => {
  try {
    const { source, name, overrides } = req.body as { source: string; name: string; overrides?: Record<string, string> };
    if (!source || !name) throw new Error('缺少参数');
    const data = await manager.getProfiles();
    if (!data.profiles[source]) throw new Error(`源套餐 "${source}" 不存在`);
    // 从源套餐的解密 env 开始，用 overrides 覆盖
    const env = { ...data.profiles[source].env, ...(overrides || {}) };
    await manager.addProfile(name, env);
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// 删除套餐
app.delete('/api/profiles/:name', async (req: Request, res: Response) => {
  try {
    await manager.removeProfile(String(req.params.name));
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// 切换套餐
app.post('/api/switch', async (req: Request, res: Response) => {
  try {
    const { name } = req.body as { name: string };
    await manager.switchProfile(name);
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// 当前生效环境 + activeProfile + mismatch（一次性读取）
app.get('/api/current', async (req: Request, res: Response) => {
  try {
    const { mismatchInfo } = await manager.getProfilesWithMismatch();
    const env = await manager.getCurrentEnv();
    const safeEnv = { ...env };
    if (safeEnv.ANTHROPIC_AUTH_TOKEN) {
      safeEnv.ANTHROPIC_AUTH_TOKEN = '••••••••';
    }
    res.json({
      env: safeEnv,
      activeProfile: mismatchInfo.active,
      mismatch: mismatchInfo.mismatch,
    });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// 预设模板
app.get('/api/presets', (req: Request, res: Response) => {
  res.json(manager.getPresetTemplates());
});

// 备份列表
app.get('/api/backups/:type', async (req: Request, res: Response) => {
  try {
    const type = req.params.type as BackupType;
    const list = await manager.getBackups(type);
    res.json(list);
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// 备份 diff 预览
app.get('/api/backups/:type/:fileName/preview', async (req: Request, res: Response) => {
  try {
    const type = String(req.params.type) as BackupType;
    const fileName = String(req.params.fileName);
    const diff = await manager.getBackupPreview(type, fileName);
    res.json(diff);
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// 还原
app.post('/api/restore', async (req: Request, res: Response) => {
  try {
    const { type, backupFileName } = req.body as { type: BackupType; backupFileName: string };
    await manager.restore(type, backupFileName);
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// 首次安装检测
app.get('/api/first-install', async (req: Request, res: Response) => {
  try {
    const firstInstall = await manager.isFirstInstall();
    if (!firstInstall) {
      return res.json({ firstInstall: false });
    }
    const existing = await manager.detectExistingConfig();
    if (!existing) {
      return res.json({ firstInstall: true, hasExisting: false });
    }
    // 脱敏 token
    const safe = { ...existing };
    if (safe.ANTHROPIC_AUTH_TOKEN) {
      safe.ANTHROPIC_AUTH_TOKEN = '••••••••';
    }
    res.json({ firstInstall: true, hasExisting: true, config: safe });
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// 日志
app.get('/api/logs', async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    const logs = await getLogs(date as string);
    res.json(logs);
  } catch (e: unknown) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default app;
