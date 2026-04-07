/**
 * Chaos S-08: post_only を market 注文で指定
 * 仮説: 「limit 注文でのみ有効」エラーで拒否される
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

describe('Chaos: S-08 — post_only を market 注文で指定', () => {
	/** 仮説: 「limit 注文でのみ有効」エラーで拒否される */

	it('market + post_only=true で拒否される', async () => {
		const result = await previewOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'buy',
			type: 'market',
			post_only: true,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('validation_error');
			expect(result.summary).toContain('post_only');
			expect(result.summary).toContain('limit');
		}
	});

	it('stop + post_only=true で拒否される', async () => {
		const result = await previewOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'sell',
			type: 'stop',
			trigger_price: '4000000',
			post_only: true,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('validation_error');
			expect(result.summary).toContain('post_only');
		}
	});

	it('stop_limit + post_only=true で拒否される', async () => {
		const result = await previewOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			price: '4500000',
			side: 'sell',
			type: 'stop_limit',
			trigger_price: '4000000',
			post_only: true,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('validation_error');
			expect(result.summary).toContain('post_only');
		}
	});

	it('正常系: limit + post_only=true は通過する', async () => {
		const result = await previewOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			price: '5000000',
			side: 'buy',
			type: 'limit',
			post_only: true,
		});

		expect(result.ok).toBe(true);
	});
});
