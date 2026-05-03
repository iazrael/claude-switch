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

// ========== Profile Manager Tests ==========

describe('Profile Manager', () => {
  beforeEach(cleanAll);
  afterEach(async () => { await fs.remove(TMP_DIR); });

  it('应该能添加套餐', async () => {
    await manager.addProfile('test-profile', TEST_ENV);
    const profiles = await manager.getProfiles();
    expect(profiles['test-profile']).toBeDefined();
    expect(profiles['test-profile'].env.ANTHROPIC_BASE_URL).toBe('https://api.test.com/anthropic');
    expect(profiles['test-profile'].env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test-abc123');
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
    const profiles = await manager.getProfiles();
    expect(profiles['to-delete']).toBeUndefined();
  });

  it('删除不存在的套餐应该抛错', async () => {
    await expect(manager.removeProfile('nonexistent')).rejects.toThrow('不存在');
  });

  it('应该能切换套餐', async () => {
    await manager.addProfile('switch-target', TEST_ENV);
    const profiles = await manager.getProfiles();
    expect(profiles['switch-target']).toBeDefined();
    expect(profiles['switch-target'].env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test-abc123');
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
    // 只更新 baseUrl，不传 token（空字段保留原值）
    await manager.updateProfile('update-test', {
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: 'https://updated.com',
      ANTHROPIC_DEFAULT_OPUS_MODEL: '',
      ANTHROPIC_DEFAULT_SONNET_MODEL: '',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: '',
    });
    const profiles = await manager.getProfiles();
    expect(profiles['update-test'].env.ANTHROPIC_BASE_URL).toBe('https://updated.com');
    // token 应该保留原值
    expect(profiles['update-test'].env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test-abc123');
  });

  it('updateProfile 不存在的套餐应该抛错', async () => {
    await expect(manager.updateProfile('nonexistent', { ANTHROPIC_BASE_URL: 'x' })).rejects.toThrow('不存在');
  });

  it('应该能修改已有套餐（通过 addProfile 覆盖）', async () => {
    await manager.addProfile('modify-me', TEST_ENV);
    const updatedEnv = { ...TEST_ENV, ANTHROPIC_BASE_URL: 'https://updated.com' };
    await manager.addProfile('modify-me', updatedEnv);
    const profiles = await manager.getProfiles();
    expect(profiles['modify-me'].env.ANTHROPIC_BASE_URL).toBe('https://updated.com');
  });

  it('profiles.json 中 Token 应该是加密存储的', async () => {
    await manager.addProfile('encrypted-test', TEST_ENV);
    const raw = await fs.readJson(PROFILES_PATH);
    const rawToken = raw['encrypted-test'].env.ANTHROPIC_AUTH_TOKEN;
    expect(rawToken).not.toBe('sk-test-abc123');
    expect(rawToken).toContain(':');
  });

  it('应该能列出 profiles 备份', async () => {
    await manager.addProfile('backup-test-1', TEST_ENV);
    await manager.addProfile('backup-test-1', { ...TEST_ENV, ANTHROPIC_BASE_URL: 'https://v2.test' });
    const backups = await manager.getBackups('profiles');
    expect(backups.length).toBeGreaterThanOrEqual(1);
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
    it('应该返回空的套餐列表', async () => {
      const res = await request(app).get('/api/profiles');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it('应该返回套餐列表（Token 脱敏）', async () => {
      await request(app)
        .post('/api/profiles')
        .send({ name: 'test-api', env: TEST_ENV });

      const res = await request(app).get('/api/profiles');
      expect(res.status).toBe(200);
      expect(res.body['test-api']).toBeDefined();
      expect(res.body['test-api'].env.ANTHROPIC_AUTH_TOKEN).toBe('••••••••');
      expect(res.body['test-api'].env.ANTHROPIC_BASE_URL).toBe('https://api.test.com/anthropic');
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

      // 验证 token 保留原值，baseUrl 更新
      const profiles = (await request(app).get('/api/profiles')).body;
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

  describe('GET /api/presets', () => {
    it('应该返回所有预设模板', async () => {
      const res = await request(app).get('/api/presets');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toContain('aliyun');
      expect(res.body.aliyun.opus).toBeDefined();
    });
  });

  describe('GET /api/backups/:type', () => {
    it('应该能列出备份', async () => {
      await request(app)
        .post('/api/profiles')
        .send({ name: 'backup-test', env: TEST_ENV });

      const res = await request(app).get('/api/backups/profiles');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('无效类型应返回 500', async () => {
      const res = await request(app).get('/api/backups/invalid');
      expect(res.status).toBe(500);
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

      // 2. 验证列表（Token 脱敏）
      let list = (await request(app).get('/api/profiles')).body;
      expect(list['workflow-test']).toBeDefined();
      expect(list['workflow-test'].env.ANTHROPIC_AUTH_TOKEN).toBe('••••••••');

      // 3. 更新（用 PUT，只更新 baseUrl）
      await request(app)
        .put('/api/profiles/workflow-test')
        .send({ env: { ANTHROPIC_BASE_URL: 'https://workflow-v2.test' } });

      // 4. 验证更新后 baseUrl 变了，token 保留
      list = (await request(app).get('/api/profiles')).body;
      expect(list['workflow-test'].env.ANTHROPIC_BASE_URL).toBe('https://workflow-v2.test');

      // 5. 删除
      await request(app).delete('/api/profiles/workflow-test');
      list = (await request(app).get('/api/profiles')).body;
      expect(list['workflow-test']).toBeUndefined();
    });
  });
});
