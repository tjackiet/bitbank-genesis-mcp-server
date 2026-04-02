import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayjs } from '../../../lib/datetime.js';

vi.mock('../../../tools/get_candles.js', () => ({
	default: vi.fn(),
}));

import getCandles from '../../../tools/get_candles.js';
import { fetchCandlesForBacktest, getPeriodBars } from '../../../tools/trading_process/lib/fetch_candles.js';
import type { Timeframe } from '../../../tools/trading_process/types.js';

afterEach(() => {
	vi.resetAllMocks();
});

describe('getPeriodBars', () => {
	it('1D / 1M は 30 を返す', () => {
		expect(getPeriodBars('1D', '1M')).toBe(30);
	});

	it('1D / 3M は 90 を返す', () => {
		expect(getPeriodBars('1D', '3M')).toBe(90);
	});

	it('1D / 6M は 180 を返す', () => {
		expect(getPeriodBars('1D', '6M')).toBe(180);
	});

	it('4H / 1M は 180 を返す', () => {
		expect(getPeriodBars('4H', '1M')).toBe(180);
	});

	it('4H / 3M は 540 を返す', () => {
		expect(getPeriodBars('4H', '3M')).toBe(540);
	});

	it('1H / 6M は 4320 を返す', () => {
		expect(getPeriodBars('1H', '6M')).toBe(4320);
	});

	it('1H / 1M は 720 を返す', () => {
		expect(getPeriodBars('1H', '1M')).toBe(720);
	});
});

function makeNormalized(n: number, startDate = '2024-01-01') {
	const base = dayjs(startDate);
	return Array.from({ length: n }, (_, i) => ({
		isoTime: base.add(i, 'day').format('YYYY-MM-DD'),
		open: 100,
		high: 101,
		low: 99,
		close: 100,
		volume: 1000,
	}));
}

describe('fetchCandlesForBacktest', () => {
	it('正常取得: 有効なローソク足を返す', async () => {
		vi.mocked(getCandles).mockResolvedValue({
			ok: true,
			summary: 'ok',
			data: { normalized: makeNormalized(100) },
		} as never);
		const result = await fetchCandlesForBacktest('btc_jpy', '1D', '1M', 10);
		// neededBars = 30 + 10 + 10 = 50; 100 > 50 → slice last 50
		expect(result).toHaveLength(50);
		expect(result[0].close).toBe(100);
	});

	it('未対応 timeframe/period → エラー', async () => {
		await expect(fetchCandlesForBacktest('btc_jpy', '5M' as Timeframe, '1M', 50)).rejects.toThrow(
			'Unsupported timeframe/period',
		);
	});

	it('API 失敗 → エラー', async () => {
		vi.mocked(getCandles).mockResolvedValue({
			ok: false,
			summary: 'API error',
		} as never);
		await expect(fetchCandlesForBacktest('btc_jpy', '1D', '1M', 10)).rejects.toThrow('Failed to fetch candles');
	});

	it('空データ → エラー', async () => {
		vi.mocked(getCandles).mockResolvedValue({
			ok: true,
			summary: 'ok',
			data: { normalized: [] },
		} as never);
		await expect(fetchCandlesForBacktest('btc_jpy', '1D', '1M', 10)).rejects.toThrow('No candle data returned');
	});

	it('有効ローソク 0 件 → エラー', async () => {
		// All candles have empty isoTime → all filtered out
		vi.mocked(getCandles).mockResolvedValue({
			ok: true,
			summary: 'ok',
			data: {
				normalized: [
					{ isoTime: '', open: 100, high: 101, low: 99, close: 100, volume: 1000 },
					{ isoTime: null, open: 100, high: 101, low: 99, close: 100, volume: 1000 },
				],
			},
		} as never);
		await expect(fetchCandlesForBacktest('btc_jpy', '1D', '1M', 10)).rejects.toThrow(
			'No valid candle data after filtering',
		);
	});

	it('データ不足で全件返却', async () => {
		// neededBars = 30 + 5 + 10 = 45; return only 20 candles → all 20 returned
		vi.mocked(getCandles).mockResolvedValue({
			ok: true,
			summary: 'ok',
			data: { normalized: makeNormalized(20) },
		} as never);
		const result = await fetchCandlesForBacktest('btc_jpy', '1D', '1M', 5);
		expect(result).toHaveLength(20);
	});

	it('重複排除: 同一 time のローソク足が 1 本に絞られる', async () => {
		vi.mocked(getCandles).mockResolvedValue({
			ok: true,
			summary: 'ok',
			data: {
				normalized: [
					{ isoTime: '2024-01-01', open: 100, high: 101, low: 99, close: 100, volume: 1000 },
					{ isoTime: '2024-01-01', open: 110, high: 111, low: 109, close: 110, volume: 2000 },
					{ isoTime: '2024-01-02', open: 105, high: 106, low: 104, close: 105, volume: 500 },
				],
			},
		} as never);
		const result = await fetchCandlesForBacktest('btc_jpy', '4H', '1M', 5);
		const jan1 = result.filter((c) => c.time === '2024-01-01');
		expect(jan1).toHaveLength(1);
	});

	it('isValidCandle: NaN OHLC は除外される', async () => {
		vi.mocked(getCandles).mockResolvedValue({
			ok: true,
			summary: 'ok',
			data: {
				normalized: [
					{ isoTime: '2024-01-01', open: Number.NaN, high: 101, low: 99, close: 100, volume: 1000 },
					{ isoTime: '2024-01-02', open: 100, high: 101, low: 99, close: 100, volume: 1000 },
				],
			},
		} as never);
		const result = await fetchCandlesForBacktest('btc_jpy', '4H', '1M', 5);
		// Only the valid candle passes
		expect(result.every((c) => !Number.isNaN(c.open))).toBe(true);
	});

	it('isValidCandle: price <= 0 は除外される', async () => {
		vi.mocked(getCandles).mockResolvedValue({
			ok: true,
			summary: 'ok',
			data: {
				normalized: [
					{ isoTime: '2024-01-01', open: -10, high: 101, low: 99, close: 100, volume: 1000 },
					{ isoTime: '2024-01-02', open: 100, high: 101, low: 99, close: 100, volume: 1000 },
				],
			},
		} as never);
		const result = await fetchCandlesForBacktest('btc_jpy', '4H', '1M', 5);
		expect(result.every((c) => c.open > 0)).toBe(true);
	});

	it('結果は time で昇順ソートされている', async () => {
		// Provide candles in reverse order
		vi.mocked(getCandles).mockResolvedValue({
			ok: true,
			summary: 'ok',
			data: {
				normalized: [
					{ isoTime: '2024-01-03', open: 100, high: 101, low: 99, close: 100, volume: 1000 },
					{ isoTime: '2024-01-01', open: 100, high: 101, low: 99, close: 100, volume: 1000 },
					{ isoTime: '2024-01-02', open: 100, high: 101, low: 99, close: 100, volume: 1000 },
				],
			},
		} as never);
		const result = await fetchCandlesForBacktest('btc_jpy', '4H', '1M', 5);
		expect(result[0].time).toBe('2024-01-01');
		expect(result[1].time).toBe('2024-01-02');
		expect(result[2].time).toBe('2024-01-03');
	});
});
