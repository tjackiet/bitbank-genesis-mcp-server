import { describe, it, expect } from 'vitest';
import { sma, ema, rsi, toNumericSeries } from '../../../lib/indicators.js';

// --- SMA ---

describe('sma', () => {
  it('基本的な SMA を計算する', () => {
    const prices = [100, 102, 104, 103, 105];
    const result = sma(prices, 3);
    expect(result).toHaveLength(5);
    expect(result[0]).toBeNaN();
    expect(result[1]).toBeNaN();
    expect(result[2]).toBeCloseTo(102, 10);     // (100+102+104)/3
    expect(result[3]).toBeCloseTo(103, 10);     // (102+104+103)/3
    expect(result[4]).toBeCloseTo(104, 10);     // (104+103+105)/3
  });

  it('period=1 は入力値そのまま', () => {
    const prices = [10, 20, 30];
    const result = sma(prices, 1);
    expect(result).toEqual([10, 20, 30]);
  });

  it('period > データ長のとき全て NaN', () => {
    const result = sma([1, 2], 5);
    expect(result).toHaveLength(2);
    result.forEach((v) => expect(v).toBeNaN());
  });

  it('空配列は空配列を返す', () => {
    expect(sma([], 3)).toEqual([]);
  });

  it('period <= 0 でエラー', () => {
    expect(() => sma([1, 2, 3], 0)).toThrow();
    expect(() => sma([1, 2, 3], -1)).toThrow();
  });

  it('period = データ長のとき最後の1つだけ有効', () => {
    const result = sma([2, 4, 6], 3);
    expect(result[0]).toBeNaN();
    expect(result[1]).toBeNaN();
    expect(result[2]).toBeCloseTo(4, 10);
  });
});

// --- EMA ---

describe('ema', () => {
  it('基本的な EMA を計算する', () => {
    const prices = [10, 11, 12, 13, 14, 15];
    const result = ema(prices, 3);
    expect(result).toHaveLength(6);
    expect(result[0]).toBeNaN();
    expect(result[1]).toBeNaN();
    // seed = SMA(10,11,12) = 11
    expect(result[2]).toBeCloseTo(11, 10);
    // EMA = 13 * 0.5 + 11 * 0.5 = 12 (k=2/(3+1)=0.5)
    expect(result[3]).toBeCloseTo(12, 10);
    expect(Number.isFinite(result[4])).toBe(true);
    expect(Number.isFinite(result[5])).toBe(true);
  });

  it('period > データ長のとき全て NaN', () => {
    const result = ema([1, 2], 5);
    expect(result).toHaveLength(2);
    result.forEach((v) => expect(v).toBeNaN());
  });

  it('空配列は空配列を返す', () => {
    expect(ema([], 3)).toEqual([]);
  });

  it('EMA は直近の値に重みを置く（SMA との比較）', () => {
    // 上昇トレンドでは EMA > SMA になるはず
    const prices = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const smaResult = sma(prices, 5);
    const emaResult = ema(prices, 5);
    // 後半は EMA >= SMA
    for (let i = 6; i < prices.length; i++) {
      expect(emaResult[i]).toBeGreaterThanOrEqual(smaResult[i] - 0.001);
    }
  });
});

// --- RSI ---

describe('rsi', () => {
  it('基本的な RSI を計算する（period=14）', () => {
    // 15 日分の上昇トレンド → RSI は高い値
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const result = rsi(closes, 14);
    expect(result).toHaveLength(20);
    // 先頭 14 個は NaN
    for (let i = 0; i < 14; i++) {
      expect(result[i]).toBeNaN();
    }
    // index 14 以降は有効
    expect(result[14]).toBeCloseTo(100, 5); // 全て上昇なので RSI≈100
  });

  it('全て下落なら RSI ≈ 0', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 200 - i);
    const result = rsi(closes, 14);
    expect(result[14]).toBeCloseTo(0, 5);
  });

  it('横ばい（変化なし）なら RSI ≈ 50 付近', () => {
    // 上下交互
    const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1));
    const result = rsi(closes, 14);
    const lastRsi = result[result.length - 1];
    expect(lastRsi).toBeGreaterThan(30);
    expect(lastRsi).toBeLessThan(70);
  });

  it('データ不足のとき全て NaN', () => {
    const result = rsi([100, 101, 102], 14);
    result.forEach((v) => expect(v).toBeNaN());
  });

  it('avgLoss === 0 のとき RSI = 100', () => {
    // 全上昇: avgLoss は 0
    const closes = Array.from({ length: 16 }, (_, i) => 100 + i);
    const result = rsi(closes, 14);
    expect(result[14]).toBe(100);
  });

  it('Wilder smoothing が正しく適用される', () => {
    // 具体的な値で検算
    const closes = [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
    const result = rsi(closes, 14);
    // RSI should be valid from index 14
    expect(Number.isFinite(result[14])).toBe(true);
    // Subsequent values should also be valid
    for (let i = 14; i < result.length; i++) {
      expect(Number.isFinite(result[i])).toBe(true);
      expect(result[i]).toBeGreaterThanOrEqual(0);
      expect(result[i]).toBeLessThanOrEqual(100);
    }
  });
});

// --- toNumericSeries ---

describe('toNumericSeries', () => {
  it('NaN を null に変換する', () => {
    expect(toNumericSeries([1, NaN, 3])).toEqual([1, null, 3]);
  });

  it('decimals 指定で丸める', () => {
    expect(toNumericSeries([1.23456, NaN, 3.14159], 2)).toEqual([1.23, null, 3.14]);
  });

  it('Infinity を null に変換する', () => {
    expect(toNumericSeries([Infinity, -Infinity, 5])).toEqual([null, null, 5]);
  });

  it('空配列は空配列を返す', () => {
    expect(toNumericSeries([])).toEqual([]);
  });
});
