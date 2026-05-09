import fs from 'fs-extra';
import path from 'path';
import { SETTINGS_PATH, PROFILES_PATH, BACKUP_DIR } from './config.js';

// 生成带时间戳和原因的备份文件名
function getBackupFileName(originalPath: string, reason?: string | null): string {
  const name = path.basename(originalPath, '.json');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  if (reason) {
    return `${name}-${ts}_${reason}.json`;
  }
  return `${name}-${ts}.json`;
}

// 清理旧备份文件，只保留最新的 maxCount 个
async function cleanOldFiles(dir: string, maxCount: number): Promise<void> {
  if (!(await fs.pathExists(dir))) return;
  const files = await fs.readdir(dir);
  if (files.length <= maxCount) return;
  // 按修改时间排序，最旧的在前
  const withTime = await Promise.all(
    files.map(async (f) => {
      const stat = await fs.stat(path.join(dir, f));
      return { name: f, mtime: stat.mtimeMs };
    })
  );
  withTime.sort((a, b) => a.mtime - b.mtime);
  const toDelete = withTime.slice(0, withTime.length - maxCount);
  for (const f of toDelete) {
    try {
      await fs.remove(path.join(dir, f.name));
    } catch {
      // 文件删除失败（权限或不存在），不影响主流程
    }
  }
}

// 备份一个文件
export async function backupFile(filePath: string, reason?: string | null): Promise<string | null> {
  await fs.ensureDir(BACKUP_DIR);
  if (await fs.pathExists(filePath)) {
    const backupName = getBackupFileName(filePath, reason);
    const backupPath = path.join(BACKUP_DIR, backupName);
    await fs.copy(filePath, backupPath);
    await cleanOldFiles(BACKUP_DIR, 20);
    return backupPath;
  }
  return null;
}

export type BackupType = 'settings' | 'profiles';

// 校验 type 白名单
export function validateType(type: string): asserts type is BackupType {
  const allowed = ['settings', 'profiles'];
  if (!allowed.includes(type)) {
    throw new Error(`无效的备份类型: ${type}，仅允许: ${allowed.join(', ')}`);
  }
}

// 校验备份文件名安全性
export function validateBackupFileName(backupFileName: string): void {
  if (!backupFileName || backupFileName.includes('..') || backupFileName.includes('/') || backupFileName.includes('\\')) {
    throw new Error('无效的备份文件名');
  }
}

// 还原：从指定备份恢复 settings 或 profiles
export async function restoreFile(type: string, backupFileName: string): Promise<void> {
  validateType(type);
  validateBackupFileName(backupFileName);
  const targetPath = type === 'settings' ? SETTINGS_PATH : PROFILES_PATH;
  const resolvedBackup = path.resolve(BACKUP_DIR, backupFileName);
  // 校验路径在 BACKUP_DIR 内
  if (!resolvedBackup.startsWith(path.resolve(BACKUP_DIR))) {
    throw new Error('备份文件路径越界');
  }
  if (!(await fs.pathExists(resolvedBackup))) {
    throw new Error(`备份文件 ${backupFileName} 不存在`);
  }
  // 还原前也自动备份当前版本（双重保险）
  await backupFile(targetPath, 'restore');
  await fs.copy(resolvedBackup, targetPath);
}

export interface BackupInfo {
  fileName: string;
  timestamp: string | null;
  reason: string | null;
}

// 解析备份文件名中的时间戳和原因
export function parseBackupFileName(fileName: string): BackupInfo {
  const match = fileName.match(/^\w+-(\d{4}-\d{2}-\d{2}T[\d-]+[A-Z]?)(?:_(.+))?\.json$/);
  if (!match) return { fileName, timestamp: null, reason: null };
  return {
    fileName,
    timestamp: match[1],
    reason: match[2] || null,
  };
}

// 列出所有备份（按文件类型筛选），返回对象数组
export async function listBackups(type: string): Promise<BackupInfo[]> {
  validateType(type);
  await fs.ensureDir(BACKUP_DIR);
  const files = await fs.readdir(BACKUP_DIR);
  return files
    .filter(f => f.startsWith(type) && f.endsWith('.json'))
    .sort()
    .reverse()
    .map(f => parseBackupFileName(f));
}
