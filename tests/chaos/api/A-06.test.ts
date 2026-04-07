/**
 * Chaos A-06: get_candles で存在しないペア名を指定
 * 仮説: lib/validate.ts がリジェクトし、API リクエストが発生しない
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensurePair, normalizePair } from '../../../lib/validate.js';
import getTicker from '../../../tools/get_ticker.js';

describe('Chaos: A-06 — 存在しないペア名を指定', () => {
	/** 仮説: バリデーション層でリジェクトされ、API に到達しない */

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('未対応ペア → ensurePair が失敗', () => {
		const result = ensurePair('foo_bar');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain('未対応');
		}
	});

	it('SQL インジェクション文字列 → normalizePair が null', () => {
		expect(normalizePair("'; DROP TABLE--")).toBeNull();
	});

	it('空文字 → normalizePair が null', () => {
		expect(normalizePair('')).toBeNull();
	});

	it('Unicode 特殊文字 → normalizePair が null', () => {
		expect(normalizePair('btc_🔥')).toBeNull();
	});

	it('大文字ペア名は正規化される', () => {
		expect(normalizePair('BTC_JPY')).toBe('btc_jpy');
	});

	it('スラッシュ区切り（BTC/JPY）は null', () => {
		expect(normalizePair('BTC/JPY')).toBeNull();
	});

	it('未対応ペアで getTicker を呼んでも API に到達しない', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		const result = await getTicker('invalid_pair_xyz');

		expect(result.ok).toBe(false);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('null/undefined → 正常にエラーを返す', () => {
		expect(normalizePair(null)).toBeNull();
		expect(normalizePair(undefined)).toBeNull();

		const r1 = ensurePair(null);
		expect(r1.ok).toBe(false);

		const r2 = ensurePair(undefined);
		expect(r2.ok).toBe(false);
	});
});
