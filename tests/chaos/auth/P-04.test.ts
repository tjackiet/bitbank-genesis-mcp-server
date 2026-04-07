/**
 * Chaos P-04: エラーレスポンスに API キーが含まれないことを検証
 * 仮説: ログ・エラーメッセージ・例外スタックにキーが漏洩しない
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BitbankPrivateClient, type PrivateApiError } from '../../../src/private/client.js';
import { createMockFetcher, jsonResponse, mockBitbankError } from '../../fixtures/private-api.js';

const TEST_KEY = 'super_secret_api_key_CHAOS_P04';
const TEST_SECRET = 'super_secret_api_secret_CHAOS_P04';

describe('Chaos: P-04 — エラーレスポンスに API キー/シークレットが漏洩しない', () => {
	/** 仮説: あらゆるエラーパスでクレデンシャルが露出しない */

	beforeEach(() => {
		process.env.BITBANK_API_KEY = TEST_KEY;
		process.env.BITBANK_API_SECRET = TEST_SECRET;
	});

	afterEach(() => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;
	});

	/** 全認証エラーコードでクレデンシャルが含まれない */
	it.each([
		20001, 20002, 20003, 20004, 20005,
	])('認証エラーコード %d: メッセージにキー/シークレットなし', async (code) => {
		const fetcher = createMockFetcher([jsonResponse(mockBitbankError(code), 400)]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			expect(e.message).not.toContain(TEST_KEY);
			expect(e.message).not.toContain(TEST_SECRET);
			expect(e.stack ?? '').not.toContain(TEST_KEY);
			expect(e.stack ?? '').not.toContain(TEST_SECRET);
			expect(e.errorType).toBe('authentication_error');
		}
	});

	it('HTTP 401: メッセージにキー/シークレットなし', async () => {
		const fetcher = createMockFetcher([new Response('Unauthorized', { status: 401 })]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			expect(e.message).not.toContain(TEST_KEY);
			expect(e.message).not.toContain(TEST_SECRET);
			expect(e.errorType).toBe('authentication_error');
		}
	});

	it('HTTP 403: メッセージにキー/シークレットなし', async () => {
		const fetcher = createMockFetcher([new Response('Forbidden', { status: 403 })]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			expect(e.message).not.toContain(TEST_KEY);
			expect(e.message).not.toContain(TEST_SECRET);
			expect(e.errorType).toBe('authentication_error');
		}
	});

	it('ネットワークエラー: メッセージにキー/シークレットなし', async () => {
		const fetcher = (async () => {
			throw new Error('getaddrinfo ENOTFOUND api.bitbank.cc');
		}) as unknown as typeof fetch;
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			expect(e.message).not.toContain(TEST_KEY);
			expect(e.message).not.toContain(TEST_SECRET);
		}
	});

	it('タイムアウト: メッセージにキー/シークレットなし', async () => {
		const fetcher = (async (_url: string, init: RequestInit) => {
			// AbortSignal を待って abort エラーを発生させる
			return new Promise<Response>((_resolve, reject) => {
				init.signal?.addEventListener('abort', () => {
					reject(new DOMException('The operation was aborted', 'AbortError'));
				});
			});
		}) as unknown as typeof fetch;
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0, timeoutMs: 50 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			expect(e.message).not.toContain(TEST_KEY);
			expect(e.message).not.toContain(TEST_SECRET);
			expect(e.message).toContain('タイムアウト');
		}
	});

	it('不正 JSON レスポンス: メッセージにキー/シークレットなし', async () => {
		const fetcher = createMockFetcher([new Response('not json at all!!', { status: 200 })]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			expect(e.message).not.toContain(TEST_KEY);
			expect(e.message).not.toContain(TEST_SECRET);
		}
	});

	it('POST リクエストのエラーでもキー/シークレットが漏洩しない', async () => {
		const fetcher = createMockFetcher([jsonResponse(mockBitbankError(20005), 400)]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		try {
			await client.post('/v1/user/spot/order', { pair: 'btc_jpy' });
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			expect(e.message).not.toContain(TEST_KEY);
			expect(e.message).not.toContain(TEST_SECRET);
		}
	});
});
