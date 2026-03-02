/**
 * analyze_candle_patterns - ローソク足パターン検出（1〜3本足）
 *
 * 設計思想:
 * - 目的: BTC/JPY の直近5日間のローソク足から短期反転パターンを検出
 * - 対象:
 *   - 1本足: ハンマー、シューティングスター、十字線
 *   - 2本足: 包み線、はらみ線、毛抜き、かぶせ線、切り込み線
 *   - 3本足: 明けの明星、宵の明星、赤三兵、黒三兵
 * - 用途: 初心者向けの自然言語解説 + 過去統計付与
 *
 * 既存ツールとの違い:
 * - detect_patterns: 数週間〜数ヶ月スケールの大型チャートパターン
 * - 本ツール: 1〜3本足の短期反転パターンに特化
 *
 * 🚨 CRITICAL: 配列順序の明示
 * candles配列の順序は常に [最古, ..., 最新] です
 * - index 0: 最古（5日前）
 * - index n-1: 最新（今日、未確定の可能性）
 */

import getCandles from './get_candles.js';
import { ok, fail, failFromError } from '../lib/result.js';
import { createMeta } from '../lib/validate.js';
import { formatPrice as fmtPrice } from '../lib/formatter.js';
import { dayjs, nowIso, toIsoTime, today } from '../lib/datetime.js';
import {
  AnalyzeCandlePatternsInputSchema,
  AnalyzeCandlePatternsOutputSchema,
  CandlePatternTypeEnum,
} from '../src/schemas.js';
import type { Candle, Pair } from '../src/types/domain.d.ts';
import type { ToolDefinition } from '../src/tool-definition.js';
import {
  isBullish, isBearish, bodySize, bodyTop, bodyBottom,
  upperShadow, lowerShadow, totalRange,
} from '../lib/candle-utils.js';

// ----- 型定義 -----
type CandlePatternType = typeof CandlePatternTypeEnum._type;

interface WindowCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  is_partial: boolean;
}

interface HistoryHorizonStats {
  avg_return: number;
  win_rate: number;
  sample: number;
}

interface HistoryStats {
  lookback_days: number;
  occurrences: number;
  horizons: Record<string, HistoryHorizonStats>;
}

interface LocalContext {
  trend_before: 'up' | 'down' | 'neutral';
  volatility_level: 'low' | 'medium' | 'high';
}

interface DetectedCandlePattern {
  pattern: CandlePatternType;
  pattern_jp: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: number;
  candle_range_index: [number, number];
  uses_partial_candle: boolean;
  status: 'confirmed' | 'forming';
  local_context: LocalContext;
  history_stats: HistoryStats | null;
}

// ----- パターンコンテキスト -----
interface PatternContext {
  rangeHigh: number;
  rangeLow: number;
  avgBodySize: number;
}

// ----- 統一パターン定義 -----
interface PatternConfig {
  span: 1 | 2 | 3;
  direction: 'bullish' | 'bearish' | 'neutral';
  jp_name: string;
  detect: (candles: Candle[], context?: PatternContext) => { detected: boolean; strength: number };
}

// ----- ヘルパー関数 -----

/**
 * トレンド判定（直前n本の終値で判定）
 * CRITICAL: candles配列は [最古, ..., 最新] の順序
 */
function detectTrendBefore(
  candles: Candle[],
  endIndex: number,
  lookbackCount: number = 3
): 'up' | 'down' | 'neutral' {
  if (endIndex < lookbackCount) return 'neutral';

  let upCount = 0;
  let downCount = 0;

  for (let i = endIndex - lookbackCount + 1; i <= endIndex; i++) {
    if (i > 0 && candles[i].close > candles[i - 1].close) {
      upCount++;
    } else if (i > 0 && candles[i].close < candles[i - 1].close) {
      downCount++;
    }
  }

  const threshold = Math.ceil(lookbackCount * 0.6);
  if (upCount >= threshold) return 'up';
  if (downCount >= threshold) return 'down';
  return 'neutral';
}

/**
 * ボラティリティレベルの判定
 */
function detectVolatilityLevel(
  candles: Candle[],
  endIndex: number,
  lookbackCount: number = 5
): 'low' | 'medium' | 'high' {
  if (endIndex < lookbackCount) return 'medium';

  const recentCandles = candles.slice(Math.max(0, endIndex - lookbackCount + 1), endIndex + 1);
  const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
  const avgRange = recentCandles.reduce((sum, c) => sum + (c.high - c.low), 0) / recentCandles.length;
  const rangePct = (avgRange / avgPrice) * 100;

  if (rangePct < 1.5) return 'low';
  if (rangePct > 3.0) return 'high';
  return 'medium';
}

// =====================================================================
// パターン検出関数
// =====================================================================

// ----- 1本足パターン (Phase 3) -----

/**
 * ハンマー (hammer) の検出
 * 条件: 長い下ヒゲ、小さい実体（上部）、短い上ヒゲ
 */
function detectHammer(candles: Candle[], _context?: PatternContext): { detected: boolean; strength: number } {
  const c = candles[0];
  const range = totalRange(c);
  if (range === 0) return { detected: false, strength: 0 };

  const body = bodySize(c);
  const lower = lowerShadow(c);
  const upper = upperShadow(c);
  const bodyRatio = body / range;

  // 実体はレンジの5%〜35%（dojiと区別 & 大きすぎない）
  if (bodyRatio < 0.05 || bodyRatio > 0.35) return { detected: false, strength: 0 };
  // 下ヒゲが実体の2倍以上
  if (lower < body * 2) return { detected: false, strength: 0 };
  // 上ヒゲがレンジの25%以下
  if (upper / range > 0.25) return { detected: false, strength: 0 };
  // 下ヒゲがレンジの60%以上
  if (lower / range < 0.60) return { detected: false, strength: 0 };

  const strength = Math.min((lower / range - 0.4) / 0.6, 1.0);
  return { detected: true, strength };
}

/**
 * シューティングスター (shooting_star) の検出
 * 条件（ハンマーの逆）: 長い上ヒゲ、小さい実体（下部）、短い下ヒゲ
 */
