const fs = require('fs-extra');
const { SETTINGS_PATH, PROFILES_PATH } = require('./config');
const { backupFile, restoreFile, listBackups } = require('./backup');
const { logAction } = require('./logger');
const { encrypt, decrypt } = require('./crypto-utils');

// 需要加密的字段
const SENSITIVE_KEYS = ['ANTHROPIC_AUTH_TOKEN'];

async function readJSON(filePath) {
  if (!(await fs.pathExists(filePath))) return {};
  return fs.readJson(filePath);
}

async function writeJSON(filePath, data) {
  await fs.ensureFile(filePath);
  await fs.writeJson(filePath, data, { spaces: 2 });
  try {
    await fs.chmod(filePath, 0o600);
  } catch (_) {}
}

// 加密套餐中的敏感字段
function encryptProfileEnv(env) {
  const encrypted = { ...env };
  for (const key of SENSITIVE_KEYS) {
    if (encrypted[key]) {
      encrypted[key] = encrypt(encrypted[key]);
    }
  }
  return encrypted;
}

// 解密套餐中的敏感字段
function decryptProfileEnv(env) {
  const decrypted = { ...env };
  for (const key of SENSITIVE_KEYS) {
    if (decrypted[key]) {
      decrypted[key] = decrypt(decrypted[key]);
    }
  }
  return decrypted;
}

// 迁移旧数据：如果发现有明文 token 则加密保存
async function migrateIfNeeded(profiles) {
  let modified = false;
  for (const name of Object.keys(profiles)) {
    const env = profiles[name].env;
    if (!env) continue;
    for (const key of SENSITIVE_KEYS) {
      if (env[key] && !env[key].includes(':')) {
        env[key] = encrypt(env[key]);
        modified = true;
      }
    }
  }
  if (modified) {
    await writeJSON(PROFILES_PATH, profiles);
  }
}

// 保存套餐（总是加密）
async function saveProfilesSafe(profiles) {
  const toSave = {};
  for (const name of Object.keys(profiles)) {
    toSave[name] = { env: encryptProfileEnv(profiles[name].env) };
  }
  await backupFile(PROFILES_PATH);
  await writeJSON(PROFILES_PATH, toSave);
}

// 读取套餐并解密
async function getProfilesDecrypted() {
  const raw = await readJSON(PROFILES_PATH);
  await migrateIfNeeded(raw);
  const decrypted = {};
  for (const name of Object.keys(raw)) {
    decrypted[name] = { env: decryptProfileEnv(raw[name].env || {}) };
  }
  return decrypted;
}

// ---------- 对外公开 API ----------

async function getProfiles() {
  return getProfilesDecrypted();
}

async function getSettings() {
  return readJSON(SETTINGS_PATH);
}

async function getAllProfileNames() {
  const profiles = await getProfilesDecrypted();
  return Object.keys(profiles);
}

async function addProfile(name, env) {
  const profiles = await getProfilesDecrypted();
  const existed = !!profiles[name];
  profiles[name] = { env };
  await saveProfilesSafe(profiles);
  await logAction('WRITE_PROFILES', existed ? `修改套餐 "${name}"` : `新增套餐 "${name}"`);
}

async function removeProfile(name) {
  const profiles = await getProfilesDecrypted();
  if (!profiles[name]) throw new Error(`套餐 "${name}" 不存在`);
  delete profiles[name];
  await saveProfilesSafe(profiles);
  await logAction('WRITE_PROFILES', `删除套餐 "${name}"`);
}

async function switchProfile(name) {
  const profiles = await getProfilesDecrypted();
  if (!profiles[name]) throw new Error(`套餐 "${name}" 不存在`);
  const settings = await getSettings();
  if (!settings.env) settings.env = {};
  // 写入 settings 时使用解密的真实值
  settings.env = { ...profiles[name].env };
  await backupFile(SETTINGS_PATH);
  await writeJSON(SETTINGS_PATH, settings);
  await logAction('WRITE_SETTINGS', `切换到套餐 "${name}"`);
}

async function getCurrentEnv() {
  const settings = await getSettings();
  return settings.env || {};
}

// 获取单个套餐的真实信息（用于编辑）
async function getPlainProfile(name) {
  const profiles = await getProfilesDecrypted();
  if (!profiles[name]) return null;
  return { name, env: profiles[name].env };
}

// ---------- 预设模板 ----------
function getPresetTemplates() {
  return {
    aliyun: {
      label: '阿里云百炼',
      baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
      opus: 'qwen3.5-max',
      sonnet: 'qwen3.5-plus',
      haiku: 'qwen3.5-turbo',
    },
    volcengine: {
      label: '火山引擎方舟',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
      opus: 'doubao-1.5-pro-256k',
      sonnet: 'doubao-1.5-pro-32k',
      haiku: 'doubao-1.5-lite-32k',
    },
    zhipu: {
      label: '智谱AI',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      opus: 'GLM-5.1',
      sonnet: 'glm-4.7',
      haiku: 'glm-4.7',
    },
    deepseek: {
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      opus: 'deepseek-reasoner',
      sonnet: 'deepseek-chat',
      haiku: 'deepseek-chat',
    },
  };
}

// 还原功能
async function restore(type, backupFileName) {
  await restoreFile(type, backupFileName);
  await logAction('RESTORE', `${type} 从 ${backupFileName} 还原`);
}

async function getBackups(type) {
  return listBackups(type);
}

module.exports = {
  getProfiles,
  getSettings,
  getAllProfileNames,
  addProfile,
  removeProfile,
  switchProfile,
  getCurrentEnv,
  getPlainProfile,
  getPresetTemplates,
  restore,
  getBackups,
};
