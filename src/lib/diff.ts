/**
 * JSON diff 工具 — 对比两个 JSON 对象的差异
 * 无外部依赖，独立工具模块
 */

/**
 * 判断 key 是否匹配敏感字段模式
 */
function isSensitive(key: string, sensitiveKeys: string[]): boolean {
  return sensitiveKeys.some(pattern => key.toUpperCase().includes(pattern.toUpperCase()));
}

/**
 * 脱敏值
 */
function maskIfNeeded(key: string, value: unknown, sensitiveKeys: string[]): unknown {
  if (isSensitive(key, sensitiveKeys) && value !== undefined && value !== null) {
    return '••••••••';
  }
  return value;
}

export interface ChangedItem {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface DiffOutput {
  added: string[];
  removed: string[];
  changed: ChangedItem[];
  unchanged: string[];
}

/**
 * 对比两个 JSON 对象的差异
 * @param current - 当前值
 * @param backup - 备份值
 * @param sensitiveKeys - 需要脱敏的 key 模式（默认包含 TOKEN）
 */
export function diffJSON(
  current: Record<string, unknown> | null | undefined,
  backup: Record<string, unknown> | null | undefined,
  sensitiveKeys: string[] = ['TOKEN']
): DiffOutput {
  const currentObj = current || {};
  const backupObj = backup || {};
  const allKeys = new Set([...Object.keys(currentObj), ...Object.keys(backupObj)]);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: ChangedItem[] = [];
  const unchanged: string[] = [];

  for (const key of allKeys) {
    const inCurrent = key in currentObj;
    const inBackup = key in backupObj;

    if (inCurrent && !inBackup) {
      added.push(key);
    } else if (!inCurrent && inBackup) {
      removed.push(key);
    } else {
      // 都有，比较值（JSON 序列化后比较，处理嵌套对象）
      const currentVal = JSON.stringify(currentObj[key]);
      const backupVal = JSON.stringify(backupObj[key]);
      if (currentVal === backupVal) {
        unchanged.push(key);
      } else {
        changed.push({
          key,
          oldValue: maskIfNeeded(key, backupObj[key], sensitiveKeys),
          newValue: maskIfNeeded(key, currentObj[key], sensitiveKeys),
        });
      }
    }
  }

  return { added, removed, changed, unchanged };
}