function detectShootingStar(candles: Candle[], _context?: PatternContext): { detected: boolean; strength: number } {
  const c = candles[0];
  const range = totalRange(c);
  if (range === 0) return { detected: false, strength: 0 };

  const body = bodySize(c);
  const lower = lowerShadow(c);
  const upper = upperShadow(c);
  const bodyRatio = body / range;

  if (bodyRatio < 0.05 || bodyRatio > 0.35) return { detected: false, strength: 0 };
  if (upper < body * 2) return { detected: false, strength: 0 };
  if (lower / range > 0.25) return { detected: false, strength: 0 };
  if (upper / range < 0.60) return { detected: false, strength: 0 };

  const strength = Math.min((upper / range - 0.4) / 0.6, 1.0);
  return { detected: true, strength };
}

/**
 * 十字線 (doji) の検出
 * 条件: 実体がレンジの5%未満（始値≒終値）
 * ヒゲの偏りで亜種を判別:
 *   - 上下均等 → 通常十字線, 下ヒゲ優勢 → トンボ型, 上ヒゲ優勢 → トウバ型
 */
function detectDoji(candles: Candle[], _context?: PatternContext): { detected: boolean; strength: number } {
  const c = candles[0];
  const range = totalRange(c);
  if (range === 0) return { detected: false, strength: 0 };

  const body = bodySize(c);
  if (body / range >= 0.05) return { detected: false, strength: 0 };

  const upper = upperShadow(c);
  const lower = lowerShadow(c);
  const shadowImbalance = Math.abs(upper - lower) / range;
  const strength = Math.min(0.5 + shadowImbalance * 0.5, 1.0);

  return { detected: true, strength };
}

// ----- 2本足パターン (Phase 1-2) -----

/** 陽線包み線 (bullish_engulfing): 陰線 → それを完全に包む陽線 */
function detectBullishEngulfing(candles: Candle[]): { detected: boolean; strength: number } {
  const [c1, c2] = candles;
  if (!isBearish(c1) || !isBullish(c2)) return { detected: false, strength: 0 };
  if (!(c2.open <= c1.close && c2.close >= c1.open)) return { detected: false, strength: 0 };

  const body1 = bodySize(c1);
  const body2 = bodySize(c2);
  const strength = Math.min((body1 > 0 ? body2 / body1 : 1) / 2, 1.0);
  return { detected: true, strength };
}

/** 陰線包み線 (bearish_engulfing): 陽線 → それを完全に包む陰線 */
function detectBearishEngulfing(candles: Candle[]): { detected: boolean; strength: number } {
  const [c1, c2] = candles;
  if (!isBullish(c1) || !isBearish(c2)) return { detected: false, strength: 0 };
  if (!(c2.open >= c1.close && c2.close <= c1.open)) return { detected: false, strength: 0 };

  const body1 = bodySize(c1);
  const body2 = bodySize(c2);
  const strength = Math.min((body1 > 0 ? body2 / body1 : 1) / 2, 1.0);
  return { detected: true, strength };
}

/** 陽線はらみ線 (bullish_harami): 大陰線 → 小さいローソク足が内包 */
function detectBullishHarami(candles: Candle[]): { detected: boolean; strength: number } {
  const [c1, c2] = candles;
  if (!isBearish(c1)) return { detected: false, strength: 0 };
  if (!(bodyTop(c2) <= bodyTop(c1) && bodyBottom(c2) >= bodyBottom(c1))) return { detected: false, strength: 0 };

  const body1 = bodySize(c1);
  const body2 = bodySize(c2);
  if (body1 === 0 || body2 >= body1 * 0.7) return { detected: false, strength: 0 };

  return { detected: true, strength: Math.min(1 - body2 / body1, 1.0) };
}

/** 陰線はらみ線 (bearish_harami): 大陽線 → 小さいローソク足が内包 */
function detectBearishHarami(candles: Candle[]): { detected: boolean; strength: number } {
  const [c1, c2] = candles;
  if (!isBullish(c1)) return { detected: false, strength: 0 };
  if (!(bodyTop(c2) <= bodyTop(c1) && bodyBottom(c2) >= bodyBottom(c1))) return { detected: false, strength: 0 };

  const body1 = bodySize(c1);
  const body2 = bodySize(c2);
  if (body1 === 0 || body2 >= body1 * 0.7) return { detected: false, strength: 0 };

  return { detected: true, strength: Math.min(1 - body2 / body1, 1.0) };
}

/** 毛抜き天井 (tweezer_top): 2日連続で高値がほぼ同じ（±0.5%） */
function detectTweezerTop(candles: Candle[], context?: PatternContext): { detected: boolean; strength: number } {
  const [c1, c2] = candles;
  const avgHigh = (c1.high + c2.high) / 2;
  const highDiff = Math.abs(c1.high - c2.high);
  if (highDiff > avgHigh * 0.005) return { detected: false, strength: 0 };

  if (context) {
    const range = context.rangeHigh - context.rangeLow;
    const threshold = context.rangeHigh - range * 0.2;
    if (c1.high < threshold && c2.high < threshold) return { detected: false, strength: 0 };
  }

  const strength = Math.max(0, Math.min(1 - (highDiff / avgHigh) * 100, 1.0));
  return { detected: true, strength };
}

/** 毛抜き底 (tweezer_bottom): 2日連続で安値がほぼ同じ（±0.5%） */
function detectTweezerBottom(candles: Candle[], context?: PatternContext): { detected: boolean; strength: number } {
  const [c1, c2] = candles;
  const avgLow = (c1.low + c2.low) / 2;
  const lowDiff = Math.abs(c1.low - c2.low);
  if (lowDiff > avgLow * 0.005) return { detected: false, strength: 0 };

  if (context) {
    const range = context.rangeHigh - context.rangeLow;
    const threshold = context.rangeLow + range * 0.2;
    if (c1.low > threshold && c2.low > threshold) return { detected: false, strength: 0 };
  }

  const strength = Math.max(0, Math.min(1 - (lowDiff / avgLow) * 100, 1.0));
  return { detected: true, strength };
}

