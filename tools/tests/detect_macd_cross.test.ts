import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../analyze_indicators.js', () => ({
  default: vi.fn(),
}));

import analyzeIndicators from '../analyze_indicators.js';
import { toolDef } from '../detect_macd_cross.js';
import { dayjs } from '../../lib/datetime.js';

type AnalyzeIndicatorsOk = {
  ok: true;
  summary: string;
  data: {
    normalized: Array<{ isoTime: string; close: number }>;
    indicators: {
      macd_series: {
        line: number[];
        signal: number[];
        hist: number[];
      };
    };
  };
  meta: { pair: string; type: '1day'; count: number };
};

function makeCandles(closeSeries: number[], crossDates: Record<number, string> = {}) {
  return closeSeries.map((close, i) => ({
    close,
    isoTime: crossDates[i] ?? dayjs().subtract(closeSeries.length - 1 - i, 'day').toISOString(),
  }));
}

function buildAnalyzeIndicatorsOk(args: {
  pair: string;
  line: number[];
  signal: number[];
  hist?: number[];
  closeSeries?: number[];
  crossDates?: Record<number, string>;
}): AnalyzeIndicatorsOk {
  const { pair, line, signal } = args;
  const hist = args.hist ?? line.map((value, i) => Number((value - (signal[i] ?? 0)).toFixed(4)));
  const closeSeries = args.closeSeries ?? Array.from({ length: line.length }, (_, i) => 100 + i);

  return {
    ok: true,
    summary: 'ok',
    data: {
      normalized: makeCandles(closeSeries, args.crossDates),
      indicators: {
        macd_series: { line, signal, hist },
      },
    },
    meta: { pair, type: '1day', count: line.length },
  };
}

describe('detect_macd_cross', () => {
  const mockedAnalyzeIndicators = vi.mocked(analyzeIndicators);

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('inputSchema: lookback は 1 未満を拒否する', () => {
    const parse = () => (toolDef.inputSchema as any).parse({ lookback: 0 });
    expect(parse).toThrow();
  });

  it('crossed_recently は直近3本で最も新しいクロスを返すべき', async () => {
    const line = [0.4, 0.5, 0.6, 0.6, 0.7, 0.7, 0.8, 0.8, 0.9, 0.9, 1.0, 1.0, 0.9, 0.8, -0.7, 0.5, -0.2, 0.2, -0.1, 0.1];
    const signal = Array.from({ length: line.length }, () => 0);

    mockedAnalyzeIndicators.mockResolvedValueOnce(
      buildAnalyzeIndicatorsOk({
        pair: 'btc_jpy',
        line,
        signal,
        hist: line,
        crossDates: {
          16: '2026-02-16T00:00:00.000Z',
          17: '2026-02-17T00:00:00.000Z',
          18: '2026-02-18T00:00:00.000Z',
          19: '2026-02-19T00:00:00.000Z',
        },
      }) as any
    );

    const res: any = await toolDef.handler({
      pair: 'btc_jpy',
      includeForming: true,
      includeStats: false,
    });

    expect(res.ok).toBe(true);
    expect(res.data.forming.status).toBe('crossed_recently');
    expect(res.data.forming.lastCrossType).toBe('golden');
    expect(res.data.forming.lastCrossBarsAgo).toBe(0);
    expect(res.data.forming.lastCrossDate).toBe('2026-02-19T00:00:00.000Z');
  });

  it('screen.sortBy=date は barsAgo ではなく crossDate で並べるべき', async () => {
    mockedAnalyzeIndicators.mockImplementation(async (pair: string) => {
      if (pair === 'btc_jpy') {
        return buildAnalyzeIndicatorsOk({
          pair,
          line: [0, 0, 0, 0, -1, 1],
          signal: [0, 0, 0, 0, 0, 0],
          crossDates: {
            5: '2025-01-01T00:00:00.000Z',
          },
        }) as any;
      }

      if (pair === 'eth_jpy') {
        return buildAnalyzeIndicatorsOk({
          pair,
          line: [0, 0, -1, 1, 2, 3],
          signal: [0, 0, 0, 0, 0, 0],
          crossDates: {
            3: '2025-02-01T00:00:00.000Z',
          },
        }) as any;
      }

      throw new Error(`unexpected pair: ${pair}`);
    });

    const res: any = await toolDef.handler({
      pairs: ['btc_jpy', 'eth_jpy'],
      lookback: 5,
      screen: {
        sortBy: 'date',
        sortOrder: 'desc',
      },
    });

    expect(res.ok).toBe(true);
    expect(res.data.results.map((item: any) => item.pair)).toEqual(['eth_jpy', 'btc_jpy']);
  });
});
