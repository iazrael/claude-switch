import { useState, useEffect } from 'react';
import { fetchJSON } from '../utils/api';
import type { Presets } from '../types/api';

export function usePresets() {
  const [presets, setPresets] = useState<Presets>({});

  useEffect(() => {
    fetchJSON<Presets>('/presets').then(setPresets).catch(console.error);
  }, []);

  return { presets };
}