/** かぶせ線 (dark_cloud_cover) */
function detectDarkCloudCover(candles: Candle[], context?: PatternContext): { detected: boolean; strength: number } {
  const [c1, c2] = candles;
  if (!isBullish(c1) || !isBearish(c2)) return { detected: false, strength: 0 };

  const body1 = bodySize(c1);
  const avgBody = context?.avgBodySize || body1;
  if (body1 < avgBody * 1.5) return { detected: false, strength: 0 };

  const gapTol = body1 * 0.1;
  if (c2.open < c1.close - gapTol) return { detected: false, strength: 0 };

  const midPoint = (c1.open + c1.close) / 2;
  if (c2.close >= midPoint) return { detected: false, strength: 0 };
  if (c2.close <= c1.open) return { detected: false, strength: 0 };

  return { detected: true, strength: Math.min((midPoint - c2.close) / body1, 1.0) };
}

/** 切り込み線 (piercing_line) */
function detectPiercingLine(candles: Candle[], context?: PatternContext): { detected: boolean; strength: number } {
  const [c1, c2] = candles;
  if (!isBearish(c1) || !isBullish(c2)) return { detected: false, strength: 0 };

  const body1 = bodySize(c1);
  const avgBody = context?.avgBodySize || body1;
  if (body1 < avgBody * 1.5) return { detected: false, strength: 0 };

  const gapTol = body1 * 0.1;
  if (c2.open > c1.close + gapTol) return { detected: false, strength: 0 };

  const midPoint = (c1.open + c1.close) / 2;
  if (c2.close <= midPoint) return { detected: false, strength: 0 };
  if (c2.close >= c1.open) return { detected: false, strength: 0 };

  return { detected: true, strength: Math.min((c2.close - midPoint) / body1, 1.0) };
}

// ----- 3本足パターン (Phase 3) -----

/**
 * 明けの明星 (morning_star)
 * 大陰線→小さい実体→大陽線で1本目の中心値超え
 */
function detectMorningStar(candles: Candle[], context?: PatternContext): { detected: boolean; strength: number } {
  const [c1, c2, c3] = candles;
  if (!isBearish(c1) || !isBullish(c3)) return { detected: false, strength: 0 };

  const body1 = bodySize(c1);
  const body2 = bodySize(c2);
  const body3 = bodySize(c3);
  const avgBody = context?.avgBodySize || body1;

  if (body1 < avgBody * 0.8) return { detected: false, strength: 0 };
  if (body2 > body1 * 0.4) return { detected: false, strength: 0 };
  if (body3 < avgBody * 0.8) return { detected: false, strength: 0 };

  const midPointC1 = (c1.open + c1.close) / 2;
  if (c3.close < midPointC1) return { detected: false, strength: 0 };

  // BTC24h緩和: 2本目の実体下端が1本目の実体下端以下
  if (bodyBottom(c2) > bodyBottom(c1)) return { detected: false, strength: 0 };

  const recovery = c3.close - midPointC1;
  return { detected: true, strength: Math.min(recovery / body1 + 0.3, 1.0) };
}

/**
 * 宵の明星 (evening_star)
 * 大陽線→小さい実体→大陰線で1本目の中心値割れ
 */
function detectEveningStar(candles: Candle[], context?: PatternContext): { detected: boolean; strength: number } {
  const [c1, c2, c3] = candles;
  if (!isBullish(c1) || !isBearish(c3)) return { detected: false, strength: 0 };

  const body1 = bodySize(c1);
  const body2 = bodySize(c2);
  const body3 = bodySize(c3);
  const avgBody = context?.avgBodySize || body1;

  if (body1 < avgBody * 0.8) return { detected: false, strength: 0 };
  if (body2 > body1 * 0.4) return { detected: false, strength: 0 };
  if (body3 < avgBody * 0.8) return { detected: false, strength: 0 };

  const midPointC1 = (c1.open + c1.close) / 2;
  if (c3.close > midPointC1) return { detected: false, strength: 0 };

  // BTC24h緩和: 2本目の実体上端が1本目の実体上端以上
  if (bodyTop(c2) < bodyTop(c1)) return { detected: false, strength: 0 };

  const decline = midPointC1 - c3.close;
  return { detected: true, strength: Math.min(decline / body1 + 0.3, 1.0) };
}

/**
 * 赤三兵 (three_white_soldiers)
 * 3本連続陽線、各終値が前を上回る、始値は前の実体内
 */
function detectThreeWhiteSoldiers(candles: Candle[], context?: PatternContext): { detected: boolean; strength: number } {
  const [c1, c2, c3] = candles;
  if (!isBullish(c1) || !isBullish(c2) || !isBullish(c3)) return { detected: false, strength: 0 };
  if (c2.close <= c1.close || c3.close <= c2.close) return { detected: false, strength: 0 };

  const body1 = bodySize(c1);
  const body2 = bodySize(c2);
  const body3 = bodySize(c3);
  const avgBody = context?.avgBodySize || (body1 + body2 + body3) / 3;

  if (body1 < avgBody * 0.5 || body2 < avgBody * 0.5 || body3 < avgBody * 0.5) return { detected: false, strength: 0 };

  // 各始値が前の実体内またはその近辺
  const tol2 = body1 * 0.5;
  const tol3 = body2 * 0.5;
  if (c2.open < bodyBottom(c1) - tol2 || c2.open > bodyTop(c1) + tol2) return { detected: false, strength: 0 };
  if (c3.open < bodyBottom(c2) - tol3 || c3.open > bodyTop(c2) + tol3) return { detected: false, strength: 0 };

  // 上ヒゲが短い
  for (const c of [c1, c2, c3]) {
    const r = totalRange(c);
    if (r > 0 && upperShadow(c) / r > 0.4) return { detected: false, strength: 0 };
  }

  const maxBody = Math.max(body1, body2, body3);
  const minBody = Math.min(body1, body2, body3);
  return { detected: true, strength: Math.min(minBody / maxBody + 0.2, 1.0) };
}

/**
 * 黒三兵 (three_black_crows)
 * 3本連続陰線、各終値が前を下回る
 */
