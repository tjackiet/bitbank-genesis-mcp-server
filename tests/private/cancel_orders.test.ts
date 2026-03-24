/**
 * cancel_orders ツールのユニットテスト。
 * 一括キャンセルの成功・部分失敗・エラーハンドリングを検証する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** キャンセル済み注文データ */
function canceledOrder(id: number, side: 'buy' | 'sell' = 'buy', overrides: Record<string, unknown> = {}) {
	return {
		order_id: id,
		pair: 'btc_jpy',
		side,
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

describe('cancel_orders', () => {
	it('複数注文の一括キャンセル成功', async () => {
		setupFetchMock(
			mockBitbankSuccess({
				orders: [canceledOrder(3001), canceledOrder(3002, 'sell')],
			}),
		);

		const { default: cancelOrders } = await import('../../tools/private/cancel_orders.js');
		const result = await cancelOrders({ pair: 'btc_jpy', order_ids: [3001, 3002] });

		assertOk(result);
		expect(result.summary).toContain('一括キャンセル完了');
		expect(result.summary).toContain('2件');
		expect(result.data.orders).toHaveLength(2);
		expect(result.meta.canceledCount).toBe(2);
	});

	it('一部の注文がキャンセルできなかった場合に警告メッセージを含む', async () => {
		// 3件リクエストしたが2件のみ返却
		setupFetchMock(
			mockBitbankSuccess({
				orders: [canceledOrder(3001)],
			}),
		);

		const { default: cancelOrders } = await import('../../tools/private/cancel_orders.js');
		const result = await cancelOrders({ pair: 'btc_jpy', order_ids: [3001, 3002, 3003] });

		assertOk(result);
		expect(result.summary).toContain('2件はキャンセルできませんでした');
	});

	it('注文情報に売買方向・価格・ステータスを含む', async () => {
		setupFetchMock(
			mockBitbankSuccess({
				orders: [canceledOrder(3001, 'buy', { price: '14000000' }), canceledOrder(3002, 'sell', { price: '15000000' })],
			}),
		);

		const { default: cancelOrders } = await import('../../tools/private/cancel_orders.js');
		const result = await cancelOrders({ pair: 'btc_jpy', order_ids: [3001, 3002] });

		assertOk(result);
		expect(result.summary).toContain('#3001');
		expect(result.summary).toContain('#3002');
		expect(result.summary).toContain('買');
		expect(result.summary).toContain('売');
	});

	it('PrivateApiError で fail を返す', async () => {
		setupFetchMock(mockBitbankError(20001), 400);

		const { default: cancelOrders } = await import('../../tools/private/cancel_orders.js');
		const result = await cancelOrders({ pair: 'btc_jpy', order_ids: [3001] });

		assertFail(result);
		expect(result.meta.errorType).toBe('authentication_error');
	});

	it('空の注文リストが返った場合も正常に処理', async () => {
		setupFetchMock(mockBitbankSuccess({ orders: [] }));

		const { default: cancelOrders } = await import('../../tools/private/cancel_orders.js');
		const result = await cancelOrders({ pair: 'btc_jpy', order_ids: [9999] });

		assertOk(result);
		expect(result.summary).toContain('0件');
		expect(result.data.orders).toHaveLength(0);
	});
});
