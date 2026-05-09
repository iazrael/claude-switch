import { useState, useCallback } from 'react';
import { fetchJSON } from '../utils/api';
import type { BackupItem, BackupType, ProfileDiff, SettingsDiff } from '../types/api';

export function useBackups(type: BackupType) {
  const [backups, setBackups] = useState<BackupItem[]>([]);

  const load = useCallback(async () => {
    const list: BackupItem[] = await fetchJSON(`/backups/${type}`);
    setBackups(list);
  }, [type]);

  const restore = useCallback(async (fileName: string) => {
    await fetchJSON('/restore', {
      method: 'POST',
      body: JSON.stringify({ type, backupFileName: fileName }),
    });
  }, [type]);

  const preview = useCallback(async (fileName: string): Promise<ProfileDiff | SettingsDiff> => {
    return fetchJSON(`/backups/${type}/${encodeURIComponent(fileName)}/preview`);
  }, [type]);

  return { backups, load, restore, preview };
}