/**
 * lib/sma.ts - 単純移動平均計算（純粋関数）
 * 
 * 【計算仕様】
 * - 入力: prices[0..n-1]（古い順）
 * - 出力: sma[0..n-1]
 *   - sma[0..period-2] = NaN（データ不足）
 *   - sma[period-1] = 最初の有効なSMA値
 *   - sma[i] = prices[i-period+1..i] の平均（i >= period-1）
 * 
 * 【売買ループでの使用法】
 * - SMA(period) が有効なのは index >= period-1
 * - クロスオーバー判定には sma[i-1] と sma[i] が必要
 * - したがって startIdx = period（安全マージンを含む）から開始
 */

/**
 * 単純移動平均を計算
 * 
 * @param prices 価格配列（古い順）
 * @param period 期間（正の整数）
 * @returns SMA配列
 *          - 先頭 period-1 個は NaN
 *          - result[period-1] が最初の有効なSMA値
 *          - result[i] (i >= period-1) は prices[i-period+1..i] の平均
 * 
 * @example
 * const prices = [100, 102, 104, 103, 105];
 * const sma3 = calculateSMA(prices, 3);
 * // sma3 = [NaN, NaN, 102, 103, 104]
 * // sma3[2] = (100 + 102 + 104) / 3 = 102
 * // sma3[3] = (102 + 104 + 103) / 3 = 103
 * // sma3[4] = (104 + 103 + 105) / 3 = 104
 */
export function calculateSMA(prices: number[], period: number): number[] {
  if (period <= 0) {
    throw new Error('SMA period must be positive');
  }
  if (prices.length < period) {
    return new Array(prices.length).fill(NaN);
  }

  const result: number[] = new Array(prices.length).fill(NaN);

  // 最初のSMA値を計算（単純な合計）
  // result[period-1] = prices[0..period-1] の平均
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  result[period - 1] = sum / period;

  // 以降は差分更新で効率化
  // result[i] = result[i-1] - prices[i-period] / period + prices[i] / period
  for (let i = period; i < prices.length; i++) {
    sum = sum - prices[i - period] + prices[i];
    result[i] = sum / period;
  }

  return result;
}

/**
 * SMAが有効になる最初のインデックスを返す
 * 
 * @param period SMAの期間
 * @returns 最初の有効インデックス（= period - 1）
 */
export function getFirstValidIndex(period: number): number {
  return period - 1;
}

/**
 * 売買ループで安全に使用できる開始インデックスを返す
 * 
 * クロスオーバー判定には sma[i-1] と sma[i] が必要なため、
 * period から開始するのが安全（period-1 は有効だが、period-2 は NaN）
 * 
 * @param period SMAの期間（通常は長期SMAの期間を使用）
 * @returns 売買ループの開始インデックス（= period）
 */
export function getSafeStartIndex(period: number): number {
  return period;
}
