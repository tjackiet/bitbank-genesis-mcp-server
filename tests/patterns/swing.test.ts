import { describe, expect, it } from 'vitest';
import type { Candle } from '../../tools/patterns/swing.js';
import { detectSwingPoints, filterPeaks, filterValleys } from '../../tools/patterns/swing.js';

/** V字のローソク足データを生成するヘルパー */
function makeCandles(prices: number[]): Candle[] {
	return prices.map((p) => ({
		open: p,
		close: p,
		high: p + 1,
		low: p - 1,
	}));
}

describe('detectSwingPoints', () => {
	it('空配列は空を返す', () => {
		expect(detectSwingPoints([], { swingDepth: 2 })).toEqual([]);
	});

	it('データが少なすぎる場合は空を返す', () => {
		const candles = makeCandles([100, 110, 100]);
		expect(detectSwingPoints(candles, { swingDepth: 3 })).toEqual([]);
	});

	it('明確なスイングハイを検出する', () => {
		// 上昇→ピーク→下降
		const prices = [100, 110, 120, 130, 120, 110, 100];
		const candles = makeCandles(prices);
		const pivots = detectSwingPoints(candles, { swingDepth: 2 });
		const peaks = pivots.filter((p) => p.kind === 'H');
		expect(peaks.length).toBeGreaterThanOrEqual(1);
		expect(peaks[0].idx).toBe(3);
	});

	it('明確なスイングローを検出する', () => {
		// 下降→ボトム→上昇
		const prices = [130, 120, 110, 100, 110, 120, 130];
		const candles = makeCandles(prices);
		const pivots = detectSwingPoints(candles, { swingDepth: 2 });
		const valleys = pivots.filter((p) => p.kind === 'L');
		expect(valleys.length).toBeGreaterThanOrEqual(1);
		expect(valleys[0].idx).toBe(3);
	});

	it('strictPivots=false で緩和モードを使用', () => {
		const prices = [100, 110, 120, 130, 125, 120, 100];
		const candles = makeCandles(prices);
		const pivots = detectSwingPoints(candles, { swingDepth: 2, strictPivots: false });
		// 緩和モードでもスイングを検出
		expect(pivots.length).toBeGreaterThanOrEqual(1);
	});

	it('ピボットの価格は close を使用する', () => {
		const candles: Candle[] = [
			{ open: 100, close: 100, high: 105, low: 95 },
			{ open: 110, close: 110, high: 115, low: 105 },
			{ open: 120, close: 125, high: 130, low: 115 },
			{ open: 110, close: 110, high: 115, low: 105 },
			{ open: 100, close: 100, high: 105, low: 95 },
		];
		const pivots = detectSwingPoints(candles, { swingDepth: 1 });
		const peaks = pivots.filter((p) => p.kind === 'H');
		if (peaks.length > 0) {
			// price は close 値（125）であって high（130）ではない
			expect(peaks[0].price).toBe(125);
		}
	});
});

describe('filterPeaks', () => {
	it('H のみをフィルタする', () => {
		const pivots = [
			{ idx: 0, price: 100, kind: 'H' as const },
			{ idx: 1, price: 90, kind: 'L' as const },
			{ idx: 2, price: 110, kind: 'H' as const },
		];
		const peaks = filterPeaks(pivots);
		expect(peaks).toHaveLength(2);
		expect(peaks.every((p) => p.kind === 'H')).toBe(true);
	});

	it('空配列は空を返す', () => {
		expect(filterPeaks([])).toEqual([]);
	});
});

describe('filterValleys', () => {
	it('L のみをフィルタする', () => {
		const pivots = [
			{ idx: 0, price: 100, kind: 'H' as const },
			{ idx: 1, price: 90, kind: 'L' as const },
			{ idx: 2, price: 85, kind: 'L' as const },
		];
		const valleys = filterValleys(pivots);
		expect(valleys).toHaveLength(2);
		expect(valleys.every((p) => p.kind === 'L')).toBe(true);
	});

	it('空配列は空を返す', () => {
		expect(filterValleys([])).toEqual([]);
	});
});
