/**
 * Chaos A-07: 全 JPY ペアのティッカー取得中に一部ペアがエラー
 * 仮説: 成功したペアのデータは返し、失敗ペアをスキップする
 *
 * get_tickers_jpy は単一エンドポイント (/tickers_jpy) から全ペアを一括取得するため、
 * 「一部ペアだけエラー」という状況は API レスポンス内のデータ欠損として表れる。
 * ここではレスポンス全体のエラー・部分データのケースを検証する。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import getTickersJpy from '../../../tools/get_tickers_jpy.js';

describe('Chaos: A-07 — tickers_jpy で部分的なエラー', () => {
	/** 仮説: API 全体のエラーは fail、部分データは処理可能な分だけ返す */

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('API 全体が 503 → fail を返す', async () => {
		process.env.TICKERS_JPY_URL = 'https://mock.test/tickers_jpy';
		process.env.TICKERS_JPY_RETRIES = '0';
		process.env.TICKERS_JPY_TIMEOUT_MS = '500';

		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Service Unavailable', { status: 503 }));

		const result = await getTickersJpy({ bypassCache: true });

		expect(result.ok).toBe(false);

		delete process.env.TICKERS_JPY_URL;
		delete process.env.TICKERS_JPY_RETRIES;
		delete process.env.TICKERS_JPY_TIMEOUT_MS;
	});

	it('success: 0 レスポンス → fail を返す', async () => {
		process.env.TICKERS_JPY_URL = 'https://mock.test/tickers_jpy';
		process.env.TICKERS_JPY_RETRIES = '0';
		process.env.TICKERS_JPY_TIMEOUT_MS = '500';

		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ success: 0, data: { code: 10007 } }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);

		const result = await getTickersJpy({ bypassCache: true });

		expect(result.ok).toBe(false);

		delete process.env.TICKERS_JPY_URL;
		delete process.env.TICKERS_JPY_RETRIES;
		delete process.env.TICKERS_JPY_TIMEOUT_MS;
	});

	it('空の data 配列 → ok だが 0 件', async () => {
		process.env.TICKERS_JPY_URL = 'https://mock.test/tickers_jpy';
		process.env.TICKERS_JPY_RETRIES = '0';
		process.env.TICKERS_JPY_TIMEOUT_MS = '500';
		process.env.BITBANK_STRICT_PAIRS = '0';

		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ success: 1, data: [] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);

		const result = await getTickersJpy({ bypassCache: true });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data).toEqual([]);
		}

		delete process.env.TICKERS_JPY_URL;
		delete process.env.TICKERS_JPY_RETRIES;
		delete process.env.TICKERS_JPY_TIMEOUT_MS;
		delete process.env.BITBANK_STRICT_PAIRS;
	});

	it('一部ペアのデータのみ含む → 含まれるペアだけ返す', async () => {
		process.env.TICKERS_JPY_URL = 'https://mock.test/tickers_jpy';
		process.env.TICKERS_JPY_RETRIES = '0';
		process.env.TICKERS_JPY_TIMEOUT_MS = '500';
		process.env.BITBANK_STRICT_PAIRS = '0';

		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					success: 1,
					data: [
						{
							pair: 'btc_jpy',
							sell: '15000000',
							buy: '14999000',
							high: '15100000',
							low: '14900000',
							open: '14950000',
							last: '15000000',
							vol: '100',
							timestamp: 1700000000000,
						},
					],
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			),
		);

		const result = await getTickersJpy({ bypassCache: true });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.data.length).toBe(1);
		}

		delete process.env.TICKERS_JPY_URL;
		delete process.env.TICKERS_JPY_RETRIES;
		delete process.env.TICKERS_JPY_TIMEOUT_MS;
		delete process.env.BITBANK_STRICT_PAIRS;
	});
});
