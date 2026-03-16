/** Create a number[] of given length filled with NaN. */
const nanArray = (len: number): number[] => Array.from<number>({ length: len }).fill(NaN);

/**
 * lib/indicators.ts - テクニカル指標の共通計算モジュール
 *
 * 全指標の純粋な計算関数を提供。
 * リアルタイム分析 (tools/analyze_indicators.ts) と
 * バックテストエンジン (tools/trading_process/) の両方から使用される。
 *
 * 【共通仕様】
 * - 入力: number[]（古い順）
 * - 出力: number[]（データ不足の位置は NaN）
 * - 丸め処理なし（呼び出し元で必要に応じて丸める）
 */

/**
 * 単純移動平均 (SMA)
 *
 * @param prices 価格配列（古い順）
 * @param period 期間（正の整数）
 * @returns SMA配列（先頭 period-1 個は NaN）
 */
export function sma(prices: number[], period: number): number[] {
	if (period <= 0) {
		throw new Error('SMA period must be positive');
	}
	if (prices.length < period) {
		return nanArray(prices.length);
	}

	const result: number[] = nanArray(prices.length);

	let sum = 0;
	for (let i = 0; i < period; i++) {
		sum += prices[i];
	}
	result[period - 1] = sum / period;

	for (let i = period; i < prices.length; i++) {
		sum = sum - prices[i - period] + prices[i];
		result[i] = sum / period;
	}

	return result;
}

/**
 * 指数移動平均 (EMA)
 *
 * 最初の EMA 値は period 区間の SMA をシードとして使用。
 *
 * @param prices 価格配列（古い順）
 * @param period EMA 期間（2 以上）
 * @returns EMA配列（先頭 period-1 個は NaN）
 */
export function ema(prices: number[], period: number): number[] {
	const result: number[] = nanArray(prices.length);

	if (prices.length < period || period < 1) {
		return result;
	}

	// SMA をシードとする
	let sum = 0;
	for (let i = 0; i < period; i++) {
		sum += prices[i];
	}
	result[period - 1] = sum / period;

	const k = 2 / (period + 1);
	for (let i = period; i < prices.length; i++) {
		result[i] = prices[i] * k + result[i - 1] * (1 - k);
	}

	return result;
}

/**
 * RSI (Relative Strength Index) — Wilder's Smoothing
 *
 * @param closes 終値配列（古い順）
 * @param period RSI 期間（通常 14）
 * @returns RSI配列（0–100、先頭 period 個は NaN）
 */
export function rsi(closes: number[], period: number): number[] {
	const result: number[] = nanArray(closes.length);

	if (closes.length < period + 1) {
		return result;
	}

	// 価格変化
	let avgGain = 0;
	let avgLoss = 0;
	for (let i = 1; i <= period; i++) {
		const change = closes[i] - closes[i - 1];
		if (change > 0) avgGain += change;
		else avgLoss += Math.abs(change);
	}
	avgGain /= period;
	avgLoss /= period;

	// 最初の RSI
	if (avgLoss === 0) {
		result[period] = 100;
	} else {
		result[period] = 100 - 100 / (1 + avgGain / avgLoss);
	}

	// Wilder's Smoothing
	for (let i = period + 1; i < closes.length; i++) {
		const change = closes[i] - closes[i - 1];
		const gain = change > 0 ? change : 0;
		const loss = change < 0 ? Math.abs(change) : 0;

		avgGain = (avgGain * (period - 1) + gain) / period;
		avgLoss = (avgLoss * (period - 1) + loss) / period;

		if (avgLoss === 0) {
			result[i] = 100;
		} else {
			result[i] = 100 - 100 / (1 + avgGain / avgLoss);
		}
	}

	return result;
}

/**
 * NaN → null 変換 + オプショナル丸め。
 * analyze_indicators.ts など NumericSeries を返す呼び出し元で使用。
 *
 * @param values number[]（NaN を含む）
 * @param decimals 小数桁数（省略時は丸めなし）
 * @returns (number | null)[]
 */
export function toNumericSeries(values: number[], decimals?: number): (number | null)[] {
	return values.map((v) => {
		if (!Number.isFinite(v)) return null;
		return decimals != null ? Number(v.toFixed(decimals)) : v;
	});
}

// ============================================================
// Bollinger Bands
// ============================================================

/**
 * ボリンジャーバンド
 *
 * @param values 価格配列（古い順）
 * @param period SMA 期間（デフォルト 20）
 * @param stdDev 標準偏差倍率（デフォルト 2）
 * @returns { upper, middle, lower } — 各 number[]（先頭 period-1 個は NaN）
 */
