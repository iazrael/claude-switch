import fs from 'fs-extra';
import path from 'path';
import { LOG_DIR } from './config.js';

// 清理旧日志文件
async function cleanOldLogs(maxDays = 30): Promise<void> {
  if (!(await fs.pathExists(LOG_DIR))) return;
  const files = await fs.readdir(LOG_DIR);
  const now = Date.now();
  const maxAge = maxDays * 24 * 60 * 60 * 1000;
  for (const file of files) {
    if (!file.endsWith('.log')) continue;
    const filePath = path.join(LOG_DIR, file);
    try {
      const stat = await fs.stat(filePath);
      if (now - stat.mtimeMs > maxAge) {
        await fs.remove(filePath);
      }
    } catch {
      // 文件不存在或权限问题，跳过清理
    }
  }
}

async function ensureLogFile(): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const logFile = path.join(LOG_DIR, `${today}.log`);
  await fs.ensureDir(LOG_DIR);
  await cleanOldLogs();
  return logFile;
}

// 追加一条日志
export async function logAction(action: string, details: string = ''): Promise<void> {
  const logFile = await ensureLogFile();
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${action} ${details}\n`;
  await fs.appendFile(logFile, entry, 'utf8');
}

export interface LogDay {
  date: string;
  content: string;
}

// 读取所有日志（支持日期筛选）
export async function getLogs(dateStr?: string): Promise<LogDay[]> {
  await fs.ensureDir(LOG_DIR);
  let files = await fs.readdir(LOG_DIR);
  files = files.filter(f => f.endsWith('.log')).sort().reverse();
  if (dateStr) {
    files = files.filter(f => f.includes(dateStr));
  }
  const allLogs: LogDay[] = [];
  for (const file of files) {
    const content = await fs.readFile(path.join(LOG_DIR, file), 'utf8');
    allLogs.push({ date: file.replace('.log', ''), content });
  }
  return allLogs;
}
