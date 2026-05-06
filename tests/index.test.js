import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const TMP_DIR = path.join(os.tmpdir(), `cs-test-${process.pid}`);

const TEST_ENV = {
  ANTHROPIC_AUTH_TOKEN: 'sk-test-abc123',
  ANTHROPIC_BASE_URL: 'https://api.test.com/anthropic',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'test-opus',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'test-sonnet',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'test-haiku',
};

async function cleanAll() {
  await fs.remove(TMP_DIR);
  await fs.ensureDir(path.join(TMP_DIR, 'profiles.d'));
}

// Set env before requiring modules
process.env.CLAUDE_SWITCH_DIR = TMP_DIR;

const manager = await import('../lib/profile-manager');
const app = (await import('../server')).default;

// Path constants matching the config with env override
const PROFILES_PATH = path.join(TMP_DIR, 'profiles.json');
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

// ========== Profile Manager Tests ==========

describe('Profile Manager', () => {
  beforeEach(cleanAll);
  afterEach(async () => { await fs.remove(TMP_DIR); });

  it('应该能添加套餐', async () => {
    await manager.addProfile('test-profile', TEST_ENV);
    const data = await manager.getProfiles();
    expect(data.profiles['test-profile']).toBeDefined();
    expect(data.profiles['test-profile'].env.ANTHROPIC_BASE_URL).toBe('https://api.test.com/anthropic');
    expect(data.profiles['test-profile'].env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test-abc123');
  });

  it('应该能获取所有套餐名', async () => {
    await manager.addProfile('profile-a', TEST_ENV);
    await manager.addProfile('profile-b', TEST_ENV);
    const names = await manager.getAllProfileNames();
    expect(names).toContain('profile-a');
    expect(names).toContain('profile-b');
    expect(names).toHaveLength(2);
  });

  it('应该能删除套餐', async () => {
    await manager.addProfile('to-delete', TEST_ENV);
    await manager.removeProfile('to-delete');
    const data = await manager.getProfiles();
    expect(data.profiles['to-delete']).toBeUndefined();
  });

  it('删除不存在的套餐应该抛错', async () => {
    await expect(manager.removeProfile('nonexistent')).rejects.toThrow('不存在');
  });

  it('应该能切换套餐', async () => {
    await manager.addProfile('switch-target', TEST_ENV);
    await manager.switchProfile('switch-target');
    // 验证 active 更新
    const data = await manager.getProfiles();
    expect(data.profiles['switch-target']).toBeDefined();
    expect(data.profiles['switch-target'].env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test-abc123');
    expect(data.active).toBe('switch-target');
  });

  it('切换到不存在的套餐应该抛错', async () => {
    await expect(manager.switchProfile('nonexistent')).rejects.toThrow('不存在');
  });

  it('应该能获取当前环境变量', async () => {
    const env = await manager.getCurrentEnv();
    expect(typeof env).toBe('object');
  });

  it('应该能通过 updateProfile 更新套餐（非空字段覆盖，空字段保留）', async () => {
    await manager.addProfile('update-test', TEST_ENV);
    await manager.updateProfile('update-test', {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://updated.com',
      ANTHROPIC_DEFAULT_OPUS_MODEL: '',
      ANTHROPIC_DEFAULT_SONNET_MODEL: '',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: '',
    });
    const data = await manager.getProfiles();
    expect(data.profiles['update-test'].env.ANTHROPIC_BASE_URL).toBe('https://updated.com');
    expect(data.profiles['update-test'].env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test-abc123');
  });

  it('updateProfile 不存在的套餐应该抛错', async () => {
    await expect(manager.updateProfile('nonexistent', { ANTHROPIC_BASE_URL: 'x' })).rejects.toThrow('不存在');
  });

  it('应该能修改已有套餐（通过 addProfile 覆盖）', async () => {
    await manager.addProfile('modify-me', TEST_ENV);
    const updatedEnv = { ...TEST_ENV, ANTHROPIC_BASE_URL: 'https://updated.com' };
    await manager.addProfile('modify-me', updatedEnv);
    const data = await manager.getProfiles();
    expect(data.profiles['modify-me'].env.ANTHROPIC_BASE_URL).toBe('https://updated.com');
  });

  it('profiles.json 中 Token 应该是加密存储的', async () => {
    await manager.addProfile('encrypted-test', TEST_ENV);
    const raw = await fs.readJson(PROFILES_PATH);
    // v3.0 新格式
    const rawToken = raw.profiles['encrypted-test'].env.ANTHROPIC_AUTH_TOKEN;
    expect(rawToken).not.toBe('sk-test-abc123');
    expect(rawToken).toContain(':');
  });

  it('应该能列出 profiles 备份（返回对象数组）', async () => {
    await manager.addProfile('backup-test-1', TEST_ENV);
    await manager.addProfile('backup-test-1', { ...TEST_ENV, ANTHROPIC_BASE_URL: 'https://v2.test' });
    const backups = await manager.getBackups('profiles');
    expect(backups.length).toBeGreaterThanOrEqual(1);
    expect(backups[0]).toHaveProperty('fileName');
    expect(backups[0]).toHaveProperty('timestamp');
    expect(backups[0]).toHaveProperty('reason');
  });

  // ---------- v3.0 新增测试 ----------

  it('旧格式 profiles.json 应自动迁移', async () => {
    // 手动写入旧格式
    const oldFormat = {
      'old-profile': { env: { ANTHROPIC_AUTH_TOKEN: 'sk-old', ANTHROPIC_BASE_URL: 'https://old.com' } },
    };
    await fs.writeJson(PROFILES_PATH, oldFormat, { spaces: 2 });
    // 读取触发迁移
    const data = await manager.getProfiles();
    expect(data.profiles).toBeDefined();
    expect(data.profiles['old-profile']).toBeDefined();
    expect(data.active).toBe('');
  });

  it('迁移后 active 应为空字符串', async () => {
    const oldFormat = {
      'test': { env: { ANTHROPIC_AUTH_TOKEN: 'sk-test', ANTHROPIC_BASE_URL: 'https://test.com' } },
    };
    await fs.writeJson(PROFILES_PATH, oldFormat, { spaces: 2 });
    const data = await manager.getProfiles();
    expect(data.active).toBe('');
  });

  it('getActiveProfile 通过 active 字段识别', async () => {
    await manager.addProfile('active-test', TEST_ENV);
    await manager.switchProfile('active-test');
    const activeName = await manager.getActiveProfile();
    expect(activeName).toBe('active-test');
  });

  it('getActiveProfile active 指向不存在时 fallback', async () => {
    await manager.addProfile('fallback-test', TEST_ENV);
    await manager.switchProfile('fallback-test');
    // 手动修改 profiles.json，删除该套餐但保留 active
    const raw = await fs.readJson(PROFILES_PATH);
    delete raw.profiles['fallback-test'];
    raw.active = 'fallback-test';
    await fs.writeJson(PROFILES_PATH, raw, { spaces: 2 });
    // getActiveProfile 应 fallback
    const activeName = await manager.getActiveProfile();
    // 因为 env 已经被 switch 写入了 settings，fallback 环境比对应该能匹配
    // 但套餐已删除所以 profiles 里没有匹配项
    expect(activeName).toBeNull();
  });

  it('getActiveProfile 全部无法匹配返回 null', async () => {
    // 空环境
    const activeName = await manager.getActiveProfile();
    expect(activeName).toBeNull();
  });

  it('checkMismatch 一致时返回 false', async () => {
    await manager.addProfile('match-test', TEST_ENV);
    await manager.switchProfile('match-test');
    const result = await manager.checkMismatch();
    expect(result.active).toBe('match-test');
    expect(result.mismatch).toBe(false);
  });

  it('checkMismatch 不一致时返回 true', async () => {
    await manager.addProfile('mismatch-test', TEST_ENV);
    await manager.switchProfile('mismatch-test');
    // 手动修改 settings.json 使不一致
    const settings = await fs.readJson(SETTINGS_PATH);
    settings.env.ANTHROPIC_BASE_URL = 'https://different.com';
    await fs.writeJson(SETTINGS_PATH, settings, { spaces: 2 });
    const result = await manager.checkMismatch();
    expect(result.active).toBe('mismatch-test');
    expect(result.mismatch).toBe(true);
  });

  it('checkMismatch 无 active 时返回 null', async () => {
    const result = await manager.checkMismatch();
    expect(result.active).toBeNull();
    expect(result.mismatch).toBeNull();
  });

  it('switchProfile 应更新 active', async () => {
    await manager.addProfile('switch-active', TEST_ENV);
    await manager.switchProfile('switch-active');
    const active = await manager.getActive();
    expect(active).toBe('switch-active');
  });

  it('removeProfile 删除 active 套餐应清空 active', async () => {
    await manager.addProfile('remove-active', TEST_ENV);
    await manager.switchProfile('remove-active');
    expect(await manager.getActive()).toBe('remove-active');
    await manager.removeProfile('remove-active');
    const active = await manager.getActive();
    expect(active).toBe('');
  });

  it('迁移应产生 migration 备份', async () => {
    const oldFormat = {
      'migration-test': { env: { ANTHROPIC_AUTH_TOKEN: 'sk-mig', ANTHROPIC_BASE_URL: 'https://mig.com' } },
    };
    await fs.writeJson(PROFILES_PATH, oldFormat, { spaces: 2 });
    await manager.getProfiles();
    const backups = await manager.getBackups('profiles');
    const migrationBackup = backups.find(b => b.reason === 'migration');
    expect(migrationBackup).toBeDefined();
  });
});

// ========== Crypto Utils Tests ==========

describe('Crypto Utils', () => {
  it('加密后能正确解密', async () => {
    const { encrypt, decrypt } = await import('../lib/crypto-utils');
    const original = 'my-secret-key-12345';
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(encrypted).toContain(':');
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it('解密非加密格式返回原值', async () => {
    const { decrypt } = await import('../lib/crypto-utils');
    expect(decrypt('not-encrypted-value')).toBe('not-encrypted-value');
  });

  it('每次加密结果不同（随机 IV）', async () => {
    const { encrypt } = await import('../lib/crypto-utils');
    const enc1 = encrypt('same-value');
    const enc2 = encrypt('same-value');
    expect(enc1).not.toBe(enc2);
  });

  it('needsReEncrypt 对新密钥加密的数据返回 false', async () => {
    const { encrypt, needsReEncrypt } = await import('../lib/crypto-utils');
    const encrypted = encrypt('test-data');
    expect(needsReEncrypt(encrypted)).toBe(false);
  });

  it('needsReEncrypt 对非加密数据返回 false', async () => {
    const { needsReEncrypt } = await import('../lib/crypto-utils');
    expect(needsReEncrypt('plaintext')).toBe(false);
  });
});

// ========== Diff Utils Tests ==========

describe('Diff Utils', () => {
  let diffJSON;
  beforeEach(async () => {
    const mod = await import('../lib/diff');
    diffJSON = mod.diffJSON;
  });

  it('空对象对比应无差异', () => {
    const result = diffJSON({}, {});
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
    expect(result.unchanged).toEqual([]);
  });

  it('完全相同的对象应全部 unchanged', () => {
    const obj = { a: '1', b: '2' };
    const result = diffJSON(obj, obj);
    expect(result.unchanged).toEqual(['a', 'b']);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it('新增 key 应出现在 added', () => {
    const result = diffJSON({ a: '1', b: '2' }, { a: '1' });
    expect(result.added).toEqual(['b']);
    expect(result.unchanged).toEqual(['a']);
  });

  it('删除 key 应出现在 removed', () => {
    const result = diffJSON({ a: '1' }, { a: '1', b: '2' });
    expect(result.removed).toEqual(['b']);
    expect(result.unchanged).toEqual(['a']);
  });

  it('值变更应出现在 changed', () => {
    const result = diffJSON({ a: 'new' }, { a: 'old' });
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0].key).toBe('a');
    expect(result.changed[0].newValue).toBe('new');
    expect(result.changed[0].oldValue).toBe('old');
  });

  it('敏感字段值应被脱敏', () => {
    const result = diffJSON(
      { MY_TOKEN: 'secret-new', normal: 'same' },
      { MY_TOKEN: 'secret-old', normal: 'same' },
    );
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0].newValue).toBe('••••••••');
    expect(result.changed[0].oldValue).toBe('••••••••');
    expect(result.unchanged).toContain('normal');
  });

  it('嵌套对象应正确对比', () => {
    const current = { nested: { a: 1, b: 2 } };
    const backup = { nested: { a: 1, b: 3 } };
    const result = diffJSON(current, backup);
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0].key).toBe('nested');
  });

  it('null/undefined 输入应安全处理', () => {
    const result = diffJSON(null, null);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });
});

// ========== Preset Templates Tests ==========

describe('Preset Templates', () => {
  it('应该返回所有预设模板', () => {
    const templates = manager.getPresetTemplates();
    expect(Object.keys(templates)).toEqual(['aliyun', 'volcengine', 'zhipu', 'deepseek']);
  });

  it('每个模板应包含必要字段', () => {
    const templates = manager.getPresetTemplates();
    for (const [, t] of Object.entries(templates)) {
      expect(t).toHaveProperty('label');
      expect(t).toHaveProperty('baseUrl');
      expect(t).toHaveProperty('opus');
      expect(t).toHaveProperty('sonnet');
      expect(t).toHaveProperty('haiku');
      expect(t.baseUrl).toMatch(/^https:\/\//);
    }
  });
});

// ========== API Tests ==========

describe('API Endpoints', () => {
  beforeEach(cleanAll);
  afterEach(async () => { await fs.remove(TMP_DIR); });

  describe('GET /api/profiles', () => {
    it('应该返回空的套餐列表（新格式）', async () => {
      const res = await request(app).get('/api/profiles');
      expect(res.status).toBe(200);
      expect(res.body.active).toBeNull();
      expect(res.body.profiles).toEqual({});
      expect(res.body.mismatch).toBeNull();
    });

    it('应该返回套餐列表（Token 脱敏）', async () => {
      await request(app)
        .post('/api/profiles')
        .send({ name: 'test-api', env: TEST_ENV });

      const res = await request(app).get('/api/profiles');
      expect(res.status).toBe(200);
      expect(res.body.profiles['test-api']).toBeDefined();
      expect(res.body.profiles['test-api'].env.ANTHROPIC_AUTH_TOKEN).toBe('••••••••');
      expect(res.body.profiles['test-api'].env.ANTHROPIC_BASE_URL).toBe('https://api.test.com/anthropic');
    });

    it('应该返回 active 和 mismatch', async () => {
      await request(app)
        .post('/api/profiles')
        .send({ name: 'api-active', env: TEST_ENV });
      await request(app)
        .post('/api/switch')
        .send({ name: 'api-active' });

      const res = await request(app).get('/api/profiles');
      expect(res.body.active).toBe('api-active');
      expect(res.body.mismatch).toBe(false);
    });
  });

  describe('POST /api/profiles', () => {
    it('应该能创建新套餐', async () => {
      const res = await request(app)
        .post('/api/profiles')
        .send({ name: 'new-one', env: TEST_ENV });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('缺少参数应返回 400', async () => {
      const res = await request(app)
        .post('/api/profiles')
        .send({ name: 'no-env' });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/profiles/:name', () => {
    it('应该能更新套餐（合并非空字段）', async () => {
      await request(app)
        .post('/api/profiles')
        .send({ name: 'update-api', env: TEST_ENV });

      const res = await request(app)
        .put('/api/profiles/update-api')
        .send({ env: { ANTHROPIC_BASE_URL: 'https://new-url.com', ANTHROPIC_AUTH_TOKEN: '' } });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const profiles = (await request(app).get('/api/profiles')).body.profiles;
      expect(profiles['update-api'].env.ANTHROPIC_BASE_URL).toBe('https://new-url.com');
    });

    it('更新不存在的套餐应返回 400', async () => {
      const res = await request(app)
        .put('/api/profiles/nonexistent')
        .send({ env: { ANTHROPIC_BASE_URL: 'x' } });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/profiles/:name', () => {
    it('应该能删除套餐', async () => {
      await request(app)
        .post('/api/profiles')
        .send({ name: 'to-delete', env: TEST_ENV });

      const res = await request(app).delete('/api/profiles/to-delete');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('删除不存在的套餐应返回 400', async () => {
      const res = await request(app).delete('/api/profiles/nonexistent');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/switch', () => {
    it('切换到不存在的套餐应返回 400', async () => {
      const res = await request(app)
        .post('/api/switch')
        .send({ name: 'nonexistent' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/current', () => {
    it('应该返回 activeProfile 和 mismatch', async () => {
      await request(app)
        .post('/api/profiles')
        .send({ name: 'current-test', env: TEST_ENV });
      await request(app)
        .post('/api/switch')
        .send({ name: 'current-test' });

      const res = await request(app).get('/api/current');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('env');
      expect(res.body.activeProfile).toBe('current-test');
      expect(res.body.mismatch).toBe(false);
    });
  });

  describe('GET /api/presets', () => {
    it('应该返回所有预设模板', async () => {
      const res = await request(app).get('/api/presets');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toContain('aliyun');
      expect(res.body.aliyun.opus).toBeDefined();
    });
  });

  describe('GET /api/backups/:type', () => {
    it('应该能列出备份（返回对象数组）', async () => {
      await request(app)
        .post('/api/profiles')
        .send({ name: 'backup-test', env: TEST_ENV });

      const res = await request(app).get('/api/backups/profiles');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        expect(res.body[0]).toHaveProperty('fileName');
        expect(res.body[0]).toHaveProperty('timestamp');
      }
    });

    it('无效类型应返回 500', async () => {
      const res = await request(app).get('/api/backups/invalid');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/backups/:type/:fileName/preview', () => {
    it('应该能返回 diff 预览', async () => {
      await request(app)
        .post('/api/profiles')
        .send({ name: 'preview-test', env: TEST_ENV });

      await request(app)
        .post('/api/profiles')
        .send({ name: 'preview-test', env: { ...TEST_ENV, ANTHROPIC_BASE_URL: 'https://changed.com' } });

      const listRes = await request(app).get('/api/backups/profiles');
      expect(listRes.status).toBe(200);
      expect(listRes.body.length).toBeGreaterThanOrEqual(1);

      const backup = listRes.body[0];
      const previewRes = await request(app).get(`/api/backups/profiles/${encodeURIComponent(backup.fileName)}/preview`);
      expect(previewRes.status).toBe(200);
      expect(previewRes.body).toHaveProperty('profiles');
    });

    it('不存在的备份文件应返回 400', async () => {
      const res = await request(app).get('/api/backups/profiles/nonexistent.json/preview');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/logs', () => {
    it('应该能返回日志', async () => {
      await request(app)
        .post('/api/profiles')
        .send({ name: 'log-test', env: TEST_ENV });

      const res = await request(app).get('/api/logs');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        expect(res.body[0]).toHaveProperty('date');
        expect(res.body[0]).toHaveProperty('content');
      }
    });
  });

  describe('完整工作流', () => {
    it('添加 → 验证 → 更新 → 删除', async () => {
      // 1. 添加
      await request(app)
        .post('/api/profiles')
        .send({
          name: 'workflow-test',
          env: {
            ANTHROPIC_AUTH_TOKEN: 'sk-workflow',
            ANTHROPIC_BASE_URL: 'https://workflow.test',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'w-opus',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'w-sonnet',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'w-haiku',
          },
        });

      // 2. 验证列表（新格式，Token 脱敏）
      let res = await request(app).get('/api/profiles');
      expect(res.body.profiles['workflow-test']).toBeDefined();
      expect(res.body.profiles['workflow-test'].env.ANTHROPIC_AUTH_TOKEN).toBe('••••••••');

      // 3. 更新（用 PUT，只更新 baseUrl）
      await request(app)
        .put('/api/profiles/workflow-test')
        .send({ env: { ANTHROPIC_BASE_URL: 'https://workflow-v2.test' } });

      // 4. 验证更新后 baseUrl 变了，token 保留
      res = await request(app).get('/api/profiles');
      expect(res.body.profiles['workflow-test'].env.ANTHROPIC_BASE_URL).toBe('https://workflow-v2.test');

      // 5. 删除
      await request(app).delete('/api/profiles/workflow-test');
      res = await request(app).get('/api/profiles');
      expect(res.body.profiles['workflow-test']).toBeUndefined();
    });

    it('POST /api/switch 后 active 更新', async () => {
      await request(app)
        .post('/api/profiles')
        .send({ name: 'switch-api-test', env: TEST_ENV });
      await request(app)
        .post('/api/switch')
        .send({ name: 'switch-api-test' });

      const res = await request(app).get('/api/profiles');
      expect(res.body.active).toBe('switch-api-test');
    });
  });
});
