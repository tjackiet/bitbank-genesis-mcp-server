/**
 * Chaos S-02: preview_order のトークンで cancel_order を呼び出し（action 不一致）
 * 仮説: トークン検証が失敗する
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateToken } from '../../../src/private/confirmation.js';
import cancelOrder from '../../../tools/private/cancel_order.js';

beforeEach(() => {
	process.env.BITBANK_API_SECRET = 'chaos_test_secret';
	process.env.BITBANK_API_KEY = 'chaos_test_key';
});

afterEach(() => {
	delete process.env.BITBANK_API_SECRET;
	delete process.env.BITBANK_API_KEY;
	vi.restoreAllMocks();
});

describe('Chaos: S-02 — preview_order のトークンで cancel_order を呼び出し', () => {
	/** 仮説: action 不一致でトークン検証が失敗する */

	it('create_order 用トークンで cancel_order が拒否される', async () => {
		const now = Date.now();
		// create_order 用のトークンを生成
		const { token, expiresAt } = generateToken(
			'create_order',
			{ pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit' },
			now,
		);

		const result = await cancelOrder({
			pair: 'btc_jpy',
			order_id: 12345,
			confirmation_token: token,
			token_expires_at: expiresAt,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('confirmation_required');
			expect(result.summary).toContain('無効');
		}
	});

	it('cancel_orders 用トークンで cancel_order（単一）が拒否される', async () => {
		const now = Date.now();
		const { token, expiresAt } = generateToken('cancel_orders', { pair: 'btc_jpy', order_ids: [12345] }, now);

		const result = await cancelOrder({
			pair: 'btc_jpy',
			order_id: 12345,
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
		const { token, expiresAt } = generateToken('create_order', { pair: 'btc_jpy' }, now);

		await cancelOrder({
			pair: 'btc_jpy',
			order_id: 999,
			confirmation_token: token,
			token_expires_at: expiresAt,
		});

		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
