const path = require('path');
const os = require('os');

const HOME = os.homedir();

// 支持通过环境变量覆盖路径（用于测试）
const BASE_DIR = process.env.CLAUDE_SWITCH_DIR || path.join(HOME, '.claude-switch');

module.exports = {
  // Claude Code 主配置文件
  SETTINGS_PATH: process.env.CLAUDE_SETTINGS_PATH || path.join(HOME, '.claude', 'settings.json'),
  // 套餐配置文件
  PROFILES_PATH: path.join(BASE_DIR, 'profiles.json'),
  // 备份目录
  BACKUP_DIR: path.join(BASE_DIR, 'backups'),
  // 日志目录
  LOG_DIR: path.join(BASE_DIR, 'logs'),
};
