import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../tools/get_transactions.js', () => ({
  default: vi.fn(),
}));

import getTransactions from '../tools/get_transactions.js';
import analyzeVolumeProfile, { toolDef } from '../tools/analyze_volume_profile.js';

type MockTx = {
  price: number;
  amount: number;
  side: 'buy' | 'sell';
  timestampMs: number;
  isoTime: string;
};

function buildTxs(prices: number[], amounts?: number[]): MockTx[] {
  const baseMs = Date.UTC(2024, 0, 1, 0, 0, 0);
  return prices.map((price, i) => ({
    price,
    amount: amounts?.[i] ?? i + 1,
    side: i % 2 === 0 ? 'buy' : 'sell',
    timestampMs: baseMs + i * 60_000,
    isoTime: new Date(baseMs + i * 60_000).toISOString(),
  }));
}

function mockTxResult(txs: MockTx[]) {
  return {
    ok: true,
    summary: 'ok',
    data: { normalized: txs },
    meta: { count: txs.length },
  };
}

describe('analyze_volume_profile', () => {
  const mockedGetTransactions = vi.mocked(getTransactions);

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('inputSchema: valueAreaPct は 0.5 以上のみ許可する', () => {
    const parse = () => (toolDef.inputSchema as any).parse({ pair: 'btc_jpy', valueAreaPct: 0.49 });
    expect(parse).toThrow();
  });

  it('正常系: VWAP・Volume Profile・約定サイズ分布を返す', async () => {
    mockedGetTransactions.mockResolvedValue(mockTxResult(buildTxs([100, 101, 102, 103, 104, 105, 106, 107, 108, 109])) as any);

    const res: any = await analyzeVolumeProfile('btc_jpy', 0 as any, 10, 5, 0.7);

    expect(res.ok).toBe(true);
    expect(res.data.params.totalTrades).toBe(10);
    expect(res.data.profile.bins).toHaveLength(5);
    expect(res.data.tradeSizes.categories).toHaveLength(4);
  });

  it('get_transactions が全件失敗時は errorType=network を保つべき', async () => {
    mockedGetTransactions.mockResolvedValue({
      ok: false,
      summary: 'network failed',
      data: {},
      meta: { errorType: 'network' },
    } as any);

    const res: any = await analyzeVolumeProfile('btc_jpy', 0 as any, 10, 20, 0.7);

    expect(res.ok).toBe(false);
    expect(res.meta?.errorType).toBe('network');
  });

  it('toolDef.handler は省略パラメータ時に inputSchema の既定値で動作するべき', async () => {
    mockedGetTransactions.mockResolvedValue(mockTxResult(buildTxs([100, 101, 102, 103, 104, 105, 106, 107, 108, 109])) as any);

    const res: any = await toolDef.handler({ pair: 'btc_jpy' });

    expect(res.ok).toBe(true);
  });

  it('全約定が同一価格なら POC price は実約定価格と一致するべき', async () => {
    mockedGetTransactions.mockResolvedValue(
      mockTxResult(buildTxs(Array.from({ length: 10 }, () => 100), Array.from({ length: 10 }, (_, i) => i + 1))) as any
    );

    const res: any = await analyzeVolumeProfile('btc_jpy', 0 as any, 10, 6, 0.7);

    expect(res.ok).toBe(true);
    expect(res.data.profile.poc.price).toBe(100);
  });
});
