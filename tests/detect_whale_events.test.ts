import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../tools/get_depth.js', () => ({
  default: vi.fn(),
}));

vi.mock('../tools/get_candles.js', () => ({
  default: vi.fn(),
}));

import getDepth from '../tools/get_depth.js';
import getCandles from '../tools/get_candles.js';
import detectWhaleEvents, { toolDef } from '../tools/detect_whale_events.js';

function depthOk(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    summary: 'depth ok',
    data: {
      asks: [
        [101, 0.8],
        [102, 1.2],
      ],
      bids: [
        [99, 1.1],
        [98, 0.9],
      ],
      ...overrides,
    },
    meta: {},
  };
}

function candlesOk(normalized: Array<Record<string, unknown>>) {
  return {
    ok: true,
    summary: 'candles ok',
    data: {
      normalized,
    },
    meta: {},
  };
}

describe('detect_whale_events', () => {
  const mockedGetDepth = vi.mocked(getDepth);
  const mockedGetCandles = vi.mocked(getCandles);

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('inputSchema: lookback は定義済み enum のみ許可する', () => {
    const parse = () => (toolDef.inputSchema as any).parse({ pair: 'btc_jpy', lookback: '3hour' });
    expect(parse).toThrow();
  });

  it('上流で asks/bids が欠損している場合は fail を返すべき', async () => {
    mockedGetDepth.mockResolvedValueOnce(
      {
        ok: true,
        summary: 'depth ok',
        data: {},
        meta: {},
      } as any
    );
    mockedGetCandles.mockResolvedValueOnce(
      candlesOk([
        { close: 100 },
        { close: 105 },
      ]) as any
    );

    const res: any = await detectWhaleEvents('btc_jpy', '1hour', 0.51);

    expect(res.ok).toBe(false);
    expect(res.meta?.errorType).toBe('upstream');
  });

  it('ローソク足の close が欠損していても summary に NaN を出すべきではない', async () => {
    mockedGetDepth.mockResolvedValueOnce(depthOk() as any);
    mockedGetCandles.mockResolvedValueOnce(
      candlesOk([
        {},
        { close: 105 },
      ]) as any
    );

    const res: any = await detectWhaleEvents('btc_jpy', '1hour', 0.52);

    expect(res.ok).toBe(true);
    expect(res.summary).not.toContain('NaN');
  });
});
