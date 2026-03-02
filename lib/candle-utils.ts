/**
 * ローソク足ヘルパー関数
 *
 * isBullish / isBearish / bodySize / bodyTop / bodyBottom を提供。
 * analyze_candle_patterns.ts から抽出。他ツールでも再利用可能。
 */

import type { Candle } from '../src/types/domain.d.ts';

/** ローソク足が陽線かどうか */
export function isBullish(c: Candle): boolean {
  return c.close > c.open;
}

/** ローソク足が陰線かどうか */
export function isBearish(c: Candle): boolean {
  return c.close < c.open;
}

/** 実体の大きさを取得 */
export function bodySize(c: Candle): number {
  return Math.abs(c.close - c.open);
}

/** 実体の上端 */
export function bodyTop(c: Candle): number {
  return Math.max(c.open, c.close);
}

/** 実体の下端 */
export function bodyBottom(c: Candle): number {
  return Math.min(c.open, c.close);
}

/** 上ヒゲの長さ */
export function upperShadow(c: Candle): number {
  return c.high - bodyTop(c);
}

/** 下ヒゲの長さ */
export function lowerShadow(c: Candle): number {
  return bodyBottom(c) - c.low;
}

/** ローソク足全体のレンジ（高値 - 安値） */
export function totalRange(c: Candle): number {
  return c.high - c.low;
}
