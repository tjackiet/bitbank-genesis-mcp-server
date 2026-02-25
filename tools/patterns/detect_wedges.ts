/**
 * Wedge 検出（Rising / Falling — 完成済み＋形成中）
 * - 4b) 回帰ベース（完成済みの主力検出）
 * - 4d) 形成中ウェッジ検出（緩い条件）
 */
import { generatePatternDiagram } from '../../src/utils/pattern-diagrams.js';
import {
  generateWindows,
  determineWedgeType,
  checkConvergenceEx,
  evaluateTouchesEx,
  calcAlternationScoreEx,
  calcInsideRatioEx,
  calcDurationScoreEx,
  calculatePatternScoreEx,
  calcATR,
  detectWedgeBreak,
  deduplicatePatterns,
} from './helpers.js';
import type { DetectContext, DetectResult } from './types.js';

export function detectWedges(ctx: DetectContext): DetectResult {
  const { candles, pivots, want, tolerancePct, minDist, swingDepth, lrWithR2, debugCandidates } = ctx;
  const push = (arr: any[], item: any) => { arr.push(item); };
  const patterns: any[] = [];

  // 4b) Revamped Wedge scanning (rising/falling)
  {
    const params = {
      swingDepth,
      minBarsBetweenSwings: minDist,
      tolerancePct,
      windowSizeMin: 25,
      windowSizeMax: 90,
      windowStep: 5,
      minSlope: 0.00005,
      maxSlope: 0.08,
      slopeRatioMin: 1.15,
      slopeRatioMinRising: 1.20,
      minWeakerSlopeRatio: 0.3, // ★ 追加: 弱い方のラインの最小傾き比率
      minTouchesPerLine: 3,
      minScore: 0.5,
    };
    const swings = {
      highs: pivots.filter(p => p.kind === 'H').map(p => ({ index: p.idx, price: p.price })),
      lows: pivots.filter(p => p.kind === 'L').map(p => ({ index: p.idx, price: p.price })),
    };
    const allowRising = (want.size === 0) || want.has('rising_wedge' as any);
    const allowFalling = (want.size === 0) || want.has('falling_wedge' as any);
    const windows = generateWindows(candles.length, params.windowSizeMin, params.windowSizeMax, params.windowStep);
    for (const w of windows) {
      const highsIn = swings.highs.filter(s => s.index >= w.startIdx && s.index <= w.endIdx);
      const lowsIn = swings.lows.filter(s => s.index >= w.startIdx && s.index <= w.endIdx);
      // ピボット数を4以上に引き上げ（より信頼性の高いトレンドラインのため）
      if (highsIn.length < 4 || lowsIn.length < 4) continue;
      const upper = lrWithR2(highsIn.map(s => ({ x: s.index, y: s.price })));
      const lower = lrWithR2(lowsIn.map(s => ({ x: s.index, y: s.price })));
      if (upper.r2 < 0.40 || lower.r2 < 0.40) {
        // Debug: R^2不足で却下（0.25→0.40 に引き上げ: フィットの悪い回帰線を除外）
        const dbgType = (upper.slope < 0 && lower.slope < 0) ? 'falling_wedge' : ((upper.slope > 0 && lower.slope > 0) ? 'rising_wedge' : 'triangle_symmetrical');
        debugCandidates.push({
          type: dbgType as any,
          accepted: false,
          reason: 'r2_below_threshold',
          indices: [w.startIdx, w.endIdx],
          details: { r2High: upper.r2, r2Low: lower.r2, slopeHigh: upper.slope, slopeLow: lower.slope, r2MinRequired: 0.40 }
        });
        continue;
      }
      // Phase 1: Rising Wedge の「有意な上昇」チェック（動的なしきい値）
      if (upper.slope > 0 && lower.slope > 0) {
        let hiMax = -Infinity, loMin = Infinity;
        for (let i = w.startIdx; i <= w.endIdx; i++) {
          const hi = Number(candles[i]?.high ?? NaN);
          const lo = Number(candles[i]?.low ?? NaN);
          if (Number.isFinite(hi)) hiMax = Math.max(hiMax, hi);
          if (Number.isFinite(lo)) loMin = Math.min(loMin, lo);
        }
        const priceRange = Number.isFinite(hiMax) && Number.isFinite(loMin) ? (hiMax - loMin) : 0;
        const barsSpan = Math.max(1, w.endIdx - w.startIdx);
        const minMeaningfulSlope = (priceRange * 0.01) / barsSpan; // 期間中に価格レンジの1%以上
        const absHi = Math.abs(upper.slope);
        const absLo = Math.abs(lower.slope);
        // 汎用プローブ: 指定窓群で詳細情報を出す
        const probeWindows: Array<[number, number]> = [
          [105, 175], [140, 210], [140, 225], [135, 225], [140, 230]
        ];
        const isProbe = probeWindows.some(([s, e]) => s === w.startIdx && e === w.endIdx);
        if (isProbe) {
          const highsArr = highsIn.map(s => ({ index: s.index, price: s.price }));
          const lowsArr = lowsIn.map(s => ({ index: s.index, price: s.price }));
          const slopeRatioLH = absLo / Math.max(1e-12, absHi);
          const firstHalfProbe = highsIn.slice(0, Math.floor(highsIn.length / 2));
          const secondHalfProbe = highsIn.slice(Math.floor(highsIn.length / 2));
          const firstAvgProbe = firstHalfProbe.reduce((s, p) => s + Number(p.price), 0) / Math.max(1, firstHalfProbe.length);
          const secondAvgProbe = secondHalfProbe.reduce((s, p) => s + Number(p.price), 0) / Math.max(1, secondHalfProbe.length);
          const ratioProbe = Number((secondAvgProbe / Math.max(1e-12, firstAvgProbe)).toFixed(4));
          debugCandidates.unshift({
            type: 'rising_wedge' as any,
            accepted: false,
            reason: 'rising_probe',
            indices: [w.startIdx, w.endIdx],
            details: {
              highsCount: highsIn.length,
              r2High: upper.r2, r2Low: lower.r2,
              slopeHigh: upper.slope, slopeLow: lower.slope,
              slopeRatioLH,
              priceRange, barsSpan, minMeaningfulSlope,
              firstAvg: firstAvgProbe, secondAvg: secondAvgProbe, ratio: ratioProbe,
              highsIn: highsArr, lowsIn: lowsArr
            }
          });
        }
        // 指定窓の詳細プローブ（5/21-8/19 などの検証用）
        if (w.startIdx === 105 && w.endIdx === 175) {
          const highsArr = highsIn.map(s => ({ index: s.index, price: s.price }));
          const lowsArr = lowsIn.map(s => ({ index: s.index, price: s.price }));
          // 先頭に挿入して cap=200 に切られないようにする
          debugCandidates.unshift({
            type: 'rising_wedge' as any,
            accepted: false,
            reason: 'probe_window',
            indices: [w.startIdx, w.endIdx],
            details: { slopeHigh: upper.slope, slopeLow: lower.slope, hiSlope: upper.slope, loSlope: lower.slope, priceRange, barsSpan, minMeaningfulSlope, highsIn: highsArr, lowsIn: lowsArr }
          });
        }
        if (absHi < minMeaningfulSlope) {
          debugCandidates.push({
            type: 'rising_wedge' as any,
            accepted: false,
            reason: 'upper_line_barely_rising',
            indices: [w.startIdx, w.endIdx],
            details: { slopeHigh: upper.slope, slopeLow: lower.slope, minMeaningfulSlope, priceRange, barsSpan }
          });
          continue;
        }
        // 新規: 高値トレンドチェック（後半の平均高値が前半の99%未満なら切り下がりとして却下）
        if (highsIn.length >= 3) {
          const mid = Math.floor(highsIn.length / 2);
          const firstHalf = highsIn.slice(0, mid);
          const secondHalf = highsIn.slice(mid);
          const firstAvg = firstHalf.reduce((s, p) => s + Number(p.price), 0) / Math.max(1, firstHalf.length);
          const secondAvg = secondHalf.reduce((s, p) => s + Number(p.price), 0) / Math.max(1, secondHalf.length);
          const ratio = Number((secondAvg / Math.max(1e-12, firstAvg)).toFixed(4));
          // デバッグ用プローブ（対象窓の場合は必ずログ）
          if (w.startIdx === 105 && w.endIdx === 175) {
            debugCandidates.unshift({
              type: 'rising_wedge' as any,
              accepted: false,
              reason: 'declining_highs_probe',
              indices: [w.startIdx, w.endIdx],
              details: { highsCount: highsIn.length, firstAvg, secondAvg, ratio }
            });
          }
          if (Number.isFinite(firstAvg) && Number.isFinite(secondAvg) && ratio < 0.99) {
            debugCandidates.push({
              type: 'rising_wedge' as any,
              accepted: false,
              reason: 'declining_highs',
              indices: [w.startIdx, w.endIdx],
              details: { firstAvg, secondAvg, ratio }
            });
            continue;
          }
        }
      }
      const wedgeType = determineWedgeType(upper.slope, lower.slope, params);
      if (!wedgeType) {
        const absHi = Math.abs(upper.slope);
        const absLo = Math.abs(lower.slope);
        const slopeRatioHL = absHi / Math.max(1e-12, absLo);
        const slopeRatioLH = absLo / Math.max(1e-12, absHi);
        let failureReason: 'slope_ratio_too_small' | 'slopes_too_flat' | 'wrong_side_steeper' = 'slope_ratio_too_small';
        if ((upper.slope > 0 && lower.slope > 0)) {
          // rising wedge候補: 下側が急、absLo/absHi > ratioMin
          if (absHi < (params.minSlope ?? 0.0001) || absLo < (params.minSlope ?? 0.0001)) {
            failureReason = 'slopes_too_flat';
          } else if (!(absLo > absHi)) {
            failureReason = 'wrong_side_steeper';
          } else if (!(slopeRatioLH > (params.slopeRatioMinRising ?? 1.20))) {
            failureReason = 'slope_ratio_too_small';
          }
        } else if ((upper.slope < 0 && lower.slope < 0)) {
          // falling wedge候補: 上側が急、absHi/absLo > ratioMin
          if (absHi < (params.minSlope ?? 0.0001) || absLo < (params.minSlope ?? 0.0001)) {
            failureReason = 'slopes_too_flat';
          } else if (!(absHi > absLo)) {
            failureReason = 'wrong_side_steeper';
          } else if (!(slopeRatioHL > (((params as any).slopeRatioMinFalling ?? (params.slopeRatioMin ?? 1.15))))) {
            failureReason = 'slope_ratio_too_small';
          }
        } else {
          // 逆向き（ウェッジの対象外）→ 比率不足扱いに寄せる
          failureReason = 'slope_ratio_too_small';
        }
        const dbgType = (upper.slope < 0 && lower.slope < 0) ? 'falling_wedge' : ((upper.slope > 0 && lower.slope > 0) ? 'rising_wedge' : 'triangle_symmetrical');
        debugCandidates.push({
          type: dbgType as any,
          accepted: false,
          reason: 'type_classification_failed',
          indices: [w.startIdx, w.endIdx],
          details: {
            slopeHigh: upper.slope,
            slopeLow: lower.slope,
            slopeRatio: Number((Math.abs(upper.slope) / Math.max(1e-12, Math.abs(lower.slope))).toFixed(4)),
            minSlope: (params.minSlope ?? 0.0001),
            maxSlope: (params.maxSlope ?? 0.05),
            slopeRatioMin: (dbgType === 'rising_wedge'
              ? (params.slopeRatioMinRising ?? 1.20)
              : (((params as any).slopeRatioMinFalling ?? (params.slopeRatioMin ?? 1.15)))),
            failureReason
          }
        });
        continue;
      }
      // リクエストされていないタイプは以降を評価しない
      if ((wedgeType === 'rising_wedge' && !allowRising) || (wedgeType === 'falling_wedge' && !allowFalling)) {
        debugCandidates.push({
          type: wedgeType as any,
          accepted: false,
          reason: 'type_not_requested',
          indices: [w.startIdx, w.endIdx]
        });
        continue;
      }
      const conv = checkConvergenceEx(upper, lower, w.startIdx, w.endIdx);
      if (!conv.isConverging) {
        debugCandidates.push({
          type: wedgeType as any,
          accepted: false,
          reason: 'convergence_failed',
          indices: [w.startIdx, w.endIdx],
          details: { gapStart: conv.gapStart, gapEnd: conv.gapEnd, ratio: conv.ratio, isAccelerating: conv.isAccelerating }
        });
        continue;
      }
      const touches = evaluateTouchesEx(candles as any, upper, lower, w.startIdx, w.endIdx);
      if (touches.upperQuality < (params.minTouchesPerLine ?? 2) || touches.lowerQuality < (params.minTouchesPerLine ?? 2)) {
        debugCandidates.push({
          type: wedgeType as any,
          accepted: false,
          reason: 'insufficient_touches',
          indices: [w.startIdx, w.endIdx],
          details: { upperTouches: touches.upperQuality, lowerTouches: touches.lowerQuality, minRequired: (params.minTouchesPerLine ?? 2) }
        });
        continue;
      }
      // タッチ間隔チェック（日足で25本以上空いていたら除外）
      const calcMaxGap = (touchArr: any[]): number => {
        const validTouches = touchArr.filter((t: any) => !t.isBreak).map((t: any) => t.index).sort((a: number, b: number) => a - b);
        if (validTouches.length < 2) return Infinity;
        let maxGap = 0;
        for (let i = 1; i < validTouches.length; i++) {
          maxGap = Math.max(maxGap, validTouches[i] - validTouches[i - 1]);
        }
        return maxGap;
      };
      const maxTouchGap = 25; // 日足で25本（約1ヶ月）
      const upperMaxGap = calcMaxGap(touches.upperTouches);
      const lowerMaxGap = calcMaxGap(touches.lowerTouches);
      const maxGap = Math.max(upperMaxGap, lowerMaxGap);
      if (maxGap > maxTouchGap) {
        debugCandidates.push({
          type: wedgeType as any,
          accepted: false,
          reason: 'touch_gap_too_large',
          indices: [w.startIdx, w.endIdx],
          details: { upperMaxGap, lowerMaxGap, maxGap, maxAllowed: maxTouchGap }
        });
        continue;
      }
      // 開始日ギャップチェック（上下ラインのファーストタッチが離れすぎていないか）
      const maxStartGap = 10; // 日足で10本以内
      const firstUpperTouch = touches.upperTouches.find((t: any) => !t.isBreak);
      const firstLowerTouch = touches.lowerTouches.find((t: any) => !t.isBreak);
      if (firstUpperTouch && firstLowerTouch) {
        const startGap = Math.abs(firstUpperTouch.index - firstLowerTouch.index);
        if (startGap > maxStartGap) {
          debugCandidates.push({
            type: wedgeType as any,
            accepted: false,
            reason: 'start_gap_too_large',
            indices: [w.startIdx, w.endIdx],
            details: {
              firstUpperIdx: firstUpperTouch.index,
              firstLowerIdx: firstLowerTouch.index,
              startGap,
              maxAllowed: maxStartGap
            }
          });
          continue;
        }
      }
      const alternation = calcAlternationScoreEx(touches);
      // 上下タッチのバランスチェック（極端な偏りを除外）
      {
        const upQ = Number(touches?.upperQuality ?? 0);
        const loQ = Number(touches?.lowerQuality ?? 0);
        const denom = Math.max(upQ, loQ, 1);
        const touchBalance = Math.min(upQ, loQ) / denom;
        const minTouchBalance = 0.45;
        if (touchBalance < minTouchBalance) {
          debugCandidates.push({
            type: wedgeType as any,
            accepted: false,
            reason: 'unbalanced_touches',
            indices: [w.startIdx, w.endIdx],
            details: {
              upperTouches: upQ,
              lowerTouches: loQ,
              balance: Number(touchBalance.toFixed(3)),
              minRequired: minTouchBalance
            }
          });
          continue;
        }
      }
      const insideRatio = calcInsideRatioEx(candles as any, upper, lower, w.startIdx, w.endIdx);
      const score = calculatePatternScoreEx({
        fitScore: (upper.r2 + lower.r2) / 2,
        convergeScore: conv.score,
        touchScore: touches.score,
        alternationScore: alternation,
        insideScore: insideRatio,
        durationScore: calcDurationScoreEx(w.endIdx - w.startIdx, params),
      });
      // 最低交互性チェック（再有効化: 上下タッチの交互性が低い場合は除外）
      {
        const minAlternation = 0.25; // 0.3→0.25 に下げて適度な閾値に
        if (Number(alternation ?? 0) < minAlternation) {
          debugCandidates.push({
            type: wedgeType as any,
            accepted: false,
            reason: 'insufficient_alternation',
            indices: [w.startIdx, w.endIdx],
            details: {
              alternation: Number((alternation ?? 0).toFixed(3)),
              minRequired: minAlternation,
              upperTouches: Number(touches?.upperQuality ?? 0),
              lowerTouches: Number(touches?.lowerQuality ?? 0),
            }
          });
          continue;
        }
      }
      if (score < (params.minScore ?? 0.6)) {
        debugCandidates.push({
          type: wedgeType as any,
          accepted: false,
          reason: 'score_below_threshold',
          indices: [w.startIdx, w.endIdx],
          details: {
            score: Number(score.toFixed(3)),
            minScore: (params.minScore ?? 0.6),
            components: {
              fit: Number(((upper.r2 + lower.r2) / 2).toFixed(3)),
              converge: Number((conv.score ?? 0).toFixed(3)),
              touch: Number((touches.score ?? 0).toFixed(3)),
              alternation: Number((alternation ?? 0).toFixed(3)),
              inside: Number((insideRatio ?? 0).toFixed(3)),
              duration: Number((calcDurationScoreEx(w.endIdx - w.startIdx, params)).toFixed(3))
            }
          }
        });
        continue;
      }
      const start = (candles[w.startIdx] as any)?.isoTime;
      const theoreticalEnd = (candles[w.endIdx] as any)?.isoTime;
      if (!start || !theoreticalEnd) continue;

      // ブレイク検出
      const lastIdx = candles.length - 1;
      const atr = calcATR(candles, w.startIdx, w.endIdx, 14);
      const breakInfo = detectWedgeBreak(candles, wedgeType, upper, lower, w.startIdx, w.endIdx, lastIdx, atr);


      // 終点: ブレイクが検出された場合はブレイク日、そうでなければウィンドウ終端
      const actualEndIdx = breakInfo.detected ? breakInfo.breakIdx : w.endIdx;
      const end = (candles[actualEndIdx] as any)?.isoTime ?? theoreticalEnd;

      // ブレイク方向の判定
      let breakoutDirection: 'up' | 'down' | null = null;
      if (breakInfo.detected && Number.isFinite(breakInfo.breakPrice)) {
        const breakPrice = breakInfo.breakPrice as number;
        const lLineAtBreak = lower.valueAt(breakInfo.breakIdx);
        const uLineAtBreak = upper.valueAt(breakInfo.breakIdx);
        if (breakPrice < lLineAtBreak - atr * 0.3) {
          breakoutDirection = 'down';
        } else if (breakPrice > uLineAtBreak + atr * 0.3) {
          breakoutDirection = 'up';
        }
      }

      const confidence = Math.max(0, Math.min(1, Number(score.toFixed(2))));
      // ダイアグラム用にタッチポイントから主要点を間引きして pivots を構成
      const upTouchPts = (touches.upperTouches || []).filter((t: any) => !t.isBreak).map((t: any) => ({ idx: t.index, kind: 'H' as const }));
      const loTouchPts = (touches.lowerTouches || []).filter((t: any) => !t.isBreak).map((t: any) => ({ idx: t.index, kind: 'L' as const }));
      const allPts = [...upTouchPts, ...loTouchPts].sort((a, b) => a.idx - b.idx);
      const downsample = (pts: Array<{ idx: number; kind: 'H' | 'L' }>, maxPoints = 6) => {
        if (pts.length <= maxPoints) return pts;
        const out: typeof pts = [];
        const lastIdxPts = pts.length - 1;
        for (let i = 0; i < maxPoints; i++) {
          const pos = Math.round((i / Math.max(1, maxPoints - 1)) * lastIdxPts);
          out.push(pts[pos]);
        }
        // 重複を除去（同じ idx が選ばれた場合）
        return out.filter((p, i, arr) => arr.findIndex(q => q.idx === p.idx && q.kind === p.kind) === i);
      };
      const sel = downsample(allPts, 6);
      const pivForDiagram = sel.map(p => ({
        idx: p.idx,
        price: Number(candles[p.idx]?.close ?? NaN),
        kind: p.kind,
        date: (candles[p.idx] as any)?.isoTime
      }));
      let diagram: any = undefined;
      try {
        diagram = generatePatternDiagram(
          wedgeType,
          pivForDiagram,
          { price: 0 }, // ウェッジでは未使用
          { start, end }
        );
      } catch { /* noop */ }

      // aftermath情報（ブレイク後の結果）
      // falling_wedge: 上方ブレイクが成功、下方ブレイクは失敗
      // rising_wedge: 下方ブレイクが成功、上方ブレイクは失敗
      const isSuccessfulBreakout = breakInfo.detected ? (
        wedgeType === 'falling_wedge'
          ? breakoutDirection === 'up'
          : breakoutDirection === 'down'
      ) : false;

      const aftermath = breakInfo.detected ? {
        breakoutDate: breakInfo.breakIsoTime,
        breakoutConfirmed: true,
        targetReached: false, // TODO: 目標価格到達の判定を追加
        outcome: isSuccessfulBreakout
          ? (wedgeType === 'falling_wedge' ? 'bullish_breakout' : 'bearish_breakout')
          : (wedgeType === 'falling_wedge' ? 'bearish_breakdown' : 'bullish_breakdown'),
      } : undefined;

      push(patterns, {
        type: wedgeType,
        confidence,
        range: { start, end },
        ...(aftermath ? { aftermath } : {}),
        ...(diagram ? { structureDiagram: diagram } : {})
      });
      debugCandidates.push({
        type: wedgeType,
        accepted: true,
        reason: 'revamped_ok',
        indices: [w.startIdx, actualEndIdx],
        details: {
          slopeHigh: upper.slope, slopeLow: lower.slope, r2High: upper.r2, r2Low: lower.r2,
          converge: conv, touches: { up: touches.upperQuality, lo: touches.lowerQuality }, alternation, insideRatio, score,
          breakInfo: breakInfo.detected ? { ...breakInfo, direction: breakoutDirection } : null
        }
      });
    }
  }

  // 4d) 形成中ウェッジ検出
  // 4b（回帰ベース）が完成済みの主力。4d は形成中向け（緩い条件）
  {
    const formingWedgeDebug: any[] = [];
    const fWindowSizeMin = 20;  // 短いウィンドウも許容
    const fWindowSizeMax = 120;
    const fWindowStep = 5;

    const fAllowFalling = (want.size === 0) || want.has('falling_wedge' as any);
    const fAllowRising = (want.size === 0) || want.has('rising_wedge' as any);

    // 緩いピボット検出（swingDepth=1）
    const relaxedPeaks: Array<{ idx: number; price: number }> = [];
    const relaxedValleys: Array<{ idx: number; price: number }> = [];
    for (let idx = 1; idx < candles.length - 1; idx++) {
      const c = candles[idx];
      const isPeak = c.high > candles[idx - 1].high && c.high > candles[idx + 1].high;
      const isValley = c.low < candles[idx - 1].low && c.low < candles[idx + 1].low;
      if (isPeak) relaxedPeaks.push({ idx, price: c.close });
      if (isValley) relaxedValleys.push({ idx, price: c.close });
    }

    // 2点直線作成（4c と同じ）
    function makeLineF(p1: { idx: number; price: number }, p2: { idx: number; price: number }) {
      const slope = (p2.price - p1.price) / Math.max(1, p2.idx - p1.idx);
      const intercept = p1.price - slope * p1.idx;
      return { slope, intercept, valueAt: (idx: number) => slope * idx + intercept, p1, p2 };
    }

    // 上側トレンドライン（1/2分割、緩い条件）
    function findUpperTrendlineF(highs: { idx: number; price: number }[], startIdx: number, endIdx: number, tolerance: number) {
      const inRange = highs.filter(h => h.idx >= startIdx && h.idx <= endIdx);
      if (inRange.length < 2) return null;

      const midPoint = startIdx + (endIdx - startIdx) / 2;
      const firstHalf = inRange.filter(h => h.idx < midPoint);
      const secondHalf = inRange.filter(h => h.idx >= midPoint);
      const cand1 = firstHalf.length > 0 ? firstHalf : inRange.slice(0, Math.ceil(inRange.length / 2));
      const cand2 = secondHalf.length > 0 ? secondHalf : inRange.slice(Math.floor(inRange.length / 2));
      if (cand1.length === 0 || cand2.length === 0) return null;

      let bestLine: ReturnType<typeof makeLineF> | null = null;
      let bestScore = -Infinity;

      for (const p1 of cand1) {
        for (const p2 of cand2) {
          if (p1.idx >= p2.idx) continue;
          const line = makeLineF(p1, p2);
          let valid = true;
          for (const h of inRange) {
            if (h.price > line.valueAt(h.idx) + tolerance) { valid = false; break; }
          }
          if (valid) {
            const touches = inRange.filter(h => Math.abs(h.price - line.valueAt(h.idx)) <= tolerance).length;
            const score = touches + (line.slope < 0 ? 1 : 0);
            if (score > bestScore) { bestScore = score; bestLine = line; }
          }
        }
      }
      return bestLine;
    }

    // 下側トレンドライン（1/2分割、緩い条件）
    function findLowerTrendlineF(lows: { idx: number; price: number }[], startIdx: number, endIdx: number, tolerance: number) {
      const inRange = lows.filter(l => l.idx >= startIdx && l.idx <= endIdx);
      if (inRange.length < 2) return null;

      const midPoint = startIdx + (endIdx - startIdx) / 2;
      const firstHalf = inRange.filter(l => l.idx < midPoint);
      const secondHalf = inRange.filter(l => l.idx >= midPoint);
      const cand1 = firstHalf.length > 0 ? firstHalf : inRange.slice(0, Math.ceil(inRange.length / 2));
      const cand2 = secondHalf.length > 0 ? secondHalf : inRange.slice(Math.floor(inRange.length / 2));
      if (cand1.length === 0 || cand2.length === 0) return null;

      let bestLine: ReturnType<typeof makeLineF> | null = null;
      let bestScore = -Infinity;

      for (const p1 of cand1) {
        for (const p2 of cand2) {
          if (p1.idx >= p2.idx) continue;
          const line = makeLineF(p1, p2);
          let valid = true;
          for (const l of inRange) {
            if (l.price < line.valueAt(l.idx) - tolerance) { valid = false; break; }
          }
          if (valid) {
            const touches = inRange.filter(l => Math.abs(l.price - line.valueAt(l.idx)) <= tolerance).length;
            const score = touches + (line.slope < 0 ? 1 : 0);
            if (score > bestScore) { bestScore = score; bestLine = line; }
          }
        }
      }
      return bestLine;
    }

    // ウィンドウスキャン
    const fWindows: Array<{ startIdx: number; endIdx: number }> = [];
    for (let size = fWindowSizeMin; size <= fWindowSizeMax; size += fWindowStep) {
      for (let startIdx = 0; startIdx + size < candles.length; startIdx += fWindowStep) {
        fWindows.push({ startIdx, endIdx: startIdx + size });
      }
    }
    // 最新に揃えた特別ウィンドウ
    const lastIdx = candles.length - 1;
    for (let size = fWindowSizeMin; size <= fWindowSizeMax; size += fWindowStep) {
      const s = Math.max(0, lastIdx - size);
      fWindows.push({ startIdx: s, endIdx: lastIdx });
    }

    for (const w of fWindows) {
      const { startIdx, endIdx } = w;
      const avgPrice = (Number(candles[startIdx]?.close) + Number(candles[endIdx]?.close)) / 2;
      const tolerance = avgPrice * 0.01;

      const highsForWindow = relaxedPeaks.filter(p => p.idx >= startIdx && p.idx <= endIdx).map(p => ({ idx: p.idx, price: Number(candles[p.idx]?.high) }));
      const lowsForWindow = relaxedValleys.filter(p => p.idx >= startIdx && p.idx <= endIdx).map(p => ({ idx: p.idx, price: Number(candles[p.idx]?.low) }));

      if (highsForWindow.length < 2 || lowsForWindow.length < 2) continue;

      const upperLine = findUpperTrendlineF(highsForWindow, startIdx, endIdx, tolerance);
      const lowerLine = findLowerTrendlineF(lowsForWindow, startIdx, endIdx, tolerance);
      if (!upperLine || !lowerLine) continue;

      // 両方下向き = Falling Wedge、両方上向き = Rising Wedge
      const bothDown = upperLine.slope < 0 && lowerLine.slope < 0;
      const bothUp = upperLine.slope > 0 && lowerLine.slope > 0;
      if (!bothDown && !bothUp) continue;

      // minWeakerSlopeRatio チェック
      const absU = Math.abs(upperLine.slope), absL = Math.abs(lowerLine.slope);
      const weakerRatio = Math.min(absU, absL) / Math.max(absU, absL);
      if (weakerRatio < 0.3) continue;

      const wedgeType: 'falling_wedge' | 'rising_wedge' = bothDown ? 'falling_wedge' : 'rising_wedge';
      if ((wedgeType === 'falling_wedge' && !fAllowFalling) || (wedgeType === 'rising_wedge' && !fAllowRising)) continue;

      // 収束チェック
      const gapStart = upperLine.valueAt(startIdx) - lowerLine.valueAt(startIdx);
      const gapEnd = upperLine.valueAt(endIdx) - lowerLine.valueAt(endIdx);
      if (gapStart <= 0 || gapEnd <= 0 || gapEnd >= gapStart) continue;
      const convRatio = gapEnd / gapStart;
      if (convRatio >= 0.80) continue;

      // ブレイク検出（終値ベース、トレンドライン乖離1.5%）
      let breakoutIdx = -1;
      let breakoutDirection: 'up' | 'down' | null = null;
      for (let i = startIdx + Math.max(15, Math.floor((endIdx - startIdx) * 0.3)); i <= lastIdx; i++) {
        const close = Number(candles[i]?.close);
        const uVal = upperLine.valueAt(i);
        const lVal = lowerLine.valueAt(i);

        // 終値ベースでブレイク判定（視覚的にわかりやすい）
        if (close > uVal * 1.015) {
          breakoutIdx = i; breakoutDirection = 'up'; break;
        }
        if (close < lVal * 0.985) {
          breakoutIdx = i; breakoutDirection = 'down'; break;
        }
      }

      // ブレイクがない場合は形成中
      const isForming = breakoutIdx === -1;
      const actualEndIdx = isForming ? endIdx : breakoutIdx;
      const start = (candles[startIdx] as any)?.isoTime;
      const end = (candles[actualEndIdx] as any)?.isoTime;
      if (!start || !end) continue;

      // 重複チェック: 既に同じパターンが検出されていないか
      const alreadyExists = patterns.some((p: any) => {
        if (p.type !== wedgeType) return false;
        const pStart = Date.parse(p.range?.start || '');
        const pEnd = Date.parse(p.range?.end || '');
        const thisStart = Date.parse(start);
        const thisEnd = Date.parse(end);
        if (!Number.isFinite(pStart) || !Number.isFinite(thisStart)) return false;
        // 開始日が5日以内、終了日が5日以内なら重複
        return Math.abs(pStart - thisStart) < 5 * 86400000 && Math.abs(pEnd - thisEnd) < 5 * 86400000;
      });
      if (alreadyExists) continue;

      // スコア計算
      const convergenceScore = 1 - convRatio;
      const slopeScore = Math.min(absU, absL) / Math.max(absU, absL);
      const durationDays = actualEndIdx - startIdx;
      const durationScore = durationDays >= 20 && durationDays <= 60 ? 1.0 : 0.8;
      const score = (convergenceScore * 0.4 + slopeScore * 0.3 + durationScore * 0.3);
      const confidence = Math.max(0.65, Math.min(0.95, score + 0.3));

      // ステータス判定
      let status: 'forming' | 'near_completion' | 'completed' | 'invalid' = 'forming';
      let outcome: 'success' | 'failure' | undefined;

      if (breakoutDirection) {
        if (wedgeType === 'falling_wedge') {
          status = breakoutDirection === 'up' ? 'completed' : 'invalid';
          outcome = breakoutDirection === 'up' ? 'success' : 'failure';
        } else {
          status = breakoutDirection === 'down' ? 'completed' : 'invalid';
          outcome = breakoutDirection === 'down' ? 'success' : 'failure';
        }
      } else {
        // アペックス計算
        const denom = upperLine.slope - lowerLine.slope;
        if (Math.abs(denom) > 1e-12) {
          const apexIdx = Math.round((lowerLine.intercept - upperLine.intercept) / denom);
          const daysToApex = Math.max(0, apexIdx - lastIdx);
          if (daysToApex <= 10) status = 'near_completion';
        }
      }

      // ブレイク日の取得
      const breakoutDate = breakoutIdx !== -1 ? (candles[breakoutIdx] as any)?.isoTime : undefined;

      push(patterns, {
        type: wedgeType,
        confidence,
        range: { start, end },
        status,
        breakoutDirection,
        outcome,
        breakoutDate,
        _method: 'forming_relaxed',
      });

      formingWedgeDebug.push({ type: wedgeType, accepted: true, indices: [startIdx, actualEndIdx], status, breakoutDirection });
    }

    for (const d of formingWedgeDebug) {
      debugCandidates.unshift(d);
    }
  }

  return { patterns: deduplicatePatterns(patterns) };
}
