/**
 * HITL 確認トークンのユニットテスト。
 * トークン生成・検証、有効期限、パラメータ改ざん検知を検証する。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateToken, validateToken } from '../../src/private/confirmation.js';

beforeEach(() => {
	process.env.BITBANK_API_SECRET = 'test_secret_for_hmac';
});

afterEach(() => {
	delete process.env.BITBANK_API_SECRET;
	delete process.env.ORDER_CONFIRM_TTL_MS;
});

describe('generateToken', () => {
	it('トークンと有効期限を返す', () => {
		const now = 1700000000000;
		const result = generateToken('create_order', { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit' }, now);

		expect(result.token).toMatch(/^[0-9a-f]{64}$/);
		expect(result.expiresAt).toBe(now + 60_000);
	});

	it('ORDER_CONFIRM_TTL_MS で有効期限を変更できる', () => {
		process.env.ORDER_CONFIRM_TTL_MS = '30000';
		const now = 1700000000000;
		const result = generateToken('create_order', { pair: 'btc_jpy' }, now);

		expect(result.expiresAt).toBe(now + 30_000);
	});

	it('同じパラメータで同じトークンを生成する（決定的）', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit' };
		const r1 = generateToken('create_order', params, now);
		const r2 = generateToken('create_order', params, now);

		expect(r1.token).toBe(r2.token);
	});

	it('異なるパラメータで異なるトークンを生成する', () => {
		const now = 1700000000000;
		const r1 = generateToken('create_order', { pair: 'btc_jpy', amount: '0.001' }, now);
		const r2 = generateToken('create_order', { pair: 'eth_jpy', amount: '0.001' }, now);

		expect(r1.token).not.toBe(r2.token);
	});
});

describe('validateToken', () => {
	it('正常系: 生成直後のトークンは検証を通過する', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit' };
		const { token, expiresAt } = generateToken('create_order', params, now);

		const error = validateToken(token, 'create_order', params, expiresAt, now + 1000);
		expect(error).toBeNull();
	});

	it('有効期限ギリギリ（ちょうど期限時刻）でも通過する', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001' };
		const { token, expiresAt } = generateToken('create_order', params, now);

		const error = validateToken(token, 'create_order', params, expiresAt, expiresAt);
		expect(error).toBeNull();
	});

	it('有効期限切れのトークンを拒否する', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001' };
		const { token, expiresAt } = generateToken('create_order', params, now);

		const error = validateToken(token, 'create_order', params, expiresAt, expiresAt + 1);
		expect(error).toContain('有効期限');
	});

	it('パラメータ改ざん（amount 変更）を検知する', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit' };
		const { token, expiresAt } = generateToken('create_order', params, now);

		// amount を改ざん
		const tampered = { ...params, amount: '100' };
		const error = validateToken(token, 'create_order', tampered, expiresAt, now + 1000);
		expect(error).toContain('無効');
	});

	it('パラメータ改ざん（pair 変更）を検知する', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001' };
		const { token, expiresAt } = generateToken('create_order', params, now);

		const tampered = { ...params, pair: 'eth_jpy' };
		const error = validateToken(token, 'create_order', tampered, expiresAt, now + 1000);
		expect(error).toContain('無効');
	});

	it('不正トークン（ランダム文字列）を拒否する', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', amount: '0.001' };
		const { expiresAt } = generateToken('create_order', params, now);

		const error = validateToken('deadbeef'.repeat(8), 'create_order', params, expiresAt, now + 1000);
		expect(error).toContain('無効');
	});

	it('異なる action でのトークン使い回しを拒否する', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', order_id: 123 };
		const { token, expiresAt } = generateToken('cancel_order', params, now);

		// cancel_order 用トークンを cancel_orders で使おうとする
		const error = validateToken(token, 'cancel_orders', params, expiresAt, now + 1000);
		expect(error).toContain('無効');
	});

	it('cancel_order の正常系', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', order_id: 12345 };
		const { token, expiresAt } = generateToken('cancel_order', params, now);

		const error = validateToken(token, 'cancel_order', params, expiresAt, now + 1000);
		expect(error).toBeNull();
	});

	it('cancel_orders の正常系', () => {
		const now = 1700000000000;
		const params = { pair: 'btc_jpy', order_ids: [1001, 1002, 1003] };
		const { token, expiresAt } = generateToken('cancel_orders', params, now);

		const error = validateToken(token, 'cancel_orders', params, expiresAt, now + 1000);
		expect(error).toBeNull();
	});
});
