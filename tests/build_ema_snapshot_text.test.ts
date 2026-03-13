import { describe, it, expect } from 'vitest';
import {
  buildEmaSnapshotText,
  type BuildEmaSnapshotTextInput,
  type MaLineEntry,
} from '../tools/analyze_ema_snapshot.js';

function makeMaLine(overrides?: Partial<MaLineEntry>): MaLineEntry {
  return {
    period: 12,
    value: 15000000,
    distancePct: 0.8,
    distanceAbs: 120000,
    slope: 'rising',
    slopePctPerBar: 0.03,
    pricePosition: 'above',
    ...overrides,
  };
}

function makeInput(overrides?: Partial<BuildEmaSnapshotTextInput>): BuildEmaSnapshotTextInput {
  return {
    baseSummary: 'BTC/JPY close=15,120,000 align=bullish pos=above_all',
    type: '1day',
    maLines: [
      makeMaLine({ period: 12 }),
      makeMaLine({ period: 26, value: 14800000 }),
      makeMaLine({ period: 50, value: 14200000 }),
      makeMaLine({ period: 200, value: 13000000, slope: 'flat' }),
    ],
    crossStatuses: [{ a: 'EMA_12', b: 'EMA_26', type: 'golden', delta: 200000 }],
    recentCrosses: [{ type: 'golden_cross', pair: [12, 26], barsAgo: 3, date: '2025-01-12' }],
    ...overrides,
  };
}

describe('buildEmaSnapshotText', () => {
  it('基本出力: baseSummary + EMA行を含む', () => {
    const text = buildEmaSnapshotText(makeInput());
    expect(text).toContain('BTC/JPY close=15,120,000');
    expect(text).toContain('EMA(12):');
    expect(text).toContain('EMA(26):');
    expect(text).toContain('EMA(200):');
  });

  it('EMA行に距離とslopeが含まれる', () => {
    const text = buildEmaSnapshotText(makeInput());
    expect(text).toContain('+0.8%');
    expect(text).toContain('slope=rising');
  });

  it('Cross Status が出力される', () => {
    const text = buildEmaSnapshotText(makeInput());
    expect(text).toContain('Cross Status:');
    expect(text).toContain('EMA_12/EMA_26: golden');
  });

  it('Recent Crosses が出力される', () => {
    const text = buildEmaSnapshotText(makeInput());
    expect(text).toContain('golden_cross 12/26 - 3 bars ago');
  });

  it('空 crossStatuses で Cross Status 非表示', () => {
    const text = buildEmaSnapshotText(makeInput({ crossStatuses: [] }));
    expect(text).not.toContain('Cross Status:');
  });

  it('空 recentCrosses で Recent Crosses 非表示', () => {
    const text = buildEmaSnapshotText(makeInput({ recentCrosses: [] }));
    expect(text).not.toContain('Recent Crosses');
  });

  it('pricePosition=equal で「同水準」表示', () => {
    const text = buildEmaSnapshotText(makeInput({
      maLines: [makeMaLine({ pricePosition: 'equal' })],
    }));
    expect(text).toContain('（同水準）');
  });

  it('フッターに EMA 固有の情報を含む', () => {
    const text = buildEmaSnapshotText(makeInput());
    expect(text).toContain('📌 含まれるもの: EMA値');
    expect(text).toContain('analyze_sma_snapshot');
  });
});
