import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	BITBANK_API_BASE,
	DEFAULT_RETRIES,
	extractRateLimit,
	fetchJson,
	fetchJsonWithRateLimit,
} from '../../lib/http.js';

describe('定数', () => {
	it('BITBANK_API_BASE が正しい', () => {
		expect(BITBANK_API_BASE).toBe('https://public.bitbank.cc');
	});
	it('DEFAULT_RETRIES が 2', () => {
		expect(DEFAULT_RETRIES).toBe(2);
	});
});

describe('fetchJson', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('成功レスポンスを JSON としてパースする', async () => {
		const mockData = { success: 1, data: { price: 15000000 } };
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockData),
		});

		const result = await fetchJson('https://example.com/api');
		expect(result).toEqual(mockData);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it('HTTP エラーで例外を投げる', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			statusText: 'Internal Server Error',
		});

		await expect(fetchJson('https://example.com/api', { retries: 0 })).rejects.toThrow('HTTP 500');
	});

	it('リトライ後に成功する', async () => {
		let callCount = 0;
		globalThis.fetch = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.reject(new Error('network error'));
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ ok: true }),
			});
		});

		const result = await fetchJson('https://example.com/api', { retries: 1 });
		expect(result).toEqual({ ok: true });
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
	});

	it('全リトライ失敗で最後のエラーを投げる', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error('persistent error'));

		await expect(fetchJson('https://example.com/api', { retries: 1 })).rejects.toThrow('persistent error');
		expect(globalThis.fetch).toHaveBeenCalledTimes(2); // 初回 + 1リトライ
	});

	it('schema 指定時にレスポンスをバリデーションする', async () => {
		const mockData = { success: 1, value: 42 };
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockData),
		});
		const schema = { parse: (d: unknown) => d as typeof mockData };
		const result = await fetchJson('https://example.com/api', { schema });
		expect(result).toEqual(mockData);
	});

	it('schema バリデーション失敗時にエラーを投げる', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ bad: 'data' }),
		});
		const schema = {
			parse: () => {
				throw new Error('validation failed');
			},
		};
		await expect(fetchJson('https://example.com/api', { retries: 0, schema })).rejects.toThrow('validation failed');
	});

	it('AbortError（タイムアウト）で例外を投げる', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));

		await expect(fetchJson('https://example.com/api', { retries: 0, timeoutMs: 1 })).rejects.toThrow(
			'The operation was aborted.',
		);
	});
});

describe('extractRateLimit', () => {
	it('ヘッダから RateLimitInfo を抽出する', () => {
		const headers = new Headers({
			'X-RateLimit-Remaining': '99',
			'X-RateLimit-Limit': '100',
			'X-RateLimit-Reset': '1700000000',
		});
		const info = extractRateLimit(headers);
		expect(info).toEqual({ remaining: 99, limit: 100, reset: 1700000000 });
	});

	it('ヘッダが null/undefined なら null を返す', () => {
		expect(extractRateLimit(null)).toBeNull();
		expect(extractRateLimit(undefined)).toBeNull();
	});

	it('必要なヘッダが欠損している場合 null を返す', () => {
		const headers = new Headers({ 'X-RateLimit-Remaining': '99' });
		expect(extractRateLimit(headers)).toBeNull();
	});

	it('ヘッダ値が数値でない場合 null を返す', () => {
		const headers = new Headers({
			'X-RateLimit-Remaining': 'abc',
			'X-RateLimit-Limit': '100',
			'X-RateLimit-Reset': '1700000000',
		});
		expect(extractRateLimit(headers)).toBeNull();
	});
});

describe('fetchJsonWithRateLimit', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('JSON データとレートリミット情報を返す', async () => {
		const mockData = { success: 1 };
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(mockData), {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'X-RateLimit-Remaining': '50',
					'X-RateLimit-Limit': '100',
					'X-RateLimit-Reset': '1700000000',
				},
			}),
		);

		const result = await fetchJsonWithRateLimit('https://example.com/api');
		expect(result.data).toEqual(mockData);
		expect(result.rateLimit).toEqual({ remaining: 50, limit: 100, reset: 1700000000 });
	});

	it('レートリミットヘッダが無い場合 rateLimit が null', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);

		const result = await fetchJsonWithRateLimit('https://example.com/api');
		expect(result.data).toEqual({ ok: true });
		expect(result.rateLimit).toBeNull();
	});

	it('HTTP エラーでリトライ後に例外を投げる', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 503, statusText: 'Service Unavailable' }));

		await expect(fetchJsonWithRateLimit('https://example.com/api', { retries: 0 })).rejects.toThrow('HTTP 503');
	});

	it('schema 指定時にレスポンスをバリデーションする', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ val: 1 }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);
		const schema = { parse: (d: unknown) => ({ ...(d as Record<string, unknown>), parsed: true }) };

		const result = await fetchJsonWithRateLimit('https://example.com/api', { schema });
		expect(result.data).toEqual({ val: 1, parsed: true });
	});

	it('リトライ後に成功する', async () => {
		let callCount = 0;
		globalThis.fetch = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) return Promise.reject(new Error('network error'));
			return Promise.resolve(
				new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				}),
			);
		});

		const result = await fetchJsonWithRateLimit('https://example.com/api', { retries: 1 });
		expect(result.data).toEqual({ ok: true });
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
	});
});
