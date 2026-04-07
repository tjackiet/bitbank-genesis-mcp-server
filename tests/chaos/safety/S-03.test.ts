/**
 * Chaos S-03: トークン生成後にパラメータを改ざん（amount を変更）
 * 仮説: HMAC 不一致で拒否される
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateToken } from '../../../src/private/confirmation.js';
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

describe('Chaos: S-03 — トークン生成後にパラメータ改ざん', () => {
	/** 仮説: HMAC 不一致で拒否される */

	it('amount を改ざん（0.001 → 100）すると拒否される', async () => {
		const now = Date.now();
		const originalParams = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '5000000' };
		const { token, expiresAt } = generateToken('create_order', originalParams, now);

		const result = await createOrder({
			pair: 'btc_jpy',
			amount: '100', // 改ざん: 0.001 → 100
			price: '5000000',
			side: 'buy',
			type: 'limit',
			confirmation_token: token,
			token_expires_at: expiresAt,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('confirmation_required');
			expect(result.summary).toContain('無効');
		}
	});

	it('price を改ざんすると拒否される', async () => {
		const now = Date.now();
		const originalParams = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '5000000' };
		const { token, expiresAt } = generateToken('create_order', originalParams, now);

		const result = await createOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			price: '1', // 改ざん: 5000000 → 1
			side: 'buy',
			type: 'limit',
			confirmation_token: token,
			token_expires_at: expiresAt,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('confirmation_required');
		}
	});

	it('pair を改ざんすると拒否される', async () => {
		const now = Date.now();
		const originalParams = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '5000000' };
		const { token, expiresAt } = generateToken('create_order', originalParams, now);

		const result = await createOrder({
			pair: 'eth_jpy', // 改ざん: btc_jpy → eth_jpy
			amount: '0.001',
			price: '5000000',
			side: 'buy',
			type: 'limit',
			confirmation_token: token,
			token_expires_at: expiresAt,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('confirmation_required');
		}
	});

	it('side を改ざん（buy → sell）すると拒否される', async () => {
		const now = Date.now();
		const originalParams = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '5000000' };
		const { token, expiresAt } = generateToken('create_order', originalParams, now);

		const result = await createOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			price: '5000000',
			side: 'sell', // 改ざん: buy → sell
			type: 'limit',
			confirmation_token: token,
			token_expires_at: expiresAt,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('confirmation_required');
		}
	});

	it('API に到達しない（fetch が呼ばれない）', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		const now = Date.now();
		const { token, expiresAt } = generateToken(
			'create_order',
			{ pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit' },
			now,
		);

		await createOrder({
			pair: 'btc_jpy',
			amount: '999', // 改ざん
			side: 'buy',
			type: 'limit',
			confirmation_token: token,
			token_expires_at: expiresAt,
		});

		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
