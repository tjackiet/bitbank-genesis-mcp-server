import { afterEach, describe, expect, it, vi } from 'vitest';
import getFlowMetrics, { toolDef } from '../tools/get_flow_metrics.js';
import { assertFail, assertOk } from './_assertResult.js';

function txPayload() {
	return {
		success: 1,
		data: {
			transactions: [
				{ price: '5000000', amount: '0.1', side: 'buy', executed_at: '1700000000000' },
				{ price: '5000100', amount: '0.2', side: 'sell', executed_at: '1700000060000' },
				{ price: '5000200', amount: '0.3', side: 'buy', executed_at: '1700000120000' },
			],
		},
	};
}

describe('get_flow_metrics', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('inputSchema: hours は 0.1 以上のみ許可する', () => {
		const parse = () => toolDef.inputSchema.parse({ pair: 'btc_jpy', hours: 0.05 });
		expect(parse).toThrow();
	});

	it('正常系: 集計値 totalTrades / buyTrades / sellTrades が計算される', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => txPayload(),
		}) as unknown as typeof fetch;

		const res = await getFlowMetrics('btc_jpy', 3, '20240101', 60_000);
		assertOk(res);
		expect(res.data.aggregates.totalTrades).toBe(3);
		expect(res.data.aggregates.buyTrades).toBe(2);
		expect(res.data.aggregates.sellTrades).toBe(1);
	});

	it('API異常系: date 指定時に上流失敗なら fail を返す', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

		const res = await getFlowMetrics('btc_jpy', 10, '20240101');
		assertFail(res);
	});

	it('上流取得が全滅した場合は fail を返すべき（現状は ok:true no transactions）', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

		const res = await getFlowMetrics('btc_jpy', 10);
		assertFail(res);
		expect(res.meta?.errorType).toBe('network');
	});
});