function detectThreeBlackCrows(candles: Candle[], context?: PatternContext): { detected: boolean; strength: number } {
  const [c1, c2, c3] = candles;
  if (!isBearish(c1) || !isBearish(c2) || !isBearish(c3)) return { detected: false, strength: 0 };
  if (c2.close >= c1.close || c3.close >= c2.close) return { detected: false, strength: 0 };

  const body1 = bodySize(c1);
  const body2 = bodySize(c2);
  const body3 = bodySize(c3);
  const avgBody = context?.avgBodySize || (body1 + body2 + body3) / 3;

  if (body1 < avgBody * 0.5 || body2 < avgBody * 0.5 || body3 < avgBody * 0.5) return { detected: false, strength: 0 };

  const tol2 = body1 * 0.5;
  const tol3 = body2 * 0.5;
  if (c2.open < bodyBottom(c1) - tol2 || c2.open > bodyTop(c1) + tol2) return { detected: false, strength: 0 };
  if (c3.open < bodyBottom(c2) - tol3 || c3.open > bodyTop(c2) + tol3) return { detected: false, strength: 0 };

  // 下ヒゲが短い
  for (const c of [c1, c2, c3]) {
    const r = totalRange(c);
    if (r > 0 && lowerShadow(c) / r > 0.4) return { detected: false, strength: 0 };
  }

  const maxBody = Math.max(body1, body2, body3);
  const minBody = Math.min(body1, body2, body3);
  return { detected: true, strength: Math.min(minBody / maxBody + 0.2, 1.0) };
}

// =====================================================================
// パターン定義レジストリ
// =====================================================================

const PATTERN_CONFIGS: Record<CandlePatternType, PatternConfig> = {
  // 1本足
  hammer:         { span: 1, direction: 'bullish', jp_name: 'ハンマー（カラカサ）', detect: detectHammer },
  shooting_star:  { span: 1, direction: 'bearish', jp_name: 'シューティングスター（流れ星）', detect: detectShootingStar },
  doji:           { span: 1, direction: 'neutral', jp_name: '十字線（Doji）', detect: detectDoji },
  // 2本足
  bullish_engulfing:  { span: 2, direction: 'bullish', jp_name: '陽線包み線', detect: detectBullishEngulfing },
  bearish_engulfing:  { span: 2, direction: 'bearish', jp_name: '陰線包み線', detect: detectBearishEngulfing },
  bullish_harami:     { span: 2, direction: 'bullish', jp_name: '陽線はらみ線', detect: detectBullishHarami },
  bearish_harami:     { span: 2, direction: 'bearish', jp_name: '陰線はらみ線', detect: detectBearishHarami },
  tweezer_top:        { span: 2, direction: 'bearish', jp_name: '毛抜き天井', detect: detectTweezerTop },
  tweezer_bottom:     { span: 2, direction: 'bullish', jp_name: '毛抜き底', detect: detectTweezerBottom },
  dark_cloud_cover:   { span: 2, direction: 'bearish', jp_name: 'かぶせ線', detect: detectDarkCloudCover },
  piercing_line:      { span: 2, direction: 'bullish', jp_name: '切り込み線', detect: detectPiercingLine },
  // 3本足
  morning_star:           { span: 3, direction: 'bullish', jp_name: '明けの明星', detect: detectMorningStar },
  evening_star:           { span: 3, direction: 'bearish', jp_name: '宵の明星', detect: detectEveningStar },
  three_white_soldiers:   { span: 3, direction: 'bullish', jp_name: '赤三兵', detect: detectThreeWhiteSoldiers },
  three_black_crows:      { span: 3, direction: 'bearish', jp_name: '黒三兵', detect: detectThreeBlackCrows },
};

// ----- 過去統計計算 -----
interface PatternOccurrence {
  index: number;
  pattern: CandlePatternType;
  basePrice: number;
}

/**
 * 過去のパターン出現を検索（span 対応）
 */
function findHistoricalPatterns(
  candles: Candle[],
  pattern: CandlePatternType,
  excludeLastN: number = 1
): PatternOccurrence[] {
  const config = PATTERN_CONFIGS[pattern];
  const occurrences: PatternOccurrence[] = [];

  const endIndex = candles.length - 1 - excludeLastN;

  for (let i = config.span - 1; i <= endIndex; i++) {
    const slice = candles.slice(i - config.span + 1, i + 1);
    const result = config.detect(slice);
    if (result.detected) {
      occurrences.push({
        index: i,
        pattern,
        basePrice: candles[i].close,
      });
    }
  }

  return occurrences;
}

/**
 * 過去統計を計算
 */
function calculateHistoryStats(
  candles: Candle[],
  pattern: CandlePatternType,
  horizons: number[],
  lookbackDays: number
): HistoryStats | null {
  // lookbackDays分のデータがあるか確認
  if (candles.length < lookbackDays) {
    return null;
  }

  // lookbackDays期間内のパターンを検索
  const startIndex = candles.length - lookbackDays;
  const relevantCandles = candles.slice(startIndex);

  const occurrences = findHistoricalPatterns(relevantCandles, pattern, 5);

  if (occurrences.length < 5) {
    // サンプル数が少なすぎる場合はnull
    return null;
  }

  const horizonStats: Record<string, HistoryHorizonStats> = {};

  for (const h of horizons) {
    const returns: number[] = [];

    for (const occ of occurrences) {
      // グローバルインデックスに変換
      const globalIndex = startIndex + occ.index;

      // h本後のデータが存在するか確認
      if (globalIndex + h < candles.length) {
        const futureCandle = candles[globalIndex + h];
        const returnPct = ((futureCandle.close - occ.basePrice) / occ.basePrice) * 100;
        returns.push(returnPct);
      }
    }

    if (returns.length > 0) {
      const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const winCount = returns.filter((r) => r > 0).length;
      const winRate = winCount / returns.length;

      horizonStats[String(h)] = {
        avg_return: Number(avgReturn.toFixed(2)),
        win_rate: Number(winRate.toFixed(2)),
        sample: returns.length,
      };
    }
  }

  return {
    lookback_days: lookbackDays,
    occurrences: occurrences.length,
    horizons: horizonStats,
  };
}

