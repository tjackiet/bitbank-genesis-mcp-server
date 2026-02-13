/**
 * トレンドライン構築ヘルパー
 *
 * detect_patterns.ts から抽出した makeLine / findUpperTrendline / findLowerTrendline。
 * 「完成ウェッジ検出」「形成中ウェッジ検出」で共用する。
 */

export interface TrendLine {
  slope: number;
  intercept: number;
  valueAt: (idx: number) => number;
  p1: { idx: number; price: number };
  p2: { idx: number; price: number };
}

/** 2 点を結ぶ直線を生成 */
export function makeLine(p1: { idx: number; price: number }, p2: { idx: number; price: number }): TrendLine {
  const slope = (p2.price - p1.price) / Math.max(1, p2.idx - p1.idx);
  const intercept = p1.price - slope * p1.idx;
  return {
    slope,
    intercept,
    valueAt: (idx: number) => slope * idx + intercept,
    p1,
    p2,
  };
}

/**
 * 上側トレンドライン候補を生成 — 最初の1/3と最後の1/3の高値点から2点を選び、
 * 許容誤差内で最も多くのタッチを持つラインを返す。
 * @param splitRatio - first/last 区間比率（デフォルト 1/3、形成中は 1/2）
 * @param minTouches - 最低タッチ数（デフォルト 2）
 */
export function findUpperTrendline(
  highs: { idx: number; price: number }[],
  startIdx: number,
  endIdx: number,
  tolerance: number,
  maxTouchGap = 25,
  splitRatio = 1 / 3,
  minTouches = 2,
): TrendLine | null {
  const inRange = highs.filter(h => h.idx >= startIdx && h.idx <= endIdx);
  if (inRange.length < 2) return null;

  const span = endIdx - startIdx;
  const firstThird = inRange.filter(h => h.idx < startIdx + span * splitRatio);
  const lastThird = inRange.filter(h => h.idx > endIdx - span * splitRatio);

  if (firstThird.length === 0 || lastThird.length === 0) return null;

  let bestLine: TrendLine | null = null;
  let bestScore = -Infinity;

  for (const p1 of firstThird) {
    for (const p2 of lastThird) {
      if (p1.idx >= p2.idx) continue;

      const line = makeLine(p1, p2);

      let valid = true;
      let violations = 0;
      for (const h of inRange) {
        const lineValue = line.valueAt(h.idx);
        if (h.price > lineValue + tolerance) {
          violations++;
          if (violations > 1) { valid = false; break; }
        }
      }

      if (valid) {
        const touchPoints: number[] = [];
        for (const h of inRange) {
          const lineValue = line.valueAt(h.idx);
          if (Math.abs(h.price - lineValue) <= tolerance) {
            touchPoints.push(h.idx);
          }
        }

        if (touchPoints.length >= minTouches) {
          touchPoints.sort((a, b) => a - b);
          let maxGap = 0;
          for (let i = 1; i < touchPoints.length; i++) {
            const gap = touchPoints[i] - touchPoints[i - 1];
            if (gap > maxGap) maxGap = gap;
          }
          if (maxGap > maxTouchGap) {
            valid = false;
          }
        }

        if (valid && touchPoints.length >= minTouches) {
          const score = touchPoints.length + (line.slope < 0 ? 1 : 0);
          if (score > bestScore) {
            bestScore = score;
            bestLine = line;
          }
        }
      }
    }
  }

  return bestLine;
}

/**
 * 下側トレンドライン候補を生成 — 最初の1/3と最後の1/3の安値点から2点を選び、
 * 許容誤差内で最も多くのタッチを持つラインを返す。
 * @param splitRatio - first/last 区間比率（デフォルト 1/3、形成中は 1/2）
 * @param minTouches - 最低タッチ数（デフォルト 2）
 */
export function findLowerTrendline(
  lows: { idx: number; price: number }[],
  startIdx: number,
  endIdx: number,
  tolerance: number,
  maxTouchGap = 25,
  splitRatio = 1 / 3,
  minTouches = 2,
): TrendLine | null {
  const inRange = lows.filter(l => l.idx >= startIdx && l.idx <= endIdx);
  if (inRange.length < 2) return null;

  const span = endIdx - startIdx;
  const firstThird = inRange.filter(l => l.idx < startIdx + span * splitRatio);
  const lastThird = inRange.filter(l => l.idx > endIdx - span * splitRatio);

  if (firstThird.length === 0 || lastThird.length === 0) return null;

  let bestLine: TrendLine | null = null;
  let bestScore = -Infinity;

  for (const p1 of firstThird) {
    for (const p2 of lastThird) {
      if (p1.idx >= p2.idx) continue;

      const line = makeLine(p1, p2);

      let valid = true;
      let violations = 0;
      for (const l of inRange) {
        const lineValue = line.valueAt(l.idx);
        if (l.price < lineValue - tolerance) {
          violations++;
          if (violations > 1) { valid = false; break; }
        }
      }

      if (valid) {
        const touchPoints: number[] = [];
        for (const l of inRange) {
          const lineValue = line.valueAt(l.idx);
          if (Math.abs(l.price - lineValue) <= tolerance) {
            touchPoints.push(l.idx);
          }
        }

        if (touchPoints.length >= minTouches) {
          touchPoints.sort((a, b) => a - b);
          let maxGap = 0;
          for (let i = 1; i < touchPoints.length; i++) {
            const gap = touchPoints[i] - touchPoints[i - 1];
            if (gap > maxGap) maxGap = gap;
          }
          if (maxGap > maxTouchGap) {
            valid = false;
          }
        }

        if (valid && touchPoints.length >= minTouches) {
          const score = touchPoints.length + (line.slope < 0 ? 1 : 0);
          if (score > bestScore) {
            bestScore = score;
            bestLine = line;
          }
        }
      }
    }
  }

  return bestLine;
}
