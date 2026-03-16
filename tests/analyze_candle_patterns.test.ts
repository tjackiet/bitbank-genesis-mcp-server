import { afterEach, describe, expect, it, vi } from 'vitest';
import { asMockResult, assertOk } from './_assertResult.js';

vi.mock('../tools/get_candles.js', () => ({
	default: vi.fn(),
}));

import analyzeCandlePatterns, { toolDef } from '../tools/analyze_candle_patterns.js';
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

function buildUptrendThenDojiWindow(): Candle[] {
	return [
		makeCandle(0, 100, 112, 98, 110),
		makeCandle(1, 110, 122, 108, 120),
		makeCandle(2, 120, 132, 118, 130),
		makeCandle(3, 130, 135, 125, 130.2),
	];
}

function buildHistoryLeakCandles(): Candle[] {
	const dojiDays = new Set([20, 22, 24, 26, 28, 30]);

	return Array.from({ length: 40 }, (_, i) => {
		const base = 100 + i;

		if (dojiDays.has(i)) {
			return makeCandle(i, base, base + 5, base - 5, base + 0.2);
		}

		return makeCandle(i, base, base + 6, base - 4, base + 3);
	});
}

describe('analyze_candle_patterns', () => {
	const mockedGetCandles = vi.mocked(getCandles);

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('inputSchema: focus_last_n は 2 以上のみ許可する', () => {
		const parse = () => toolDef.inputSchema.parse({ focus_last_n: 1 });
		expect(parse).toThrow();
	});

	it('上昇トレンド直後の doji は bearish と判定されるべき', async () => {
		mockedGetCandles.mockResolvedValueOnce(asMockResult(candlesOk(buildUptrendThenDojiWindow())));

		const res = await analyzeCandlePatterns({
			as_of: '2026-01-04',
			window_days: 4,
			focus_last_n: 4,
			patterns: ['doji'],
			history_lookback_days: 30,
		});

		assertOk(res);
		expect(res.data.recent_patterns).toHaveLength(1);
		expect(res.data.recent_patterns[0].pattern).toBe('doji');
		expect(res.data.recent_patterns[0].local_context.trend_before).toBe('up');
		expect(res.data.recent_patterns[0].direction).toBe('bearish');
	});

	it('as_of 指定時の history_stats は指定日より未来のローソク足を含めるべきではない', async () => {
		mockedGetCandles.mockResolvedValueOnce(asMockResult(candlesOk(buildHistoryLeakCandles())));

		const res = await analyzeCandlePatterns({
			as_of: '2026-01-21',
			window_days: 5,
			focus_last_n: 5,
			patterns: ['doji'],
			history_lookback_days: 30,
		});

		assertOk(res);
		expect(res.data.window.to).toBe('2026-01-21');
		expect(res.data.recent_patterns).toHaveLength(1);
		expect(res.data.recent_patterns[0].pattern).toBe('doji');
		expect(res.data.recent_patterns[0].history_stats).toBeNull();
	});
});
