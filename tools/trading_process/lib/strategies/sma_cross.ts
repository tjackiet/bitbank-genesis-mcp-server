/**
 * strategies/sma_cross.ts - SMAクロスオーバー戦略
 *
 * エントリー: 短期SMA > 長期SMA にクロス（ゴールデンクロス）
 * エグジット: 短期SMA < 長期SMA にクロス（デッドクロス）
 *
 * オプションフィルター:
 *   - sma_filter_period: SMAトレンドフィルター（例: 200）。価格がSMA上の場合のみ買い
 *   - rsi_filter_period: RSIフィルター期間（例: 14）。0で無効
 *   - rsi_filter_max: RSI上限（例: 70）。RSIがこの値未満の場合のみ買い
 */

import type { Candle } from '../../types.js';
import type { Strategy, Signal, Overlay, ParamValidationResult } from './types.js';
import { calculateSMA } from '../sma.js';
import { calculateRSI } from './rsi.js';

/**
 * SMAクロスオーバー戦略のデフォルトパラメータ
 */
const DEFAULT_PARAMS: Record<string, number> = {
  short: 5,
  long: 20,
  // フィルター（0 = 無効）
  sma_filter_period: 0,
  rsi_filter_period: 0,
  rsi_filter_max: 100,   // RSI < この値 の場合のみ買い（100=フィルター無効）
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
  if (normalized.sma_filter_period < 0) {
    errors.push('sma_filter_period must be >= 0');
  }
  if (normalized.rsi_filter_period < 0) {
    errors.push('rsi_filter_period must be >= 0');
  }
  if (normalized.rsi_filter_max < 0 || normalized.rsi_filter_max > 100) {
    errors.push('rsi_filter_max must be 0-100');
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedParams: normalized,
  };
}

/**
 * フィルター条件の説明文を生成
 */
function describeFilters(params: Record<string, number>): string {
  const parts: string[] = [];
  if (params.sma_filter_period > 0) {
    parts.push(`SMA${params.sma_filter_period} trend filter`);
  }
  if (params.rsi_filter_period > 0 && params.rsi_filter_max < 100) {
    parts.push(`RSI(${params.rsi_filter_period})<${params.rsi_filter_max}`);
  }
  return parts.length > 0 ? ` [${parts.join(', ')}]` : '';
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
    const p = { ...DEFAULT_PARAMS, ...params };
    const { short: shortPeriod, long: longPeriod } = p;
    const closes = candles.map(c => c.close);

    const smaShort = calculateSMA(closes, shortPeriod);
    const smaLong = calculateSMA(closes, longPeriod);

    // フィルター用の指標を事前計算
    const smaFilter = p.sma_filter_period > 0 ? calculateSMA(closes, p.sma_filter_period) : null;
    const rsi = p.rsi_filter_period > 0 ? calculateRSI(closes, p.rsi_filter_period) : null;

    const signals: Signal[] = [];
    // SMAフィルターが有効な場合、開始インデックスをその分遅らせる
    const baseStartIdx = longPeriod;
    const startIdx = smaFilter ? Math.max(baseStartIdx, p.sma_filter_period) : baseStartIdx;

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
        // フィルター適用（買いシグナルのみにフィルターを適用）
        let filtered = false;

        // SMAトレンドフィルター: 価格がSMA上の場合のみ
        if (smaFilter && !isNaN(smaFilter[i]) && closes[i] < smaFilter[i]) {
          filtered = true;
        }

        // RSIフィルター
        if (rsi && !isNaN(rsi[i]) && rsi[i] >= p.rsi_filter_max) {
          filtered = true;
        }

        if (filtered) {
          signals.push({ time: candles[i].time, action: 'hold' });
        } else {
          const filterDesc = describeFilters(p);
          signals.push({
            time: candles[i].time,
            action: 'buy',
            reason: `Golden Cross: SMA(${shortPeriod}) > SMA(${longPeriod})${filterDesc}`,
          });
        }
      }
      // デッドクロス: short が long を下抜け（エグジットなのでフィルター適用しない）
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
    const p = { ...DEFAULT_PARAMS, ...params };
    const { short: shortPeriod, long: longPeriod } = p;
    const closes = candles.map(c => c.close);

    const smaShort = calculateSMA(closes, shortPeriod);
    const smaLong = calculateSMA(closes, longPeriod);

    const overlays: Overlay[] = [
      {
        type: 'line' as const,
        name: `SMA(${shortPeriod})`,
        color: '#fbbf24', // yellow（Closeの青と区別）
        data: smaShort,
      },
      {
        type: 'line' as const,
        name: `SMA(${longPeriod})`,
        color: '#ef4444', // red
        data: smaLong,
      },
    ];

    // SMAフィルターが有効な場合、SMAラインを価格チャートに表示
    if (p.sma_filter_period > 0) {
      const smaFilter = calculateSMA(closes, p.sma_filter_period);
      overlays.push({
        type: 'line' as const,
        name: `SMA${p.sma_filter_period} (filter)`,
        color: '#8b5cf6', // purple
        data: smaFilter,
        panel: 'price' as const,
      });
    }

    // RSIフィルターが有効な場合、RSIラインをインジケータパネルに表示
    if (p.rsi_filter_period > 0 && p.rsi_filter_max < 100) {
      const rsi = calculateRSI(closes, p.rsi_filter_period);
      overlays.push({
        type: 'line' as const,
        name: `RSI(${p.rsi_filter_period})`,
        color: '#a78bfa',
        data: rsi,
        panel: 'indicator' as const,
      });
    }

    return overlays;
  },
};

export default smaCrossStrategy;
