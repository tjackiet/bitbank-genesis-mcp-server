/**
 * Pennant & Flag detection — extracted from detect_patterns.ts (sections 5 & 5a).
 */
import { clamp01 } from './regression.js';
import { periodScoreDays, finalizeConf, globalDedup } from './helpers.js';
import { getConvergenceFactorForTf } from '../patterns/config.js';
import type { DetectContext, DetectResult } from './types.js';

const push = (arr: any[], item: any) => { arr.push(item); };

export function detectPennantsFlags(ctx: DetectContext): DetectResult {
  const { candles, want, tolerancePct, includeForming, pct } = ctx;
  const type = ctx.type;
  let patterns: any[] = [];

  // 5) Pennant & Flag (continuation after pole)
  {
    const wantPennant = want.size === 0 || want.has('pennant');
    const wantFlag = want.size === 0 || want.has('flag');
    const W = Math.min(20, candles.length);
    const closes = candles.map(c => c.close);
    const highsArr = candles.map(c => c.high);
    const lowsArr = candles.map(c => c.low);
    const M = Math.min(12, Math.max(6, Math.floor(W * 0.6))); // 旗竿計測をやや長めに
    const idxEnd = candles.length - 1;
    const idxStart = Math.max(0, idxEnd - M);
    const poleChange = pct(closes[idxStart], closes[idxEnd]);
    // 時間軸に応じた旗竿しきい値（C）
    const poleThreshold = (tf: string): number => {
      const t = String(tf);
      if (t === '1hour' || t === '4hour') return 0.05; // 5%
      if (t === '1day') return 0.08; // 8%
      return 0.06; // others
    };
    const minPole = poleThreshold(type);
    const poleUp = poleChange >= minPole;
    const poleDown = poleChange <= -minPole;
    const havePole = poleUp || poleDown;

    // Consolidation window after pole start
    const C = Math.min(14, W);
    const winStart = Math.max(0, candles.length - C);
    const hwin = highsArr.slice(winStart);
    const lwin = lowsArr.slice(winStart);
    const firstH = hwin[0];
    const lastH = hwin[hwin.length - 1];
    const firstL = lwin[0];
    const lastL = lwin[lwin.length - 1];
    const dH = pct(firstH, lastH);
    const dL = pct(firstL, lastL);
    const spreadStart = firstH - firstL;
    const spreadEnd = lastH - lastL;
    // 収束条件を時間軸で緩和（B）
    const convF = getConvergenceFactorForTf(type);
    const converging = spreadEnd < spreadStart * (1 - tolerancePct * convF);

    if (havePole) {
      const start = candles[winStart].isoTime;
      const end = candles[idxEnd].isoTime;
      if (start && end) {
        // Pennant: converging (symmetrical) consolidation after strong pole
        if (wantPennant && ((dH <= 0 && dL >= 0) || (dH < 0 && dL > 0)) && converging) {
          const qPole = clamp01((Math.abs(poleChange) - minPole) / Math.max(1e-12, (minPole * 2)));
          const qConv = clamp01((spreadStart - spreadEnd) / Math.max(1e-12, spreadStart * 0.8));
          const per = periodScoreDays(start, end);
          const base = (qPole + qConv + per) / 3;
          const confidence = finalizeConf(base, 'pennant');
          push(patterns, { type: 'pennant', confidence, range: { start, end } });
        }
        // Flag: parallel/slight slope against pole direction
        if (wantFlag) {
          const slopeAgainstUp = poleUp && dH < 0 && dL < 0; // both down
          const slopeAgainstDown = poleDown && dH > 0 && dL > 0; // both up
          const smallRange = spreadEnd <= spreadStart * 1.02; // 並行チャネルの厳格化
          if ((slopeAgainstUp || slopeAgainstDown) && smallRange) {
            const qPole = clamp01((Math.abs(poleChange) - minPole) / Math.max(1e-12, (minPole * 2)));
            const qRange = clamp01(1 - (spreadEnd - spreadStart) / Math.max(1e-12, spreadStart * 0.2));
            const per = periodScoreDays(start, end);
            const base = (qPole + qRange + per) / 3;
            const confidence = finalizeConf(base, 'flag');
            push(patterns, { type: 'flag', confidence, range: { start, end } });
          }
        }
      }
    }
  }

  // 5a) 形成中ペナント/フラッグ（統合: 旗竿後の保ち合い形成中）
  if (includeForming && (want.size === 0 || want.has('pennant') || want.has('flag'))) {
    const lastIdx = candles.length - 1;
    const isoAt = (i: number) => (candles[i] as any)?.isoTime || '';
    const maxFormingDays = 30; // ペナント/フラッグは短期パターン
    const daysPerBar = type === '1day' ? 1 : type === '1week' ? 7 : 1;

    const closes = candles.map(c => c.close);
    const highsArr = candles.map(c => c.high);
    const lowsArr = candles.map(c => c.low);

    // 旗竿検出（直近20本）
    const poleWindow = Math.min(20, candles.length);
    const poleStart = Math.max(0, lastIdx - poleWindow);

    // 各ウィンドウで旗竿を探す
    for (let poleLen = 5; poleLen <= Math.min(12, poleWindow); poleLen++) {
      const poleEndIdx = lastIdx - Math.floor(poleLen * 0.3); // 旗竿の終点
      if (poleEndIdx < poleLen) continue;

      const poleStartIdx = poleEndIdx - poleLen;
      const poleChange = (closes[poleEndIdx] - closes[poleStartIdx]) / Math.max(1e-12, closes[poleStartIdx]);
      const minPoleChange = type === '1day' ? 0.06 : 0.04; // 6%/4%

      const poleUp = poleChange >= minPoleChange;
      const poleDown = poleChange <= -minPoleChange;

      if (!poleUp && !poleDown) continue;

      // 保ち合い部分（旗竿後）
      const consolidationStart = poleEndIdx + 1;
      if (consolidationStart >= lastIdx - 2) continue;

      const consHighs = highsArr.slice(consolidationStart, lastIdx + 1);
      const consLows = lowsArr.slice(consolidationStart, lastIdx + 1);
      if (consHighs.length < 3) continue;

      const firstH = consHighs[0], lastH = consHighs[consHighs.length - 1];
      const firstL = consLows[0], lastL = consLows[consLows.length - 1];
      const spreadStart = firstH - firstL;
      const spreadEnd = lastH - lastL;

      // 期間チェック
      const formationBars = Math.max(0, lastIdx - poleStartIdx);
      const patternDays = Math.round(formationBars * daysPerBar);
      if (patternDays > maxFormingDays) continue;

      const dH = (lastH - firstH) / Math.max(1e-12, firstH);
      const dL = (lastL - firstL) / Math.max(1e-12, firstL);

      // ペナント: 収束（高値下落＆安値上昇）
      const isPennant = spreadEnd < spreadStart * 0.85 && dH < 0 && dL > 0;

      // フラッグ: 並行で旗竿と逆方向
      const isFlag = Math.abs(spreadEnd - spreadStart) / Math.max(1e-12, spreadStart) < 0.15 &&
        ((poleUp && dH < 0 && dL < 0) || (poleDown && dH > 0 && dL > 0));

      if ((want.size === 0 || want.has('pennant')) && isPennant) {
        const qPole = Math.min(1, Math.abs(poleChange) / (minPoleChange * 2));
        const qConv = Math.min(1, (spreadStart - spreadEnd) / Math.max(1e-12, spreadStart * 0.5));
        const confidence = Math.round((0.5 + qPole * 0.25 + qConv * 0.25) * 100) / 100;

        push(patterns, {
          type: 'pennant',
          confidence,
          range: { start: isoAt(poleStartIdx), end: isoAt(lastIdx) },
          status: 'forming',
          completionPct: Math.round((1 - spreadEnd / Math.max(1e-12, spreadStart)) * 100),
          _method: 'forming_pennant',
        });
        break; // 1件で十分
      }

      if ((want.size === 0 || want.has('flag')) && isFlag) {
        const qPole = Math.min(1, Math.abs(poleChange) / (minPoleChange * 2));
        const qParallel = Math.min(1, 1 - Math.abs(spreadEnd - spreadStart) / Math.max(1e-12, spreadStart * 0.2));
        const confidence = Math.round((0.5 + qPole * 0.25 + qParallel * 0.25) * 100) / 100;

        push(patterns, {
          type: 'flag',
          confidence,
          range: { start: isoAt(poleStartIdx), end: isoAt(lastIdx) },
          status: 'forming',
          completionPct: 70, // フラッグは完成度の概念が曖昧
          _method: 'forming_flag',
        });
        break; // 1件で十分
      }
    }
  }

  // 5b) Global deduplication across types（patterns/helpers.ts へ抽出済み）
  patterns = globalDedup(patterns);

  return { patterns };
}
