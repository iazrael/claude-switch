import { useState, useCallback } from 'react';
import { fetchJSON } from '../utils/api';
import type { LogEntry } from '../types/api';

export function useLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const load = useCallback(async (date?: string) => {
    const url = date ? `/logs?date=${date}` : '/logs';
    const list: LogEntry[] = await fetchJSON(url);
    setLogs(list);
  }, []);

  return { logs, load };
}