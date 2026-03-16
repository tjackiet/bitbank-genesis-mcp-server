import { afterEach, describe, expect, it, vi } from 'vitest';
import { asMockResult, assertOk } from './_assertResult.js';

vi.mock('../tools/analyze_fibonacci.js', () => ({
	default: vi.fn(),
}));

import analyzeFibonacci from '../tools/analyze_fibonacci.js';
import analyzeMtfFibonacci, { toolDef } from '../tools/analyze_mtf_fibonacci.js';

type FibLevel = {
	ratio: number;
	price: number;
	distancePct: number;
	isNearest: boolean;
};

function fibOk(days: number, currentPrice: number, levels: FibLevel[]) {
	return {
		ok: true,
		summary: `${days}d ok`,
		data: {
			pair: 'btc_jpy',
			currentPrice,
			trend: 'up',
			swingHigh: { price: 120, date: '2026-01-10' },
			swingLow: { price: 80, date: '2026-01-01' },
			levels,
		},
		meta: { lookbackDays: days },
	};
}

describe('analyze_mtf_fibonacci', () => {
	const mockedAnalyzeFibonacci = vi.mocked(analyzeFibonacci);

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('inputSchema: lookbackDays は 1 件以上のみ許可するべき', () => {
		const parse = () => toolDef.inputSchema.parse({ pair: 'btc_jpy', lookbackDays: [] });
		expect(parse).toThrow();
	});

	it('3期間の近接した水準は strong confluence として集約されるべき', async () => {
		mockedAnalyzeFibonacci
			.mockResolvedValueOnce(
				asMockResult(fibOk(30, 100, [{ ratio: 0.382, price: 100.4, distancePct: 0.4, isNearest: true }])),
			)
			.mockResolvedValueOnce(
				asMockResult(fibOk(90, 100, [{ ratio: 0.5, price: 100.8, distancePct: 0.8, isNearest: true }])),
			)
			.mockResolvedValueOnce(
				asMockResult(fibOk(180, 100, [{ ratio: 0.618, price: 101.1, distancePct: 1.1, isNearest: true }])),
			);

		const res = await analyzeMtfFibonacci('btc_jpy', [30, 90, 180]);

		assertOk(res);
		expect(res.data.confluence).toHaveLength(1);
		expect(res.data.confluence[0].strength).toBe('strong');
		expect(res.data.confluence[0].priceZone).toEqual([100, 101]);
	});

	it('重複 lookbackDays 指定時は analyze_fibonacci を重複実行しないべき', async () => {
		mockedAnalyzeFibonacci.mockResolvedValue(
			asMockResult(fibOk(30, 100, [{ ratio: 0.5, price: 100, distancePct: 0, isNearest: true }])),
		);

		const res = await analyzeMtfFibonacci('btc_jpy', [30, 30, 90]);

		assertOk(res);
		expect(mockedAnalyzeFibonacci).toHaveBeenCalledTimes(2);
	});
});
