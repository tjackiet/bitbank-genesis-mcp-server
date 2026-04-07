/**
 * Chaos S-09: 同一トークンで create_order を2回実行（リプレイ攻撃）
 * 仮説: トークン自体は HMAC ベースなので同じパラメータなら2回目も検証を通過する。
 *       リプレイ防止は bitbank API 側（冪等性 or 重複検知）に依存する設計であることを確認。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateToken, validateToken } from '../../../src/private/confirmation.js';

beforeEach(() => {
	process.env.BITBANK_API_SECRET = 'chaos_test_secret';
	process.env.BITBANK_API_KEY = 'chaos_test_key';
});

afterEach(() => {
	delete process.env.BITBANK_API_SECRET;
	delete process.env.BITBANK_API_KEY;
	vi.restoreAllMocks();
});

describe('Chaos: S-09 — 同一トークンで create_order を2回実行（リプレイ攻撃）', () => {
	/** 仮説: トークン検証自体は通過する（HMAC は同一パラメータで決定的）。
	 *  リプレイ防止は bitbank API 側の挙動に依存する設計。 */

	it('同一トークンで validateToken を2回呼び出し: 両方とも検証を通過する', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '5000000' };
		const { token, expiresAt } = generateToken('create_order', params, now);

		// 1回目の検証
		const error1 = validateToken(token, 'create_order', params, expiresAt, now + 1000);
		expect(error1).toBeNull();

		// 2回目の検証（同一トークン・同一パラメータ）
		const error2 = validateToken(token, 'create_order', params, expiresAt, now + 2000);
		expect(error2).toBeNull();

		// 3回目（59秒後、まだ有効期限内）
		const error3 = validateToken(token, 'create_order', params, expiresAt, now + 59_000);
		expect(error3).toBeNull();
	});

	it('トークンはワンタイムではない（HMACベースの設計上の特性）', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit' };
		const { token, expiresAt } = generateToken('create_order', params, now);

		// 有効期限内なら何度でも検証を通過する
		for (let i = 0; i < 10; i++) {
			const error = validateToken(token, 'create_order', params, expiresAt, now + i * 1000);
			expect(error).toBeNull();
		}
	});

	it('期限切れ後のリプレイは拒否される', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '5000000' };
		const { token, expiresAt } = generateToken('create_order', params, now);

		// 有効期限内は成功
		const error1 = validateToken(token, 'create_order', params, expiresAt, expiresAt);
		expect(error1).toBeNull();

		// 有効期限後は拒否
		const error2 = validateToken(token, 'create_order', params, expiresAt, expiresAt + 1);
		expect(error2).toContain('有効期限');
	});

	it('cancel_order トークンも同様にリプレイ可能（有効期限内）', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', order_id: 12345 };
		const { token, expiresAt } = generateToken('cancel_order', params, now);

		const error1 = validateToken(token, 'cancel_order', params, expiresAt, now + 1000);
		expect(error1).toBeNull();

		const error2 = validateToken(token, 'cancel_order', params, expiresAt, now + 30_000);
		expect(error2).toBeNull();
	});

	it('TTL を短くすることでリプレイ窓を狭められる', () => {
		process.env.ORDER_CONFIRM_TTL_MS = '5000'; // 5秒
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit' };
		const { token, expiresAt } = generateToken('create_order', params, now);

		expect(expiresAt).toBe(now + 5000);

		// 5秒以内はリプレイ可能
		const error1 = validateToken(token, 'create_order', params, expiresAt, now + 4999);
		expect(error1).toBeNull();

		// 5秒超過でリプレイ不可
		const error2 = validateToken(token, 'create_order', params, expiresAt, now + 5001);
		expect(error2).toContain('有効期限');
	});
});
