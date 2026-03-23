/**
 * get_my_orders ツールのユニットテスト。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertFail, assertOk } from '../_assertResult.js';
import { mockBitbankError, mockBitbankSuccess, rawActiveOrdersResponse } from '../fixtures/private-api.js';

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

describe('get_my_orders', () => {
	it('フォーマット済みタイムスタンプの注文を返す', async () => {
		setupFetchMock(mockBitbankSuccess(rawActiveOrdersResponse));

		const { default: getMyOrders } = await import('../../tools/private/get_my_orders.js');
		const result = await getMyOrders({});

		assertOk(result);
		expect(result.data.orders).toHaveLength(2);
		// ordered_at が ISO8601 に変換されている
		for (const order of result.data.orders) {
			expect(order.ordered_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		}
	});

	it('注文がない場合のメッセージを返す', async () => {
		setupFetchMock(mockBitbankSuccess({ orders: [] }));

		const { default: getMyOrders } = await import('../../tools/private/get_my_orders.js');
		const result = await getMyOrders({});

		assertOk(result);
		expect(result.data.orders).toHaveLength(0);
		expect(result.summary).toContain('アクティブな注文はありません');
	});

	it('buy/sell の集計をサマリーに含む', async () => {
		setupFetchMock(mockBitbankSuccess(rawActiveOrdersResponse));

		const { default: getMyOrders } = await import('../../tools/private/get_my_orders.js');
		const result = await getMyOrders({});

		assertOk(result);
		expect(result.summary).toContain('買 1件');
		expect(result.summary).toContain('売 1件');
	});

	it('order_id をサマリーに含む', async () => {
		setupFetchMock(mockBitbankSuccess(rawActiveOrdersResponse));

		const { default: getMyOrders } = await import('../../tools/private/get_my_orders.js');
		const result = await getMyOrders({});

		assertOk(result);
		expect(result.summary).toContain('[ID: 2001]');
		expect(result.summary).toContain('[ID: 2002]');
	});

	it('不正な since 日付で validation_error を返す', async () => {
		const { default: getMyOrders } = await import('../../tools/private/get_my_orders.js');
		const result = await getMyOrders({ since: 'bad-date' });

		assertFail(result);
		expect(result.meta.errorType).toBe('validation_error');
	});

	it('PrivateApiError で fail を返す', async () => {
		setupFetchMock(mockBitbankError(20001), 400);

		const { default: getMyOrders } = await import('../../tools/private/get_my_orders.js');
		const result = await getMyOrders({});

		assertFail(result);
		expect(result.meta.errorType).toBe('authentication_error');
	});
});
