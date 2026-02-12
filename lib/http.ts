/** bitbank Public API ベースURL */
export const BITBANK_API_BASE = 'https://public.bitbank.cc';

/** fetchJson のデフォルトリトライ回数（初回 + N回） */
export const DEFAULT_RETRIES = 2;

export interface FetchJsonOptions {
  timeoutMs?: number;
  retries?: number;
}

export async function fetchJson<T = unknown>(url: string, { timeoutMs = 2500, retries = DEFAULT_RETRIES }: FetchJsonOptions = {}): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return (await res.json()) as T;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, 200 * 2 ** i));
    }
  }
  throw lastErr;
}


