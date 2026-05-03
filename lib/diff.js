/**
 * JSON diff 工具 — 对比两个 JSON 对象的差异
 * 无外部依赖，独立工具模块
 */

/**
 * 判断 key 是否匹配敏感字段模式
 * @param {string} key
 * @param {string[]} sensitiveKeys
 * @returns {boolean}
 */
function isSensitive(key, sensitiveKeys) {
  return sensitiveKeys.some(pattern => key.toUpperCase().includes(pattern.toUpperCase()));
}

/**
 * 脱敏值
 * @param {string} key
 * @param {*} value
 * @param {string[]} sensitiveKeys
 * @returns {*}
 */
function maskIfNeeded(key, value, sensitiveKeys) {
  if (isSensitive(key, sensitiveKeys) && value !== undefined && value !== null) {
    return '••••••••';
  }
  return value;
}

/**
 * 对比两个 JSON 对象的差异
 * @param {object} current - 当前值
 * @param {object} backup - 备份值
 * @param {string[]} sensitiveKeys - 需要脱敏的 key 模式（默认包含 TOKEN）
 * @returns {{ added: string[], removed: string[], changed: Array<{key: string, oldValue: *, newValue: *}>, unchanged: string[] }}
 */
function diffJSON(current, backup, sensitiveKeys = ['TOKEN']) {
  if (!current) current = {};
  if (!backup) backup = {};

  const allKeys = new Set([...Object.keys(current), ...Object.keys(backup)]);
  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];

  for (const key of allKeys) {
    const inCurrent = key in current;
    const inBackup = key in backup;

    if (inCurrent && !inBackup) {
      added.push(key);
    } else if (!inCurrent && inBackup) {
      removed.push(key);
    } else {
      // 都有，比较值（JSON 序列化后比较，处理嵌套对象）
      const currentVal = JSON.stringify(current[key]);
      const backupVal = JSON.stringify(backup[key]);
      if (currentVal === backupVal) {
        unchanged.push(key);
      } else {
        changed.push({
          key,
          oldValue: maskIfNeeded(key, backup[key], sensitiveKeys),
          newValue: maskIfNeeded(key, current[key], sensitiveKeys),
        });
      }
    }
  }

  return { added, removed, changed, unchanged };
}

module.exports = { diffJSON };
