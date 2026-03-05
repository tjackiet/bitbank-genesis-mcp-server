import { afterEach, describe, expect, it, vi } from 'vitest';
import analyzeBbSnapshot, { toolDef } from '../analyze_bb_snapshot.js';
import { clearIndicatorCache } from '../analyze_indicators.js';

type OhlcvRow = [string, string, string, string, string, string];

function makeFlatOhlcvRows(count: number, close: number = 10_000_000): OhlcvRow[] {
  const startMs = Date.UTC(2024, 0, 1);
  const rows: OhlcvRow[] = [];
  for (let i = 0; i < count; i++) {
    const ts = startMs + i * 86_400_000;
    rows.push([
      String(close),
      String(close),
      String(close),
      String(close),
      '1.0',
      String(ts),
    ]);
  }
  return rows;
}

function makeTrendingOhlcvRows(count: number): OhlcvRow[] {
  const startMs = Date.UTC(2024, 0, 1);
  const rows: OhlcvRow[] = [];
  for (let i = 0; i < count; i++) {
    const base = 10_000_000 + i * 10_000;
    rows.push([
      String(base),
      String(base + 2_000),
      String(base - 2_000),
      String(base + 1_000),
      '1.0',
      String(startMs + i * 86_400_000),
    ]);
  }
  return rows;
}

describe('analyze_bb_snapshot', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearIndicatorCache();
  });

  it('inputSchema: limit は 40 以上のみ許可する', () => {
    const parse = () => (toolDef.inputSchema as any).parse({ pair: 'btc_jpy', type: '1day', limit: 39 });
    expect(parse).toThrow();
  });

  it('正常系: default mode で BB の主要項目を返す', async () => {
    const rows = makeTrendingOhlcvRows(400);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: 1, data: { candlestick: [{ type: '1day', ohlcv: rows }] } }),
    }) as unknown as typeof fetch;

    const res: any = await analyzeBbSnapshot('btc_jpy', '1day', 120, 'default');
    expect(res.ok).toBe(true);
    expect(res.data.mode).toBe('default');
    expect(res.data.bb).toHaveProperty('zScore');
    expect(res.data.bb).toHaveProperty('bandWidthPct');
    expect(res.data).toHaveProperty('signals');
  });

  it('fetch 失敗時は ok: false を返す', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

    const res: any = await analyzeBbSnapshot('btc_jpy', '1day', 120, 'default');
    expect(res.ok).toBe(false);
  });

  it('フラット相場では current_vs_avg は NaN% ではなく 0.0% であるべき', async () => {
    const rows = makeFlatOhlcvRows(400, 10_000_000);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: 1, data: { candlestick: [{ type: '1day', ohlcv: rows }] } }),
    }) as unknown as typeof fetch;

    const res: any = await analyzeBbSnapshot('btc_jpy', '1day', 120, 'default');
    expect(res.ok).toBe(true);
    expect(res.data.context.current_vs_avg).toBe('0.0%');
  });

  it('フラット相場では high volatility シグナルを出すべきではない', async () => {
    const rows = makeFlatOhlcvRows(400, 10_000_000);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: 1, data: { candlestick: [{ type: '1day', ohlcv: rows }] } }),
    }) as unknown as typeof fetch;

    const res: any = await analyzeBbSnapshot('btc_jpy', '1day', 120, 'default');
    expect(res.ok).toBe(true);
    expect(res.data.signals).not.toContain('Band width expanded (100th percentile) - high volatility phase');
  });
});
