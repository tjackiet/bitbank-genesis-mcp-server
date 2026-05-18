import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayjs } from '../lib/datetime.js';
import { GetCandlesInputSchema } from '../src/schemas.js';
import getCandles, { toolDef } from '../tools/get_candles.js';
import { assertFail, assertOk } from './_assertResult.js';
import { candlesError } from './fixtures/bitbank-api.js';

describe('GetCandlesInputSchema (limit 上限契約)', () => {
	it('limit=10000 は schema レベルで通る（multi-day 経路の実上限と整合）', () => {
		const parsed = GetCandlesInputSchema.parse({ pair: 'btc_jpy', type: '1min', limit: 10000 });
		expect((parsed as { limit: number }).limit).toBe(10000);
	});

	it('limit=10001 は schema レベルで弾かれる', () => {
		const result = GetCandlesInputSchema.safeParse({ pair: 'btc_jpy', type: '1min', limit: 10001 });
		expect(result.success).toBe(false);
	});

	it('limit=200 / limit=1000 / limit=1 / limit 省略 など既存ケースは引き続き通る', () => {
		expect(GetCandlesInputSchema.safeParse({ pair: 'btc_jpy', type: '1day', limit: 200 }).success).toBe(true);
		expect(GetCandlesInputSchema.safeParse({ pair: 'btc_jpy', type: '1day', limit: 1000 }).success).toBe(true);
		expect(GetCandlesInputSchema.safeParse({ pair: 'btc_jpy', type: '1day', limit: 1 }).success).toBe(true);
		// 省略時は default(200) が適用される
		const parsed = GetCandlesInputSchema.parse({ pair: 'btc_jpy', type: '1day' });
		expect((parsed as { limit: number }).limit).toBe(200);
	});

	it('limit=0 / limit=-1 / 小数は引き続き弾かれる', () => {
		expect(GetCandlesInputSchema.safeParse({ pair: 'btc_jpy', type: '1day', limit: 0 }).success).toBe(false);
		expect(GetCandlesInputSchema.safeParse({ pair: 'btc_jpy', type: '1day', limit: -1 }).success).toBe(false);
		expect(GetCandlesInputSchema.safeParse({ pair: 'btc_jpy', type: '1day', limit: 1.5 }).success).toBe(false);
	});
});

