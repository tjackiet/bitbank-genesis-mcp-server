/**
 * Chaos S-06: amount に負の値・0・文字列・Infinity を指定
 * 仮説: 全てバリデーションで拒否される
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

describe('Chaos: S-06 — amount に不正な値を指定', () => {
	/** 仮説: 全てバリデーションで拒否される */

	const baseArgs = {
		pair: 'btc_jpy',
		price: '5000000',
		side: 'buy' as const,
		type: 'limit' as const,
	};

	it('amount に負の値（-1）を指定すると拒否される', async () => {
		const result = await previewOrder({ ...baseArgs, amount: '-1' });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('validation_error');
		}
	});

	it('amount に 0 を指定すると拒否される', async () => {
		const result = await previewOrder({ ...baseArgs, amount: '0' });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('validation_error');
		}
	});

	it('amount に文字列（abc）を指定すると拒否される', async () => {
		const result = await previewOrder({ ...baseArgs, amount: 'abc' });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('validation_error');
		}
	});

	it('amount に Infinity を指定すると拒否される', async () => {
		const result = await previewOrder({ ...baseArgs, amount: 'Infinity' });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('validation_error');
		}
	});

	it('amount に NaN を指定すると拒否される', async () => {
		const result = await previewOrder({ ...baseArgs, amount: 'NaN' });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('validation_error');
		}
	});

	it('amount に空文字を指定すると拒否される', async () => {
		const result = await previewOrder({ ...baseArgs, amount: '' });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('validation_error');
		}
	});

	it('正常系: amount に正の数値文字列は通過する', async () => {
		const result = await previewOrder({ ...baseArgs, amount: '0.001' });
		expect(result.ok).toBe(true);
	});
});
