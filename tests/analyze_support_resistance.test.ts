import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertOk } from './_assertResult.js';

vi.mock('../tools/get_candles.js', () => ({
	default: vi.fn(),
}));

import analyzeSupportResistance, { toolDef } from '../tools/analyze_support_resistance.js';
import getCandles from '../tools/get_candles.js';

type Candle = {
	isoTime: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
};

function makeIso(dayOffset: number) {
	return new Date(Date.UTC(2026, 0, 1 + dayOffset, 0, 0, 0)).toISOString();
}

function makeCandle(dayOffset: number, open: number, high: number, low: number, close: number, volume = 100): Candle {
	return {
		isoTime: makeIso(dayOffset),
		open,
		high,
		low,
		close,
		volume,
	};
}

function candlesOk(normalized: Candle[]) {
	return {
		ok: true,
		summary: 'ok',
		data: { normalized },
		meta: { count: normalized.length },
	};
}

function buildFlatCandles(count: number, pairBase = 100): Candle[] {
	return Array.from({ length: count }, (_, i) => makeCandle(i, pairBase, pairBase + 1, pairBase - 1, pairBase, 100));
}

function buildBufferedHistoryCandles(): Candle[] {
	const oldBuffer = [
		makeCandle(0, 96, 101, 95, 98),
		makeCandle(1, 95, 100, 94, 97),
		makeCandle(2, 94, 99, 93, 96),
		makeCandle(3, 93, 98, 92, 95),
		makeCandle(4, 92, 97, 91, 94),
		makeCandle(5, 91, 96, 89.5, 95),
		makeCandle(6, 92, 97, 91, 95),
		makeCandle(7, 93, 98, 92, 96),
		makeCandle(8, 92, 97, 90.2, 95),
		makeCandle(9, 94, 99, 93, 97),
	];

	const recentWindow = Array.from({ length: 30 }, (_, i) => makeCandle(10 + i, 100, 101, 99, 100, 100));

	return [...oldBuffer, ...recentWindow];
}

describe('analyze_support_resistance', () => {
	const mockedGetCandles = vi.mocked(getCandles);

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('inputSchema: lookbackDays は 30 以上のみ許可する', () => {
		const parse = () => toolDef.inputSchema.parse({ pair: 'btc_jpy', lookbackDays: 29 });
		expect(parse).toThrow();
	});

	it('content の見出しは入力 pair を使うべき', async () => {
		mockedGetCandles.mockResolvedValueOnce(candlesOk(buildFlatCandles(20)) as any);

		const res = await analyzeSupportResistance('eth_jpy', { lookbackDays: 30, topN: 3, tolerance: 0.015 });

		assertOk(res);
		expect(res.content?.[0]?.text).toContain('ETH/JPY サポート・レジスタンス分析');
	});

	it('lookbackDays 外の取得バッファにだけ存在する水準を結果へ混ぜないべき', async () => {
		mockedGetCandles.mockResolvedValueOnce(candlesOk(buildBufferedHistoryCandles()) as any);

		const res = await analyzeSupportResistance('btc_jpy', { lookbackDays: 30, topN: 3, tolerance: 0.015 });

		assertOk(res);
		expect(res.data.supports).toHaveLength(0);
		expect(res.meta?.supportCount).toBe(0);
	});
});