export function bollingerBands(
	values: number[],
	period: number = 20,
	stdDev: number = 2,
): { upper: number[]; middle: number[]; lower: number[] } {
	const n = values.length;
	const upper: number[] = nanArray(n);
	const middle: number[] = nanArray(n);
	const lower: number[] = nanArray(n);

	if (n < period) return { upper, middle, lower };

	// 最初の window の合計
	let sum = 0;
	for (let i = 0; i < period; i++) sum += values[i];

	for (let i = period - 1; i < n; i++) {
		if (i > period - 1) {
			sum = sum - values[i - period] + values[i];
		}
		const mean = sum / period;

		let sumSq = 0;
		for (let j = i - period + 1; j <= i; j++) {
			sumSq += (values[j] - mean) ** 2;
		}
		const std = Math.sqrt(sumSq / period);

		middle[i] = mean;
		upper[i] = mean + stdDev * std;
		lower[i] = mean - stdDev * std;
	}

	return { upper, middle, lower };
}

// ============================================================
// MACD
// ============================================================

/**
 * MACD (Moving Average Convergence Divergence)
 *
 * @param values 価格配列（古い順）
 * @param fast 短期 EMA 期間（デフォルト 12）
 * @param slow 長期 EMA 期間（デフォルト 26）
 * @param signal シグナル EMA 期間（デフォルト 9）
 * @returns { line, signal, hist } — 各 number[]（NaN で埋め）
 */
export function macd(
	values: number[],
	fast: number = 12,
	slow: number = 26,
	signal: number = 9,
): { line: number[]; signal: number[]; hist: number[] } {
	const emaFast = ema(values, fast);
	const emaSlow = ema(values, slow);
	const n = values.length;

	// MACD line = fast EMA - slow EMA
	const line: number[] = nanArray(n);
	for (let i = 0; i < n; i++) {
		if (!isNaN(emaFast[i]) && !isNaN(emaSlow[i])) {
			line[i] = emaFast[i] - emaSlow[i];
		}
	}

	// Signal EMA — 有効な MACD 値のみでシードする
	const validStart = line.findIndex((v) => !isNaN(v));
	const signalLine: number[] = nanArray(n);

	if (validStart >= 0) {
		const validLine = line.slice(validStart).filter((v) => !isNaN(v));
		const sigEma = ema(validLine, signal);
		let idx = 0;
		for (let i = validStart; i < n; i++) {
			if (!isNaN(line[i])) {
				signalLine[i] = sigEma[idx++];
			}
		}
	}

	// Histogram = line - signal
	const hist: number[] = nanArray(n);
	for (let i = 0; i < n; i++) {
		if (!isNaN(line[i]) && !isNaN(signalLine[i])) {
			hist[i] = line[i] - signalLine[i];
		}
	}

	return { line, signal: signalLine, hist };
}

// ============================================================
// Ichimoku Kinko Hyo
// ============================================================

/**
 * 一目均衡表の時系列（全ライン）
 *
 * @returns { tenkan, kijun, spanA, spanB, chikou } — 各 number[]（NaN 埋め）
 */
export function ichimokuSeries(
	highs: number[],
	lows: number[],
	closes: number[],
): { tenkan: number[]; kijun: number[]; spanA: number[]; spanB: number[]; chikou: number[] } {
	const n = highs.length;
	const tenkan: number[] = nanArray(n);
	const kijun: number[] = nanArray(n);
	const spanA: number[] = nanArray(n);
	const spanB: number[] = nanArray(n);

	const tenkanP = 9;
	const kijunP = 26;
	const senkouBP = 52;

	for (let i = 0; i < n; i++) {
		if (i >= tenkanP - 1) {
			const hSlice = highs.slice(i - tenkanP + 1, i + 1);
			const lSlice = lows.slice(i - tenkanP + 1, i + 1);
			tenkan[i] = (Math.max(...hSlice) + Math.min(...lSlice)) / 2;
		}

		if (i >= kijunP - 1) {
			const hSlice = highs.slice(i - kijunP + 1, i + 1);
			const lSlice = lows.slice(i - kijunP + 1, i + 1);
			kijun[i] = (Math.max(...hSlice) + Math.min(...lSlice)) / 2;
		}

		if (!isNaN(tenkan[i]) && !isNaN(kijun[i])) {
			spanA[i] = (tenkan[i] + kijun[i]) / 2;
		}

		if (i >= senkouBP - 1) {
			const hSlice = highs.slice(i - senkouBP + 1, i + 1);
			const lSlice = lows.slice(i - senkouBP + 1, i + 1);
			spanB[i] = (Math.max(...hSlice) + Math.min(...lSlice)) / 2;
		}
	}

	// chikou は終値そのまま（遅行スパンの位置シフトは呼び出し元で行う）
	const chikou = closes.slice();

	return { tenkan, kijun, spanA, spanB, chikou };
}

