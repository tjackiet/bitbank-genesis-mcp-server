/**
 * get_margin_positions ツールのユニットテスト。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertFail, assertOk } from '../_assertResult.js';
import { mockBitbankError, mockBitbankSuccess, rawMarginPositionsResponse } from '../fixtures/private-api.js';

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

describe('get_margin_positions', () => {
	it('建玉一覧を返す', async () => {
		setupFetchMock(mockBitbankSuccess(rawMarginPositionsResponse));

		const { default: getMarginPositions } = await import('../../tools/private/get_margin_positions.js');
		const result = await getMarginPositions({});

		assertOk(result);
		expect(result.data.positions).toHaveLength(2);
		expect(result.data.positions[0].pair).toBe('btc_jpy');
		expect(result.data.positions[0].position_side).toBe('long');
		expect(result.data.positions[1].position_side).toBe('short');
		expect(result.meta.positionCount).toBe(2);
	});

	it('ロング/ショートの集計をサマリーに含む', async () => {
		setupFetchMock(mockBitbankSuccess(rawMarginPositionsResponse));

		const { default: getMarginPositions } = await import('../../tools/private/get_margin_positions.js');
		const result = await getMarginPositions({});

		assertOk(result);
		expect(result.summary).toContain('ロング 1件');
		expect(result.summary).toContain('ショート 1件');
	});

	it('建玉ゼロの場合のメッセージを返す', async () => {
		const empty = { ...rawMarginPositionsResponse, positions: [] };
		setupFetchMock(mockBitbankSuccess(empty));

		const { default: getMarginPositions } = await import('../../tools/private/get_margin_positions.js');
		const result = await getMarginPositions({});

		assertOk(result);
		expect(result.data.positions).toHaveLength(0);
		expect(result.summary).toContain('建玉はありません');
	});

	it('pair 指定でフィルタされる', async () => {
		setupFetchMock(mockBitbankSuccess(rawMarginPositionsResponse));

		const { default: getMarginPositions } = await import('../../tools/private/get_margin_positions.js');
		const result = await getMarginPositions({ pair: 'btc_jpy' });

		assertOk(result);
		expect(result.data.positions).toHaveLength(1);
		expect(result.data.positions[0].pair).toBe('btc_jpy');
		expect(result.meta.pair).toBe('btc_jpy');
	});

	it('pair 指定なしで「全ペア」ラベルが表示される', async () => {
		setupFetchMock(mockBitbankSuccess(rawMarginPositionsResponse));

		const { default: getMarginPositions } = await import('../../tools/private/get_margin_positions.js');
		const result = await getMarginPositions({});

		assertOk(result);
		expect(result.summary).toContain('全ペア');
	});

	it('追証発生時にアラートを表示する', async () => {
		const withNotice = {
			...rawMarginPositionsResponse,
			notice: {
				what: '追証',
				occurred_at: 1710000000000,
				amount: '100000',
				due_date_at: 1710200000000,
			},
		};
		setupFetchMock(mockBitbankSuccess(withNotice));

		const { default: getMarginPositions } = await import('../../tools/private/get_margin_positions.js');
		const result = await getMarginPositions({});

		assertOk(result);
		expect(result.meta.hasNotice).toBe(true);
		expect(result.summary).toContain('追証');
		expect(result.summary).toContain('100,000');
	});

	it('不足金がある場合にアラートを表示する', async () => {
		const withPayables = {
			...rawMarginPositionsResponse,
			payables: { amount: '50000' },
		};
		setupFetchMock(mockBitbankSuccess(withPayables));

		const { default: getMarginPositions } = await import('../../tools/private/get_margin_positions.js');
		const result = await getMarginPositions({});

		assertOk(result);
		expect(result.summary).toContain('不足金');
		expect(result.summary).toContain('50,000');
	});

	it('losscut_threshold を返す', async () => {
		setupFetchMock(mockBitbankSuccess(rawMarginPositionsResponse));

		const { default: getMarginPositions } = await import('../../tools/private/get_margin_positions.js');
		const result = await getMarginPositions({});

		assertOk(result);
		expect(result.data.losscut_threshold.individual).toBe('110');
		expect(result.data.losscut_threshold.company).toBe('120');
	});

	it('PrivateApiError で fail を返す', async () => {
		setupFetchMock(mockBitbankError(20001), 400);

		const { default: getMarginPositions } = await import('../../tools/private/get_margin_positions.js');
		const result = await getMarginPositions({});

		assertFail(result);
		expect(result.meta.errorType).toBe('authentication_error');
	});

	it('非 PrivateApiError の例外で upstream_error を返す', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

		const { default: getMarginPositions } = await import('../../tools/private/get_margin_positions.js');
		const result = await getMarginPositions({});

		assertFail(result);
		expect(result.meta.errorType).toBe('upstream_error');
		expect(result.summary).toContain('fetch failed');
	});
});

describe('get_margin_positions — handler (toolDef)', () => {
	it('handler がデフォルト引数で動作する', async () => {
		setupFetchMock(mockBitbankSuccess(rawMarginPositionsResponse));

		const { toolDef } = await import('../../tools/private/get_margin_positions.js');
		const result = await toolDef.handler({});

		expect((result as { ok: boolean }).ok).toBe(true);
	});
});
