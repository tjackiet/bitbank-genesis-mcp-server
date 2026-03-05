import { afterEach, describe, expect, it, vi } from 'vitest';
import analyzeSmaSnapshot from '../analyze_sma_snapshot.js';
import { clearIndicatorCache } from '../analyze_indicators.js';

type OhlcvRow = [string, string, string, string, string, string];

/** 上昇トレンドの OHLCV を生成（短期 SMA > 長期 SMA になる） */
function makeUptrend(count: number): OhlcvRow[] {
  const startMs = Date.UTC(2024, 0, 1);
  const rows: OhlcvRow[] = [];
  for (let i = 0; i < count; i++) {
    const base = 10_000_000 + i * 50_000;
    rows.push([
      String(base),
      String(base + 2_000),
      String(base - 2_000),
      String(base),
      '1.0',
      String(startMs + i * 86_400_000),
    ]);
  }
  return rows;
}

describe('analyze_sma_snapshot', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearIndicatorCache();
  });

  it('alignment は固定 25/75/200 ではなく指定 periods（5/20/50）で判定されるべき', async () => {
    const rows = makeUptrend(300);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: 1, data: { candlestick: [{ type: '1day', ohlcv: rows }] } }),
    }) as unknown as typeof fetch;

    const res: any = await analyzeSmaSnapshot('btc_jpy', '1day', 220, [5, 20, 50]);
    expect(res.ok).toBe(true);
    expect(res.data.alignment).toBe('bullish');
  });

  it('指定 periods が強気整列なら sma_bullish_alignment タグが付与されるべき', async () => {
    const rows = makeUptrend(300);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ success: 1, data: { candlestick: [{ type: '1day', ohlcv: rows }] } }),
    }) as unknown as typeof fetch;

    const res: any = await analyzeSmaSnapshot('btc_jpy', '1day', 220, [5, 20, 50]);
    expect(res.ok).toBe(true);
    expect(res.data.tags).toContain('sma_bullish_alignment');
  });
});
