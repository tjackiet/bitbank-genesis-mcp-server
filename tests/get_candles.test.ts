import { afterEach, describe, expect, it, vi } from 'vitest';
import getCandles from '../tools/get_candles.js';

describe('getCandles', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('不正な日付形式は user エラーを返す', async () => {
		const res = await getCandles('btc_jpy', '1hour', '2024-01-01', 10);
		expect((res as any).ok).toBe(false);
		expect((res as any).meta?.errorType).toBe('user');
	});

	it('日足未満で date 指定時は指定日基準で取得するべき', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				success: 1,
				data: {
					candlestick: [
						{
							ohlcv: [['100', '110', '90', '105', '1.23', '1704067200000']],
						},
					],
				},
			}),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getCandles('btc_jpy', '1hour', '20240101', 50);
		expect((res as any).ok).toBe(true);

		const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
		expect(calledUrls.some((u) => u.endsWith('/btc_jpy/candlestick/1hour/20240101'))).toBe(true);
	});
});
