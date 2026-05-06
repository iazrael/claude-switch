const fs = require('fs-extra');
const path = require('path');
const lockfile = require('proper-lockfile');
const { SETTINGS_PATH, PROFILES_PATH } = require('./config');
const { backupFile, restoreFile, listBackups } = require('./backup');
const { logAction } = require('./logger');
const { encrypt, decrypt, needsReEncrypt } = require('./crypto-utils');
const { diffJSON } = require('./diff');

// 需要加密的字段
const SENSITIVE_KEYS = ['ANTHROPIC_AUTH_TOKEN'];

// 比对用的环境变量 key（忽略 TOKEN）
const COMPARE_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
];

// ---------- 文件锁工具 ----------

// proper-lockfile 只支持互斥锁，统一使用 withLock

// 确保锁文件目录存在
async function ensureLockDir() {
  await fs.ensureDir(path.dirname(PROFILES_PATH));
  // 如果文件不存在，创建空文件以便 proper-lockfile 能锁定
  if (!(await fs.pathExists(PROFILES_PATH))) {
    await fs.writeJson(PROFILES_PATH, {}, { spaces: 2 });
  }
}

// 使用互斥锁执行操作（proper-lockfile 只有互斥锁，无读写之分）
async function withLock(fn) {
  await ensureLockDir();
  return lockfile.lock(PROFILES_PATH, { retries: { retries: 5, minTimeout: 50, maxTimeout: 200 } })
    .then(async (release) => {
      try {
        return await fn();
      } finally {
        await release();
      }
    });
}

// ---------- 基础读写 ----------

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

// ---------- 加密/解密工具 ----------

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

// ---------- 迁移 ----------

// 判断是否为旧格式
function isOldFormat(raw) {
  if (!raw || typeof raw !== 'object') return false;
  return raw.profiles === undefined;
}

// 迁移旧格式到新格式（在锁内调用）
async function migrateFormat(raw) {
  if (!isOldFormat(raw)) return raw;
  // 旧格式：raw 本身就是 { name: { env } } 结构
  await backupFile(PROFILES_PATH, 'migration');
  const migrated = { active: '', profiles: { ...raw } };
  await writeJSON(PROFILES_PATH, { active: '', profiles: encryptAllProfiles(raw) });
  return migrated;
}

// 加密所有套餐的敏感字段（用于迁移时写盘）
function encryptAllProfiles(profiles) {
  const result = {};
  for (const name of Object.keys(profiles)) {
    result[name] = { env: encryptProfileEnv(profiles[name].env || {}) };
  }
  return result;
}

// 迁移旧数据：明文 token 加密 / 重加密（在锁内调用，操作新格式的 profiles 子对象）
async function migrateIfNeeded(data) {
  if (!data || !data.profiles) return;
  let modified = false;
  for (const name of Object.keys(data.profiles)) {
    const env = data.profiles[name].env;
    if (!env) continue;
    for (const key of SENSITIVE_KEYS) {
      if (!env[key]) continue;
      if (isPlaintext(env[key])) {
        env[key] = encrypt(env[key]);
        modified = true;
      } else if (needsReEncrypt(env[key])) {
        env[key] = encrypt(decrypt(env[key]));
        modified = true;
      }
    }
  }
  if (modified) {
    await writeJSON(PROFILES_PATH, { active: data.active, profiles: data.profiles });
  }
}

// ---------- 核心：读取并解密 ----------

// 保存套餐（总是加密，新格式）
async function saveProfilesSafe(data, reason) {
  const encrypted = {};
  for (const name of Object.keys(data.profiles)) {
    encrypted[name] = { env: encryptProfileEnv(data.profiles[name].env) };
  }
  await backupFile(PROFILES_PATH, reason);
  await writeJSON(PROFILES_PATH, { active: data.active, profiles: encrypted });
}

// 读取套餐并解密（内部，调用方负责加锁）
// 不再触发迁移，迁移由 init() 在启动时一次性执行
async function _getProfilesDecryptedInner() {
  const data = await readJSON(PROFILES_PATH);
  // 解密
  const decrypted = {};
  for (const name of Object.keys(data.profiles || {})) {
    decrypted[name] = { env: decryptProfileEnv(data.profiles[name].env || {}) };
  }
  return { active: data.active || '', profiles: decrypted };
}

