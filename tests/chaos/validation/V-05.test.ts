/**
 * Chaos V-05: get_transactions の count に 0, -1, 999999 を指定
 * 仮説: 境界値が正しく処理される
 */

import { describe, expect, it } from 'vitest';
import { validateLimit } from '../../../lib/validate.js';
import { GetTransactionsInputSchema } from '../../../src/schema/market-data.js';

describe('Chaos: V-05 — count / limit の境界値テスト', () => {
	/** 仮説: 範囲外の値が正しくリジェクトされる */

	// validateLimit のデフォルト: min=1, max=1000
	it('limit = 0 → リジェクト', () => {
		const result = validateLimit(0);
		expect(result.ok).toBe(false);
	});

	it('limit = -1 → リジェクト', () => {
		const result = validateLimit(-1);
		expect(result.ok).toBe(false);
	});

	it('limit = 1 → 通過（下限）', () => {
		const result = validateLimit(1);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe(1);
	});

	it('limit = 1000 → 通過（上限）', () => {
		const result = validateLimit(1000);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe(1000);
	});

	it('limit = 1001 → リジェクト', () => {
		const result = validateLimit(1001);
		expect(result.ok).toBe(false);
	});

	it('limit = 999999 → リジェクト', () => {
		const result = validateLimit(999999);
		expect(result.ok).toBe(false);
	});

	it('limit = NaN → リジェクト', () => {
		const result = validateLimit(Number.NaN);
		expect(result.ok).toBe(false);
	});

	it('limit = Infinity → リジェクト', () => {
		const result = validateLimit(Number.POSITIVE_INFINITY);
		expect(result.ok).toBe(false);
	});

	it('limit = 1.5（小数）→ リジェクト', () => {
		const result = validateLimit(1.5);
		expect(result.ok).toBe(false);
	});

	it('limit = 文字列 "100" → Number() で変換後に通過', () => {
		const result = validateLimit('100');
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe(100);
	});

	it('limit = 文字列 "abc" → リジェクト', () => {
		const result = validateLimit('abc');
		expect(result.ok).toBe(false);
	});

	// Zod スキーマレベル
	it('GetTransactionsInputSchema: limit = 0 → リジェクト', () => {
		const result = GetTransactionsInputSchema.safeParse({ pair: 'btc_jpy', limit: 0 });
		expect(result.success).toBe(false);
	});

	it('GetTransactionsInputSchema: limit = 1001 → リジェクト', () => {
		const result = GetTransactionsInputSchema.safeParse({ pair: 'btc_jpy', limit: 1001 });
		expect(result.success).toBe(false);
	});

	it('GetTransactionsInputSchema: limit 省略 → デフォルト 100', () => {
		const result = GetTransactionsInputSchema.safeParse({ pair: 'btc_jpy' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.limit).toBe(100);
		}
	});
});
