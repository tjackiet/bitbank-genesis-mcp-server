/**
 * strategies/bb_breakout.ts - ボリンジャーバンドブレイクアウト戦略
 *
 * エントリー: 価格が下部バンド（-stddev σ）を下回った後、中央線（SMA）を上抜け
 * エグジット: 価格が上部バンド（+stddev σ）に到達
 */

import type { Candle } from '../../types.js';
import type { Strategy, Signal, Overlay, ParamValidationResult } from './types.js';
import { calculateSMA } from '../sma.js';

/**
 * BB戦略のデフォルトパラメータ
 */
const DEFAULT_PARAMS = {
  period: 20,
  stddev: 2,
};

/**
 * 標準偏差を計算
 */
function calculateStdDev(values: number[], period: number, sma: number[]): number[] {
  const result: number[] = new Array(values.length).fill(NaN);

  for (let i = period - 1; i < values.length; i++) {
    const mean = sma[i];
    if (isNaN(mean)) continue;

    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += Math.pow(values[j] - mean, 2);
    }
    result[i] = Math.sqrt(sumSq / period);
  }

  return result;
}

/**
 * ボリンジャーバンドを計算
 */
function calculateBollingerBands(
  closes: number[],
  period: number,
  stddevMultiplier: number
): { middle: number[]; upper: number[]; lower: number[] } {
  const middle = calculateSMA(closes, period);
  const stddev = calculateStdDev(closes, period, middle);

  const upper: number[] = new Array(closes.length).fill(NaN);
  const lower: number[] = new Array(closes.length).fill(NaN);

  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(middle[i]) && !isNaN(stddev[i])) {
      upper[i] = middle[i] + stddevMultiplier * stddev[i];
      lower[i] = middle[i] - stddevMultiplier * stddev[i];
    }
  }

  return { middle, upper, lower };
}

/**
 * パラメータのバリデーション
 */
export function validateParams(params: Record<string, number>): ParamValidationResult {
  const errors: string[] = [];
  const normalized = { ...DEFAULT_PARAMS, ...params };

  if (normalized.period < 5) {
    errors.push('period must be at least 5');
  }
  if (normalized.stddev <= 0) {
    errors.push('stddev must be positive');
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedParams: normalized,
  };
}

/**
 * ボリンジャーバンドブレイクアウト戦略
 */
export const bbBreakoutStrategy: Strategy = {
  name: 'Bollinger Bands Breakout',
  type: 'bb_breakout',
  requiredBars: 25,
  defaultParams: DEFAULT_PARAMS,

  generate(candles: Candle[], params: Record<string, number>): Signal[] {
    const { period, stddev } = { ...DEFAULT_PARAMS, ...params };
    const closes = candles.map(c => c.close);
    const { middle, upper, lower } = calculateBollingerBands(closes, period, stddev);

    const signals: Signal[] = [];
    const startIdx = period + 1;

    // 下部バンドを下回ったかどうかを追跡
    let belowLowerBand = false;

    for (let i = 0; i < candles.length; i++) {
      if (i < startIdx) {
        signals.push({ time: candles[i].time, action: 'hold' });
        continue;
      }

      const close = closes[i];
      const prevClose = closes[i - 1];
      const mid = middle[i];
      const prevMid = middle[i - 1];
      const up = upper[i];
      const low = lower[i];
      const prevLow = lower[i - 1];

      if (isNaN(mid) || isNaN(up) || isNaN(low) || isNaN(prevMid) || isNaN(prevLow)) {
        signals.push({ time: candles[i].time, action: 'hold' });
        continue;
      }

      // 下部バンドを下回ったら追跡開始
      if (prevClose <= prevLow) {
        belowLowerBand = true;
      }

      // エントリー: 下部バンドを下回った後、中央線を上抜け
      if (belowLowerBand && prevClose <= prevMid && close > mid) {
        signals.push({
          time: candles[i].time,
          action: 'buy',
          reason: `BB Breakout: Price crossed above middle band (${mid.toFixed(0)})`,
        });
        belowLowerBand = false; // リセット
      }
      // エグジット: 上部バンドに到達
      else if (close >= up) {
        signals.push({
          time: candles[i].time,
          action: 'sell',
          reason: `BB Upper Band reached: ${up.toFixed(0)}`,
        });
        belowLowerBand = false; // リセット
      }
      // シグナルなし
      else {
        signals.push({ time: candles[i].time, action: 'hold' });
      }
    }

    return signals;
  },

  getOverlays(candles: Candle[], params: Record<string, number>): Overlay[] {
    const { period, stddev } = { ...DEFAULT_PARAMS, ...params };
    const closes = candles.map(c => c.close);
    const { middle, upper, lower } = calculateBollingerBands(closes, period, stddev);

    return [
      {
        type: 'line',
        name: `BB Middle(${period})`,
        color: '#fbbf24', // yellow（Closeの青と区別）
        data: middle,
      },
      {
        type: 'band',
        name: `BB ±${stddev}σ`,
        color: '#a855f7', // purple
        fillColor: 'rgba(168, 85, 247, 0.15)',
        data: { upper, middle, lower },
      },
    ];
  },
};

export default bbBreakoutStrategy;
