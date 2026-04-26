const fs = require('fs-extra');
const path = require('path');
const { LOG_DIR } = require('./config');

async function ensureLogFile() {
  const today = new Date().toISOString().slice(0, 10);
  const logFile = path.join(LOG_DIR, `${today}.log`);
  await fs.ensureDir(LOG_DIR);
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
