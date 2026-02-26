/**
 * Triangle detection — swing-point + R²-regression, multi-scale.
 * + Trendoscope-style pennant reclassification (2-stage).
 *
 * Architecture:
 * 1. Relaxed swing detection (swingDepth=1) for peaks/valleys
 * 2. Multi-scale sliding window scan (geometric progression ×1.5)
 * 3. R²-based regression on peaks and valleys within each window
 * 4. Classify: ascending (upper ≈ flat, lower rising),
 *              descending (upper falling, lower ≈ flat),
 *              symmetrical (upper falling, lower rising)
 * 5. Convergence check (gap narrows ≥ 10%)
 * 6. Breakout detection with ATR × 0.3 buffer
 * 7. Pole detection: if impulsive move precedes the triangle → reclassify as pennant
 * 8. deduplicatePatterns() before returning
 */
import { clamp01 } from './regression.js';
import { calcATR, deduplicatePatterns, finalizeConf } from './helpers.js';
import type { DetectContext, DetectResult } from './types.js';

// ---------------------------------------------------------------------------
// bars-per-day helper
// ---------------------------------------------------------------------------
function barsPerDay(tf: string): number {
  switch (tf) {
    case '1min':  return 1440;
    case '5min':  return 288;
    case '15min': return 96;
    case '30min': return 48;
    case '1hour': return 24;
    case '4hour': return 6;
    case '8hour': return 3;
    case '12hour': return 2;
    case '1day':  return 1;
    case '1week': return 1 / 7;
    case '1month': return 1 / 30;
    default:      return 1;
  }
}

// ---------------------------------------------------------------------------
// Time-frame dependent parameters
// ---------------------------------------------------------------------------
function getTriangleParams(tf: string) {
  const bpd = barsPerDay(tf);
  const maxDurationDays = 90;           // triangles > 90 days → different pattern
  const minWindowBars = 15;             // absolute minimum bars
  const maxWindowBars = Math.max(minWindowBars, Math.round(maxDurationDays * bpd));
  const minR2 = 0.25;
  const flatThreshold = 0.03;           // |relSlope| < 3% over window → "flat"
  const moveThreshold = 0.015;          // |relSlope| > 1.5% over window → "rising/falling"
  const minConvergence = 0.90;          // gap must narrow by ≥ 10%

  return { minWindowBars, maxWindowBars, minR2, flatThreshold, moveThreshold, minConvergence };
}

// ---------------------------------------------------------------------------
// Pole detection parameters for pennant reclassification (Trendoscope 2-stage)
// ---------------------------------------------------------------------------
function getPoleParams(tf: string) {
  const bpd = barsPerDay(tf);
  const poleMinBars = Math.max(2, Math.round(1 * bpd));
  const poleMaxBars = Math.max(5, Math.round(15 * bpd));

  const t = String(tf);
  let minPoleATRMult = 1.5;
  let minPolePct = 0.03;
  if (t === '1day')                                    { minPoleATRMult = 2.0; minPolePct = 0.05; }
  if (t === '1week')                                   { minPoleATRMult = 2.0; minPolePct = 0.06; }
  if (t === '1month')                                  { minPoleATRMult = 2.5; minPolePct = 0.08; }
  if (t === '1min' || t === '5min')                    { minPolePct = 0.01; }
  if (t === '15min' || t === '30min')                  { minPolePct = 0.015; }
  if (t === '1hour')                                   { minPolePct = 0.02; }

  return { poleMinBars, poleMaxBars, minPoleATRMult, minPolePct };
}

/**
 * Detect if there is an impulsive move (flagpole) immediately before winStart.
 * Returns pole info if found, null otherwise.
 */
