/**
 * Chaos L-02: ログファイルが書き込み不可（権限なし）
 * 仮説: サーバーはクラッシュせず、stderr に警告を出す（best-effort）
 */

import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Chaos: L-02 — ログファイルが書き込み不可', () => {
	/** 仮説: best-effort ロギングのため、書き込み失敗してもクラッシュしない */

	beforeEach(() => {
		vi.spyOn(fs, 'existsSync').mockReturnValue(true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('appendFileSync が EACCES で throw してもクラッシュしない', async () => {
		vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
			throw new Error('EACCES: permission denied, open ./logs/2026-04-07.jsonl');
		});

		const { log } = await import('../../../lib/logger.js');

		expect(() => {
			log('info', { type: 'test', message: 'permission denied test' });
		}).not.toThrow();
	});

	it('appendFileSync が ENOSPC（ディスクフル）で throw してもクラッシュしない', async () => {
		vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
			throw new Error('ENOSPC: no space left on device');
		});

		const { log } = await import('../../../lib/logger.js');

		expect(() => {
			log('info', { type: 'test', message: 'disk full test' });
		}).not.toThrow();
	});

	it('logTradeAction も書き込み失敗時にクラッシュしない', async () => {
		vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
			throw new Error('EACCES: permission denied');
		});

		const { logTradeAction } = await import('../../../lib/logger.js');

		expect(() => {
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
		}).not.toThrow();
	});

	it('logError も書き込み失敗時にクラッシュしない', async () => {
		vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
			throw new Error('EROFS: read-only file system');
		});

		const { logError } = await import('../../../lib/logger.js');

		expect(() => {
			logError('create_order', new Error('API failure'), { pair: 'btc_jpy' });
		}).not.toThrow();
	});

	it('logToolRun も書き込み失敗時にクラッシュしない', async () => {
		vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
			throw new Error('EACCES: permission denied');
		});

		const { logToolRun } = await import('../../../lib/logger.js');

		expect(() => {
			logToolRun({
				tool: 'get_ticker',
				input: { pair: 'btc_jpy' },
				result: { ok: true, summary: 'test' },
				ms: 100,
			});
		}).not.toThrow();
	});
});
