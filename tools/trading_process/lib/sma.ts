/**
 * lib/sma.ts - 単純移動平均計算（lib/indicators.ts への委譲）
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

import { sma } from '../../../lib/indicators.js';

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
  return sma(prices, period);
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