function detectPole(
  candles: readonly { open: number; close: number; high: number; low: number; isoTime?: string }[],
  winStart: number,
  tf: string,
): { poleStart: number; poleEnd: number; poleDirection: 'up' | 'down'; atrMult: number; poleHeight: number } | null {
  const pp = getPoleParams(tf);

  let bestPoleStart = -1;
  let bestPoleMag = 0;
  let bestPoleATRMult = 0;

  // Pole ends just before the triangle window starts
  const poleEnd = winStart - 1;
  if (poleEnd < pp.poleMinBars) return null;

  for (let poleLen = pp.poleMinBars; poleLen <= Math.min(pp.poleMaxBars, poleEnd); poleLen++) {
    const ps = poleEnd - poleLen;
    if (ps < 0) continue;
    const startPrice = candles[ps].close;
    const endPrice = candles[poleEnd].close;
    const magnitude = endPrice - startPrice;
    const changePct = Math.abs(magnitude) / Math.max(1e-12, startPrice);

    const localATR = calcATR(candles as any, Math.max(1, ps), poleEnd, 14);
    if (localATR <= 0) continue;

    const atrMult = Math.abs(magnitude) / localATR;
    if (atrMult < pp.minPoleATRMult || changePct < pp.minPolePct) continue;

    if (atrMult > bestPoleATRMult) {
      bestPoleStart = ps;
      bestPoleMag = magnitude;
      bestPoleATRMult = atrMult;
    }
  }

  if (bestPoleStart < 0) return null;

  // Consolidation (triangle) range should be contained within pole range
  // Skip if triangle is too wide relative to pole
  const poleRange = Math.abs(bestPoleMag);
  const triangleHigh = Math.max(...candles.slice(winStart, winStart + 10).map(c => c.high));
  const triangleLow = Math.min(...candles.slice(winStart, winStart + 10).map(c => c.low));
  const triRange = triangleHigh - triangleLow;
  if (triRange > poleRange * 0.90) return null;

  return {
    poleStart: bestPoleStart,
    poleEnd,
    poleDirection: bestPoleMag > 0 ? 'up' : 'down',
    atrMult: bestPoleATRMult,
    poleHeight: poleRange,
  };
}

