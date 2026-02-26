/**
 * Triple Top / Triple Bottom 検出（完成済み＋形成中）
 * detect_patterns.ts Section 6 / 6b から抽出
 */
import { generatePatternDiagram } from '../../src/utils/pattern-diagrams.js';
import { clamp01, relDev } from './regression.js';
import { periodScoreDays, finalizeConf } from './helpers.js';
import { MIN_CONFIDENCE } from '../patterns/config.js';
import { pushCand, type DetectContext, type DetectResult } from './types.js';

export function detectTriples(ctx: DetectContext): DetectResult {
  const { candles, pivots, allPeaks, allValleys, tolerancePct, minDist, want, includeForming, near } = ctx;
  const pcand = (arg: Parameters<typeof pushCand>[1]) => pushCand(ctx, arg);
  const push = (arr: any[], item: any) => { arr.push(item); };
  const patterns: any[] = [];

  // 6) Triple Top / Triple Bottom (厳しめの等高/等安＋等間隔に近い)
  {
    const wantTripleTop = want.size === 0 || want.has('triple_top');
    const wantTripleBottom = want.size === 0 || want.has('triple_bottom');
    if (wantTripleTop || wantTripleBottom) {
      // 直近の同種ピボット3点を走査
      const highsOnly = pivots.filter(p => p.kind === 'H');
      const lowsOnly = pivots.filter(p => p.kind === 'L');

      if (wantTripleTop && highsOnly.length >= 3) {
        for (let i = 0; i <= highsOnly.length - 3; i++) {
          const a = highsOnly[i], b = highsOnly[i + 1], c = highsOnly[i + 2];
          if ((b.idx - a.idx) < minDist || (c.idx - b.idx) < minDist) continue;
          const nearAll = near(a.price, b.price) && near(b.price, c.price) && near(a.price, c.price);
          if (!nearAll) continue;
          const start = candles[a.idx].isoTime;
          const end = candles[c.idx].isoTime;
          if (start && end) {
            // Additional strict checks: valleys equality and neckline slope
            const v1cands = allValleys.filter((v: any) => v.idx > a.idx && v.idx < b.idx);
            const v2cands = allValleys.filter((v: any) => v.idx > b.idx && v.idx < c.idx);
            const v1 = v1cands.length ? v1cands.reduce((m: any, v: any) => v.price < m.price ? v : m) : null;
            const v2 = v2cands.length ? v2cands.reduce((m: any, v: any) => v.price < m.price ? v : m) : null;
            if (!(v1 && v2)) { pcand({ type: 'triple_top', accepted: false, reason: 'valleys_missing', idxs: [a.idx, b.idx, c.idx] }); continue; }
            const valleysNear = Math.abs(v1.price - v2.price) / Math.max(1, Math.max(v1.price, v2.price)) <= tolerancePct;
            const necklineSlopeLimit = 0.02;
            const necklineSlope = Math.abs(v1.price - v2.price) / Math.max(1, Math.max(v1.price, v2.price));
            const necklineValid = necklineSlope <= necklineSlopeLimit;
            if (!(valleysNear && necklineValid)) { pcand({ type: 'triple_top', accepted: false, reason: !valleysNear ? 'valleys_not_equal' : 'neckline_slope_excess', idxs: [a.idx, b.idx, c.idx] }); continue; }
            const devs = [relDev(a.price, b.price), relDev(b.price, c.price), relDev(a.price, c.price)];
            const tolMargin = clamp01(1 - (devs.reduce((s, v) => s + v, 0) / devs.length) / Math.max(1e-12, tolerancePct));
            const span = Math.max(a.price, b.price, c.price) - Math.min(a.price, b.price, c.price);
            const symmetry = clamp01(1 - span / Math.max(1, Math.max(a.price, b.price, c.price)));
            const per = periodScoreDays(start, end);
            const base = (tolMargin + symmetry + per) / 3;
            const confidence = finalizeConf(base, 'triple_top');
            const nlAvg = ((Number(v1.price) + Number(v2.price)) / 2);
            const neckline = [{ x: a.idx, y: nlAvg }, { x: c.idx, y: nlAvg }];
            // Build 5-point pivot order for diagram if valleys exist
            let diagram: any = undefined;
            diagram = generatePatternDiagram(
              'triple_top',
              [
                { ...a, date: (candles[a.idx] as any)?.isoTime },
                { ...v1, date: (candles[v1.idx] as any)?.isoTime },
                { ...b, date: (candles[b.idx] as any)?.isoTime },
                { ...v2, date: (candles[v2.idx] as any)?.isoTime },
                { ...c, date: (candles[c.idx] as any)?.isoTime },
              ],
              { price: nlAvg },
              { start, end }
            );
            if (confidence >= (MIN_CONFIDENCE['triple_top'] ?? 0)) {
              // --- ターゲット価格計算（neckline_projection 方式） ---
              const ttAvgPeak = (a.price + b.price + c.price) / 3;
              const ttTarget = nlAvg != null ? Math.round(nlAvg - (ttAvgPeak - nlAvg)) : undefined;
              push(patterns, { type: 'triple_top', confidence, range: { start, end }, pivots: [a, b, c], ...(neckline ? { neckline, trendlineLabel: 'ネックライン' } : {}), ...(ttTarget !== undefined ? { breakoutTarget: ttTarget, targetMethod: 'neckline_projection' as const } : {}), ...(diagram ? { structureDiagram: diagram } : {}) });
              pcand({ type: 'triple_top', accepted: true, idxs: [a.idx, b.idx, c.idx], pts: [{ role: 'peak1', idx: a.idx, price: a.price }, { role: 'peak2', idx: b.idx, price: b.price }, { role: 'peak3', idx: c.idx, price: c.price }] });
            } else {
              pcand({ type: 'triple_top', accepted: false, reason: 'confidence_below_min', idxs: [a.idx, b.idx, c.idx] });
            }
          }
        }
      }

      if (wantTripleBottom && lowsOnly.length >= 3) {
        for (let i = 0; i <= lowsOnly.length - 3; i++) {
          const a = lowsOnly[i], b = lowsOnly[i + 1], c = lowsOnly[i + 2];
          if ((b.idx - a.idx) < minDist || (c.idx - b.idx) < minDist) continue;
          const nearAll = near(a.price, b.price) && near(b.price, c.price) && near(a.price, c.price);
          if (!nearAll) continue;
          const start = candles[a.idx].isoTime;
          const end = candles[c.idx].isoTime;
          if (start && end) {
            // Additional strict checks:
            // 3 valleys near + spread limit, peaks near and neckline slope limit
            const valleyPrices = [a.price, b.price, c.price];
            const valleyNearStrict = near(a.price, b.price) && near(b.price, c.price) && near(a.price, c.price);
            const valleyMin = Math.min(...valleyPrices);
            const valleyMax = Math.max(...valleyPrices);
            const maxValleySpread = 0.015;
            const valleySpreadValid = (valleyMax - valleyMin) / Math.max(1, valleyMin) <= maxValleySpread;
            const p1cands = allPeaks.filter((v: any) => v.idx > a.idx && v.idx < b.idx);
            const p2cands = allPeaks.filter((v: any) => v.idx > b.idx && v.idx < c.idx);
            const p1 = p1cands.length ? p1cands.reduce((m: any, v: any) => v.price > m.price ? v : m) : null;
            const p2 = p2cands.length ? p2cands.reduce((m: any, v: any) => v.price > m.price ? v : m) : null;
            if (!(p1 && p2)) { pcand({ type: 'triple_bottom', accepted: false, reason: 'peaks_missing', idxs: [a.idx, b.idx, c.idx] }); continue; }
            const peaksNear = Math.abs(p1.price - p2.price) / Math.max(1, Math.max(p1.price, p2.price)) <= tolerancePct;
            const necklineSlopeLimit = 0.02;
            const necklineSlope = Math.abs(p1.price - p2.price) / Math.max(1, Math.max(p1.price, p2.price));
            const necklineValid = necklineSlope <= necklineSlopeLimit;
            if (!(valleyNearStrict && valleySpreadValid && peaksNear && necklineValid)) {
              pcand({ type: 'triple_bottom', accepted: false, reason: !valleyNearStrict ? 'valleys_not_equal' : (!valleySpreadValid ? 'valley_spread_excess' : (!peaksNear ? 'peaks_not_equal' : 'neckline_slope_excess')), idxs: [a.idx, b.idx, c.idx] });
              continue;
            }
            const devs = [relDev(a.price, b.price), relDev(b.price, c.price), relDev(a.price, c.price)];
            const tolMargin = clamp01(1 - (devs.reduce((s, v) => s + v, 0) / devs.length) / Math.max(1e-12, tolerancePct));
            const span = Math.max(a.price, b.price, c.price) - Math.min(a.price, b.price, c.price);
            const symmetry = clamp01(1 - span / Math.max(1, Math.max(a.price, b.price, c.price)));
            const per = periodScoreDays(start, end);
            const base = (tolMargin + symmetry + per) / 3;
            const confidence = finalizeConf(base, 'triple_bottom');
            const nlAvg = ((Number(p1.price) + Number(p2.price)) / 2);
            const neckline = [{ x: a.idx, y: nlAvg }, { x: c.idx, y: nlAvg }];
            // Build 5-point pivot order for diagram if peaks exist
            let diagram: any = undefined;
            diagram = generatePatternDiagram(
              'triple_bottom',
              [
                { ...a, date: (candles[a.idx] as any)?.isoTime },
                { ...p1, date: (candles[p1.idx] as any)?.isoTime },
                { ...b, date: (candles[b.idx] as any)?.isoTime },
                { ...p2, date: (candles[p2.idx] as any)?.isoTime },
                { ...c, date: (candles[c.idx] as any)?.isoTime },
              ],
              { price: nlAvg },
              { start, end }
            );
            if (confidence >= (MIN_CONFIDENCE['triple_bottom'] ?? 0)) {
              // --- ターゲット価格計算（neckline_projection 方式） ---
              const tbAvgValley = (a.price + b.price + c.price) / 3;
              const tbTarget = nlAvg != null ? Math.round(nlAvg + (nlAvg - tbAvgValley)) : undefined;
              push(patterns, { type: 'triple_bottom', confidence, range: { start, end }, pivots: [a, b, c], ...(neckline ? { neckline, trendlineLabel: 'ネックライン' } : {}), ...(tbTarget !== undefined ? { breakoutTarget: tbTarget, targetMethod: 'neckline_projection' as const } : {}), ...(diagram ? { structureDiagram: diagram } : {}) });
              pcand({ type: 'triple_bottom', accepted: true, idxs: [a.idx, b.idx, c.idx], pts: [{ role: 'valley1', idx: a.idx, price: a.price }, { role: 'valley2', idx: b.idx, price: b.price }, { role: 'valley3', idx: c.idx, price: c.price }] });
            } else {
              pcand({ type: 'triple_bottom', accepted: false, reason: 'confidence_below_min', idxs: [a.idx, b.idx, c.idx] });
            }
          }
        }
      }
      // relaxed fallback for triple if none found (multi-stage 1.25, 2.0)
      for (const f of [1.25, 2.0]) {
        const tolTriple = tolerancePct * f;
        const nearTriple = (x: number, y: number) => Math.abs(x - y) / Math.max(1, Math.max(x, y)) <= tolTriple;
        if (wantTripleTop && !patterns.some(p => p.type === 'triple_top')) {
          const hs = highsOnly;
          let placed = false;
          for (let i = 0; i <= hs.length - 3 && !placed; i++) {
            const a = hs[i], b = hs[i + 1], c = hs[i + 2];
            if ((b.idx - a.idx) < minDist || (c.idx - b.idx) < minDist) continue;
            if (!(nearTriple(a.price, b.price) && nearTriple(b.price, c.price))) { pcand({ type: 'triple_top', accepted: false, reason: 'peaks_not_equal_relaxed', idxs: [a.idx, b.idx, c.idx], pts: [{ role: 'peak1', idx: a.idx, price: a.price }, { role: 'peak2', idx: b.idx, price: b.price }, { role: 'peak3', idx: c.idx, price: c.price }] }); continue; }
            const start = candles[a.idx].isoTime, end = candles[c.idx].isoTime;
            if (!start || !end) continue;
            const devs = [relDev(a.price, b.price), relDev(b.price, c.price), relDev(a.price, c.price)];
            const tolMargin = clamp01(1 - (devs.reduce((s, v) => s + v, 0) / devs.length) / Math.max(1e-12, tolTriple));
            const span = Math.max(a.price, b.price, c.price) - Math.min(a.price, b.price, c.price);
            const symmetry = clamp01(1 - span / Math.max(1, Math.max(a.price, b.price, c.price)));
            const per = periodScoreDays(start, end);
            const base = (tolMargin + symmetry + per) / 3;
            const confidence = finalizeConf(base * 0.95, 'triple_top');
            // valleys for neckline & diagram
            const v1cands = allValleys.filter((v: any) => v.idx > a.idx && v.idx < b.idx);
            const v2cands = allValleys.filter((v: any) => v.idx > b.idx && v.idx < c.idx);
            const v1 = v1cands.length ? v1cands.reduce((m: any, v: any) => v.price < m.price ? v : m) : null;
            const v2 = v2cands.length ? v2cands.reduce((m: any, v: any) => v.price < m.price ? v : m) : null;
            const nlAvg = (v1 && v2) ? ((Number(v1.price) + Number(v2.price)) / 2) : null;
            // Additional strictness in relaxed path as well
            if (!(v1 && v2)) { pcand({ type: 'triple_top', accepted: false, reason: 'valleys_missing_relaxed', idxs: [a.idx, b.idx, c.idx] }); continue; }
            const necklineSlopeLimit = 0.02;
            const necklineSlope = Math.abs(v1.price - v2.price) / Math.max(1, Math.max(v1.price, v2.price));
            if (necklineSlope > necklineSlopeLimit) { pcand({ type: 'triple_top', accepted: false, reason: 'neckline_slope_excess_relaxed', idxs: [a.idx, b.idx, c.idx] }); continue; }
            let diagram: any = undefined;
            const neckline = (v1 && v2) ? [{ x: a.idx, y: nlAvg }, { x: c.idx, y: nlAvg }] : undefined as any;
            if (v1 && v2) {
              diagram = generatePatternDiagram(
                'triple_top',
                [
                  { ...a, date: (candles[a.idx] as any)?.isoTime },
                  { ...v1, date: (candles[v1.idx] as any)?.isoTime },
                  { ...b, date: (candles[b.idx] as any)?.isoTime },
                  { ...v2, date: (candles[v2.idx] as any)?.isoTime },
                  { ...c, date: (candles[c.idx] as any)?.isoTime },
                ],
                { price: nlAvg ?? Number(b.price) },
                { start, end }
              );
            }
            if (confidence >= (MIN_CONFIDENCE['triple_top'] ?? 0)) {
              const ttRelAvgPeak = (a.price + b.price + c.price) / 3;
              const ttRelTarget = nlAvg != null ? Math.round(nlAvg - (ttRelAvgPeak - nlAvg)) : undefined;
              push(patterns, { type: 'triple_top', confidence, range: { start, end }, pivots: [a, b, c], ...(neckline ? { neckline, trendlineLabel: 'ネックライン' } : {}), ...(ttRelTarget !== undefined ? { breakoutTarget: ttRelTarget, targetMethod: 'neckline_projection' as const } : {}), ...(diagram ? { structureDiagram: diagram } : {}), _fallback: `relaxed_triple_x${f}` });
            } else {
              pcand({ type: 'triple_top', accepted: false, reason: 'confidence_below_min_relaxed', idxs: [a.idx, b.idx, c.idx] });
            }
            placed = true;
          }
        }
        if (wantTripleBottom && !patterns.some(p => p.type === 'triple_bottom')) {
          const ls = lowsOnly;
          let placed = false;
          for (let i = 0; i <= ls.length - 3 && !placed; i++) {
            const a = ls[i], b = ls[i + 1], c = ls[i + 2];
            if ((b.idx - a.idx) < minDist || (c.idx - b.idx) < minDist) continue;
            if (!(nearTriple(a.price, b.price) && nearTriple(b.price, c.price))) { pcand({ type: 'triple_bottom', accepted: false, reason: 'valleys_not_equal_relaxed', idxs: [a.idx, b.idx, c.idx], pts: [{ role: 'valley1', idx: a.idx, price: a.price }, { role: 'valley2', idx: b.idx, price: b.price }, { role: 'valley3', idx: c.idx, price: c.price }] }); continue; }
            const start = candles[a.idx].isoTime, end = candles[c.idx].isoTime;
            if (!start || !end) continue;
            const devs = [relDev(a.price, b.price), relDev(b.price, c.price), relDev(a.price, c.price)];
            const tolMargin = clamp01(1 - (devs.reduce((s, v) => s + v, 0) / devs.length) / Math.max(1e-12, tolTriple));
            const span = Math.max(a.price, b.price, c.price) - Math.min(a.price, b.price, c.price);
            const symmetry = clamp01(1 - span / Math.max(1, Math.max(a.price, b.price, c.price)));
            const per = periodScoreDays(start, end);
            const base = (tolMargin + symmetry + per) / 3;
            const confidence = finalizeConf(base * 0.95, 'triple_bottom');
            // peaks for neckline & diagram
            const p1cands = allPeaks.filter((v: any) => v.idx > a.idx && v.idx < b.idx);
            const p2cands = allPeaks.filter((v: any) => v.idx > b.idx && v.idx < c.idx);
            const p1 = p1cands.length ? p1cands.reduce((m: any, v: any) => v.price > m.price ? v : m) : null;
            const p2 = p2cands.length ? p2cands.reduce((m: any, v: any) => v.price > m.price ? v : m) : null;
            const nlAvg = (p1 && p2) ? ((Number(p1.price) + Number(p2.price)) / 2) : null;
            if (!(p1 && p2)) { pcand({ type: 'triple_bottom', accepted: false, reason: 'peaks_missing_relaxed', idxs: [a.idx, b.idx, c.idx] }); continue; }
            const necklineSlopeLimit = 0.02;
            const necklineSlope = Math.abs(p1.price - p2.price) / Math.max(1, Math.max(p1.price, p2.price));
            if (necklineSlope > necklineSlopeLimit) { pcand({ type: 'triple_bottom', accepted: false, reason: 'neckline_slope_excess_relaxed', idxs: [a.idx, b.idx, c.idx] }); continue; }
            let diagram: any = undefined;
            const neckline = (p1 && p2) ? [{ x: a.idx, y: nlAvg }, { x: c.idx, y: nlAvg }] : undefined as any;
            if (p1 && p2) {
              diagram = generatePatternDiagram(
                'triple_bottom',
                [
                  { ...a, date: (candles[a.idx] as any)?.isoTime },
                  { ...p1, date: (candles[p1.idx] as any)?.isoTime },
                  { ...b, date: (candles[b.idx] as any)?.isoTime },
                  { ...p2, date: (candles[p2.idx] as any)?.isoTime },
                  { ...c, date: (candles[c.idx] as any)?.isoTime },
                ],
                { price: nlAvg ?? Number(b.price) },
                { start, end }
              );
            }
            if (confidence >= (MIN_CONFIDENCE['triple_bottom'] ?? 0)) {
              const tbRelAvgValley = (a.price + b.price + c.price) / 3;
              const tbRelTarget = nlAvg != null ? Math.round(nlAvg + (nlAvg - tbRelAvgValley)) : undefined;
              push(patterns, { type: 'triple_bottom', confidence, range: { start, end }, pivots: [a, b, c], ...(neckline ? { neckline, trendlineLabel: 'ネックライン' } : {}), ...(tbRelTarget !== undefined ? { breakoutTarget: tbRelTarget, targetMethod: 'neckline_projection' as const } : {}), ...(diagram ? { structureDiagram: diagram } : {}), _fallback: `relaxed_triple_x${f}` });
            } else {
              pcand({ type: 'triple_bottom', accepted: false, reason: 'confidence_below_min_relaxed', idxs: [a.idx, b.idx, c.idx] });
            }
            placed = true;
          }
        }
      }
    }
  }

  // 6b) 形成中トリプルトップ/ボトム（統合: 2つの確定ピーク/谷 + 3つ目が形成中）
  if (includeForming && (want.size === 0 || want.has('triple_top') || want.has('triple_bottom'))) {
    const lastIdx = candles.length - 1;
    const currentPrice = Number(candles[lastIdx]?.close ?? NaN);
    const isoAt = (i: number) => (candles[i] as any)?.isoTime || '';
    const maxFormingDays = 90; // 形成中パターンは3ヶ月以内に制限
    const daysPerBar = ctx.type === '1day' ? 1 : ctx.type === '1week' ? 7 : 1;
    const tripleTolerancePct = tolerancePct * 1.2; // やや緩めの許容範囲

    // 形成中 triple_top: 2つの確定ピーク + 現在価格が同レベルまで上昇中
    if ((want.size === 0 || want.has('triple_top')) && allPeaks.length >= 2) {
      const confirmedPeaks = allPeaks.filter((p: any) => p.idx < lastIdx - 2);

      // 直近2つの等高ピークを探す
      for (let i = confirmedPeaks.length - 1; i >= 1; i--) {
        const peak2 = confirmedPeaks[i];
        const peak1 = confirmedPeaks[i - 1];

        // ピーク間の間隔チェック
        if (peak2.idx - peak1.idx < minDist) continue;

        // 2つのピークが等高か
        const peakDiff = Math.abs(peak1.price - peak2.price) / Math.max(1, Math.max(peak1.price, peak2.price));
        if (peakDiff > tripleTolerancePct) continue;

        // 現在価格がピークレベル付近か
        const avgPeakPrice = (peak1.price + peak2.price) / 2;
        const currentDiff = Math.abs(currentPrice - avgPeakPrice) / Math.max(1, avgPeakPrice);
        if (currentDiff > tripleTolerancePct || currentPrice < avgPeakPrice * 0.95) continue;

        // 期間チェック
        const formationBars = Math.max(0, lastIdx - peak1.idx);
        const patternDays = Math.round(formationBars * daysPerBar);
        const minPatternDays = 21;
        if (patternDays < minPatternDays || patternDays > maxFormingDays) continue;

        // 進捗率
        const progress = Math.min(1, currentPrice / avgPeakPrice);
        const completion = Math.min(1, 0.66 + progress * 0.34);
        const confidence = Math.round((1 - currentDiff / tripleTolerancePct) * 0.8 * 100) / 100;

        if (completion >= 0.4 && confidence >= 0.5) {
          // ネックライン（谷の平均）
          const valleysBetween = allValleys.filter((v: any) => v.idx > peak1.idx && v.idx < lastIdx);
          const avgValley = valleysBetween.length
            ? valleysBetween.reduce((s: number, v: any) => s + v.price, 0) / valleysBetween.length
            : Math.min(peak1.price, peak2.price) * 0.95;
          const neckline = [{ x: peak1.idx, y: avgValley }, { x: lastIdx, y: avgValley }];

          const formTtTarget = Math.round(avgValley - ((peak1.price + peak2.price) / 2 - avgValley));
          push(patterns, {
            type: 'triple_top',
            confidence,
            range: { start: isoAt(peak1.idx), end: isoAt(lastIdx) },
            status: 'forming',
            pivots: [
              { idx: peak1.idx, price: peak1.price, kind: 'H' as const },
              { idx: peak2.idx, price: peak2.price, kind: 'H' as const },
            ],
            neckline,
            trendlineLabel: 'ネックライン',
            breakoutTarget: formTtTarget,
            targetMethod: 'neckline_projection' as const,
            completionPct: Math.round(completion * 100),
            _method: 'forming_triple_top',
          });
          break; // 1件で十分
        }
      }
    }

    // 形成中 triple_bottom: 2つの確定谷 + 現在価格が同レベルまで下落後反発中
    if ((want.size === 0 || want.has('triple_bottom')) && allValleys.length >= 2) {
      const confirmedValleys = allValleys.filter((v: any) => v.idx < lastIdx - 2);

      // 直近2つの等安谷を探す
      for (let i = confirmedValleys.length - 1; i >= 1; i--) {
        const valley2 = confirmedValleys[i];
        const valley1 = confirmedValleys[i - 1];

        // 谷間の間隔チェック
        if (valley2.idx - valley1.idx < minDist) continue;

        // 2つの谷が等安か
        const valleyDiff = Math.abs(valley1.price - valley2.price) / Math.max(1, Math.max(valley1.price, valley2.price));
        if (valleyDiff > tripleTolerancePct) continue;

        // 現在価格が谷レベル付近から反発しているか（谷より上で、かつネックラインに向かっている）
        const avgValleyPrice = (valley1.price + valley2.price) / 2;

        // ネックライン（ピークの平均）
        const peaksBetween = allPeaks.filter((p: any) => p.idx > valley1.idx && p.idx < lastIdx);
        if (peaksBetween.length === 0) continue;
        const avgPeakPrice = peaksBetween.reduce((s: number, p: any) => s + p.price, 0) / peaksBetween.length;

        // 現在価格が谷とネックラインの間にあるか
        if (currentPrice < avgValleyPrice * 0.98 || currentPrice > avgPeakPrice * 1.02) continue;

        // 期間チェック
        const formationBars = Math.max(0, lastIdx - valley1.idx);
        const patternDays = Math.round(formationBars * daysPerBar);
        const minPatternDays = 21;
        if (patternDays < minPatternDays || patternDays > maxFormingDays) continue;

        // 進捗率（ネックラインへの接近度）
        const progress = (currentPrice - avgValleyPrice) / Math.max(1e-12, avgPeakPrice - avgValleyPrice);
        const completion = Math.min(1, 0.66 + Math.min(1, progress) * 0.34);
        const confidence = Math.round((1 - valleyDiff / tripleTolerancePct) * 0.8 * 100) / 100;

        if (completion >= 0.4 && confidence >= 0.5) {
          const neckline = [{ x: valley1.idx, y: avgPeakPrice }, { x: lastIdx, y: avgPeakPrice }];

          const formTbTarget = Math.round(avgPeakPrice + (avgPeakPrice - avgValleyPrice));
          push(patterns, {
            type: 'triple_bottom',
            confidence,
            range: { start: isoAt(valley1.idx), end: isoAt(lastIdx) },
            status: 'forming',
            pivots: [
              { idx: valley1.idx, price: valley1.price, kind: 'L' as const },
              { idx: valley2.idx, price: valley2.price, kind: 'L' as const },
            ],
            neckline,
            trendlineLabel: 'ネックライン',
            breakoutTarget: formTbTarget,
            targetMethod: 'neckline_projection' as const,
            completionPct: Math.round(completion * 100),
            _method: 'forming_triple_bottom',
          });
          break; // 1件で十分
        }
      }
    }
  }

  return { patterns };
}
