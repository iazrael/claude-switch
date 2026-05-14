import fs from 'fs-extra';
import path from 'path';
import lockfile from 'proper-lockfile';
import { SETTINGS_PATH, PROFILES_PATH, BACKUP_DIR } from './config.js';
import { backupFile, restoreFile, listBackups, validateType, validateBackupFileName, BackupType, BackupInfo } from './backup.js';
import { logAction } from './logger.js';
import { encrypt, decrypt, needsReEncrypt } from './crypto-utils.js';
import { diffJSON, DiffOutput } from './diff.js';
import { ClaudeEnv, ProfileData, Profile, SettingsJson, PresetTemplate, DiffChange } from './types.js';

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
async function ensureLockDir(): Promise<void> {
  await fs.ensureDir(path.dirname(PROFILES_PATH));
  // 如果文件不存在，创建空文件以便 proper-lockfile 能锁定
  if (!(await fs.pathExists(PROFILES_PATH))) {
    await fs.writeJson(PROFILES_PATH, {}, { spaces: 2 });
  }
}

// 使用互斥锁执行操作（proper-lockfile 只有互斥锁，无读写之分）
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
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

async function readJSON<T>(filePath: string): Promise<T | null> {
  if (!(await fs.pathExists(filePath))) return null;
  return fs.readJson(filePath) as Promise<T>;
}

async function writeJSON<T>(filePath: string, data: T): Promise<void> {
  await fs.ensureFile(filePath);
  await fs.writeJson(filePath, data, { spaces: 2 });
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // 权限设置失败不影响主流程（某些文件系统不支持）
  }
}

// ---------- 加密/解密工具 ----------

// 加密套餐中的敏感字段
function encryptProfileEnv(env: ClaudeEnv): ClaudeEnv {
  const encrypted: ClaudeEnv = { ...env };
  for (const key of SENSITIVE_KEYS) {
    if (encrypted[key as keyof ClaudeEnv]) {
      encrypted[key as keyof ClaudeEnv] = encrypt(encrypted[key as keyof ClaudeEnv] as string);
    }
  }
  return encrypted;
}

// 解密套餐中的敏感字段
function decryptProfileEnv(env: ClaudeEnv): ClaudeEnv {
  const decrypted: ClaudeEnv = { ...env };
  for (const key of SENSITIVE_KEYS) {
    if (decrypted[key as keyof ClaudeEnv]) {
      decrypted[key as keyof ClaudeEnv] = decrypt(decrypted[key as keyof ClaudeEnv] as string);
    }
  }
  return decrypted;
}

// 判断值是否为明文：尝试解密，如果解密结果等于原文则认为是明文
function isPlaintext(value: string): boolean {
  if (!value) return false;
  const decrypted = decrypt(value);
  return decrypted === value;
}

// ---------- 迁移 ----------

// 旧格式类型（没有 active 字段）
type OldFormatProfiles = Record<string, { env: Record<string, string> }>;

// 判断是否为旧格式
function isOldFormat(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  return !('profiles' in raw);
}

// 迁移旧格式到新格式（在锁内调用）
async function migrateFormat(raw: ProfileData | OldFormatProfiles | null): Promise<ProfileData> {
  if (!raw || !isOldFormat(raw)) return raw as ProfileData;
  // 旧格式：raw 本身就是 { name: { env } } 结构
  await backupFile(PROFILES_PATH, 'migration');
  const oldProfiles = raw as OldFormatProfiles;
  const migrated: ProfileData = { active: '', profiles: keepSensitiveFieldsAsIs(oldProfiles) };
  await writeJSON(PROFILES_PATH, { active: '', profiles: migrated.profiles });
  return migrated;
}

// 迁移时保持敏感字段原样（旧格式数据已经是加密的，不需要再加密）
function keepSensitiveFieldsAsIs(profiles: OldFormatProfiles): Record<string, Profile> {
  const result: Record<string, Profile> = {};
  for (const name of Object.keys(profiles)) {
    result[name] = { env: { ...(profiles[name].env || {}) } };
  }
  return result;
}

