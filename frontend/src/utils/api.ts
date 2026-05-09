const API_BASE = '/api';

interface FetchOptions {
  method?: string;
  body?: string;
}

export async function fetchJSON<T>(url: string, options?: FetchOptions): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    method: options?.method || 'GET',
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body,
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || '请求失败');
  }

  return res.json();
}