/**
 * detect_patterns 系モジュール共通の型定義
 */
import type { Pivot } from './swing.js';

/** ローソク足データ（detectSwingPoints 互換） */
export interface CandleData {
  open: number;
  close: number;
  high: number;
  low: number;
  isoTime?: string;
}

/** pushCand() に渡すデバッグ引数 */
export interface CandDebugArg {
  type: string;
  accepted: boolean;
  reason?: string;
  idxs?: number[];
  pts?: Array<{ role: string; idx: number; price: number }>;
}

/** debugCandidates 配列の要素 */
export interface CandDebugEntry {
  type: string;
  accepted: boolean;
  reason?: string;
  indices?: number[];
  points?: Array<{ role: string; idx: number; price: number; isoTime?: string }>;
  details?: unknown;
}

/**
 * パターン検出コンテキスト — 各検出モジュールが共有するデータとコンフィグ。
 * detectPatterns() が組み立てて各検出関数に渡す。
 */
export interface DetectContext {
  candles: CandleData[];
  pivots: Pivot[];
  allPeaks: Pivot[];
  allValleys: Pivot[];
  tolerancePct: number;
  minDist: number;
  /** 検出対象パターン種別。空 = 全種 */
  want: Set<string>;
  includeForming: boolean;
  /** デバッグ候補バッファ（各モジュールが直接 push する） */
  debugCandidates: CandDebugEntry[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- detect_patterns が any[] で蓄積するため
export type PatternEntry = any;

/** pushCand ヘルパー（デバッグ候補に isoTime を付加して追加） */
export function pushCand(ctx: DetectContext, arg: CandDebugArg): void {
  const points = (arg.pts || []).map(p => ({
    ...p,
    isoTime: (ctx.candles[p.idx] as CandleData | undefined)?.isoTime,
  }));
  ctx.debugCandidates.push({
    type: arg.type,
    accepted: arg.accepted,
    reason: arg.reason,
    indices: arg.idxs,
    points,
  });
}