// 迁移旧数据：明文 token 加密 / 重加密（在锁内调用，操作新格式的 profiles 子对象）
async function migrateIfNeeded(data: ProfileData): Promise<void> {
  if (!data || !data.profiles) return;
  let modified = false;
  for (const name of Object.keys(data.profiles)) {
    const env = data.profiles[name].env;
    if (!env) continue;
    for (const key of SENSITIVE_KEYS) {
      const envKey = key as keyof ClaudeEnv;
      if (!env[envKey]) continue;
      if (isPlaintext(env[envKey] as string)) {
        env[envKey] = encrypt(env[envKey] as string);
        modified = true;
      } else if (needsReEncrypt(env[envKey] as string)) {
        env[envKey] = encrypt(decrypt(env[envKey] as string));
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
async function saveProfilesSafe(data: ProfileData, reason: string): Promise<void> {
  const encrypted: Record<string, Profile> = {};
  for (const name of Object.keys(data.profiles)) {
    encrypted[name] = { env: encryptProfileEnv(data.profiles[name].env) };
  }
  await backupFile(PROFILES_PATH, reason);
  await writeJSON(PROFILES_PATH, { active: data.active, profiles: encrypted });
}

// 读取套餐并解密（内部，调用方负责加锁）
// 不再触发迁移，迁移由 init() 在启动时一次性执行
async function _getProfilesDecryptedInner(): Promise<ProfileData> {
  const data = await readJSON<{ active?: string; profiles?: Record<string, { env: Record<string, string> }> }>(PROFILES_PATH);
  if (!data) return { active: '', profiles: {} };
  // 解密
  const decrypted: Record<string, Profile> = {};
  for (const name of Object.keys(data.profiles || {})) {
    const profileData = data.profiles?.[name];
    decrypted[name] = { env: decryptProfileEnv(profileData?.env || {}) };
  }
  return { active: data.active || '', profiles: decrypted };
}

// 带锁的读取
async function getProfilesDecrypted(): Promise<ProfileData> {
  return withLock(() => _getProfilesDecryptedInner());
}

// 初始化：启动时执行一次迁移
let _initialized = false;
export async function init(): Promise<void> {
  if (_initialized) return;
  await withLock(async () => {
    if (_initialized) return;
    const raw = await readJSON<ProfileData>(PROFILES_PATH);
    const data = await migrateFormat(raw);
    await migrateIfNeeded(data);
    _initialized = true;
  });
}

// 重置初始化状态（仅用于测试）
export function _resetInit(): void {
  _initialized = false;
}

// ---------- 对外公开 API ----------

export async function getProfiles(): Promise<ProfileData> {
  return getProfilesDecrypted();
}

export async function getSettings(): Promise<SettingsJson> {
  const data = await readJSON<SettingsJson>(SETTINGS_PATH);
  return data || { env: {} };
}

export async function getAllProfileNames(): Promise<string[]> {
  const data = await getProfilesDecrypted();
  return Object.keys(data.profiles);
}

export async function addProfile(name: string, env: ClaudeEnv): Promise<void> {
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
export async function updateProfile(name: string, env: ClaudeEnv): Promise<void> {
  return withLock(async () => {
    const data = await _getProfilesDecryptedInner();
    if (!data.profiles[name]) throw new Error(`套餐 "${name}" 不存在`);
    const oldEnv = data.profiles[name].env || {};
    const merged: ClaudeEnv = { ...oldEnv };
    for (const [key, value] of Object.entries(env) as [keyof ClaudeEnv, string | undefined][]) {
      if (value && typeof value === 'string' && value.trim() !== '') {
        merged[key] = value.trim();
      }
    }
    data.profiles[name] = { env: merged };
    await saveProfilesSafe(data, `update-${name}`);
    await logAction('WRITE_PROFILES', `更新套餐 "${name}"`);
  });
}

// editProfile: update only provided fields; empty string = clear field, undefined = skip
export async function editProfile(name: string, updates: Partial<ClaudeEnv>): Promise<void> {
  return withLock(async () => {
    const data = await _getProfilesDecryptedInner();
    if (!data.profiles[name]) throw new Error(`套餐 "${name}" 不存在`);
    const env = { ...data.profiles[name].env };
    for (const [key, value] of Object.entries(updates) as [keyof ClaudeEnv, string | undefined][]) {
      if (value === undefined) continue; // skip untouched fields
      if (value.trim() === '') {
        delete env[key]; // clear
      } else {
        env[key] = value.trim();
      }
    }
    data.profiles[name] = { env };
    await saveProfilesSafe(data, `edit-${name}`);
    await logAction('WRITE_PROFILES', `编辑套餐 "${name}"`);
  });
}

// copyProfile: deep copy source profile to target name
export async function copyProfile(source: string, target: string): Promise<void> {
  return withLock(async () => {
    const data = await _getProfilesDecryptedInner();
    if (!data.profiles[source]) throw new Error(`套餐 "${source}" 不存在`);
    const sourceEnv = data.profiles[source].env;
    const copiedEnv: ClaudeEnv = {};
    for (const [key, value] of Object.entries(sourceEnv) as [keyof ClaudeEnv, string | undefined][]) {
      if (value !== undefined) copiedEnv[key] = value;
    }
    data.profiles[target] = { env: copiedEnv };
    await saveProfilesSafe(data, `copy-${source}-to-${target}`);
    await logAction('WRITE_PROFILES', `复制套餐 "${source}" → "${target}"`);
  });
}

export async function removeProfile(name: string): Promise<void> {
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

export async function switchProfile(name: string): Promise<void> {
  return withLock(async () => {
    const data = await _getProfilesDecryptedInner();
    if (!data.profiles[name]) throw new Error(`套餐 "${name}" 不存在`);
    const settings = await getSettings();
    if (!settings.env) settings.env = {};
    // 合并而非覆盖
    const profileEnv = data.profiles[name].env;
    const changedKeys = Object.keys(profileEnv) as (keyof ClaudeEnv)[];
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

export async function getCurrentEnv(): Promise<ClaudeEnv> {
  const settings = await getSettings();
  return settings.env || {};
}

// ---------- v3.0 新增：active 状态管理 ----------

export async function getActive(): Promise<string> {
  const data = await getProfilesDecrypted();
  return data.active || '';
}

export async function setActive(name: string): Promise<void> {
  return withLock(async () => {
    const data = await _getProfilesDecryptedInner();
    data.active = name;
    await saveProfilesSafe(data, `set-active-${name}`);
  });
}

// 获取当前 active 套餐名（含 fallback）
export async function getActiveProfile(): Promise<string | null> {
  const data = await getProfilesDecrypted();
  const currentEnv = await getCurrentEnv();
  return _resolveActiveProfile(data, currentEnv);
}

// 内部：根据 active 字段 + fallback 解析当前套餐名
function _resolveActiveProfile(data: ProfileData, currentEnv: ClaudeEnv): string | null {
  // 优先级 1：active 字段指向存在的套餐
  if (data.active && data.profiles[data.active]) {
    return data.active;
  }
  // 优先级 2：fallback 环境变量全量比对
  const matched: string[] = [];
  for (const [name, profile] of Object.entries(data.profiles)) {
    let match = true;
    for (const key of COMPARE_KEYS as (keyof ClaudeEnv)[]) {
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

export interface MismatchInfo {
  active: string | null;
  mismatch: boolean | null;
}

// 一致性检测（基于已有的 data 和 currentEnv，避免重复读取）
function _computeMismatch(data: ProfileData, currentEnv: ClaudeEnv, activeName: string | null): MismatchInfo {
  if (!activeName || !data.profiles[activeName]) {
    return { active: activeName || null, mismatch: null };
  }
  const profileEnv = data.profiles[activeName].env || {};
  for (const key of COMPARE_KEYS as (keyof ClaudeEnv)[]) {
    if ((profileEnv[key] || '') !== (currentEnv[key] || '')) {
      return { active: activeName, mismatch: true };
    }
  }
  return { active: activeName, mismatch: false };
}

export async function checkMismatch(): Promise<MismatchInfo> {
  const data = await getProfilesDecrypted();
  const currentEnv = await getCurrentEnv();
  const activeName = _resolveActiveProfile(data, currentEnv);
  return _computeMismatch(data, currentEnv, activeName);
}

// 获取套餐列表 + mismatch（一次性读取，避免冗余）
export async function getProfilesWithMismatch(): Promise<{ data: ProfileData; mismatchInfo: MismatchInfo }> {
  const data = await getProfilesDecrypted();
  const currentEnv = await getCurrentEnv();
  const activeName = _resolveActiveProfile(data, currentEnv);
  const mismatchInfo = _computeMismatch(data, currentEnv, activeName);
  return { data, mismatchInfo };
}

// ---------- 预设模板 ----------
export function getPresetTemplates(): Record<string, PresetTemplate> {
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
export async function restore(type: string, backupFileName: string): Promise<void> {
  await restoreFile(type, backupFileName);
  await logAction('RESTORE', `${type} 从 ${backupFileName} 还原`);
}

export async function getBackups(type: BackupType): Promise<BackupInfo[]> {
  return listBackups(type);
}

export interface PreviewResult {
  added: string[];
  removed: string[];
  changed: { profile: string; changes: DiffChange[] }[];
  unchanged: string[];
  profiles?: Record<string, Profile>;
}

// ---------- 备份 diff 预览 ----------
export async function getBackupPreview(type: BackupType, fileName: string): Promise<PreviewResult | DiffOutput> {
  validateType(type);
  validateBackupFileName(fileName);
  const backupPath = path.resolve(BACKUP_DIR, fileName);
  if (!backupPath.startsWith(path.resolve(BACKUP_DIR))) {
    throw new Error('备份文件路径越界');
  }
  if (!(await fs.pathExists(backupPath))) {
    throw new Error(`备份文件 ${fileName} 不存在`);
  }
  const backupData = await readJSON<{ active?: string; profiles?: Record<string, { env: Record<string, string> }> } | { env?: Record<string, string> }>(backupPath);

  if (type === 'profiles') {
    // 当前数据（新格式）
    const currentFull = await getProfilesDecrypted();
    const currentProfiles = currentFull.profiles;
    // 备份数据：可能旧格式也可能新格式
    let backupProfiles: Record<string, Profile>;
    if (backupData && 'profiles' in backupData && backupData.profiles !== undefined) {
      // 新格式备份
      backupProfiles = {};
      for (const [name, data] of Object.entries(backupData.profiles)) {
        backupProfiles[name] = { env: decryptProfileEnv(data.env || {}) };
      }
    } else {
      // 旧格式备份
      backupProfiles = {};
      const oldProfiles = backupData as Record<string, { env: Record<string, string> }> | null;
      if (oldProfiles) {
        for (const [name, data] of Object.entries(oldProfiles)) {
          if (data && 'env' in data) {
            backupProfiles[name] = { env: decryptProfileEnv(data.env || {}) };
          }
        }
      }
    }
    // diff
    const allProfileNames = new Set([
      ...Object.keys(currentProfiles),
      ...Object.keys(backupProfiles),
    ]);
    const result: PreviewResult = {
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
          currentProfiles[profileName].env as Record<string, unknown> || {},
          backupProfiles[profileName].env as Record<string, unknown> || {},
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
    const backupEnv = (backupData as { env?: Record<string, string> } | null)?.env || {};
    const currentEnv = currentData.env || {};
    return diffJSON(currentEnv, backupEnv);
  }
}

// ---------- 首次安装导入 ----------
export async function isFirstInstall(): Promise<boolean> {
  return !(await fs.pathExists(PROFILES_PATH));
}

export async function detectExistingConfig(): Promise<ClaudeEnv | null> {
  const settings = await readJSON<SettingsJson>(SETTINGS_PATH);
  if (!settings?.env) return null;
  const env = settings.env;
  const claudeKeys: (keyof ClaudeEnv)[] = [
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  ];
  const found: ClaudeEnv = {};
  for (const key of claudeKeys) {
    if (env[key]) {
      found[key] = env[key];
    }
  }
  return Object.keys(found).length > 0 ? found : null;
}
