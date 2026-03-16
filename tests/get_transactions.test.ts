import { afterEach, describe, expect, it, vi } from 'vitest';
import getTransactions, { toolDef } from '../tools/get_transactions.js';
import { assertFail, assertOk } from './_assertResult.js';

type TxInput = {
	price: string;
	amount: string;
	side: 'buy' | 'sell';
	executed_at: string;
};

function buildTransactions(count: number): TxInput[] {
	const baseTs = 1_700_000_000_000;
	return Array.from({ length: count }, (_, i) => ({
		price: String(5_000_000 + i),
		amount: '0.01',
		side: i % 2 === 0 ? 'buy' : 'sell',
		executed_at: String(baseTs + i * 1000),
	}));
}

describe('get_transactions', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('inputSchema: date は YYYYMMDD 形式のみ許可する', () => {
		const parse = () => toolDef.inputSchema.parse({ pair: 'btc_jpy', date: '2024-01-01' });
		expect(parse).toThrow();
	});

	it('正常系: limit 件数だけ normalized を返す', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				success: 1,
				data: {
					transactions: buildTransactions(8),
				},
			}),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getTransactions('btc_jpy', 5);
		assertOk(res);
		expect(res.data.normalized).toHaveLength(5);
		expect(res.meta.count).toBe(5);
	});

	it('仕様: デフォルトは直近60件を返すべき（現状は100件）', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				success: 1,
				data: {
					transactions: buildTransactions(120),
				},
			}),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getTransactions('btc_jpy');
		assertOk(res);
		expect(res.data.normalized).toHaveLength(60);
	});

	it('API異常系: AbortError は timeout 分類されるべき（現状は network）', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getTransactions('btc_jpy', 10);
		assertFail(res);
		expect(res.meta?.errorType).toBe('timeout');
	});
});
