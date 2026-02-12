/**
 * 板データ（depth）の分析ユーティリティ
 */

import { avg as mathAvg, stddev } from './math.js';

export type DepthZone = { low: number; high: number; label: string; color?: string };

/**
 * ゾーン自動推定（簡易）：レベル配列から平均+2σ超の価格帯を抽出
 */
export function estimateZones(
  levels: ReadonlyArray<[number, number]>,
  side: 'bid' | 'ask',
): DepthZone[] {
  if (!levels.length) return [];
  const qtys = levels.map(([, s]) => s);
  const avg = mathAvg(qtys) ?? 0;
  const stdev = stddev(qtys);
  const thr = avg + stdev * 2;
  const zones: DepthZone[] = [];
  for (const [p, s] of levels) {
    if (s >= thr) {
      const pad = p * 0.001; // 0.1%幅
      if (side === 'bid') zones.push({ low: p - pad, high: p + pad, label: 'bid wall', color: 'rgba(34,197,94,0.08)' });
      else zones.push({ low: p - pad, high: p + pad, label: 'ask wall', color: 'rgba(249,115,22,0.08)' });
    }
  }
  return zones.slice(0, 5); // 多すぎないように上位数本
}
