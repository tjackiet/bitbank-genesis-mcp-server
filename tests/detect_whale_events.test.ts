import { afterEach, describe, expect, it, vi } from 'vitest';
import { asMockResult, assertOk } from './_assertResult.js';

vi.mock('../lib/get-depth.js', () => ({
	default: vi.fn(),
}));

vi.mock('../tools/get_candles.js', () => ({
	default: vi.fn(),
}));

import getDepth from '../lib/get-depth.js';
import detectWhaleEvents, { toolDef } from '../tools/detect_whale_events.js';
import getCandles from '../tools/get_candles.js';

function depthOk(overrides: Record<string, unknown> = {}) {
	return {
		ok: true,
		summary: 'depth ok',
		data: {
			asks: [
				[101, 0.8],
				[102, 1.2],
			],
			bids: [
				[99, 1.1],
				[98, 0.9],
			],
			...overrides,
		},
		meta: {},
	};
}

function candlesOk(normalized: Array<Record<string, unknown>>) {
	return {
		ok: true,
		summary: 'candles ok',
		data: {
			normalized,
		},
		meta: {},
	};
}

describe('detect_whale_events', () => {
	const mockedGetDepth = vi.mocked(getDepth);
	const mockedGetCandles = vi.mocked(getCandles);

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('inputSchema: lookback は定義済み enum のみ許可する', () => {
		const parse = () => toolDef.inputSchema.parse({ pair: 'btc_jpy', lookback: '3hour' });
		expect(parse).toThrow();
	});

	it('上流で asks/bids が欠損している場合は fail を返すべき', async () => {
		mockedGetDepth.mockResolvedValueOnce(
			asMockResult({
				ok: true,
				summary: 'depth ok',
				data: {},
				meta: {},
			}),
		);
		mockedGetCandles.mockResolvedValueOnce(asMockResult(candlesOk([{ close: 100 }, { close: 105 }])));

		const res = await detectWhaleEvents('btc_jpy', '1hour', 0.51);

		expect(res.ok).toBe(false);
		expect(res.meta?.errorType).toBe('upstream');
	});

	it('ローソク足の close が欠損していても summary に NaN を出すべきではない', async () => {
		mockedGetDepth.mockResolvedValueOnce(asMockResult(depthOk()));
		mockedGetCandles.mockResolvedValueOnce(asMockResult(candlesOk([{}, { close: 105 }])));

		const res = await detectWhaleEvents('btc_jpy', '1hour', 0.52);

		assertOk(res);
		expect(res.summary).not.toContain('NaN');
	});
});
