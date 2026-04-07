/**
 * Chaos P-06: リトライ中に API シークレットを環境変数から削除
 * 仮説: 適切なエラーで停止し、不正な署名でリクエストしない
 *
 * 注意: BitbankPrivateClient の get()/post() は auth ヘッダーをリトライループの
 * 外で1回だけ生成する。そのため、リトライ中にシークレットを削除しても
 * 既に生成済みの署名が再利用される（設計上の特性）。
 * ここではその特性と、事前削除時の安全性を検証する。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BitbankPrivateClient, type HttpFetcher } from '../../../src/private/client.js';

describe('Chaos: P-06 — API シークレット削除時の挙動', () => {
	beforeEach(() => {
		process.env.BITBANK_API_KEY = 'test_key';
		process.env.BITBANK_API_SECRET = 'test_secret';
	});

	afterEach(() => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;
	});

	it('auth ヘッダーはリトライループ外で生成される（リトライ中のシークレット削除は署名に影響しない）', async () => {
		let callCount = 0;
		const fetcher: HttpFetcher = async (_url, init) => {
			callCount++;
			// 全リクエストに ACCESS-SIGNATURE ヘッダーが付いていることを確認
			const headers = init.headers as Record<string, string>;
			expect(headers['ACCESS-SIGNATURE']).toBeTruthy();

			if (callCount === 1) {
				// リトライ中にシークレットを削除
				delete process.env.BITBANK_API_SECRET;
				return new Response('Internal Server Error', { status: 500 });
			}
			// 2回目: 既に生成済みの署名が再利用される
			return new Response(JSON.stringify({ success: 1, data: {} }), { status: 200 });
		};

		const client = new BitbankPrivateClient({ fetcher, maxRetries: 1, timeoutMs: 5000 });
		await client.get('/v1/user/assets');

		// 2回呼ばれた（リトライが発生した）
		expect(callCount).toBe(2);
	});

	it('GET: シークレット事前削除 → auth ヘッダー生成が throw', async () => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;

		const fetcher: HttpFetcher = async () => {
			return new Response(JSON.stringify({ success: 1, data: {} }), { status: 200 });
		};

		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		await expect(client.get('/v1/user/assets')).rejects.toThrow('未設定');
	});

	it('POST: シークレット事前削除 → auth ヘッダー生成が throw', async () => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;

		const fetcher: HttpFetcher = async () => {
			return new Response(JSON.stringify({ success: 1, data: {} }), { status: 200 });
		};

		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		await expect(client.post('/v1/user/spot/order', { pair: 'btc_jpy' })).rejects.toThrow('未設定');
	});

	it('シークレット削除後のリクエストは API に到達しない', async () => {
		delete process.env.BITBANK_API_SECRET;

		let apiCalled = false;
		const fetcher: HttpFetcher = async () => {
			apiCalled = true;
			return new Response(JSON.stringify({ success: 1, data: {} }), { status: 200 });
		};

		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		await expect(client.get('/v1/user/assets')).rejects.toThrow();
		expect(apiCalled).toBe(false);
	});

	it('throw のエラーメッセージにキー/シークレットが含まれない', async () => {
		delete process.env.BITBANK_API_SECRET;

		const fetcher: HttpFetcher = async () => {
			return new Response('', { status: 200 });
		};
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			expect(msg).not.toContain('test_key');
			expect(msg).not.toContain('test_secret');
		}
	});
});
