/**
 * cancel_order ツールのユニットテスト。
 * 確認トークン検証 + 単一注文のキャンセル成功・エラーハンドリングを検証する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateToken } from '../../src/private/confirmation.js';
import { assertFail, assertOk } from '../_assertResult.js';
import { mockBitbankError, mockBitbankSuccess } from '../fixtures/private-api.js';

const originalFetch = globalThis.fetch;

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

function setupFetchMock(response: unknown, status = 200) {
	globalThis.fetch = vi
		.fn()
		.mockResolvedValue(new Response(JSON.stringify(response), { status })) as unknown as typeof fetch;
}

/** キャンセル済み注文レスポンス */
function canceledOrderResponse(overrides: Record<string, unknown> = {}) {
	return {
		order_id: 2001,
		pair: 'btc_jpy',
		side: 'buy',
		type: 'limit',
		start_amount: '0.01',
		remaining_amount: '0.01',
		executed_amount: '0',
		price: '14000000',
		average_price: '0',
		status: 'CANCELED_UNFILLED',
		ordered_at: 1710000000000,
		canceled_at: 1710001000000,
		...overrides,
	};
}

/** 有効な確認トークンを生成するヘルパー */
function validToken(params: { pair: string; order_id: number }) {
	const { token, expiresAt } = generateToken('cancel_order', params);
	return { confirmation_token: token, token_expires_at: expiresAt };
}

describe('cancel_order', () => {
	it('有効なトークンでキャンセル成功時に注文情報を返す', async () => {
		setupFetchMock(mockBitbankSuccess(canceledOrderResponse()));
		const { confirmation_token, token_expires_at } = validToken({ pair: 'btc_jpy', order_id: 2001 });

		const { default: cancelOrder } = await import('../../tools/private/cancel_order.js');
		const result = await cancelOrder({ pair: 'btc_jpy', order_id: 2001, confirmation_token, token_expires_at });

		assertOk(result);
		expect(result.summary).toContain('注文キャンセル完了');
		expect(result.summary).toContain('BTC/JPY');
		expect(result.summary).toContain('2001');
		expect(result.data.order.status).toBe('CANCELED_UNFILLED');
	});

	it('不正トークンで拒否される', async () => {
		const { default: cancelOrder } = await import('../../tools/private/cancel_order.js');
		const result = await cancelOrder({
			pair: 'btc_jpy',
			order_id: 2001,
			confirmation_token: 'invalid',
			token_expires_at: Date.now() + 60000,
		});

		assertFail(result);
		expect(result.meta.errorType).toBe('confirmation_required');
	});

	it('部分約定済みの注文キャンセル時に約定済み数量を表示', async () => {
		setupFetchMock(
			mockBitbankSuccess(
				canceledOrderResponse({
					executed_amount: '0.005',
					remaining_amount: '0.005',
					status: 'CANCELED_PARTIALLY_FILLED',
				}),
			),
		);
		const { confirmation_token, token_expires_at } = validToken({ pair: 'btc_jpy', order_id: 2001 });

		const { default: cancelOrder } = await import('../../tools/private/cancel_order.js');
		const result = await cancelOrder({ pair: 'btc_jpy', order_id: 2001, confirmation_token, token_expires_at });

		assertOk(result);
		expect(result.summary).toContain('約定済み数量: 0.005');
	});

	it('売注文のキャンセルで「売」ラベルが表示される', async () => {
		setupFetchMock(mockBitbankSuccess(canceledOrderResponse({ side: 'sell', pair: 'eth_jpy' })));
		const { confirmation_token, token_expires_at } = validToken({ pair: 'eth_jpy', order_id: 2001 });

		const { default: cancelOrder } = await import('../../tools/private/cancel_order.js');
		const result = await cancelOrder({ pair: 'eth_jpy', order_id: 2001, confirmation_token, token_expires_at });

		assertOk(result);
		expect(result.summary).toContain('売');
	});

	it('注文が見つからない場合（50009）に適切なエラーメッセージ', async () => {
		setupFetchMock(mockBitbankError(50009), 400);
		const { confirmation_token, token_expires_at } = validToken({ pair: 'btc_jpy', order_id: 99999 });

		const { default: cancelOrder } = await import('../../tools/private/cancel_order.js');
		const result = await cancelOrder({ pair: 'btc_jpy', order_id: 99999, confirmation_token, token_expires_at });

		assertFail(result);
		expect(result.summary).toContain('見つかりません');
	});

	it('既にキャンセル済み（50026）に適切なエラーメッセージ', async () => {
		setupFetchMock(mockBitbankError(50026), 400);
		const { confirmation_token, token_expires_at } = validToken({ pair: 'btc_jpy', order_id: 2001 });

		const { default: cancelOrder } = await import('../../tools/private/cancel_order.js');
		const result = await cancelOrder({ pair: 'btc_jpy', order_id: 2001, confirmation_token, token_expires_at });

		assertFail(result);
		expect(result.summary).toContain('キャンセル済み');
	});

	it('既に約定済み（50027）に適切なエラーメッセージ', async () => {
		setupFetchMock(mockBitbankError(50027), 400);
		const { confirmation_token, token_expires_at } = validToken({ pair: 'btc_jpy', order_id: 2001 });

		const { default: cancelOrder } = await import('../../tools/private/cancel_order.js');
		const result = await cancelOrder({ pair: 'btc_jpy', order_id: 2001, confirmation_token, token_expires_at });

		assertFail(result);
		expect(result.summary).toContain('約定済み');
	});

	it('認証エラーで fail を返す', async () => {
		setupFetchMock(mockBitbankError(20001), 400);
		const { confirmation_token, token_expires_at } = validToken({ pair: 'btc_jpy', order_id: 2001 });

		const { default: cancelOrder } = await import('../../tools/private/cancel_order.js');
		const result = await cancelOrder({ pair: 'btc_jpy', order_id: 2001, confirmation_token, token_expires_at });

		assertFail(result);
		expect(result.meta.errorType).toBe('authentication_error');
	});
});
