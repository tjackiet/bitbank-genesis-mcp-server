/**
 * strategies/sma_cross.ts - SMAクロスオーバー戦略
 *
 * エントリー: 短期SMA > 長期SMA にクロス（ゴールデンクロス）
 * エグジット: 短期SMA < 長期SMA にクロス（デッドクロス）
 */

import type { Candle } from '../../types.js';
import type { Strategy, Signal, Overlay, ParamValidationResult } from './types.js';
import { calculateSMA } from '../sma.js';

/**
 * SMAクロスオーバー戦略のデフォルトパラメータ
 */
const DEFAULT_PARAMS = {
  short: 5,
  long: 20,
};

/**
 * パラメータのバリデーション
 */
export function validateParams(params: Record<string, number>): ParamValidationResult {
  const errors: string[] = [];
  const normalized = { ...DEFAULT_PARAMS, ...params };

  if (normalized.short >= normalized.long) {
    errors.push('short must be less than long');
  }
  if (normalized.short < 2) {
    errors.push('short must be at least 2');
  }
  if (normalized.long < 3) {
    errors.push('long must be at least 3');
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedParams: normalized,
  };
}

/**
 * SMAクロスオーバー戦略
 */
export const smaCrossStrategy: Strategy = {
  name: 'SMA Crossover',
  type: 'sma_cross',
  requiredBars: 30, // 最低でもlong期間 + バッファ
  defaultParams: DEFAULT_PARAMS,

  generate(candles: Candle[], params: Record<string, number>): Signal[] {
    const { short: shortPeriod, long: longPeriod } = { ...DEFAULT_PARAMS, ...params };
    const closes = candles.map(c => c.close);

    const smaShort = calculateSMA(closes, shortPeriod);
    const smaLong = calculateSMA(closes, longPeriod);

    const signals: Signal[] = [];
    const startIdx = longPeriod; // 安全な開始位置

    for (let i = 0; i < candles.length; i++) {
      if (i < startIdx) {
        signals.push({ time: candles[i].time, action: 'hold' });
        continue;
      }

      const prevShort = smaShort[i - 1];
      const prevLong = smaLong[i - 1];
      const currShort = smaShort[i];
      const currLong = smaLong[i];

      // NaN チェック
      if (isNaN(prevShort) || isNaN(prevLong) || isNaN(currShort) || isNaN(currLong)) {
        signals.push({ time: candles[i].time, action: 'hold' });
        continue;
      }

      // ゴールデンクロス: short が long を上抜け
      if (prevShort <= prevLong && currShort > currLong) {
        signals.push({
          time: candles[i].time,
          action: 'buy',
          reason: `Golden Cross: SMA(${shortPeriod}) > SMA(${longPeriod})`,
        });
      }
      // デッドクロス: short が long を下抜け
      else if (prevShort >= prevLong && currShort < currLong) {
        signals.push({
          time: candles[i].time,
          action: 'sell',
          reason: `Dead Cross: SMA(${shortPeriod}) < SMA(${longPeriod})`,
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
    const { short: shortPeriod, long: longPeriod } = { ...DEFAULT_PARAMS, ...params };
    const closes = candles.map(c => c.close);

    const smaShort = calculateSMA(closes, shortPeriod);
    const smaLong = calculateSMA(closes, longPeriod);

    return [
      {
        type: 'line',
        name: `SMA(${shortPeriod})`,
        color: '#fbbf24', // yellow（Closeの青と区別）
        data: smaShort,
      },
      {
        type: 'line',
        name: `SMA(${longPeriod})`,
        color: '#ef4444', // red
        data: smaLong,
      },
    ];
  },
};

export default smaCrossStrategy;
