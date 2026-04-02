import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import getTickersJpy from '../tools/get_tickers_jpy.js';
import { assertFail, assertOk } from './_assertResult.js';

describe('getTickersJpy', () => {
	beforeEach(() => {
		// 各テストでキャッシュをバイパスし、環境変数をリセット
		delete process.env.TICKERS_JPY_URL;
		delete process.env.TICKERS_JPY_TIMEOUT_MS;
		delete process.env.TICKERS_JPY_RETRIES;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		delete process.env.BITBANK_STRICT_PAIRS;
		delete process.env.BITBANK_PAIRS_MODE;
		delete process.env.BITBANK_PAIRS_TTL_MS;
		delete process.env.TICKERS_JPY_RETRY_WAIT_MS;
	});

	it('ファイルフィクスチャから正常取得できる', async () => {
		process.env.TICKERS_JPY_URL = 'file://tests/fixtures/tickers_jpy_sample.json';
		const res = await getTickersJpy({ bypassCache: true });
		assertOk(res);
	});

	it('タイムアウト時は ok: false を返す', async () => {
		process.env.TICKERS_JPY_URL = 'about:timeout';
		process.env.TICKERS_JPY_TIMEOUT_MS = '50';
		process.env.TICKERS_JPY_RETRIES = '0';
		const res = await getTickersJpy({ bypassCache: true });
		assertFail(res);
	});

	it('キャッシュフォールバックが機能する', async () => {
		// 1) キャッシュにシード
		process.env.TICKERS_JPY_URL = 'file://tests/fixtures/tickers_jpy_sample.json';
		const ok1 = await getTickersJpy({ bypassCache: true });
		assertOk(ok1);

		// 2) 障害をシミュレートし、キャッシュからフォールバック
		process.env.TICKERS_JPY_URL = 'about:timeout';
		process.env.TICKERS_JPY_TIMEOUT_MS = '10';
		process.env.TICKERS_JPY_RETRIES = '0';
		const res = await getTickersJpy({ bypassCache: false });
		assertOk(res);
	});

	it('ネットワークエラーは TIMEOUT_OR_NETWORK に分類されるべき', async () => {
		process.env.TICKERS_JPY_URL = 'https://public.bitbank.cc/tickers_jpy';
		process.env.TICKERS_JPY_RETRIES = '0';

		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

		const res = await getTickersJpy({ bypassCache: true });
		assertFail(res);
		expect(res.summary).toContain('TIMEOUT_OR_NETWORK');
		expect(res.meta?.errorType).toBe('timeout');
	});

	// --- getPairsMode branches ---

	describe('getPairsMode', () => {
		it('BITBANK_STRICT_PAIRS=0 → mode off (フィルタなし)', async () => {
			process.env.BITBANK_STRICT_PAIRS = '0';
			process.env.TICKERS_JPY_URL = 'file://tests/fixtures/tickers_jpy_sample.json';
			const res = await getTickersJpy({ bypassCache: true });
			assertOk(res);
			// mode=off なので mkr_jpy も含まれる
			expect(res.summary).toContain('mode=off');
		});

		it('BITBANK_PAIRS_MODE=auto → mode auto', async () => {
			process.env.BITBANK_PAIRS_MODE = 'auto';
			process.env.TICKERS_JPY_URL = 'file://tests/fixtures/tickers_jpy_sample.json';
			process.env.TICKERS_JPY_RETRIES = '0';
			// fetchOfficialJpyPairs が呼ばれる。mock してok応答を返す
			vi.spyOn(globalThis, 'fetch').mockResolvedValue({
				ok: true,
				json: async () => ({
					success: 1,
					data: [{ pair: 'btc_jpy' }, { pair: 'mkr_jpy' }],
				}),
			} as unknown as Response);
			const res = await getTickersJpy({ bypassCache: true });
			assertOk(res);
			expect(res.summary).toContain('mode=auto');
		});

		it('BITBANK_PAIRS_MODE=off → mode off (フィルタなし)', async () => {
			process.env.BITBANK_PAIRS_MODE = 'off';
			process.env.TICKERS_JPY_URL = 'file://tests/fixtures/tickers_jpy_sample.json';
			const res = await getTickersJpy({ bypassCache: true });
			assertOk(res);
			expect(res.summary).toContain('mode=off');
		});
	});

	// --- buildTickerText: change24hPct branches ---

	describe('buildTickerText change24hPct', () => {
		it('change24hPct が正の場合に + 符号が付く', async () => {
			process.env.TICKERS_JPY_URL = 'file://tests/fixtures/tickers_jpy_sample.json';
			// fixture の btc_jpy: open=95, last=100 → +5.26%
			const res = await getTickersJpy({ bypassCache: true });
			assertOk(res);
			expect(res.summary).toMatch(/chg:\+/);
		});

		it('change24hPct が null の場合は chg: が含まれない', async () => {
			// open=0 のフィクスチャを使う
			process.env.TICKERS_JPY_URL = 'file://tests/fixtures/tickers_jpy_zero_open.json';
			const res = await getTickersJpy({ bypassCache: true });
			assertOk(res);
			expect(res.summary).not.toMatch(/chg:/);
		});
	});

	// --- change calculation: openN=0 and NaN cases (file path) ---

	describe('change calculation edge cases (file path)', () => {
		it('open=0 のとき change24hPct は null になる', async () => {
			process.env.TICKERS_JPY_URL = 'file://tests/fixtures/tickers_jpy_zero_open.json';
			const res = await getTickersJpy({ bypassCache: true });
			assertOk(res);
			const item = res.data?.[0] as { change24hPct?: unknown };
			expect(item?.change24hPct).toBeNull();
		});

		it('open が非数値のとき change24hPct は null になる', async () => {
			process.env.TICKERS_JPY_URL = 'file://tests/fixtures/tickers_jpy_nan_open.json';
			const res = await getTickersJpy({ bypassCache: true });
			assertOk(res);
			const item = res.data?.[0] as { change24hPct?: unknown };
			expect(item?.change24hPct).toBeNull();
		});
	});

	// --- file:// isAbsolute path ---

	describe('file:// absolute path', () => {
		it('絶対パスの file:// でも読み込める', async () => {
			const abs = `${process.cwd()}/tests/fixtures/tickers_jpy_sample.json`;
			process.env.TICKERS_JPY_URL = `file://${abs}`;
			const res = await getTickersJpy({ bypassCache: true });
			assertOk(res);
		});
	});

	// --- file:// upstream error (success !== 1) ---

	describe('file:// upstream error', () => {
		it('success !== 1 のファイルを渡すと UPSTREAM_ERROR を返す', async () => {
			process.env.TICKERS_JPY_URL = 'file://tests/fixtures/tickers_jpy_bad.json';
			const res = await getTickersJpy({ bypassCache: true });
			assertFail(res);
			expect(res.summary).toContain('UPSTREAM_ERROR');
		});
	});

	// --- HTTP fetch path ---

	describe('HTTP fetch path', () => {
		it('fetch が成功すると ok を返す', async () => {
			process.env.TICKERS_JPY_URL = 'https://public.bitbank.cc/tickers_jpy';
			process.env.TICKERS_JPY_RETRIES = '0';
			vi.spyOn(globalThis, 'fetch').mockResolvedValue({
				ok: true,
				json: async () => ({
					success: 1,
					data: [
						{
							pair: 'btc_jpy',
							sell: '100',
							buy: '99',
							high: '110',
							low: '90',
							open: '95',
							last: '100',
							vol: '1.0',
							timestamp: 1760000000000,
						},
					],
				}),
			} as unknown as Response);
			const res = await getTickersJpy({ bypassCache: true });
			assertOk(res);
		});

		it('最初の fetch が失敗しリトライで成功する', async () => {
			process.env.TICKERS_JPY_URL = 'https://public.bitbank.cc/tickers_jpy';
			process.env.TICKERS_JPY_RETRIES = '1';
			process.env.TICKERS_JPY_RETRY_WAIT_MS = '0';
			const fetchSpy = vi.spyOn(globalThis, 'fetch');
			fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					success: 1,
					data: [
						{
							pair: 'btc_jpy',
							sell: '100',
							buy: '99',
							high: '110',
							low: '90',
							open: '95',
							last: '100',
							vol: '1.0',
							timestamp: 1760000000000,
						},
					],
				}),
			} as unknown as Response);
			const res = await getTickersJpy({ bypassCache: true });
			assertOk(res);
			expect(fetchSpy).toHaveBeenCalledTimes(2);
		});

		it('HTTP 5xx レスポンスで全リトライ消費後にエラーを返す', async () => {
			process.env.TICKERS_JPY_URL = 'https://public.bitbank.cc/tickers_jpy';
			process.env.TICKERS_JPY_RETRIES = '0';
			vi.spyOn(globalThis, 'fetch').mockResolvedValue({
				ok: false,
				status: 503,
			} as unknown as Response);
			const res = await getTickersJpy({ bypassCache: true });
			assertFail(res);
		});

		it('fetch 成功だが success !== 1 のとき UPSTREAM_ERROR を返す', async () => {
			process.env.TICKERS_JPY_URL = 'https://public.bitbank.cc/tickers_jpy';
			process.env.TICKERS_JPY_RETRIES = '0';
			vi.spyOn(globalThis, 'fetch').mockResolvedValue({
				ok: true,
				json: async () => ({ success: 0, data: [] }),
			} as unknown as Response);
			const res = await getTickersJpy({ bypassCache: true });
			assertFail(res);
			expect(res.summary).toContain('UPSTREAM_ERROR');
		});

		it('change が負の場合に + 符号がつかない (HTTP path)', async () => {
			process.env.TICKERS_JPY_URL = 'https://public.bitbank.cc/tickers_jpy';
			process.env.TICKERS_JPY_RETRIES = '0';
			vi.spyOn(globalThis, 'fetch').mockResolvedValue({
				ok: true,
				json: async () => ({
					success: 1,
					data: [
						{
							pair: 'btc_jpy',
							sell: '90',
							buy: '89',
							high: '100',
							low: '80',
							open: '100',
							last: '90',
							vol: '1.0',
							timestamp: 1760000000000,
						},
					],
				}),
			} as unknown as Response);
			const res = await getTickersJpy({ bypassCache: true });
			assertOk(res);
			// change = -10% なので + 符号なし
			expect(res.summary).toMatch(/chg:-/);
		});

		it('open=0 のとき HTTP path でも change24hPct は null (chg: なし)', async () => {
			process.env.TICKERS_JPY_URL = 'https://public.bitbank.cc/tickers_jpy';
			process.env.TICKERS_JPY_RETRIES = '0';
			vi.spyOn(globalThis, 'fetch').mockResolvedValue({
				ok: true,
				json: async () => ({
					success: 1,
					data: [
						{
							pair: 'btc_jpy',
							sell: '100',
							buy: '99',
							high: '110',
							low: '90',
							open: '0',
							last: '100',
							vol: '1.0',
							timestamp: 1760000000000,
						},
					],
				}),
			} as unknown as Response);
			const res = await getTickersJpy({ bypassCache: true });
			assertOk(res);
			const item = res.data?.[0] as { change24hPct?: unknown };
			expect(item?.change24hPct).toBeNull();
		});
	});

	// --- Error classification: isTimeout patterns ---

	describe('isTimeout error classification', () => {
		const patterns = [
			{ label: 'AbortError', msg: 'AbortError: request aborted' },
			{ label: 'timeout', msg: 'timeout exceeded' },
			{ label: 'ECONNREFUSED', msg: 'ECONNREFUSED 127.0.0.1:80' },
			{ label: 'ENOTFOUND', msg: 'getaddrinfo ENOTFOUND example.invalid' },
		];

		for (const { label, msg } of patterns) {
			it(`"${label}" を含むエラーは TIMEOUT_OR_NETWORK に分類される`, async () => {
				process.env.TICKERS_JPY_URL = 'https://public.bitbank.cc/tickers_jpy';
				process.env.TICKERS_JPY_RETRIES = '0';
				vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error(msg));
				const res = await getTickersJpy({ bypassCache: true });
				assertFail(res);
				expect(res.summary).toContain('TIMEOUT_OR_NETWORK');
				expect(res.meta?.errorType).toBe('timeout');
			});
		}

		it('その他のエラーは UPSTREAM_ に分類される', async () => {
			process.env.TICKERS_JPY_URL = 'https://public.bitbank.cc/tickers_jpy';
			process.env.TICKERS_JPY_RETRIES = '0';
			vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected JSON parse error'));
			const res = await getTickersJpy({ bypassCache: true });
			assertFail(res);
			expect(res.summary).toContain('UPSTREAM_');
			expect(res.meta?.errorType).toBe('upstream');
		});
	});

	// --- BITBANK_PAIRS_MODE=auto: fetchOfficialJpyPairs fallback to static ---
	// Note: dynamicPairs is module-level state. When a prior auto-mode test succeeds,
	// dynamicPairs is populated. If fetch fails on a subsequent call and dynamicPairs
	// already exists, getFilterSet returns it as source=dynamic (not static).
	// To test the static fallback path, we rely on this being the first auto call in isolation.

	describe('auto mode: fetch fails but result is still ok', () => {
		it('fetchOfficialJpyPairs が失敗しても ok を返す (dynamic or static fallback)', async () => {
			process.env.BITBANK_PAIRS_MODE = 'auto';
			process.env.TICKERS_JPY_URL = 'file://tests/fixtures/tickers_jpy_sample.json';
			process.env.TICKERS_JPY_RETRIES = '0';
			// fetchOfficialJpyPairs が失敗するよう fetch をモック
			vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'));
			const res = await getTickersJpy({ bypassCache: true });
			assertOk(res);
			expect(res.summary).toContain('mode=auto');
		});
	});
});
