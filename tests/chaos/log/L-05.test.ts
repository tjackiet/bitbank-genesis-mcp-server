/**
 * Chaos L-05: 大量のツール呼び出し（1000回）後のログファイルサイズ
 * 仮説: ファイルが肥大化しすぎない、ローテーションの必要性を確認
 */

import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Chaos: L-05 — 大量ログ出力のサイズとパフォーマンス', () => {
	/** 仮説: 大量のログ出力が安全に行え、1レコードあたりのサイズが予測可能 */

	let writtenData: string[] = [];

	beforeEach(() => {
		writtenData = [];
		vi.spyOn(fs, 'existsSync').mockReturnValue(true);
		vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
		vi.spyOn(fs, 'appendFileSync').mockImplementation((_path: unknown, data: unknown) => {
			writtenData.push(String(data));
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('1000回の logToolRun でクラッシュしない', async () => {
		const { logToolRun } = await import('../../../lib/logger.js');

		for (let i = 0; i < 1000; i++) {
			logToolRun({
				tool: 'get_ticker',
				input: { pair: 'btc_jpy' },
				result: { ok: true, summary: `Ticker #${i}`, meta: { fetchedAt: '2026-04-07T00:00:00Z' } },
				ms: 50 + i,
			});
		}

		expect(writtenData.length).toBe(1000);
	});

	it('1レコードあたりのサイズが合理的（< 1KB）', async () => {
		const { logToolRun } = await import('../../../lib/logger.js');

		logToolRun({
			tool: 'get_ticker',
			input: { pair: 'btc_jpy' },
			result: { ok: true, summary: 'BTC/JPY ¥15,000,000', meta: { fetchedAt: '2026-04-07T00:00:00Z' } },
			ms: 100,
		});

		expect(writtenData.length).toBe(1);
		const recordSize = Buffer.byteLength(writtenData[0], 'utf-8');
		expect(recordSize).toBeLessThan(1024); // 1KB 未満
	});

	it('1000回の logTradeAction でクラッシュしない', async () => {
		const { logTradeAction } = await import('../../../lib/logger.js');

		for (let i = 0; i < 1000; i++) {
			logTradeAction({
				type: 'create_order',
				orderId: 10000 + i,
				pair: 'btc_jpy',
				side: 'buy',
				orderType: 'limit',
				amount: '0.001',
				price: String(5000000 + i),
				triggerPrice: null,
				positionSide: null,
				status: 'UNFILLED',
				confirmed: true,
			});
		}

		expect(writtenData.length).toBe(1000);
	});

	it('trade_action レコードのサイズが合理的（< 1KB）', async () => {
		const { logTradeAction } = await import('../../../lib/logger.js');

		logTradeAction({
			type: 'create_order',
			orderId: 99999,
			pair: 'btc_jpy',
			side: 'buy',
			orderType: 'limit',
			amount: '0.001',
			price: '5000000',
			triggerPrice: '4500000',
			positionSide: 'long',
			status: 'UNFILLED',
			confirmed: true,
		});

		expect(writtenData.length).toBe(1);
		const recordSize = Buffer.byteLength(writtenData[0], 'utf-8');
		// trade_action にはチェーンハッシュ（128 hex chars）が含まれるのでやや大きい
		expect(recordSize).toBeLessThan(1024);
	});

	it('1000回の logToolRun の合計サイズ推定（ローテーション要否の判断材料）', async () => {
		const { logToolRun } = await import('../../../lib/logger.js');

		for (let i = 0; i < 1000; i++) {
			logToolRun({
				tool: 'get_ticker',
				input: { pair: 'btc_jpy' },
				result: { ok: true, summary: `BTC/JPY ¥15,000,000`, meta: {} },
				ms: 50,
			});
		}

		const totalBytes = writtenData.reduce((sum, d) => sum + Buffer.byteLength(d, 'utf-8'), 0);
		const avgBytes = totalBytes / 1000;

		// 1000回で数百KBに収まること（1MB未満）
		expect(totalBytes).toBeLessThan(1_000_000);

		// 平均1レコード < 500 bytes
		expect(avgBytes).toBeLessThan(500);

		// 1日1万回呼び出しの場合の推定: ~3-5MB/日（ローテーション不要レベル）
		// この数値はテスト結果のドキュメントとして記録
	});
});
