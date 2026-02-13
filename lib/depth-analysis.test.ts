import { describe, it, expect } from 'vitest';
import { estimateZones } from './depth-analysis.js';

describe('estimateZones', () => {
  it('空配列は空配列を返す', () => {
    expect(estimateZones([], 'bid')).toEqual([]);
  });

  it('閾値超えのレベルをゾーンとして検出する (bid)', () => {
    // n=10 にすると avg+2σ が外れ値より十分低くなり検出される
    const levels: [number, number][] = [
      [15000000, 0.5],
      [14990000, 0.5],
      [14980000, 0.5],
      [14970000, 0.5],
      [14960000, 0.5],
      [14950000, 0.5],
      [14940000, 0.5],
      [14930000, 0.5],
      [14920000, 0.5],
      [14910000, 100.0], // 大きな壁
    ];
    const zones = estimateZones(levels, 'bid');
    expect(zones.length).toBeGreaterThan(0);
    expect(zones[0]).toHaveProperty('label', 'bid wall');
    expect(zones[0]).toHaveProperty('color');
    expect(zones[0].low).toBeLessThan(zones[0].high);
  });

  it('ask 側のゾーンを検出する', () => {
    const levels: [number, number][] = [
      [15100000, 0.5],
      [15110000, 0.5],
      [15120000, 0.5],
      [15130000, 0.5],
      [15140000, 0.5],
      [15150000, 0.5],
      [15160000, 0.5],
      [15170000, 0.5],
      [15180000, 0.5],
      [15190000, 100.0], // 大きな壁
    ];
    const zones = estimateZones(levels, 'ask');
    expect(zones.length).toBeGreaterThan(0);
    expect(zones[0]).toHaveProperty('label', 'ask wall');
  });

  it('壁がない場合は空配列を返す', () => {
    const levels: [number, number][] = [
      [15000000, 1.0],
      [14990000, 1.1],
      [14980000, 0.9],
      [14970000, 1.0],
    ];
    const zones = estimateZones(levels, 'bid');
    expect(zones).toEqual([]);
  });

  it('最大5個までに制限する', () => {
    // 全て同じ大きなサイズ → stddev = 0 → avg+2*0 = avg → 全て >= thr
    const levels: [number, number][] = Array.from({ length: 10 }, (_, i) => [
      15000000 - i * 10000,
      100.0,
    ]);
    const zones = estimateZones(levels, 'bid');
    expect(zones.length).toBeLessThanOrEqual(5);
  });
});
