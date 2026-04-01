import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearIndicatorCache } from '../tools/analyze_indicators.js';
import prepareChartData from '../tools/prepare_chart_data.js';
import { assertFail, assertOk } from './_assertResult.js';

type OhlcvRow = [string, string, string, string, string, string];

function makeOhlcvRows(count: number, intervalMs = 86_400_000): OhlcvRow[] {
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
			String(startMs + i * intervalMs),
		]);
	}
	return rows;
}

function mockFetch(rows: OhlcvRow[], candleType = '1day') {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue({
		ok: true,
		status: 200,
		statusText: 'OK',
		json: async () => ({ success: 1, data: { candlestick: [{ type: candleType, ohlcv: rows }] } }),
	} as Response);
}

describe('prepare_chart_data', () => {
	beforeEach(() => {
		clearIndicatorCache();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('正常系: コンパクト形式で candles を返す', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 100);
		assertOk(res);
		expect(res.data.times).toHaveLength(100);
		expect(res.data.candles).toHaveLength(100);
		expect(res.data.candles[0]).toHaveLength(5);
		expect(res.data.candleFormat).toEqual(['open', 'high', 'low', 'close', 'volume']);
		expect(res.meta.pair).toBe('btc_jpy');
		expect(res.meta.count).toBe(100);
		expect(res.meta.volumeUnit).toBe('BTC');
	});

	it('candle の OHLCV 値が正しい関係を持つ', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 100);
		assertOk(res);
		// makeOhlcvRows のパターン: high=open+2000, low=open-2000, close=open+500
		const [o, h, l, c, v] = res.data.candles[0];
		expect(h - o).toBe(2_000);
		expect(o - l).toBe(2_000);
		expect(c - o).toBe(500);
		expect(h).toBeGreaterThan(l); // high > low
		expect(v).toBe(1.5);
	});

	it('indicators 未指定時は series / subPanels を返さない', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 100);
		assertOk(res);
		expect(res.data.series).toBeUndefined();
		expect(res.data.subPanels).toBeUndefined();
		expect(res.meta.indicators).toEqual([]);
	});

	it('指標フィルタリング: 指定した指標のみ含まれる', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 100, ['SMA_25', 'SMA_75']);
		assertOk(res);
		expect(res.data.series).toHaveProperty('SMA_25');
		expect(res.data.series).toHaveProperty('SMA_75');
		expect(res.data.series).not.toHaveProperty('BB_upper');
		expect(res.data.series).not.toHaveProperty('ICHI_tenkan');
	});

	it('ICHIMOKU 指定時に chikou シフトが適用済み（全 null なら除外）', async () => {
		mockFetch(makeOhlcvRows(600));
		// limit=24 だと chikou は 26 本シフトのため全 null → 除外される
		const res = await prepareChartData('btc_jpy', '1day', 24, ['ICHIMOKU']);
		assertOk(res);
		expect(res.data.series).not.toHaveProperty('ICHI_chikou');
	});

	it('ICHIMOKU 指定時に chikou が部分的に値を持つ場合は含まれる', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 60, ['ICHIMOKU']);
		assertOk(res);
		const chikou = res.data.series?.ICHI_chikou;
		expect(chikou).toBeDefined();
		expect(chikou).toHaveLength(res.data.candles.length);
		// 末尾 26 要素は null
		const tail26 = chikou?.slice(-26) ?? [];
		for (const v of tail26) {
			expect(v).toBeNull();
		}
		// 末尾以外に非 null 値が存在する
		const head = chikou?.slice(0, -26) ?? [];
		expect(head.some((v) => v !== null)).toBe(true);
	});

	it('series の各系列長が candles.length と一致する', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 50, ['SMA_20', 'BB']);
		assertOk(res);
		const candleLen = res.data.candles.length;
		for (const [, arr] of Object.entries(res.data.series ?? {})) {
			expect(arr).toHaveLength(candleLen);
		}
	});

	it('RSI/MACD/STOCH がサブパネルに含まれ構造が正しい', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 100, ['RSI', 'MACD', 'STOCH']);
		assertOk(res);
		const candleLen = res.data.candles.length;

		// RSI
		expect(res.data.subPanels?.RSI_14).toBeDefined();
		expect(res.data.subPanels?.RSI_14).toHaveLength(candleLen);

		// MACD — line, signal, hist すべて存在し長さが一致
		expect(res.data.subPanels?.MACD).toBeDefined();
		expect(res.data.subPanels?.MACD?.line).toHaveLength(candleLen);
		expect(res.data.subPanels?.MACD?.signal).toHaveLength(candleLen);
		expect(res.data.subPanels?.MACD?.hist).toHaveLength(candleLen);

		// STOCH
		expect(res.data.subPanels?.STOCH_K).toBeDefined();
		expect(res.data.subPanels?.STOCH_K).toHaveLength(candleLen);
		expect(res.data.subPanels?.STOCH_D).toBeDefined();
		expect(res.data.subPanels?.STOCH_D).toHaveLength(candleLen);

		// メインパネルの series には含まれない
		expect(res.data.series ?? {}).not.toHaveProperty('RSI_14');
	});

	it('JPY ペアの candle 値は整数に丸められる', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 10);
		assertOk(res);
		for (const [o, h, l, c] of res.data.candles) {
			expect(Number.isInteger(o)).toBe(true);
			expect(Number.isInteger(h)).toBe(true);
			expect(Number.isInteger(l)).toBe(true);
			expect(Number.isInteger(c)).toBe(true);
		}
	});

	it('JPY ペアの indicator 値も整数に丸められる', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 100, ['SMA_20']);
		assertOk(res);
		const sma = res.data.series?.SMA_20;
		expect(sma).toBeDefined();
		for (const v of sma ?? []) {
			if (v !== null) {
				expect(Number.isInteger(v)).toBe(true);
			}
		}
	});

	it('全 null 系列はレスポンスから除外される', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 24, ['ICHIMOKU']);
		assertOk(res);
		for (const [, arr] of Object.entries(res.data.series ?? {})) {
			const hasValue = arr.some((v: number | null) => v !== null);
			expect(hasValue).toBe(true);
		}
	});

	it('meta.indicators に返却された指標名が含まれる', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 100, ['SMA_20', 'RSI']);
		assertOk(res);
		expect(res.meta.indicators).toContain('SMA_20');
		expect(res.meta.indicators).toContain('RSI_14');
	});

	it('limit × indicators 数がしきい値を超える場合 limit が自動切り詰めされる', async () => {
		mockFetch(makeOhlcvRows(600));
		const indicators = ['SMA_25', 'SMA_75', 'BB', 'RSI', 'MACD'];
		// MAX_TOTAL_SERIES=150, seriesMultiplier=1+5=6
		// effectiveLimit = max(5, floor(150/6)) = 25
		const res = await prepareChartData('btc_jpy', '1day', 90, indicators);
		assertOk(res);
		expect(res.data.candles.length).toBe(25);
		expect(res.summary).toContain('limit was capped');
		expect(res.summary).toContain('from 90 to 25');
	});

	it('limit が十分小さければ切り詰めが発生しない', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 20, ['SMA_25', 'SMA_75']);
		assertOk(res);
		// 20 * 3 = 60 < 150 → 切り詰め不要
		expect(res.data.candles.length).toBe(20);
		expect(res.summary).not.toContain('limit was capped');
	});

	it('不正な pair で fail を返す', async () => {
		const res = await prepareChartData('invalid', '1day', 100);
		assertFail(res);
	});

	it('API エラー時に fail を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
		const res = await prepareChartData('btc_jpy', '1day', 100);
		assertFail(res);
	});

	it('limit でデータ点数を制限する', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 30);
		assertOk(res);
		expect(res.data.candles.length).toBeLessThanOrEqual(30);
	});

	it('デフォルト（Asia/Tokyo）で times がローカル時刻に変換される', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 10);
		assertOk(res);
		// times はローカル ISO 形式（Z なし）
		expect(res.data.times[0]).not.toMatch(/Z$/);
		expect(res.data.times[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
		// makeOhlcvRows の末尾 10 本: i=590, timestamp = UTC 2024-01-01 + 590 日
		// 先頭 = UTC 2025-08-14T00:00:00 → Asia/Tokyo = 2025-08-14T09:00:00
		expect(res.data.times[0]).toContain('T09:00:00');
	});

	it('日足の labels は MM/DD 形式', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 10);
		assertOk(res);
		expect(res.data.labels).toBeDefined();
		expect(res.data.labels).toHaveLength(10);
		expect(res.data.labels?.[0]).toMatch(/^\d{2}\/\d{2}$/);
	});

	it('tz="" 指定時は times が UTC、labels なし', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 10, undefined, '');
		assertOk(res);
		expect(res.data.times[0]).toMatch(/Z$/);
		expect(res.data.labels).toBeUndefined();
	});

	it('時間足の labels は MM/DD HH:mm 形式', async () => {
		mockFetch(makeOhlcvRows(600, 3_600_000));
		const res = await prepareChartData('btc_jpy', '1hour', 10, undefined, 'Asia/Tokyo');
		assertOk(res);
		expect(res.data.labels).toBeDefined();
		expect(res.data.labels?.[0]).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
	});

	it('メインパネルとサブパネルの指標を同時指定しても干渉しない', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 50, ['BB', 'ICHIMOKU', 'RSI', 'STOCH']);
		assertOk(res);
		const candleLen = res.data.candles.length;

		// メインパネル: BB + ICHIMOKU
		expect(res.data.series).toHaveProperty('BB_upper');
		expect(res.data.series).toHaveProperty('BB_middle');
		expect(res.data.series).toHaveProperty('BB_lower');
		expect(res.data.series).toHaveProperty('ICHI_tenkan');
		expect(res.data.series).toHaveProperty('ICHI_kijun');
		for (const [, arr] of Object.entries(res.data.series ?? {})) {
			expect(arr).toHaveLength(candleLen);
		}

		// サブパネル: RSI + STOCH
		expect(res.data.subPanels?.RSI_14).toHaveLength(candleLen);
		expect(res.data.subPanels?.STOCH_K).toHaveLength(candleLen);
		expect(res.data.subPanels?.STOCH_D).toHaveLength(candleLen);

		// meta.indicators にすべて含まれる
		for (const name of ['BB_upper', 'BB_middle', 'BB_lower', 'ICHI_tenkan', 'RSI_14', 'STOCH_K', 'STOCH_D']) {
			expect(res.meta.indicators).toContain(name);
		}
	});
});