// ----- サマリー生成 -----
function generateSummary(
  patterns: DetectedCandlePattern[],
  windowCandles: WindowCandle[]
): string {
  if (patterns.length === 0) {
    const trend = windowCandles.length >= 3
      ? (windowCandles[windowCandles.length - 1].close > windowCandles[0].close ? '上昇' : '下落')
      : '横ばい';
    return `直近${windowCandles.length}日間で${trend}傾向ですが、特徴的なローソク足パターンは検出されませんでした。`;
  }

  const parts: string[] = [];

  for (const p of patterns) {
    const trendText = p.local_context.trend_before === 'down' ? '下落傾向' : p.local_context.trend_before === 'up' ? '上昇傾向' : '横ばい';
    const statusText = p.status === 'forming' ? '形成中（未確定）' : '確定';
    const directionText = p.direction === 'bullish'
      ? '上昇転換のサイン'
      : p.direction === 'bearish'
        ? '下落転換のサイン'
        : '方向感の迷いを示すサイン';

    let statsPart = '';
    if (p.history_stats && p.history_stats.horizons['1']) {
      const h1 = p.history_stats.horizons['1'];
      statsPart = `過去${p.history_stats.lookback_days}日間で同様のパターンが${p.history_stats.occurrences}回出現し、翌日の勝率は${(h1.win_rate * 100).toFixed(0)}%でした。`;
    }

    parts.push(
      `${trendText}の中で「${p.pattern_jp}」（${statusText}）が検出されました。これは${directionText}とされます。${statsPart}`
    );

    if (p.uses_partial_candle) {
      parts.push('⚠️ 本日の日足は未確定のため、終値確定後にパターンが変化する可能性があります。');
    }
  }

  return parts.join(' ');
}

// ----- ヘルパー: 金額フォーマット -----
function formatPrice(price: number): string {
  return fmtPrice(Math.round(price));
}

// ----- ヘルパー: 曜日取得 -----
function getDayOfWeek(isoDate: string): string {
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return days[dayjs(isoDate).utc().day()];
}

// ----- ヘルパー: 日付フォーマット (MM/DD(曜)) -----
function formatDateWithDay(isoDate: string): string {
  const d = dayjs(isoDate).utc();
  const m = d.month() + 1;
  const day = d.date();
  const dow = getDayOfWeek(isoDate);
  return `${m}/${day}(${dow})`;
}

