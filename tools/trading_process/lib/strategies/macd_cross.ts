/**
 * strategies/macd_cross.ts - MACDクロスオーバー戦略
 *
 * エントリー: MACDラインがシグナルラインを上抜け（ゴールデンクロス）
 * エグジット: MACDラインがシグナルラインを下抜け（デッドクロス）
 */

import type { Candle } from '../../types.js';
import type { Strategy, Signal, Overlay, ParamValidationResult } from './types.js';

/**
 * MACD戦略のデフォルトパラメータ
 */
const DEFAULT_PARAMS = {
  fast: 12,
  slow: 26,
  signal: 9,
};

/**
 * EMA（指数移動平均）を計算
 *
 * @param prices 価格配列（古い順）
 * @param period EMA期間
 * @returns EMA配列
 */
function calculateEMA(prices: number[], period: number): number[] {
  const result: number[] = new Array(prices.length).fill(NaN);

  if (prices.length < period) {
    return result;
  }

  // 最初のEMAはSMAとして計算
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  result[period - 1] = sum / period;

  // EMA計算（multiplier = 2 / (period + 1)）
  const multiplier = 2 / (period + 1);
  for (let i = period; i < prices.length; i++) {
    result[i] = (prices[i] - result[i - 1]) * multiplier + result[i - 1];
  }

  return result;
}

/**
 * MACDを計算
 *
 * @param closes 終値配列（古い順）
 * @param fastPeriod 短期EMA期間
 * @param slowPeriod 長期EMA期間
 * @param signalPeriod シグナル期間
 * @returns { macd, signal, histogram }
 */
function calculateMACD(
  closes: number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number
): { macd: number[]; signal: number[]; histogram: number[] } {
  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);

  // MACDライン = 短期EMA - 長期EMA
  const macd: number[] = new Array(closes.length).fill(NaN);
  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(fastEMA[i]) && !isNaN(slowEMA[i])) {
      macd[i] = fastEMA[i] - slowEMA[i];
    }
  }

  // シグナルライン = MACDのEMA
  // 有効なMACDの値のみを使ってEMAを計算
  const validMacdStart = slowPeriod - 1;
  const macdForSignal = macd.slice(validMacdStart).filter(v => !isNaN(v));
  const signalEMA = calculateEMA(macdForSignal, signalPeriod);

  // シグナルを元の配列に戻す
  const signal: number[] = new Array(closes.length).fill(NaN);
  let signalIdx = 0;
  for (let i = validMacdStart; i < closes.length; i++) {
    if (!isNaN(macd[i])) {
      signal[i] = signalEMA[signalIdx];
      signalIdx++;
    }
  }

  // ヒストグラム = MACD - シグナル
  const histogram: number[] = new Array(closes.length).fill(NaN);
  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(macd[i]) && !isNaN(signal[i])) {
      histogram[i] = macd[i] - signal[i];
    }
  }

  return { macd, signal, histogram };
}

/**
 * パラメータのバリデーション
 */
export function validateParams(params: Record<string, number>): ParamValidationResult {
  const errors: string[] = [];
  const normalized = { ...DEFAULT_PARAMS, ...params };

  if (normalized.fast >= normalized.slow) {
    errors.push('fast period must be less than slow period');
  }
  if (normalized.fast < 2) {
    errors.push('fast period must be at least 2');
  }
  if (normalized.signal < 2) {
    errors.push('signal period must be at least 2');
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedParams: normalized,
  };
}

/**
 * MACDクロスオーバー戦略
 */
export const macdCrossStrategy: Strategy = {
  name: 'MACD Crossover',
  type: 'macd_cross',
  requiredBars: 35, // slow(26) + signal(9)
  defaultParams: DEFAULT_PARAMS,

  generate(candles: Candle[], params: Record<string, number>): Signal[] {
    const { fast, slow, signal: signalPeriod } = { ...DEFAULT_PARAMS, ...params };
    const closes = candles.map(c => c.close);
    const { macd, signal } = calculateMACD(closes, fast, slow, signalPeriod);

    const signals: Signal[] = [];
    const startIdx = slow + signalPeriod; // MACD + シグナルが有効 + 前日比較用

    for (let i = 0; i < candles.length; i++) {
      if (i < startIdx) {
        signals.push({ time: candles[i].time, action: 'hold' });
        continue;
      }

      const prevMACD = macd[i - 1];
      const prevSignal = signal[i - 1];
      const currMACD = macd[i];
      const currSignal = signal[i];

      if (isNaN(prevMACD) || isNaN(prevSignal) || isNaN(currMACD) || isNaN(currSignal)) {
        signals.push({ time: candles[i].time, action: 'hold' });
        continue;
      }

      // ゴールデンクロス: MACDがシグナルを上抜け
      if (prevMACD <= prevSignal && currMACD > currSignal) {
        signals.push({
          time: candles[i].time,
          action: 'buy',
          reason: `MACD Golden Cross: MACD(${currMACD.toFixed(0)}) > Signal(${currSignal.toFixed(0)})`,
        });
      }
      // デッドクロス: MACDがシグナルを下抜け
      else if (prevMACD >= prevSignal && currMACD < currSignal) {
        signals.push({
          time: candles[i].time,
          action: 'sell',
          reason: `MACD Dead Cross: MACD(${currMACD.toFixed(0)}) < Signal(${currSignal.toFixed(0)})`,
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
    const { fast, slow, signal: signalPeriod } = { ...DEFAULT_PARAMS, ...params };
    const closes = candles.map(c => c.close);
    const { macd, signal } = calculateMACD(closes, fast, slow, signalPeriod);

    // MACDは別のスケールなので、価格チャートには直接描画できない
    // 簡易的にラインとして返す
    return [
      {
        type: 'line',
        name: `MACD(${fast},${slow})`,
        color: '#22c55e', // green（Closeの青と区別）
        data: macd,
      },
      {
        type: 'line',
        name: `Signal(${signalPeriod})`,
        color: '#f97316', // orange
        data: signal,
      },
    ];
  },
};

export default macdCrossStrategy;
