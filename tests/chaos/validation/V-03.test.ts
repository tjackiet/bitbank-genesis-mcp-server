/**
 * Chaos V-03: get_candles の candleType に未定義の時間軸を指定
 * 仮説: Zod enum バリデーションで拒否
 */

import { describe, expect, it } from 'vitest';
import { CandleTypeEnum } from '../../../src/schema/base.js';

describe('Chaos: V-03 — candleType に未定義の時間軸を指定', () => {
	/** 仮説: Zod enum が未定義の値を拒否する */

	const VALID_TYPES = [
		'1min',
		'5min',
		'15min',
		'30min',
		'1hour',
		'4hour',
		'8hour',
		'12hour',
		'1day',
		'1week',
		'1month',
	];

	const INVALID_TYPES = [
		'2min',
		'3hour',
		'2day',
		'2week',
		'1year',
		'tick',
		'',
		'1MIN',
		'1Hour',
		'1 hour',
		'hour',
		'daily',
		'weekly',
		'monthly',
		'1h',
		'4h',
		'1d',
		'1w',
	];

	it.each(VALID_TYPES)('有効な candleType "%s" は通過する', (type) => {
		const result = CandleTypeEnum.safeParse(type);
		expect(result.success).toBe(true);
	});

	it.each(INVALID_TYPES)('無効な candleType "%s" はリジェクトされる', (type) => {
		const result = CandleTypeEnum.safeParse(type);
		expect(result.success).toBe(false);
	});

	it('数値はリジェクトされる', () => {
		expect(CandleTypeEnum.safeParse(1).success).toBe(false);
		expect(CandleTypeEnum.safeParse(60).success).toBe(false);
	});

	it('null/undefined はリジェクトされる', () => {
		expect(CandleTypeEnum.safeParse(null).success).toBe(false);
		expect(CandleTypeEnum.safeParse(undefined).success).toBe(false);
	});
});
