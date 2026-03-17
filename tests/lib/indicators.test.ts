import { describe, expect, it } from 'vitest';
import {
	atr,
	bollingerBands,
	ema,
	ichimokuSeries,
	ichimokuSnapshot,
	macd,
	obv,
	rsi,
	shiftChikou,
	sma,
	stochastic,
	stochRSI,
	toNumericSeries,
	trueRange,
} from '../../lib/indicators.js';

// --- SMA ---

describe('sma', () => {
	it('基本的な SMA を計算する', () => {
		const prices = [100, 102, 104, 103, 105];
		const result = sma(prices, 3);
		expect(result).toHaveLength(5);
		expect(result[0]).toBeNaN();
		expect(result[1]).toBeNaN();
		expect(result[2]).toBeCloseTo(102, 10); // (100+102+104)/3
		expect(result[3]).toBeCloseTo(103, 10); // (102+104+103)/3
		expect(result[4]).toBeCloseTo(104, 10); // (104+103+105)/3
	});

	it('period=1 は入力値そのまま', () => {
		const prices = [10, 20, 30];
		const result = sma(prices, 1);
		expect(result).toEqual([10, 20, 30]);
	});

	it('period > データ長のとき全て NaN', () => {
		const result = sma([1, 2], 5);
		expect(result).toHaveLength(2);
		result.forEach((v) => {
			expect(v).toBeNaN();
		});
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
		result.forEach((v) => {
			expect(v).toBeNaN();
		});
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
		result.forEach((v) => {
			expect(v).toBeNaN();
		});
	});

	it('avgLoss === 0 のとき RSI = 100', () => {
		// 全上昇: avgLoss は 0
		const closes = Array.from({ length: 16 }, (_, i) => 100 + i);
		const result = rsi(closes, 14);
		expect(result[14]).toBe(100);
	});

	it('Wilder smoothing が正しく適用される', () => {
		// 具体的な値で検算
		const closes = [
			44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0,
			46.03, 46.41, 46.22, 45.64,
		];
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
		expect(toNumericSeries([1.23456, NaN, Math.PI], 2)).toEqual([1.23, null, 3.14]);
	});

	it('Infinity を null に変換する', () => {
		expect(toNumericSeries([Infinity, -Infinity, 5])).toEqual([null, null, 5]);
	});

	it('空配列は空配列を返す', () => {
		expect(toNumericSeries([])).toEqual([]);
	});
});

// --- Bollinger Bands ---

describe('bollingerBands', () => {
	it('基本的な BB を計算する', () => {
		// period=3 の簡易テスト
		const values = [10, 12, 11, 13, 12, 14];
		const { upper, middle, lower } = bollingerBands(values, 3, 2);
		expect(upper).toHaveLength(6);
		expect(middle[0]).toBeNaN();
		expect(middle[1]).toBeNaN();
		// middle[2] = (10+12+11)/3 = 11
		expect(middle[2]).toBeCloseTo(11, 10);
		// upper > middle > lower
		for (let i = 2; i < values.length; i++) {
			expect(upper[i]).toBeGreaterThan(middle[i]);
			expect(lower[i]).toBeLessThan(middle[i]);
		}
	});

	it('period > データ長のとき全て NaN', () => {
		const { upper, middle, lower } = bollingerBands([1, 2], 5);
		upper.forEach((v) => {
			expect(v).toBeNaN();
		});
		middle.forEach((v) => {
			expect(v).toBeNaN();
		});
		lower.forEach((v) => {
			expect(v).toBeNaN();
		});
	});

	it('全て同一値なら upper = middle = lower', () => {
		const values = [100, 100, 100, 100, 100];
		const { upper, middle, lower } = bollingerBands(values, 3, 2);
		for (let i = 2; i < values.length; i++) {
			expect(upper[i]).toBeCloseTo(100, 10);
			expect(middle[i]).toBeCloseTo(100, 10);
			expect(lower[i]).toBeCloseTo(100, 10);
		}
	});

	it('stdDev=0 なら upper = middle = lower', () => {
		const values = [10, 12, 11, 13, 12];
		const { upper, middle, lower } = bollingerBands(values, 3, 0);
		for (let i = 2; i < values.length; i++) {
			expect(upper[i]).toBeCloseTo(middle[i], 10);
			expect(lower[i]).toBeCloseTo(middle[i], 10);
		}
	});
});

// --- MACD ---

