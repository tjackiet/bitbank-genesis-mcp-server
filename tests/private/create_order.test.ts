/**
 * create_order ツールのユニットテスト。
 * stop 注文のトリガー価格バリデーションを検証する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** ticker レスポンスを返すヘルパー */
function tickerResponse(lastPrice: string) {
	return { success: 1, data: { last: lastPrice } };
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

describe('create_order — stop 注文トリガー価格バリデーション', () => {
	it('stop sell: trigger_price >= 現在価格 → エラー（即時発動を防止）', async () => {
		// 現在価格 10,000,000 に対してトリガー 12,000,000（以上）→ ブロック
		setupFetchMockSequence([{ body: tickerResponse('10000000') }]);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'sell',
			type: 'stop',
			trigger_price: '12000000',
		});

		assertFail(result);
		expect(result.summary).toContain('即時発動');
		expect(result.summary).toContain('limit sell');
	});

	it('stop sell: trigger_price < 現在価格 → 発注成功', async () => {
		// 現在価格 10,000,000 に対してトリガー 9,500,000（未満）→ 正常
		setupFetchMockSequence([
			{ body: tickerResponse('10000000') },
			{ body: orderSuccessResponse({ side: 'sell', trigger_price: '9500000' }) },
		]);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'sell',
			type: 'stop',
			trigger_price: '9500000',
		});

		assertOk(result);
	});

	it('stop buy: trigger_price <= 現在価格 → エラー（即時発動を防止）', async () => {
		// 現在価格 10,000,000 に対してトリガー 9,000,000（以下）→ ブロック
		setupFetchMockSequence([{ body: tickerResponse('10000000') }]);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'buy',
			type: 'stop',
			trigger_price: '9000000',
		});

		assertFail(result);
		expect(result.summary).toContain('即時発動');
		expect(result.summary).toContain('limit buy');
	});

	it('stop buy: trigger_price > 現在価格 → 発注成功', async () => {
		// 現在価格 10,000,000 に対してトリガー 11,000,000（超）→ 正常
		setupFetchMockSequence([
			{ body: tickerResponse('10000000') },
			{ body: orderSuccessResponse({ side: 'buy', type: 'stop', trigger_price: '11000000' }) },
		]);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'buy',
			type: 'stop',
			trigger_price: '11000000',
		});

		assertOk(result);
	});

	it('ticker 取得失敗時はバリデーションをスキップして発注を続行', async () => {
		// ticker がエラー → バリデーションスキップ → 注文 API 呼び出し
		// fetchJson retries=2 → ticker fetch は計3回失敗 → validateTriggerPrice は catch でスキップ
		setupFetchMockSequence([
			{ body: { success: 0 }, status: 500 },
			{ body: { success: 0 }, status: 500 },
			{ body: { success: 0 }, status: 500 },
			{ body: orderSuccessResponse() },
		]);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'sell',
			type: 'stop',
			trigger_price: '12000000',
		});

		assertOk(result);
	});

	it('stop_limit でも同様にトリガー価格バリデーションが適用される', async () => {
		// stop_limit sell: trigger >= current → ブロック
		setupFetchMockSequence([{ body: tickerResponse('10000000') }]);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'sell',
			type: 'stop_limit',
			trigger_price: '12000000',
			price: '11500000',
		});

		assertFail(result);
		expect(result.summary).toContain('即時発動');
	});

	it('limit / market 注文ではトリガー価格バリデーションは実行されない', async () => {
		// limit 注文 → ticker fetch なし → 直接注文 API 呼び出し
		setupFetchMockSequence([
			{
				body: orderSuccessResponse({ type: 'limit', price: '12000000' }),
			},
		]);

		const { default: createOrder } = await import('../../tools/private/create_order.js');
		const result = await createOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'sell',
			type: 'limit',
			price: '12000000',
		});

		assertOk(result);
		// fetch は注文 API 呼び出しの 1 回のみ（ticker 取得なし）
		const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
