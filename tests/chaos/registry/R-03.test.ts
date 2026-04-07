/**
 * Chaos R-03: ツールの handler が Promise を reject する
 * 仮説: registerToolWithLog のラッパーがキャッチし、構造化エラーを返す
 *
 * async handler が reject した場合も try-catch で捕捉される。
 * ここでは reject される Promise の各パターンを検証する。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import getTicker from '../../../tools/get_ticker.js';

describe('Chaos: R-03 — ツール handler が Promise を reject する', () => {
	/** 仮説: reject されても fail 結果を返し、クラッシュしない */

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('fetch が reject しても getTicker は fail を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });

		expect(result.ok).toBe(false);
	});

	it('fetch が TypeError で reject しても fail を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });

		expect(result.ok).toBe(false);
	});

	it('fetch が文字列で reject しても fail を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue('network error string');

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });

		expect(result.ok).toBe(false);
	});

	it('fetch が null で reject しても fail を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(null);

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });

		expect(result.ok).toBe(false);
	});

	it('複数回連続で reject しても各呼び出しが独立して fail を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('persistent failure'));

		const results = await Promise.all([
			getTicker('btc_jpy', { timeoutMs: 500 }),
			getTicker('eth_jpy', { timeoutMs: 500 }),
			getTicker('xrp_jpy', { timeoutMs: 500 }),
		]);

		for (const result of results) {
			expect(result.ok).toBe(false);
		}
	});
});
