import { describe, it, expect } from 'vitest';
import { buildStochSnapshotText, type BuildStochSnapshotTextInput } from '../tools/analyze_stoch_snapshot.js';

function makeInput(overrides?: Partial<BuildStochSnapshotTextInput>): BuildStochSnapshotTextInput {
  return {
    baseSummary: 'BTC/JPY %K=25.3 %D=30.1 zone=neutral',
    kStr: '25.3',
    dStr: '30.1',
    zoneJp: '中立圏',
    kPeriod: 14,
    smoothK: 3,
    smoothD: 3,
    crossDesc: 'なし',
    divType: 'none',
    divDesc: '',
    recentCrosses: [],
    ...overrides,
  };
}

describe('buildStochSnapshotText', () => {
  it('基本出力: baseSummary + %K・%D・ゾーンを含む', () => {
    const text = buildStochSnapshotText(makeInput());
    expect(text).toContain('BTC/JPY %K=25.3');
    expect(text).toContain('%K: 25.3');
    expect(text).toContain('%D: 30.1');
    expect(text).toContain('ゾーン: 中立圏');
  });

  it('パラメータが含まれる', () => {
    const text = buildStochSnapshotText(makeInput());
    expect(text).toContain('パラメータ: (14, 3, 3)');
  });

  it('クロス情報が含まれる', () => {
    const text = buildStochSnapshotText(makeInput({ crossDesc: '%Kが%Dを上抜け' }));
    expect(text).toContain('クロス: %Kが%Dを上抜け');
  });

  it('ダイバージェンスありの場合に表示', () => {
    const text = buildStochSnapshotText(makeInput({
      divType: 'bullish',
      divDesc: 'ブルリッシュ（価格↓・%K↑）',
    }));
    expect(text).toContain('ダイバージェンス: ブルリッシュ');
  });

  it('ダイバージェンスなしの場合はダイバージェンス行なし', () => {
    const text = buildStochSnapshotText(makeInput({ divType: 'none' }));
    expect(text).not.toContain('ダイバージェンス:');
  });

  it('recentCrosses がある場合に Recent Crosses セクション表示', () => {
    const text = buildStochSnapshotText(makeInput({
      recentCrosses: [{
        type: 'bullish_cross',
        barsAgo: 3,
        date: '2025-01-10',
        zone: 'oversold',
      }],
    }));
    expect(text).toContain('Recent Crosses:');
    expect(text).toContain('↑ bullish_cross');
    expect(text).toContain('売られすぎ圏');
  });

  it('overbought zone のラベルが正しい', () => {
    const text = buildStochSnapshotText(makeInput({
      recentCrosses: [{
        type: 'bearish_cross',
        barsAgo: 2,
        date: '2025-01-11',
        zone: 'overbought',
      }],
    }));
    expect(text).toContain('↓ bearish_cross');
    expect(text).toContain('買われすぎ圏');
  });

  it('recentCrosses が空の場合は Recent Crosses 非表示', () => {
    const text = buildStochSnapshotText(makeInput({ recentCrosses: [] }));
    expect(text).not.toContain('Recent Crosses:');
  });

  it('フッターに補完ツール情報を含む', () => {
    const text = buildStochSnapshotText(makeInput());
    expect(text).toContain('📌 含まれるもの:');
    expect(text).toContain('analyze_indicators');
  });
});
