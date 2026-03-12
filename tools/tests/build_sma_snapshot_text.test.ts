import { describe, it, expect } from 'vitest';
import {
  buildSmaSnapshotText,
  type BuildSmaSnapshotTextInput,
  type MaLineEntry,
  type CrossStatus,
  type RecentCrossEntry,
} from '../analyze_sma_snapshot.js';

function makeMaLine(overrides?: Partial<MaLineEntry>): MaLineEntry {
  return {
    period: 25,
    value: 15000000,
    distancePct: 1.5,
    distanceAbs: 225000,
    slope: 'rising',
    slopePctPerBar: 0.05,
    pricePosition: 'above',
    ...overrides,
  };
}

function makeInput(overrides?: Partial<BuildSmaSnapshotTextInput>): BuildSmaSnapshotTextInput {
  return {
    baseSummary: 'BTC/JPY close=15,225,000 align=bullish pos=above_all',
    type: '1day',
    maLines: [makeMaLine({ period: 25 }), makeMaLine({ period: 75, value: 14500000, slope: 'rising' }), makeMaLine({ period: 200, value: 13000000, slope: 'flat' })],
    crossStatuses: [{ a: 'SMA_25', b: 'SMA_75', type: 'golden', delta: 500000 }],
    recentCrosses: [{ type: 'golden_cross', pair: [25, 75], barsAgo: 5, date: '2025-01-10' }],
    ...overrides,
  };
}

describe('buildSmaSnapshotText', () => {
  it('基本出力: baseSummary + MA行を含む', () => {
    const text = buildSmaSnapshotText(makeInput());
    expect(text).toContain('BTC/JPY close=15,225,000');
    expect(text).toContain('SMA(25):');
    expect(text).toContain('SMA(75):');
    expect(text).toContain('SMA(200):');
  });

  it('MA行に value・距離・slope が含まれる', () => {
    const text = buildSmaSnapshotText(makeInput());
    expect(text).toContain('+1.5%');
    expect(text).toContain('slope=rising');
    expect(text).toContain('（価格は上）');
  });

  it('type=1day の場合 slopeRate に /day が含まれる', () => {
    const text = buildSmaSnapshotText(makeInput());
    expect(text).toContain('%/day');
  });

  it('type=4hour の場合 slopeRate に /bar が含まれる', () => {
    const text = buildSmaSnapshotText(makeInput({ type: '4hour' }));
    expect(text).toContain('%/bar');
  });

  it('Cross Status セクションが含まれる', () => {
    const text = buildSmaSnapshotText(makeInput());
    expect(text).toContain('Cross Status:');
    expect(text).toContain('SMA_25/SMA_75: golden (delta:500000)');
  });

  it('Recent Crosses セクションが含まれる', () => {
    const text = buildSmaSnapshotText(makeInput());
    expect(text).toContain('Recent Crosses (all):');
    expect(text).toContain('golden_cross 25/75 - 5 bars ago (2025-01-10)');
  });

  it('crossStatuses が空の場合は Cross Status セクションなし', () => {
    const text = buildSmaSnapshotText(makeInput({ crossStatuses: [] }));
    expect(text).not.toContain('Cross Status:');
  });

  it('recentCrosses が空の場合は Recent Crosses セクションなし', () => {
    const text = buildSmaSnapshotText(makeInput({ recentCrosses: [] }));
    expect(text).not.toContain('Recent Crosses');
  });

  it('value が null の場合は n/a を表示', () => {
    const text = buildSmaSnapshotText(makeInput({
      maLines: [makeMaLine({ value: null, distancePct: null, distanceAbs: null })],
    }));
    expect(text).toContain('n/a');
  });

  it('pricePosition=below の場合は「価格は下」を表示', () => {
    const text = buildSmaSnapshotText(makeInput({
      maLines: [makeMaLine({ pricePosition: 'below' })],
    }));
    expect(text).toContain('（価格は下）');
  });

  it('フッターに補完ツール情報を含む', () => {
    const text = buildSmaSnapshotText(makeInput());
    expect(text).toContain('📌 含まれるもの:');
    expect(text).toContain('analyze_indicators');
  });
});
