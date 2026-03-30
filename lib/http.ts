/** bitbank Public API ベースURL */
export const BITBANK_API_BASE = 'https://public.bitbank.cc';

/** fetchJson のデフォルトリトライ回数（初回 + N回） */
export const DEFAULT_RETRIES = 2;

/** レートリミット情報（レスポンスヘッダから抽出） */
export interface RateLimitInfo {
	/** 残りリクエスト数 */
	remaining: number;
	/** 期間あたりの上限数 */
	limit: number;
	/** リセット時刻（Unix epoch 秒） */
	reset: number;
}

/**
 * レスポンスヘッダからレートリミット情報を抽出する。
 * ヘッダが存在しない場合は null を返す。
 */
export function extractRateLimit(
	headers: { get(name: string): string | null } | undefined | null,
): RateLimitInfo | null {
	if (!headers || typeof headers.get !== 'function') return null;
	const remaining = headers.get('X-RateLimit-Remaining');
	const limit = headers.get('X-RateLimit-Limit');
	const reset = headers.get('X-RateLimit-Reset');
	if (remaining == null || limit == null || reset == null) return null;
	const r = parseInt(remaining, 10);
	const l = parseInt(limit, 10);
	const s = parseInt(reset, 10);
	if (Number.isNaN(r) || Number.isNaN(l) || Number.isNaN(s)) return null;
	return { remaining: r, limit: l, reset: s };
}

export interface FetchJsonOptions {
	timeoutMs?: number;
	retries?: number;
	/** Zod スキーマ等の parse 互換オブジェクト。指定時はレスポンスをランタイム検証する。 */
	schema?: { parse: (data: unknown) => unknown };
}

export async function fetchJson<T = unknown>(
	url: string,
	{ timeoutMs = 2500, retries = DEFAULT_RETRIES, schema }: FetchJsonOptions = {},
): Promise<T> {
	let lastErr: unknown;
	for (let i = 0; i <= retries; i++) {
		const ctrl = new AbortController();
		const t = setTimeout(() => ctrl.abort(), timeoutMs);
		try {
			const res = await fetch(url, { signal: ctrl.signal });
			clearTimeout(t);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
			const json: unknown = await res.json();
			if (schema) return schema.parse(json) as T;
			return json as T;
		} catch (e) {
			clearTimeout(t);
			lastErr = e;
			if (i < retries) await new Promise((r) => setTimeout(r, 200 * 2 ** i));
		}
	}
	throw lastErr;
}

/** fetchJson の戻り値 + レートリミット情報 */
export interface FetchJsonResult<T> {
	data: T;
	rateLimit: RateLimitInfo | null;
}

/**
 * fetchJson と同等だが、レスポンスヘッダからレートリミット情報も抽出して返す。
 * ヘッダが存在しない場合は rateLimit: null。
 */
export async function fetchJsonWithRateLimit<T = unknown>(
	url: string,
	{ timeoutMs = 2500, retries = DEFAULT_RETRIES, schema }: FetchJsonOptions = {},
): Promise<FetchJsonResult<T>> {
	let lastErr: unknown;
	for (let i = 0; i <= retries; i++) {
		const ctrl = new AbortController();
		const t = setTimeout(() => ctrl.abort(), timeoutMs);
		try {
			const res = await fetch(url, { signal: ctrl.signal });
			clearTimeout(t);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
			const rateLimit = extractRateLimit(res.headers);
			const json: unknown = await res.json();
			const data = schema ? (schema.parse(json) as T) : (json as T);
			return { data, rateLimit };
		} catch (e) {
			clearTimeout(t);
			lastErr = e;
			if (i < retries) await new Promise((r) => setTimeout(r, 200 * 2 ** i));
		}
	}
	throw lastErr;
}
