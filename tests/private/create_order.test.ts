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

describe('create_order — エラーコード別ハンドリング', () => {
	it('残高不足エラー（60001）に適切なメッセージ', async () => {
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '14000000' };
		const { confirmation_token, token_expires_at } = validToken(params);

		setupFetchMockSequence([{ body: { success: 0, data: { code: 60001 } }, status: 400 }]);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			...params,
			side: params.side as 'buy' | 'sell',
			type: params.type as 'limit',
			confirmation_token,
			token_expires_at,
		});

		assertFail(result);
		expect(result.summary).toContain('残高が不足');
	});

	it('数量下限エラー（60003）に適切なメッセージ', async () => {
		const params = { pair: 'btc_jpy', amount: '0.00000001', side: 'buy', type: 'limit', price: '14000000' };
		const { confirmation_token, token_expires_at } = validToken(params);

		setupFetchMockSequence([{ body: { success: 0, data: { code: 60003 } }, status: 400 }]);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			...params,
			side: params.side as 'buy' | 'sell',
			type: params.type as 'limit',
			confirmation_token,
			token_expires_at,
		});

		assertFail(result);
		expect(result.summary).toContain('最小数量');
	});

	it('同時注文上限エラー（60011）に適切なメッセージ', async () => {
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '14000000' };
		const { confirmation_token, token_expires_at } = validToken(params);

		setupFetchMockSequence([{ body: { success: 0, data: { code: 60011 } }, status: 400 }]);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			...params,
			side: params.side as 'buy' | 'sell',
			type: params.type as 'limit',
			confirmation_token,
			token_expires_at,
		});

		assertFail(result);
		expect(result.summary).toContain('上限（30件）');
	});

	it('成行注文制限（70009）に適切なメッセージ', async () => {
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'market' };
		const { confirmation_token, token_expires_at } = validToken(params);

		setupFetchMockSequence([{ body: { success: 0, data: { code: 70009 } }, status: 400 }]);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			...params,
			side: params.side as 'buy' | 'sell',
			type: params.type as 'market',
			confirmation_token,
			token_expires_at,
		});

		assertFail(result);
		expect(result.summary).toContain('成行注文が制限');
	});

	it('非 PrivateApiError の例外で upstream_error を返す', async () => {
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '14000000' };
		const { confirmation_token, token_expires_at } = validToken(params);

		globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Network failure')) as unknown as typeof fetch;

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			...params,
			side: params.side as 'buy' | 'sell',
			type: params.type as 'limit',
			confirmation_token,
			token_expires_at,
		});

		assertFail(result);
		expect(result.meta.errorType).toBe('upstream_error');
		expect(result.summary).toContain('Network failure');
	});

	it('価格上限超過エラー（60006）に適切なメッセージ', async () => {
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '999999999' };
		const { confirmation_token, token_expires_at } = validToken(params);

		setupFetchMockSequence([{ body: { success: 0, data: { code: 60006 } }, status: 400 }]);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			...params,
			side: params.side as 'buy' | 'sell',
			type: params.type as 'limit',
			confirmation_token,
			token_expires_at,
		});

		assertFail(result);
		expect(result.summary).toContain('上限を超えています');
	});
});

describe('create_order — 非 PrivateApiError の generic catch', () => {
	afterEach(() => {
		vi.doUnmock('../../src/private/client.js');
	});

	it('非 PrivateApiError が投げられると upstream_error を返す', async () => {
		vi.doMock('../../src/private/client.js', () => ({
			getDefaultClient: () => ({
				post: () => {
					throw new Error('unexpected crash');
				},
			}),
			PrivateApiError: class extends Error {
				errorType: string;
				constructor(msg: string, errorType: string) {
					super(msg);
					this.errorType = errorType;
				}
			},
		}));

		const { generateToken } = await import('../../src/private/confirmation.js');
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '14000000' };
		const { token, expiresAt } = generateToken('create_order', params);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			...params,
			side: params.side as 'buy' | 'sell',
			type: params.type as 'limit',
			confirmation_token: token,
			token_expires_at: expiresAt,
		});

		assertFail(result);
		expect(result.meta.errorType).toBe('upstream_error');
		expect(result.summary).toContain('unexpected crash');
	});
});

describe('create_order — handler (toolDef)', () => {
	it('handler が失敗時に result をそのまま返す', async () => {
		const { toolDef } = await import('../../tools/private/create_order.js');
		const result = await toolDef.handler({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'buy',
			type: 'limit',
			price: '14000000',
			confirmation_token: 'invalid',
			token_expires_at: Date.now() + 60000,
		});

		expect((result as { ok: boolean }).ok).toBe(false);
	});

	it('handler が成功時に content + structuredContent を返す', async () => {
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '14000000' };
		const { confirmation_token, token_expires_at } = validToken(params);

		setupFetchMockSequence([{ body: orderSuccessResponse({ side: 'buy', type: 'limit', price: '14000000' }) }]);

		const { toolDef } = await import('../../tools/private/create_order.js');
		const result = await toolDef.handler({
			...params,
			confirmation_token,
			token_expires_at,
		});

		expect(result).toHaveProperty('content');
		expect(result).toHaveProperty('structuredContent');
	});
});

describe('create_order — stop_limit / post_only / trigger_price', () => {
	it('stop_limit 注文で trigger_price がサマリーに含まれる', async () => {
		const params = {
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'buy',
			type: 'stop_limit',
			price: '14500000',
			trigger_price: '14000000',
		};
		const { confirmation_token, token_expires_at } = validToken(params);

		setupFetchMockSequence([
			{
				body: orderSuccessResponse({
					side: 'buy',
					type: 'stop_limit',
					price: '14500000',
					trigger_price: '14000000',
				}),
			},
		]);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			...params,
			side: params.side as 'buy' | 'sell',
			type: params.type as 'stop_limit',
			confirmation_token,
			token_expires_at,
		});

		assertOk(result);
		expect(result.summary).toContain('トリガー価格');
	});

	it('post_only 有効時にサマリーに Post Only が含まれる', async () => {
		const params = { pair: 'btc_jpy', amount: '0.001', side: 'buy', type: 'limit', price: '14000000', post_only: true };
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
		expect(result.summary).toContain('Post Only');
	});
});
