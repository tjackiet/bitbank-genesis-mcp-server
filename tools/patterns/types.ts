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
  /** 時間軸（'1day', '1hour', '1week' 等） */
  type: string;
  /** スイング深度 */
  swingDepth: number;
  /** 近接判定ヘルパー（tolerancePct ベース） */
  near: (a: number, b: number) => boolean;
  /** 変化率計算 */
  pct: (a: number, b: number) => number;
  /** R² 付き線形回帰 */
  lrWithR2: (pts: Array<{ x: number; y: number }>) => {
    slope: number;
    intercept: number;
    r2: number;
    valueAt: (x: number) => number;
  };
}

/** 各パターン検出関数の戻り値 */
export interface DetectResult {
  patterns: PatternEntry[];
  /** 検出成否フラグ（後続の relaxed パスに使用） */
  found?: Record<string, boolean>;
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
