/**
 * get_my_trade_history ツールのユニットテスト。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertFail, assertOk } from '../_assertResult.js';
import { mockBitbankError, mockBitbankSuccess, rawTradeHistoryResponse } from '../fixtures/private-api.js';

const originalFetch = globalThis.fetch;

beforeEach(() => {
	process.env.BITBANK_API_KEY = 'test_key';
	process.env.BITBANK_API_SECRET = 'test_secret';
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	delete process.env.BITBANK_API_KEY;
	delete process.env.BITBANK_API_SECRET;
	vi.resetModules();
});

function setupFetchMock(response: unknown, status = 200) {
	globalThis.fetch = vi
		.fn()
		.mockResolvedValue(new Response(JSON.stringify(response), { status })) as unknown as typeof fetch;
}

describe('get_my_trade_history', () => {
	it('ISO8601 タイムスタンプに変換された約定を返す', async () => {
		setupFetchMock(mockBitbankSuccess(rawTradeHistoryResponse));

		const { default: getMyTradeHistory } = await import('../../tools/private/get_my_trade_history.js');
		const result = await getMyTradeHistory({});

		assertOk(result);
		expect(result.data.trades).toHaveLength(3);
		// unix ms が ISO8601 に変換されている
		for (const trade of result.data.trades) {
			expect(trade.executed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		}
	});

	it('since/end を unix ms に変換して API に渡す', async () => {
		setupFetchMock(mockBitbankSuccess({ trades: [] }));

		const { default: getMyTradeHistory } = await import('../../tools/private/get_my_trade_history.js');
		await getMyTradeHistory({ since: '2024-03-10T00:00:00Z', end: '2024-03-11T00:00:00Z' });

		const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
		const calledUrl = fetchMock.mock.calls[0][0] as string;
		// unix ms パラメータが含まれている
		expect(calledUrl).toContain('since=');
		expect(calledUrl).toContain('end=');
		// ISO8601 文字列ではなく数値
		expect(calledUrl).not.toContain('2024-03-10');
	});

	it('不正な since 日付で validation_error を返す', async () => {
		const { default: getMyTradeHistory } = await import('../../tools/private/get_my_trade_history.js');
		const result = await getMyTradeHistory({ since: 'not-a-date' });

		assertFail(result);
		expect(result.meta.errorType).toBe('validation_error');
	});

	it('不正な end 日付で validation_error を返す', async () => {
		const { default: getMyTradeHistory } = await import('../../tools/private/get_my_trade_history.js');
		const result = await getMyTradeHistory({ end: 'invalid' });

		assertFail(result);
		expect(result.meta.errorType).toBe('validation_error');
	});

	it('PrivateApiError で fail を返す', async () => {
		setupFetchMock(mockBitbankError(20001), 400);

		const { default: getMyTradeHistory } = await import('../../tools/private/get_my_trade_history.js');
		const result = await getMyTradeHistory({});

		assertFail(result);
		expect(result.meta.errorType).toBe('authentication_error');
	});

	it('buy/sell の集計をサマリーに含む', async () => {
		setupFetchMock(mockBitbankSuccess(rawTradeHistoryResponse));

		const { default: getMyTradeHistory } = await import('../../tools/private/get_my_trade_history.js');
		const result = await getMyTradeHistory({});

		assertOk(result);
		expect(result.summary).toContain('買 2件');
		expect(result.summary).toContain('売 1件');
	});
});
