/**
 * Chaos A-04: bitbank API が success: 0 + エラーコード 10009（レート制限）
 * 仮説: rate_limit_error に分類され、リトライ後に成功する
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJson } from '../../../lib/http.js';

describe('Chaos: A-04 — bitbank API がレート制限エラーを返す', () => {
	/** 仮説: HTTP 429 でリトライされ、復旧後に成功する */

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('HTTP 429 → リトライ → 成功', async () => {
		let callCount = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				return new Response('Rate Limited', {
					status: 429,
					headers: { 'Retry-After': '0' },
				});
			}
			return new Response(JSON.stringify({ success: 1, data: { result: 'ok' } }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		});

		const result = await fetchJson('https://public.bitbank.cc/btc_jpy/ticker', {
			timeoutMs: 5000,
			retries: 2,
		});

		expect(callCount).toBe(2);
		expect(result).toEqual({ success: 1, data: { result: 'ok' } });
	});

	it('HTTP 429 が全リトライで発生 → throw', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('Rate Limited', {
				status: 429,
				headers: { 'Retry-After': '0' },
			}),
		);

		await expect(
			fetchJson('https://public.bitbank.cc/btc_jpy/ticker', {
				timeoutMs: 5000,
				retries: 1,
			}),
		).rejects.toThrow('レート制限');
	});

	it('Retry-After ヘッダがない場合もリトライする', async () => {
		let callCount = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			callCount++;
			if (callCount <= 2) {
				return new Response('Rate Limited', { status: 429 });
			}
			return new Response(JSON.stringify({ success: 1, data: {} }), { status: 200 });
		});

		const result = await fetchJson('https://public.bitbank.cc/btc_jpy/ticker', {
			timeoutMs: 5000,
			retries: 2,
		});

		expect(callCount).toBe(3);
		expect(result).toBeDefined();
	});
});
