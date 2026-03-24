/**
 * get_orders_info ツールのユニットテスト。
 * 複数注文の一括取得の成功・部分取得・エラーハンドリングを検証する。
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

/** 注文データ */
function orderData(id: number, side: 'buy' | 'sell' = 'buy', overrides: Record<string, unknown> = {}) {
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
		status: 'UNFILLED',
		ordered_at: 1710000000000,
		...overrides,
	};
}

describe('get_orders_info', () => {
	it('複数注文の詳細を取得して返す', async () => {
		setupFetchMock(
			mockBitbankSuccess({
				orders: [orderData(4001), orderData(4002, 'sell')],
			}),
		);

		const { default: getOrdersInfo } = await import('../../tools/private/get_orders_info.js');
		const result = await getOrdersInfo({ pair: 'btc_jpy', order_ids: [4001, 4002] });

		assertOk(result);
		expect(result.summary).toContain('注文情報');
		expect(result.summary).toContain('2件');
		expect(result.data.orders).toHaveLength(2);
		expect(result.meta.orderCount).toBe(2);
	});

	it('注文IDとステータスをサマリーに含む', async () => {
		setupFetchMock(
			mockBitbankSuccess({
				orders: [
					orderData(4001, 'buy', { status: 'UNFILLED' }),
					orderData(4002, 'sell', { status: 'PARTIALLY_FILLED' }),
				],
			}),
		);

		const { default: getOrdersInfo } = await import('../../tools/private/get_orders_info.js');
		const result = await getOrdersInfo({ pair: 'btc_jpy', order_ids: [4001, 4002] });

		assertOk(result);
		expect(result.summary).toContain('#4001');
		expect(result.summary).toContain('#4002');
		expect(result.summary).toContain('UNFILLED');
		expect(result.summary).toContain('PARTIALLY_FILLED');
	});

	it('一部の注文が取得できなかった場合に警告メッセージを含む', async () => {
		// 3件リクエストしたが1件のみ返却（2件は3ヶ月以上前）
		setupFetchMock(
			mockBitbankSuccess({
				orders: [orderData(4001)],
			}),
		);

		const { default: getOrdersInfo } = await import('../../tools/private/get_orders_info.js');
		const result = await getOrdersInfo({ pair: 'btc_jpy', order_ids: [4001, 4002, 4003] });

		assertOk(result);
		expect(result.summary).toContain('2件は3ヶ月以上前');
	});

	it('タイムスタンプが ISO8601 に変換される', async () => {
		setupFetchMock(
			mockBitbankSuccess({
				orders: [orderData(4001)],
			}),
		);

		const { default: getOrdersInfo } = await import('../../tools/private/get_orders_info.js');
		const result = await getOrdersInfo({ pair: 'btc_jpy', order_ids: [4001] });

		assertOk(result);
		expect(result.summary).toMatch(/\d{4}-\d{2}-\d{2}T/);
	});

	it('認証エラーで fail を返す', async () => {
		setupFetchMock(mockBitbankError(20001), 400);

		const { default: getOrdersInfo } = await import('../../tools/private/get_orders_info.js');
		const result = await getOrdersInfo({ pair: 'btc_jpy', order_ids: [4001] });

		assertFail(result);
		expect(result.meta.errorType).toBe('authentication_error');
	});

	it('全注文が取得できた場合は警告メッセージなし', async () => {
		setupFetchMock(
			mockBitbankSuccess({
				orders: [orderData(4001), orderData(4002)],
			}),
		);

		const { default: getOrdersInfo } = await import('../../tools/private/get_orders_info.js');
		const result = await getOrdersInfo({ pair: 'btc_jpy', order_ids: [4001, 4002] });

		assertOk(result);
		expect(result.summary).not.toContain('3ヶ月以上前');
	});
});
