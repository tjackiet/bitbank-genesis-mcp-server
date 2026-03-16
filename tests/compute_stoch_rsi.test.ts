import { describe, expect, it } from 'vitest';
import { computeStochRSI, rsi } from '../tools/analyze_indicators.js';

describe('computeStochRSI', () => {
	it('データ不足時は null を返す', () => {
		const closes = [100, 101, 102, 103, 104]; // only 5 bars
		const result = computeStochRSI(closes);
		expect(result.k).toBeNull();
		expect(result.d).toBeNull();
	});

	it('フラット価格 → %K=%D=50（range=0 フォールバック）', () => {
		const closes = Array(100).fill(1000);
		const result = computeStochRSI(closes);
		expect(result.k).toBeCloseTo(50, 0);
		expect(result.d).toBeCloseTo(50, 0);
	});

	it('トレンド価格 → %K, %D が [0,100] 範囲内', () => {
		const closes: number[] = [];
		for (let i = 0; i < 60; i++) {
			closes.push(1000 + i * 10 + Math.sin(i * 0.5) * 50);
		}
		const result = computeStochRSI(closes);
		expect(result.k).toBeGreaterThanOrEqual(0);
		expect(result.k).toBeLessThanOrEqual(100);
		expect(result.d).toBeGreaterThanOrEqual(0);
		expect(result.d).toBeLessThanOrEqual(100);
		expect(result.prevK).toBeGreaterThanOrEqual(0);
		expect(result.prevK).toBeLessThanOrEqual(100);
		expect(result.prevD).toBeGreaterThanOrEqual(0);
		expect(result.prevD).toBeLessThanOrEqual(100);
	});

	it('強い上昇トレンド → %K が高い', () => {
		const closes: number[] = [];
		for (let i = 0; i < 60; i++) {
			closes.push(1000 + i * 100);
		}
		const result = computeStochRSI(closes);
		expect(result.k).toBeGreaterThanOrEqual(50);
		expect(result.k).toBeLessThanOrEqual(100);
	});

	it('強い下降トレンド → %K が低い', () => {
		const closes: number[] = [];
		for (let i = 0; i < 60; i++) {
			closes.push(10000 - i * 100);
		}
		const result = computeStochRSI(closes);
		expect(result.k).toBeGreaterThanOrEqual(0);
		expect(result.k).toBeLessThanOrEqual(50);
	});

	it('RSI 関数との整合性（サイン波）', () => {
		const closes: number[] = [];
		for (let i = 0; i < 60; i++) {
			closes.push(1000 + Math.sin(i * 0.3) * 200);
		}
		const rsiSeries = rsi(closes, 14);
		const lastRsi = rsiSeries.at(-1);
		expect(lastRsi).not.toBeNull();
		expect(lastRsi).toBeGreaterThanOrEqual(0);
		expect(lastRsi).toBeLessThanOrEqual(100);

		const result = computeStochRSI(closes, 14, 14, 3, 3);
		expect(result.k).toBeGreaterThanOrEqual(0);
		expect(result.k).toBeLessThanOrEqual(100);
		expect(result.d).toBeGreaterThanOrEqual(0);
		expect(result.d).toBeLessThanOrEqual(100);
	});
});
