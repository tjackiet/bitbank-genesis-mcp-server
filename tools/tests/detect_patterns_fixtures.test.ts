import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../analyze_indicators.js', () => ({
  default: vi.fn(),
}));

import analyzeIndicators from '../analyze_indicators.js';
import detectPatterns from '../detect_patterns.js';

type Candle = {
  isoTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function makeIso(dayOffset: number, year = 2026) {
  return new Date(Date.UTC(year, 0, 1 + dayOffset, 0, 0, 0)).toISOString();
}

function makeCandle(dayOffset: number, close: number, year = 2026): Candle {
  return {
    isoTime: makeIso(dayOffset, year),
    open: close,
    high: close + 3,
    low: close - 3,
    close,
    volume: 100,
  };
}

function indicatorsOk(candles: Candle[]) {
  return {
    ok: true,
    summary: 'ok',
    data: {
      chart: {
        candles,
      },
    },
  };
}

function buildCompletedDoubleTopCandles(year = 2026): Candle[] {
  const closes = [
    100, 102, 105, 110, 118, 130, 126, 122, 118, 114, 112, 110,
    114, 118, 122, 126, 128, 129, 123, 116, 104, 100, 95, 100,
    99, 98,
  ];

  return closes.map((close, index) => makeCandle(index, close, year));
}

function buildFormingDoubleBottomCandles(year = 2026): Candle[] {
  const closes = [
    108, 104, 99, 92, 80, 84, 88, 92, 96, 99, 101, 98,
    94, 89, 85, 82, 81, 84, 88, 91, 94, 95, 96, 95,
  ];

  return closes.map((close, index) => makeCandle(index, close, year));
}

describe('detect_patterns fixtures', () => {
  const mockedAnalyzeIndicators = vi.mocked(analyzeIndicators);

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('synthetic fixture から completed の double_top を検出できる', async () => {
    mockedAnalyzeIndicators.mockResolvedValueOnce(
      indicatorsOk(buildCompletedDoubleTopCandles()) as any
    );

    const res: any = await detectPatterns('btc_jpy', '1day', 26, {
      patterns: ['double_top'],
      swingDepth: 2,
      tolerancePct: 0.02,
      includeCompleted: true,
      includeForming: false,
    });
    expect(res.ok).toBe(true);
    expect(res.data.patterns).toHaveLength(1);
    expect(res.data.patterns[0]).toMatchObject({
      type: 'double_top',
      timeframe: '1day',
      timeframeLabel: '日足',
      trendlineLabel: 'ネックライン',
      breakoutBarIndex: 20,
      targetMethod: 'neckline_projection',
      aftermath: {
        breakoutConfirmed: true,
      },
    });
    expect(res.data.overlays.ranges).toEqual([
      {
        start: makeIso(5),
        end: makeIso(20),
        label: 'double_top',
      },
    ]);
    expect(res.meta.count).toBe(1);
  });

  it('synthetic fixture から forming の double_bottom を completed なしで返せる', async () => {
    mockedAnalyzeIndicators.mockResolvedValueOnce(
      indicatorsOk(buildFormingDoubleBottomCandles()) as any
    );

    const res: any = await detectPatterns('btc_jpy', '1day', 24, {
      patterns: ['double_bottom'],
      swingDepth: 2,
      tolerancePct: 0.03,
      includeForming: true,
      includeCompleted: false,
    });

    expect(res.ok).toBe(true);
    expect(res.data.patterns).toHaveLength(1);
    expect(res.data.patterns[0]).toMatchObject({
      type: 'double_bottom',
      status: 'forming',
      timeframe: '1day',
      timeframeLabel: '日足',
      trendlineLabel: 'ネックライン',
      completionPct: expect.any(Number),
      targetMethod: 'neckline_projection',
    });
    expect(res.data.patterns[0].range.end).toBe(makeIso(23));
    expect(res.meta.count).toBe(1);
  });

  it('requireCurrentInPattern=true のとき古い fixture は除外される', async () => {
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
    mockedAnalyzeIndicators.mockResolvedValueOnce(
      indicatorsOk(buildCompletedDoubleTopCandles(2025)) as any
    );

    const res: any = await detectPatterns('btc_jpy', '1day', 26, {
      patterns: ['double_top'],
      swingDepth: 2,
      tolerancePct: 0.02,
      requireCurrentInPattern: true,
      currentRelevanceDays: 7,
    });

    expect(res.ok).toBe(true);
    expect(res.data.patterns).toEqual([]);
    expect(res.data.overlays.ranges).toEqual([]);
    expect(res.meta.count).toBe(0);
  });
});
