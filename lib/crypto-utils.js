const crypto = require('crypto');
const os = require('os');

// 基于本机固定信息生成密钥（32字节）
function getMachineKey() {
  const data = os.hostname() + os.userInfo().username + os.platform() + os.arch();
  return crypto.createHash('sha256').update(data).digest();
}

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * 加密字符串，返回 base64 编码的密文
 */
function encrypt(text) {
  const key = getMachineKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  // 将 iv 拼接在前面，用 ':' 分隔
  return iv.toString('base64') + ':' + encrypted;
}

/**
 * 解密字符串，如果失败返回原值（兼容未加密数据）
 */
function decrypt(encoded) {
  try {
    const key = getMachineKey();
    const parts = encoded.split(':');
    if (parts.length !== 2) return encoded; // 不是加密格式，直接返回
    const iv = Buffer.from(parts[0], 'base64');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    // 解密失败（如更换机器），返回原值
    return encoded;
  }
}

module.exports = { encrypt, decrypt };
