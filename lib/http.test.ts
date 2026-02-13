import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchJson, BITBANK_API_BASE, DEFAULT_RETRIES } from './http.js';

describe('定数', () => {
  it('BITBANK_API_BASE が正しい', () => {
    expect(BITBANK_API_BASE).toBe('https://public.bitbank.cc');
  });
  it('DEFAULT_RETRIES が 2', () => {
    expect(DEFAULT_RETRIES).toBe(2);
  });
});

describe('fetchJson', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('成功レスポンスを JSON としてパースする', async () => {
    const mockData = { success: 1, data: { price: 15000000 } };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const result = await fetchJson('https://example.com/api');
    expect(result).toEqual(mockData);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('HTTP エラーで例外を投げる', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await expect(
      fetchJson('https://example.com/api', { retries: 0 }),
    ).rejects.toThrow('HTTP 500');
  });

  it('リトライ後に成功する', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('network error'));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });
    });

    const result = await fetchJson('https://example.com/api', { retries: 1 });
    expect(result).toEqual({ ok: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('全リトライ失敗で最後のエラーを投げる', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('persistent error'));

    await expect(
      fetchJson('https://example.com/api', { retries: 1 }),
    ).rejects.toThrow('persistent error');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // 初回 + 1リトライ
  });
});