// ----- コンテント生成（LLM向け詳細テキスト） -----
function generateContent(
  patterns: DetectedCandlePattern[],
  windowCandles: WindowCandle[]
): Array<{ type: 'text'; text: string }> {
  const lines: string[] = [];

  lines.push('【ローソク足パターン分析結果】');
  lines.push('');
  lines.push(`分析期間: ${windowCandles[0]?.timestamp?.split('T')[0] || '?'} 〜 ${windowCandles[windowCandles.length - 1]?.timestamp?.split('T')[0] || '?'}`);
  lines.push('');

  // === 1. 5日間のローソク足データ（最優先） ===
  lines.push(`=== ${windowCandles.length}日間のローソク足 ===`);
  for (let i = 0; i < windowCandles.length; i++) {
    const c = windowCandles[i];
    const dateStr = formatDateWithDay(c.timestamp);
    const change = c.close - c.open;
    const changeSign = change >= 0 ? '+' : '-';
    const candleType = change >= 0 ? '陽線' : '陰線';
    const partialMark = c.is_partial ? ' ⚠未確定' : '';

    lines.push(
      `${dateStr}: 始値${formatPrice(c.open)} 高値${formatPrice(c.high)} 安値${formatPrice(c.low)} 終値${formatPrice(c.close)} [${candleType} ${changeSign}${formatPrice(Math.abs(change)).replace('¥', '')}円]${partialMark}`
    );
  }
  lines.push('');

  // === 2. パターン検出結果 ===
  if (patterns.length === 0) {
    lines.push('=== 検出パターン ===');
    lines.push('なし');
    lines.push('');
    lines.push('直近の値動きには特徴的なローソク足パターンは見られませんでした。');
    lines.push('');
  } else {
    for (const p of patterns) {
      lines.push(`■ ${p.pattern_jp}（${p.pattern}）`);
      const dirLabel = p.direction === 'bullish' ? '強気（上昇転換シグナル）' : p.direction === 'bearish' ? '弱気（下落転換シグナル）' : '中立（方向性の迷い）';
      lines.push(`  方向性: ${dirLabel}`);
      lines.push(`  状態: ${p.status === 'forming' ? '形成中（終値未確定）' : '確定'}`);
      lines.push(`  強度: ${(p.strength * 100).toFixed(0)}%`);
      lines.push(`  直前トレンド: ${p.local_context.trend_before === 'up' ? '上昇' : p.local_context.trend_before === 'down' ? '下落' : '中立'}`);
      lines.push('');

      // === 3. パターン該当箇所の詳細 ===
      const [idxStart, idxEnd] = p.candle_range_index;
      const spanSize = idxEnd - idxStart + 1;

      if (idxStart >= 0 && idxEnd < windowCandles.length) {
        const statusMark = p.uses_partial_candle ? '（形成中）' : '（確定）';
        lines.push('  === 検出パターンの詳細 ===');

        if (spanSize === 1) {
          // ----- 1本足パターン -----
          const c = windowCandles[idxStart];
          const dateStr = formatDateWithDay(c.timestamp);
          const body = c.close - c.open;
          const candleType = body >= 0 ? '陽線' : '陰線';

          lines.push(`  📍 ${dateStr} に${p.pattern_jp}を検出${statusMark}`);
          lines.push(`    ${dateStr}: ${candleType} 始値${formatPrice(c.open)} → 終値${formatPrice(c.close)} (実体 ${body >= 0 ? '+' : '-'}${formatPrice(Math.abs(body)).replace('¥', '')}円)`);
          lines.push(`    高値${formatPrice(c.high)} 安値${formatPrice(c.low)} (レンジ ${formatPrice(c.high - c.low).replace('¥', '')}円)`);

          if (p.pattern === 'hammer') {
            const lower = Math.min(c.open, c.close) - c.low;
            lines.push(`    判定: 小さい実体 + 長い下ヒゲ（${formatPrice(lower).replace('¥', '')}円）→ 下値の強い買い圧力`);
          } else if (p.pattern === 'shooting_star') {
            const upper = c.high - Math.max(c.open, c.close);
            lines.push(`    判定: 小さい実体 + 長い上ヒゲ（${formatPrice(upper).replace('¥', '')}円）→ 上値の強い売り圧力`);
          } else if (p.pattern === 'doji') {
            const upper = c.high - Math.max(c.open, c.close);
            const lower = Math.min(c.open, c.close) - c.low;
            const variant = upper > lower * 1.5 ? 'トウバ型（上ヒゲ優勢）' : lower > upper * 1.5 ? 'トンボ型（下ヒゲ優勢）' : '通常型（上下均等）';
            lines.push(`    判定: 始値≒終値で売り買い拮抗 → ${variant}`);
          }
          lines.push('');
        } else if (spanSize === 2) {
          // ----- 2本足パターン -----
          const c1 = windowCandles[idxStart];
          const c2 = windowCandles[idxEnd];
          const date1 = formatDateWithDay(c1.timestamp);
          const date2 = formatDateWithDay(c2.timestamp);
          const body1 = c1.close - c1.open;
          const body2 = c2.close - c2.open;
          const type1 = body1 >= 0 ? '陽線' : '陰線';
          const type2 = body2 >= 0 ? '陽線' : '陰線';

          lines.push(`  📍 ${date2} に${p.pattern_jp}を検出${statusMark}（${date1}-${date2}で形成）`);
          lines.push(`    ${date1}(前日): ${type1} 始値${formatPrice(c1.open)} → 終値${formatPrice(c1.close)} (実体 ${body1 >= 0 ? '+' : '-'}${formatPrice(Math.abs(body1)).replace('¥', '')}円)`);
          lines.push(`    ${date2}(確定日): ${type2} 始値${formatPrice(c2.open)} → 終値${formatPrice(c2.close)} (実体 ${body2 >= 0 ? '+' : '-'}${formatPrice(Math.abs(body2)).replace('¥', '')}円) ← パターン確定`);

          if (p.pattern === 'bullish_engulfing') {
            lines.push(`    判定: 当日の陽線が前日の陰線を完全に包む（始値が前日終値以下、終値が前日始値以上）`);
          } else if (p.pattern === 'bearish_engulfing') {
            lines.push(`    判定: 当日の陰線が前日の陽線を完全に包む（始値が前日終値以上、終値が前日始値以下）`);
          } else if (p.pattern === 'bullish_harami') {
            lines.push(`    判定: 当日のローソク足が前日の大陰線の実体内に収まる`);
          } else if (p.pattern === 'bearish_harami') {
            lines.push(`    判定: 当日のローソク足が前日の大陽線の実体内に収まる`);
          } else if (p.pattern === 'tweezer_top') {
            const highDiff = Math.abs(c1.high - c2.high);
            const matchPct = (1 - highDiff / ((c1.high + c2.high) / 2)) * 100;
            lines.push(`    判定: 2日連続で高値がほぼ同じ（誤差${highDiff.toLocaleString()}円, 一致率${matchPct.toFixed(1)}%）`);
            lines.push(`    高値: ${formatPrice(c1.high)} → ${formatPrice(c2.high)}`);
          } else if (p.pattern === 'tweezer_bottom') {
            const lowDiff = Math.abs(c1.low - c2.low);
            const matchPct = (1 - lowDiff / ((c1.low + c2.low) / 2)) * 100;
            lines.push(`    判定: 2日連続で安値がほぼ同じ（誤差${lowDiff.toLocaleString()}円, 一致率${matchPct.toFixed(1)}%）`);
            lines.push(`    安値: ${formatPrice(c1.low)} → ${formatPrice(c2.low)}`);
          } else if (p.pattern === 'dark_cloud_cover') {
            const midPoint = (c1.open + c1.close) / 2;
            lines.push(`    判定: 高寄り後に陰線で前日陽線の中心値（${formatPrice(midPoint)}）を下回る`);
            lines.push(`    ギャップ: ${formatPrice(c2.open)} > 前日終値${formatPrice(c1.close)}`);
          } else if (p.pattern === 'piercing_line') {
            const midPoint = (c1.open + c1.close) / 2;
            lines.push(`    判定: 安寄り後に陽線で前日陰線の中心値（${formatPrice(midPoint)}）を上回る`);
            lines.push(`    ギャップ: ${formatPrice(c2.open)} < 前日終値${formatPrice(c1.close)}`);
          }
          lines.push('');
        } else if (spanSize === 3) {
          // ----- 3本足パターン -----
          const c1 = windowCandles[idxStart];
          const c2 = windowCandles[idxStart + 1];
          const c3 = windowCandles[idxEnd];
          const date1 = formatDateWithDay(c1.timestamp);
          const date2 = formatDateWithDay(c2.timestamp);
          const date3 = formatDateWithDay(c3.timestamp);

          lines.push(`  📍 ${date1}-${date3} に${p.pattern_jp}を検出${statusMark}（3本足パターン）`);
          for (const [label, c, dateStr] of [
            ['1本目', c1, date1],
            ['2本目', c2, date2],
            ['3本目（確定日）', c3, date3],
          ] as const) {
            const body = c.close - c.open;
            const ct = body >= 0 ? '陽線' : '陰線';
            lines.push(`    ${dateStr}(${label}): ${ct} 始値${formatPrice(c.open)} → 終値${formatPrice(c.close)} (実体 ${body >= 0 ? '+' : '-'}${formatPrice(Math.abs(body)).replace('¥', '')}円)`);
          }

          if (p.pattern === 'morning_star') {
            const midPoint = (c1.open + c1.close) / 2;
            lines.push(`    判定: 大陰線→コマ→大陽線が1本目の中心値（${formatPrice(midPoint)}）超え → 底打ち反転`);
          } else if (p.pattern === 'evening_star') {
            const midPoint = (c1.open + c1.close) / 2;
            lines.push(`    判定: 大陽線→コマ→大陰線が1本目の中心値（${formatPrice(midPoint)}）割れ → 天井反転`);
          } else if (p.pattern === 'three_white_soldiers') {
            lines.push(`    判定: 3本連続陽線で各終値が前日を上回る → 力強い上昇トレンド`);
          } else if (p.pattern === 'three_black_crows') {
            lines.push(`    判定: 3本連続陰線で各終値が前日を下回る → 力強い下落トレンド`);
          }
          lines.push('');
        }
      }

      // === 4. 過去統計データ ===
      if (p.history_stats) {
        const hs = p.history_stats;
        lines.push(`  === 過去の実績（直近${hs.lookback_days}日間） ===`);
        lines.push(`    ${p.pattern_jp}の出現回数: ${hs.occurrences}回`);

        for (const [horizon, stats] of Object.entries(hs.horizons)) {
          const wins = Math.round(stats.win_rate * stats.sample);
          const losses = stats.sample - wins;
          lines.push(`    ${horizon}日後: 勝率${(stats.win_rate * 100).toFixed(1)}% (${wins}勝${losses}敗), 平均リターン ${stats.avg_return >= 0 ? '+' : ''}${stats.avg_return.toFixed(2)}%`);
        }
        lines.push('');
      } else {
        lines.push('  === 過去の実績 ===');
        lines.push('    統計データなし（サンプル数不足または期間外）');
        lines.push('');
      }

      if (p.uses_partial_candle) {
        lines.push('  ⚠️ 注意: 本日の日足は未確定です。終値確定後にパターンが変化・消失する可能性があります。');
        lines.push('');
      }
    }
  }

  // 補足説明
  lines.push('【パターンの読み方】');
  lines.push('〈1本足〉');
  lines.push('・ハンマー: 下落局面で長い下ヒゲ→買い圧力が強く、上昇転換のサイン');
  lines.push('・シューティングスター: 上昇局面で長い上ヒゲ→売り圧力が強く、下落転換のサイン');
  lines.push('・十字線: 始値≒終値で売り買い拮抗→トレンド転換の予兆（前のトレンドの逆方向に注目）');
  lines.push('〈2本足〉');
  lines.push('・陽線包み線: 下落後に出現すると上昇転換のサイン');
  lines.push('・陰線包み線: 上昇後に出現すると下落転換のサイン');
  lines.push('・はらみ線: 大きなローソク足の中に小さなローソク足が収まる形で、トレンド転換の予兆');
  lines.push('・毛抜き天井: 高値圏で2日連続同じ高値→上昇の限界、下落転換のサイン');
  lines.push('・毛抜き底: 安値圏で2日連続同じ安値→下落の限界、上昇転換のサイン');
  lines.push('・かぶせ線: 高寄り後に陰線で前日陽線の中心以下→上昇一服、調整のサイン');
  lines.push('・切り込み線: 安寄り後に陽線で前日陰線の中心超え→下落一服、反発のサイン');
  lines.push('〈3本足〉');
  lines.push('・明けの明星: 大陰線→コマ→大陽線で底打ち反転のサイン');
  lines.push('・宵の明星: 大陽線→コマ→大陰線で天井反転のサイン');
  lines.push('・赤三兵: 3本連続陽線で力強い上昇の開始・継続');
  lines.push('・黒三兵: 3本連続陰線で力強い下落の開始・継続');
  lines.push('');
  lines.push('※勝率50%超でもリスク管理は必須です。統計は参考値であり、将来を保証するものではありません。');

  return [{ type: 'text', text: lines.join('\n') }];
}

