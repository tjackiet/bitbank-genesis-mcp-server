/**
 * Chaos L-01: ログディレクトリが存在しない状態で起動
 * 仮説: ディレクトリが自動作成される or 適切なエラー
 */

import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Chaos: L-01 — ログディレクトリが存在しない状態でログ出力', () => {
	/** 仮説: ensureDir() がディレクトリを自動作成し、ログが書き込まれる */

	let mkdirSyncSpy: ReturnType<typeof vi.spyOn>;
	let appendFileSyncSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		// ファイルシステムをモックして実際のディスク書き込みを防ぐ
		mkdirSyncSpy = vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
		appendFileSyncSpy = vi.spyOn(fs, 'appendFileSync').mockReturnValue(undefined);
		vi.spyOn(fs, 'existsSync').mockReturnValue(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		delete process.env.LOG_DIR;
	});

	it('ディレクトリが存在しない場合、mkdirSync が recursive: true で呼ばれる', async () => {
		// logger モジュールを再 import して最新のモックを使う
		const { log } = await import('../../../lib/logger.js');
		log('info', { type: 'test', message: 'chaos L-01' });

		expect(mkdirSyncSpy).toHaveBeenCalledWith(expect.any(String), { recursive: true });
	});

	it('ディレクトリ作成後にログファイルが書き込まれる', async () => {
		const { log } = await import('../../../lib/logger.js');
		log('info', { type: 'test', message: 'chaos L-01 write' });

		expect(appendFileSyncSpy).toHaveBeenCalled();
		const writeCall = appendFileSyncSpy.mock.calls[0];
		const filePath = writeCall[0] as string;
		expect(filePath).toMatch(/\d{4}-\d{2}-\d{2}\.jsonl$/);
	});

	it('深いネストのログディレクトリも作成できる', async () => {
		process.env.LOG_DIR = '/tmp/chaos-test/deep/nested/logs';
		// モジュールキャッシュをバイパスするため動的 import
		const loggerModule = await import('../../../lib/logger.js');
		loggerModule.log('info', { type: 'test', message: 'deep dir' });

		// mkdirSync が呼ばれることを確認（recursive: true で安全）
		expect(mkdirSyncSpy).toHaveBeenCalled();
	});

	it('ディレクトリ作成に失敗してもクラッシュしない', async () => {
		mkdirSyncSpy.mockImplementation(() => {
			throw new Error('EACCES: permission denied');
		});

		const { log } = await import('../../../lib/logger.js');

		// best-effort: エラーを catch してクラッシュしない
		expect(() => {
			log('info', { type: 'test', message: 'should not crash' });
		}).not.toThrow();
	});
});
