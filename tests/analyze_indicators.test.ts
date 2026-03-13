import { afterEach, describe, expect, it, vi } from 'vitest';
import analyzeIndicators, { clearIndicatorCache } from '../tools/analyze_indicators.js';
import { toolDef } from '../src/handlers/analyzeIndicatorsHandler.js';

type OhlcvRow = [string, string, string, string, string, string];

function makeOhlcvRows(count: number): OhlcvRow[] {
  const startMs = Date.UTC(2024, 0, 1);
  const rows: OhlcvRow[] = [];
  for (let i = 0; i < count; i++) {
    const base = 10_000_000 + i * 1_000;
    rows.push([
      String(base),
      String(base + 2_000),
      String(base - 2_000),
      String(base + 500),
      '1.5',
      String(startMs + i * 86_400_000),
    ]);
  }
  return rows;
}

describe('analyze_indicators', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearIndicatorCache();
  });

  it('inputSchema: limit は 1 以上のみ許可する', () => {
    const parse = () => (toolDef.inputSchema as any).parse({ pair: 'btc_jpy', type: '1day', limit: 0 });
    expect(parse).toThrow();
  });

  it('正常系: 指標データとチャート時系列を返す', async () => {
    const rows = makeOhlcvRows(600);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: 1, data: { candlestick: [{ type: '1day', ohlcv: rows }] } }),
    }) as unknown as typeof fetch;

    const res: any = await analyzeIndicators('btc_jpy', '1day', 60);
    expect(res.ok).toBe(true);
    expect(res.data.indicators).toHaveProperty('RSI_14');
    expect(Array.isArray(res.data.chart.candles)).toBe(true);
    expect(Array.isArray(res.data.chart.indicators.SMA_25)).toBe(true);
  });

  it('全取得失敗時は errorType=network を返すべき（現状 user 扱い）', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

    const res: any = await analyzeIndicators('btc_jpy', '1day', 1000);
    expect(res.ok).toBe(false);
    expect(res.meta?.errorType).toBe('network');
  });

  it('キャッシュ利用時も limit に応じた requiredCount と summary を返すべき', async () => {
    const rows = makeOhlcvRows(600);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: 1, data: { candlestick: [{ type: '1day', ohlcv: rows }] } }),
    }) as unknown as typeof fetch;

    const first: any = await analyzeIndicators('btc_jpy', '1day', 200);
    expect(first.ok).toBe(true);
    expect(first.meta.requiredCount).toBe(399);

    const second: any = await analyzeIndicators('btc_jpy', '1day', 50);
    expect(second.ok).toBe(true);
    expect(second.meta.requiredCount).toBe(249);
    expect(second.summary).toContain('直近50本');
  });
});
