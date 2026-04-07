/**
 * Chaos L-04: チェーンハッシュの整合性検証（verify_log_integrity.ts）
 * 仮説: 改ざんされたログ行を検出する
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Chaos: L-04 — チェーンハッシュの整合性検証', () => {
	/** 仮説: 連続する trade_action ログのハッシュチェーンが改ざんを検出する */

	let writtenRecords: string[] = [];

	beforeEach(() => {
		writtenRecords = [];
		vi.spyOn(fs, 'existsSync').mockReturnValue(true);
		vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
		vi.spyOn(fs, 'appendFileSync').mockImplementation((_path: unknown, data: unknown) => {
			writtenRecords.push(String(data).trim());
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	/** verify_log_integrity.ts と同じハッシュ再計算ロジック */
	function computeHash(record: Record<string, unknown>): string {
		const { _hash: _, ...rest } = record;
		return createHash('sha256').update(JSON.stringify(rest)).digest('hex');
	}

	it('単一の trade_action ログが正しいハッシュを持つ', async () => {
		const { logTradeAction } = await import('../../../lib/logger.js');

		logTradeAction({
			type: 'create_order',
			orderId: 1001,
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

		expect(writtenRecords.length).toBe(1);
		const record = JSON.parse(writtenRecords[0]) as Record<string, unknown>;

		// _hash と _prevHash が存在する
		expect(record._hash).toMatch(/^[0-9a-f]{64}$/);
		expect(record._prevHash).toMatch(/^[0-9a-f]{64}$/);

		// ハッシュ再計算が一致する
		const expectedHash = computeHash(record);
		expect(record._hash).toBe(expectedHash);
	});

	it('連続する trade_action ログでハッシュチェーンが繋がる', async () => {
		const { logTradeAction } = await import('../../../lib/logger.js');

		// 1件目
		logTradeAction({
			type: 'create_order',
			orderId: 2001,
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

		// 2件目
		logTradeAction({
			type: 'cancel_order',
			orderId: 2001,
			pair: 'btc_jpy',
			side: 'buy',
			status: 'CANCELED_UNFILLED',
			confirmed: true,
		});

		expect(writtenRecords.length).toBe(2);
		const record1 = JSON.parse(writtenRecords[0]) as Record<string, unknown>;
		const record2 = JSON.parse(writtenRecords[1]) as Record<string, unknown>;

		// 2件目の _prevHash は 1件目の _hash
		expect(record2._prevHash).toBe(record1._hash);

		// 両方のハッシュが再計算と一致
		expect(record1._hash).toBe(computeHash(record1));
		expect(record2._hash).toBe(computeHash(record2));
	});

	it('改ざんされたレコードは再計算で不一致になる', async () => {
		const { logTradeAction } = await import('../../../lib/logger.js');

		logTradeAction({
			type: 'create_order',
			orderId: 3001,
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

		const record = JSON.parse(writtenRecords[0]) as Record<string, unknown>;
		const originalHash = record._hash;

		// amount を改ざん
		record.amount = '999';

		// 再計算すると元のハッシュと一致しない
		const recomputedHash = computeHash(record);
		expect(recomputedHash).not.toBe(originalHash);
	});

	it('3件連続のチェーン全体を verify_log_integrity と同じロジックで検証', async () => {
		const { logTradeAction } = await import('../../../lib/logger.js');

		for (let i = 0; i < 3; i++) {
			logTradeAction({
				type: 'create_order',
				orderId: 4000 + i,
				pair: 'btc_jpy',
				side: i % 2 === 0 ? 'buy' : 'sell',
				orderType: 'limit',
				amount: '0.001',
				price: String(5000000 + i * 100000),
				triggerPrice: null,
				positionSide: null,
				status: 'UNFILLED',
				confirmed: true,
			});
		}

		expect(writtenRecords.length).toBe(3);

		// verify_log_integrity.ts の検証ロジックを再現
		for (let i = 0; i < writtenRecords.length; i++) {
			const record = JSON.parse(writtenRecords[i]) as Record<string, unknown>;

			// _prevHash の連続性
			// 注意: 同一プロセス内でテストが連続実行されるため、
			// 最初のレコードの _prevHash は前のテストの最後のハッシュになる可能性がある
			// ここではハッシュ再計算の正しさのみ検証
			const expectedHash = computeHash(record);
			expect(record._hash).toBe(expectedHash);

			// 2件目以降は前のレコードの _hash と連続
			if (i > 0) {
				const prevRecord = JSON.parse(writtenRecords[i - 1]) as Record<string, unknown>;
				expect(record._prevHash).toBe(prevRecord._hash);
			}
		}
	});
});
