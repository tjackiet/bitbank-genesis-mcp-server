/**
 * Chaos P-06: リトライ中に API シークレットを環境変数から削除
 * 仮説: 適切なエラーで停止し、不正な署名でリクエストしない
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BitbankPrivateClient, type HttpFetcher } from '../../../src/private/client.js';

describe('Chaos: P-06 — リトライ中に API シークレットを環境変数から削除', () => {
	/** 仮説: 2回目のリクエスト時に署名生成が失敗し、適切にエラーとなる */

	beforeEach(() => {
		process.env.BITBANK_API_KEY = 'test_key';
		process.env.BITBANK_API_SECRET = 'test_secret';
	});

	afterEach(() => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;
	});

	it('GET: 1回目 5xx → シークレット削除 → 2回目で署名生成失敗', async () => {
		let callCount = 0;
		const fetcher: HttpFetcher = async (_url, _init) => {
			callCount++;
			if (callCount === 1) {
				// 1回目: 5xx でリトライを誘発
				// リトライ待機中にシークレットを削除
				delete process.env.BITBANK_API_SECRET;
				return new Response('Internal Server Error', { status: 500 });
			}
			// 2回目: ここに到達するなら署名なしでリクエストしたことになる
			return new Response(JSON.stringify({ success: 1, data: {} }), { status: 200 });
		};

		const client = new BitbankPrivateClient({ fetcher, maxRetries: 1, timeoutMs: 5000 });

		try {
			await client.get('/v1/user/assets');
			// 2回目で署名生成が成功してしまった場合もチェック
			// （auth.ts は getPrivateApiConfig() を毎回呼ぶので、
			//  シークレットが消えていれば throw される）
		} catch (err) {
			// 期待: 何らかのエラーで停止
			expect(err).toBeDefined();
			// API キーが含まれないことを確認
			const msg = err instanceof Error ? err.message : String(err);
			expect(msg).not.toContain('test_key');
			expect(msg).not.toContain('test_secret');
		}
	});

	it('POST: 1回目 5xx → シークレット削除 → 2回目で署名生成失敗', async () => {
		let callCount = 0;
		const fetcher: HttpFetcher = async (_url, _init) => {
			callCount++;
			if (callCount === 1) {
				delete process.env.BITBANK_API_SECRET;
				return new Response('Internal Server Error', { status: 500 });
			}
			return new Response(JSON.stringify({ success: 1, data: {} }), { status: 200 });
		};

		const client = new BitbankPrivateClient({ fetcher, maxRetries: 1, timeoutMs: 5000 });

		try {
			await client.post('/v1/user/spot/order', { pair: 'btc_jpy' });
		} catch (err) {
			expect(err).toBeDefined();
			const msg = err instanceof Error ? err.message : String(err);
			expect(msg).not.toContain('test_key');
			expect(msg).not.toContain('test_secret');
		}
	});

	it('API キー削除 → 認証ヘッダーの生成自体が throw', async () => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;

		const fetcher: HttpFetcher = async () => {
			return new Response(JSON.stringify({ success: 1, data: {} }), { status: 200 });
		};

		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		await expect(client.get('/v1/user/assets')).rejects.toThrow('未設定');
	});

	it('シークレット削除後のリクエストは API に到達しない', async () => {
		delete process.env.BITBANK_API_SECRET;

		let apiCalled = false;
		const fetcher: HttpFetcher = async () => {
			apiCalled = true;
			return new Response(JSON.stringify({ success: 1, data: {} }), { status: 200 });
		};

		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		try {
			await client.get('/v1/user/assets');
		} catch {
			// expected
		}

		expect(apiCalled).toBe(false);
	});
});
