/**
 * bitbank Private API HTTP クライアント。
 *
 * - 認証ヘッダーの付与を隠蔽し、ツールから直接認証を意識させない
 * - HTTP 層を注入可能にし、テスト時に mock に差し替えられる
 * - レート制限（429）は Retry-After に従いリトライ
 * - Base URL: https://api.bitbank.cc（public.bitbank.cc とは別）
 */

import { createGetAuthHeaders, createPostAuthHeaders } from './auth.js';

/** テスト時に差し替え可能な HTTP fetcher 型 */
export type HttpFetcher = (url: string, init: RequestInit) => Promise<Response>;

/** bitbank API の標準レスポンス形式 */
export interface BitbankApiResponse<T = unknown> {
	success: number;
	data: T;
}

/** Private API クライアントのエラー */
export class PrivateApiError extends Error {
	constructor(
		message: string,
		public readonly errorType: string,
		public readonly statusCode?: number,
	) {
		super(message);
		this.name = 'PrivateApiError';
	}
}

export interface PrivateClientOptions {
	fetcher?: HttpFetcher;
	timeoutMs?: number;
	maxRetries?: number;
}

export class BitbankPrivateClient {
	private static readonly BASE_URL = 'https://api.bitbank.cc';
	private readonly fetcher: HttpFetcher;
	private readonly timeoutMs: number;
	private readonly maxRetries: number;

	constructor(opts: PrivateClientOptions = {}) {
		this.fetcher = opts.fetcher ?? globalThis.fetch.bind(globalThis);
		this.timeoutMs = opts.timeoutMs ?? 5000;
		this.maxRetries = opts.maxRetries ?? 2;
	}

	/**
	 * GET リクエスト
	 * @param path - API パス（例: '/v1/user/assets'）
	 * @param params - クエリパラメータ
	 */
	async get<T>(path: string, params?: Record<string, string>): Promise<T> {
		let fullPath = path;
		if (params) {
			const qs = new URLSearchParams(params).toString();
			if (qs) fullPath = `${path}?${qs}`;
		}

		const url = `${BitbankPrivateClient.BASE_URL}${fullPath}`;
		const headers = createGetAuthHeaders(fullPath);

		return this.request<T>(url, {
			method: 'GET',
			headers: {
				...headers,
				'Content-Type': 'application/json',
			},
		});
	}

	/**
	 * POST リクエスト
	 * @param path - API パス
	 * @param body - リクエストボディ
	 */
	async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
		const url = `${BitbankPrivateClient.BASE_URL}${path}`;
		const jsonBody = JSON.stringify(body);
		const headers = createPostAuthHeaders(jsonBody);

		return this.request<T>(url, {
			method: 'POST',
			headers: {
				...headers,
				'Content-Type': 'application/json',
			},
			body: jsonBody,
		});
	}

	/**
	 * 共通リクエスト処理（リトライ・タイムアウト・エラーハンドリング）
	 */
	private async request<T>(url: string, init: RequestInit): Promise<T> {
		let lastErr: unknown;

		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			const ctrl = new AbortController();
			const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);

			try {
				const res = await this.fetcher(url, { ...init, signal: ctrl.signal });
				clearTimeout(timer);

				// 429 Rate Limit
				if (res.status === 429) {
					const retryAfter = res.headers.get('Retry-After');
					const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000;
					if (attempt < this.maxRetries) {
						await new Promise((r) => setTimeout(r, waitMs));
						continue;
					}
					throw new PrivateApiError(
						`レート制限超過。${retryAfter ? retryAfter + '秒' : 'しばらく'}待ってから再試行してください`,
						'rate_limit_error',
						429,
					);
				}

				// 5xx Server Error
				if (res.status >= 500) {
					if (attempt < this.maxRetries) {
						await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
						continue;
					}
					throw new PrivateApiError(
						`bitbank サーバーエラー (HTTP ${res.status})。一時的な障害の可能性があります`,
						'upstream_error',
						res.status,
					);
				}

				// Other HTTP errors
				if (!res.ok) {
					const body = await res.text().catch(() => '');
					const errorCode = this.extractErrorCode(body);
					if (res.status === 401 || res.status === 403 || errorCode === 10000 || errorCode === 10002) {
						throw new PrivateApiError(
							'API キーまたは署名が不正です。bitbank 管理画面でキーを確認してください',
							'authentication_error',
							res.status,
						);
					}
					throw new PrivateApiError(
						`bitbank API エラー (HTTP ${res.status}): ${body.slice(0, 200)}`,
						'upstream_error',
						res.status,
					);
				}

				// Success
				const json = (await res.json()) as BitbankApiResponse<T>;
				if (json.success !== 1) {
					throw new PrivateApiError(
						`bitbank API エラー: success=${json.success}`,
						'upstream_error',
					);
				}
				return json.data;
			} catch (err) {
				clearTimeout(timer);
				if (err instanceof PrivateApiError) throw err;

				// AbortError = timeout
				if (err instanceof Error && err.name === 'AbortError') {
					lastErr = new PrivateApiError(
						`タイムアウト (${this.timeoutMs}ms)`,
						'upstream_error',
					);
				} else {
					lastErr = err;
				}

				if (attempt < this.maxRetries) {
					await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
					continue;
				}
			}
		}

		if (lastErr instanceof PrivateApiError) throw lastErr;
		throw new PrivateApiError(
			lastErr instanceof Error ? lastErr.message : 'ネットワークエラー',
			'upstream_error',
		);
	}

	/** bitbank エラーレスポンスからエラーコードを抽出 */
	private extractErrorCode(body: string): number | null {
		try {
			const parsed = JSON.parse(body);
			return parsed?.data?.code ?? null;
		} catch {
			return null;
		}
	}
}

/** デフォルトのシングルトンインスタンス */
let defaultClient: BitbankPrivateClient | null = null;

export function getDefaultClient(): BitbankPrivateClient {
	if (!defaultClient) {
		defaultClient = new BitbankPrivateClient();
	}
	return defaultClient;
}
