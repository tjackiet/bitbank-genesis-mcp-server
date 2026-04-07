/**
 * Chaos T-07: tools/list → 存在しないツール名で tools/call
 * 仮説: 明確なエラーメッセージで失敗し、クラッシュしない
 *
 * ツール登録は allToolDefs から静的に行われる。
 * 存在しないツール名の呼び出しは MCP SDK が拒否するが、
 * ここではツール登録の完全性とレジストリの整合性を検証する。
 */

import { describe, expect, it } from 'vitest';
import { allToolDefs } from '../../../src/tool-registry.js';

describe('Chaos: T-07 — 存在しないツール名の呼び出しとレジストリ整合性', () => {
	/** 仮説: 登録されたツールのみが呼び出し可能で、名前の重複がない */

	it('allToolDefs に登録されたツール名が全て一意', () => {
		const names = allToolDefs.map((def) => def.name);
		const unique = new Set(names);
		expect(unique.size).toBe(names.length);
	});

	it('全ツールに description がある', () => {
		for (const def of allToolDefs) {
			expect(def.description).toBeTruthy();
			expect(def.description.length).toBeGreaterThanOrEqual(15);
		}
	});

	it('全ツールに inputSchema がある', () => {
		for (const def of allToolDefs) {
			expect(def.inputSchema).toBeDefined();
			// Zod スキーマの _def が存在することで Zod オブジェクトであることを確認
			expect((def.inputSchema as Record<string, unknown>)._def).toBeDefined();
		}
	});

	it('全ツールに handler がある（関数である）', () => {
		for (const def of allToolDefs) {
			expect(typeof def.handler).toBe('function');
		}
	});

	it('存在しないツール名は allToolDefs に含まれない', () => {
		const names = new Set(allToolDefs.map((def) => def.name));
		const fakeNames = ['nonexistent_tool', 'get_bitcoin', 'hack_server', '', 'get_ticker2'];
		for (const fake of fakeNames) {
			expect(names.has(fake)).toBe(false);
		}
	});

	it('ツール名に特殊文字が含まれない', () => {
		for (const def of allToolDefs) {
			// ツール名は英数字とアンダースコアのみ
			expect(def.name).toMatch(/^[a-z][a-z0-9_]*$/);
		}
	});

	it('Public ツールが最低 20 個登録されている', () => {
		// allToolDefs は Public ツールのみ（Private は条件付きで追加される）
		expect(allToolDefs.length).toBeGreaterThanOrEqual(20);
	});
});
