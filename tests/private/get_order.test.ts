/**
 * get_order ツールのユニットテスト。
 * 注文詳細取得の成功・エラーハンドリングを検証する。
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

/** 注文レスポンスデータ */
function orderResponse(overrides: Record<string, unknown> = {}) {
	return {
		order_id: 2001,
		pair: 'btc_jpy',
		side: 'buy',
		type: 'limit',
		start_amount: '0.01',
		remaining_amount: '0.005',
		executed_amount: '0.005',
		price: '14000000',
		average_price: '14000000',
		status: 'PARTIALLY_FILLED',
		ordered_at: 1710000000000,
		...overrides,
	};
}

describe('get_order', () => {
	it('注文詳細を取得して整形されたサマリーを返す', async () => {
		setupFetchMock(mockBitbankSuccess(orderResponse()));

		const { default: getOrder } = await import('../../tools/private/get_order.js');
		const result = await getOrder({ pair: 'btc_jpy', order_id: 2001 });

		assertOk(result);
		expect(result.summary).toContain('注文詳細');
		expect(result.summary).toContain('BTC/JPY');
		expect(result.summary).toContain('2001');
		expect(result.summary).toContain('買');
		expect(result.summary).toContain('PARTIALLY_FILLED');
	});

	it('タイムスタンプが ISO8601 に変換される', async () => {
		setupFetchMock(mockBitbankSuccess(orderResponse()));

		const { default: getOrder } = await import('../../tools/private/get_order.js');
		const result = await getOrder({ pair: 'btc_jpy', order_id: 2001 });

		assertOk(result);
		expect(result.summary).toMatch(/\d{4}-\d{2}-\d{2}T/);
	});

	it('平均約定価格が 0 でなければ表示する', async () => {
		setupFetchMock(mockBitbankSuccess(orderResponse({ average_price: '14500000' })));

		const { default: getOrder } = await import('../../tools/private/get_order.js');
		const result = await getOrder({ pair: 'btc_jpy', order_id: 2001 });

		assertOk(result);
		expect(result.summary).toContain('平均約定価格');
	});

	it('平均約定価格が 0 なら表示しない', async () => {
		setupFetchMock(mockBitbankSuccess(orderResponse({ average_price: '0' })));

		const { default: getOrder } = await import('../../tools/private/get_order.js');
		const result = await getOrder({ pair: 'btc_jpy', order_id: 2001 });

		assertOk(result);
		expect(result.summary).not.toContain('平均約定価格');
	});

	it('トリガー価格があれば表示する', async () => {
		const data = orderResponse({ type: 'stop', trigger_price: '13000000' });
		delete (data as Record<string, unknown>).price;
		setupFetchMock(mockBitbankSuccess(data));

		const { default: getOrder } = await import('../../tools/private/get_order.js');
		const result = await getOrder({ pair: 'btc_jpy', order_id: 2001 });

		assertOk(result);
		expect(result.summary).toContain('トリガー価格');
	});

	it('キャンセル済み注文のキャンセル日時を表示', async () => {
		setupFetchMock(mockBitbankSuccess(orderResponse({ status: 'CANCELED_UNFILLED', canceled_at: 1710001000000 })));

		const { default: getOrder } = await import('../../tools/private/get_order.js');
		const result = await getOrder({ pair: 'btc_jpy', order_id: 2001 });

		assertOk(result);
		expect(result.summary).toContain('キャンセル日時');
	});

	it('売注文で「売」ラベルが表示される', async () => {
		setupFetchMock(mockBitbankSuccess(orderResponse({ side: 'sell' })));

		const { default: getOrder } = await import('../../tools/private/get_order.js');
		const result = await getOrder({ pair: 'btc_jpy', order_id: 2001 });

		assertOk(result);
		expect(result.summary).toContain('売');
	});

	it('認証エラーで fail を返す', async () => {
		setupFetchMock(mockBitbankError(20001), 400);

		const { default: getOrder } = await import('../../tools/private/get_order.js');
		const result = await getOrder({ pair: 'btc_jpy', order_id: 2001 });

		assertFail(result);
		expect(result.meta.errorType).toBe('authentication_error');
	});

	it('成行注文の価格表示が「成行」になる', async () => {
		const data = orderResponse({ type: 'market', average_price: '14200000' });
		delete (data as Record<string, unknown>).price;
		setupFetchMock(mockBitbankSuccess(data));

		const { default: getOrder } = await import('../../tools/private/get_order.js');
		const result = await getOrder({ pair: 'btc_jpy', order_id: 2001 });

		assertOk(result);
		expect(result.summary).toContain('成行');
	});
});