// 带锁的读取
async function getProfilesDecrypted() {
  return withLock(() => _getProfilesDecryptedInner());
}

// 初始化：启动时执行一次迁移
let _initialized = false;
async function init() {
  if (_initialized) return;
  await withLock(async () => {
    if (_initialized) return;
    const raw = await readJSON(PROFILES_PATH);
    const data = await migrateFormat(raw);
    await migrateIfNeeded(data);
    _initialized = true;
  });
}

// 重置初始化状态（仅用于测试）
function _resetInit() {
  _initialized = false;
}

// ---------- 对外公开 API ----------

async function getProfiles() {
  return getProfilesDecrypted();
}

async function getSettings() {
  return readJSON(SETTINGS_PATH);
}

async function getAllProfileNames() {
  const data = await getProfilesDecrypted();
  return Object.keys(data.profiles);
}

async function addProfile(name, env) {
  return withLock(async () => {
    const data = await _getProfilesDecryptedInner();
    const existed = !!data.profiles[name];
    data.profiles[name] = { env };
    const reason = existed ? `update-${name}` : `add-${name}`;
    await saveProfilesSafe(data, reason);
    await logAction('WRITE_PROFILES', existed ? `修改套餐 "${name}"` : `新增套餐 "${name}"`);
  });
}

// 更新套餐：用新 env 中的非空字段覆盖旧字段，空字段保留原值
async function updateProfile(name, env) {
  return withLock(async () => {
    const data = await _getProfilesDecryptedInner();
    if (!data.profiles[name]) throw new Error(`套餐 "${name}" 不存在`);
    const oldEnv = data.profiles[name].env || {};
    const merged = { ...oldEnv };
    for (const [key, value] of Object.entries(env)) {
      if (value && value.trim && value.trim() !== '') {
        merged[key] = value.trim();
      }
    }
    data.profiles[name] = { env: merged };
    await saveProfilesSafe(data, `update-${name}`);
    await logAction('WRITE_PROFILES', `更新套餐 "${name}"`);
  });
}

async function removeProfile(name) {
  return withLock(async () => {
    const data = await _getProfilesDecryptedInner();
    if (!data.profiles[name]) throw new Error(`套餐 "${name}" 不存在`);
    delete data.profiles[name];
    // 删除的是 active 套餐 → 清空 active
    if (data.active === name) {
      data.active = '';
    }
    await saveProfilesSafe(data, `remove-${name}`);
    await logAction('WRITE_PROFILES', `删除套餐 "${name}"`);
  });
}

async function switchProfile(name) {
  return withLock(async () => {
    const data = await _getProfilesDecryptedInner();
    if (!data.profiles[name]) throw new Error(`套餐 "${name}" 不存在`);
    const settings = await getSettings();
    if (!settings.env) settings.env = {};
    // 合并而非覆盖
    const profileEnv = data.profiles[name].env;
    const changedKeys = Object.keys(profileEnv);
    for (const key of changedKeys) {
      settings.env[key] = profileEnv[key];
    }
    await backupFile(SETTINGS_PATH, `switch-${name}`);
    await writeJSON(SETTINGS_PATH, settings);
    // 更新 active
    data.active = name;
    await saveProfilesSafe(data, `switch-${name}`);
    await logAction('WRITE_SETTINGS', `切换到套餐 "${name}" (merge ${changedKeys.join(', ')})`);
  });
}

async function getCurrentEnv() {
  const settings = await getSettings();
  return settings.env || {};
}

// ---------- v3.0 新增：active 状态管理 ----------

async function getActive() {
  const data = await getProfilesDecrypted();
  return data.active || '';
}

async function setActive(name) {
  return withLock(async () => {
    const data = await _getProfilesDecryptedInner();
    data.active = name;
    await saveProfilesSafe(data, `set-active-${name}`);
  });
}

// 获取当前 active 套餐名（含 fallback）
async function getActiveProfile() {
  const data = await getProfilesDecrypted();
  const currentEnv = await getCurrentEnv();
  return _resolveActiveProfile(data, currentEnv);
}

