/**
 * get_margin_status ツールのユニットテスト。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertFail, assertOk } from '../_assertResult.js';
import { mockBitbankError, mockBitbankSuccess, rawMarginStatusResponse } from '../fixtures/private-api.js';

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

describe('get_margin_status', () => {
	it('NORMAL ステータスで正常に返す', async () => {
		setupFetchMock(mockBitbankSuccess(rawMarginStatusResponse));

		const { default: getMarginStatus } = await import('../../tools/private/get_margin_status.js');
		const result = await getMarginStatus({});

		assertOk(result);
		expect(result.data.status).toBe('NORMAL');
		expect(result.data.total_margin_balance).toBe('1000000');
		expect(result.data.available_long_margin).toBe('500000');
		expect(result.data.available_short_margin).toBe('450000');
		expect(result.meta.hasWarning).toBe(false);
	});

	it('サマリーに保証金情報を含む', async () => {
		setupFetchMock(mockBitbankSuccess(rawMarginStatusResponse));

		const { default: getMarginStatus } = await import('../../tools/private/get_margin_status.js');
		const result = await getMarginStatus({});

		assertOk(result);
		expect(result.summary).toContain('正常');
		expect(result.summary).toContain('保証金合計');
		expect(result.summary).toContain('保証金率');
		expect(result.summary).toContain('250.00%');
	});

	it('CALL ステータスで警告を返す', async () => {
		const callStatus = { ...rawMarginStatusResponse, status: 'CALL' };
		setupFetchMock(mockBitbankSuccess(callStatus));

		const { default: getMarginStatus } = await import('../../tools/private/get_margin_status.js');
		const result = await getMarginStatus({});

		assertOk(result);
		expect(result.data.status).toBe('CALL');
		expect(result.meta.hasWarning).toBe(true);
		expect(result.summary).toContain('追証発生中');
		expect(result.summary).toContain('追証が発生しています');
	});

	it('LOSSCUT ステータスで警告を返す', async () => {
		const losscutStatus = { ...rawMarginStatusResponse, status: 'LOSSCUT' };
		setupFetchMock(mockBitbankSuccess(losscutStatus));

		const { default: getMarginStatus } = await import('../../tools/private/get_margin_status.js');
		const result = await getMarginStatus({});

		assertOk(result);
		expect(result.data.status).toBe('LOSSCUT');
		expect(result.meta.hasWarning).toBe(true);
		expect(result.summary).toContain('強制決済');
	});

	it('DEBT ステータスで警告を返す', async () => {
		const debtStatus = { ...rawMarginStatusResponse, status: 'DEBT' };
		setupFetchMock(mockBitbankSuccess(debtStatus));

		const { default: getMarginStatus } = await import('../../tools/private/get_margin_status.js');
		const result = await getMarginStatus({});

		assertOk(result);
		expect(result.data.status).toBe('DEBT');
		expect(result.meta.hasWarning).toBe(true);
		expect(result.summary).toContain('不足金が発生しています');
	});

	it('建玉なし（null フィールド）を正常に処理する', async () => {
		const noPositions = {
			...rawMarginStatusResponse,
			total_margin_balance_percentage: null,
			losscut_rate: null,
		};
		setupFetchMock(mockBitbankSuccess(noPositions));

		const { default: getMarginStatus } = await import('../../tools/private/get_margin_status.js');
		const result = await getMarginStatus({});

		assertOk(result);
		expect(result.data.total_margin_balance_percentage).toBeNull();
		expect(result.data.losscut_rate).toBeNull();
		expect(result.summary).not.toContain('保証金率');
		expect(result.summary).not.toContain('強制決済率');
	});

	it('PrivateApiError で fail を返す', async () => {
		setupFetchMock(mockBitbankError(20001), 400);

		const { default: getMarginStatus } = await import('../../tools/private/get_margin_status.js');
		const result = await getMarginStatus({});

		assertFail(result);
		expect(result.meta.errorType).toBe('authentication_error');
	});

	it('非 PrivateApiError の例外で upstream_error を返す', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

		const { default: getMarginStatus } = await import('../../tools/private/get_margin_status.js');
		const result = await getMarginStatus({});

		assertFail(result);
		expect(result.meta.errorType).toBe('upstream_error');
		expect(result.summary).toContain('fetch failed');
	});
});

describe('get_margin_status — handler (toolDef)', () => {
	it('handler がデフォルト引数で動作する', async () => {
		setupFetchMock(mockBitbankSuccess(rawMarginStatusResponse));

		const { toolDef } = await import('../../tools/private/get_margin_status.js');
		const result = await toolDef.handler({});

		expect((result as { ok: boolean }).ok).toBe(true);
	});
});
