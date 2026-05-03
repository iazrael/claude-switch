const fs = require('fs-extra');
const path = require('path');
const { SETTINGS_PATH, PROFILES_PATH } = require('./config');
const { backupFile, restoreFile, listBackups } = require('./backup');
const { logAction } = require('./logger');
const { encrypt, decrypt, needsReEncrypt } = require('./crypto-utils');
const { diffJSON } = require('./diff');

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

// 判断值是否为明文：尝试解密，如果解密结果等于原文则认为是明文
function isPlaintext(value) {
  if (!value) return false;
  const decrypted = decrypt(value);
  return decrypted === value;
}

// 迁移旧数据：如果发现有明文 token 则加密保存，或需要重加密
async function migrateIfNeeded(profiles) {
  let modified = false;
  for (const name of Object.keys(profiles)) {
    const env = profiles[name].env;
    if (!env) continue;
    for (const key of SENSITIVE_KEYS) {
      if (!env[key]) continue;
      // 明文检测：解密结果等于原文
      if (isPlaintext(env[key])) {
        env[key] = encrypt(env[key]);
        modified = true;
      } else if (needsReEncrypt(env[key])) {
        // 需要用新密钥重加密：先解密再加密
        env[key] = encrypt(decrypt(env[key]));
        modified = true;
      }
    }
  }
  if (modified) {
    await writeJSON(PROFILES_PATH, profiles);
  }
}

// 保存套餐（总是加密）
async function saveProfilesSafe(profiles, reason) {
  const toSave = {};
  for (const name of Object.keys(profiles)) {
    toSave[name] = { env: encryptProfileEnv(profiles[name].env) };
  }
  await backupFile(PROFILES_PATH, reason);
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
  const reason = existed ? `update-${name}` : `add-${name}`;
  await saveProfilesSafe(profiles, reason);
  await logAction('WRITE_PROFILES', existed ? `修改套餐 "${name}"` : `新增套餐 "${name}"`);
}

// 更新套餐：用新 env 中的非空字段覆盖旧字段，空字段保留原值
async function updateProfile(name, env) {
  const profiles = await getProfilesDecrypted();
  if (!profiles[name]) throw new Error(`套餐 "${name}" 不存在`);
  const oldEnv = profiles[name].env || {};
  const merged = { ...oldEnv };
  for (const [key, value] of Object.entries(env)) {
    if (value && value.trim && value.trim() !== '') {
      merged[key] = value.trim();
    }
  }
  profiles[name] = { env: merged };
  await saveProfilesSafe(profiles, `update-${name}`);
  await logAction('WRITE_PROFILES', `更新套餐 "${name}"`);
}

async function removeProfile(name) {
  const profiles = await getProfilesDecrypted();
  if (!profiles[name]) throw new Error(`套餐 "${name}" 不存在`);
  delete profiles[name];
  await saveProfilesSafe(profiles, `remove-${name}`);
  await logAction('WRITE_PROFILES', `删除套餐 "${name}"`);
}

async function switchProfile(name) {
  const profiles = await getProfilesDecrypted();
  if (!profiles[name]) throw new Error(`套餐 "${name}" 不存在`);
  const settings = await getSettings();
  if (!settings.env) settings.env = {};
  // 合并而非覆盖：只写入套餐中定义的变量，保留原有其他变量不变
  const profileEnv = profiles[name].env;
  const changedKeys = Object.keys(profileEnv);
  for (const key of changedKeys) {
    settings.env[key] = profileEnv[key];
  }
  await backupFile(SETTINGS_PATH, `switch-${name}`);
  await writeJSON(SETTINGS_PATH, settings);
  await logAction('WRITE_SETTINGS', `切换到套餐 "${name}" (merge ${changedKeys.join(', ')})`);
}

async function getCurrentEnv() {
  const settings = await getSettings();
  return settings.env || {};
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

// 备份 diff 预览
async function getBackupPreview(type, fileName) {
  const backup = require('./backup');
  backup.validateType(type);
  backup.validateBackupFileName(fileName);
  const config = require('./config');
  const backupPath = path.resolve(config.BACKUP_DIR, fileName);
  if (!backupPath.startsWith(path.resolve(config.BACKUP_DIR))) {
    throw new Error('备份文件路径越界');
  }
  if (!(await fs.pathExists(backupPath))) {
    throw new Error(`备份文件 ${fileName} 不存在`);
  }
  const backupData = await readJSON(backupPath);
  const currentPath = type === 'profiles' ? PROFILES_PATH : SETTINGS_PATH;
  let currentData;
  if (type === 'profiles') {
    // profiles 需要解密后再对比（但 diff 是基于扁平 key，取解密后的 env）
    const decrypted = await getProfilesDecrypted();
    const rawCurrent = {};
    for (const [name, data] of Object.entries(decrypted)) {
      rawCurrent[name] = data;
    }
    // backupData 也是加密的，需要解密
    const backupDecrypted = {};
    for (const [name, data] of Object.entries(backupData)) {
      backupDecrypted[name] = { env: decryptProfileEnv(data.env || {}) };
    }
    currentData = rawCurrent;
    // 直接用 JSON diff 比较两个对象
    const allProfileNames = new Set([
      ...Object.keys(currentData),
      ...Object.keys(backupDecrypted),
    ]);
    const result = {
      added: [],
      removed: [],
      changed: [],
      unchanged: [],
      profiles: {},
    };
    for (const profileName of allProfileNames) {
      const inCurrent = profileName in currentData;
      const inBackup = profileName in backupDecrypted;
      if (inCurrent && !inBackup) {
        result.added.push(profileName);
      } else if (!inCurrent && inBackup) {
        result.removed.push(profileName);
      } else {
        const envDiff = diffJSON(
          currentData[profileName].env || {},
          backupDecrypted[profileName].env || {},
        );
        if (envDiff.changed.length > 0) {
          result.changed.push({ profile: profileName, changes: envDiff.changed });
        }
        if (
          envDiff.added.length === 0 &&
          envDiff.removed.length === 0 &&
          envDiff.changed.length === 0
        ) {
          result.unchanged.push(profileName);
        }
      }
    }
    return result;
  } else {
    // settings：直接对比整个 env 对象
    currentData = await getSettings();
    const backupEnv = backupData.env || {};
    const currentEnv = currentData.env || {};
    return diffJSON(currentEnv, backupEnv);
  }
}

module.exports = {
  getProfiles,
  getSettings,
  getAllProfileNames,
  addProfile,
  updateProfile,
  removeProfile,
  switchProfile,
  getCurrentEnv,
  getPresetTemplates,
  restore,
  getBackups,
  getBackupPreview,
};