// 内部：根据 active 字段 + fallback 解析当前套餐名
function _resolveActiveProfile(data, currentEnv) {
  // 优先级 1：active 字段指向存在的套餐
  if (data.active && data.profiles[data.active]) {
    return data.active;
  }
  // 优先级 2：fallback 环境变量全量比对
  const matched = [];
  for (const [name, profile] of Object.entries(data.profiles)) {
    let match = true;
    for (const key of COMPARE_KEYS) {
      if ((profile.env[key] || '') !== (currentEnv[key] || '')) {
        match = false;
        break;
      }
    }
    if (match) matched.push(name);
  }
  if (matched.length === 1) return matched[0];
  // 多个或零个匹配都返回 null
  return null;
}

// 一致性检测（基于已有的 data 和 currentEnv，避免重复读取）
function _computeMismatch(data, currentEnv, activeName) {
  if (!activeName || !data.profiles[activeName]) {
    return { active: activeName || null, mismatch: null };
  }
  const profileEnv = data.profiles[activeName].env || {};
  for (const key of COMPARE_KEYS) {
    if ((profileEnv[key] || '') !== (currentEnv[key] || '')) {
      return { active: activeName, mismatch: true };
    }
  }
  return { active: activeName, mismatch: false };
}

async function checkMismatch() {
  const data = await getProfilesDecrypted();
  const currentEnv = await getCurrentEnv();
  const activeName = _resolveActiveProfile(data, currentEnv);
  return _computeMismatch(data, currentEnv, activeName);
}

// 获取套餐列表 + mismatch（一次性读取，避免冗余）
async function getProfilesWithMismatch() {
  const data = await getProfilesDecrypted();
  const currentEnv = await getCurrentEnv();
  const activeName = _resolveActiveProfile(data, currentEnv);
  const mismatchInfo = _computeMismatch(data, currentEnv, activeName);
  return { data, mismatchInfo };
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

// ---------- 还原功能 ----------
async function restore(type, backupFileName) {
  await restoreFile(type, backupFileName);
  await logAction('RESTORE', `${type} 从 ${backupFileName} 还原`);
}

async function getBackups(type) {
  return listBackups(type);
}

// ---------- 备份 diff 预览 ----------
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
  if (type === 'profiles') {
    // 当前数据（新格式）
    const currentFull = await getProfilesDecrypted();
    const currentProfiles = currentFull.profiles;
    // 备份数据：可能旧格式也可能新格式
    let backupProfiles;
    if (backupData.profiles !== undefined) {
      // 新格式备份
      backupProfiles = {};
      for (const [name, data] of Object.entries(backupData.profiles)) {
        backupProfiles[name] = { env: decryptProfileEnv(data.env || {}) };
      }
    } else {
      // 旧格式备份
      backupProfiles = {};
      for (const [name, data] of Object.entries(backupData)) {
        backupProfiles[name] = { env: decryptProfileEnv(data.env || {}) };
      }
    }
    // diff
    const allProfileNames = new Set([
      ...Object.keys(currentProfiles),
      ...Object.keys(backupProfiles),
    ]);
    const result = {
      added: [],
      removed: [],
      changed: [],
      unchanged: [],
      profiles: {},
    };
    for (const profileName of allProfileNames) {
      const inCurrent = profileName in currentProfiles;
      const inBackup = profileName in backupProfiles;
      if (inCurrent && !inBackup) {
        result.added.push(profileName);
      } else if (!inCurrent && inBackup) {
        result.removed.push(profileName);
      } else {
        const envDiff = diffJSON(
          currentProfiles[profileName].env || {},
          backupProfiles[profileName].env || {},
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
    const currentData = await getSettings();
    const backupEnv = backupData.env || {};
    const currentEnv = currentData.env || {};
    return diffJSON(currentEnv, backupEnv);
  }
}

// ---------- 首次安装导入 ----------
async function isFirstInstall() {
  return !(await fs.pathExists(PROFILES_PATH));
}

async function detectExistingConfig() {
  const settings = await readJSON(SETTINGS_PATH);
  const env = settings.env || {};
  const claudeKeys = [
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  ];
  const found = {};
  for (const key of claudeKeys) {
    if (env[key]) {
      found[key] = env[key];
    }
  }
  return Object.keys(found).length > 0 ? found : null;
}

module.exports = {
  init,
  _resetInit,
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
  isFirstInstall,
  detectExistingConfig,
  // v3.0 新增
  getActive,
  setActive,
  getActiveProfile,
  checkMismatch,
  getProfilesWithMismatch,
};