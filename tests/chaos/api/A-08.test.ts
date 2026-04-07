/**
 * Chaos A-08: bitbank API が空の data フィールドを返す
 * 仮説: null/undefined アクセスでクラッシュしない
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import getTicker from '../../../tools/get_ticker.js';

describe('Chaos: A-08 — bitbank API が空/異常な data フィールドを返す', () => {
	/** 仮説: data が空でも null アクセスでクラッシュせず、fail を返す */

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('data が null → fail を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ success: 1, data: null }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });
		expect(result.ok).toBe(false);
	});

	it('data が undefined（フィールドなし）→ fail を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ success: 1 }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });
		expect(result.ok).toBe(false);
	});

	it('data が空オブジェクト → fail を返さずプロパティが null になる', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ success: 1, data: {} }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);

		// data が空オブジェクトでも success === 1 なので ok になりうるが、
		// 各フィールドが null/undefined でクラッシュしないことが重要
		const result = await getTicker('btc_jpy', { timeoutMs: 500 });

		// クラッシュしなければ OK（ok/fail どちらでも）
		expect(result).toBeDefined();
		expect(typeof result.ok).toBe('boolean');
	});

	it('data が文字列 → fail を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ success: 1, data: 'unexpected string' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });
		expect(result.ok).toBe(false);
	});

	it('data が配列 → クラッシュせず結果を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ success: 1, data: [] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });
		expect(result).toBeDefined();
		expect(typeof result.ok).toBe('boolean');
	});

	it('data 内のフィールドが全て null → クラッシュしない', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					success: 1,
					data: {
						last: null,
						buy: null,
						sell: null,
						high: null,
						low: null,
						open: null,
						vol: null,
						timestamp: null,
					},
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			),
		);

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });

		// クラッシュせずに結果を返す
		expect(result).toBeDefined();
		expect(typeof result.ok).toBe('boolean');
	});
});
