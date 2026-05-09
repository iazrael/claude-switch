import { useState, useCallback } from 'react';
import { fetchJSON } from '../utils/api';
import type { CurrentEnvResponse, ClaudeEnv } from '../types/api';

export function useCurrentEnv() {
  const [env, setEnv] = useState<ClaudeEnv>({});
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<boolean>(false);

  const load = useCallback(async () => {
    const data: CurrentEnvResponse = await fetchJSON('/current');
    setEnv(data.env);
    setActiveProfile(data.activeProfile);
    setMismatch(data.mismatch);
  }, []);

  return { env, activeProfile, mismatch, load };
}