import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../tools/analyze_indicators.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../analyze_indicators.js')>();
  return {
    ...actual,
    default: vi.fn(),
  };
});

vi.mock('../tools/get_candles.js', () => ({
  default: vi.fn(),
}));

import analyzeIndicators from '../tools/analyze_indicators.js';
import getCandles from '../tools/get_candles.js';
import analyzeStochSnapshot, { toolDef } from '../tools/analyze_stoch_snapshot.js';

function makeFlatCandles(count: number, close = 100) {
  return Array.from({ length: count }, (_, i) => ({
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    isoTime: `2024-03-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
  }));
}

function buildIndicatorsOk(overrides?: Partial<{
  stochK: number | null;
  stochD: number | null;
  prevK: number | null;
  prevD: number | null;
  closes: number[];
}>) {
  const closes = overrides?.closes ?? Array.from({ length: 40 }, (_, i) => 100 + i);
  const candles = closes.map((close, i) => ({
    close,
    isoTime: `2024-02-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
  }));

  return {
    ok: true as const,
    summary: 'ok',
    data: {
      normalized: candles,
      indicators: {
        STOCH_K: overrides?.stochK ?? 55,
        STOCH_D: overrides?.stochD ?? 50,
        STOCH_prevK: overrides?.prevK ?? 45,
        STOCH_prevD: overrides?.prevD ?? 48,
        stoch_k_series: Array.from({ length: closes.length }, () => 50),
        stoch_d_series: Array.from({ length: closes.length }, () => 50),
      },
      chart: {
        candles,
      },
    },
    meta: { pair: 'btc_jpy', type: '1day', count: closes.length },
  };
}

describe('analyze_stoch_snapshot', () => {
  const mockedAnalyzeIndicators = vi.mocked(analyzeIndicators);
  const mockedGetCandles = vi.mocked(getCandles);

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('inputSchema: limit は 40 以上のみ許可する', () => {
    const parse = () => (toolDef.inputSchema as any).parse({ pair: 'btc_jpy', type: '1day', limit: 39 });
    expect(parse).toThrow();
  });

  it('analyze_indicators が失敗を返した場合は ok: false を返す', async () => {
    mockedAnalyzeIndicators.mockResolvedValueOnce({
      ok: false,
      summary: 'indicators failed',
      data: {},
      meta: { errorType: 'upstream' },
    } as any);

    const res: any = await analyzeStochSnapshot('btc_jpy', '1day', 120);

    expect(res.ok).toBe(false);
    expect(res.meta.errorType).toBe('upstream');
  });

  it('カスタムパラメータ時、必要最小本数ちょうどでも %K/%D を計算できるべき', async () => {
    mockedGetCandles.mockResolvedValueOnce({
      ok: true,
      summary: 'ok',
      data: {
        normalized: makeFlatCandles(17, 100),
        raw: {},
      },
      meta: { pair: 'btc_jpy', type: '1day', count: 17 },
    } as any);

    const res: any = await analyzeStochSnapshot('btc_jpy', '1day', 40, 14, 3, 2);

    expect(res.ok).toBe(true);
    expect(res.data.stoch.k).toBe(50);
    expect(res.data.stoch.d).toBe(50);
    expect(res.data.zone).toBe('neutral');
  });

  it('bullish cross が買われすぎ圏なら説明文はニュートラル圏ではなく現在ゾーンを反映するべき', async () => {
    mockedAnalyzeIndicators.mockResolvedValueOnce(buildIndicatorsOk({
      stochK: 85,
      stochD: 80,
      prevK: 70,
      prevD: 75,
    }) as any);

    const res: any = await analyzeStochSnapshot('btc_jpy', '1day', 120);

    expect(res.ok).toBe(true);
    expect(res.data.zone).toBe('overbought');
    expect(res.data.crossover.type).toBe('bullish_cross');
    expect(res.data.crossover.description).toContain('買われすぎ圏');
    expect(res.data.crossover.description).not.toContain('ニュートラル圏');
  });
});
