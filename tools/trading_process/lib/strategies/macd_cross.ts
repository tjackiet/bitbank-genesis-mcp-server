/**
 * strategies/macd_cross.ts - MACDクロスオーバー戦略
 *
 * エントリー: MACDラインがシグナルラインを上抜け（ゴールデンクロス）
 * エグジット: MACDラインがシグナルラインを下抜け（デッドクロス）
 *
 * オプションフィルター:
 *   - sma_filter_period: SMAトレンドフィルター（例: 200）。価格がSMA上の場合のみ買い
 *   - zero_line_filter: ゼロラインフィルター（-1=ゼロ以下のみ, 0=なし, 1=ゼロ以上のみ）
 *   - rsi_filter_period: RSIフィルター期間（例: 14）。0で無効
 *   - rsi_filter_max: RSI上限（例: 70）。RSIがこの値未満の場合のみ買い
 */

import type { Candle } from '../../types.js';
import type { Strategy, Signal, Overlay, ParamValidationResult } from './types.js';
import { calculateSMA } from '../sma.js';
import { calculateRSI } from './rsi.js';

/**
 * MACD戦略のデフォルトパラメータ
 */
const DEFAULT_PARAMS: Record<string, number> = {
  fast: 12,
  slow: 26,
  signal: 9,
  // フィルター（0 = 無効）
  sma_filter_period: 0,
  zero_line_filter: 0,   // -1=below zero only, 0=none, 1=above zero only
  rsi_filter_period: 0,
  rsi_filter_max: 100,   // RSI < この値 の場合のみ買い（100=フィルター無効）
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
  if (normalized.sma_filter_period < 0) {
    errors.push('sma_filter_period must be >= 0');
  }
  if (![- 1, 0, 1].includes(normalized.zero_line_filter)) {
    errors.push('zero_line_filter must be -1, 0, or 1');
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
  if (params.zero_line_filter === 1) {
    parts.push('zero-line: above only');
  } else if (params.zero_line_filter === -1) {
    parts.push('zero-line: below only');
  }
  if (params.rsi_filter_period > 0 && params.rsi_filter_max < 100) {
    parts.push(`RSI(${params.rsi_filter_period})<${params.rsi_filter_max}`);
  }
  return parts.length > 0 ? ` [${parts.join(', ')}]` : '';
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
    const p = { ...DEFAULT_PARAMS, ...params };
    const { fast, slow, signal: signalPeriod } = p;
    const closes = candles.map(c => c.close);
    const { macd, signal, histogram } = calculateMACD(closes, fast, slow, signalPeriod);

    // フィルター用の指標を事前計算
    const sma = p.sma_filter_period > 0 ? calculateSMA(closes, p.sma_filter_period) : null;
    const rsi = p.rsi_filter_period > 0 ? calculateRSI(closes, p.rsi_filter_period) : null;

    const signals: Signal[] = [];
    // SMAフィルターが有効な場合、開始インデックスをその分遅らせる
    const baseStartIdx = slow + signalPeriod;
    const startIdx = sma ? Math.max(baseStartIdx, p.sma_filter_period) : baseStartIdx;

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
        // フィルター適用（買いシグナルのみにフィルターを適用）
        const filterReasons: string[] = [];
        let filtered = false;

        // SMAトレンドフィルター: 価格がSMA上の場合のみ
        if (sma && !isNaN(sma[i]) && closes[i] < sma[i]) {
          filtered = true;
          filterReasons.push(`price(${closes[i].toFixed(0)}) < SMA${p.sma_filter_period}(${sma[i].toFixed(0)})`);
        }

        // ゼロラインフィルター
        if (p.zero_line_filter === 1 && currMACD < 0) {
          filtered = true;
          filterReasons.push(`MACD(${currMACD.toFixed(0)}) below zero`);
        } else if (p.zero_line_filter === -1 && currMACD > 0) {
          filtered = true;
          filterReasons.push(`MACD(${currMACD.toFixed(0)}) above zero`);
        }

        // RSIフィルター
        if (rsi && !isNaN(rsi[i]) && rsi[i] >= p.rsi_filter_max) {
          filtered = true;
          filterReasons.push(`RSI(${rsi[i].toFixed(1)}) >= ${p.rsi_filter_max}`);
        }

        if (filtered) {
          signals.push({ time: candles[i].time, action: 'hold' });
        } else {
          const filterDesc = describeFilters(p);
          signals.push({
            time: candles[i].time,
            action: 'buy',
            reason: `MACD Golden Cross: MACD(${currMACD.toFixed(0)}) > Signal(${currSignal.toFixed(0)})${filterDesc}`,
          });
        }
      }
      // デッドクロス: MACDがシグナルを下抜け（エグジットなのでフィルター適用しない）
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
    const p = { ...DEFAULT_PARAMS, ...params };
    const { fast, slow, signal: signalPeriod } = p;
    const closes = candles.map(c => c.close);
    const { macd, signal, histogram } = calculateMACD(closes, fast, slow, signalPeriod);

    const overlays: Overlay[] = [
      {
        type: 'line' as const,
        name: `MACD(${fast},${slow})`,
        color: '#22c55e',
        data: macd,
        panel: 'indicator' as const,
      },
      {
        type: 'line' as const,
        name: `Signal(${signalPeriod})`,
        color: '#f97316',
        data: signal,
        panel: 'indicator' as const,
      },
      {
        type: 'histogram' as const,
        name: 'Histogram',
        positiveColor: 'rgba(34, 197, 94, 0.7)',
        negativeColor: 'rgba(239, 68, 68, 0.7)',
        data: histogram,
        panel: 'indicator' as const,
      },
    ];

    // SMAフィルターが有効な場合、SMAラインを価格チャートに表示
    if (p.sma_filter_period > 0) {
      const sma = calculateSMA(closes, p.sma_filter_period);
      overlays.push({
        type: 'line' as const,
        name: `SMA${p.sma_filter_period} (filter)`,
        color: '#facc15',
        data: sma,
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

export default macdCrossStrategy;
