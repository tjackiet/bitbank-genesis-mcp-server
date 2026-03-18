import { afterEach, describe, expect, it, vi } from 'vitest';
import { asMockResult, assertOk } from './_assertResult.js';

vi.mock('../tools/analyze_indicators.js', () => ({
	default: vi.fn(),
}));

vi.mock('../lib/get-depth.js', () => ({
	default: vi.fn(),
}));

import { toolDef } from '../src/handlers/renderChartSvgHandler.js';
import analyzeIndicators from '../tools/analyze_indicators.js';
import renderChartSvg from '../tools/render_chart_svg.js';

function buildCandles(length: number) {
	return Array.from({ length }, (_, i) => {
		const base = 100 + i;
		const day = String((i % 28) + 1).padStart(2, '0');
		return {
			open: base,
			high: base + 5,
			low: base - 5,
			close: base + 2,
			volume: 10 + i,
			isoTime: `2024-01-${day}T00:00:00.000Z`,
		};
	});
}

function buildSeries(length: number, offset = 0): Array<number | null> {
	return Array.from({ length }, (_, i) => 100 + i + offset);
}

function buildAnalyzeIndicatorsSuccess(length: number) {
	return {
		ok: true as const,
		summary: 'ok',
		data: {
			chart: {
				candles: buildCandles(length),
				indicators: {
					SMA_5: buildSeries(length, -1),
					SMA_20: buildSeries(length, -2),
					SMA_25: buildSeries(length, -3),
					SMA_50: buildSeries(length, -4),
					SMA_75: buildSeries(length, -5),
					SMA_200: buildSeries(length, -6),
					EMA_12: buildSeries(length, -1),
					EMA_26: buildSeries(length, -2),
					EMA_50: buildSeries(length, -3),
					EMA_200: buildSeries(length, -4),
					BB_upper: buildSeries(length, 8),
					BB_middle: buildSeries(length, 2),
					BB_lower: buildSeries(length, -8),
					BB1_upper: buildSeries(length, 5),
					BB1_middle: buildSeries(length, 2),
					BB1_lower: buildSeries(length, -5),
					BB2_upper: buildSeries(length, 8),
					BB2_middle: buildSeries(length, 2),
					BB2_lower: buildSeries(length, -8),
					BB3_upper: buildSeries(length, 11),
					BB3_middle: buildSeries(length, 2),
					BB3_lower: buildSeries(length, -11),
					ICHI_tenkan: buildSeries(length, 1),
					ICHI_kijun: buildSeries(length, 0),
					ICHI_spanA: buildSeries(length, 6),
					ICHI_spanB: buildSeries(length, 4),
					ICHI_chikou: buildSeries(length, -2),
				},
				meta: {
					pastBuffer: 0,
					shift: 26,
				},
			},
		},
		meta: {
			pair: 'btc_jpy',
			type: '1day',
		},
	};
}

describe('render_chart_svg', () => {
	const mockedAnalyzeIndicators = vi.mocked(analyzeIndicators);

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('inputSchema: ICHIMOKU と BB の併用は拒否する', () => {
		// indicators 配列経由
		expect(() =>
			toolDef.inputSchema.parse({
				pair: 'btc_jpy',
				type: '1day',
				limit: 60,
				indicators: ['ICHIMOKU', 'BB'],
			}),
		).toThrow();

		// legacy with* 経由（後方互換）
		expect(() =>
			toolDef.inputSchema.parse({
				pair: 'btc_jpy',
				type: '1day',
				limit: 60,
				withIchimoku: true,
				withBB: true,
			}),
		).toThrow();
	});

	it('meta.indicators は indicators 配列で指定した SMA を含むべき', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(asMockResult(buildAnalyzeIndicatorsSuccess(60)));

		const res = await renderChartSvg({
			pair: 'btc_jpy',
			type: '1day',
			limit: 60,
			withLegend: false,
			indicators: ['SMA_25'],
		});

		assertOk(res);
		expect(res.meta.indicators).toContain('SMA_25');
	});

	it('legacy withSMA も引き続き動作する（後方互換）', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(asMockResult(buildAnalyzeIndicatorsSuccess(60)));

		const res = await renderChartSvg({
			pair: 'btc_jpy',
			type: '1day',
			limit: 60,
			withLegend: false,
			withSMA: [25],
		});

		assertOk(res);
		expect(res.meta.indicators).toContain('SMA_25');
	});

	it('candles-only fallback を宣言したら一目均衡表レイヤーは描画しないべき', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(asMockResult(buildAnalyzeIndicatorsSuccess(365)));

		const res = await renderChartSvg({
			pair: 'btc_jpy',
			type: '1day',
			limit: 365,
			indicators: ['ICHIMOKU_EXTENDED'],
		});

		assertOk(res);
		expect(res.summary).toContain('fallback to candles-only');
		expect(res.data.svg).not.toContain('stroke="#00a3ff"');
		expect(res.data.svg).not.toContain('stroke="#ff4d4d"');
		expect(res.data.svg).not.toContain('fill="rgba(16, 163, 74, 0.16)"');
	});
});
