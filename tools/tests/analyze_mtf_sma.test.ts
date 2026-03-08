import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../analyze_sma_snapshot.js', () => ({
  default: vi.fn(),
}));

import analyzeSmaSnapshot from '../analyze_sma_snapshot.js';
import analyzeMtfSma, { toolDef } from '../analyze_mtf_sma.js';

describe('analyze_mtf_sma', () => {
  const mockedAnalyzeSmaSnapshot = vi.mocked(analyzeSmaSnapshot);

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('inputSchema: timeframes は 1 件以上のみ許可するべき', () => {
    const parse = () => (toolDef.inputSchema as any).parse({ pair: 'btc_jpy', timeframes: [], periods: [25, 75, 200] });
    expect(parse).toThrow();
  });

  it('requested timeframe に unknown が含まれる場合 confluence は aligned=false / direction=unknown であるべき', async () => {
    mockedAnalyzeSmaSnapshot
      .mockResolvedValueOnce({
        ok: true,
        summary: 'ok',
        data: {
          alignment: 'bullish',
          summary: { position: 'above_all' },
          latest: { close: 100 },
          sma: { SMA_25: 90, SMA_75: 80, SMA_200: 70 },
          smas: {},
          crosses: [],
          recentCrosses: [],
          tags: ['sma_bullish_alignment'],
        },
        meta: {},
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        summary: 'ok',
        data: {
          alignment: 'unknown',
          summary: { position: 'unknown' },
          latest: { close: 100 },
          sma: { SMA_25: null, SMA_75: null, SMA_200: null },
          smas: {},
          crosses: [],
          recentCrosses: [],
          tags: [],
        },
        meta: {},
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        summary: 'ok',
        data: {
          alignment: 'bullish',
          summary: { position: 'above_all' },
          latest: { close: 100 },
          sma: { SMA_25: 90, SMA_75: 80, SMA_200: 70 },
          smas: {},
          crosses: [],
          recentCrosses: [],
          tags: ['sma_bullish_alignment'],
        },
        meta: {},
      } as any);

    const res: any = await analyzeMtfSma('btc_jpy', ['1hour', '4hour', '1day'], [25, 75, 200]);

    expect(res.ok).toBe(true);
    expect(res.data.confluence.aligned).toBe(false);
    expect(res.data.confluence.direction).toBe('unknown');
  });

  it('重複 timeframes 指定時は analyze_sma_snapshot を重複実行しないべき', async () => {
    mockedAnalyzeSmaSnapshot.mockResolvedValue({
      ok: true,
      summary: 'ok',
      data: {
        alignment: 'bullish',
        summary: { position: 'above_all' },
        latest: { close: 100 },
        sma: { SMA_25: 90, SMA_75: 80, SMA_200: 70 },
        smas: {},
        crosses: [],
        recentCrosses: [],
        tags: ['sma_bullish_alignment'],
      },
      meta: {},
    } as any);

    const res: any = await analyzeMtfSma('btc_jpy', ['1hour', '1hour', '4hour'], [25, 75, 200]);

    expect(res.ok).toBe(true);
    expect(mockedAnalyzeSmaSnapshot).toHaveBeenCalledTimes(2);
  });
});