export function detectTriangles(ctx: DetectContext): DetectResult {
  const { candles, want, includeForming, debugCandidates, lrWithR2 } = ctx;
  const type = ctx.type;
  let patterns: any[] = [];

  const wantPennant = want.size === 0 || want.has('pennant');
  const wantAsc = want.size === 0 || want.has('triangle') || want.has('triangle_ascending') || wantPennant;
  const wantDesc = want.size === 0 || want.has('triangle') || want.has('triangle_descending') || wantPennant;
  const wantSym = want.size === 0 || want.has('triangle') || want.has('triangle_symmetrical') || wantPennant;
  if (!wantAsc && !wantDesc && !wantSym) return { patterns: [] };

  const lastIdx = candles.length - 1;
  if (lastIdx < 15) return { patterns: [] };

  const params = getTriangleParams(type);

  // --- Relaxed swing detection (swingDepth=1) ---
  const relaxedPeaks: Array<{ idx: number; price: number }> = [];
  const relaxedValleys: Array<{ idx: number; price: number }> = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const c = candles[i], prev = candles[i - 1], next = candles[i + 1];
    if (c.high > prev.high && c.high > next.high) {
      relaxedPeaks.push({ idx: i, price: c.high });
    }
    if (c.low < prev.low && c.low < next.low) {
      relaxedValleys.push({ idx: i, price: c.low });
    }
  }

  // --- Generate multi-scale window sizes (geometric ×1.5) ---
  const effectiveMax = Math.min(lastIdx - 5, params.maxWindowBars);
  const windowSizes: number[] = [];
  {
    let w = params.minWindowBars;
    while (w <= effectiveMax) {
      windowSizes.push(Math.round(w));
      w = Math.round(w * 1.5);
    }
  }
  if (!windowSizes.length) return { patterns: [] };

  // --- Sliding window scan ---
  for (const windowSize of windowSizes) {
    const posStep = Math.max(1, Math.floor(windowSize / 6));

    for (let winEnd = windowSize; winEnd <= lastIdx; winEnd += posStep) {
      const winStart = winEnd - windowSize;

      // Collect peaks/valleys in window
      const peaks = relaxedPeaks.filter(p => p.idx >= winStart && p.idx <= winEnd);
      const valleys = relaxedValleys.filter(p => p.idx >= winStart && p.idx <= winEnd);

      if (peaks.length < 2 || valleys.length < 2) continue;

      // R²-based regression
      const upperLine = lrWithR2(peaks.map(p => ({ x: p.idx, y: p.price })));
      const lowerLine = lrWithR2(valleys.map(p => ({ x: p.idx, y: p.price })));

      if (upperLine.r2 < params.minR2 || lowerLine.r2 < params.minR2) {
        debugCandidates.push({
          type: 'triangle_symmetrical' as any,
          accepted: false,
          reason: 'poor_trendline_fit',
          indices: [winStart, winEnd],
          details: { r2Upper: Number(upperLine.r2.toFixed(3)), r2Lower: Number(lowerLine.r2.toFixed(3)) }
        });
        continue;
      }

      // Convergence check
      const gapStart = upperLine.valueAt(winStart) - lowerLine.valueAt(winStart);
      const gapEnd = upperLine.valueAt(winEnd) - lowerLine.valueAt(winEnd);
      if (gapStart <= 0 || gapEnd <= 0) continue; // lines cross → invalid

      const convergenceRatio = gapEnd / gapStart;
      if (convergenceRatio >= params.minConvergence) continue; // not converging enough

      // Slope classification (relative slope over window)
      const barsSpan = Math.max(1, winEnd - winStart);
      const avgHigh = peaks.reduce((s, p) => s + p.price, 0) / peaks.length;
      const avgLow = valleys.reduce((s, p) => s + p.price, 0) / valleys.length;
      const upperRelSlope = upperLine.slope * barsSpan / Math.max(1e-12, avgHigh);
      const lowerRelSlope = lowerLine.slope * barsSpan / Math.max(1e-12, avgLow);

      // Both meaningfully same direction → likely wedge, skip
      if (upperRelSlope > params.moveThreshold && lowerRelSlope > params.moveThreshold) continue;
      if (upperRelSlope < -params.moveThreshold && lowerRelSlope < -params.moveThreshold) continue;

      const upperFlat = Math.abs(upperRelSlope) < params.flatThreshold;
      const upperFalling = upperRelSlope < -params.moveThreshold;
      const lowerFlat = Math.abs(lowerRelSlope) < params.flatThreshold;
      const lowerRising = lowerRelSlope > params.moveThreshold;

      // Classify
      let triangleType: 'triangle_ascending' | 'triangle_descending' | 'triangle_symmetrical' | null = null;

      if (wantAsc && upperFlat && lowerRising) {
        triangleType = 'triangle_ascending';
      } else if (wantDesc && upperFalling && lowerFlat) {
        triangleType = 'triangle_descending';
      } else if (wantSym && upperFalling && lowerRising) {
        triangleType = 'triangle_symmetrical';
      }

      if (!triangleType) {
        debugCandidates.push({
          type: 'triangle_symmetrical' as any,
          accepted: false,
          reason: 'classification_failed',
          indices: [winStart, winEnd],
          details: {
            upperRelSlope: Number(upperRelSlope.toFixed(4)),
            lowerRelSlope: Number(lowerRelSlope.toFixed(4)),
            convergenceRatio: Number(convergenceRatio.toFixed(3)),
            upperFlat, upperFalling, lowerFlat, lowerRising,
          }
        });
        continue;
      }

      // --- Breakout detection (ATR × 0.3 buffer) ---
      const localATR = calcATR(candles, Math.max(1, winStart), winEnd, 14);

      const patternEndIdx = Math.max(
        peaks[peaks.length - 1].idx,
        valleys[valleys.length - 1].idx,
      );

      let breakoutIdx = -1;
      let breakoutDirection: 'up' | 'down' | null = null;

      // Scan from 50% into the pattern (triangle breakout typically happens in latter half)
      const scanStart = winStart + Math.max(3, Math.floor(barsSpan * 0.5));
      for (let i = scanStart; i <= lastIdx; i++) {
        const close = candles[i].close;
        const uVal = upperLine.valueAt(i);
        const lVal = lowerLine.valueAt(i);

        if (close > uVal + localATR * 0.3) {
          breakoutIdx = i;
          breakoutDirection = 'up';
          break;
        }
        if (close < lVal - localATR * 0.3) {
          breakoutIdx = i;
          breakoutDirection = 'down';
          break;
        }
      }

      // --- Status determination ---
      const hasBreakout = breakoutIdx !== -1;
      const resultEndIdx = hasBreakout ? breakoutIdx : patternEndIdx;

      // Expected breakout direction by type
      const expectedDirection: 'up' | 'down' | null =
        triangleType === 'triangle_ascending' ? 'up' :
        triangleType === 'triangle_descending' ? 'down' :
        null; // symmetrical: either direction is valid

      const isExpectedBreakout = hasBreakout && (
        expectedDirection === null || breakoutDirection === expectedDirection
      );

      let status: 'completed' | 'invalid' | 'forming' | 'near_completion';
      if (hasBreakout) {
        status = isExpectedBreakout ? 'completed' : 'invalid';
      } else {
        // No breakout — skip old historical patterns that never broke out
        if (lastIdx - winEnd > windowSize * 0.5) continue;

        // Check apex proximity for forming status
        const slopeDiff = upperLine.slope - lowerLine.slope;
        if (Math.abs(slopeDiff) > 1e-12) {
          const apexIdx = Math.round((lowerLine.intercept - upperLine.intercept) / slopeDiff);
          const barsToApex = Math.max(0, apexIdx - lastIdx);
          status = barsToApex <= 5 ? 'near_completion' : 'forming';
        } else {
          status = 'forming';
        }
      }

      // Skip forming if not requested
      if ((status === 'forming' || status === 'near_completion') && !includeForming) continue;

      const startIso = candles[winStart]?.isoTime;
      const endIso = candles[resultEndIdx]?.isoTime;
      if (!startIso || !endIso) continue;

      // --- Neckline for aftermath ---
      // ascending: upper (flat) line / descending: lower (flat) line / symmetrical: breakout side
      const necklineLine =
        triangleType === 'triangle_ascending' ? upperLine :
        triangleType === 'triangle_descending' ? lowerLine :
        (breakoutDirection === 'down' ? lowerLine : upperLine);

      const neckline = [
        { x: winStart, y: Number(necklineLine.valueAt(winStart).toFixed(2)) },
        { x: winEnd, y: Number(necklineLine.valueAt(winEnd).toFixed(2)) },
      ];

      // --- Scoring ---
      const fitScore = (upperLine.r2 + lowerLine.r2) / 2;
      const convScore = clamp01((1 - convergenceRatio) / 0.5);
      const touchScore = clamp01((peaks.length + valleys.length) / 8);
      // Symmetry: how close are the two slope magnitudes? (relevant for symmetrical type)
      const symScore = triangleType === 'triangle_symmetrical'
        ? clamp01(1 - Math.abs(Math.abs(upperRelSlope) - Math.abs(lowerRelSlope))
            / Math.max(1e-12, Math.abs(upperRelSlope) + Math.abs(lowerRelSlope)))
        : 0.5; // neutral for asc/desc

      const baseScore = fitScore * 0.25 + convScore * 0.25 + touchScore * 0.30 + symScore * 0.20;
      const confidence = finalizeConf(baseScore, triangleType);

      const outcome = hasBreakout
        ? (isExpectedBreakout ? 'success' : 'failure')
        : undefined;

      // Pivot points for aftermath target calculation
      const allPivots = [
        ...peaks.map(p => ({ idx: p.idx, price: p.price, kind: 'H' as const })),
        ...valleys.map(p => ({ idx: p.idx, price: p.price, kind: 'L' as const })),
      ].sort((a, b) => a.idx - b.idx);

      // --- Trendoscope 2-stage: pole detection → pennant reclassification ---
      let finalType: string = triangleType;
      let poleDirection: 'up' | 'down' | undefined;
      let poleATRMult: number | undefined;
      let reclassifiedStartIso = startIso;
      let flagpoleHeight: number | undefined;
      let retracementRatio: number | undefined;
      let isTrendContinuation: boolean | undefined;

      if (wantPennant) {
        const pole = detectPole(candles, winStart, type);
        if (pole) {
          finalType = 'pennant';
          poleDirection = pole.poleDirection;
          poleATRMult = pole.atrMult;
          flagpoleHeight = pole.poleHeight;

          // Extend range start to pole start
          const poleStartIso = candles[pole.poleStart]?.isoTime;
          if (poleStartIso) reclassifiedStartIso = poleStartIso;

          // Calculate retracement ratio: how much of the pole move has been retraced
          const poleEndPrice = candles[pole.poleEnd].close;
          const triHigh = Math.max(...peaks.map(p => p.price));
          const triLow = Math.min(...valleys.map(p => p.price));
          if (pole.poleHeight > 0) {
            retracementRatio = pole.poleDirection === 'up'
              ? (poleEndPrice - triLow) / pole.poleHeight
              : (triHigh - poleEndPrice) / pole.poleHeight;
            retracementRatio = Math.max(0, Math.min(1, retracementRatio));
          }

          // Set isTrendContinuation for pennant
          // ペナント失敗（ダマシ）は構造的には有効なパターンなので status は 'completed' のまま維持
          // outcome で success/failure を区別する（'invalid' にすると includeInvalid フィルタで除外されてしまう）
          if (hasBreakout) {
            isTrendContinuation = pole.poleDirection === breakoutDirection;
          }
        }
      }

      // Confidence adjustment for pennants
      let finalConfidence: number;
      if (finalType === 'pennant') {
        let pennantScore = baseScore * 0.90 + clamp01((poleATRMult ?? 0) / 6) * 0.05;
        // Retracement penalty: >38% retracement reduces confidence (more triangle-like)
        if (retracementRatio !== undefined && retracementRatio > 0.38) {
          const penalty = Math.min(0.15, (retracementRatio - 0.38) * 0.25);
          pennantScore -= penalty;
        }
        finalConfidence = finalizeConf(Math.max(0, pennantScore), 'pennant');
      } else {
        finalConfidence = confidence;
      }

      // --- ターゲット価格計算 ---
      const patternHeight = gapStart; // パターン入口の高さ
      let breakoutTarget: number | undefined;
      let targetReachedPct: number | undefined;
      let targetMethod: 'flagpole_projection' | 'pattern_height' | undefined;
      if (hasBreakout && breakoutDirection) {
        const bp = candles[breakoutIdx].close;
        if (finalType === 'pennant' && flagpoleHeight !== undefined) {
          // ペナント: フラッグポール投影
          breakoutTarget = breakoutDirection === 'up' ? bp + flagpoleHeight : bp - flagpoleHeight;
          targetMethod = 'flagpole_projection';
        } else {
          // トライアングル: パターン高さ投影
          breakoutTarget = breakoutDirection === 'up' ? bp + patternHeight : bp - patternHeight;
          targetMethod = 'pattern_height';
        }
        breakoutTarget = Math.round(breakoutTarget);
        const curPrice = Number(candles[lastIdx]?.close);
        if (Number.isFinite(curPrice) && Math.abs(breakoutTarget - bp) > 1e-12) {
          targetReachedPct = Math.round(((curPrice - bp) / (breakoutTarget - bp)) * 100);
        }
      }

      // --- 用語正規化ラベル ---
      let trendlineLabel: string | undefined;
      if (finalType === 'pennant') {
        trendlineLabel = 'コンソリデーション境界線';
      } else if (triangleType === 'triangle_ascending') {
        trendlineLabel = '上限トレンドライン（レジスタンス）';
      } else if (triangleType === 'triangle_descending') {
        trendlineLabel = '下限トレンドライン（サポート）';
      } else {
        trendlineLabel = 'トレンドライン（ブレイク側）';
      }

      patterns.push({
        type: finalType,
        confidence: finalConfidence,
        range: { start: reclassifiedStartIso, end: endIso },
        status,
        pivots: allPivots,
        neckline,
        trendlineLabel,
        breakoutDirection: breakoutDirection ?? undefined,
        outcome: hasBreakout
          ? (finalType === 'pennant'
            ? (isTrendContinuation ? 'success' : 'failure')
            : (status === 'completed' ? 'success' : 'failure'))
          : undefined,
        breakoutBarIndex: hasBreakout ? breakoutIdx : undefined,
        ...(breakoutTarget !== undefined ? { breakoutTarget, targetMethod } : {}),
        ...(targetReachedPct !== undefined ? { targetReachedPct } : {}),
        ...(poleDirection ? {
          poleDirection,
          priorTrendDirection: poleDirection === 'up' ? 'bullish' : 'bearish',
          ...(flagpoleHeight !== undefined ? { flagpoleHeight: Math.round(flagpoleHeight) } : {}),
          ...(retracementRatio !== undefined ? { retracementRatio: Number(retracementRatio.toFixed(2)) } : {}),
          ...(isTrendContinuation !== undefined ? { isTrendContinuation } : {}),
        } : {}),
      });

      debugCandidates.push({
        type: finalType as any,
        accepted: true,
        reason: finalType === 'pennant' ? 'reclassified_from_triangle' : 'detected',
        indices: [winStart, resultEndIdx],
        details: {
          convergenceRatio: Number(convergenceRatio.toFixed(3)),
          r2Upper: Number(upperLine.r2.toFixed(3)),
          r2Lower: Number(lowerLine.r2.toFixed(3)),
          upperRelSlope: Number(upperRelSlope.toFixed(4)),
          lowerRelSlope: Number(lowerRelSlope.toFixed(4)),
          touchCount: peaks.length + valleys.length,
          breakout: hasBreakout ? { idx: breakoutIdx, direction: breakoutDirection } : null,
          status,
          confidence: finalConfidence,
          ...(poleDirection ? {
            poleDirection,
            poleATRMult: Number((poleATRMult ?? 0).toFixed(2)),
            ...(flagpoleHeight !== undefined ? { flagpoleHeight: Math.round(flagpoleHeight) } : {}),
            ...(retracementRatio !== undefined ? { retracementRatio: Number(retracementRatio.toFixed(2)) } : {}),
            ...(isTrendContinuation !== undefined ? { isTrendContinuation } : {}),
          } : {}),
        }
      });
    }
  }

  patterns = deduplicatePatterns(patterns);

  return { patterns };
}
