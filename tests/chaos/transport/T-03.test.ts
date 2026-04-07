/**
 * Chaos T-03: 同時並行で複数の tools/call を送信
 * 仮説: レスポンスの混在・欠落が起きない
 *
 * E2E レベルでの並行テストは重いため、ここではツールハンドラレベルで
 * 並行呼び出しの独立性を検証する。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import getTicker from '../../../tools/get_ticker.js';

describe('Chaos: T-03 — 同時並行で複数の tools/call を送信', () => {
	/** 仮説: 並行実行してもレスポンスが混在しない */

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('10件の並行 getTicker が全て独立した結果を返す', async () => {
		const pairs = [
			'btc_jpy',
			'eth_jpy',
			'xrp_jpy',
			'ltc_jpy',
			'doge_jpy',
			'sol_jpy',
			'ada_jpy',
			'dot_jpy',
			'link_jpy',
			'avax_jpy',
		];

		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const url = typeof input === 'string' ? input : input.toString();
			// URL からペア名を抽出してレスポンスに含める
			const pairMatch = url.match(/\/([a-z]+_jpy)\/ticker/);
			const pair = pairMatch?.[1] ?? 'unknown';
			return new Response(
				JSON.stringify({
					success: 1,
					data: {
						pair,
						last: '5000000',
						buy: '4999000',
						sell: '5001000',
						high: '5100000',
						low: '4900000',
						open: '4950000',
						vol: '100',
						timestamp: Date.now(),
					},
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		});

		// 全て並行で実行
		const results = await Promise.all(pairs.map((pair) => getTicker(pair, { timeoutMs: 5000 })));

		// 全て成功
		for (const result of results) {
			expect(result.ok).toBe(true);
		}

		// 結果が混在していないことを確認
		for (let i = 0; i < pairs.length; i++) {
			if (results[i].ok) {
				expect(results[i].summary).toContain(pairs[i].split('_')[0].toUpperCase());
			}
		}
	});

	it('並行呼び出しの一部が失敗しても他に影響しない', async () => {
		let callCount = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			callCount++;
			if (callCount % 3 === 0) {
				// 3回に1回は失敗
				return new Response('Service Unavailable', { status: 503 });
			}
			return new Response(
				JSON.stringify({
					success: 1,
					data: {
						last: '5000000',
						buy: '4999000',
						sell: '5001000',
						high: '5100000',
						low: '4900000',
						open: '4950000',
						vol: '100',
						timestamp: Date.now(),
					},
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			);
		});

		const results = await Promise.all([
			getTicker('btc_jpy', { timeoutMs: 500 }),
			getTicker('eth_jpy', { timeoutMs: 500 }),
			getTicker('xrp_jpy', { timeoutMs: 500 }),
			getTicker('ltc_jpy', { timeoutMs: 500 }),
			getTicker('doge_jpy', { timeoutMs: 500 }),
		]);

		// 全て結果を返す（ok か fail かは問わない）
		for (const result of results) {
			expect(result).toBeDefined();
			expect(typeof result.ok).toBe('boolean');
		}
	});
});
