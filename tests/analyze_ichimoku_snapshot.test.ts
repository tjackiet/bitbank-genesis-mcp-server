import { afterEach, describe, expect, it, vi } from 'vitest';
import { asMockResult, assertOk } from './_assertResult.js';

vi.mock('../tools/analyze_indicators.js', () => ({
	default: vi.fn(),
}));

import analyzeIchimokuSnapshot, { toolDef } from '../tools/analyze_ichimoku_snapshot.js';
import analyzeIndicators from '../tools/analyze_indicators.js';

function buildMockIndicatorSuccess() {
	const normalized = Array.from({ length: 40 }, (_, i) => ({
		close: i === 39 ? 80 : 120 - i,
	}));

	const spanA = Array.from({ length: 40 }, (_, i) => (i < 14 ? 130 : 100));
	const spanB = Array.from({ length: 40 }, (_, i) => (i < 14 ? 135 : 110));
	spanA[38] = 62;
	spanA[39] = 60;
	spanB[38] = 67;
	spanB[39] = 65;

	return {
		ok: true as const,
		summary: 'ok',
		data: {
			normalized,
			indicators: {
				ICHIMOKU_conversion: 90,
				ICHIMOKU_base: 95,
				ICHIMOKU_spanA: 60,
				ICHIMOKU_spanB: 65,
				ichi_series: {
					tenkan: Array.from({ length: 40 }, () => 90),
					kijun: Array.from({ length: 40 }, () => 95),
					spanA,
					spanB,
					chikou: Array.from({ length: 40 }, () => 70),
				},
			},
		},
		meta: { pair: 'btc_jpy', type: '1day', count: 40 },
	};
}

describe('analyze_ichimoku_snapshot', () => {
	const mockedAnalyzeIndicators = vi.mocked(analyzeIndicators);

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('inputSchema: lookback は 2 以上のみ許可する', () => {
		const parse = () => toolDef.inputSchema.parse({ pair: 'btc_jpy', type: '1day', limit: 120, lookback: 1 });
		expect(parse).toThrow();
	});

	it('analyze_indicators が失敗を返した場合は ok: false を返す', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(
			asMockResult({
				ok: false,
				summary: 'indicators failed',
				data: {},
				meta: { errorType: 'upstream' },
			}),
		);

		const res = await analyzeIchimokuSnapshot('btc_jpy', '1day', 120, 10);
		expect(res.ok).toBe(false);
		expect(res.meta.errorType).toBe('upstream');
	});

	it('toolDef.handler は lookback を analyzeIchimokuSnapshot に伝搬するべき', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(asMockResult(buildMockIndicatorSuccess()));

		const res = await toolDef.handler({
			pair: 'btc_jpy',
			type: '1day',
			limit: 120,
			lookback: 3,
		});

		assertOk(res);
		expect(res.data.trend.cloudHistory).toHaveLength(3);
	});

	it('強い弱気条件（雲下 + 転換線<基準線 + 雲下降）では overallSignal は strong_bearish であるべき', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(asMockResult(buildMockIndicatorSuccess()));

		const res = await analyzeIchimokuSnapshot('btc_jpy', '1day', 120, 10);

		assertOk(res);
		expect(res.data.assessment.pricePosition).toBe('below_cloud');
		expect(res.data.assessment.tenkanKijun).toBe('bearish');
		expect(res.data.assessment.cloudSlope).toBe('falling');
		expect(res.data.signals.overallSignal).toBe('strong_bearish');
	});

	it('遅行スパンは spanB の有無に依存せず ichi_series.chikou から取得されるべき', async () => {
		const base = asMockResult<Record<string, unknown>>(buildMockIndicatorSuccess());
		base.data.indicators.ICHIMOKU_spanB = null;
		base.data.indicators.ichi_series.chikou[39] = 777;
		mockedAnalyzeIndicators.mockResolvedValueOnce(base);

		const res = await analyzeIchimokuSnapshot('btc_jpy', '1day', 120, 10);
		assertOk(res);
		expect(res.data.latest.chikou).toBe(777);
	});

	it('cloudHistory は lookback とローソク足本数の小さい方まで含めるべき（off-by-one しない）', async () => {
		const short = asMockResult<Record<string, unknown>>(buildMockIndicatorSuccess());
		short.data.normalized = [{ close: 100 }, { close: 101 }];
		short.data.indicators.ichi_series.spanA = Array.from({ length: 40 }, () => 90);
		short.data.indicators.ichi_series.spanB = Array.from({ length: 40 }, () => 80);
		mockedAnalyzeIndicators.mockResolvedValueOnce(short);

		const res = await analyzeIchimokuSnapshot('btc_jpy', '1day', 120, 2);
		assertOk(res);
		expect(res.data.trend.cloudHistory).toHaveLength(2);
		expect(res.data.trend.cloudHistory[0].barsAgo).toBe(0);
		expect(res.data.trend.cloudHistory[1].barsAgo).toBe(1);
	});

	it('雲データ不足時の cloud.direction は null（unknown を flat にしない）であるべき', async () => {
		const noCloudSeries = asMockResult<Record<string, unknown>>(buildMockIndicatorSuccess());
		noCloudSeries.data.indicators.ichi_series = {
			tenkan: Array.from({ length: 40 }, () => 90),
			kijun: Array.from({ length: 40 }, () => 95),
			spanA: [],
			spanB: [],
			chikou: Array.from({ length: 40 }, () => 70),
		};
		noCloudSeries.data.indicators.ICHIMOKU_spanA = null;
		noCloudSeries.data.indicators.ICHIMOKU_spanB = null;
		mockedAnalyzeIndicators.mockResolvedValueOnce(noCloudSeries);

		const res = await analyzeIchimokuSnapshot('btc_jpy', '1day', 120, 10);
		assertOk(res);
		expect(res.data.assessment.cloudSlope).toBe('unknown');
		expect(res.data.cloud.direction).toBeNull();
	});
});