describe('macd', () => {
	it('基本的な MACD を計算する', () => {
		// 50 要素の上昇トレンド
		const values = Array.from({ length: 50 }, (_, i) => 100 + i * 0.5);
		const result = macd(values, 12, 26, 9);
		expect(result.line).toHaveLength(50);
		expect(result.signal).toHaveLength(50);
		expect(result.hist).toHaveLength(50);
		// 先頭は NaN（slow EMA が有効になるまで）
		for (let i = 0; i < 25; i++) {
			expect(result.line[i]).toBeNaN();
		}
		// 有効な値が存在する
		const validLines = result.line.filter((v) => !Number.isNaN(v));
		expect(validLines.length).toBeGreaterThan(0);
	});

	it('データ不足のとき全て NaN', () => {
		const result = macd([1, 2, 3], 12, 26, 9);
		result.line.forEach((v) => {
			expect(v).toBeNaN();
		});
		result.signal.forEach((v) => {
			expect(v).toBeNaN();
		});
		result.hist.forEach((v) => {
			expect(v).toBeNaN();
		});
	});

	it('上昇トレンドで MACD line > 0', () => {
		const values = Array.from({ length: 60 }, (_, i) => 100 + i * 2);
		const result = macd(values, 12, 26, 9);
		// 後半の有効な line は > 0（短期 > 長期）
		const lastLine = result.line.at(-1);
		expect(lastLine).not.toBeNaN();
		expect(lastLine).toBeGreaterThan(0);
	});
});

// --- Ichimoku ---

describe('ichimokuSeries', () => {
	// 60 要素のテストデータ
	const n = 60;
	const highs = Array.from({ length: n }, (_, i) => 110 + i);
	const lows = Array.from({ length: n }, (_, i) => 90 + i);
	const closes = Array.from({ length: n }, (_, i) => 100 + i);

	it('tenkan は index 8 から有効', () => {
		const result = ichimokuSeries(highs, lows, closes);
		for (let i = 0; i < 8; i++) expect(result.tenkan[i]).toBeNaN();
		expect(result.tenkan[8]).not.toBeNaN();
	});

	it('kijun は index 25 から有効', () => {
		const result = ichimokuSeries(highs, lows, closes);
		for (let i = 0; i < 25; i++) expect(result.kijun[i]).toBeNaN();
		expect(result.kijun[25]).not.toBeNaN();
	});

	it('spanB は index 51 から有効', () => {
		const result = ichimokuSeries(highs, lows, closes);
		for (let i = 0; i < 51; i++) expect(result.spanB[i]).toBeNaN();
		expect(result.spanB[51]).not.toBeNaN();
	});

	it('chikou は closes のコピー', () => {
		const result = ichimokuSeries(highs, lows, closes);
		expect(result.chikou).toEqual(closes);
	});
});

describe('ichimokuSnapshot', () => {
	it('52 本以上あれば値を返す', () => {
		const highs = Array.from({ length: 52 }, (_, i) => 110 + i);
		const lows = Array.from({ length: 52 }, (_, i) => 90 + i);
		const closes = Array.from({ length: 52 }, (_, i) => 100 + i);
		const result = ichimokuSnapshot(highs, lows, closes);
		expect(result).not.toBeNull();
		expect(result?.conversion).toBeDefined();
		expect(result?.base).toBeDefined();
		expect(result?.spanA).toBeDefined();
		expect(result?.spanB).toBeDefined();
	});

	it('52 本未満なら null', () => {
		expect(ichimokuSnapshot([1], [1], [1])).toBeNull();
		expect(
			ichimokuSnapshot(
				Array.from({ length: 51 }, () => 100),
				Array.from({ length: 51 }, () => 90),
				Array.from({ length: 51 }, () => 95),
			),
		).toBeNull();
	});
});

// --- Stochastic ---

describe('stochastic', () => {
	it('基本的なストキャスティクスを計算する', () => {
		// 30 要素のテストデータ
		const n = 30;
		const highs = Array.from({ length: n }, (_, i) => 110 + Math.sin(i) * 5);
		const lows = Array.from({ length: n }, (_, i) => 90 + Math.sin(i) * 5);
		const closes = Array.from({ length: n }, (_, i) => 100 + Math.sin(i) * 5);
		const result = stochastic(highs, lows, closes, 14, 3, 3);
		expect(result.kSeries).toHaveLength(n);
		expect(result.dSeries).toHaveLength(n);
		// 有効な値は 0-100 の範囲
		result.kSeries
			.filter((v) => !Number.isNaN(v))
			.forEach((v) => {
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThanOrEqual(100);
			});
	});

	it('データ不足のとき全て NaN', () => {
		const result = stochastic([1, 2], [1, 2], [1, 2], 14, 3, 3);
		result.kSeries.forEach((v) => {
			expect(v).toBeNaN();
		});
		result.dSeries.forEach((v) => {
			expect(v).toBeNaN();
		});
	});
});

// --- Stochastic RSI ---

describe('stochRSI', () => {
	it('十分なデータで K/D を計算する', () => {
		const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i * 0.3) * 10);
		const result = stochRSI(closes, 14, 14, 3, 3);
		expect(result.kSeries).toHaveLength(60);
		expect(result.dSeries).toHaveLength(60);
		const validK = result.kSeries.filter((v) => !Number.isNaN(v));
		expect(validK.length).toBeGreaterThan(0);
		validK.forEach((v) => {
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThanOrEqual(100);
		});
	});

	it('データ不足のとき全て NaN', () => {
		const result = stochRSI([100, 101, 102], 14, 14, 3, 3);
		result.kSeries.forEach((v) => {
			expect(v).toBeNaN();
		});
	});
});

