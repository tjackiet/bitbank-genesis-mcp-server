/**
 * Chaos S-05: stop sell のトリガー価格を現在価格より高く設定
 * 仮説: 即時発動防止ロジックがブロックする
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import previewOrder from '../../../tools/private/preview_order.js';

beforeEach(() => {
	process.env.BITBANK_API_SECRET = 'chaos_test_secret';
	process.env.BITBANK_API_KEY = 'chaos_test_key';
});

afterEach(() => {
	delete process.env.BITBANK_API_SECRET;
	delete process.env.BITBANK_API_KEY;
	vi.restoreAllMocks();
});

describe('Chaos: S-05 — stop sell のトリガー価格が現在価格以上', () => {
	/** 仮説: 即時発動防止ロジックがブロックする */

	it('stop sell でトリガー価格 > 現在価格の場合、拒否される', async () => {
		// ticker API をモック: 現在価格 5,000,000
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(JSON.stringify({ success: 1, data: { last: '5000000' } }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);

		const result = await previewOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'sell',
			type: 'stop',
			trigger_price: '6000000', // 現在価格より高い → 即時発動
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('validation_error');
			expect(result.summary).toContain('即時発動');
		}
	});

	it('stop sell でトリガー価格 = 現在価格の場合も拒否される', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(JSON.stringify({ success: 1, data: { last: '5000000' } }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);

		const result = await previewOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'sell',
			type: 'stop',
			trigger_price: '5000000', // 現在価格と同一 → 即時発動
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.summary).toContain('即時発動');
		}
	});

	it('stop buy でトリガー価格 < 現在価格の場合、拒否される', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(JSON.stringify({ success: 1, data: { last: '5000000' } }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);

		const result = await previewOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'buy',
			type: 'stop',
			trigger_price: '4000000', // 現在価格より低い → 即時発動
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.meta.errorType).toBe('validation_error');
			expect(result.summary).toContain('即時発動');
		}
	});

	it('stop_limit sell でもトリガー価格チェックが有効', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(JSON.stringify({ success: 1, data: { last: '5000000' } }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);

		const result = await previewOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			price: '4900000',
			side: 'sell',
			type: 'stop_limit',
			trigger_price: '5500000', // 現在価格より高い
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.summary).toContain('即時発動');
		}
	});

	it('正常系: stop sell でトリガー価格 < 現在価格は通過する', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(JSON.stringify({ success: 1, data: { last: '5000000' } }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);

		const result = await previewOrder({
			pair: 'btc_jpy',
			amount: '0.001',
			side: 'sell',
			type: 'stop',
			trigger_price: '4500000', // 現在価格より低い → 正常
		});

		expect(result.ok).toBe(true);
	});
});