describe('getCandles', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it('不正な日付形式は user エラーを返す', async () => {
		const res = await getCandles('btc_jpy', '1hour', '2024-01-01', 10);
		assertFail(res);
		expect(res.meta?.errorType).toBe('user');
	});

	it('日足未満で date 指定時は指定日基準で取得するべき', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				success: 1,
				data: {
					candlestick: [
						{
							ohlcv: [['100', '110', '90', '105', '1.23', '1704067200000']],
						},
					],
				},
			}),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getCandles('btc_jpy', '1hour', '20240101', 50);
		assertOk(res);

		const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
		expect(calledUrls.some((u) => u.endsWith('/btc_jpy/candlestick/1hour/20240101'))).toBe(true);
	});

	it('無効な type は user エラーを返す', async () => {
		const res = await getCandles('btc_jpy', 'invalid_type', '20240101', 10);
		assertFail(res);
		expect(res.meta?.errorType).toBe('user');
	});

	it('無効なペアは failFromValidation を返す', async () => {
		const res = await getCandles('invalid_xxx', '1day', '20240101', 10);
		assertFail(res);
	});

	it('空のローソク足データは user エラーを返す', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				success: 1,
				data: {
					candlestick: [{ ohlcv: [] }],
				},
			}),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getCandles('btc_jpy', '1day', '2024', 10);
		assertFail(res);
	});

	it('十分なデータがある場合 keyPoints と volumeStats を計算するべき', async () => {
		// 100本のローソク足を生成
		const baseTs = 1704067200000;
		const ohlcv = Array.from({ length: 100 }, (_, i) => [
			String(100 + i),
			String(110 + i),
			String(90 + i),
			String(105 + i),
			String(1 + i * 0.1),
			String(baseTs + i * 86400000),
		]);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				success: 1,
				data: { candlestick: [{ ohlcv }] },
			}),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getCandles('btc_jpy', '1day', '2024', 100);
		assertOk(res);

		// keyPoints should exist
		expect(res.data.keyPoints!.today).not.toBeNull();
		expect(res.data.keyPoints!.sevenDaysAgo).not.toBeNull();
		expect(res.data.keyPoints!.thirtyDaysAgo).not.toBeNull();
		expect(res.data.keyPoints!.ninetyDaysAgo).not.toBeNull();

		// volumeStats should exist (>= 14 items)
		expect(res.data.volumeStats).not.toBeNull();
		expect(res.data.volumeStats?.changePct).toBeDefined();
		expect(res.data.volumeStats?.judgment).toBeDefined();
	});

	it('出来高変化率が +20% 以上なら「活発になっています」と判定するべき', async () => {
		const baseTs = 1704067200000;
		// recent 7 days high volume, previous 7 days low volume
		const ohlcv = Array.from({ length: 20 }, (_, i) => [
			'100',
			'110',
			'90',
			'105',
			i >= 13 ? '100' : '10', // last 7 high, previous low
			String(baseTs + i * 86400000),
		]);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				success: 1,
				data: { candlestick: [{ ohlcv }] },
			}),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getCandles('btc_jpy', '1day', '2024', 20);
		assertOk(res);
		expect(res.data.volumeStats?.judgment).toBe('活発になっています');
	});

	it('出来高変化率が -20% 以下なら「落ち着いています」と判定するべき', async () => {
		const baseTs = 1704067200000;
		// recent 7 days low volume, previous 7 days high volume
		const ohlcv = Array.from({ length: 20 }, (_, i) => [
			'100',
			'110',
			'90',
			'105',
			i >= 13 ? '10' : '100', // last 7 low, previous high
			String(baseTs + i * 86400000),
		]);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				success: 1,
				data: { candlestick: [{ ohlcv }] },
			}),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getCandles('btc_jpy', '1day', '2024', 20);
		assertOk(res);
		expect(res.data.volumeStats?.judgment).toBe('落ち着いています');
	});

	describe('volumeStats: 前7日間ゼロ出来高ベースライン耐性', () => {
		it('前7日間が全てゼロ出来高 + 直近7日間に出来高ありなら changePct=null かつ専用ラベル', async () => {
			const baseTs = 1704067200000;
			// previous 7 days (index 0-6) = 0 volume, recent 7 days (index 7-13) = nonzero
			// → previous7DaysAvg === 0, recent7DaysAvg !== 0 → 通常計算なら Infinity
			const ohlcv = Array.from({ length: 14 }, (_, i) => [
				'100',
				'110',
				'90',
				'105',
				i >= 7 ? '1.0' : '0',
				String(baseTs + i * 86400000),
			]);
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({
					success: 1,
					data: { candlestick: [{ ohlcv }] },
				}),
			});
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const res = await getCandles('btc_jpy', '1day', '2024', 14);
			assertOk(res);
			expect(res.data.volumeStats).not.toBeNull();
			expect(res.data.volumeStats?.changePct).toBeNull();
			expect(res.data.volumeStats?.judgment).toBe('前週比較不可（前7日間の出来高ゼロ）');
			expect(res.data.volumeStats?.previous7DaysAvg).toBe(0);
		});

		it('前7日も直近7日も全てゼロ出来高なら changePct=null かつ専用ラベル (0/0=NaN 経路)', async () => {
			const baseTs = 1704067200000;
			// all volumes are 0 → previous7DaysAvg === 0, recent7DaysAvg === 0 → 通常計算なら NaN
			const ohlcv = Array.from({ length: 14 }, (_, i) => [
				'100',
				'110',
				'90',
				'105',
				'0',
				String(baseTs + i * 86400000),
			]);
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({
					success: 1,
					data: { candlestick: [{ ohlcv }] },
				}),
			});
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const res = await getCandles('btc_jpy', '1day', '2024', 14);
			assertOk(res);
			expect(res.data.volumeStats).not.toBeNull();
			expect(res.data.volumeStats?.changePct).toBeNull();
			expect(res.data.volumeStats?.judgment).toBe('前週比較不可（前7日間の出来高ゼロ）');
			expect(res.data.volumeStats?.recent7DaysAvg).toBe(0);
			expect(res.data.volumeStats?.previous7DaysAvg).toBe(0);
		});

		it('前7日ゼロ出来高でも content text 出力で null.toFixed() 等で落ちない', async () => {
			const baseTs = 1704067200000;
			const ohlcv = Array.from({ length: 14 }, (_, i) => [
				'100',
				'110',
				'90',
				'105',
				i >= 7 ? '1.0' : '0',
				String(baseTs + i * 86400000),
			]);
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({
					success: 1,
					data: { candlestick: [{ ohlcv }] },
				}),
			});
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const res = (await toolDef.handler({
				pair: 'btc_jpy',
				type: '1day',
				date: '2024',
				limit: 14,
				view: 'full',
			})) as { content: Array<{ type: string; text: string }> };
			const text = res.content[0].text;
			// Infinity / NaN が含まれないこと
			expect(text).not.toMatch(/Infinity/);
			expect(text).not.toMatch(/NaN/);
			// 専用ラベルが summary に含まれる
			expect(text).toContain('前週比較不可');
		});
	});

	it('404 エラーで 4hour/8hour/12hour の場合はヒント付きメッセージを返す', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error('HTTP 404 Not Found'));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getCandles('btc_jpy', '4hour', '2024', 10);
		assertFail(res);
		expect(res.meta?.errorType).toBe('user');
	});

	it('ネットワークエラーの場合は network エラータイプを返す', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getCandles('btc_jpy', '1day', '2024', 10);
		assertFail(res);
		expect(res.meta?.errorType).toBe('network');
	});

	it('複数年取得が必要な場合は並列取得するべき', async () => {
		const baseTs = 1704067200000;
		const ohlcv = Array.from({ length: 200 }, (_, i) => [
			'100',
			'110',
			'90',
			'105',
			'1.0',
			String(baseTs + i * 86400000),
		]);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				success: 1,
				data: { candlestick: [{ ohlcv }] },
			}),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		// 1day with limit > 365 → needs multi-year
		const res = await getCandles('btc_jpy', '1day', undefined, 500);
		assertOk(res);

		// Should have made multiple fetch calls (one per year)
		expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
	});

	// ── multi-year 起点年（date パラメータの遵守） ──

	describe('multi-year: date パラメータを起点に取得する', () => {
		const buildSuccessMock = () => {
			const baseTs = 1577836800000; // 2020-01-01 UTC
			const ohlcv = Array.from({ length: 365 }, (_, i) => [
				'100',
				'110',
				'90',
				'105',
				'1.0',
				String(baseTs + i * 86400000),
			]);
			return vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({
					success: 1,
					data: { candlestick: [{ ohlcv }] },
				}),
			});
		};

		it('1day: date 指定時はその年を起点に過去年を取得する', async () => {
			const fetchMock = buildSuccessMock();
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			await getCandles('btc_jpy', '1day', '2020', 2000);

			const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
			// 起点年 2020 が含まれる
			expect(calledUrls.some((u) => u.endsWith('/btc_jpy/candlestick/1day/2020'))).toBe(true);
			// 2020 より新しい年は呼ばれていない（現在年起点になっていないことを確認）
			for (let y = 2021; y <= 2030; y++) {
				expect(calledUrls.some((u) => u.endsWith(`/btc_jpy/candlestick/1day/${y}`))).toBe(false);
			}
		});

		it('1day: date が YYYYMMDD 形式でも YYYY 部分を起点とする', async () => {
			const fetchMock = buildSuccessMock();
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			await getCandles('btc_jpy', '1day', '20201225', 2000);

			const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
			expect(calledUrls.some((u) => u.endsWith('/btc_jpy/candlestick/1day/2020'))).toBe(true);
			for (let y = 2021; y <= 2030; y++) {
				expect(calledUrls.some((u) => u.endsWith(`/btc_jpy/candlestick/1day/${y}`))).toBe(false);
			}
		});

		it('4hour: date 指定時はその年を起点に過去年を取得する', async () => {
			const fetchMock = buildSuccessMock();
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			await getCandles('btc_jpy', '4hour', '2020', 5000);

			const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
			expect(calledUrls.some((u) => u.endsWith('/btc_jpy/candlestick/4hour/2020'))).toBe(true);
			for (let y = 2021; y <= 2030; y++) {
				expect(calledUrls.some((u) => u.endsWith(`/btc_jpy/candlestick/4hour/${y}`))).toBe(false);
			}
		});

		it('1week: date 指定時はその年を起点に過去年を取得する', async () => {
			const fetchMock = buildSuccessMock();
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			await getCandles('btc_jpy', '1week', '2018', 200);

			const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
			expect(calledUrls.some((u) => u.endsWith('/btc_jpy/candlestick/1week/2018'))).toBe(true);
			for (let y = 2019; y <= 2030; y++) {
				expect(calledUrls.some((u) => u.endsWith(`/btc_jpy/candlestick/1week/${y}`))).toBe(false);
			}
		});

		it('1month: date 指定時はその年を起点に過去年を取得する', async () => {
			const fetchMock = buildSuccessMock();
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			await getCandles('btc_jpy', '1month', '2017', 100);

			const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
			expect(calledUrls.some((u) => u.endsWith('/btc_jpy/candlestick/1month/2017'))).toBe(true);
			for (let y = 2018; y <= 2030; y++) {
				expect(calledUrls.some((u) => u.endsWith(`/btc_jpy/candlestick/1month/${y}`))).toBe(false);
			}
		});

		it('date 未指定時は現在年を起点に過去年を取得する（従来挙動）', async () => {
			const fetchMock = buildSuccessMock();
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			await getCandles('btc_jpy', '1day', undefined, 2000);

			const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
			const currentYear = dayjs().year();
			expect(calledUrls.some((u) => u.endsWith(`/btc_jpy/candlestick/1day/${currentYear}`))).toBe(true);
		});

		it('multi-day 取得には影響しない: 1hour + date 指定はそのまま YYYYMMDD を起点とする', async () => {
			const baseTs = 1705276800000; // 2024-01-15
			const ohlcv = Array.from({ length: 24 }, (_, i) => [
				'100',
				'110',
				'90',
				'105',
				'1.0',
				String(baseTs + i * 3600000),
			]);
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({
					success: 1,
					data: { candlestick: [{ ohlcv }] },
				}),
			});
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			await getCandles('btc_jpy', '1hour', '20240115', 100);

			const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
			// multi-day branch は YYYYMMDD 形式のまま既存挙動
			expect(calledUrls.some((u) => u.endsWith('/btc_jpy/candlestick/1hour/20240115'))).toBe(true);
		});
	});

	it('複数日取得が必要な場合はバッチ取得するべき', async () => {
		const baseTs = 1704067200000;
		const ohlcv = Array.from({ length: 50 }, (_, i) => [
			'100',
			'110',
			'90',
			'105',
			'1.0',
			String(baseTs + i * 3600000),
		]);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				success: 1,
				data: { candlestick: [{ ohlcv }] },
			}),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		// 1hour with limit > 24 (1 day) → needs multi-day
		const res = await getCandles('btc_jpy', '1hour', '20240115', 100);
		assertOk(res);

		// Should have made multiple fetch calls (one per day batch)
		expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
	});

	// ── limit 上限（schema 緩和後の impl 側 validateLimit との整合） ──

	describe('limit 上限: impl 側 validateLimit', () => {
		const buildFetchMock = (rows: unknown[][]) =>
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({
					success: 1,
					data: { candlestick: [{ ohlcv: rows }] },
				}),
			});

		it('multi-year 経路: YEARLY_TYPES + limit=2000 は impl 側でも通る', async () => {
			const baseTs = 1577836800000;
			const ohlcv = Array.from({ length: 365 }, (_, i) => [
				'100',
				'110',
				'90',
				'105',
				'1.0',
				String(baseTs + i * 86400000),
			]);
			globalThis.fetch = buildFetchMock(ohlcv) as unknown as typeof fetch;

			const res = await getCandles('btc_jpy', '1day', '2020', 2000);
			assertOk(res);
		});

		it('multi-day 経路: DAILY_TYPES + limit=2000 は impl 側でも通る', async () => {
			const baseTs = 1705276800000;
			const ohlcv = Array.from({ length: 60 }, (_, i) => [
				'100',
				'110',
				'90',
				'105',
				'1.0',
				String(baseTs + i * 60_000),
			]);
			globalThis.fetch = buildFetchMock(ohlcv) as unknown as typeof fetch;

			const res = await getCandles('btc_jpy', '1min', '20240115', 2000);
			assertOk(res);
		});

		it('YEARLY_TYPES + limit=6000 は impl 側 validateLimit で user エラー（実上限 5000 超）', async () => {
			// schema は通るが impl の maxLimit=5000 を超えるため user エラー
			const baseTs = 1577836800000;
			const ohlcv = [['100', '110', '90', '105', '1.0', String(baseTs)]];
			globalThis.fetch = buildFetchMock(ohlcv) as unknown as typeof fetch;

			const res = await getCandles('btc_jpy', '1day', '2020', 6000);
			assertFail(res);
			expect(res.meta?.errorType).toBe('user');
		});
	});

	it('priceRange を正しく計算するべき', async () => {
		const baseTs = 1704067200000;
		const ohlcv = [
			['100', '150', '80', '120', '1.0', String(baseTs)],
			['120', '200', '70', '130', '2.0', String(baseTs + 86400000)],
		];
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				success: 1,
				data: { candlestick: [{ ohlcv }] },
			}),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getCandles('btc_jpy', '1day', '2024', 10);
		assertOk(res);

		// High should be 200, Low should be 70
		const highs = res.data.normalized.map((c: { high: number }) => c.high);
		const lows = res.data.normalized.map((c: { low: number }) => c.low);
		expect(Math.max(...highs)).toBe(200);
		expect(Math.min(...lows)).toBe(70);
	});

	// ── API 異常系（success:0） ──

	it('API異常系: success:0 を「データなし」(user) ではなく upstream として明示分類する', async () => {
		// 単一リクエスト経路: 1day + limit=10 + date=2024 は yearsNeeded=1 で単発取得
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => candlesError,
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getCandles('btc_jpy', '1day', '2024', 10);
		assertFail(res);
		expect(res.meta?.errorType).toBe('upstream');
		expect(res.summary).toContain('code: 10000');
	});

	it('API異常系: success:0 で data.code が無くても upstream として返す', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({ success: 0, data: {} }),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getCandles('btc_jpy', '1day', '2024', 10);
		assertFail(res);
		expect(res.meta?.errorType).toBe('upstream');
	});

	it('API異常系: 複数年取得で全チャンク success:0 のとき upstream として明示分類する', async () => {
		// 1day + limit=500 → 複数年取得が走るパス
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => candlesError,
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getCandles('btc_jpy', '1day', undefined, 500);
		assertFail(res);
		expect(res.meta?.errorType).toBe('upstream');
		expect(res.summary).toContain('code: 10000');
	});

	it('API異常系: 複数日取得で全チャンク success:0 のとき upstream として明示分類する', async () => {
		// 1hour + limit=100 → 複数日バッチ取得が走るパス
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => candlesError,
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getCandles('btc_jpy', '1hour', '20240115', 100);
		assertFail(res);
		expect(res.meta?.errorType).toBe('upstream');
		expect(res.summary).toContain('code: 10000');
	});

	// ── OHLCV データ品質（不正行検出 + timestamp 保持） ──

	describe('OHLCV データ品質', () => {
		it('D-1: OHLCV 行に NaN になる値が含まれる場合 upstream として fail する', async () => {
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({
					success: 1,
					data: {
						candlestick: [
							{
								ohlcv: [['foo', '100', '90', '95', '1.5', 1700000000000]],
							},
						],
					},
				}),
			});
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const res = await getCandles('btc_jpy', '1day', '2024', 10);
			assertFail(res);
			expect(res.meta?.errorType).toBe('upstream');
			expect(res.summary).toContain('不正な OHLCV');
		});

		it('D-2: OHLCV 行長が 6 未満の場合 upstream として fail する', async () => {
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({
					success: 1,
					data: {
						candlestick: [
							{
								ohlcv: [[100, 110, 90, 95, 1.5]],
							},
						],
					},
				}),
			});
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const res = await getCandles('btc_jpy', '1day', '2024', 10);
			assertFail(res);
			expect(res.meta?.errorType).toBe('upstream');
			expect(res.summary).toContain('不正な OHLCV');
		});

		it('D-3: OHLCV 行の ts が非数値の場合 upstream として fail する', async () => {
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({
					success: 1,
					data: {
						candlestick: [
							{
								ohlcv: [['1000', '1100', '900', '1050', '0.5', 'not-a-number']],
							},
						],
					},
				}),
			});
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const res = await getCandles('btc_jpy', '1day', '2024', 10);
			assertFail(res);
			expect(res.meta?.errorType).toBe('upstream');
			expect(res.summary).toContain('不正な OHLCV');
		});

		it('D-4: OHLCV 行の ts が 0 以下の場合 upstream として fail する', async () => {
			// ts=0 は Number.isFinite(0)===true なので D-3 とは別枝（tsNum <= 0）を踏む
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({
					success: 1,
					data: {
						candlestick: [
							{
								ohlcv: [['1000', '1100', '900', '1050', '0.5', 0]],
							},
						],
					},
				}),
			});
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const res = await getCandles('btc_jpy', '1day', '2024', 10);
			assertFail(res);
			expect(res.meta?.errorType).toBe('upstream');
			expect(res.summary).toContain('不正な OHLCV');
		});

		it('E: 正常系では公式 candle の ms timestamp が normalized に保持される', async () => {
			const ts = 1700000000000;
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({
					success: 1,
					data: {
						candlestick: [
							{
								ohlcv: [['100', '110', '90', '105', '1.5', ts]],
							},
						],
					},
				}),
			});
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const res = await getCandles('btc_jpy', '1day', '2024', 10);
			assertOk(res);
			expect(res.data.normalized[0].timestamp).toBe(ts);
		});
	});

	it('tz が空文字列の場合 isoTimeLocal を含めないべき', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				success: 1,
				data: {
					candlestick: [{ ohlcv: [['100', '110', '90', '105', '1.0', '1704067200000']] }],
				},
			}),
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await getCandles('btc_jpy', '1day', '2024', 10, '');
		assertOk(res);
		expect(res.data.normalized[0]).not.toHaveProperty('isoTimeLocal');
	});

	// ── toolDef.handler 経由（fail 透過） ──

	describe('toolDef.handler 経由', () => {
		it('success:0 + view=items のとき fail を透過し 0件 JSON を返さない', async () => {
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => candlesError,
			});
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const res = (await toolDef.handler({
				pair: 'btc_jpy',
				type: '1day',
				date: '2024',
				limit: 10,
				view: 'items',
			})) as {
				ok: boolean;
				meta?: { errorType?: string };
				content?: Array<{ type: string; text: string }>;
			};
			expect(res.ok).toBe(false);
			expect(res.meta?.errorType).toBe('upstream');
			// fail を透過しているので content に 0件 JSON 配列を入れない
			if (res.content?.[0]?.text) {
				expect(res.content[0].text).not.toBe('[]');
			}
		});

		it('success:0 + view=full のとき fail を透過する', async () => {
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => candlesError,
			});
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const res = (await toolDef.handler({ pair: 'btc_jpy', type: '1day', date: '2024', limit: 10, view: 'full' })) as {
				ok: boolean;
				meta?: { errorType?: string };
			};
			expect(res.ok).toBe(false);
			expect(res.meta?.errorType).toBe('upstream');
		});

		it('正常系 + view=items のとき content text は JSON 配列で N 件含む', async () => {
			const baseTs = 1704067200000;
			const ohlcv = Array.from({ length: 3 }, (_, i) => [
				'100',
				'110',
				'90',
				'105',
				'1.0',
				String(baseTs + i * 86400000),
			]);
			const fetchMock = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({
					success: 1,
					data: { candlestick: [{ ohlcv }] },
				}),
			});
			globalThis.fetch = fetchMock as unknown as typeof fetch;

			const res = (await toolDef.handler({
				pair: 'btc_jpy',
				type: '1day',
				date: '2024',
				limit: 10,
				view: 'items',
			})) as {
				content: Array<{ type: string; text: string }>;
			};
			const parsed = JSON.parse(res.content[0].text);
			expect(Array.isArray(parsed)).toBe(true);
			expect(parsed).toHaveLength(3);
		});
	});
});
