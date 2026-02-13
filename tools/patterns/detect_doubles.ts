/**
 * Double Top / Double Bottom 検出（完成済み＋形成中）
 * detect_patterns.ts Section 2 から抽出
 */
import { generatePatternDiagram } from '../../src/utils/pattern-diagrams.js';
import { clamp01, relDev, marginFromRelDev } from './regression.js';
import { periodScoreDays, finalizeConf, deduplicatePatterns } from './helpers.js';
import { pushCand, type DetectContext, type DetectResult } from './types.js';

export function detectDoubles(ctx: DetectContext): DetectResult {
  const { candles, pivots, allPeaks, allValleys, tolerancePct, minDist, want, includeForming, near } = ctx;
  const pcand = (arg: Parameters<typeof pushCand>[1]) => pushCand(ctx, arg);
  const push = (arr: any[], item: any) => { arr.push(item); };
  let patterns: any[] = [];

  let foundDoubleTop = false, foundDoubleBottom = false;
  if (want.size === 0 || want.has('double_top') || want.has('double_bottom')) {
    const minDistDB = 5; // ダブル系: 最低5本の間隔を要求（ノイズ除去）
    for (let i = 0; i < pivots.length - 3; i++) {
      const a = pivots[i];
      const b = pivots[i + 1];
      const c = pivots[i + 2];
      if (b.idx - a.idx < minDistDB || c.idx - b.idx < minDistDB) continue;
      // サイズ下限フィルタ（3%未満は除外）+ 谷深さフィルタ（5%未満は除外）
      if (a.kind === 'H' && b.kind === 'L' && c.kind === 'H') {
        const patternHeight = Math.abs(a.price - b.price);
        const heightPct = patternHeight / Math.max(1, Math.max(a.price, b.price));
        if (heightPct < 0.03) { pcand({ type: 'double_top', accepted: false, reason: 'pattern_too_small', idxs: [a.idx, b.idx, c.idx] }); continue; }
        // 谷深さ: 山と谷の落差が山の5%以上必要（浅い窪みでの誤検知防止）
        const peakAvg = (a.price + c.price) / 2;
        const valleyDepthPct = (peakAvg - b.price) / Math.max(1, peakAvg);
        if (valleyDepthPct < 0.05) { pcand({ type: 'double_top', accepted: false, reason: 'valley_too_shallow', idxs: [a.idx, b.idx, c.idx] }); continue; }
      }
      // double top: H-L-H with H~H + ネックライン下抜け（終値ベース1.5%バッファ）必須
      if (a.kind === 'H' && b.kind === 'L' && c.kind === 'H' && near(a.price, c.price)) {
        const necklinePrice = b.price;
        const breakoutBuffer = 0.015;
        let breakoutIdx = -1;
        // 山2から最大20本以内にネックライン下抜けが必要
        const maxBarsFromPeak2 = 20;
        for (let k = c.idx + 1; k < Math.min(c.idx + maxBarsFromPeak2 + 1, candles.length); k++) {
          const closeK = Number(candles[k]?.close ?? NaN);
          if (Number.isFinite(closeK) && closeK < necklinePrice * (1 - breakoutBuffer)) {
            breakoutIdx = k;
            break;
          }
        }
        if (breakoutIdx >= 0) {
          const start = candles[a.idx].isoTime;
          const end = candles[breakoutIdx].isoTime; // 完成＝ブレイク時点
          if (start && end) {
            const neckline = [
              { x: a.idx, y: necklinePrice },
              { x: breakoutIdx, y: necklinePrice }, // ブレイク地点まで延長
            ];
            const tolMargin = marginFromRelDev(relDev(a.price, c.price), tolerancePct);
            const symmetry = clamp01(1 - relDev(a.price, c.price));
            const per = periodScoreDays(start, end);
            const base = (tolMargin + symmetry + per) / 3;
            const confidence = finalizeConf(base, 'double_top');
            // 構造図（ダブルトップ）
            const diagram = generatePatternDiagram(
              'double_top',
              [
                { ...a, date: (candles[a.idx] as any)?.isoTime },
                { ...b, date: (candles[b.idx] as any)?.isoTime },
                { ...c, date: (candles[c.idx] as any)?.isoTime },
              ],
              { price: necklinePrice },
              { start, end }
            );
            push(patterns, { type: 'double_top', confidence, range: { start, end }, pivots: [a, b, c], neckline, breakout: { idx: breakoutIdx, price: Number(candles[breakoutIdx]?.close ?? NaN) }, structureDiagram: diagram });
            foundDoubleTop = true;
            pcand({
              type: 'double_top',
              accepted: true,
              idxs: [a.idx, b.idx, c.idx, breakoutIdx],
              pts: [
                { role: 'peak1', idx: a.idx, price: a.price },
                { role: 'valley', idx: b.idx, price: b.price },
                { role: 'peak2', idx: c.idx, price: c.price },
                { role: 'breakout', idx: breakoutIdx, price: Number(candles[breakoutIdx]?.close ?? NaN) },
              ]
            });
          }
        } else {
          // ネックライン未下抜け → 完成パターンとしては不採用（forming側で扱う）
          pcand({ type: 'double_top', accepted: false, reason: 'no_breakout', idxs: [a.idx, b.idx, c.idx], pts: [{ role: 'peak1', idx: a.idx, price: a.price }, { role: 'valley', idx: b.idx, price: b.price }, { role: 'peak2', idx: c.idx, price: c.price }] });
        }
      } else if (a.kind === 'H' && b.kind === 'L' && c.kind === 'H') {
        // reject reason for debugging
        const diffAbs = Math.abs(a.price - c.price);
        const diffPct = diffAbs / Math.max(1, Math.max(a.price, c.price));
        if (diffPct > tolerancePct) {
          pcand({
            type: 'double_top',
            accepted: false,
            reason: 'peaks_not_equal',
            idxs: [a.idx, b.idx, c.idx],
            pts: [{ role: 'peak1', idx: a.idx, price: a.price }, { role: 'peak2', idx: c.idx, price: c.price }]
          });
        }
      }
      // double bottom: L-H-L with L~L（サイズ下限＋山高さフィルタ）
      if (a.kind === 'L' && b.kind === 'H' && c.kind === 'L') {
        const patternHeight = Math.abs(a.price - b.price);
        const heightPct = patternHeight / Math.max(1, Math.max(a.price, b.price));
        if (heightPct < 0.03) { pcand({ type: 'double_bottom', accepted: false, reason: 'pattern_too_small', idxs: [a.idx, b.idx, c.idx] }); continue; }
        // 山高さ: 谷と山の落差が谷の5%以上必要（浅い突起での誤検知防止）
        const valleyAvg = (a.price + c.price) / 2;
        const peakHeightPct = (b.price - valleyAvg) / Math.max(1, valleyAvg);
        if (peakHeightPct < 0.05) { pcand({ type: 'double_bottom', accepted: false, reason: 'peak_too_shallow', idxs: [a.idx, b.idx, c.idx] }); continue; }
      }
      if (a.kind === 'L' && b.kind === 'H' && c.kind === 'L' && near(a.price, c.price)) {
        // ネックライン突破（終値ベース＋1.5%バッファ）を c 以降で確認
        const necklinePrice = b.price;
        const breakoutBuffer = 0.015;
        let breakoutIdx = -1;
        // 谷2から最大20本以内にネックライン上抜けが必要
        const maxBarsFromValley2 = 20;
        for (let k = c.idx + 1; k < Math.min(c.idx + maxBarsFromValley2 + 1, candles.length); k++) {
          const closeK = Number(candles[k]?.close ?? NaN);
          if (Number.isFinite(closeK) && closeK > necklinePrice * (1 + breakoutBuffer)) {
            breakoutIdx = k;
            break;
          }
        }
        if (breakoutIdx >= 0) {
          const start = candles[a.idx].isoTime;
          const end = candles[breakoutIdx].isoTime; // 完成＝ブレイク時点
          if (start && end) {
            // ネックラインはブレイク地点まで延長
            const neckline = [
              { x: a.idx, y: necklinePrice },
              { x: breakoutIdx, y: necklinePrice },
            ];
            const tolMargin = marginFromRelDev(relDev(a.price, c.price), tolerancePct);
            const symmetry = clamp01(1 - relDev(a.price, c.price));
            const per = periodScoreDays(start, end);
            const base = (tolMargin + symmetry + per) / 3;
            const confidence = finalizeConf(base, 'double_bottom');
            // 構造図（ダブルボトム）
            const diagram = generatePatternDiagram(
              'double_bottom',
              [
                { ...a, date: (candles[a.idx] as any)?.isoTime },
                { ...b, date: (candles[b.idx] as any)?.isoTime },
                { ...c, date: (candles[c.idx] as any)?.isoTime },
              ],
              { price: necklinePrice },
              { start, end }
            );
            push(patterns, {
              type: 'double_bottom',
              confidence,
              range: { start, end },
              pivots: [a, b, c],
              neckline,
              breakout: { idx: breakoutIdx, price: Number(candles[breakoutIdx]?.close ?? NaN) },
              structureDiagram: diagram
            });
            foundDoubleBottom = true;
            pcand({ type: 'double_bottom', accepted: true, idxs: [a.idx, b.idx, c.idx], pts: [{ role: 'valley1', idx: a.idx, price: a.price }, { role: 'peak', idx: b.idx, price: b.price }, { role: 'valley2', idx: c.idx, price: c.price }] });
          }
        } else {
          // ネックライン未突破 → 完成パターンとしては不採用（forming側で扱う）
          pcand({ type: 'double_bottom', accepted: false, reason: 'no_breakout', idxs: [a.idx, b.idx, c.idx], pts: [{ role: 'valley1', idx: a.idx, price: a.price }, { role: 'peak', idx: b.idx, price: b.price }, { role: 'valley2', idx: c.idx, price: c.price }] });
        }
      } else if (a.kind === 'L' && b.kind === 'H' && c.kind === 'L') {
        const diffAbs = Math.abs(a.price - c.price);
        const diffPct = diffAbs / Math.max(1, Math.max(a.price, c.price));
        if (diffPct > tolerancePct) {
          pcand({
            type: 'double_bottom',
            accepted: false,
            reason: 'valleys_not_equal',
            idxs: [a.idx, b.idx, c.idx],
            pts: [{ role: 'valley1', idx: a.idx, price: a.price }, { role: 'valley2', idx: c.idx, price: c.price }]
          });
        }
      }
    }
    // relaxed fallback for double top/bottom: single-stage factor 1.3（×2.0 は過剰検知の原因として削除）
    for (const f of [1.3]) {
      if (!foundDoubleTop && (want.size === 0 || want.has('double_top'))) {
        const tolRelax = tolerancePct * f;
        const nearRelaxed = (x: number, y: number) => Math.abs(x - y) <= Math.max(x, y) * tolRelax;
        for (let i = 0; i < pivots.length - 3; i++) {
          const a = pivots[i], b = pivots[i + 1], c = pivots[i + 2];
          if (!(a.kind === 'H' && b.kind === 'L' && c.kind === 'H')) continue;
          if (b.idx - a.idx < minDistDB || c.idx - b.idx < minDistDB) continue;
          // サイズ下限フィルタ（3%未満は除外）+ 谷深さフィルタ
          {
            const patternHeight = Math.abs(a.price - b.price);
            const heightPct = patternHeight / Math.max(1, Math.max(a.price, b.price));
            if (heightPct < 0.03) { pcand({ type: 'double_top', accepted: false, reason: 'pattern_too_small', idxs: [a.idx, b.idx, c.idx] }); continue; }
            const peakAvg = (a.price + c.price) / 2;
            const valleyDepthPct = (peakAvg - b.price) / Math.max(1, peakAvg);
            if (valleyDepthPct < 0.05) { pcand({ type: 'double_top', accepted: false, reason: 'valley_too_shallow_relaxed', idxs: [a.idx, b.idx, c.idx] }); continue; }
          }
          if (!nearRelaxed(a.price, c.price)) { pcand({ type: 'double_top', accepted: false, reason: 'peaks_not_equal_relaxed', idxs: [a.idx, b.idx, c.idx], pts: [{ role: 'peak1', idx: a.idx, price: a.price }, { role: 'peak2', idx: c.idx, price: c.price }] }); continue; }
          // 緩和判定でもネックライン下抜け必須
          const necklinePrice = b.price;
          const breakoutBuffer = 0.015;
          let breakoutIdx = -1;
          // 山2から最大20本以内にネックライン下抜けが必要（緩和）
          const maxBarsFromPeak2 = 20;
          for (let k = c.idx + 1; k < Math.min(c.idx + maxBarsFromPeak2 + 1, candles.length); k++) {
            const closeK = Number(candles[k]?.close ?? NaN);
            if (Number.isFinite(closeK) && closeK < necklinePrice * (1 - breakoutBuffer)) {
              breakoutIdx = k;
              break;
            }
          }
          if (breakoutIdx >= 0) {
            const start = candles[a.idx].isoTime, end = candles[breakoutIdx].isoTime;
            if (!start || !end) continue;
            const neckline = [{ x: a.idx, y: necklinePrice }, { x: breakoutIdx, y: necklinePrice }];
            const tolMargin = marginFromRelDev(relDev(a.price, c.price), tolRelax);
            const symmetry = clamp01(1 - relDev(a.price, c.price));
            const per = periodScoreDays(start, end);
            const base = (tolMargin + symmetry + per) / 3;
            const confidence = finalizeConf(base * 0.85, 'double_top'); // 緩和パスは大きめペナルティ
            const diagram = generatePatternDiagram(
              'double_top',
              [
                { ...a, date: (candles[a.idx] as any)?.isoTime },
                { ...b, date: (candles[b.idx] as any)?.isoTime },
                { ...c, date: (candles[c.idx] as any)?.isoTime },
              ],
              { price: necklinePrice },
              { start, end }
            );
            push(patterns, { type: 'double_top', confidence, range: { start, end }, pivots: [a, b, c], neckline, breakout: { idx: breakoutIdx, price: Number(candles[breakoutIdx]?.close ?? NaN) }, structureDiagram: diagram, _fallback: `relaxed_double_x${f}` });
            foundDoubleTop = true;
            break;
          } else {
            pcand({ type: 'double_top', accepted: false, reason: 'no_breakout_relaxed', idxs: [a.idx, b.idx, c.idx], pts: [{ role: 'peak1', idx: a.idx, price: a.price }, { role: 'valley', idx: b.idx, price: b.price }, { role: 'peak2', idx: c.idx, price: c.price }] });
          }
        }
      }
      if (!foundDoubleBottom && (want.size === 0 || want.has('double_bottom'))) {
        const tolRelax = tolerancePct * f;
        const nearRelaxed = (x: number, y: number) => Math.abs(x - y) <= Math.max(x, y) * tolRelax;
        for (let i = 0; i < pivots.length - 3; i++) {
          const a = pivots[i], b = pivots[i + 1], c = pivots[i + 2];
          if (!(a.kind === 'L' && b.kind === 'H' && c.kind === 'L')) continue;
          if (b.idx - a.idx < minDistDB || c.idx - b.idx < minDistDB) continue;
          // サイズ下限フィルタ（3%未満は除外）+ 山高さフィルタ
          {
            const patternHeight = Math.abs(a.price - b.price);
            const heightPct = patternHeight / Math.max(1, Math.max(a.price, b.price));
            if (heightPct < 0.03) { pcand({ type: 'double_bottom', accepted: false, reason: 'pattern_too_small', idxs: [a.idx, b.idx, c.idx] }); continue; }
            const valleyAvg = (a.price + c.price) / 2;
            const peakHeightPct = (b.price - valleyAvg) / Math.max(1, valleyAvg);
            if (peakHeightPct < 0.05) { pcand({ type: 'double_bottom', accepted: false, reason: 'peak_too_shallow_relaxed', idxs: [a.idx, b.idx, c.idx] }); continue; }
          }
          if (!nearRelaxed(a.price, c.price)) { pcand({ type: 'double_bottom', accepted: false, reason: 'valleys_not_equal_relaxed', idxs: [a.idx, b.idx, c.idx], pts: [{ role: 'valley1', idx: a.idx, price: a.price }, { role: 'valley2', idx: c.idx, price: c.price }] }); continue; }
          // 緩和判定でもネックライン突破必須
          const necklinePrice = b.price;
          const breakoutBuffer = 0.015;
          let breakoutIdx = -1;
          // 谷2から最大20本以内にネックライン上抜けが必要（緩和）
          const maxBarsFromValley2 = 20;
          for (let k = c.idx + 1; k < Math.min(c.idx + maxBarsFromValley2 + 1, candles.length); k++) {
            const closeK = Number(candles[k]?.close ?? NaN);
            if (Number.isFinite(closeK) && closeK > necklinePrice * (1 + breakoutBuffer)) {
              breakoutIdx = k;
              break;
            }
          }
          if (breakoutIdx >= 0) {
            const start = candles[a.idx].isoTime, end = candles[breakoutIdx].isoTime;
            if (!start || !end) continue;
            const neckline = [{ x: a.idx, y: necklinePrice }, { x: breakoutIdx, y: necklinePrice }];
            const tolMargin = marginFromRelDev(relDev(a.price, c.price), tolRelax);
            const symmetry = clamp01(1 - relDev(a.price, c.price));
            const per = periodScoreDays(start, end);
            const base = (tolMargin + symmetry + per) / 3;
            const confidence = finalizeConf(base * 0.85, 'double_bottom'); // 緩和パスは大きめペナルティ
            const diagram = generatePatternDiagram(
              'double_bottom',
              [
                { ...a, date: (candles[a.idx] as any)?.isoTime },
                { ...b, date: (candles[b.idx] as any)?.isoTime },
                { ...c, date: (candles[c.idx] as any)?.isoTime },
              ],
              { price: necklinePrice },
              { start, end }
            );
            push(patterns, { type: 'double_bottom', confidence, range: { start, end }, pivots: [a, b, c], neckline, breakout: { idx: breakoutIdx, price: Number(candles[breakoutIdx]?.close ?? NaN) }, structureDiagram: diagram, _fallback: `relaxed_double_x${f}` });
            foundDoubleBottom = true;
            break;
          } else {
            pcand({ type: 'double_bottom', accepted: false, reason: 'no_breakout_relaxed', idxs: [a.idx, b.idx, c.idx], pts: [{ role: 'valley1', idx: a.idx, price: a.price }, { role: 'peak', idx: b.idx, price: b.price }, { role: 'valley2', idx: c.idx, price: c.price }] });
          }
        }
      }
    }
    // --- 重複パターンの排除（patterns/helpers.ts へ抽出済み） ---
    patterns = deduplicatePatterns(patterns);
  }

  // 2b) 形成中ダブルトップ/ボトム
  if (includeForming && (want.size === 0 || want.has('double_top') || want.has('double_bottom'))) {
    const lastIdx = candles.length - 1;
    const currentPrice = Number(candles[lastIdx]?.close ?? NaN);
    const isoAt = (i: number) => (candles[i] as any)?.isoTime || '';
    const maxFormingDays = 90; // 形成中パターンは3ヶ月以内に制限
    const daysPerBar = ctx.type === '1day' ? 1 : ctx.type === '1week' ? 7 : 1;

    // 形成中 double_top: 確定ピーク1つ + 確定谷 + 現在価格がピーク付近まで上昇中
    if ((want.size === 0 || want.has('double_top')) && allPeaks.length >= 1 && allValleys.length >= 1) {
      // 最後の確定ピークと、その後の確定谷を探す
      const lastConfirmedPeak = [...allPeaks].reverse().find(p => p.idx < lastIdx - 2);
      const valleyAfterPeak = lastConfirmedPeak ? allValleys.find(v => v.idx > lastConfirmedPeak.idx && v.idx < lastIdx - 1) : null;

      if (lastConfirmedPeak && valleyAfterPeak && valleyAfterPeak.idx > lastConfirmedPeak.idx) {
        const leftPeak = lastConfirmedPeak;
        const valley = valleyAfterPeak;

        // 現在価格が左ピーク付近（±許容範囲内）まで上昇している
        const leftPct = currentPrice / Math.max(1, leftPeak.price);
        const rightPeakTolerancePct = 0.05; // 5%許容

        if (leftPct >= (1 - rightPeakTolerancePct) && leftPct <= (1 + rightPeakTolerancePct) && currentPrice > valley.price) {
          // 進捗率: 谷から左ピークレベルへの回復度
          const ratio = (currentPrice - valley.price) / Math.max(1e-12, leftPeak.price - valley.price);
          const progress = Math.max(0, Math.min(1, ratio));
          const completion = Math.min(1, 0.66 + progress * 0.34);

          const minCompletion = 0.4;
          if (completion >= minCompletion) {
            const formationBars = Math.max(0, lastIdx - leftPeak.idx);
            const patternDays = Math.round(formationBars * (ctx.type === '1day' ? 1 : ctx.type === '1week' ? 7 : 1));
            const minPatternDays = 14;

            if (patternDays >= minPatternDays && patternDays <= maxFormingDays) {
              const neckline = [{ x: leftPeak.idx, y: valley.price }, { x: lastIdx, y: valley.price }];
              const confBase = Math.min(1, Math.max(0, (1 - Math.abs(leftPct - 1)) * 0.6 + progress * 0.4));
              const confidence = Math.round(confBase * 100) / 100;
              const start = isoAt(leftPeak.idx);
              const end = isoAt(lastIdx);

              push(patterns, {
                type: 'double_top',
                confidence,
                range: { start, end },
                status: 'forming',
                pivots: [
                  { idx: leftPeak.idx, price: leftPeak.price, kind: 'H' as const },
                  { idx: valley.idx, price: valley.price, kind: 'L' as const },
                ],
                neckline,
                completionPct: Math.round(completion * 100),
                _method: 'forming_double_top',
              });
            }
          }
        }
      }
    }

    // 形成中 double_bottom: 確定谷2つ + 現在価格がネックライン付近まで上昇中
    if ((want.size === 0 || want.has('double_bottom')) && allValleys.length >= 2) {
      const confirmedValleys = allValleys.filter(v => v.idx < lastIdx - 2);

      if (confirmedValleys.length >= 2) {
        // 右側の谷を優先（より新しいペアを探索）
        for (let j = confirmedValleys.length - 1; j >= 1; j--) {
          const rightValley = confirmedValleys[j];
          const leftValley = confirmedValleys[j - 1];
          if (rightValley.idx - leftValley.idx < 5) continue; // 谷の間隔が短すぎる

          // 2つの谷の間に存在する戻り高値（ネックライン候補）を抽出
          const peaksBetween = allPeaks.filter(p => p.idx > leftValley.idx && p.idx < rightValley.idx);
          if (!peaksBetween.length) continue;
          const midPeak = peaksBetween.reduce((best, p) => (p.price > best.price ? p : best), peaksBetween[0]);

          // 谷の深さチェック
          const leftDepth = (midPeak.price - leftValley.price) / Math.max(1e-12, midPeak.price);
          const rightDepth = (midPeak.price - rightValley.price) / Math.max(1e-12, midPeak.price);
          const minValleyDepthPct = 0.03;
          if (!(leftDepth >= minValleyDepthPct && rightDepth >= minValleyDepthPct)) continue;

          // 谷の等高チェック
          const valleyDiff = Math.abs(leftValley.price - rightValley.price) / Math.max(1, Math.max(leftValley.price, rightValley.price));
          if (valleyDiff > tolerancePct * 1.5) continue;

          // 無効化: 現在値が右谷を大きく割り込んでいないこと
          const rightValleyInvalidBelowPct = 0.02;
          if (currentPrice < rightValley.price * (1 - rightValleyInvalidBelowPct)) continue;

          // 完成度: 右谷からネックラインへ向けた戻り具合
          const upRatio = (currentPrice - rightValley.price) / Math.max(1e-12, midPeak.price - rightValley.price);
          const progress = Math.max(0, Math.min(1, upRatio));
          const completion = Math.min(1, 0.66 + 0.34 * progress);

          const minCompletion = 0.4;
          if (completion < minCompletion) continue;

          const formationBars = Math.max(0, lastIdx - leftValley.idx);
          const patternDays = Math.round(formationBars * daysPerBar);
          const minPatternDays = 14;
          if (patternDays < minPatternDays || patternDays > maxFormingDays) continue;

          const neckline = [{ x: midPeak.idx, y: midPeak.price }, { x: lastIdx, y: midPeak.price }];
          const confidence = Number((Math.min(1, 0.5 + 0.5 * progress)).toFixed(2));
          const start = isoAt(leftValley.idx);
          const end = isoAt(lastIdx);

          push(patterns, {
            type: 'double_bottom',
            confidence,
            range: { start, end },
            status: 'forming',
            pivots: [
              { idx: leftValley.idx, price: leftValley.price, kind: 'L' as const },
              { idx: midPeak.idx, price: midPeak.price, kind: 'H' as const },
              { idx: rightValley.idx, price: rightValley.price, kind: 'L' as const },
            ],
            neckline,
            completionPct: Math.round(completion * 100),
            _method: 'forming_double_bottom',
          });

          // 最新の妥当な1件で十分
          break;
        }
      }
    }
  }

  return { patterns, found: { double_top: foundDoubleTop, double_bottom: foundDoubleBottom } };
}
