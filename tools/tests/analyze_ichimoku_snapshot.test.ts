import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../analyze_indicators.js', () => ({
  default: vi.fn(),
}));

import analyzeIndicators from '../analyze_indicators.js';
import analyzeIchimokuSnapshot, { toolDef } from '../analyze_ichimoku_snapshot.js';

function buildMockIndicatorSuccess() {
  const normalized = Array.from({ length: 40 }, (_, i) => ({
    close: i === 39 ? 80 : 120 - i,
  }));

  const spanA = Array.from({ length: 40 }, (_, i) => (i < 14 ? 130 : 100));
  const spanB = Array.from({ length: 40 }, (_, i) => (i < 14 ? 135 : 110));
  spanA[38] = 62;
  spanA[39] = 60;
  spanB[38] = 67;
  spanB[39] = 65;

  return {
    ok: true as const,
    summary: 'ok',
    data: {
      normalized,
      indicators: {
        ICHIMOKU_conversion: 90,
        ICHIMOKU_base: 95,
        ICHIMOKU_spanA: 60,
        ICHIMOKU_spanB: 65,
        ichi_series: {
          tenkan: Array.from({ length: 40 }, () => 90),
          kijun: Array.from({ length: 40 }, () => 95),
          spanA,
          spanB,
          chikou: Array.from({ length: 40 }, () => 70),
        },
      },
    },
    meta: { pair: 'btc_jpy', type: '1day', count: 40 },
  };
}

describe('analyze_ichimoku_snapshot', () => {
  const mockedAnalyzeIndicators = vi.mocked(analyzeIndicators);

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('inputSchema: lookback は 2 以上のみ許可する', () => {
    const parse = () => (toolDef.inputSchema as any).parse({ pair: 'btc_jpy', type: '1day', limit: 120, lookback: 1 });
    expect(parse).toThrow();
  });

  it('analyze_indicators が失敗を返した場合は ok: false を返す', async () => {
    mockedAnalyzeIndicators.mockResolvedValueOnce({
      ok: false,
      summary: 'indicators failed',
      data: {},
      meta: { errorType: 'upstream' },
    } as any);

    const res: any = await analyzeIchimokuSnapshot('btc_jpy', '1day', 120, 10);
    expect(res.ok).toBe(false);
    expect(res.meta.errorType).toBe('upstream');
  });

  it('toolDef.handler は lookback を analyzeIchimokuSnapshot に伝搬するべき', async () => {
    mockedAnalyzeIndicators.mockResolvedValueOnce(buildMockIndicatorSuccess() as any);

    const res: any = await toolDef.handler({
      pair: 'btc_jpy',
      type: '1day',
      limit: 120,
      lookback: 3,
    });

    expect(res.ok).toBe(true);
    expect(res.data.trend.cloudHistory).toHaveLength(3);
  });

  it('強い弱気条件（雲下 + 転換線<基準線 + 雲下降）では overallSignal は strong_bearish であるべき', async () => {
    mockedAnalyzeIndicators.mockResolvedValueOnce(buildMockIndicatorSuccess() as any);

    const res: any = await analyzeIchimokuSnapshot('btc_jpy', '1day', 120, 10);

    expect(res.ok).toBe(true);
    expect(res.data.assessment.pricePosition).toBe('below_cloud');
    expect(res.data.assessment.tenkanKijun).toBe('bearish');
    expect(res.data.assessment.cloudSlope).toBe('falling');
    expect(res.data.signals.overallSignal).toBe('strong_bearish');
  });
});
