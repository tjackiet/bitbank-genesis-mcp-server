/**
 * preview_cancel_order ツールのユニットテスト。
 * 確認トークン発行とプレビューメッセージ生成を検証する。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import previewCancelOrder from '../../tools/private/preview_cancel_order.js';
import { assertOk } from '../_assertResult.js';

beforeEach(() => {
	process.env.BITBANK_API_KEY = 'test_key';
	process.env.BITBANK_API_SECRET = 'test_secret';
});

afterEach(() => {
	delete process.env.BITBANK_API_KEY;
	delete process.env.BITBANK_API_SECRET;
});

describe('preview_cancel_order', () => {
	it('正常系: ok=true で confirmation_token を含むレスポンスを返す', () => {
		const result = previewCancelOrder({ pair: 'btc_jpy', order_id: 2001 });

		assertOk(result);
		expect(result.data.confirmation_token).toBeTypeOf('string');
		expect(result.data.confirmation_token.length).toBeGreaterThan(0);
		expect(result.data.expires_at).toBeTypeOf('number');
		expect(result.data.expires_at).toBeGreaterThan(Date.now());
	});

	it('summary にペア名（BTC/JPY）と注文IDが含まれる', () => {
		const result = previewCancelOrder({ pair: 'btc_jpy', order_id: 12345 });

		assertOk(result);
		expect(result.summary).toContain('BTC/JPY');
		expect(result.summary).toContain('12345');
	});

	it('summary にキャンセルプレビューの案内文が含まれる', () => {
		const result = previewCancelOrder({ pair: 'eth_jpy', order_id: 100 });

		assertOk(result);
		expect(result.summary).toContain('キャンセルプレビュー');
		expect(result.summary).toContain('confirmation_token');
		expect(result.summary).toContain('cancel_order');
	});

	it('preview にパラメータが含まれる', () => {
		const result = previewCancelOrder({ pair: 'xrp_jpy', order_id: 9999 });

		assertOk(result);
		expect(result.data.preview).toEqual({ pair: 'xrp_jpy', order_id: 9999 });
	});

	it('meta.action が cancel_order である', () => {
		const result = previewCancelOrder({ pair: 'btc_jpy', order_id: 1 });

		assertOk(result);
		expect(result.meta.action).toBe('cancel_order');
	});

	it('異なるペアでもフォーマットされる', () => {
		const result = previewCancelOrder({ pair: 'sol_jpy', order_id: 5555 });

		assertOk(result);
		expect(result.summary).toContain('SOL/JPY');
	});
});

describe('preview_cancel_order — handler (toolDef)', () => {
	it('handler が成功時に content + structuredContent を返す', async () => {
		const { toolDef } = await import('../../tools/private/preview_cancel_order.js');
		const result = await toolDef.handler({ pair: 'btc_jpy', order_id: 2001 });

		expect(result).toHaveProperty('content');
		expect(result).toHaveProperty('structuredContent');
		const content = (result as Record<string, unknown[]>).content;
		expect(content[0]).toHaveProperty('text');
	});
});
