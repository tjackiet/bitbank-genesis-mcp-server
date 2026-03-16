import { afterEach, describe, expect, it, vi } from 'vitest';
import { asMockResult, assertOk } from './_assertResult.js';

vi.mock('../tools/analyze_indicators.js', () => ({
	default: vi.fn(),
}));

import analyzeIndicators from '../tools/analyze_indicators.js';
import detectPatterns from '../tools/detect_patterns.js';

type Candle = {
	isoTime: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
};

function makeIso(dayOffset: number, year = 2026) {
	return new Date(Date.UTC(year, 0, 1 + dayOffset, 0, 0, 0)).toISOString();
}

function makeCandle(dayOffset: number, close: number, year = 2026): Candle {
	return {
		isoTime: makeIso(dayOffset, year),
		open: close,
		high: close + 3,
		low: close - 3,
		close,
		volume: 100,
	};
}

function indicatorsOk(candles: Candle[]) {
	return {
		ok: true,
		summary: 'ok',
		data: {
			chart: {
				candles,
			},
		},
	};
}

function buildCompletedDoubleTopCandles(year = 2026): Candle[] {
	const closes = [
		100, 102, 105, 110, 118, 130, 126, 122, 118, 114, 112, 110, 114, 118, 122, 126, 128, 129, 123, 116, 104, 100, 95,
		100, 99, 98,
	];

	return closes.map((close, index) => makeCandle(index, close, year));
}

function buildFormingDoubleBottomCandles(year = 2026): Candle[] {
	const closes = [108, 104, 99, 92, 80, 84, 88, 92, 96, 99, 101, 98, 94, 89, 85, 82, 81, 84, 88, 91, 94, 95, 96, 95];

	return closes.map((close, index) => makeCandle(index, close, year));
}

function buildDescendingTriangleInvalidBreakoutCandles(year = 2026): Candle[] {
	const closes = [
		120, 130, 124, 116, 100, 112, 125, 118, 101, 110, 120, 114, 100, 108, 115, 110, 101, 107, 128, 132, 130, 128, 126,
		124,
	];

	return closes.map((close, index) => makeCandle(index, close, year));
}

function buildRectangleRangeCandles(year = 2026): Candle[] {
	const closes = [
		105, 110, 104, 109, 101, 108, 102, 110, 101, 109, 100, 108, 102, 109, 101, 110, 100, 109, 101, 108, 102, 109, 101,
		110,
	];

	return closes.map((close, index) => makeCandle(index, close, year));
}

function buildRisingChannelCandles(year = 2026): Candle[] {
	const closes = [
		100, 108, 104, 112, 108, 116, 112, 120, 116, 124, 120, 128, 124, 132, 128, 136, 132, 140, 136, 144, 140, 148, 144,
		152, 148, 156, 152, 160, 156, 164,
	];

	return closes.map((close, index) => makeCandle(index, close, year));
}

function buildBullFlagFailureCandles(year = 2026): Candle[] {
	const closes = [100, 108, 116, 124, 132, 140, 136, 138, 134, 136, 132, 134, 130, 132, 128, 130, 120, 118, 116, 114];

	return closes.map((close, index) => makeCandle(index, close, year));
}

function buildBullPennantSuccessCandles(year = 2026): Candle[] {
	const closes = [
		100, 110, 122, 136, 150, 165, 158, 162, 154, 160, 155, 159, 156, 158, 157, 157.8, 157.2, 158.1, 157.4, 170, 172,
		174,
	];

	return closes.map((close, index) => makeCandle(index, close, year));
}

function buildBullPennantFailureCandles(year = 2026): Candle[] {
	const closes = [
		100, 110, 122, 136, 150, 165, 158, 162, 154, 160, 155, 159, 156, 158, 157, 157.8, 157.2, 158.1, 157.4, 148, 146,
		144,
	];

	return closes.map((close, index) => makeCandle(index, close, year));
}

