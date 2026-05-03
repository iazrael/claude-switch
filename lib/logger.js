const fs = require('fs-extra');
const path = require('path');
const { LOG_DIR } = require('./config');

// 清理旧日志文件
async function cleanOldLogs(maxDays = 30) {
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
    } catch (_) {}
  }
}

async function ensureLogFile() {
  const today = new Date().toISOString().slice(0, 10);
  const logFile = path.join(LOG_DIR, `${today}.log`);
  await fs.ensureDir(LOG_DIR);
  await cleanOldLogs();
  return logFile;
}

// 追加一条日志
async function logAction(action, details = '') {
  const logFile = await ensureLogFile();
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${action} ${details}\n`;
  await fs.appendFile(logFile, entry, 'utf8');
}

// 读取所有日志（支持日期筛选）
async function getLogs(dateStr) {
  await fs.ensureDir(LOG_DIR);
  let files = await fs.readdir(LOG_DIR);
  files = files.filter(f => f.endsWith('.log')).sort().reverse();
  if (dateStr) {
    files = files.filter(f => f.includes(dateStr));
  }
  const allLogs = [];
  for (const file of files) {
    const content = await fs.readFile(path.join(LOG_DIR, file), 'utf8');
    allLogs.push({ date: file.replace('.log', ''), content });
  }
  return allLogs;
}

module.exports = { logAction, getLogs };
