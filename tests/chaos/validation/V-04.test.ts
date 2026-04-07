/**
 * Chaos V-04: 日付パラメータに未来の日付（2099年）を指定
 * 仮説: データなしで空結果を返すか、適切なエラー
 */

import { describe, expect, it } from 'vitest';
import { validateDate } from '../../../lib/validate.js';

describe('Chaos: V-04 — 日付パラメータに異常な値を指定', () => {
	/** 仮説: フォーマットが正しければ通過し、API がデータなしで応答する */

	it('未来の日付（2099年）はフォーマット上は有効', () => {
		const result = validateDate('20991231');
		expect(result.ok).toBe(true);
	});

	it('未来の年（2099）は YYYY フォーマットで有効', () => {
		const result = validateDate('2099', '1day');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe('2099');
		}
	});

	it('過去の日付は有効', () => {
		const result = validateDate('20200101');
		expect(result.ok).toBe(true);
	});

	it('不正な形式（ISO 8601）はリジェクト', () => {
		const result = validateDate('2025-02-20');
		expect(result.ok).toBe(false);
	});

	it('不正な形式（スラッシュ区切り）はリジェクト', () => {
		const result = validateDate('2025/02/20');
		expect(result.ok).toBe(false);
	});

	it('空文字はリジェクト', () => {
		const result = validateDate('');
		expect(result.ok).toBe(false);
	});

	it('文字列はリジェクト', () => {
		const result = validateDate('yesterday');
		expect(result.ok).toBe(false);
	});

	it('3桁はリジェクト', () => {
		const result = validateDate('202');
		expect(result.ok).toBe(false);
	});

	it('9桁はリジェクト', () => {
		const result = validateDate('202501011');
		expect(result.ok).toBe(false);
	});

	it('分足に YYYY（4桁）を渡すとリジェクト（YYYYMMDD 必須）', () => {
		const result = validateDate('2025', '1min');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain('YYYYMMDD');
		}
	});

	it('日足に YYYYMMDD を渡すと YYYY に切り詰められる', () => {
		const result = validateDate('20250101', '1day');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe('2025');
		}
	});

	it('存在しない月日（20251301）もフォーマット上は通過する', () => {
		// validateDate は月日の妥当性は検証しない（API 側の責務）
		const result = validateDate('20251301');
		expect(result.ok).toBe(true);
	});
});
