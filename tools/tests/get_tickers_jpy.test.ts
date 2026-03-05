import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import getTickersJpy from '../get_tickers_jpy.js';

describe('getTickersJpy', () => {
  beforeEach(() => {
    // 各テストでキャッシュをバイパスし、環境変数をリセット
    delete process.env.TICKERS_JPY_URL;
    delete process.env.TICKERS_JPY_TIMEOUT_MS;
    delete process.env.TICKERS_JPY_RETRIES;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ファイルフィクスチャから正常取得できる', async () => {
    process.env.TICKERS_JPY_URL = 'file://tools/tests/fixtures/tickers_jpy_sample.json';
    const res = await getTickersJpy({ bypassCache: true });
    expect((res as any).ok).toBe(true);
  });

  it('タイムアウト時は ok: false を返す', async () => {
    process.env.TICKERS_JPY_URL = 'about:timeout';
    process.env.TICKERS_JPY_TIMEOUT_MS = '50';
    process.env.TICKERS_JPY_RETRIES = '0';
    const res = await getTickersJpy({ bypassCache: true });
    expect((res as any).ok).toBe(false);
  });

  it('キャッシュフォールバックが機能する', async () => {
    // 1) キャッシュにシード
    process.env.TICKERS_JPY_URL = 'file://tools/tests/fixtures/tickers_jpy_sample.json';
    const ok1 = await getTickersJpy({ bypassCache: true });
    expect((ok1 as any).ok).toBe(true);

    // 2) 障害をシミュレートし、キャッシュからフォールバック
    process.env.TICKERS_JPY_URL = 'about:timeout';
    process.env.TICKERS_JPY_TIMEOUT_MS = '10';
    process.env.TICKERS_JPY_RETRIES = '0';
    const res = await getTickersJpy({ bypassCache: false });
    expect((res as any).ok).toBe(true);
  });

  it('ネットワークエラーは TIMEOUT_OR_NETWORK に分類されるべき', async () => {
    process.env.TICKERS_JPY_URL = 'https://public.bitbank.cc/tickers_jpy';
    process.env.TICKERS_JPY_RETRIES = '0';

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    const res = await getTickersJpy({ bypassCache: true });
    expect((res as any).ok).toBe(false);
    expect((res as any).summary).toContain('TIMEOUT_OR_NETWORK');
    expect((res as any).meta?.errorType).toBe('timeout');
  });
});
