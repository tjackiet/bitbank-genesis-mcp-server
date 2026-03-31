import { describe, expect, it } from 'vitest';
import {
	getConvergenceFactorForTf,
	getDefaultParamsForTf,
	getDefaultToleranceForTf,
	getMinFitForTf,
	getTriangleCoeffForTf,
	getTriangleWindowSize,
	MIN_CONFIDENCE,
	resolveParams,
	SCHEMA_DEFAULTS,
} from '../../tools/patterns/config.js';

describe('MIN_CONFIDENCE', () => {
	it('主要パターン種別が定義されている', () => {
		expect(MIN_CONFIDENCE.triple_top).toBeDefined();
		expect(MIN_CONFIDENCE.double_top).toBeDefined();
		expect(MIN_CONFIDENCE.head_and_shoulders).toBeDefined();
	});

	it('値は 0-1 の範囲', () => {
		for (const v of Object.values(MIN_CONFIDENCE)) {
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThanOrEqual(1);
		}
	});
});

describe('SCHEMA_DEFAULTS', () => {
	it('既定値が正しい', () => {
		expect(SCHEMA_DEFAULTS.swingDepth).toBe(7);
		expect(SCHEMA_DEFAULTS.minBarsBetweenSwings).toBe(5);
		expect(SCHEMA_DEFAULTS.tolerancePct).toBe(0.04);
	});
});

describe('getDefaultParamsForTf', () => {
	it('1hour は swingDepth=3 を返す', () => {
		const p = getDefaultParamsForTf('1hour');
		expect(p.swingDepth).toBe(3);
		expect(p.minBarsBetweenSwings).toBe(2);
	});

	it('1day は swingDepth=6 を返す', () => {
		const p = getDefaultParamsForTf('1day');
		expect(p.swingDepth).toBe(6);
		expect(p.minBarsBetweenSwings).toBe(4);
	});

	it('1week は swingDepth=7 を返す', () => {
		const p = getDefaultParamsForTf('1week');
		expect(p.swingDepth).toBe(7);
	});

	it('不明な時間軸はフォールバックを返す', () => {
		const p = getDefaultParamsForTf('unknown');
		expect(p.swingDepth).toBe(6);
		expect(p.minBarsBetweenSwings).toBe(4);
	});

	it('分足は低い swingDepth を返す', () => {
		expect(getDefaultParamsForTf('5min').swingDepth).toBe(2);
		expect(getDefaultParamsForTf('15min').swingDepth).toBe(3);
		expect(getDefaultParamsForTf('30min').swingDepth).toBe(3);
	});
});

describe('getDefaultToleranceForTf', () => {
	it('1hour は 0.05 を返す', () => {
		expect(getDefaultToleranceForTf('1hour')).toBe(0.05);
	});

	it('1day はフォールバックの 0.04 を返す', () => {
		expect(getDefaultToleranceForTf('1day')).toBe(0.04);
	});

	it('1week は 0.035 を返す', () => {
		expect(getDefaultToleranceForTf('1week')).toBe(0.035);
	});

	it('短期足はより広い許容誤差を返す', () => {
		expect(getDefaultToleranceForTf('15min')).toBe(0.06);
	});
});

describe('getConvergenceFactorForTf', () => {
	it('短期足は 0.6 を返す', () => {
		expect(getConvergenceFactorForTf('1hour')).toBe(0.6);
		expect(getConvergenceFactorForTf('4hour')).toBe(0.6);
	});

	it('デフォルトは 0.8', () => {
		expect(getConvergenceFactorForTf('1day')).toBe(0.8);
		expect(getConvergenceFactorForTf('1week')).toBe(0.8);
	});
});

describe('getTriangleCoeffForTf', () => {
	it('短期足のcoeffを返す', () => {
		const c = getTriangleCoeffForTf('1hour');
		expect(c.flat).toBe(1.2);
		expect(c.move).toBe(0.8);
	});

	it('デフォルトのcoeffを返す', () => {
		const c = getTriangleCoeffForTf('1day');
		expect(c.flat).toBe(0.8);
		expect(c.move).toBe(1.2);
	});
});

describe('getMinFitForTf', () => {
	it('1hour は 0.6', () => {
		expect(getMinFitForTf('1hour')).toBe(0.6);
	});

	it('1day は 0.7', () => {
		expect(getMinFitForTf('1day')).toBe(0.7);
	});

	it('デフォルトは 0.75', () => {
		expect(getMinFitForTf('1week')).toBe(0.75);
	});
});

describe('getTriangleWindowSize', () => {
	it('時間軸ごとに異なるウィンドウサイズ', () => {
		expect(getTriangleWindowSize('1month')).toBe(30);
		expect(getTriangleWindowSize('1week')).toBe(40);
		expect(getTriangleWindowSize('1day')).toBe(50);
		expect(getTriangleWindowSize('1hour')).toBe(40);
	});

	it('デフォルトは 20', () => {
		expect(getTriangleWindowSize('unknown')).toBe(20);
	});
});

describe('resolveParams', () => {
	it('オプションなしで時間軸のデフォルト値を使用', () => {
		const result = resolveParams('1day', {});
		expect(result.swingDepth).toBe(6);
		expect(result.tolerancePct).toBe(0.04);
		expect(result.minBarsBetweenSwings).toBe(4);
		expect(result.autoScaled).toBe(true);
	});

	it('スキーマデフォルト値(7)は時間軸オートに置換', () => {
		const result = resolveParams('1hour', { swingDepth: 7 });
		expect(result.swingDepth).toBe(3); // 1hour のデフォルト
	});

	it('スキーマデフォルトでないカスタム値はそのまま使用', () => {
		const result = resolveParams('1day', { swingDepth: 10 });
		expect(result.swingDepth).toBe(10);
		expect(result.autoScaled).toBe(false);
	});

	it('tolerancePct のスキーマデフォルト(0.04)は時間軸オートに置換', () => {
		const result = resolveParams('1hour', { tolerancePct: 0.04 });
		expect(result.tolerancePct).toBe(0.05); // 1hour のデフォルト
	});

	it('カスタム tolerancePct はそのまま使用', () => {
		const result = resolveParams('1day', { tolerancePct: 0.1 });
		expect(result.tolerancePct).toBe(0.1);
	});
});
