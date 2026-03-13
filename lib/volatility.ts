/**
 * lib/volatility.ts - ボラティリティ推定量の共通計算モジュール
 *
 * OHLC ベースのボラティリティ推定量（Parkinson, Garman-Klass, Rogers-Satchell）と
 * リターンベースの計算を提供。
 *
 * 【共通仕様】
 * - 入力: number[]（古い順）
 * - 出力: number[]（各キャンドルごとのコンポーネント値）
 * - 丸め処理なし（呼び出し元で必要に応じて丸める）
 * - safeLog を使用し、ゼロ / 負値入力に対して安全
 */

function safeLog(x: number): number {
  return Math.log(Math.max(x, 1e-12));
}

/**
 * 対数リターン系列
 *
 * ret[i] = ln(close[i] / close[i-1])  （useLog=true の場合）
 * ret[i] = (close[i] - close[i-1]) / close[i-1]  （useLog=false の場合）
 *
 * @param closes 終値配列（古い順）
 * @param useLog true で対数リターン、false で単純リターン（デフォルト true）
 * @returns リターン配列（長さ = closes.length - 1）
 */
export function logReturns(
  closes: number[],
  useLog: boolean = true,
): number[] {
  const result: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev > 0 && curr > 0) {
      result.push(useLog ? safeLog(curr / prev) : (curr - prev) / prev);
    } else {
      result.push(0);
    }
  }
  return result;
}

/**
 * Parkinson ボラティリティのコンポーネント系列
 *
 * pk[i] = (ln(H/L))^2
 * 集約: σ_parkinson = sqrt(mean(pk) / (4 * ln(2)))
 *
 * @param highs 高値配列（古い順）
 * @param lows 安値配列（古い順）
 * @returns per-candle コンポーネント配列
 */
export function parkinsonComponents(
  highs: number[],
  lows: number[],
): number[] {
  const n = Math.min(highs.length, lows.length);
  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    const logHL = safeLog(highs[i] / Math.max(lows[i], 1e-12));
    result.push(logHL * logHL);
  }
  return result;
}

/**
 * Garman-Klass ボラティリティのコンポーネント系列
 *
 * gk[i] = 0.5 * (ln(H/L))^2 - (2*ln(2) - 1) * (ln(C/O))^2
 * 集約: σ_gk = sqrt(mean(gk))
 *
 * @param opens 始値配列
 * @param highs 高値配列
 * @param lows 安値配列
 * @param closes 終値配列
 * @returns per-candle コンポーネント配列
 */
export function garmanKlassComponents(
  opens: number[],
  highs: number[],
  lows: number[],
  closes: number[],
): number[] {
  const n = Math.min(opens.length, highs.length, lows.length, closes.length);
  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    const logHL = safeLog(highs[i] / Math.max(lows[i], 1e-12));
    const logCO = safeLog(closes[i] / Math.max(opens[i], 1e-12));
    const pk = logHL * logHL;
    result.push(0.5 * pk - (2 * Math.log(2) - 1) * (logCO * logCO));
  }
  return result;
}

/**
 * Rogers-Satchell ボラティリティのコンポーネント系列
 *
 * rs[i] = ln(H/C)*ln(H/O) + ln(L/C)*ln(L/O)
 * 集約: σ_rs = sqrt(mean(rs))
 *
 * @param opens 始値配列
 * @param highs 高値配列
 * @param lows 安値配列
 * @param closes 終値配列
 * @returns per-candle コンポーネント配列
 */
export function rogersSatchellComponents(
  opens: number[],
  highs: number[],
  lows: number[],
  closes: number[],
): number[] {
  const n = Math.min(opens.length, highs.length, lows.length, closes.length);
  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    const o = opens[i];
    const rs =
      safeLog(h / Math.max(c, 1e-12)) * safeLog(h / Math.max(o, 1e-12)) +
      safeLog(l / Math.max(c, 1e-12)) * safeLog(l / Math.max(o, 1e-12));
    result.push(rs);
  }
  return result;
}

/**
 * コンポーネント平均からボラティリティ値に変換
 *
 * @param componentMean コンポーネント系列の平均値
 * @param type 推定量タイプ
 * @returns ボラティリティ値（σ）
 */
export function componentMeanToVol(
  componentMean: number,
  type: 'parkinson' | 'garmanKlass' | 'rogersSatchell',
): number {
  switch (type) {
    case 'parkinson':
      return Math.sqrt(Math.max(0, componentMean / (4 * Math.log(2))));
    case 'garmanKlass':
    case 'rogersSatchell':
      return Math.sqrt(Math.max(0, componentMean));
  }
}
