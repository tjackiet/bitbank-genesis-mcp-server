/**
 * Chaos L-03: confirmation_token がログに平文で記録されないことを検証
 * 仮説: `***` にマスクされている
 */

import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Chaos: L-03 — confirmation_token がログに平文で記録されない', () => {
	/** 仮説: SENSITIVE_KEYS によりマスクされ、実際のトークン値がログに残らない */

	let writtenRecords: string[] = [];

	beforeEach(() => {
		writtenRecords = [];
		vi.spyOn(fs, 'existsSync').mockReturnValue(true);
		vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
		vi.spyOn(fs, 'appendFileSync').mockImplementation((_path: unknown, data: unknown) => {
			writtenRecords.push(String(data));
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	const REAL_TOKEN = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

	it('logToolRun: input の confirmation_token がマスクされる', async () => {
		const { logToolRun } = await import('../../../lib/logger.js');

		logToolRun({
			tool: 'create_order',
			input: {
				pair: 'btc_jpy',
				amount: '0.001',
				confirmation_token: REAL_TOKEN,
				token_expires_at: 1700000060000,
			},
			result: { ok: true, summary: '注文完了' },
			ms: 200,
		});

		expect(writtenRecords.length).toBeGreaterThan(0);
		for (const record of writtenRecords) {
			expect(record).not.toContain(REAL_TOKEN);
			expect(record).toContain('***');
		}
	});

	it('logToolRun: ネストされた token フィールドもマスクされる', async () => {
		const { logToolRun } = await import('../../../lib/logger.js');

		logToolRun({
			tool: 'create_order',
			input: {
				pair: 'btc_jpy',
				nested: { token: REAL_TOKEN, deep: { secret: 'should_be_masked' } },
			},
			result: { ok: true, summary: 'test' },
			ms: 100,
		});

		for (const record of writtenRecords) {
			expect(record).not.toContain(REAL_TOKEN);
			expect(record).not.toContain('should_be_masked');
		}
	});

	it('logError: input の confirmation_token がマスクされる', async () => {
		const { logError } = await import('../../../lib/logger.js');

		logError('create_order', new Error('failed'), {
			pair: 'btc_jpy',
			confirmation_token: REAL_TOKEN,
		});

		for (const record of writtenRecords) {
			expect(record).not.toContain(REAL_TOKEN);
		}
	});

	it('SENSITIVE_KEYS の全フィールドがマスクされる', async () => {
		const { logToolRun } = await import('../../../lib/logger.js');

		logToolRun({
			tool: 'test_tool',
			input: {
				confirmation_token: 'secret_token_1',
				token: 'secret_token_2',
				key: 'secret_key',
				secret: 'secret_value',
				apiKey: 'api_key_value',
				apiSecret: 'api_secret_value',
				pair: 'btc_jpy', // これはマスクされない
			},
			result: { ok: true, summary: 'test' },
			ms: 50,
		});

		for (const record of writtenRecords) {
			expect(record).not.toContain('secret_token_1');
			expect(record).not.toContain('secret_token_2');
			expect(record).not.toContain('secret_key');
			expect(record).not.toContain('secret_value');
			expect(record).not.toContain('api_key_value');
			expect(record).not.toContain('api_secret_value');
			// pair はマスクされず残る
			expect(record).toContain('btc_jpy');
		}
	});

	it('logTradeAction は input マスクとは無関係（trade 内容をそのまま記録）', async () => {
		const { logTradeAction } = await import('../../../lib/logger.js');

		logTradeAction({
			type: 'create_order',
			orderId: 12345,
			pair: 'btc_jpy',
			side: 'buy',
			orderType: 'limit',
			amount: '0.001',
			price: '5000000',
			triggerPrice: null,
			positionSide: null,
			status: 'UNFILLED',
			confirmed: true,
		});

		// logTradeAction の引数には confirmation_token は含まれない設計
		for (const record of writtenRecords) {
			expect(record).not.toContain('confirmation_token');
		}
	});
});
