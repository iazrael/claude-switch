const fs = require('fs-extra');
const path = require('path');
const { SETTINGS_PATH, PROFILES_PATH, BACKUP_DIR } = require('./config');

// 生成带时间戳的备份文件名
function getBackupFileName(originalPath) {
  const name = path.basename(originalPath, '.json');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${name}-${ts}.json`;
}

// 备份一个文件
async function backupFile(filePath) {
  await fs.ensureDir(BACKUP_DIR);
  if (await fs.pathExists(filePath)) {
    const backupName = getBackupFileName(filePath);
    const backupPath = path.join(BACKUP_DIR, backupName);
    await fs.copy(filePath, backupPath);
    return backupPath;
  }
  return null;
}

// 还原：从指定备份恢复 settings 或 profiles
async function restoreFile(type, backupFileName) {
  const targetPath = type === 'settings' ? SETTINGS_PATH : PROFILES_PATH;
  const backupPath = path.join(BACKUP_DIR, backupFileName);
  if (!(await fs.pathExists(backupPath))) {
    throw new Error(`备份文件 ${backupFileName} 不存在`);
  }
  // 还原前也自动备份当前版本（双重保险）
  await backupFile(targetPath);
  await fs.copy(backupPath, targetPath);
}

// 列出所有备份（按文件类型筛选）
async function listBackups(type) {
  await fs.ensureDir(BACKUP_DIR);
  const files = await fs.readdir(BACKUP_DIR);
  return files
    .filter(f => f.startsWith(type) && f.endsWith('.json'))
    .sort()
    .reverse();
}

module.exports = { backupFile, restoreFile, listBackups };
