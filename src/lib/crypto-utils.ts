import crypto from 'crypto';
import os from 'os';
import { execSync } from 'child_process';
import fs from 'fs';

// 获取本机唯一标识
function getMachineId(): string {
  try {
    if (os.platform() === 'darwin') {
      const output = execSync(
        'ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID',
        { encoding: 'utf8', timeout: 3000 }
      );
      const match = output.match(/"IOPlatformUUID"\s*=\s*"(.+?)"/);
      if (match) return match[1];
    } else if (os.platform() === 'linux') {
      try {
        return fs.readFileSync('/etc/machine-id', 'utf8').trim();
      } catch {
        // Linux machine-id 文件不存在或不可读
      }
    }
  } catch {
    // macOS ioreg 执行失败或超时
  }
  // 降级：hostname + username
  return os.hostname() + '-' + os.userInfo().username;
}

// 旧密钥函数（用于向后兼容解密）
function getMachineKeyLegacy(): Buffer {
  const data = os.hostname() + os.userInfo().username + os.platform() + os.arch();
  return crypto.createHash('sha256').update(data).digest();
}

// 新密钥函数（增强版）
function getMachineKey(): Buffer {
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';
  const data = [
    getMachineId(),
    os.hostname(),
    os.userInfo().username,
    os.platform(),
    os.arch(),
    String(os.totalmem()),
    cpuModel,
  ].join('|');
  return crypto.createHash('sha256').update(data + 'claude-switch-v2-salt').digest();
}

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * 加密字符串，返回 base64 编码的密文
 */
export function encrypt(text: string): string {
  const key = getMachineKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  // 将 iv 拼接在前面，用 ':' 分隔
  return iv.toString('base64') + ':' + encrypted;
}

/**
 * 解密字符串：先尝试新密钥，失败后用旧密钥解密
 * 如果都失败，返回原值（兼容未加密数据）
 */
export function decrypt(encoded: string): string {
  // 先尝试新密钥
  try {
    const key = getMachineKey();
    const parts = encoded.split(':');
    if (parts.length !== 2) return encoded;
    const iv = Buffer.from(parts[0], 'base64');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (_) {
    // 新密钥失败，尝试旧密钥
  }

  try {
    const key = getMachineKeyLegacy();
    const parts = encoded.split(':');
    if (parts.length !== 2) return encoded;
    const iv = Buffer.from(parts[0], 'base64');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (_) {
    return encoded;
  }
}

/**
 * 检查是否需要用新密钥重加密
 */
export function needsReEncrypt(encoded: string): boolean {
  if (!encoded || !encoded.includes(':')) return false;
  try {
    const key = getMachineKey();
    const parts = encoded.split(':');
    if (parts.length !== 2) return false;
    const iv = Buffer.from(parts[0], 'base64');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return false; // 新密钥能解密，不需要重加密
  } catch (_) {
    return true; // 新密钥解密失败，需要重加密
  }
}
