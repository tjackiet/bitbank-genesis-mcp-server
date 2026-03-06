import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../analyze_indicators.js', () => ({
  default: vi.fn(),
}));

import analyzeIndicators from '../analyze_indicators.js';
import analyzeSmaSnapshot, { toolDef } from '../analyze_sma_snapshot.js';

function makeSeries(start: number, step: number, len: number) {
  return Array.from({ length: len }, (_, i) => Number((start + step * i).toFixed(2)));
}

function buildIndicatorsOk() {
  const len = 40;
  return {
    ok: true as const,
    summary: 'ok',
    data: {
      normalized: Array.from({ length: len }, (_, i) => ({
        close: i === len - 1 ? 140 : 120,
        isoTime: `2024-01-${String((i % 30) + 1).padStart(2, '0')}T00:00:00.000Z`,
      })),
      indicators: {
        SMA_5: 130,
        SMA_20: 120,
        SMA_50: 110,
      },
      chart: {
        candles: Array.from({ length: len }, (_, i) => ({
          isoTime: `2024-01-${String((i % 30) + 1).padStart(2, '0')}T00:00:00.000Z`,
        })),
        indicators: {
          SMA_5: makeSeries(126, 0.2, len),
          SMA_20: makeSeries(118, 0.15, len),
          SMA_50: makeSeries(108, 0.1, len),
        },
      },
    },
    meta: { pair: 'btc_jpy', type: '1day', count: len },
  };
}

describe('analyze_sma_snapshot', () => {
  const mockedAnalyzeIndicators = vi.mocked(analyzeIndicators);

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('inputSchema: limit は 200 以上のみ許可する', () => {
    const parse = () => (toolDef.inputSchema as any).parse({ pair: 'btc_jpy', type: '1day', limit: 199 });
    expect(parse).toThrow();
  });

  it('analyze_indicators が失敗を返した場合は ok: false を返す', async () => {
    mockedAnalyzeIndicators.mockResolvedValueOnce({
      ok: false,
      summary: 'indicators failed',
      data: {},
      meta: { errorType: 'upstream' },
    } as any);

    const res: any = await analyzeSmaSnapshot('btc_jpy', '1day', 220, [25, 75, 200]);
    expect(res.ok).toBe(false);
    expect(res.meta.errorType).toBe('upstream');
  });

  it('alignment は固定 25/75/200 ではなく指定 periods（5/20/50）で判定されるべき', async () => {
    mockedAnalyzeIndicators.mockResolvedValueOnce(buildIndicatorsOk() as any);

    const res: any = await analyzeSmaSnapshot('btc_jpy', '1day', 220, [5, 20, 50]);

    expect(res.ok).toBe(true);
    expect(res.data.alignment).toBe('bullish');
  });

  it('指定 periods が強気整列なら sma_bullish_alignment タグが付与されるべき', async () => {
    mockedAnalyzeIndicators.mockResolvedValueOnce(buildIndicatorsOk() as any);

    const res: any = await analyzeSmaSnapshot('btc_jpy', '1day', 220, [5, 20, 50]);

    expect(res.ok).toBe(true);
    expect(res.data.tags).toContain('sma_bullish_alignment');
  });

  it('periods が1つだけの場合 alignment は unknown（整列判定しない）であるべき', async () => {
    mockedAnalyzeIndicators.mockResolvedValueOnce(buildIndicatorsOk() as any);

    const res: any = await analyzeSmaSnapshot('btc_jpy', '1day', 220, [5]);

    expect(res.ok).toBe(true);
    expect(res.data.alignment).toBe('unknown');
    expect(res.data.tags).not.toContain('sma_bullish_alignment');
    expect(res.data.tags).not.toContain('sma_bearish_alignment');
  });

  it('重複 periods 指定時は自己クロス（SMA_5/SMA_5）や重複クロスを出さないべき', async () => {
    mockedAnalyzeIndicators.mockResolvedValueOnce(buildIndicatorsOk() as any);

    const res: any = await analyzeSmaSnapshot('btc_jpy', '1day', 220, [5, 5, 20]);

    expect(res.ok).toBe(true);
    const pairLabels = res.data.crosses.map((c: any) => `${c.a}/${c.b}`);
    expect(pairLabels).not.toContain('SMA_5/SMA_5');
    expect(new Set(pairLabels).size).toBe(pairLabels.length);
  });
});
