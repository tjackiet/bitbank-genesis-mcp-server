/**
 * Triangle 検出（ascending / descending / symmetrical）＋形成中
 * detect_patterns.ts Section 4 から抽出
 */
import { linearRegression, trendlineFit, clamp01 } from './regression.js';
import { periodScoreDays, finalizeConf } from './helpers.js';
import { getTriangleWindowSize, getTriangleCoeffForTf, getConvergenceFactorForTf, getMinFitForTf } from './config.js';
import { findUpperTrendline, findLowerTrendline } from './trendline.js';
import { pushCand, type DetectContext, type DetectResult } from './types.js';

export function detectTriangles(ctx: DetectContext): DetectResult {
  const { candles, pivots, tolerancePct, want, includeForming, pct, debugCandidates } = ctx;
  const type = ctx.type;
  const pcand = (arg: Parameters<typeof pushCand>[1]) => pushCand(ctx, arg);
  const push = (arr: any[], item: any) => { arr.push(item); };
  const patterns: any[] = [];

  // 4) Triangles (ascending/descending/symmetrical)
  {
    const wantTriangle =
      want.size === 0 ||
      want.has('triangle') ||
      want.has('triangle_ascending') ||
      want.has('triangle_descending') ||
      want.has('triangle_symmetrical');
    if (wantTriangle) {
      const highs = pivots.filter(p => p.kind === 'H');
      const lows = pivots.filter(p => p.kind === 'L');
      const WIN = getTriangleWindowSize(type);
      const step = Math.max(1, Math.floor(WIN / 4));
      // DEBUG: 窓スキャンの設定とループ条件（ログ出力は抑止）
      for (let offset = 0; offset <= Math.max(0, Math.min(highs.length, lows.length) - Math.max(3, WIN)); offset += step) {
        // per-iteration debug log removed
        const hwin = highs.slice(offset, offset + WIN);
        const lwin = lows.slice(offset, offset + WIN);
        if (hwin.length < 3 || lwin.length < 3) continue;
        const coef = getTriangleCoeffForTf(type);
        const firstH = hwin[0], lastH = hwin[hwin.length - 1];
        const firstL = lwin[0], lastL = lwin[lwin.length - 1];
        const dH = pct(firstH.price, lastH.price);
        const dL = pct(firstL.price, lastL.price);
        const spreadStart = firstH.price - firstL.price;
        const spreadEnd = lastH.price - lastL.price;
        const convF = getConvergenceFactorForTf(type);
        const converging = spreadEnd < spreadStart * (1 - tolerancePct * convF);
        const startIdx = Math.min(firstH.idx, firstL.idx);
        const endIdx = Math.max(lastH.idx, lastL.idx);
        const start = candles[startIdx].isoTime;
        const end = candles[endIdx].isoTime;

        if (start && end) {
          // --- 回帰ベースのライン推定 ---
          const minTouches = 3;
          const highsPts = hwin.map(p => ({ idx: p.idx, price: p.price }));
          const lowsPts = lwin.map(p => ({ idx: p.idx, price: p.price }));
          const highsOk = highsPts.length >= minTouches;
          const lowsOk = lowsPts.length >= minTouches;
          const hiLine = linearRegression(highsPts);
          const loLine = linearRegression(lowsPts);
          const barsSpan = Math.max(1, endIdx - startIdx);
          const avgH = highsPts.reduce((s, p) => s + p.price, 0) / Math.max(1, highsPts.length);
          const avgL = lowsPts.reduce((s, p) => s + p.price, 0) / Math.max(1, lowsPts.length);
          // 窓全体での回帰による変化率（相対）
          const hiSlopeRel = Math.abs(hiLine.slope) * barsSpan / Math.max(1e-12, avgH);
          const loSlopeRelSigned = (loLine.slope) * barsSpan / Math.max(1e-12, avgL);
          const loSlopeRelAbs = Math.abs(loSlopeRelSigned);
          const fitH = trendlineFit(highsPts, hiLine);
          const fitL = trendlineFit(lowsPts, loLine);
          // Guard: same-direction slopes → likely wedge; skip triangle classification
          if ((hiLine.slope * loLine.slope) > 0) {
            debugCandidates.push({
              type: 'triangle_symmetrical' as any,
              accepted: false,
              reason: 'same_direction_slopes_skip_for_wedge',
              indices: [startIdx, endIdx],
              details: { hiSlope: hiLine.slope, loSlope: loLine.slope }
            });
            continue;
          }
          // フィット品質しきい値（時間軸別+段階フォールバック）
          const baseFit = getMinFitForTf(type);
          const fitThresholds = Array.from(new Set([baseFit, 0.70, 0.60])).sort((a, b) => b - a);
          let placedAsc = false, placedDesc = false, placedSym = false;
          for (const minFit of fitThresholds) {
            // Ascending: highs ~ flat, lows rising
            if (!placedAsc &&
              (want.size === 0 || want.has('triangle') || want.has('triangle_ascending')) &&
              highsOk && lowsOk &&
              hiSlopeRel <= tolerancePct * coef.flat &&
              loSlopeRelSigned >= tolerancePct * coef.move &&
              fitH >= minFit && fitL >= minFit &&
              converging
            ) {
              const qFlat = clamp01(1 - Math.abs(dH) / Math.max(1e-12, tolerancePct * coef.flat));
              const qRise = clamp01(dL / Math.max(1e-12, tolerancePct * coef.move));
              const qConv = clamp01((spreadStart - spreadEnd) / Math.max(1e-12, spreadStart * 0.8));
              const per = periodScoreDays(start, end);
              const base = (qFlat + qRise + qConv + per) / 4;
              const confidence = Math.min(1, finalizeConf(base, 'triangle_ascending') * (minFit / 0.78));
              push(patterns, { type: 'triangle_ascending', confidence, range: { start, end }, pivots: [...hwin, ...lwin].sort((a, b) => a.idx - b.idx) });
              placedAsc = true;
            }
            // Descending: lows ~ flat, highs falling
            if (!placedDesc &&
              (want.size === 0 || want.has('triangle') || want.has('triangle_descending')) &&
              highsOk && lowsOk &&
              loSlopeRelAbs <= tolerancePct * coef.flat &&
              (hiLine.slope * barsSpan / Math.max(1e-12, avgH)) <= -tolerancePct * coef.move &&
              fitH >= minFit && fitL >= minFit &&
              converging
            ) {
              const qFlat = clamp01(1 - Math.abs(dL) / Math.max(1e-12, tolerancePct * coef.flat));
              const qFall = clamp01((-dH) / Math.max(1e-12, tolerancePct * coef.move));
              const qConv = clamp01((spreadStart - spreadEnd) / Math.max(1e-12, spreadStart * 0.8));
              const per = periodScoreDays(start, end);
              const base = (qFlat + qFall + qConv + per) / 4;
              const confidence = Math.min(1, finalizeConf(base, 'triangle_descending') * (minFit / 0.78));
              push(patterns, { type: 'triangle_descending', confidence, range: { start, end }, pivots: [...hwin, ...lwin].sort((a, b) => a.idx - b.idx) });
              placedDesc = true;
            }
            // Symmetrical: highs falling and lows rising
            if (!placedSym &&
              (want.size === 0 || want.has('triangle') || want.has('triangle_symmetrical')) &&
              highsOk && lowsOk &&
              (hiLine.slope * barsSpan / Math.max(1e-12, avgH)) <= -tolerancePct * coef.move &&
              loSlopeRelSigned >= tolerancePct * coef.move &&
              fitH >= minFit && fitL >= minFit &&
              converging
            ) {
              const qFall = clamp01((-dH) / Math.max(1e-12, tolerancePct * coef.move));
              const qRise = clamp01(dL / Math.max(1e-12, tolerancePct * coef.move));
              const qSym = clamp01(1 - Math.abs(Math.abs(dH) - Math.abs(dL)) / Math.max(1e-12, Math.abs(dH) + Math.abs(dL)));
              const qConv = clamp01((spreadStart - spreadEnd) / Math.max(1e-12, spreadStart * 0.8));
              const per = periodScoreDays(start, end);
              const base = (qFall + qRise + qSym + qConv + per) / 5;
              const confidence = Math.min(1, finalizeConf(base, 'triangle_symmetrical') * (minFit / 0.78));
              push(patterns, { type: 'triangle_symmetrical', confidence, range: { start, end }, pivots: [...hwin, ...lwin].sort((a, b) => a.idx - b.idx) });
              placedSym = true;
            }
            if (placedAsc && placedDesc && placedSym) break;
          }
          // (legacy wedge detection removed; revamped scanner runs later)
        }
      }
      // for-loop end
    }
  }

  // 4a) 形成中三角形（統合: 収束中のトレンドラインでブレイク前）
  if (includeForming && (want.size === 0 || want.has('triangle') || want.has('triangle_ascending') || want.has('triangle_descending') || want.has('triangle_symmetrical'))) {
    const lastIdx = candles.length - 1;
    const isoAt = (i: number) => (candles[i] as any)?.isoTime || '';
    const maxFormingDays = 90;
    const daysPerBar = type === '1day' ? 1 : type === '1week' ? 7 : 1;

    const highs = pivots.filter(p => p.kind === 'H');
    const lows = pivots.filter(p => p.kind === 'L');

    // 直近のピボットを使用してトレンドラインを構築
    if (highs.length >= 2 && lows.length >= 2) {
      // 直近の高値・安値を取得
      const recentHighs = highs.filter(h => h.idx < lastIdx - 1).slice(-4);
      const recentLows = lows.filter(l => l.idx < lastIdx - 1).slice(-4);

      if (recentHighs.length >= 2 && recentLows.length >= 2) {
        const firstH = recentHighs[0], lastH = recentHighs[recentHighs.length - 1];
        const firstL = recentLows[0], lastL = recentLows[recentLows.length - 1];

        const startIdx = Math.min(firstH.idx, firstL.idx);
        const endIdx = Math.max(lastH.idx, lastL.idx);

        // 期間チェック
        const formationBars = Math.max(0, lastIdx - startIdx);
        const patternDays = Math.round(formationBars * daysPerBar);
        const minPatternDays = 14;
        if (patternDays >= minPatternDays && patternDays <= maxFormingDays) {
          // トレンドライン計算
          const hiLine = linearRegression(recentHighs.map(p => ({ idx: p.idx, price: p.price })));
          const loLine = linearRegression(recentLows.map(p => ({ idx: p.idx, price: p.price })));

          // 収束チェック
          const spreadStart = firstH.price - firstL.price;
          const spreadEnd = lastH.price - lastL.price;
          const converging = spreadEnd < spreadStart * 0.9;

          // アペックス計算
          const slopeDiff = hiLine.slope - loLine.slope;
          let apexIdx = -1;
          let daysToApex = -1;
          if (Math.abs(slopeDiff) > 1e-12) {
            apexIdx = Math.round((loLine.intercept - hiLine.intercept) / slopeDiff);
            daysToApex = Math.max(0, Math.round((apexIdx - lastIdx) * daysPerBar));
          }

          if (converging && hiLine.slope * loLine.slope <= 0) { // 反対方向の傾き
            const barsSpan = Math.max(1, endIdx - startIdx);
            const avgH = recentHighs.reduce((s, p) => s + p.price, 0) / recentHighs.length;
            const avgL = recentLows.reduce((s, p) => s + p.price, 0) / recentLows.length;
            const hiSlopeRel = hiLine.slope * barsSpan / Math.max(1e-12, avgH);
            const loSlopeRel = loLine.slope * barsSpan / Math.max(1e-12, avgL);

            let triangleType: 'triangle_ascending' | 'triangle_descending' | 'triangle_symmetrical' | null = null;

            // Ascending: 高値フラット、安値上昇
            if (Math.abs(hiSlopeRel) < 0.02 && loSlopeRel > 0.01) {
              triangleType = 'triangle_ascending';
            }
            // Descending: 安値フラット、高値下落
            else if (Math.abs(loSlopeRel) < 0.02 && hiSlopeRel < -0.01) {
              triangleType = 'triangle_descending';
            }
            // Symmetrical: 高値下落、安値上昇
            else if (hiSlopeRel < -0.005 && loSlopeRel > 0.005) {
              triangleType = 'triangle_symmetrical';
            }

            if (triangleType && (want.size === 0 || want.has('triangle') || want.has(triangleType))) {
              // 完成度（アペックスまでの距離に基づく）
              const completionPct = daysToApex >= 0
                ? Math.min(100, Math.round((1 - daysToApex / Math.max(1, patternDays)) * 100))
                : 80;
              const completion = completionPct / 100;
              const confidence = Math.round(Math.min(0.9, 0.6 + (converging ? 0.2 : 0) + (daysToApex <= 14 ? 0.1 : 0)) * 100) / 100;

              if (completion >= 0.4) {
                push(patterns, {
                  type: triangleType,
                  confidence,
                  range: { start: isoAt(startIdx), end: isoAt(lastIdx) },
                  status: daysToApex <= 7 ? 'near_completion' : 'forming',
                  pivots: [...recentHighs, ...recentLows].sort((a, b) => a.idx - b.idx).map(p => ({ idx: p.idx, price: p.price, kind: p.kind })),
                  completionPct,
                  apexDate: apexIdx > 0 ? isoAt(Math.min(apexIdx, lastIdx + 30)) : undefined,
                  daysToApex: daysToApex >= 0 ? daysToApex : undefined,
                  _method: 'forming_triangle',
                });
              }
            }
          }
        }
      }
    }
  }

  return { patterns };
}
