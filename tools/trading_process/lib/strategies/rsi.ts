/**
 * strategies/rsi.ts - RSI（相対力指数）戦略
 *
 * エントリー: RSI が oversold 以下から上昇（売られすぎから回復）
 * エグジット: RSI が overbought 以上に到達（買われすぎ）
 */

import type { Candle } from '../../types.js';
import type { Strategy, Signal, Overlay, ParamValidationResult } from './types.js';

/**
 * RSI戦略のデフォルトパラメータ
 */
const DEFAULT_PARAMS = {
  period: 14,
  overbought: 70,
  oversold: 30,
};

/**
 * RSIを計算
 *
 * @param closes 終値配列（古い順）
 * @param period RSI期間
 * @returns RSI配列（0-100、先頭period個はNaN）
 */
function calculateRSI(closes: number[], period: number): number[] {
  const result: number[] = new Array(closes.length).fill(NaN);

  if (closes.length < period + 1) {
    return result;
  }

  // 価格変化を計算
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // 最初の平均利益・平均損失を計算
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const change = changes[i];
    if (change > 0) {
      avgGain += change;
    } else {
      avgLoss += Math.abs(change);
    }
  }
  avgGain /= period;
  avgLoss /= period;

  // 最初のRSI
  if (avgLoss === 0) {
    result[period] = 100;
  } else {
    const rs = avgGain / avgLoss;
    result[period] = 100 - 100 / (1 + rs);
  }

  // Wilder's Smoothing Method で続きを計算
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      result[i + 1] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i + 1] = 100 - 100 / (1 + rs);
    }
  }

  return result;
}

/**
 * パラメータのバリデーション
 */
export function validateParams(params: Record<string, number>): ParamValidationResult {
  const errors: string[] = [];
  const normalized = { ...DEFAULT_PARAMS, ...params };

  if (normalized.period < 2) {
    errors.push('period must be at least 2');
  }
  if (normalized.overbought <= normalized.oversold) {
    errors.push('overbought must be greater than oversold');
  }
  if (normalized.oversold < 0 || normalized.oversold > 100) {
    errors.push('oversold must be between 0 and 100');
  }
  if (normalized.overbought < 0 || normalized.overbought > 100) {
    errors.push('overbought must be between 0 and 100');
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedParams: normalized,
  };
}

/**
 * RSI戦略
 */
export const rsiStrategy: Strategy = {
  name: 'RSI',
  type: 'rsi',
  requiredBars: 20,
  defaultParams: DEFAULT_PARAMS,

  generate(candles: Candle[], params: Record<string, number>): Signal[] {
    const { period, overbought, oversold } = { ...DEFAULT_PARAMS, ...params };
    const closes = candles.map(c => c.close);
    const rsi = calculateRSI(closes, period);

    const signals: Signal[] = [];
    const startIdx = period + 1; // RSIが有効 + 前日比較用

    for (let i = 0; i < candles.length; i++) {
      if (i < startIdx) {
        signals.push({ time: candles[i].time, action: 'hold' });
        continue;
      }

      const prevRSI = rsi[i - 1];
      const currRSI = rsi[i];

      if (isNaN(prevRSI) || isNaN(currRSI)) {
        signals.push({ time: candles[i].time, action: 'hold' });
        continue;
      }

      // エントリー: RSI が oversold 以下から上抜け
      if (prevRSI <= oversold && currRSI > oversold) {
        signals.push({
          time: candles[i].time,
          action: 'buy',
          reason: `RSI crossed above ${oversold} (oversold exit): ${currRSI.toFixed(1)}`,
        });
      }
      // エグジット: RSI が overbought 以上に到達
      else if (currRSI >= overbought) {
        signals.push({
          time: candles[i].time,
          action: 'sell',
          reason: `RSI reached overbought (${overbought}): ${currRSI.toFixed(1)}`,
        });
      }
      // シグナルなし
      else {
        signals.push({ time: candles[i].time, action: 'hold' });
      }
    }

    return signals;
  },

  getOverlays(candles: Candle[], params: Record<string, number>): Overlay[] {
    const { period, overbought, oversold } = { ...DEFAULT_PARAMS, ...params };
    const closes = candles.map(c => c.close);
    const rsi = calculateRSI(closes, period);

    // RSIは別のスケールなのでバンドとして表現（実際はサブチャートに表示すべき）
    // ここでは簡易的にRSIの値をオーバーレイとして返す
    return [
      {
        type: 'line',
        name: `RSI(${period})`,
        color: '#a855f7', // purple
        data: rsi, // 注: これは0-100のスケールで、価格チャートには直接描画できない
      },
    ];
  },
};

export default rsiStrategy;
