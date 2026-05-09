import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOME = os.homedir();

// 支持通过环境变量覆盖路径（用于测试）
const BASE_DIR = process.env.CLAUDE_SWITCH_DIR || path.join(HOME, '.claude-switch');

export const SETTINGS_PATH = process.env.CLAUDE_SETTINGS_PATH || path.join(HOME, '.claude', 'settings.json');
export const PROFILES_PATH = path.join(BASE_DIR, 'profiles.json');
export const BACKUP_DIR = path.join(BASE_DIR, 'backups');
export const LOG_DIR = path.join(BASE_DIR, 'logs');
export const PID_PATH = path.join(BASE_DIR, 'server.pid');
export const SERVER_LOG_PATH = path.join(BASE_DIR, 'server.log');
