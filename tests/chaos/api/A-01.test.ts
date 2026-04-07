/**
 * Chaos A-01: bitbank API が HTTP 503 を返す
 * 仮説: fail() で構造化エラーを返し、LLM が理解できるメッセージになる
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import getTicker from '../../../tools/get_ticker.js';

describe('Chaos: A-01 — bitbank API が HTTP 503 を返す', () => {
	/** 仮説: リトライ後に fail() で構造化エラーを返す */

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('HTTP 503 で fail 結果を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Service Unavailable', { status: 503 }));

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.summary).toBeTruthy();
			expect(result.summary.length).toBeGreaterThan(0);
		}
	});

	it('HTTP 500 で fail 結果を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });

		expect(result.ok).toBe(false);
	});

	it('HTTP 502 で fail 結果を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Bad Gateway', { status: 502 }));

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });

		expect(result.ok).toBe(false);
	});

	it('サーバーが復旧不能でもクラッシュしない', async () => {
		let callCount = 0;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
			callCount++;
			return new Response('Service Unavailable', { status: 503 });
		});

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });

		expect(result.ok).toBe(false);
		// リトライが発生している（DEFAULT_RETRIES = 2 → 初回 + 2回 = 最大3回）
		expect(callCount).toBeGreaterThan(1);
	});
});
