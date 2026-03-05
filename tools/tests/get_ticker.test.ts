import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import getTicker from '../get_ticker.js';

describe('getTicker', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('正常な上流レスポンスで ok:true を返すべき', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: 1,
        data: {
          sell: '5000000',
          buy: '4999000',
          open: '4800000',
          high: '5100000',
          low: '4700000',
          last: '5000000',
          vol: '1234.5678',
          timestamp: 1700000000000,
        },
      }),
    });
    const res = await getTicker('btc_jpy', { timeoutMs: 500 });
    expect(res.ok).toBe(true);
  });

  it('上流レスポンスが不正な場合は ok:false を返すべき', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: 1 }),
    });
    const res = await getTicker('btc_jpy', { timeoutMs: 500 });
    expect(res.ok).toBe(false);
    expect((res as any).meta.errorType).toBe('upstream');
  });
});
