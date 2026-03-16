import { afterEach, describe, expect, it, vi } from 'vitest';
import getOrderbook, { toolDef } from '../tools/get_orderbook.js';

function depthPayload() {
	return {
		success: 1,
		data: {
			asks: [
				['5000100', '0.2'],
				['5000200', '0.4'],
			],
			bids: [
				['5000000', '0.3'],
				['4999900', '0.5'],
			],
			timestamp: 1_700_000_000_000,
		},
	};
}

describe('get_orderbook', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('inputSchema: summary の topN は 1-200 の範囲のみ許可する', () => {
		const parse = () => toolDef.inputSchema.parse({ pair: 'btc_jpy', mode: 'summary', topN: 201 });
		expect(parse).toThrow();
	});

	it('正常系: summary で topN 件の板情報を返す', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => depthPayload(),
		}) as unknown as typeof fetch;

		const res = await getOrderbook({ pair: 'btc_jpy', mode: 'summary', topN: 2 });
		expect((res as any).ok).toBe(true);
		expect((res as any).data.mode).toBe('summary');
		expect((res as any).data.normalized.bids).toHaveLength(2);
		expect((res as any).data.normalized.asks).toHaveLength(2);
	});

	it('API異常系: AbortError は timeout 分類で fail を返す', async () => {
		globalThis.fetch = vi
			.fn()
			.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError')) as unknown as typeof fetch;

		const res = await getOrderbook({ pair: 'btc_jpy', mode: 'summary', timeoutMs: 100 });
		expect((res as any).ok).toBe(false);
		expect((res as any).meta?.errorType).toBe('timeout');
	});

	it('上流レスポンスで bids/asks 欠損時は fail を返すべき（現状は ok=true）', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({ success: 1, data: { timestamp: 1_700_000_000_000 } }),
		}) as unknown as typeof fetch;

		const res = await getOrderbook({ pair: 'btc_jpy', mode: 'summary' });
		expect((res as any).ok).toBe(false);
		expect((res as any).meta?.errorType).toBe('upstream');
	});
});
