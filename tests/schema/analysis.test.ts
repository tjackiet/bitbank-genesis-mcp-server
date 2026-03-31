import { describe, expect, it } from 'vitest';
import { GetVolMetricsInputSchema } from '../../src/schema/analysis.js';

describe('GetVolMetricsInputSchema', () => {
	it('有効な入力を受け入れる', () => {
		const result = GetVolMetricsInputSchema.parse({ pair: 'btc_jpy', type: '1day' });
		expect(result.pair).toBe('btc_jpy');
		expect(result.limit).toBe(200);
		expect(result.windows).toEqual([14, 20, 30]);
		expect(result.useLogReturns).toBe(true);
		expect(result.annualize).toBe(true);
		expect(result.view).toBe('summary');
	});

	it('カスタム windows を受け入れる', () => {
		const result = GetVolMetricsInputSchema.parse({
			pair: 'eth_jpy',
			type: '4hour',
			windows: [7, 14, 28],
		});
		expect(result.windows).toEqual([7, 14, 28]);
	});

	it('limit 範囲外を拒否する', () => {
		expect(() => GetVolMetricsInputSchema.parse({ pair: 'btc_jpy', type: '1day', limit: 19 })).toThrow();
		expect(() => GetVolMetricsInputSchema.parse({ pair: 'btc_jpy', type: '1day', limit: 501 })).toThrow();
	});

	it('view の全モードを受け入れる', () => {
		for (const v of ['summary', 'detailed', 'full', 'beginner']) {
			const result = GetVolMetricsInputSchema.parse({ pair: 'btc_jpy', type: '1day', view: v });
			expect(result.view).toBe(v);
		}
	});
});
