/**
 * lib/fetch_candles.ts - バックテスト用ローソク足取得
 * 
 * 【データ品質保証】
 * - time でソート（古い順）
 * - time をキーに重複排除
 * - 数値 NaN / time欠損は除外
 */

import getCandles from '../../get_candles.js';
import type { Candle, Timeframe, Period } from '../types.js';

// 期間 → 必要本数のマッピング（バックテスト対象期間）
// 1D: 日足 → 1M=30日, 3M=90日, 6M=180日
// 4H: 4時間足 → 1M=180本(30日×6), 3M=540本, 6M=1080本
// 1H: 1時間足 → 1M=720本(30日×24), 3M=2160本, 6M=4320本
const PERIOD_TO_BARS: Record<Timeframe, Record<Period, number>> = {
  '1D': { '1M': 30, '3M': 90, '6M': 180 },
  '4H': { '1M': 180, '3M': 540, '6M': 1080 },
  '1H': { '1M': 720, '3M': 2160, '6M': 4320 },
};

// timeframe → get_candles の type マッピング
const TIMEFRAME_TO_CANDLE_TYPE: Record<Timeframe, string> = {
  '1D': '1day',
  '4H': '4hour',
  '1H': '1hour',
};

/**
 * 期間に対応するバックテスト対象本数を取得
 */
export function getPeriodBars(timeframe: Timeframe, period: Period): number {
  return PERIOD_TO_BARS[timeframe]?.[period] ?? 90;
}

/**
 * ローソク足データのバリデーション
 * 
 * @param candle 検証対象
 * @returns 有効なデータの場合 true
 */
function isValidCandle(candle: Candle): boolean {
  // time が空でないこと
  if (!candle.time || candle.time.trim() === '') {
    return false;
  }

  // time が有効な日付であること
  const timestamp = new Date(candle.time).getTime();
  if (isNaN(timestamp)) {
    return false;
  }

  // 数値が NaN でないこと
  if (
    isNaN(candle.open) ||
    isNaN(candle.high) ||
    isNaN(candle.low) ||
    isNaN(candle.close)
  ) {
    return false;
  }

  // 価格が 0 以上であること
  if (
    candle.open <= 0 ||
    candle.high <= 0 ||
    candle.low <= 0 ||
    candle.close <= 0
  ) {
    return false;
  }

  return true;
}

/**
 * バックテスト用にローソク足を取得
 * 
 * 返すデータ構成:
 * - 直近 `periodBars` 本 = バックテスト対象期間
 * - その前に `smaLong` 本 = SMA計算用ウォームアップ期間
 * - 合計: `periodBars + smaLong + buffer` 本
 * 
 * 【データ品質保証】
 * - time でソート（古い順）
 * - time をキーに重複排除
 * - 数値 NaN / time欠損は除外
 * 
 * @param pair 通貨ペア
 * @param timeframe 時間軸
 * @param period 期間
 * @param smaLong 長期SMAの期間（ウォームアップ用）
 * @returns ローソク足配列（古い順、ウォームアップ込み）
 */
export async function fetchCandlesForBacktest(
  pair: string,
  timeframe: Timeframe,
  period: Period,
  smaLong: number
): Promise<Candle[]> {
  const periodBars = PERIOD_TO_BARS[timeframe]?.[period];
  if (!periodBars) {
    throw new Error(`Unsupported timeframe/period: ${timeframe}/${period}`);
  }

  // 必要な本数: バックテスト期間 + SMAウォームアップ + バッファ
  const neededBars = periodBars + smaLong + 10;

  // 日足の場合は複数年取得を発動させるため最低400を指定
  // 時間足の場合はそのまま必要本数を指定
  const fetchLimit = timeframe === '1D' ? Math.max(neededBars, 400) : neededBars;

  const candleType = TIMEFRAME_TO_CANDLE_TYPE[timeframe];
  if (!candleType) {
    throw new Error(`Unsupported timeframe: ${timeframe}`);
  }

  const result = await getCandles(pair, candleType, undefined, fetchLimit);

  if (!result.ok) {
    throw new Error(`Failed to fetch candles: ${result.summary}`);
  }

  const normalized = result.data?.normalized;
  if (!normalized || !Array.isArray(normalized) || normalized.length === 0) {
    throw new Error('No candle data returned');
  }

  // 全データをCandle形式に変換
  const rawCandles: Candle[] = normalized.map((c: any) => ({
    time: c.isoTime || '',
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: c.volume != null ? Number(c.volume) : undefined,
  }));

  // 1. バリデーション（無効データを除外）
  const validCandles = rawCandles.filter(isValidCandle);

  if (validCandles.length === 0) {
    throw new Error('No valid candle data after filtering');
  }

  // 2. time でソート（古い順）
  validCandles.sort((a, b) => {
    const timeA = new Date(a.time).getTime();
    const timeB = new Date(b.time).getTime();
    return timeA - timeB;
  });

  // 3. 重複排除（time をキーに、後の方を優先）
  const uniqueMap = new Map<string, Candle>();
  for (const candle of validCandles) {
    uniqueMap.set(candle.time, candle);
  }
  const uniqueCandles = Array.from(uniqueMap.values());

  // 4. 再ソート（Map は順序を保証するが念のため）
  uniqueCandles.sort((a, b) => {
    const timeA = new Date(a.time).getTime();
    const timeB = new Date(b.time).getTime();
    return timeA - timeB;
  });

  // 5. 直近の必要な本数だけ切り出す（古い順を維持）
  if (uniqueCandles.length <= neededBars) {
    return uniqueCandles;
  }

  const startIdx = uniqueCandles.length - neededBars;
  return uniqueCandles.slice(startIdx);
}
