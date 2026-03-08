import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../get_tickers_jpy.js', () => ({
  default: vi.fn(),
}));

vi.mock('../analyze_indicators.js', () => ({
  default: vi.fn(),
}));

import getTickersJpy from '../get_tickers_jpy.js';
import analyzeIndicators from '../analyze_indicators.js';
import analyzeCurrencyStrength, { toolDef } from '../analyze_currency_strength.js';

type MockTicker = {
  pair: string;
  last: string;
  open: string;
  vol: string;
  change24hPct?: number | null;
};

function makeTicker(pair: string, last: number, open: number, vol: number, change24hPct?: number | null): MockTicker {
  return {
    pair,
    last: String(last),
    open: String(open),
    vol: String(vol),
    change24hPct,
  };
}

function tickersOk(data: MockTicker[]) {
  return {
    ok: true,
    summary: 'ok',
    data,
    meta: { count: data.length },
  };
}

function indicatorsOk(rsi: number, sma25: number, latestClose: number) {
  return {
    ok: true,
    summary: 'ok',
    data: {
      indicators: {
        RSI_14: rsi,
        SMA_25: sma25,
      },
      normalized: [
        { close: latestClose, isoTime: '2024-01-01T00:00:00.000Z' },
      ],
    },
    meta: { pair: 'btc_jpy', type: '1day', count: 1 },
  };
}

describe('analyze_currency_strength', () => {
  const mockedGetTickersJpy = vi.mocked(getTickersJpy);
  const mockedAnalyzeIndicators = vi.mocked(analyzeIndicators);

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('inputSchema: topN は 3 以上のみ許可する', () => {
    const parse = () => (toolDef.inputSchema as any).parse({ topN: 2, type: '1day' });
    expect(parse).toThrow();
  });

  it('正常系: 出来高上位 N 件をスコア順にランキングする', async () => {
    mockedGetTickersJpy.mockResolvedValueOnce(
      tickersOk([
        makeTicker('btc_jpy', 100, 95, 20, 5),
        makeTicker('eth_jpy', 80, 79, 15, 1.27),
        makeTicker('xrp_jpy', 50, 52, 8, -3.85),
      ]) as any
    );
    mockedAnalyzeIndicators
      .mockResolvedValueOnce(indicatorsOk(75, 90, 100) as any)
      .mockResolvedValueOnce(indicatorsOk(55, 79, 80) as any)
      .mockResolvedValueOnce(indicatorsOk(35, 55, 50) as any);

    const res: any = await analyzeCurrencyStrength(3, '1day');

    expect(res.ok).toBe(true);
    expect(res.data.rankings).toHaveLength(3);
    expect(res.data.rankings.map((item: any) => item.rank)).toEqual([1, 2, 3]);
    expect(res.data.summary.analyzedPairs).toBe(3);
  });

  it('重複 pair が含まれる場合は同一銘柄を重複ランキングしないべき', async () => {
    mockedGetTickersJpy.mockResolvedValueOnce(
      tickersOk([
        makeTicker('btc_jpy', 100, 95, 20, 5),
        makeTicker('btc_jpy', 100, 95, 18, 5),
        makeTicker('eth_jpy', 80, 79, 15, 1.27),
        makeTicker('xrp_jpy', 50, 52, 8, -3.85),
      ]) as any
    );
    mockedAnalyzeIndicators
      .mockResolvedValueOnce(indicatorsOk(75, 90, 100) as any)
      .mockResolvedValueOnce(indicatorsOk(75, 90, 100) as any)
      .mockResolvedValueOnce(indicatorsOk(55, 79, 80) as any);

    const res: any = await analyzeCurrencyStrength(3, '1day');

    expect(res.ok).toBe(true);
    expect(new Set(res.data.rankings.map((item: any) => item.pair)).size).toBe(res.data.rankings.length);
  });

  it('全銘柄で analyze_indicators が失敗した場合は成功扱いにしないべき', async () => {
    mockedGetTickersJpy.mockResolvedValueOnce(
      tickersOk([
        makeTicker('btc_jpy', 100, 95, 20, 5),
        makeTicker('eth_jpy', 80, 79, 15, 1.27),
        makeTicker('xrp_jpy', 50, 52, 8, -3.85),
      ]) as any
    );
    mockedAnalyzeIndicators
      .mockResolvedValueOnce({ ok: false, summary: 'failed', data: {}, meta: { errorType: 'upstream' } } as any)
      .mockResolvedValueOnce({ ok: false, summary: 'failed', data: {}, meta: { errorType: 'upstream' } } as any)
      .mockResolvedValueOnce({ ok: false, summary: 'failed', data: {}, meta: { errorType: 'upstream' } } as any);

    const res: any = await analyzeCurrencyStrength(3, '1day');

    expect(res.ok).toBe(false);
    expect(res.meta?.errorType).toBe('upstream');
  });
});
