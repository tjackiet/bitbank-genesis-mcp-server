/**
 * create_order ツールのユニットテスト。
 * stop 注文のトリガー価格バリデーションは preview_order に移動したため、
 * ここでは確認トークンの検証と注文実行を検証する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateToken } from '../../src/private/confirmation.js';
import { assertFail, assertOk } from '../_assertResult.js';

const originalFetch = globalThis.fetch;

/** fetch モックのセットアップ（呼び出し順に複数レスポンスを返せる） */
function setupFetchMockSequence(responses: { body: unknown; status?: number }[]) {
	const mock = vi.fn();
	for (const { body, status = 200 } of responses) {
		mock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
	}
	globalThis.fetch = mock as unknown as typeof fetch;
	return mock;
}

/** 注文成功レスポンスを返すヘルパー */
function orderSuccessResponse(overrides: Record<string, unknown> = {}) {
	return {
		success: 1,
		data: {
			order_id: 12345,
			pair: 'btc_jpy',
			side: 'sell',
			type: 'stop',
			start_amount: '0.001',
			remaining_amount: '0.001',
			executed_amount: '0',
			average_price: '0',
			status: 'UNFILLED',
			ordered_at: 1710000000000,
			...overrides,
		},
	};
}

/** 有効な確認トークンを生成するヘルパー */
function validToken(params: Record<string, unknown>, nowMs = Date.now()) {
	const { token, expiresAt } = generateToken('create_order', params, nowMs);
	return { confirmation_token: token, token_expires_at: expiresAt, nowMs };
}

beforeEach(() => {
	process.env.BITBANK_API_KEY = 'test_key';
	process.env.BITBANK_API_SECRET = 'test_secret';
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	delete process.env.BITBANK_API_KEY;
	delete process.env.BITBANK_API_SECRET;
	vi.resetModules();
});

describe('create_order — 確認トークン検証', () => {
	it('有効なトークンで注文が成功する', async () => {
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '14000000' };
		const { confirmation_token, token_expires_at } = validToken(params);

		setupFetchMockSequence([{ body: orderSuccessResponse({ side: 'buy', type: 'limit', price: '14000000' }) }]);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			...params,
			side: params.side as 'buy' | 'sell',
			type: params.type as 'limit',
			confirmation_token,
			token_expires_at,
		});

		assertOk(result);
		expect(result.summary).toContain('注文発注完了');
	});

	it('トークンなし（不正トークン）で拒否される', async () => {
		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'buy',
			type: 'limit',
			price: '14000000',
			confirmation_token: 'invalid_token',
			token_expires_at: Date.now() + 60000,
		});

		assertFail(result);
		expect(result.meta.errorType).toBe('confirmation_required');
	});

	it('期限切れトークンで拒否される', async () => {
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '14000000' };
		const pastTime = Date.now() - 120_000;
		const { confirmation_token, token_expires_at } = validToken(params, pastTime);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			...params,
			side: params.side as 'buy' | 'sell',
			type: params.type as 'limit',
			confirmation_token,
			token_expires_at,
		});

		assertFail(result);
		expect(result.summary).toContain('有効期限');
	});

	it('パラメータ改ざん（amount 変更）で拒否される', async () => {
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '14000000' };
		const { confirmation_token, token_expires_at } = validToken(params);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			...params,
			amount: '999', // 改ざん
			side: params.side as 'buy' | 'sell',
			type: params.type as 'limit',
			confirmation_token,
			token_expires_at,
		});

		assertFail(result);
		expect(result.meta.errorType).toBe('confirmation_required');
	});

	it('market 注文も確認トークンで正常に動作する', async () => {
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'sell', type: 'market' };
		const { confirmation_token, token_expires_at } = validToken(params);

		setupFetchMockSequence([{ body: orderSuccessResponse({ side: 'sell', type: 'market' }) }]);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			...params,
			side: params.side as 'buy' | 'sell',
			type: params.type as 'market',
			confirmation_token,
			token_expires_at,
		});

		assertOk(result);
	});
});
