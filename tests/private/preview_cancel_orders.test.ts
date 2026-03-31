/**
 * preview_cancel_orders ツールのユニットテスト。
 * 一括キャンセルの確認トークン発行とプレビューメッセージ生成を検証する。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import previewCancelOrders from '../../tools/private/preview_cancel_orders.js';
import { assertOk } from '../_assertResult.js';

beforeEach(() => {
	process.env.BITBANK_API_KEY = 'test_key';
	process.env.BITBANK_API_SECRET = 'test_secret';
});

afterEach(() => {
	delete process.env.BITBANK_API_KEY;
	delete process.env.BITBANK_API_SECRET;
});

describe('preview_cancel_orders', () => {
	it('正常系: ok=true で confirmation_token を含むレスポンスを返す', () => {
		const result = previewCancelOrders({ pair: 'btc_jpy', order_ids: [2001, 2002] });

		assertOk(result);
		expect(result.data.confirmation_token).toBeTypeOf('string');
		expect(result.data.confirmation_token.length).toBeGreaterThan(0);
		expect(result.data.expires_at).toBeTypeOf('number');
		expect(result.data.expires_at).toBeGreaterThan(Date.now());
	});

	it('summary にペア名と件数が含まれる', () => {
		const result = previewCancelOrders({ pair: 'btc_jpy', order_ids: [1, 2, 3] });

		assertOk(result);
		expect(result.summary).toContain('BTC/JPY');
		expect(result.summary).toContain('3件');
	});

	it('summary に全ての注文IDが列挙される', () => {
		const orderIds = [1001, 1002, 1003];
		const result = previewCancelOrders({ pair: 'eth_jpy', order_ids: orderIds });

		assertOk(result);
		for (const id of orderIds) {
			expect(result.summary).toContain(String(id));
		}
	});

	it('summary に一括キャンセルの案内文が含まれる', () => {
		const result = previewCancelOrders({ pair: 'btc_jpy', order_ids: [100] });

		assertOk(result);
		expect(result.summary).toContain('一括キャンセルプレビュー');
		expect(result.summary).toContain('confirmation_token');
		expect(result.summary).toContain('cancel_orders');
	});

	it('preview にパラメータが含まれる', () => {
		const result = previewCancelOrders({ pair: 'xrp_jpy', order_ids: [10, 20] });

		assertOk(result);
		expect(result.data.preview).toEqual({ pair: 'xrp_jpy', order_ids: [10, 20] });
	});

	it('meta.action が cancel_orders である', () => {
		const result = previewCancelOrders({ pair: 'btc_jpy', order_ids: [1] });

		assertOk(result);
		expect(result.meta.action).toBe('cancel_orders');
	});

	it('単一注文IDでも動作する', () => {
		const result = previewCancelOrders({ pair: 'btc_jpy', order_ids: [9999] });

		assertOk(result);
		expect(result.summary).toContain('1件');
		expect(result.summary).toContain('9999');
	});
});
