const path = require('path');
const os = require('os');

const HOME = os.homedir();
const BASE_DIR = path.join(HOME, '.claude-switch');

module.exports = {
  // Claude Code 主配置文件
  SETTINGS_PATH: path.join(HOME, '.claude', 'settings.json'),
  // 套餐配置文件
  PROFILES_PATH: path.join(BASE_DIR, 'profiles.json'),
  // 备份目录
  BACKUP_DIR: path.join(BASE_DIR, 'backups'),
  // 日志目录
  LOG_DIR: path.join(BASE_DIR, 'logs'),
};
