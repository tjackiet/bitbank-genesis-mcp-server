/**
 * lib/indicators.ts - テクニカル指標の共通計算モジュール
 *
 * SMA / EMA / RSI の純粋関数を提供。
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
    return new Array(prices.length).fill(NaN);
  }

  const result: number[] = new Array(prices.length).fill(NaN);

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
  const result: number[] = new Array(prices.length).fill(NaN);

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
  const result: number[] = new Array(closes.length).fill(NaN);

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
export function toNumericSeries(
  values: number[],
  decimals?: number,
): (number | null)[] {
  return values.map((v) => {
    if (!Number.isFinite(v)) return null;
    return decimals != null ? Number(v.toFixed(decimals)) : v;
  });
}
