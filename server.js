const express = require('express');
const cors = require('cors');
const path = require('path');
const manager = require('./lib/profile-manager');
const { getLogs } = require('./lib/logger');

const app = express();
const PORT = parseInt(process.env.CLAUDE_SWITCH_PORT || '3333', 10);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 套餐列表（脱敏）
app.get('/api/profiles', async (req, res) => {
  try {
    const profiles = await manager.getProfiles();
    const safe = {};
    for (const [name, data] of Object.entries(profiles)) {
      safe[name] = { env: { ...data.env } };
      if (safe[name].env.ANTHROPIC_AUTH_TOKEN) {
        safe[name].env.ANTHROPIC_AUTH_TOKEN = '••••••••';
      }
    }
    res.json(safe);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 新增套餐
app.post('/api/profiles', async (req, res) => {
  try {
    const { name, env } = req.body;
    if (!name || !env) throw new Error('缺少参数');
    await manager.addProfile(name, env);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 更新套餐（合并：非空字段覆盖，空字段保留原值）
app.put('/api/profiles/:name', async (req, res) => {
  try {
    const { env } = req.body;
    if (!env) throw new Error('缺少参数');
    await manager.updateProfile(req.params.name, env);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 删除套餐
app.delete('/api/profiles/:name', async (req, res) => {
  try {
    await manager.removeProfile(req.params.name);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 切换套餐
app.post('/api/switch', async (req, res) => {
  try {
    const { name } = req.body;
    await manager.switchProfile(name);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 当前生效环境
app.get('/api/current', async (req, res) => {
  try {
    const env = await manager.getCurrentEnv();
    const safeEnv = { ...env };
    if (safeEnv.ANTHROPIC_AUTH_TOKEN) {
      safeEnv.ANTHROPIC_AUTH_TOKEN = '••••••••';
    }
    res.json(safeEnv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 预设模板
app.get('/api/presets', (req, res) => {
  res.json(manager.getPresetTemplates());
});

// 备份列表
app.get('/api/backups/:type', async (req, res) => {
  try {
    const list = await manager.getBackups(req.params.type);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 备份 diff 预览
app.get('/api/backups/:type/:fileName/preview', async (req, res) => {
  try {
    const { type, fileName } = req.params;
    const diff = await manager.getBackupPreview(type, fileName);
    res.json(diff);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 还原
app.post('/api/restore', async (req, res) => {
  try {
    const { type, backupFileName } = req.body;
    await manager.restore(type, backupFileName);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 日志
app.get('/api/logs', async (req, res) => {
  try {
    const { date } = req.query;
    const logs = await getLogs(date);
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`管理端已启动 → http://localhost:${PORT}`);
  });
}
