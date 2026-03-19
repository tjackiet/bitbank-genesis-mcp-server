/**
 * セキュリティテスト。
 *
 * - クレデンシャル漏洩防止
 * - エラーメッセージのサニタイズ
 * - 設定バリデーション
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGetAuthHeaders, createPostAuthHeaders } from '../../src/private/auth.js';
import { BitbankPrivateClient, PrivateApiError } from '../../src/private/client.js';
import { getPrivateApiConfig, isPrivateApiEnabled } from '../../src/private/config.js';
import { createMockFetcher, jsonResponse, mockBitbankError } from '../fixtures/private-api.js';

const TEST_KEY = 'my_secret_api_key_abc123';
const TEST_SECRET = 'my_secret_api_secret_xyz789';

describe('クレデンシャル漏洩防止', () => {
	beforeEach(() => {
		process.env.BITBANK_API_KEY = TEST_KEY;
		process.env.BITBANK_API_SECRET = TEST_SECRET;
	});

	afterEach(() => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;
	});

	it.each([
		20001, 20002, 20003, 20004, 20005,
	])('認証エラー %d のメッセージに API キー/シークレットが含まれない', async (code) => {
		const fetcher = createMockFetcher([jsonResponse(mockBitbankError(code), 400)]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0, timeoutMs: 1000 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			expect(e.message).not.toContain(TEST_KEY);
			expect(e.message).not.toContain(TEST_SECRET);
		}
	});

	it('認証エラーは静的メッセージを使用し、レスポンスボディをエコーしない', async () => {
		const fetcher = createMockFetcher([jsonResponse(mockBitbankError(20001), 400)]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0, timeoutMs: 1000 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			// 静的メッセージであること
			expect(e.message).toBe('API 認証に失敗しました');
			// ボディの内容が含まれていないこと
			expect(e.message).not.toContain('20001');
			expect(e.message).not.toContain('success');
		}
	});

	it('汎用エラーはレスポンスボディを 200 文字に切り詰める', async () => {
		const longBody = JSON.stringify({ success: 0, data: { code: 99999, message: 'x'.repeat(500) } });
		const fetcher = createMockFetcher([new Response(longBody, { status: 400 })]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0, timeoutMs: 1000 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			// メッセージ内のボディ部分が 200 文字以下に切り詰められている
			expect(e.message.length).toBeLessThan(longBody.length);
		}
	});

	it('HTTP 401/403 のメッセージにキー/シークレットが含まれない', async () => {
		for (const status of [401, 403]) {
			const fetcher = createMockFetcher([new Response('Unauthorized', { status })]);
			const client = new BitbankPrivateClient({ fetcher, maxRetries: 0, timeoutMs: 1000 });

			try {
				await client.get('/v1/user/assets');
				expect.fail('should throw');
			} catch (err) {
				const e = err as PrivateApiError;
				expect(e.message).not.toContain(TEST_KEY);
				expect(e.message).not.toContain(TEST_SECRET);
			}
		}
	});

	it('ネットワークエラーのメッセージにキー/シークレットが含まれない', async () => {
		const fetcher = (async () => {
			throw new Error('connect ECONNREFUSED');
		}) as unknown as typeof fetch;
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0, timeoutMs: 1000 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as PrivateApiError;
			expect(e.message).not.toContain(TEST_KEY);
			expect(e.message).not.toContain(TEST_SECRET);
		}
	});
});

describe('設定バリデーション', () => {
	afterEach(() => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;
	});

	it('両方未設定 → isPrivateApiEnabled() === false', () => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;
		expect(isPrivateApiEnabled()).toBe(false);
	});

	it('キーのみ設定 → isPrivateApiEnabled() === false', () => {
		process.env.BITBANK_API_KEY = 'key';
		delete process.env.BITBANK_API_SECRET;
		expect(isPrivateApiEnabled()).toBe(false);
	});

	it('シークレットのみ設定 → isPrivateApiEnabled() === false', () => {
		delete process.env.BITBANK_API_KEY;
		process.env.BITBANK_API_SECRET = 'secret';
		expect(isPrivateApiEnabled()).toBe(false);
	});

	it('両方設定 → isPrivateApiEnabled() === true', () => {
		process.env.BITBANK_API_KEY = 'key';
		process.env.BITBANK_API_SECRET = 'secret';
		expect(isPrivateApiEnabled()).toBe(true);
	});

	it('未設定時 → getPrivateApiConfig() === null', () => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;
		expect(getPrivateApiConfig()).toBeNull();
	});

	it('未設定時 → createGetAuthHeaders() が throw する', () => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;
		expect(() => createGetAuthHeaders('/v1/user/assets')).toThrow('未設定');
	});

	it('未設定時 → createPostAuthHeaders() が throw する', () => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;
		expect(() => createPostAuthHeaders('{"pair":"btc_jpy"}')).toThrow('未設定');
	});
});
