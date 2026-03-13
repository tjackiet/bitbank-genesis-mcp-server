import { describe, it, expect } from 'vitest';
import {
  buildMacdScreenText,
  buildMacdSingleText,
  type BuildMacdScreenTextInput,
  type BuildMacdSingleTextInput,
  type MacdScreenCross,
} from '../tools/detect_macd_cross.js';

function makeCross(overrides?: Partial<MacdScreenCross>): MacdScreenCross {
  return {
    pair: 'btc_jpy',
    type: 'golden',
    crossDate: '2025-01-10T00:00:00Z',
    barsAgo: 3,
    macdAtCross: 150.5,
    signalAtCross: 148.2,
    histogramDelta: 2.3,
    returnSinceCrossPct: 1.5,
    prevCross: { type: 'dead', barsAgo: 20 },
    ...overrides,
  };
}

function makeScreenInput(overrides?: Partial<BuildMacdScreenTextInput>): BuildMacdScreenTextInput {
  return {
    baseSummary: 'MACD cross screen: 3 crosses found',
    crosses: [makeCross()],
    includeForming: false,
    includeStats: false,
    ...overrides,
  };
}

function makeSingleInput(overrides?: Partial<BuildMacdSingleTextInput>): BuildMacdSingleTextInput {
  return {
    pair: 'btc_jpy',
    lastClose: 15000000,
    forming: null,
    statistics: null,
    history: null,
    historyDays: 180,
    includeForming: true,
    includeStats: false,
    ...overrides,
  };
}

describe('buildMacdScreenText', () => {
  it('基本出力: baseSummary + クロス件数を含む', () => {
    const text = buildMacdScreenText(makeScreenInput());
    expect(text).toContain('MACD cross screen: 3 crosses found');
    expect(text).toContain('全1件のクロス詳細');
  });

  it('クロス詳細行にペア・type・日付・barsAgo が含まれる', () => {
    const text = buildMacdScreenText(makeScreenInput());
    expect(text).toContain('[0] btc_jpy golden @2025-01-10');
    expect(text).toContain('barsAgo:3');
    expect(text).toContain('macd:150.5');
    expect(text).toContain('sig:148.2');
  });

  it('histogramDelta と returnSinceCrossPct が含まれる', () => {
    const text = buildMacdScreenText(makeScreenInput());
    expect(text).toContain('histDelta:2.3');
    expect(text).toContain('ret:+1.5%');
  });

  it('prevCross 情報が含まれる', () => {
    const text = buildMacdScreenText(makeScreenInput());
    expect(text).toContain('prev:dead(20bars)');
  });

  it('prevCross が null の場合は prev: を含まない', () => {
    const text = buildMacdScreenText(makeScreenInput({
      crosses: [makeCross({ prevCross: null })],
    }));
    expect(text).not.toContain('prev:');
  });

  it('複数クロスのインデックスが正しい', () => {
    const text = buildMacdScreenText(makeScreenInput({
      crosses: [makeCross(), makeCross({ pair: 'eth_jpy', type: 'dead' })],
    }));
    expect(text).toContain('[0] btc_jpy golden');
    expect(text).toContain('[1] eth_jpy dead');
    expect(text).toContain('全2件');
  });

  it('フッターに補完ツール情報を含む', () => {
    const text = buildMacdScreenText(makeScreenInput());
    expect(text).toContain('📌 含まれるもの: MACDクロス検出');
    expect(text).toContain('analyze_indicators');
  });
});

describe('buildMacdSingleText', () => {
  it('基本出力: ペア名と価格を含む', () => {
    const text = buildMacdSingleText(makeSingleInput());
    expect(text).toContain('BTC_JPY close=15,000,000円');
  });

  it('forming なしの場合はクロス形成の兆候なしと表示', () => {
    const text = buildMacdSingleText(makeSingleInput({ forming: null }));
    expect(text).not.toContain('クロス形成中');
  });

  it('forming_golden の場合にゴールデンクロス形成中を表示', () => {
    const text = buildMacdSingleText(makeSingleInput({
      forming: {
        status: 'forming_golden',
        estimatedCrossDays: 2,
        completion: 0.75,
        currentHistogram: -50,
        histogramTrend: [-100, -80, -60, -50, -40],
        currentMACD: 120,
        currentSignal: 170,
      },
    }));
    expect(text).toContain('ゴールデンクロス形成中: 完成度75%');
    expect(text).toContain('ヒストグラム:');
    expect(text).toContain('MACD:');
  });

  it('crossed_recently の場合にクロス発生を表示', () => {
    const text = buildMacdSingleText(makeSingleInput({
      forming: {
        status: 'crossed_recently',
        lastCrossDate: '2025-01-10T00:00:00Z',
        lastCrossBarsAgo: 2,
        lastCrossType: 'golden',
      },
    }));
    expect(text).toContain('ゴールデンクロス発生: 2025-01-10');
  });

  it('フッターに補完ツール情報を含む', () => {
    const text = buildMacdSingleText(makeSingleInput());
    expect(text).toContain('📌 含まれるもの: MACD分析');
  });
});