/**
 * 一目均衡表の最新スナップショット値
 *
 * @returns 最新の conversion/base/spanA/spanB、データ不足なら null
 */
export function ichimokuSnapshot(
	highs: number[],
	lows: number[],
	_closes: number[],
): { conversion: number; base: number; spanA: number; spanB: number } | null {
	if (highs.length < 52 || lows.length < 52) return null;
	const conversion = (Math.max(...highs.slice(-9)) + Math.min(...lows.slice(-9))) / 2;
	const base = (Math.max(...highs.slice(-26)) + Math.min(...lows.slice(-26))) / 2;
	const spanA = (conversion + base) / 2;
	const spanB = (Math.max(...highs.slice(-52)) + Math.min(...lows.slice(-52))) / 2;
	return { conversion, base, spanA, spanB };
}

// ============================================================
// Classic Stochastic Oscillator
// ============================================================

/**
 * クラシック・ストキャスティクス
 *
 * %K_raw = (Close - Low_n) / (High_n - Low_n) * 100
 * %K = SMA(%K_raw, smoothK)
 * %D = SMA(%K, smoothD)
 *
 * @returns { kSeries, dSeries } — 各 number[]（NaN 埋め）
 */
export function stochastic(
	highs: number[],
	lows: number[],
	closes: number[],
	kPeriod: number = 14,
	smoothK: number = 3,
	smoothD: number = 3,
): { kSeries: number[]; dSeries: number[] } {
	const n = Math.min(highs.length, lows.length, closes.length);
	if (n < kPeriod + smoothK + smoothD - 2) {
		return { kSeries: nanArray(n), dSeries: nanArray(n) };
	}

	// Raw %K
	const rawK: number[] = nanArray(n);
	for (let i = kPeriod - 1; i < n; i++) {
		let hi = -Infinity;
		let lo = Infinity;
		for (let j = i - kPeriod + 1; j <= i; j++) {
			if (highs[j] > hi) hi = highs[j];
			if (lows[j] < lo) lo = lows[j];
		}
		const range = hi - lo;
		rawK[i] = range === 0 ? 50 : ((closes[i] - lo) / range) * 100;
	}

	// %K = SMA(rawK, smoothK) — 手動ウィンドウ平均（NaN スキップ）
	const kSeries: number[] = nanArray(n);
	for (let i = 0; i < n; i++) {
		if (isNaN(rawK[i])) continue;
		let sum = 0;
		let cnt = 0;
		for (let j = i - smoothK + 1; j <= i; j++) {
			if (j >= 0 && !isNaN(rawK[j])) {
				sum += rawK[j];
				cnt++;
			}
		}
		if (cnt === smoothK) kSeries[i] = sum / cnt;
	}

	// %D = SMA(%K, smoothD)
	const dSeries: number[] = nanArray(n);
	for (let i = 0; i < n; i++) {
		if (isNaN(kSeries[i])) continue;
		let sum = 0;
		let cnt = 0;
		for (let j = i - smoothD + 1; j <= i; j++) {
			if (j >= 0 && !isNaN(kSeries[j])) {
				sum += kSeries[j];
				cnt++;
			}
		}
		if (cnt === smoothD) dSeries[i] = sum / cnt;
	}

	return { kSeries, dSeries };
}

// ============================================================
// Stochastic RSI
// ============================================================

/**
 * ストキャスティクス RSI
 *
 * RSI 値にストキャスティクス計算を適用。
 *
 * @returns { kSeries, dSeries } — 各 number[]（NaN 埋め）
 */
