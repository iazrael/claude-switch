import { useState, useCallback } from 'react';
import { fetchJSON } from '../utils/api';
import type { ProfileData, Profile, ClaudeEnv } from '../types/api';

export function useProfiles() {
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [active, setActive] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<boolean>(false);

  const load = useCallback(async () => {
    const data: ProfileData = await fetchJSON('/profiles');
    setProfiles(data.profiles);
    setActive(data.active);
    setMismatch(data.mismatch);
  }, []);

  const switchTo = useCallback(async (name: string) => {
    await fetchJSON('/switch', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    await load();
  }, [load]);

  const add = useCallback(async (name: string, env: ClaudeEnv) => {
    await fetchJSON('/profiles', {
      method: 'POST',
      body: JSON.stringify({ name, env }),
    });
    await load();
  }, [load]);

  const update = useCallback(async (name: string, env: ClaudeEnv) => {
    await fetchJSON(`/profiles/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ env }),
    });
    await load();
  }, [load]);

  const remove = useCallback(async (name: string) => {
    await fetchJSON(`/profiles/${encodeURIComponent(name)}`, { method: 'DELETE' });
    await load();
  }, [load]);

  const clone = useCallback(async (source: string, name: string, overrides: ClaudeEnv) => {
    await fetchJSON('/profiles/clone', {
      method: 'POST',
      body: JSON.stringify({ source, name, overrides }),
    });
    await load();
  }, [load]);

  return { profiles, active, mismatch, load, switchTo, add, update, remove, clone };
}