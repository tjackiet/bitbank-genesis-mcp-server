import { afterEach, describe, expect, it, vi } from 'vitest';
import { asMockResult, assertOk } from './_assertResult.js';

vi.mock('../tools/get_flow_metrics.js', () => ({
	default: vi.fn(),
}));

vi.mock('../tools/get_volatility_metrics.js', () => ({
	default: vi.fn(),
}));

vi.mock('../tools/analyze_indicators.js', () => ({
	default: vi.fn(),
}));

import { toolDef } from '../src/handlers/analyzeMarketSignalHandler.js';
import analyzeIndicators from '../tools/analyze_indicators.js';
import analyzeMarketSignal from '../tools/analyze_market_signal.js';
import getFlowMetrics from '../tools/get_flow_metrics.js';
import getVolatilityMetrics from '../tools/get_volatility_metrics.js';

function flowOk(aggressorRatio: number, cvdValues: number[]) {
	return {
		ok: true,
		summary: 'ok',
		data: {
			aggregates: { aggressorRatio },
			series: {
				buckets: cvdValues.map((cvd) => ({ cvd })),
			},
		},
		meta: {},
	};
}

function volOk(rvStdAnn: number) {
	return {
		ok: true,
		summary: 'ok',
		data: {
			aggregates: { rv_std_ann: rvStdAnn },
		},
		meta: {},
	};
}

function makeCloses(count: number, close: number) {
	return Array.from({ length: count }, (_, idx) => ({
		close,
		isoTime: `2024-01-${String((idx % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
	}));
}

function indicatorsOk(params: {
	close: number;
	rsi: number;
	sma25: number;
	sma75: number;
	sma200: number;
	normalizedCount?: number;
	trend?:
		| 'strong_uptrend'
		| 'uptrend'
		| 'strong_downtrend'
		| 'downtrend'
		| 'overbought'
		| 'oversold'
		| 'sideways'
		| 'insufficient_data';
}) {
	const { close, rsi, sma25, sma75, sma200, normalizedCount = 220, trend = 'sideways' } = params;
	return {
		ok: true,
		summary: 'ok',
		data: {
			indicators: {
				RSI_14: rsi,
				SMA_25: sma25,
				SMA_75: sma75,
				SMA_200: sma200,
			},
			normalized: makeCloses(normalizedCount, close),
			trend,
		},
		meta: {},
	};
}

describe('analyze_market_signal', () => {
	const mockedGetFlowMetrics = vi.mocked(getFlowMetrics);
	const mockedGetVolatilityMetrics = vi.mocked(getVolatilityMetrics);
	const mockedAnalyzeIndicators = vi.mocked(analyzeIndicators);

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('inputSchema: flowLimit は整数のみ許可する', () => {
		const parse = () => toolDef.inputSchema.parse({ pair: 'btc_jpy', flowLimit: 10.5 });
		expect(parse).toThrow();
	});

	it('中立シグナル時の nextActions は存在しない detect_forming_chart_patterns ではなく detect_patterns を案内すべき', async () => {
		mockedGetFlowMetrics.mockResolvedValueOnce(asMockResult(flowOk(0.5, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
		mockedGetVolatilityMetrics.mockResolvedValueOnce(asMockResult(volOk(0.5)));
		mockedAnalyzeIndicators.mockResolvedValueOnce(
			asMockResult(indicatorsOk({ close: 100, rsi: 50, sma25: 100, sma75: 100, sma200: 100 })),
		);

		const res = await analyzeMarketSignal('btc_jpy');
		assertOk(res);
		expect(res.data.nextActions.map((action) => action.tool)).toContain('detect_patterns');
	});

	it('主要要素が矛盾する低信頼ケースで nextActions に未登録の multiple_analysis を含めるべきではない', async () => {
		mockedGetFlowMetrics.mockResolvedValueOnce(asMockResult(flowOk(0.5, [0, 5, 10, 20, 30, 40, 50, 60, 80, 100])));
		mockedGetVolatilityMetrics.mockResolvedValueOnce(asMockResult(volOk(0)));
		mockedAnalyzeIndicators.mockResolvedValueOnce(
			asMockResult(indicatorsOk({ close: 120, rsi: 0, sma25: 110, sma75: 100, sma200: 100 })),
		);

		const res = await analyzeMarketSignal('btc_jpy');
		assertOk(res);
		expect(res.data.confidence).toBe('low');
		expect(res.data.nextActions.map((action) => action.tool)).not.toContain('multiple_analysis');
	});

	it('aggressorRatio が最大で板圧力が極端なときは get_orderbook を深掘り候補に含めるべき', async () => {
		mockedGetFlowMetrics.mockResolvedValueOnce(asMockResult(flowOk(1, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
		mockedGetVolatilityMetrics.mockResolvedValueOnce(asMockResult(volOk(0.5)));
		mockedAnalyzeIndicators.mockResolvedValueOnce(
			asMockResult(indicatorsOk({ close: 100, rsi: 50, sma25: 100, sma75: 100, sma200: 100 })),
		);

		const res = await analyzeMarketSignal('btc_jpy');
		assertOk(res);
		expect(res.data.metrics.buyPressure).toBe(1);
		expect(res.data.nextActions.map((action) => action.tool)).toContain('get_orderbook');
	});
});
