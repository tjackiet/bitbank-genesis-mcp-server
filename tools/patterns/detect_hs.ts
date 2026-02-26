/**
 * Head & Shoulders / Inverse Head & Shoulders 検出（完成済み＋形成中）
 * detect_patterns.ts Section 3 から抽出
 */
import { generatePatternDiagram } from '../../src/utils/pattern-diagrams.js';
import { clamp01, relDev, marginFromRelDev } from './regression.js';
import { periodScoreDays, finalizeConf } from './helpers.js';
import { pushCand, type DetectContext, type DetectResult, type CandDebugEntry } from './types.js';

export function detectHeadAndShoulders(ctx: DetectContext): DetectResult {
  const { candles, pivots, allPeaks, allValleys, tolerancePct, minDist, want, includeForming, near, debugCandidates } = ctx;
  const pcand = (arg: Parameters<typeof pushCand>[1]) => pushCand(ctx, arg);
  const push = (arr: any[], item: any) => { arr.push(item); };
  const patterns: any[] = [];

  // 3) Inverse H&S (L-H-L-H-L with head lower than both shoulders)
  let foundInverseHS = false;
  if (want.size === 0 || want.has('inverse_head_and_shoulders')) {
    for (let i = 0; i < pivots.length - 4; i++) {
      const p0 = pivots[i], p1 = pivots[i + 1], p2 = pivots[i + 2], p3 = pivots[i + 3], p4 = pivots[i + 4];
      if (!(p0.kind === 'L' && p1.kind === 'H' && p2.kind === 'L' && p3.kind === 'H' && p4.kind === 'L')) continue;
      if (p1.idx - p0.idx < minDist || p2.idx - p1.idx < minDist || p3.idx - p2.idx < minDist || p4.idx - p3.idx < minDist) continue;
      const shouldersNear = near(p0.price, p4.price);
      const headLower = p2.price < Math.min(p0.price, p4.price) * (1 - tolerancePct);
      if (shouldersNear && headLower) {
        const start = candles[p0.idx].isoTime;
        const end = candles[p4.idx].isoTime;
        if (start && end) {
          // ネックライン: 両肩間の高値(p1, p3)を結ぶ線
          const neckline = [
            { x: p1.idx, y: p1.price },
            { x: p3.idx, y: p3.price },
          ];
          const tolMargin = marginFromRelDev(relDev(p0.price, p4.price), tolerancePct);
          const symmetry = clamp01(1 - relDev(p0.price, p4.price));
          const per = periodScoreDays(start, end);
          const base = (tolMargin + symmetry + per) / 3;
          const confidence = finalizeConf(base, 'inverse_head_and_shoulders');
          // 構造図（逆三尊）
          const nlAvg = (Number(p1.price) + Number(p3.price)) / 2;
          const diagram = generatePatternDiagram(
            'inverse_head_and_shoulders',
            [
              { ...p0, date: (candles[p0.idx] as any)?.isoTime },
              { ...p1, date: (candles[p1.idx] as any)?.isoTime },
              { ...p2, date: (candles[p2.idx] as any)?.isoTime },
              { ...p3, date: (candles[p3.idx] as any)?.isoTime },
              { ...p4, date: (candles[p4.idx] as any)?.isoTime },
            ],
            { price: nlAvg },
            { start, end }
          );
          // --- ターゲット価格計算（neckline_projection 方式） ---
          // Inverse H&S: ネックライン + (ネックライン平均 - ヘッド)
          const ihsNlAvg = (p1.price + p3.price) / 2;
          const ihsTarget = Math.round(ihsNlAvg + (ihsNlAvg - p2.price));

          push(patterns, { type: 'inverse_head_and_shoulders', confidence, range: { start, end }, pivots: [p0, p1, p2, p3, p4], neckline, trendlineLabel: 'ネックライン', breakoutTarget: ihsTarget, targetMethod: 'neckline_projection' as const, structureDiagram: diagram });
          foundInverseHS = true;
          debugCandidates.push({
            type: 'inverse_head_and_shoulders',
            accepted: true,
            indices: [p0.idx, p1.idx, p2.idx, p3.idx, p4.idx],
            points: [
              { role: 'left_shoulder', idx: p0.idx, price: p0.price, isoTime: (candles[p0.idx] as any)?.isoTime },
              { role: 'peak1', idx: p1.idx, price: p1.price, isoTime: (candles[p1.idx] as any)?.isoTime },
              { role: 'head', idx: p2.idx, price: p2.price, isoTime: (candles[p2.idx] as any)?.isoTime },
              { role: 'peak2', idx: p3.idx, price: p3.price, isoTime: (candles[p3.idx] as any)?.isoTime },
              { role: 'right_shoulder', idx: p4.idx, price: p4.price, isoTime: (candles[p4.idx] as any)?.isoTime },
            ],
          });
        }
      }
      else {
        const reason = !shouldersNear ? 'shoulders_not_near' : (!headLower ? 'head_not_lower' : 'unknown');
        debugCandidates.push({
          type: 'inverse_head_and_shoulders',
          accepted: false,
          reason,
          details: {
            leftShoulder: p0.price, rightShoulder: p4.price,
            shouldersDiff: Math.abs(p0.price - p4.price),
            shouldersDiffPct: Math.abs(p0.price - p4.price) / Math.max(1, Math.max(p0.price, p4.price)),
            head: p2.price, thresholdPct: tolerancePct,
          },
          indices: [p0.idx, p1.idx, p2.idx, p3.idx, p4.idx],
        });
      }
    }
  }

  // 3b) Head & Shoulders (H-L-H-L-H with head higher than both shoulders)
  let foundHS = false;
  if (want.size === 0 || want.has('head_and_shoulders')) {
    for (let i = 0; i < pivots.length - 4; i++) {
      const p0 = pivots[i], p1 = pivots[i + 1], p2 = pivots[i + 2], p3 = pivots[i + 3], p4 = pivots[i + 4];
      if (!(p0.kind === 'H' && p1.kind === 'L' && p2.kind === 'H' && p3.kind === 'L' && p4.kind === 'H')) continue;
      if (p1.idx - p0.idx < minDist || p2.idx - p1.idx < minDist || p3.idx - p2.idx < minDist || p4.idx - p3.idx < minDist) continue;
      const shouldersNear = near(p0.price, p4.price);
      const headHigher = p2.price > Math.max(p0.price, p4.price) * (1 + tolerancePct);
      if (shouldersNear && headHigher) {
        const start = candles[p0.idx].isoTime;
        const end = candles[p4.idx].isoTime;
        if (start && end) {
          // ネックライン: 両肩間の安値(p1, p3)を結ぶ線
          const neckline = [
            { x: p1.idx, y: p1.price },
            { x: p3.idx, y: p3.price },
          ];
          const tolMargin = marginFromRelDev(relDev(p0.price, p4.price), tolerancePct);
          const symmetry = clamp01(1 - relDev(p0.price, p4.price));
          const per = periodScoreDays(start, end);
          const base = (tolMargin + symmetry + per) / 3;
          const confidence = finalizeConf(base, 'head_and_shoulders');
          const nlAvg = (Number(p1.price) + Number(p3.price)) / 2;
          const diagram = generatePatternDiagram(
            'head_and_shoulders',
            [
              { ...p0, date: (candles[p0.idx] as any)?.isoTime },
              { ...p1, date: (candles[p1.idx] as any)?.isoTime },
              { ...p2, date: (candles[p2.idx] as any)?.isoTime },
              { ...p3, date: (candles[p3.idx] as any)?.isoTime },
              { ...p4, date: (candles[p4.idx] as any)?.isoTime },
            ],
            { price: nlAvg },
            { start, end }
          );
          // --- ターゲット価格計算（neckline_projection 方式） ---
          // H&S: ネックライン - (ヘッド - ネックライン平均)
          const hsNlAvg = (p1.price + p3.price) / 2;
          const hsTarget = Math.round(hsNlAvg - (p2.price - hsNlAvg));

          push(patterns, { type: 'head_and_shoulders', confidence, range: { start, end }, pivots: [p0, p1, p2, p3, p4], neckline, trendlineLabel: 'ネックライン', breakoutTarget: hsTarget, targetMethod: 'neckline_projection' as const, structureDiagram: diagram });
          foundHS = true;
          debugCandidates.push({
            type: 'head_and_shoulders',
            accepted: true,
            indices: [p0.idx, p1.idx, p2.idx, p3.idx, p4.idx],
            points: [
              { role: 'left_shoulder', idx: p0.idx, price: p0.price, isoTime: (candles[p0.idx] as any)?.isoTime },
              { role: 'valley1', idx: p1.idx, price: p1.price, isoTime: (candles[p1.idx] as any)?.isoTime },
              { role: 'head', idx: p2.idx, price: p2.price, isoTime: (candles[p2.idx] as any)?.isoTime },
              { role: 'valley2', idx: p3.idx, price: p3.price, isoTime: (candles[p3.idx] as any)?.isoTime },
              { role: 'right_shoulder', idx: p4.idx, price: p4.price, isoTime: (candles[p4.idx] as any)?.isoTime },
            ],
          });
        }
      }
      else {
        const reason = !shouldersNear ? 'shoulders_not_near' : (!headHigher ? 'head_not_higher' : 'unknown');
        debugCandidates.push({
          type: 'head_and_shoulders',
          accepted: false,
          reason,
          details: {
            leftShoulder: p0.price, rightShoulder: p4.price,
            shouldersDiff: Math.abs(p0.price - p4.price),
            shouldersDiffPct: Math.abs(p0.price - p4.price) / Math.max(1, Math.max(p0.price, p4.price)),
            head: p2.price, thresholdPct: tolerancePct,
          },
          indices: [p0.idx, p1.idx, p2.idx, p3.idx, p4.idx],
        });
      }
    }
  }

  // Relaxed fallback for H&S patterns (multi-stage)
  if (!foundHS && (want.size === 0 || want.has('head_and_shoulders'))) {
    for (const factors of [{ shoulder: 1.6, head: 0.6, tag: 'x1.6_0.6' }, { shoulder: 2.0, head: 0.4, tag: 'x2.0_0.4' }]) {
      if (foundHS) break;
      for (let i = 0; i < pivots.length - 4; i++) {
        const p0 = pivots[i], p1 = pivots[i + 1], p2 = pivots[i + 2], p3 = pivots[i + 3], p4 = pivots[i + 4];
        if (!(p0.kind === 'H' && p1.kind === 'L' && p2.kind === 'H' && p3.kind === 'L' && p4.kind === 'H')) continue;
        if (p1.idx - p0.idx < minDist || p2.idx - p1.idx < minDist || p3.idx - p2.idx < minDist || p4.idx - p3.idx < minDist) continue;
        // Relax shoulders similarity and head prominence
        const shouldersNearRelaxed = Math.abs(p0.price - p4.price) / Math.max(1, Math.max(p0.price, p4.price)) <= tolerancePct * factors.shoulder;
        const headHigherRelaxed = p2.price > Math.max(p0.price, p4.price) * (1 + tolerancePct * factors.head);
        if (!shouldersNearRelaxed || !headHigherRelaxed) continue;
        const start = candles[p0.idx].isoTime;
        const end = candles[p4.idx].isoTime;
        if (!start || !end) continue;
        // choose lowest valley between shoulders and after head for neckline robustness
        const valleyBetween = allValleys.filter((v: any) => v.idx > p0.idx && v.idx < p4.idx);
        const postValleys = allValleys.filter((v: any) => v.idx > p2.idx);
        const minValley = valleyBetween.length ? valleyBetween.reduce((m: any, v: any) => v.price < m.price ? v : m) : (postValleys.length ? postValleys.reduce((m: any, v: any) => v.price < m.price ? v : m) : null);
        const nlY = minValley ? minValley.price : Math.min(p1.price, p3.price);
        const neckline = [{ x: p1.idx, y: nlY }, { x: p3.idx, y: nlY }];
        const tolMargin = marginFromRelDev(relDev(p0.price, p4.price), tolerancePct * factors.shoulder);
        const symmetry = clamp01(1 - relDev(p0.price, p4.price));
        const per = periodScoreDays(start, end);
        const base = (tolMargin + symmetry + per) / 3;
        const confidence = finalizeConf(base * 0.95, 'head_and_shoulders');
        const nlAvg = (Number(p1.price) + Number(p3.price)) / 2;
        const diagram = generatePatternDiagram(
          'head_and_shoulders',
          [
            { ...p0, date: (candles[p0.idx] as any)?.isoTime },
            { ...p1, date: (candles[p1.idx] as any)?.isoTime },
            { ...p2, date: (candles[p2.idx] as any)?.isoTime },
            { ...p3, date: (candles[p3.idx] as any)?.isoTime },
            { ...p4, date: (candles[p4.idx] as any)?.isoTime },
          ],
          { price: nlAvg },
          { start, end }
        );
        const hsRelNlAvg = (Number(p1.price) + Number(p3.price)) / 2;
        const hsRelTarget = Math.round(nlY - (p2.price - nlY));
        push(patterns, { type: 'head_and_shoulders', confidence, range: { start, end }, pivots: [p0, p1, p2, p3, p4], neckline, trendlineLabel: 'ネックライン', breakoutTarget: hsRelTarget, targetMethod: 'neckline_projection' as const, structureDiagram: diagram, _fallback: `relaxed_hs_${factors.tag}` });
        foundHS = true;
        debugCandidates.push({
          type: 'head_and_shoulders',
          accepted: true,
          reason: 'fallback_relaxed',
          indices: [p0.idx, p1.idx, p2.idx, p3.idx, p4.idx],
        });
        break;
      }
    }
  }

  if (!foundInverseHS && (want.size === 0 || want.has('inverse_head_and_shoulders'))) {
    for (const factors of [{ shoulder: 1.6, head: 0.6, tag: 'x1.6_0.6' }, { shoulder: 2.0, head: 0.4, tag: 'x2.0_0.4' }]) {
      if (foundInverseHS) break;
      for (let i = 0; i < pivots.length - 4; i++) {
        const p0 = pivots[i], p1 = pivots[i + 1], p2 = pivots[i + 2], p3 = pivots[i + 3], p4 = pivots[i + 4];
        if (!(p0.kind === 'L' && p1.kind === 'H' && p2.kind === 'L' && p3.kind === 'H' && p4.kind === 'L')) continue;
        if (p1.idx - p0.idx < minDist || p2.idx - p1.idx < minDist || p3.idx - p2.idx < minDist || p4.idx - p3.idx < minDist) continue;
        const shouldersNearRelaxed = Math.abs(p0.price - p4.price) / Math.max(1, Math.max(p0.price, p4.price)) <= tolerancePct * factors.shoulder;
        const headLowerRelaxed = p2.price < Math.min(p0.price, p4.price) * (1 - tolerancePct * factors.head);
        if (shouldersNearRelaxed && headLowerRelaxed) {
          const start = candles[p0.idx].isoTime;
          const end = candles[p4.idx].isoTime;
          if (!start || !end) continue;
          const peaksBetween = allPeaks.filter((v: any) => v.idx > p0.idx && v.idx < p4.idx);
          const postPeaks = allPeaks.filter((v: any) => v.idx > p2.idx);
          const maxPeak = peaksBetween.length ? peaksBetween.reduce((m: any, v: any) => v.price > m.price ? v : m) : (postPeaks.length ? postPeaks.reduce((m: any, v: any) => v.price > m.price ? v : m) : null);
          const nlY = maxPeak ? maxPeak.price : Math.max(p1.price, p3.price);
          const neckline = [{ x: p1.idx, y: nlY }, { x: p3.idx, y: nlY }];
          const tolMargin = marginFromRelDev(relDev(p0.price, p4.price), tolerancePct * factors.shoulder);
          const symmetry = clamp01(1 - relDev(p0.price, p4.price));
          const per = periodScoreDays(start, end);
          const base = (tolMargin + symmetry + per) / 3;
          const confidence = finalizeConf(base * 0.95, 'inverse_head_and_shoulders');
          const nlAvg = (Number(p1.price) + Number(p3.price)) / 2;
          const diagram = generatePatternDiagram(
            'inverse_head_and_shoulders',
            [
              { ...p0, date: (candles[p0.idx] as any)?.isoTime },
              { ...p1, date: (candles[p1.idx] as any)?.isoTime },
              { ...p2, date: (candles[p2.idx] as any)?.isoTime },
              { ...p3, date: (candles[p3.idx] as any)?.isoTime },
              { ...p4, date: (candles[p4.idx] as any)?.isoTime },
            ],
            { price: nlAvg },
            { start, end }
          );
          const ihsRelTarget = Math.round(nlY + (nlY - p2.price));
          push(patterns, { type: 'inverse_head_and_shoulders', confidence, range: { start, end }, pivots: [p0, p1, p2, p3, p4], neckline, trendlineLabel: 'ネックライン', breakoutTarget: ihsRelTarget, targetMethod: 'neckline_projection' as const, structureDiagram: diagram, _fallback: `relaxed_ihs_${factors.tag}` });
          foundInverseHS = true;
          debugCandidates.push({
            type: 'inverse_head_and_shoulders',
            accepted: true,
            reason: 'fallback_relaxed',
            indices: [p0.idx, p1.idx, p2.idx, p3.idx, p4.idx],
          });
          break;
        }
      }
    }
  }

  // 3c) 形成中 Head & Shoulders
  if (includeForming && (want.size === 0 || want.has('head_and_shoulders'))) {
    const lastIdx = candles.length - 1;
    const currentPrice = Number(candles[lastIdx]?.close ?? NaN);
    const isoAt = (i: number) => (candles[i] as any)?.isoTime || '';
    const rightPeakTolerancePct = 0.08; // 右肩の許容範囲
    const maxFormingDaysHS = 90; // 形成中パターンは3ヶ月以内に制限
    const daysPerBarHS = ctx.type === '1day' ? 1 : ctx.type === '1week' ? 7 : 1;

    // 確定ピークの中から頭（最高値）を特定
    const confirmedPeaks = allPeaks.filter(p => p.idx < lastIdx - 2);
    if (confirmedPeaks.length >= 2) {
      const head = confirmedPeaks.reduce((best, p) => (p.price > best.price ? p : best), confirmedPeaks[0]);

      // 左肩: 頭より左のピークで、頭より低い
      const leftCandidates = confirmedPeaks.filter(p =>
        p.idx < head.idx &&
        head.price > p.price * 1.03 // 頭が左肩より3%以上高い
      );

      if (leftCandidates.length >= 1) {
        const left = leftCandidates[leftCandidates.length - 1]; // 頭に最も近い左肩

        // 頭後の谷を探す
        const postHeadValley = allValleys.find(v => v.idx > head.idx && v.idx < lastIdx - 1);

        if (postHeadValley) {
          // 右肩候補: 頭後の谷以降の価格上昇で、左肩近傍まで到達
          // 確定ピークがあればそれを使用、なければ現在価格を暫定右肩とする
          const rightPeakCandidates = allPeaks.filter(p =>
            p.idx > postHeadValley.idx &&
            p.price < head.price &&
            Math.abs(p.price - left.price) / Math.max(1, left.price) <= rightPeakTolerancePct
          );

          let rightShoulder: { idx: number; price: number } | null = rightPeakCandidates.length ? rightPeakCandidates[rightPeakCandidates.length - 1] : null;
          let isProvisional = false;

          // 確定右肩がない場合、現在価格が左肩近傍なら暫定右肩
          if (!rightShoulder) {
            const nearLeft = Math.abs(currentPrice - left.price) / Math.max(1, left.price) <= rightPeakTolerancePct;
            if (nearLeft && currentPrice < head.price && currentPrice > postHeadValley.price) {
              rightShoulder = { idx: lastIdx, price: currentPrice };
              isProvisional = true;
            }
          }

          if (rightShoulder) {
            // 完成度計算
            const closeness = 1 - Math.abs(rightShoulder.price - left.price) / Math.max(1e-12, left.price * rightPeakTolerancePct);
            const progress = Math.max(0, Math.min(1, closeness));
            const completion = Math.min(1, (0.75 + 0.25 * progress) * (isProvisional ? 0.9 : 1.0));

            const minCompletion = 0.4;
            if (completion >= minCompletion) {
              const formationBars = Math.max(0, rightShoulder.idx - left.idx);
              const patternDays = Math.round(formationBars * daysPerBarHS);
              const minPatternDays = 21;

              if (patternDays >= minPatternDays && patternDays <= maxFormingDaysHS) {
                // ネックライン: 頭前の谷と頭後の谷を結ぶ（頭前の谷がない場合は水平）
                const preHeadValleys = allValleys.filter(v => v.idx > left.idx && v.idx < head.idx);
                const preHeadValley = preHeadValleys.length ? preHeadValleys.reduce((best, v) => (v.price < best.price ? v : best), preHeadValleys[0]) : null;

                const neckline = preHeadValley
                  ? [{ x: preHeadValley.idx, y: preHeadValley.price }, { x: postHeadValley.idx, y: postHeadValley.price }]
                  : [{ x: left.idx, y: postHeadValley.price }, { x: postHeadValley.idx, y: postHeadValley.price }];

                const confBase = Math.min(1, Math.max(0, 0.6 * closeness + 0.4 * progress));
                const confidence = Math.round(confBase * (isProvisional ? 0.9 : 1.0) * 100) / 100;
                const start = isoAt(left.idx);
                const end = isoAt(rightShoulder.idx);

                // 形成中 H&S ターゲット: ネックライン - (ヘッド - ネックライン)
                const formHsNl = neckline[0].y;
                const formHsTarget = Math.round(formHsNl - (head.price - formHsNl));
                push(patterns, {
                  type: 'head_and_shoulders',
                  confidence,
                  range: { start, end },
                  status: 'forming',
                  pivots: [
                    { idx: left.idx, price: left.price, kind: 'H' as const },
                    { idx: head.idx, price: head.price, kind: 'H' as const },
                    { idx: postHeadValley.idx, price: postHeadValley.price, kind: 'L' as const },
                    { idx: rightShoulder.idx, price: rightShoulder.price, kind: 'H' as const },
                  ],
                  neckline,
                  trendlineLabel: 'ネックライン',
                  breakoutTarget: formHsTarget,
                  targetMethod: 'neckline_projection' as const,
                  completionPct: Math.round(completion * 100),
                  _method: isProvisional ? 'forming_hs_provisional' : 'forming_hs',
                });
              }
            }
          }
        }
      }
    }
  }

  // 3d) 形成中 Inverse Head & Shoulders
  if (includeForming && (want.size === 0 || want.has('inverse_head_and_shoulders'))) {
    const lastIdx = candles.length - 1;
    const currentPrice = Number(candles[lastIdx]?.close ?? NaN);
    const isoAt = (i: number) => (candles[i] as any)?.isoTime || '';
    const rightValleyTolerancePct = 0.08; // 右肩の許容範囲
    const maxFormingDaysIHS = 90; // 形成中パターンは3ヶ月以内に制限
    const daysPerBarIHS = ctx.type === '1day' ? 1 : ctx.type === '1week' ? 7 : 1;

    // 確定谷の中から頭（最安値）を特定
    const confirmedValleys = allValleys.filter(v => v.idx < lastIdx - 2);
    if (confirmedValleys.length >= 2) {
      const head = confirmedValleys.reduce((best, v) => (v.price < best.price ? v : best), confirmedValleys[0]);

      // 左肩: 頭より左の谷で、頭より高い
      const leftCandidates = confirmedValleys.filter(v =>
        v.idx < head.idx &&
        head.price < v.price * 0.97 // 頭が左肩より3%以上低い
      );

      if (leftCandidates.length >= 1) {
        const left = leftCandidates[leftCandidates.length - 1]; // 頭に最も近い左肩

        // 頭後のピークを探す
        const postHeadPeak = allPeaks.find(p => p.idx > head.idx && p.idx < lastIdx - 1);

        if (postHeadPeak) {
          // 右肩候補: 頭後のピーク以降の価格下落で、左肩近傍まで到達
          const rightValleyCandidates = allValleys.filter(v =>
            v.idx > postHeadPeak.idx &&
            v.price > head.price &&
            Math.abs(v.price - left.price) / Math.max(1, left.price) <= rightValleyTolerancePct
          );

          let rightShoulder: { idx: number; price: number } | null = rightValleyCandidates.length ? rightValleyCandidates[rightValleyCandidates.length - 1] : null;
          let isProvisional = false;

          // 確定右肩がない場合、現在価格が左肩近傍なら暫定右肩
          if (!rightShoulder) {
            const nearLeft = Math.abs(currentPrice - left.price) / Math.max(1, left.price) <= rightValleyTolerancePct;
            if (nearLeft && currentPrice > head.price && currentPrice < postHeadPeak.price) {
              rightShoulder = { idx: lastIdx, price: currentPrice };
              isProvisional = true;
            }
          }

          if (rightShoulder) {
            // 完成度計算
            const closeness = 1 - Math.abs(rightShoulder.price - left.price) / Math.max(1e-12, left.price * rightValleyTolerancePct);
            const progress = Math.max(0, Math.min(1, closeness));
            const completion = Math.min(1, (0.75 + 0.25 * progress) * (isProvisional ? 0.9 : 1.0));

            const minCompletion = 0.4;
            if (completion >= minCompletion) {
              const formationBars = Math.max(0, rightShoulder.idx - left.idx);
              const patternDays = Math.round(formationBars * daysPerBarIHS);
              const minPatternDays = 21;

              if (patternDays >= minPatternDays && patternDays <= maxFormingDaysIHS) {
                // ネックライン: 頭前のピークと頭後のピークを結ぶ
                const preHeadPeaks = allPeaks.filter(p => p.idx > left.idx && p.idx < head.idx);
                const preHeadPeak = preHeadPeaks.length ? preHeadPeaks.reduce((best, p) => (p.price > best.price ? p : best), preHeadPeaks[0]) : null;

                const neckline = preHeadPeak
                  ? [{ x: preHeadPeak.idx, y: preHeadPeak.price }, { x: postHeadPeak.idx, y: postHeadPeak.price }]
                  : [{ x: left.idx, y: postHeadPeak.price }, { x: postHeadPeak.idx, y: postHeadPeak.price }];

                const confBase = Math.min(1, Math.max(0, 0.6 * closeness + 0.4 * progress));
                const confidence = Math.round(confBase * (isProvisional ? 0.9 : 1.0) * 100) / 100;
                const start = isoAt(left.idx);
                const end = isoAt(rightShoulder.idx);

                // 形成中 Inverse H&S ターゲット: ネックライン + (ネックライン - ヘッド)
                const formIhsNl = neckline[0].y;
                const formIhsTarget = Math.round(formIhsNl + (formIhsNl - head.price));
                push(patterns, {
                  type: 'inverse_head_and_shoulders',
                  confidence,
                  range: { start, end },
                  status: 'forming',
                  pivots: [
                    { idx: left.idx, price: left.price, kind: 'L' as const },
                    { idx: head.idx, price: head.price, kind: 'L' as const },
                    { idx: postHeadPeak.idx, price: postHeadPeak.price, kind: 'H' as const },
                    { idx: rightShoulder.idx, price: rightShoulder.price, kind: 'L' as const },
                  ],
                  neckline,
                  trendlineLabel: 'ネックライン',
                  breakoutTarget: formIhsTarget,
                  targetMethod: 'neckline_projection' as const,
                  completionPct: Math.round(completion * 100),
                  _method: isProvisional ? 'forming_ihs_provisional' : 'forming_ihs',
                });
              }
            }
          }
        }
      }
    }
  }

  return { patterns, found: { head_and_shoulders: foundHS, inverse_head_and_shoulders: foundInverseHS } };
}
