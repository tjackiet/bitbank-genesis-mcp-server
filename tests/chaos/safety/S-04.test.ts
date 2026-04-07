/**
 * Chaos S-04: トークンの有効期限（60秒）を 1ms 超過して実行
 * 仮説: 期限切れエラーで拒否される
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateToken, validateToken } from '../../../src/private/confirmation.js';
import createOrder from '../../../tools/private/create_order.js';

beforeEach(() => {
	process.env.BITBANK_API_SECRET = 'chaos_test_secret';
	process.env.BITBANK_API_KEY = 'chaos_test_key';
});

afterEach(() => {
	delete process.env.BITBANK_API_SECRET;
	delete process.env.BITBANK_API_KEY;
	delete process.env.ORDER_CONFIRM_TTL_MS;
	vi.restoreAllMocks();
});

describe('Chaos: S-04 — トークン有効期限 1ms 超過', () => {
	/** 仮説: 期限切れエラーで拒否される */

	it('有効期限ちょうど（expiresAt と同一時刻）は通過する', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit' };
		const { token, expiresAt } = generateToken('create_order', params, now);

		const error = validateToken(token, 'create_order', params, expiresAt, expiresAt);
		expect(error).toBeNull();
	});

	it('有効期限を 1ms 超過すると拒否される', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit' };
		const { token, expiresAt } = generateToken('create_order', params, now);

		const error = validateToken(token, 'create_order', params, expiresAt, expiresAt + 1);
		expect(error).not.toBeNull();
		expect(error).toContain('有効期限');
	});

	it('create_order ハンドラで期限切れトークンが confirmation_required になる', async () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '5000000' };
		const { token, expiresAt } = generateToken('create_order', params, now);

		// Date.now を期限超過時刻に固定
		vi.spyOn(Date, 'now').mockReturnValue(expiresAt + 1);

		const result = await createOrder({
			pair: 'btc_jpy',
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
			expect(result.summary).toContain('有効期限');
		}
	});

	it('TTL カスタマイズ（1秒）でも期限切れが検出される', () => {
		process.env.ORDER_CONFIRM_TTL_MS = '1000'; // 1秒
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001' };
		const { token, expiresAt } = generateToken('create_order', params, now);

		expect(expiresAt).toBe(now + 1000);

		// 1001ms 後 → 期限切れ
		const error = validateToken(token, 'create_order', params, expiresAt, now + 1001);
		expect(error).toContain('有効期限');
	});

	it('API に到達しない（fetch が呼ばれない）', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '5000000' };
		const { token, expiresAt } = generateToken('create_order', params, now);

		vi.spyOn(Date, 'now').mockReturnValue(expiresAt + 1);

		await createOrder({
			...params,
			confirmation_token: token,
			token_expires_at: expiresAt,
		});

		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
