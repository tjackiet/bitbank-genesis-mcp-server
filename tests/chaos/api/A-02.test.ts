/**
 * Chaos A-02: bitbank API が 5秒以上応答しない
 * 仮説: AbortSignal.timeout が発火し、タイムアウトエラーを返す
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import getTicker from '../../../tools/get_ticker.js';

describe('Chaos: A-02 — bitbank API が応答しない（タイムアウト）', () => {
	/** 仮説: AbortSignal で中断され、fail 結果を返す */

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('タイムアウトで fail 結果を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					const signal = (init as RequestInit)?.signal;
					if (signal) {
						signal.addEventListener('abort', () => {
							reject(new DOMException('The operation was aborted', 'AbortError'));
						});
					}
				}),
		);

		const result = await getTicker('btc_jpy', { timeoutMs: 100 });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			// AbortError 由来のエラーメッセージが含まれる
			expect(result.summary).toBeTruthy();
		}
	});

	it('タイムアウト後にプロセスがハングしない', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					const signal = (init as RequestInit)?.signal;
					if (signal) {
						signal.addEventListener('abort', () => {
							reject(new DOMException('The operation was aborted', 'AbortError'));
						});
					}
				}),
		);

		const start = Date.now();
		await getTicker('btc_jpy', { timeoutMs: 100 });
		const elapsed = Date.now() - start;

		// リトライ含めても数秒以内に完了する
		expect(elapsed).toBeLessThan(10_000);
	});
});
