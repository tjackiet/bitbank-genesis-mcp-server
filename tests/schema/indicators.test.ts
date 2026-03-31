import { describe, expect, it } from 'vitest';
import { GetIndicatorsInputSchema, IndicatorsInternalSchema } from '../../src/schema/indicators.js';

describe('GetIndicatorsInputSchema', () => {
	it('デフォルト値を適用する', () => {
		const result = GetIndicatorsInputSchema.parse({});
		expect(result.pair).toBe('btc_jpy');
		expect(result.type).toBe('1day');
	});

	it('カスタム値を受け入れる', () => {
		const result = GetIndicatorsInputSchema.parse({ pair: 'eth_jpy', type: '4hour', limit: 500 });
		expect(result.pair).toBe('eth_jpy');
		expect(result.type).toBe('4hour');
		expect(result.limit).toBe(500);
	});

	it('limit 範囲外を拒否する', () => {
		expect(() => GetIndicatorsInputSchema.parse({ limit: 0 })).toThrow();
		expect(() => GetIndicatorsInputSchema.parse({ limit: 1001 })).toThrow();
	});
});

describe('IndicatorsInternalSchema', () => {
	it('空オブジェクトを受け入れる（全 optional）', () => {
		const result = IndicatorsInternalSchema.parse({});
		expect(result).toBeDefined();
	});

	it('SMA 値を受け入れる', () => {
		const result = IndicatorsInternalSchema.parse({
			SMA_5: 100,
			SMA_20: 105,
			SMA_50: 110,
		});
		expect(result.SMA_5).toBe(100);
		expect(result.SMA_20).toBe(105);
	});

	it('null 値を受け入れる', () => {
		const result = IndicatorsInternalSchema.parse({
			SMA_5: null,
			RSI_14: null,
			MACD_line: null,
		});
		expect(result.SMA_5).toBeNull();
	});

	it('OBV_trend の enum 値を受け入れる', () => {
		expect(IndicatorsInternalSchema.parse({ OBV_trend: 'rising' }).OBV_trend).toBe('rising');
		expect(IndicatorsInternalSchema.parse({ OBV_trend: 'falling' }).OBV_trend).toBe('falling');
		expect(IndicatorsInternalSchema.parse({ OBV_trend: 'flat' }).OBV_trend).toBe('flat');
	});

	it('無効な OBV_trend を拒否する', () => {
		expect(() => IndicatorsInternalSchema.parse({ OBV_trend: 'unknown' })).toThrow();
	});
});