export function stochRSI(
	closes: number[],
	rsiPeriod: number = 14,
	stochPeriod: number = 14,
	smoothK: number = 3,
	smoothD: number = 3,
): { kSeries: number[]; dSeries: number[] } {
	const rsiValues = rsi(closes, rsiPeriod);
	const n = rsiValues.length;

	const validCount = rsiValues.filter((v) => !isNaN(v)).length;
	if (validCount < stochPeriod + smoothK + smoothD) {
		return { kSeries: nanArray(n), dSeries: nanArray(n) };
	}

	// Raw %K over RSI window
	const rawK: number[] = nanArray(n);
	for (let i = 0; i < n; i++) {
		if (isNaN(rsiValues[i]) || i < stochPeriod - 1) continue;
		const window: number[] = [];
		for (let j = i - stochPeriod + 1; j <= i; j++) {
			if (!isNaN(rsiValues[j])) window.push(rsiValues[j]);
		}
		if (window.length < stochPeriod) continue;
		const lo = Math.min(...window);
		const hi = Math.max(...window);
		const range = hi - lo;
		rawK[i] = range === 0 ? 50 : ((rsiValues[i] - lo) / range) * 100;
	}

	// Smooth rawK → %K
	const kSeries: number[] = nanArray(n);
	for (let i = 0; i < n; i++) {
		if (isNaN(rawK[i])) continue;
		let sum = 0;
		let cnt = 0;
		for (let j = i - smoothK + 1; j <= i; j++) {
			if (j >= 0 && !isNaN(rawK[j])) {
				sum += rawK[j];
				cnt++;
			}
		}
		if (cnt === smoothK) kSeries[i] = sum / cnt;
	}

	// %D = SMA(%K, smoothD)
	const dSeries: number[] = nanArray(n);
	for (let i = 0; i < n; i++) {
		if (isNaN(kSeries[i])) continue;
		let sum = 0;
		let cnt = 0;
		for (let j = i - smoothD + 1; j <= i; j++) {
			if (j >= 0 && !isNaN(kSeries[j])) {
				sum += kSeries[j];
				cnt++;
			}
		}
		if (cnt === smoothD) dSeries[i] = sum / cnt;
	}

	return { kSeries, dSeries };
}

// ============================================================
// True Range / ATR
// ============================================================

/**
 * True Range 系列
 *
 * TR = max(high - low, |high - prevClose|, |low - prevClose|)
 *
 * @param highs 高値配列（古い順）
 * @param lows 安値配列（古い順）
 * @param closes 終値配列（古い順）
 * @returns TR 配列（先頭は NaN — prevClose が存在しない）
 */
export function trueRange(highs: number[], lows: number[], closes: number[]): number[] {
	const n = Math.min(highs.length, lows.length, closes.length);
	if (n < 2) return nanArray(n);

	const result: number[] = nanArray(n);
	for (let i = 1; i < n; i++) {
		const h = highs[i];
		const l = lows[i];
		const pc = closes[i - 1];
		if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(pc)) continue;
		result[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
	}
	return result;
}

/**
 * ATR (Average True Range) — TR の SMA
 *
 * @param highs 高値配列（古い順）
 * @param lows 安値配列（古い順）
 * @param closes 終値配列（古い順）
 * @param period 期間（デフォルト 14）
 * @returns ATR 配列（NaN 埋め、先頭 period 個は NaN）
 */
export function atr(highs: number[], lows: number[], closes: number[], period: number = 14): number[] {
	const tr = trueRange(highs, lows, closes);
	const n = tr.length;
	const result: number[] = nanArray(n);

	if (n < period + 1) return result;

	// TR[0] は NaN なので有効な TR は index 1 から
	// 最初の ATR = SMA of TR[1..period]
	let sum = 0;
	for (let i = 1; i <= period; i++) {
		if (isNaN(tr[i])) return result;
		sum += tr[i];
	}
	result[period] = sum / period;

	// 以降は SMA スライディングウィンドウ
	for (let i = period + 1; i < n; i++) {
		if (isNaN(tr[i])) continue;
		sum = sum - tr[i - period] + tr[i];
		result[i] = sum / period;
	}

	return result;
}

// ============================================================
// OBV (On-Balance Volume)
// ============================================================

/**
 * OBV（出来高累積指標）
 *
 * @param closes 終値配列（古い順）
 * @param volumes 出来高配列（古い順）
 * @returns OBV の累積配列（number[]）
 */
export function obv(closes: number[], volumes: number[]): number[] {
	const n = Math.min(closes.length, volumes.length);
	if (n < 1) return [];

	const result: number[] = [0];
	for (let i = 1; i < n; i++) {
		const prev = result[i - 1];
		if (closes[i] > closes[i - 1]) {
			result.push(prev + volumes[i]);
		} else if (closes[i] < closes[i - 1]) {
			result.push(prev - volumes[i]);
		} else {
			result.push(prev);
		}
	}

	return result;
}
