/**
 * Chaos P-05: bitbank が HTTP 401 を返す（エラーコードなし）
 * 仮説: authentication_error に分類される
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BitbankPrivateClient, type PrivateApiError } from '../../../src/private/client.js';
import { createMockFetcher, jsonResponse, mockBitbankError } from '../../fixtures/private-api.js';

describe('Chaos: P-05 — HTTP 401/403 をエラーコードなしで返す', () => {
	/** 仮説: HTTP ステータスだけで authentication_error に分類される */

	beforeEach(() => {
		process.env.BITBANK_API_KEY = 'test_key';
		process.env.BITBANK_API_SECRET = 'test_secret';
	});

	afterEach(() => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;
	});

	it('HTTP 401 + 空ボディ → authentication_error', async () => {
		const fetcher = createMockFetcher([new Response('', { status: 401 })]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			expect(e.errorType).toBe('authentication_error');
			expect(e.statusCode).toBe(401);
		}
	});

	it('HTTP 401 + プレーンテキスト → authentication_error', async () => {
		const fetcher = createMockFetcher([new Response('Unauthorized', { status: 401 })]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			expect(e.errorType).toBe('authentication_error');
		}
	});

	it('HTTP 403 + 空ボディ → authentication_error', async () => {
		const fetcher = createMockFetcher([new Response('', { status: 403 })]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			expect(e.errorType).toBe('authentication_error');
			expect(e.statusCode).toBe(403);
		}
	});

	it('HTTP 401 + bitbank エラーコード付き → authentication_error（コード 20001）', async () => {
		const fetcher = createMockFetcher([jsonResponse(mockBitbankError(20001), 401)]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			expect(e.errorType).toBe('authentication_error');
			expect(e.bitbankCode).toBe(20001);
		}
	});

	it('HTTP 401 はリトライされない', async () => {
		const fetcher = createMockFetcher([new Response('Unauthorized', { status: 401 })]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 2 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			expect(e.errorType).toBe('authentication_error');
			// 1回のみのリクエスト（リトライなし）
			expect(fetcher.calls.length).toBe(1);
		}
	});

	it('HTTP 400 + 認証エラーコード → authentication_error（bitbank の実際の挙動）', async () => {
		// bitbank は認証エラーでも HTTP 400 を返すことがある
		const fetcher = createMockFetcher([jsonResponse(mockBitbankError(20005), 400)]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			expect(e.errorType).toBe('authentication_error');
			expect(e.bitbankCode).toBe(20005);
			expect(e.message).toContain('署名');
		}
	});
});
