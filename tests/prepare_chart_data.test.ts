import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearIndicatorCache } from '../tools/analyze_indicators.js';
import prepareChartData from '../tools/prepare_chart_data.js';
import { assertFail, assertOk } from './_assertResult.js';

type OhlcvRow = [string, string, string, string, string, string];

function makeOhlcvRows(count: number): OhlcvRow[] {
	const startMs = Date.UTC(2024, 0, 1);
	const rows: OhlcvRow[] = [];
	for (let i = 0; i < count; i++) {
		const base = 10_000_000 + i * 1_000;
		rows.push([
			String(base),
			String(base + 2_000),
			String(base - 2_000),
			String(base + 500),
			'1.5',
			String(startMs + i * 86_400_000),
		]);
	}
	return rows;
}

function mockFetch(rows: OhlcvRow[]) {
	globalThis.fetch = vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		statusText: 'OK',
		json: async () => ({ success: 1, data: { candlestick: [{ type: '1day', ohlcv: rows }] } }),
	}) as unknown as typeof fetch;
}

describe('prepare_chart_data', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		clearIndicatorCache();
	});

	it('正常系: candles と series を返す', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 100);
		assertOk(res);
		expect(res.data.candles).toHaveLength(100);
		expect(res.data.candles[0]).toHaveProperty('time');
		expect(res.data.candles[0]).toHaveProperty('open');
		expect(res.data.candles[0]).toHaveProperty('close');
		expect(res.meta.pair).toBe('btc_jpy');
		expect(res.meta.count).toBe(100);
	});

	it('指標フィルタリング: 指定した指標のみ含まれる', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 100, ['SMA_25', 'SMA_75']);
		assertOk(res);
		expect(res.data.series).toHaveProperty('SMA_25');
		expect(res.data.series).toHaveProperty('SMA_75');
		// BB や ICHIMOKU は含まれない
		expect(res.data.series).not.toHaveProperty('BB_upper');
		expect(res.data.series).not.toHaveProperty('ICHI_tenkan');
	});

	it('ICHIMOKU 指定時に chikou シフトが適用済み', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 100, ['ICHIMOKU']);
		assertOk(res);
		const chikou = res.data.series.ICHI_chikou;
		expect(chikou).toBeDefined();
		expect(chikou).toHaveLength(100);
		// chikou は 26 本シフトされているため末尾 26 要素は null
		const tail26 = chikou.slice(-26);
		for (const entry of tail26) {
			expect(entry.value).toBeNull();
		}
	});

	it('series の各系列長が candles.length と一致する', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 50);
		assertOk(res);
		const candleLen = res.data.candles.length;
		for (const [, seriesArr] of Object.entries(res.data.series)) {
			expect(seriesArr).toHaveLength(candleLen);
		}
	});

	it('RSI/MACD/STOCH がサブパネルに含まれる', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 100, ['RSI', 'MACD', 'STOCH']);
		assertOk(res);
		expect(res.data.subPanels.RSI_14).toBeDefined();
		expect(res.data.subPanels.MACD).toBeDefined();
		expect(res.data.subPanels.MACD?.line).toBeDefined();
		expect(res.data.subPanels.STOCH_K).toBeDefined();
		expect(res.data.subPanels.STOCH_D).toBeDefined();
		// メインパネルの series には含まれない
		expect(res.data.series).not.toHaveProperty('RSI_14');
	});

	it('不正な pair で fail を返す', async () => {
		const res = await prepareChartData('invalid', '1day', 100);
		assertFail(res);
	});

	it('API エラー時に fail を返す', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
		const res = await prepareChartData('btc_jpy', '1day', 100);
		assertFail(res);
	});

	it('limit でデータ点数を制限する', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 30);
		assertOk(res);
		expect(res.data.candles.length).toBeLessThanOrEqual(30);
	});
});
