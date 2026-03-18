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

	it('正常系: コンパクト形式で candles を返す', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 100);
		assertOk(res);
		expect(res.data.times).toHaveLength(100);
		expect(res.data.candles).toHaveLength(100);
		// candles は [o, h, l, c, v] タプル
		expect(res.data.candles[0]).toHaveLength(5);
		// candleFormat でフィールド名を明示
		expect(res.data.candleFormat).toEqual(['open', 'high', 'low', 'close', 'volume']);
		expect(res.meta.pair).toBe('btc_jpy');
		expect(res.meta.count).toBe(100);
		// 出来高の単位はベース通貨
		expect(res.meta.volumeUnit).toBe('BTC');
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
		// BB や ICHIMOKU は含まれない
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
		const res = await prepareChartData('btc_jpy', '1day', 100, ['ICHIMOKU']);
		assertOk(res);
		const chikou = res.data.series?.ICHI_chikou;
		expect(chikou).toBeDefined();
		expect(chikou).toHaveLength(100);
		// 末尾 26 要素は null
		const tail26 = chikou?.slice(-26) ?? [];
		for (const v of tail26) {
			expect(v).toBeNull();
		}
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

	it('RSI/MACD/STOCH がサブパネルに含まれる', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 100, ['RSI', 'MACD', 'STOCH']);
		assertOk(res);
		expect(res.data.subPanels?.RSI_14).toBeDefined();
		expect(res.data.subPanels?.MACD).toBeDefined();
		expect(res.data.subPanels?.MACD?.line).toBeDefined();
		expect(res.data.subPanels?.STOCH_K).toBeDefined();
		expect(res.data.subPanels?.STOCH_D).toBeDefined();
		// メインパネルの series には含まれない（サブパネル専用指標のみ指定時は series 自体がない）
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
		// limit=24, ICHIMOKU 指定 → chikou は全 null になるはず
		const res = await prepareChartData('btc_jpy', '1day', 24, ['ICHIMOKU']);
		assertOk(res);
		// 全 null の系列は含まれない
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

	it('デフォルト（Asia/Tokyo）で times がローカル時刻、labels が付加される', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 10);
		assertOk(res);
		// times はローカル ISO 形式（Z なし）
		expect(res.data.times[0]).not.toMatch(/Z$/);
		expect(res.data.times[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
		// labels が存在し、同じ長さ
		expect(res.data.labels).toBeDefined();
		expect(res.data.labels).toHaveLength(10);
		// 日足なので MM/DD 形式
		expect(res.data.labels?.[0]).toMatch(/^\d{2}\/\d{2}$/);
	});

	it('tz="" 指定時は times が UTC、labels なし', async () => {
		mockFetch(makeOhlcvRows(600));
		const res = await prepareChartData('btc_jpy', '1day', 10, undefined, '');
		assertOk(res);
		// times は UTC ISO 形式 (.000Z 末尾)
		expect(res.data.times[0]).toMatch(/Z$/);
		expect(res.data.labels).toBeUndefined();
	});

	it('tz="Asia/Tokyo" + 時間足の場合 labels に時刻が含まれる', async () => {
		const startMs = Date.UTC(2024, 0, 1);
		const rows: OhlcvRow[] = [];
		for (let i = 0; i < 600; i++) {
			const base = 10_000_000 + i * 1_000;
			rows.push([
				String(base),
				String(base + 2_000),
				String(base - 2_000),
				String(base + 500),
				'1.5',
				String(startMs + i * 3_600_000), // 1hour intervals
			]);
		}
		mockFetch(rows);
		const res = await prepareChartData('btc_jpy', '1hour', 10, undefined, 'Asia/Tokyo');
		assertOk(res);
		expect(res.data.labels).toBeDefined();
		// 時間足は MM/DD HH:mm 形式
		expect(res.data.labels?.[0]).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
	});
});