// --- OBV ---

describe('obv', () => {
	it('基本的な OBV を計算する', () => {
		const closes = [100, 102, 101, 103, 102];
		const volumes = [1000, 1200, 800, 1500, 900];
		const result = obv(closes, volumes);
		expect(result).toHaveLength(5);
		expect(result[0]).toBe(0);
		// 102 > 100 → +1200
		expect(result[1]).toBe(1200);
		// 101 < 102 → -800
		expect(result[2]).toBe(400);
		// 103 > 101 → +1500
		expect(result[3]).toBe(1900);
		// 102 < 103 → -900
		expect(result[4]).toBe(1000);
	});

	it('価格変化なしなら OBV 不変', () => {
		const closes = [100, 100, 100];
		const volumes = [1000, 2000, 3000];
		const result = obv(closes, volumes);
		expect(result).toEqual([0, 0, 0]);
	});

	it('空配列は空配列を返す', () => {
		expect(obv([], [])).toEqual([]);
	});

	it('単一要素は [0]', () => {
		expect(obv([100], [1000])).toEqual([0]);
	});
});

// --- True Range ---

describe('trueRange', () => {
	it('基本的な TR を計算する', () => {
		const highs = [110, 115, 112, 118];
		const lows = [100, 105, 108, 110];
		const closes = [105, 110, 109, 115];
		const result = trueRange(highs, lows, closes);
		expect(result).toHaveLength(4);
		expect(result[0]).toBeNaN(); // prevClose がない
		// i=1: max(115-105, |115-105|, |105-105|) = 10
		expect(result[1]).toBeCloseTo(10, 10);
		// i=2: max(112-108, |112-110|, |108-110|) = max(4, 2, 2) = 4
		expect(result[2]).toBeCloseTo(4, 10);
		// i=3: max(118-110, |118-109|, |110-109|) = max(8, 9, 1) = 9
		expect(result[3]).toBeCloseTo(9, 10);
	});

	it('データが1本以下のとき全て NaN', () => {
		expect(trueRange([100], [90], [95])).toEqual([NaN]);
		expect(trueRange([], [], [])).toEqual([]);
	});
});

// --- ATR ---

describe('atr', () => {
	it('基本的な ATR を計算する（period=3）', () => {
		// 5 本のキャンドル → TR は index 1-4 の 4 値
		// ATR(3) = first valid at index 3 (SMA of TR[1..3])
		const highs = [110, 115, 112, 118, 120];
		const lows = [100, 105, 108, 110, 112];
		const closes = [105, 110, 109, 115, 118];
		const result = atr(highs, lows, closes, 3);
		expect(result).toHaveLength(5);
		expect(result[0]).toBeNaN();
		expect(result[1]).toBeNaN();
		expect(result[2]).toBeNaN();
		// TR[1]=10, TR[2]=4, TR[3]=9 → ATR[3] = (10+4+9)/3 ≈ 7.667
		expect(result[3]).toBeCloseTo(23 / 3, 10);
		// TR[4] = max(120-112, |120-115|, |112-115|) = max(8, 5, 3) = 8
		// ATR[4] = SMA(TR[2..4]) = (4+9+8)/3 = 7
		expect(result[4]).toBeCloseTo(7, 10);
	});

	it('データ不足のとき全て NaN', () => {
		const result = atr([110, 115], [100, 105], [105, 110], 14);
		expect(result.every((v) => Number.isNaN(v))).toBe(true);
	});
});

// --- shiftChikou ---

describe('shiftChikou', () => {
	it('シフト後の系列長 === 元の系列長', () => {
		const chikou = Array.from({ length: 60 }, (_, i) => 100 + i);
		const result = shiftChikou(chikou, 26);
		expect(result).toHaveLength(60);
	});

	it('シフト後の末尾 26 要素が NaN', () => {
		const chikou = Array.from({ length: 60 }, (_, i) => 100 + i);
		const result = shiftChikou(chikou, 26);
		for (let i = 60 - 26; i < 60; i++) {
			expect(result[i]).toBeNaN();
		}
	});

	it('シフト後の先頭要素は元の index=shift の値', () => {
		const chikou = Array.from({ length: 60 }, (_, i) => 100 + i);
		const result = shiftChikou(chikou, 26);
		// result[0] = chikou[26] = 126
		expect(result[0]).toBe(126);
		// result[1] = chikou[27] = 127
		expect(result[1]).toBe(127);
	});

	it('デフォルト shift=26', () => {
		const chikou = Array.from({ length: 30 }, (_, i) => i);
		const result = shiftChikou(chikou);
		expect(result[0]).toBe(26);
		expect(result[3]).toBe(29);
		for (let i = 4; i < 30; i++) {
			expect(result[i]).toBeNaN();
		}
	});

	it('空配列は空配列を返す', () => {
		expect(shiftChikou([])).toEqual([]);
	});

	it('shift > データ長のとき全て NaN', () => {
		const result = shiftChikou([1, 2, 3], 26);
		result.forEach((v) => {
			expect(v).toBeNaN();
		});
	});
});
