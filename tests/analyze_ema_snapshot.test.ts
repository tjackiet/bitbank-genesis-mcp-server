import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertOk } from './_assertResult.js';

vi.mock('../tools/analyze_indicators.js', () => ({
	default: vi.fn(),
}));

vi.mock('../tools/get_candles.js', () => ({
	default: vi.fn(),
}));

import analyzeEmaSnapshot, { toolDef } from '../tools/analyze_ema_snapshot.js';
import analyzeIndicators from '../tools/analyze_indicators.js';

function makeSeries(start: number, step: number, len: number) {
	return Array.from({ length: len }, (_, i) => Number((start + step * i).toFixed(4)));
}

function buildIndicatorsOk() {
	const len = 40;
	return {
		ok: true as const,
		summary: 'ok',
		data: {
			normalized: Array.from({ length: len }, (_, i) => ({
				close: i === len - 1 ? 150 : 130,
				isoTime: `2024-02-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
			})),
			indicators: {
				EMA_12: 140,
				EMA_26: 130,
				EMA_50: 120,
				EMA_200: 110,
			},
			chart: {
				candles: Array.from({ length: len }, (_, i) => ({
					isoTime: `2024-02-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
				})),
				indicators: {
					EMA_12: makeSeries(134, 0.2, len),
					EMA_26: makeSeries(125, 0.15, len),
					EMA_50: makeSeries(116, 0.1, len),
					EMA_200: makeSeries(106, 0.05, len),
				},
			},
		},
		meta: { pair: 'btc_jpy', type: '1day', count: len },
	};
}

describe('analyze_ema_snapshot', () => {
	const mockedAnalyzeIndicators = vi.mocked(analyzeIndicators);

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('inputSchema: limit は 200 以上のみ許可する', () => {
		const parse = () => (toolDef.inputSchema as any).parse({ pair: 'btc_jpy', type: '1day', limit: 199 });
		expect(parse).toThrow();
	});

	it('analyze_indicators が失敗を返した場合は ok: false を返す', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce({
			ok: false,
			summary: 'indicators failed',
			data: {},
			meta: { errorType: 'upstream' },
		} as any);

		const res = await analyzeEmaSnapshot('btc_jpy', '1day', 220, [12, 26, 50, 200]);
		expect(res.ok).toBe(false);
		expect(res.meta.errorType).toBe('upstream');
	});

	it('指定periodsのEMAが欠損している場合 alignment は unknown であるべき', async () => {
		const mocked = buildIndicatorsOk() as any;
		mocked.data.indicators.EMA_200 = null;
		mockedAnalyzeIndicators.mockResolvedValueOnce(mocked);

		const res = await analyzeEmaSnapshot('btc_jpy', '1day', 220, [12, 26, 50, 200]);

		assertOk(res);
		expect(res.data.ema.EMA_200).toBeNull();
		expect(res.data.alignment).toBe('unknown');
	});

	it('重複periods指定時は自己クロス（EMA_12/EMA_12）や重複クロスを出さないべき', async () => {
		mockedAnalyzeIndicators.mockResolvedValueOnce(buildIndicatorsOk() as any);

		const res = await analyzeEmaSnapshot('btc_jpy', '1day', 220, [12, 12, 26]);

		assertOk(res);
		const pairLabels = res.data.crosses.map((c) => `${c.a}/${c.b}`);
		expect(pairLabels).not.toContain('EMA_12/EMA_12');
		expect(new Set(pairLabels).size).toBe(pairLabels.length);
	});
});
