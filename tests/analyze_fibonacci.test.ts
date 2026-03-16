import { afterEach, describe, expect, it, vi } from 'vitest';
import { asMockResult, assertOk } from './_assertResult.js';

vi.mock('../tools/get_candles.js', () => ({
	default: vi.fn(),
}));

import analyzeFibonacci, { toolDef } from '../tools/analyze_fibonacci.js';
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

function buildUptrendCandles(): Candle[] {
	return [
		makeCandle(0, 105, 110, 100, 105),
		makeCandle(1, 106, 112, 103, 110),
		makeCandle(2, 111, 120, 108, 118),
		makeCandle(3, 118, 130, 115, 126),
		makeCandle(4, 126, 142, 124, 138),
		makeCandle(5, 138, 155, 136, 150),
		makeCandle(6, 150, 170, 148, 165),
		makeCandle(7, 165, 182, 160, 178),
		makeCandle(8, 178, 200, 175, 195),
		makeCandle(9, 195, 198, 188, 192),
	];
}

function buildDowntrendCandles(): Candle[] {
	return [
		makeCandle(0, 195, 200, 188, 194),
		makeCandle(1, 194, 196, 180, 186),
		makeCandle(2, 186, 188, 170, 176),
		makeCandle(3, 176, 178, 160, 166),
		makeCandle(4, 166, 168, 150, 156),
		makeCandle(5, 156, 158, 140, 146),
		makeCandle(6, 146, 148, 130, 136),
		makeCandle(7, 136, 138, 120, 126),
		makeCandle(8, 126, 128, 100, 110),
		makeCandle(9, 110, 112, 102, 105),
	];
}

describe('analyze_fibonacci', () => {
	const mockedGetCandles = vi.mocked(getCandles);

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('inputSchema: lookbackDays は 14 以上のみ許可する', () => {
		const parse = () => toolDef.inputSchema.parse({ pair: 'btc_jpy', lookbackDays: 13 });
		expect(parse).toThrow();
	});

	it('上昇トレンドの extension は swingHigh を上抜く価格になるべき', async () => {
		mockedGetCandles.mockResolvedValueOnce(asMockResult(candlesOk(buildUptrendCandles())));

		const res = await analyzeFibonacci({
			pair: 'btc_jpy',
			mode: 'extension',
			lookbackDays: 14,
		});

		assertOk(res);
		expect(res.data.trend).toBe('up');
		expect(res.data.swingLow.price).toBe(100);
		expect(res.data.swingHigh.price).toBe(200);
		expect(res.data.extensions[0].ratio).toBe(1.272);
		expect(res.data.extensions[0].price).toBe(227);
	});

	it('下降トレンドの extension は swingLow を下抜く価格になるべき', async () => {
		mockedGetCandles.mockResolvedValueOnce(asMockResult(candlesOk(buildDowntrendCandles())));

		const res = await analyzeFibonacci({
			pair: 'btc_jpy',
			mode: 'extension',
			lookbackDays: 14,
		});

		assertOk(res);
		expect(res.data.trend).toBe('down');
		expect(res.data.swingHigh.price).toBe(200);
		expect(res.data.swingLow.price).toBe(100);
		expect(res.data.extensions[0].ratio).toBe(1.272);
		expect(res.data.extensions[0].price).toBe(73);
	});
});