describe('detect_patterns fixtures', () => {
	const mockedAnalyzeIndicators = vi.mocked(analyzeIndicators);

	afterEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	it('synthetic fixture から completed の double_top を検出できる', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(asMockResult(indicatorsOk(buildCompletedDoubleTopCandles())));

		const res = await detectPatterns('btc_jpy', '1day', 26, {
			patterns: ['double_top'],
			swingDepth: 2,
			tolerancePct: 0.02,
			includeCompleted: true,
			includeForming: false,
		});
		assertOk(res);
		expect(res.data.patterns).toHaveLength(1);
		expect(res.data.patterns[0]).toMatchObject({
			type: 'double_top',
			timeframe: '1day',
			timeframeLabel: '日足',
			trendlineLabel: 'ネックライン',
			breakoutBarIndex: 20,
			targetMethod: 'neckline_projection',
			aftermath: {
				breakoutConfirmed: true,
			},
		});
		expect(res.data.overlays.ranges).toEqual([
			{
				start: makeIso(5),
				end: makeIso(20),
				label: 'double_top',
			},
		]);
		expect(res.meta.count).toBe(1);
	});

	it('synthetic fixture から forming の double_bottom を completed なしで返せる', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(asMockResult(indicatorsOk(buildFormingDoubleBottomCandles())));

		const res = await detectPatterns('btc_jpy', '1day', 24, {
			patterns: ['double_bottom'],
			swingDepth: 2,
			tolerancePct: 0.03,
			includeForming: true,
			includeCompleted: false,
		});

		assertOk(res);
		expect(res.data.patterns).toHaveLength(1);
		expect(res.data.patterns[0]).toMatchObject({
			type: 'double_bottom',
			status: 'forming',
			timeframe: '1day',
			timeframeLabel: '日足',
			trendlineLabel: 'ネックライン',
			completionPct: expect.any(Number),
			targetMethod: 'neckline_projection',
		});
		expect(res.data.patterns[0].range.end).toBe(makeIso(23));
		expect(res.meta.count).toBe(1);
	});

	it('requireCurrentInPattern=true のとき古い fixture は除外される', async () => {
		vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
		mockedAnalyzeIndicators.mockResolvedValueOnce(asMockResult(indicatorsOk(buildCompletedDoubleTopCandles(2025))));

		const res = await detectPatterns('btc_jpy', '1day', 26, {
			patterns: ['double_top'],
			swingDepth: 2,
			tolerancePct: 0.02,
			requireCurrentInPattern: true,
			currentRelevanceDays: 7,
		});

		assertOk(res);
		expect(res.data.patterns).toEqual([]);
		expect(res.data.overlays.ranges).toEqual([]);
		expect(res.meta.count).toBe(0);
	});

	it('descending triangle の逆方向ブレイクは invalid / failure として保持できる', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(
			asMockResult(indicatorsOk(buildDescendingTriangleInvalidBreakoutCandles())),
		);

		const res = await detectPatterns('btc_jpy', '1day', 24, {
			patterns: ['triangle_descending'],
			includeCompleted: true,
			includeInvalid: true,
		});

		assertOk(res);
		expect(res.data.patterns.length).toBeGreaterThan(0);
		expect(res.data.patterns).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'triangle_descending',
					status: 'invalid',
					breakoutDirection: 'up',
					outcome: 'failure',
					timeframe: '1day',
					timeframeLabel: '日足',
				}),
			]),
		);
	});

	it('includeInvalid=false のとき invalid な triangle は結果から除外される', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(
			asMockResult(indicatorsOk(buildDescendingTriangleInvalidBreakoutCandles())),
		);

		const res = await detectPatterns('btc_jpy', '1day', 24, {
			patterns: ['triangle_descending'],
			includeCompleted: true,
			includeInvalid: false,
		});

		assertOk(res);
		expect(res.data.patterns).toEqual([]);
	});

	it('矩形レンジの fixture を triangle として誤検出しない', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(asMockResult(indicatorsOk(buildRectangleRangeCandles())));

		const res = await detectPatterns('btc_jpy', '1day', 24, {
			patterns: ['triangle'],
			includeForming: true,
			includeCompleted: true,
			includeInvalid: true,
		});

		assertOk(res);
		expect(res.data.patterns).toEqual([]);
	});

	it('平行な上昇チャネルの fixture を wedge として誤検出しない', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(asMockResult(indicatorsOk(buildRisingChannelCandles())));

		const res = await detectPatterns('btc_jpy', '1day', 30, {
			patterns: ['rising_wedge', 'falling_wedge'],
			includeForming: true,
			includeCompleted: true,
			includeInvalid: true,
		});

		assertOk(res);
		expect(res.data.patterns).toEqual([]);
	});

	it('bull flag の逆方向ブレイクは invalid / failure として保持できる', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(asMockResult(indicatorsOk(buildBullFlagFailureCandles())));

		const res = await detectPatterns('btc_jpy', '1day', 20, {
			patterns: ['flag'],
			includeCompleted: true,
			includeInvalid: true,
		});

		assertOk(res);
		expect(res.data.patterns).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'flag',
					status: 'invalid',
					breakoutDirection: 'down',
					outcome: 'failure',
					timeframe: '1day',
					timeframeLabel: '日足',
					targetMethod: 'flagpole_projection',
				}),
			]),
		);
	});

	it('bull pennant の順方向ブレイクは success として保持できる', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(asMockResult(indicatorsOk(buildBullPennantSuccessCandles())));

		const res = await detectPatterns('btc_jpy', '1day', 22, {
			patterns: ['pennant'],
			includeCompleted: true,
			includeInvalid: true,
		});

		assertOk(res);
		expect(res.data.patterns).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'pennant',
					status: 'completed',
					poleDirection: 'up',
					breakoutDirection: 'up',
					outcome: 'success',
					isTrendContinuation: true,
					timeframe: '1day',
					timeframeLabel: '日足',
					targetMethod: 'flagpole_projection',
				}),
			]),
		);
	});

	it('bull pennant の逆方向ブレイクは failure として保持できる', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(asMockResult(indicatorsOk(buildBullPennantFailureCandles())));

		const res = await detectPatterns('btc_jpy', '1day', 22, {
			patterns: ['pennant'],
			includeCompleted: true,
			includeInvalid: true,
		});

		assertOk(res);
		expect(res.data.patterns).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'pennant',
					poleDirection: 'up',
					breakoutDirection: 'down',
					outcome: 'failure',
					isTrendContinuation: false,
					timeframe: '1day',
					timeframeLabel: '日足',
					targetMethod: 'flagpole_projection',
				}),
			]),
		);
	});
});