// ----- ヘルパー: 日付形式の正規化 -----
/**
 * ISO形式 ("2025-11-05") または YYYYMMDD ("20251105") を YYYYMMDD に正規化
 */
function normalizeDateToYYYYMMDD(dateStr: string | undefined): string | undefined {
  if (!dateStr) return undefined;

  // ISO形式 ("2025-11-05" or "2025-11-05T...") の場合
  if (dateStr.includes('-')) {
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[1]}${match[2]}${match[3]}`;
    }
  }

  // 既にYYYYMMDD形式の場合
  if (/^\d{8}$/.test(dateStr)) {
    return dateStr;
  }

  return undefined;
}

// ----- メイン関数 -----
export default async function analyzeCandlePatterns(
  opts: {
    pair?: 'btc_jpy';
    timeframe?: '1day';
    as_of?: string; // ISO "2025-11-05" or YYYYMMDD "20251105"
    date?: string;  // DEPRECATED: YYYYMMDD format (for backward compatibility)
    window_days?: number;
    focus_last_n?: number;
    patterns?: CandlePatternType[];
    history_lookback_days?: number;
    history_horizons?: number[];
    allow_partial_patterns?: boolean;
  } = {}
) {
  try {
    // 入力の正規化
    const input = AnalyzeCandlePatternsInputSchema.parse(opts);
    const pair = input.pair as Pair;
    const timeframe = input.timeframe;

    // as_of を優先、なければ date を使用（互換性のため）
    // as_of: ISO形式 "2025-11-05" または YYYYMMDD "20251105" を受け付け
    const rawDate = input.as_of || input.date;
    const targetDate = normalizeDateToYYYYMMDD(rawDate);
    const windowDays = input.window_days;
    const focusLastN = input.focus_last_n;
    const targetPatterns = input.patterns || (Object.keys(PATTERN_CONFIGS) as CandlePatternType[]);
    const historyLookbackDays = input.history_lookback_days;
    const historyHorizons = input.history_horizons;
    const allowPartial = input.allow_partial_patterns;

    // 日付指定があるかどうか
    const isHistoricalQuery = !!targetDate;

    // ローソク足データを取得（統計計算用に多めに取得）
    const requiredCandles = Math.max(windowDays, historyLookbackDays + 10);
    const candlesResult = await getCandles(pair, '1day', targetDate, requiredCandles);

    if (!candlesResult.ok) {
      return AnalyzeCandlePatternsOutputSchema.parse(
        fail(candlesResult.summary, 'internal')
      );
    }

    // 全データを保持（統計計算用）
    const allCandlesForStats = candlesResult.data.normalized;
    let allCandles = [...allCandlesForStats];

    // 🚨 CRITICAL: 日付指定時は、その日付以前のデータのみにフィルタリング
    // get_candles は年単位でデータを取得するため、指定日以降のデータも含まれる
    if (isHistoricalQuery && targetDate) {
      // targetDate は YYYYMMDD 形式（例: "20251105"）
      const year = targetDate.slice(0, 4);
      const month = targetDate.slice(4, 6);
      const day = targetDate.slice(6, 8);
      const targetDateMs = dayjs.utc(`${year}-${month}-${day}`).endOf('day').valueOf();

      allCandles = allCandles.filter((c) => {
        if (!c.isoTime) return false;
        return dayjs(c.isoTime).valueOf() <= targetDateMs;
      });
    }

    if (allCandles.length < windowDays) {
      return AnalyzeCandlePatternsOutputSchema.parse(
        fail(`ローソク足データが不足しています（${allCandles.length}本 < ${windowDays}本）`, 'user')
      );
    }

    // 直近windowDays分を切り出し
    // CRITICAL: allCandlesは [最古, ..., 最新] の順序
    const windowStart = allCandles.length - windowDays;
    const windowCandles = allCandles.slice(windowStart);

    // 日足確定判定:
    // - 過去日付指定時: すべて確定済み（is_partial = false）
    // - 最新データ時: 最新の日足が今日のデータなら未確定
    const todayStr = today('YYYY-MM-DD');
    const lastCandleTime = windowCandles[windowCandles.length - 1]?.isoTime?.split('T')[0];
    const isLastPartial = !isHistoricalQuery && lastCandleTime === todayStr;

    // WindowCandle形式に変換
    const formattedWindowCandles: WindowCandle[] = windowCandles.map((c, idx) => ({
      timestamp: c.isoTime || toIsoTime(c.time || 0) || '',
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 0,
      is_partial: idx === windowCandles.length - 1 && isLastPartial,
    }));

    // パターン検出
    // CRITICAL: windowCandles配列は [最古, ..., 最新] の順序
    const detectedPatterns: DetectedCandlePattern[] = [];
    // startCheckIndex: 1本足はindex 0から、spanチェックでガード
    const startCheckIndex = Math.max(0, windowCandles.length - focusLastN);

    // パターンコンテキストを計算
    const highs = windowCandles.map(c => c.high);
    const lows = windowCandles.map(c => c.low);
    const bodies = windowCandles.map(c => Math.abs(c.close - c.open));
    const patternContext: PatternContext = {
      rangeHigh: Math.max(...highs),
      rangeLow: Math.min(...lows),
      avgBodySize: bodies.reduce((sum, b) => sum + b, 0) / bodies.length,
    };

    for (let i = startCheckIndex; i < windowCandles.length; i++) {
      const usesPartial = i === windowCandles.length - 1 && isLastPartial;

      if (usesPartial && !allowPartial) {
        continue;
      }

      for (const patternType of targetPatterns) {
        const config = PATTERN_CONFIGS[patternType];

        // spanに必要な本数があるかチェック
        if (i < config.span - 1) continue;

        const slice = windowCandles.slice(i - config.span + 1, i + 1);
        const result = config.detect(slice, patternContext);

        if (result.detected) {
          // トレンドはパターン開始位置より前で判定
          const patternStartIdx = i - config.span + 1;
          const trendBefore = detectTrendBefore(windowCandles, patternStartIdx > 0 ? patternStartIdx - 1 : 0, 3);
          const volatilityLevel = detectVolatilityLevel(windowCandles, i, 5);

          // doji は直前トレンドで方向を動的決定
          let direction = config.direction;
          if (direction === 'neutral' && patternType === 'doji') {
            if (trendBefore === 'up') direction = 'bearish';
            else if (trendBefore === 'down') direction = 'bullish';
          }

          const historyStats = calculateHistoryStats(
            allCandlesForStats,
            patternType,
            historyHorizons,
            historyLookbackDays
          );

          detectedPatterns.push({
            pattern: patternType,
            pattern_jp: config.jp_name,
            direction,
            strength: Number(result.strength.toFixed(2)),
            candle_range_index: [i - config.span + 1, i] as [number, number],
            uses_partial_candle: usesPartial,
            status: usesPartial ? 'forming' : 'confirmed',
            local_context: {
              trend_before: trendBefore,
              volatility_level: volatilityLevel,
            },
            history_stats: historyStats,
          });
        }
      }
    }

    // 強度フィルタ: 50%未満のパターンを除外（初心者向けにノイズを減らす）
    const MIN_STRENGTH_THRESHOLD = 0.50; // 50%
    const filteredPatterns = detectedPatterns.filter(
      (p) => p.strength >= MIN_STRENGTH_THRESHOLD
    );

    // サマリーとコンテント生成（フィルタ後のパターンを使用）
    const summary = generateSummary(filteredPatterns, formattedWindowCandles);
    const content = generateContent(filteredPatterns, formattedWindowCandles);

    const data = {
      pair,
      timeframe,
      snapshot_time: nowIso(),
      window: {
        from: formattedWindowCandles[0]?.timestamp?.split('T')[0] || '',
        to: formattedWindowCandles[formattedWindowCandles.length - 1]?.timestamp?.split('T')[0] || '',
        candles: formattedWindowCandles,
      },
      recent_patterns: filteredPatterns, // 強度50%以上のパターンのみ
      summary,
    };

    const meta = {
      ...createMeta(pair, {}),
      timeframe,
      as_of: rawDate || null, // original input value
      date: targetDate || null, // YYYYMMDD normalized or null (latest)
      window_days: windowDays,
      patterns_checked: targetPatterns,
      history_lookback_days: historyLookbackDays,
      history_horizons: historyHorizons,
    };

    const result = {
      ok: true as const,
      summary,
      content,
      data,
      meta,
    };

    return AnalyzeCandlePatternsOutputSchema.parse(result);
  } catch (e: unknown) {
    return failFromError(e, { schema: AnalyzeCandlePatternsOutputSchema, defaultMessage: 'Unknown error' });
  }
}

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'analyze_candle_patterns',
	description: 'ローソク足パターン検出（1〜3本足: ハンマー・流れ星・十字線・包み線・はらみ線・毛抜き・かぶせ線・切り込み線・明けの明星・宵の明星・赤三兵・黒三兵）。BTC/JPY日足の直近5日間から短期反転パターンを検出し、過去180日間の統計（勝率・平均リターン）を付与。初心者向けに自然言語で解説。未確定ローソク対応。\n\n【パラメータ制約】\npair: btc_jpy 固定、timeframe: 1day 固定（現時点ではBTC/JPY日足のみ統計データ蓄積済みのため）。他ペア/時間軸は統計精度が不十分なため非対応。\n\n【視覚化】ユーザーが図での確認を希望した場合、本ツールの結果を render_candle_pattern_diagram に渡してSVG構造図を生成できる。',
	inputSchema: AnalyzeCandlePatternsInputSchema,
	handler: async (args: any) => analyzeCandlePatterns(args),
};

