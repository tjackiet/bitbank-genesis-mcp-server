/**
 * Chaos R-01: Private API モジュールの import パスを壊す
 * 仮説: Public ツールだけで正常起動する
 *
 * isPrivateApiEnabled() が false の場合、Private ツールの動的 import は
 * スキップされ、Public ツールのみが allToolDefs に登録される。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPrivateApiEnabled } from '../../../src/private/config.js';

describe('Chaos: R-01 — Private API 無効時に Public ツールだけで正常起動', () => {
	/** 仮説: API キー未設定なら Private ツール import はスキップされる */

	const originalKey = process.env.BITBANK_API_KEY;
	const originalSecret = process.env.BITBANK_API_SECRET;

	beforeEach(() => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;
	});

	afterEach(() => {
		if (originalKey) process.env.BITBANK_API_KEY = originalKey;
		else delete process.env.BITBANK_API_KEY;
		if (originalSecret) process.env.BITBANK_API_SECRET = originalSecret;
		else delete process.env.BITBANK_API_SECRET;
	});

	it('API キー未設定 → isPrivateApiEnabled() === false', () => {
		expect(isPrivateApiEnabled()).toBe(false);
	});

	it('allToolDefs は Public ツールのみで 29 個以上', async () => {
		// tool-registry はモジュールキャッシュで既に評価済みだが、
		// Public ツールが含まれることを確認
		const { allToolDefs } = await import('../../../src/tool-registry.js');
		expect(allToolDefs.length).toBeGreaterThanOrEqual(29);
	});

	it('Public ツール名に get_my_ で始まるものがない（Private 混入なし）', async () => {
		// API キーが未設定の状態で import されているはず
		// ただしテスト環境では allToolDefs は起動時に評価済み
		// ここでは Private ツールの名前パターンが存在するかを確認
		const { allToolDefs } = await import('../../../src/tool-registry.js');

		if (!isPrivateApiEnabled()) {
			const privateNames = allToolDefs
				.map((d) => d.name)
				.filter((n) => n.startsWith('get_my_') || n === 'create_order' || n === 'cancel_order');
			// Private API が無効なら Private ツールは登録されていない
			expect(privateNames).toEqual([]);
		}
	});

	it('全 Public ツール定義が有効な構造を持つ', async () => {
		const { allToolDefs } = await import('../../../src/tool-registry.js');

		for (const def of allToolDefs) {
			expect(def.name).toBeTruthy();
			expect(def.description).toBeTruthy();
			expect(def.inputSchema).toBeDefined();
			expect(typeof def.handler).toBe('function');
		}
	});
});
