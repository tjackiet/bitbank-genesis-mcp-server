/**
 * Chaos S-07: market 注文に price を指定
 * 仮説: パラメータ矛盾エラーで拒否される
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import previewOrder from '../../../tools/private/preview_order.js';

beforeEach(() => {
	process.env.BITBANK_API_SECRET = 'chaos_test_secret';
	process.env.BITBANK_API_KEY = 'chaos_test_key';
});

afterEach(() => {
	delete process.env.BITBANK_API_SECRET;
	delete process.env.BITBANK_API_KEY;
});

describe('Chaos: S-07 — market 注文に price を指定', () => {
	/** 仮説: パラメータ矛盾エラーで拒否される */

	it('market 注文に price を指定すると拒否される', async () => {
		const result = await previewOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			price: '5000000',
			side: 'buy',
			type: 'market',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('validation_error');
			expect(result.summary).toContain('market');
			expect(result.summary).toContain('price');
		}
	});

	it('market 注文に trigger_price を指定すると拒否される', async () => {
		const result = await previewOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			trigger_price: '5000000',
			side: 'buy',
			type: 'market',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('validation_error');
			expect(result.summary).toContain('market');
		}
	});

	it('market 注文に price + trigger_price 両方を指定しても拒否される', async () => {
		const result = await previewOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			price: '5000000',
			trigger_price: '4500000',
			side: 'sell',
			type: 'market',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('validation_error');
		}
	});

	it('正常系: market 注文に price なしは通過する', async () => {
		const result = await previewOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'buy',
			type: 'market',
		});

		expect(result.ok).toBe(true);
	});
});
