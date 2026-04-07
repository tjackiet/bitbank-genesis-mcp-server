/**
 * Chaos S-01: confirmation_token なしで create_order を直接呼び出し
 * 仮説: `confirmation_required` エラーで拒否される
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import createOrder from '../../../tools/private/create_order.js';

beforeEach(() => {
	process.env.BITBANK_API_SECRET = 'chaos_test_secret';
	process.env.BITBANK_API_KEY = 'chaos_test_key';
});

afterEach(() => {
	delete process.env.BITBANK_API_SECRET;
	delete process.env.BITBANK_API_KEY;
	vi.restoreAllMocks();
});

describe('Chaos: S-01 — confirmation_token なしで create_order を直接呼び出し', () => {
	/** 仮説: 不正なトークンで confirmation_required エラーが返る */

	it('空文字トークンで拒否される', async () => {
		const result = await createOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			price: '5000000',
			side: 'buy',
			type: 'limit',
			confirmation_token: '',
			token_expires_at: Date.now() + 60_000,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('confirmation_required');
		}
	});

	it('でたらめなトークンで拒否される', async () => {
		const result = await createOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			price: '5000000',
			side: 'buy',
			type: 'limit',
			confirmation_token: 'not_a_valid_token_at_all',
			token_expires_at: Date.now() + 60_000,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('confirmation_required');
			expect(result.summary).toContain('無効');
		}
	});

	it('API に到達しない（fetch が呼ばれない）', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		await createOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			price: '5000000',
			side: 'buy',
			type: 'limit',
			confirmation_token: 'fake_token',
			token_expires_at: Date.now() + 60_000,
		});

		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
