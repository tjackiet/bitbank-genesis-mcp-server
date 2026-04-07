/**
 * Chaos A-03: bitbank API が不正な JSON を返す
 * 仮説: パースエラーが fail() に変換される
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import getTicker from '../../../tools/get_ticker.js';

describe('Chaos: A-03 — bitbank API が不正な JSON を返す', () => {
	/** 仮説: JSON パースエラーがキャッチされ、fail 結果を返す */

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('HTML レスポンスで fail を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('<html><body>Error</body></html>', {
				status: 200,
				headers: { 'Content-Type': 'text/html' },
			}),
		);

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });
		expect(result.ok).toBe(false);
	});

	it('空レスポンスで fail を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });
		expect(result.ok).toBe(false);
	});

	it('不完全な JSON で fail を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"success": 1, "data":', { status: 200 }));

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });
		expect(result.ok).toBe(false);
	});

	it('正しい JSON だが success !== 1 で fail を返す', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ success: 0, data: { code: 99999 } }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });
		expect(result.ok).toBe(false);
	});

	it('バイナリデータで fail を返す', async () => {
		const binary = new Uint8Array([0x00, 0xff, 0x80, 0x7f]);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(binary, { status: 200 }));

		const result = await getTicker('btc_jpy', { timeoutMs: 500 });
		expect(result.ok).toBe(false);
	});
});
