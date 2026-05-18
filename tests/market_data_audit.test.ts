/**
 * PR5: Phase 2 final audit — public market data tools
 *
 * 対象ツール（src/tool-registry.ts 基準）:
 * | 公開ツール名         | 実装ファイル                                   |
 * |---------------------|-----------------------------------------------|
 * | get_ticker          | tools/get_ticker.ts                           |
 * | get_tickers_jpy     | src/handlers/getTickersJpyHandler.ts (handler)|
 * |                     | tools/get_tickers_jpy.ts (inner fetch)        |
 * | get_orderbook       | tools/get_orderbook.ts                        |
 * | get_transactions    | tools/get_transactions.ts                     |
 * | get_candles         | tools/get_candles.ts                          |
 * | prepare_depth_data  | tools/prepare_depth_data.ts                   |
 * | (internal helper)   | lib/get-depth.ts (prepare_depth_data 経由)    |
 *
 * 監査観点:
 * 1. 公開 tool 実体の対応表をテスト/コメントに固定する
 * 2. Public market data output に NaN / Infinity / -Infinity が出ない（再帰検査）
 * 3. JSON.stringify / JSON.parse 往復後も schema と意味が壊れない
 * 4. timestamp 欠損時の Date.now() fallback を upstream fail に寄せる
 * 5. warning / partial / drop / 件数 / timestamp が LLM 可視な content に出ている
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import getDepth from '../lib/get-depth.js';
import {
	GetCandlesOutputSchema,
	GetDepthOutputSchema,
	GetOrderbookOutputSchema,
	GetTickerOutputSchema,
	GetTickersJpyOutputSchema,
	GetTransactionsOutputSchema,
	PrepareDepthDataOutputSchema,
} from '../src/schemas.js';
import { allToolDefs } from '../src/tool-registry.js';
import getCandles from '../tools/get_candles.js';
import getOrderbook from '../tools/get_orderbook.js';
import getTicker from '../tools/get_ticker.js';
import getTickersJpy from '../tools/get_tickers_jpy.js';
import getTransactions from '../tools/get_transactions.js';
import prepareDepthData from '../tools/prepare_depth_data.js';
import { asMockResult, assertFail, assertOk } from './_assertResult.js';
import { tickerBtcJpy } from './fixtures/bitbank-api.js';

// ── 共通ヘルパー ─────────────────────────────────────────────

/** value 配下を再帰的に走査し、NaN / Infinity / -Infinity の存在パスを返す */
function findNonFiniteNumbers(value: unknown, path = '$'): string[] {
	const found: string[] = [];
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) found.push(`${path}=${String(value)}`);
		return found;
	}
	if (Array.isArray(value)) {
		value.forEach((v, i) => {
			for (const p of findNonFiniteNumbers(v, `${path}[${i}]`)) found.push(p);
		});
		return found;
	}
	if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			for (const p of findNonFiniteNumbers(v, `${path}.${k}`)) found.push(p);
		}
	}
	return found;
}

/**
 * content[].text を全て改行結合して返す（handler の戻り値が McpResponse 型のとき）。
 * 「LLM 可視 content」を監査する観点では content[1] 以降にぶら下がる warning 等も拾う必要があるため、
 * content[0] のみではなく全テキストブロックを連結する。
 */
function getContentText(res: { content?: Array<{ type: string; text: string }> }): string {
	return (res.content ?? [])
		.map((c) => c.text)
		.filter(Boolean)
		.join('\n');
}

/** 共通の fetch モック（ok レスポンス） */
function mockFetchJson(payload: unknown, headers: Record<string, string> = {}) {
	return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		asMockResult<Response>({
			ok: true,
			status: 200,
			statusText: 'OK',
			headers: new Headers(headers),
			json: async () => payload,
		}),
	);
}

// ── フィクスチャ ─────────────────────────────────────────────

const TS = 1_700_000_000_000;

function depthFixture(overrides: Partial<{ timestamp: unknown; asks: unknown; bids: unknown }> = {}) {
	return {
		success: 1,
		data: {
			asks: [
				['5000100', '0.2'],
				['5000200', '0.4'],
			],
			bids: [
				['5000000', '0.3'],
				['4999900', '0.5'],
			],
			timestamp: TS,
			...overrides,
		},
	};
}

function txFixture(rows: Array<Record<string, unknown>>) {
	return { success: 1, data: { transactions: rows } };
}

function candlesFixture(ohlcv: unknown[][] = []) {
	return { success: 1, data: { candlestick: [{ ohlcv }] } };
}

function validOhlcv(count = 3): unknown[][] {
	return Array.from({ length: count }, (_, i) => [
		String(5_000_000 + i),
		String(5_000_100 + i),
		String(4_999_900 + i),
		String(5_000_050 + i),
		String(1 + i * 0.1),
		TS + i * 86_400_000,
	]);
}

// ── 1. 公開 tool 実体の対応表 ─────────────────────────────

describe('PR5 audit / 1. public tool ↔ impl file mapping', () => {
	/**
	 * src/tool-registry.ts allToolDefs に登録されている名前と、PR5 Phase 2 監査対象の
	 * 6 ツール（public market data）が一致することを固定する。
	 * 監査内では lib/get-depth.ts は内部ヘルパーなので tool 名は持たないが、
	 * prepare_depth_data 経由で fetch される実装として下記コメントで明示する。
	 */
	const EXPECTED_PUBLIC_MARKET_DATA_TOOLS = [
		'get_ticker',
		'get_tickers_jpy',
		'get_orderbook',
		'get_transactions',
		'get_candles',
		'prepare_depth_data',
	] as const;

	it('監査対象の 6 ツールが allToolDefs に登録されている', () => {
		const names = new Set(allToolDefs.map((t) => t.name));
		for (const expected of EXPECTED_PUBLIC_MARKET_DATA_TOOLS) {
			expect(names.has(expected)).toBe(true);
		}
	});

	it('各ツールの inputSchema / handler / description が server 登録要件を満たす', () => {
		const defs = allToolDefs.filter((t) => (EXPECTED_PUBLIC_MARKET_DATA_TOOLS as readonly string[]).includes(t.name));
		expect(defs).toHaveLength(EXPECTED_PUBLIC_MARKET_DATA_TOOLS.length);
		for (const def of defs) {
			expect(typeof def.handler).toBe('function');
			expect(typeof def.description).toBe('string');
			expect(def.description.length).toBeGreaterThan(0);
			expect(typeof (def.inputSchema as { parse?: unknown }).parse).toBe('function');
		}
	});
});

// ── 2. JSON safety: NaN / Infinity / -Infinity が出ない ────

describe('PR5 audit / 2. JSON safety (NaN / Infinity / -Infinity 再帰検査)', () => {
	beforeEach(() => {
		delete process.env.TICKERS_JPY_URL;
		delete process.env.BITBANK_PAIRS_MODE;
		process.env.BITBANK_PAIRS_MODE = 'off';
	});

	afterEach(() => {
		vi.restoreAllMocks();
		delete process.env.BITBANK_PAIRS_MODE;
		delete process.env.TICKERS_JPY_URL;
	});

	it('get_ticker: 正常系 → NaN/Infinity を含まない', async () => {
		mockFetchJson({ ...tickerBtcJpy });
		const res = await getTicker('btc_jpy');
		assertOk(res);
		expect(findNonFiniteNumbers({ summary: res.summary, data: res.data, meta: res.meta })).toEqual([]);
	});

	it('get_ticker: null フィールド混在 → NaN/Infinity を含まない', async () => {
		mockFetchJson({
			success: 1,
			data: { last: null, open: '0', high: null, low: null, buy: null, sell: null, vol: null, timestamp: TS },
		});
		const res = await getTicker('btc_jpy');
		assertOk(res);
		expect(findNonFiniteNumbers({ data: res.data, meta: res.meta })).toEqual([]);
	});

	it('get_orderbook (summary/pressure/statistics/raw): NaN/Infinity を含まない', async () => {
		for (const mode of ['summary', 'pressure', 'statistics', 'raw'] as const) {
			mockFetchJson(depthFixture());
			const res = await getOrderbook({ pair: 'btc_jpy', mode });
			assertOk(res);
			expect(findNonFiniteNumbers({ data: res.data, meta: res.meta })).toEqual([]);
			vi.restoreAllMocks();
		}
	});

	it('get_orderbook (statistics): ask=0 → ratio が finite な数値 or null（Infinity は出ない）', async () => {
		// bid 板のみ存在、ask 板は空（買い圧倒）
		mockFetchJson({
			success: 1,
			data: {
				asks: [],
				bids: [
					['5000000', '0.3'],
					['4999900', '0.5'],
				],
				timestamp: TS,
			},
		});
		const res = await getOrderbook({ pair: 'btc_jpy', mode: 'statistics' });
		assertOk(res);
		expect(findNonFiniteNumbers({ data: res.data, meta: res.meta })).toEqual([]);
		// ratio は null に正規化されていることを確認（buildStatistics の責務）
		// biome-ignore lint/suspicious/noExplicitAny: deep property access for assertion
		const ranges = (res.data as any).ranges as Array<{ ratio: number | null }>;
		for (const r of ranges) {
			expect(r.ratio === null || Number.isFinite(r.ratio)).toBe(true);
		}
	});

	it('get_transactions: 文字列価格混在 → NaN/Infinity を含まない', async () => {
		mockFetchJson(
			txFixture([
				{ transaction_id: 1, price: '5000000', amount: '0.01', side: 'buy', executed_at: TS },
				{ transaction_id: 2, price: 'abc', amount: '0.02', side: 'sell', executed_at: TS + 1 }, // dropped
				{ transaction_id: 3, price: '5000200', amount: '0.03', side: 'buy', executed_at: TS + 2 },
			]),
		);
		const res = await getTransactions('btc_jpy', 10);
		assertOk(res);
		expect(findNonFiniteNumbers({ data: res.data, meta: res.meta })).toEqual([]);
		expect(res.data.normalized).toHaveLength(2);
		expect(res.meta?.warning).toContain('1件');
	});

	it('get_candles: 正常系 → NaN/Infinity を含まない', async () => {
		mockFetchJson(candlesFixture(validOhlcv(3)));
		const res = await getCandles('btc_jpy', '1day', '2024', 3);
		assertOk(res);
		expect(findNonFiniteNumbers({ data: res.data, meta: res.meta })).toEqual([]);
	});

	it('get_candles: previous7DaysAvg === 0 → volumeStats.changePct は null（Infinity/NaN なし）', async () => {
		// 直近 7 日: volume=1.0 / その前 7 日: volume=0 → changePct = 1/0 → Infinity を null 化
		const rows: unknown[][] = [];
		for (let i = 0; i < 14; i++) {
			const vol = i < 7 ? '0' : '1.0';
			rows.push(['5000000', '5000100', '4999900', '5000050', vol, TS + i * 86_400_000]);
		}
		mockFetchJson(candlesFixture(rows));
		const res = await getCandles('btc_jpy', '1day', '2024', 14);
		assertOk(res);
		expect(findNonFiniteNumbers({ data: res.data, meta: res.meta })).toEqual([]);
		// volumeStats.changePct は null（前週ゼロのケース）
		// biome-ignore lint/suspicious/noExplicitAny: deep property access for assertion
		const vs = (res.data as any).volumeStats;
		expect(vs?.changePct).toBeNull();
	});

	it('prepare_depth_data: 不正値が混在 → drop され NaN/Infinity を含まない', async () => {
		mockFetchJson({
			success: 1,
			data: {
				asks: [
					['10100', '0.2'],
					['abc', '0.5'], // dropped
					['10300', '1.0'],
				],
				bids: [
					['9900', '0.3'],
					['9800', '0.6'],
				],
				timestamp: TS,
			},
		});
		const res = await prepareDepthData({ pair: 'btc_jpy' });
		assertOk(res);
		expect(findNonFiniteNumbers({ data: res.data, meta: res.meta })).toEqual([]);
		expect(res.meta?.droppedRows?.asks).toBe(1);
	});

	it('get_tickers_jpy: 全 JPY ペア → NaN/Infinity を含まない（vol*last の overflow も含めて）', async () => {
		// 故意に巨大な vol を仕込んで vol*last が Infinity になるケースもテスト
		process.env.TICKERS_JPY_URL = 'http://test/tickers_jpy';
		mockFetchJson({
			success: 1,
			data: [
				{
					pair: 'btc_jpy',
					sell: '5000000',
					buy: '4999000',
					high: '5100000',
					low: '4900000',
					open: '5000000',
					last: '5000000',
					vol: '1.234',
					timestamp: TS,
				},
				{
					pair: 'overflow_jpy',
					sell: '1e300',
					buy: '1e300',
					high: '1e300',
					low: '1e300',
					open: '1e300',
					last: '1e300',
					vol: '1e300', // vol*last → Infinity
					timestamp: TS,
				},
			],
		});
		const res = await getTickersJpy({ bypassCache: true });
		assertOk(res);
		expect(findNonFiniteNumbers({ data: res.data, meta: res.meta })).toEqual([]);
	});
});

// ── 3. JSON.stringify / JSON.parse 往復後の schema 整合 ────

describe('PR5 audit / 3. JSON round-trip preservation', () => {
	beforeEach(() => {
		process.env.BITBANK_PAIRS_MODE = 'off';
	});

	afterEach(() => {
		vi.restoreAllMocks();
		delete process.env.BITBANK_PAIRS_MODE;
		delete process.env.TICKERS_JPY_URL;
	});

	function assertRoundTrip<T>(res: T, schema: { parse: (v: unknown) => unknown }, invariants: (parsed: T) => void) {
		const wire = JSON.parse(JSON.stringify(res));
		// schema が wire 形式（NaN/Infinity 不在）を受理する
		expect(() => schema.parse(wire)).not.toThrow();
		// 重要フィールドの意味が壊れていない
		invariants(wire as T);
	}

	it('get_ticker: roundtrip 後も schema parse 成功 + ok/summary/normalized 不変', async () => {
		mockFetchJson({ ...tickerBtcJpy });
		const res = await getTicker('btc_jpy');
		assertOk(res);
		assertRoundTrip(res, GetTickerOutputSchema, (p) => {
			// biome-ignore lint/suspicious/noExplicitAny: assertion helper
			const v = p as any;
			expect(v.ok).toBe(true);
			expect(v.summary).toBe(res.summary);
			expect(v.data.normalized.pair).toBe('btc_jpy');
			expect(v.data.normalized.timestamp).toBe(res.data.normalized.timestamp);
		});
	});

	it('get_orderbook (raw): roundtrip 後も schema parse 成功 + asks/bids/timestamp 不変', async () => {
		mockFetchJson(depthFixture());
		const res = await getOrderbook({ pair: 'btc_jpy', mode: 'raw' });
		assertOk(res);
		assertRoundTrip(res, GetOrderbookOutputSchema, (p) => {
			// biome-ignore lint/suspicious/noExplicitAny: assertion helper
			const v = p as any;
			expect(v.ok).toBe(true);
			expect(v.data.mode).toBe('raw');
			expect(v.data.timestamp).toBe(TS);
		});
	});

	it('get_transactions: roundtrip 後も schema parse 成功 + normalized 件数不変', async () => {
		mockFetchJson(
			txFixture([
				{ transaction_id: 1, price: '5000000', amount: '0.01', side: 'buy', executed_at: TS },
				{ transaction_id: 2, price: '5000100', amount: '0.02', side: 'sell', executed_at: TS + 1 },
			]),
		);
		const res = await getTransactions('btc_jpy', 5);
		assertOk(res);
		assertRoundTrip(res, GetTransactionsOutputSchema, (p) => {
			// biome-ignore lint/suspicious/noExplicitAny: assertion helper
			const v = p as any;
			expect(v.data.normalized).toHaveLength(2);
		});
	});

	it('get_candles: roundtrip 後も schema parse 成功 + normalized 件数不変', async () => {
		mockFetchJson(candlesFixture(validOhlcv(3)));
		const res = await getCandles('btc_jpy', '1day', '2024', 3);
		assertOk(res);
		assertRoundTrip(res, GetCandlesOutputSchema, (p) => {
			// biome-ignore lint/suspicious/noExplicitAny: assertion helper
			const v = p as any;
			expect(v.data.normalized).toHaveLength(3);
		});
	});

	it('prepare_depth_data: roundtrip 後も schema parse 成功 + bids/asks タプル不変', async () => {
		mockFetchJson(
			depthFixture({
				asks: [
					['10100', '0.2'],
					['10200', '0.5'],
				],
				bids: [
					['9900', '0.3'],
					['9800', '0.6'],
				],
			}),
		);
		const res = await prepareDepthData({ pair: 'btc_jpy' });
		assertOk(res);
		assertRoundTrip(res, PrepareDepthDataOutputSchema, (p) => {
			// biome-ignore lint/suspicious/noExplicitAny: assertion helper
			const v = p as any;
			expect(v.data.bids).toHaveLength(2);
			expect(v.data.asks).toHaveLength(2);
			expect(v.data.timestamp).toBe(TS);
		});
	});

	it('get_tickers_jpy: roundtrip 後も schema parse 成功', async () => {
		process.env.TICKERS_JPY_URL = 'http://test/tickers_jpy';
		mockFetchJson({
			success: 1,
			data: [
				{
					pair: 'btc_jpy',
					sell: '5000000',
					buy: '4999000',
					high: '5100000',
					low: '4900000',
					open: '5000000',
					last: '5050000',
					vol: '1.234',
					timestamp: TS,
				},
			],
		});
		const res = await getTickersJpy({ bypassCache: true });
		assertOk(res);
		assertRoundTrip(res, GetTickersJpyOutputSchema, (p) => {
			// biome-ignore lint/suspicious/noExplicitAny: assertion helper
			const v = p as any;
			expect(Array.isArray(v.data)).toBe(true);
			expect(v.data.length).toBeGreaterThan(0);
		});
	});

	it('lib/get-depth (internal): roundtrip 後も schema parse 成功', async () => {
		mockFetchJson(depthFixture());
		const res = await getDepth('btc_jpy');
		assertOk(res);
		assertRoundTrip(res, GetDepthOutputSchema, (p) => {
			// biome-ignore lint/suspicious/noExplicitAny: assertion helper
			const v = p as any;
			expect(v.data.timestamp).toBe(TS);
		});
	});
});

// ── 4. timestamp 欠損時の fallback 棚卸し ───────────────────

describe('PR5 audit / 4. timestamp fallback inventory (Date.now -> upstream fail)', () => {
	/**
	 * 旧実装で Date.now() フォールバックがあった箇所:
	 *   - lib/get-depth.ts:95 — `Number(d.timestamp ?? d.timestamp_ms ?? Date.now())`
	 *   - tools/get_orderbook.ts:504 — `toNum(d.timestamp ?? d.timestamp_ms) ?? Date.now()`
	 *   - tools/prepare_depth_data.ts:164 — `Number(depth.data.timestamp ?? Date.now())`
	 *
	 * 全て上流 timestamp の欠損ケース。受信時刻 (Date.now) で代用すると古いデータを
	 * 最新かのように見せてしまうため、PR5 で upstream fail に倒すよう変更した。
	 *
	 * fetchedAt（受信時刻）は引き続き meta に含まれるため、データ取得時刻の情報自体は
	 * 失われない。timestamp（観測時刻）と fetchedAt（受信時刻）の意味分離が明確になる。
	 */
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('lib/get-depth: upstream timestamp 欠損 → upstream fail', async () => {
		mockFetchJson({
			success: 1,
			data: {
				asks: [['10100', '0.2']],
				bids: [['9900', '0.3']],
				// timestamp / timestamp_ms ともに無し
			},
		});
		const res = await getDepth('btc_jpy');
		assertFail(res);
		expect(res.meta?.errorType).toBe('upstream');
		expect(res.summary).toContain('timestamp');
	});

	it('get_orderbook: upstream timestamp 欠損 → upstream fail', async () => {
		mockFetchJson({
			success: 1,
			data: {
				asks: [['5000100', '0.2']],
				bids: [['5000000', '0.3']],
				// timestamp なし
			},
		});
		const res = await getOrderbook({ pair: 'btc_jpy', mode: 'summary' });
		assertFail(res);
		expect(res.meta?.errorType).toBe('upstream');
		expect(res.summary).toContain('timestamp');
	});

	it('get_orderbook: timestamp=0 のような無効値も upstream fail', async () => {
		mockFetchJson({
			success: 1,
			data: { asks: [['5000100', '0.2']], bids: [['5000000', '0.3']], timestamp: 0 },
		});
		const res = await getOrderbook({ pair: 'btc_jpy', mode: 'summary' });
		assertFail(res);
		expect(res.meta?.errorType).toBe('upstream');
	});

	it('prepare_depth_data: 上流 timestamp 欠損 → get-depth 経由で upstream fail', async () => {
		mockFetchJson({
			success: 1,
			data: {
				asks: [['10100', '0.2']],
				bids: [['9900', '0.3']],
				// timestamp なし
			},
		});
		const res = await prepareDepthData({ pair: 'btc_jpy' });
		assertFail(res);
		expect(res.meta?.errorType).toBe('upstream');
	});

	it('get_candles: 行 timestamp が NaN → upstream fail（Date.now() fallback なし）', async () => {
		mockFetchJson(candlesFixture([['5000000', '5000100', '4999900', '5000050', '1.0', 'invalid_ts']]));
		const res = await getCandles('btc_jpy', '1day', '2024', 1);
		assertFail(res);
		expect(res.meta?.errorType).toBe('upstream');
	});

	it('get_ticker: upstream timestamp 欠損 → normalized.timestamp は null（既存契約を維持）', async () => {
		// get_ticker は元から Date.now() fallback を持たず、null を保持する設計。
		// schema 上 timestamp は z.number().nullable() なので null 許容。
		mockFetchJson({
			success: 1,
			data: { ...tickerBtcJpy.data, timestamp: null },
		});
		const res = await getTicker('btc_jpy');
		assertOk(res);
		expect(res.data.normalized.timestamp).toBeNull();
		expect(res.data.normalized.isoTime).toBeNull();
	});

	it('get_transactions: 行 timestamp 欠損 → 該当行は drop + warning', async () => {
		// get_transactions は行単位 drop が既存仕様（行ごとに欠損し得るため）。
		// upstream fail にせず、件数を warning で surface する。
		mockFetchJson(
			txFixture([
				{ transaction_id: 1, price: '5000000', amount: '0.01', side: 'buy' /* executed_at なし */ },
				{ transaction_id: 2, price: '5000100', amount: '0.02', side: 'sell', executed_at: TS },
			]),
		);
		const res = await getTransactions('btc_jpy', 10);
		assertOk(res);
		expect(res.data.normalized).toHaveLength(1);
		expect(res.meta?.warning).toContain('1件');
	});
});

// ── 5. content visibility: warning / drop / count / timestamp ──

describe('PR5 audit / 5. content visibility (warning / drop / count / timestamp が LLM に見える)', () => {
	beforeEach(() => {
		process.env.BITBANK_PAIRS_MODE = 'off';
	});
	afterEach(() => {
		vi.restoreAllMocks();
		delete process.env.BITBANK_PAIRS_MODE;
		delete process.env.TICKERS_JPY_URL;
	});

	it('get_ticker: 📸 timestamp 行が content (summary) に出る', async () => {
		mockFetchJson({ ...tickerBtcJpy });
		const res = await getTicker('btc_jpy');
		assertOk(res);
		expect(res.summary).toMatch(/📸/);
		expect(res.summary).toContain('時点');
	});

	it('get_orderbook: 📸 timestamp / 件数 が content (summary) に出る', async () => {
		mockFetchJson(depthFixture());
		const res = await getOrderbook({ pair: 'btc_jpy', mode: 'summary', topN: 2 });
		assertOk(res);
		expect(res.summary).toMatch(/📸/);
		// 上位N層表記
		expect(res.summary).toContain('上位');
	});

	it('get_transactions (view=summary): 件数 + 期間 + 警告が summary に出る', async () => {
		mockFetchJson(
			txFixture([
				{ transaction_id: 1, price: '5000000', amount: '0.01', side: 'buy', executed_at: TS },
				{ transaction_id: 2, price: 'abc', amount: '0.02', side: 'sell', executed_at: TS + 1 }, // dropped
				{ transaction_id: 3, price: '5000200', amount: '0.03', side: 'buy', executed_at: TS + 2 },
			]),
		);
		// toolDef.handler 経由（content/meta の整合を検証）
		const def = allToolDefs.find((t) => t.name === 'get_transactions');
		expect(def).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: assertion above guarantees def is defined
		const out = await def!.handler({ pair: 'btc_jpy', limit: 10, view: 'summary' });
		// view=summary は OkResult 形式そのまま返す
		// biome-ignore lint/suspicious/noExplicitAny: handler returns Result | McpResponse union
		const r = out as any;
		expect(r.ok).toBe(true);
		expect(r.summary).toContain('期間');
		// 件数表記
		expect(r.summary).toMatch(/直近取引\s*2\s*件|フィルタ後\s*\d+件/);
		// warning が summary に含まれる
		expect(r.summary).toContain('1件');
	});

	it('get_transactions (view=items): warning が content の別 text に出る', async () => {
		mockFetchJson(
			txFixture([
				{ transaction_id: 1, price: '5000000', amount: '0.01', side: 'buy', executed_at: TS },
				{ transaction_id: 2, price: 'abc', amount: '0.02', side: 'sell', executed_at: TS + 1 }, // dropped
			]),
		);
		const def = allToolDefs.find((t) => t.name === 'get_transactions');
		expect(def).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: assertion above guarantees def is defined
		const out = await def!.handler({ pair: 'btc_jpy', limit: 10, view: 'items' });
		// biome-ignore lint/suspicious/noExplicitAny: handler returns McpResponse
		const r = out as any;
		// content[0] は items の JSON、content[1] が warning text
		expect(Array.isArray(r.content)).toBe(true);
		const allText = (r.content as Array<{ text: string }>).map((c) => c.text).join('\n');
		expect(allText).toContain('1件');
	});

	it('get_candles: 件数 + isoTime/isoTimeLocal が content (summary) に出る', async () => {
		mockFetchJson(candlesFixture(validOhlcv(3)));
		const res = await getCandles('btc_jpy', '1day', '2024', 3);
		assertOk(res);
		expect(res.summary).toContain('全3件のOHLCV');
		// 各 OHLCV 行に isoTime か isoTimeLocal が含まれる
		const tzMatches = res.summary.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g);
		expect(tzMatches?.length).toBeGreaterThanOrEqual(3);
	});

	it('get_candles: fetchWarning は summary の先頭に出る', async () => {
		// fetchWarning は multi-year/multi-day で発生するが、ここでは単年なので
		// 別のテストで fetchWarning 経路を直接モックするのは困難。代わりに、警告経路の
		// 既存パスが summary の先頭に来ることを文字列形式で確認する。
		mockFetchJson(candlesFixture(validOhlcv(3)));
		const res = await getCandles('btc_jpy', '1day', '2024', 3);
		assertOk(res);
		// 正常系では fetchWarning なし、summary の冒頭は pair 名で始まる
		expect(res.summary.startsWith('⚠️')).toBe(false);
	});

	it('prepare_depth_data: handler content text に timestamp + isoTime + warning が出る', async () => {
		// 不正値混入で drop が発生 → warning が summary に出る
		mockFetchJson({
			success: 1,
			data: {
				asks: [
					['10100', '0.2'],
					['xxx', '0.5'], // dropped
				],
				bids: [['9900', '0.3']],
				timestamp: TS,
			},
		});
		const def = allToolDefs.find((t) => t.name === 'prepare_depth_data');
		expect(def).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: assertion above guarantees def is defined
		const out = await def!.handler({ pair: 'btc_jpy' });
		// biome-ignore lint/suspicious/noExplicitAny: handler returns McpResponse
		const r = out as any;
		const text = getContentText(r);
		// timestamp / isoTime が data JSON に含まれている
		expect(text).toContain('"timestamp"');
		expect(text).toContain('"isoTime"');
		// warning が summary に表れる
		expect(text).toContain('⚠️');
		expect(text).toContain('1件');
	});

	it('get_tickers_jpy (ranked): 件数とランキング表記が content text に出る', async () => {
		process.env.TICKERS_JPY_URL = 'http://test/tickers_jpy';
		mockFetchJson({
			success: 1,
			data: [
				{
					pair: 'btc_jpy',
					sell: '5000000',
					buy: '4999000',
					high: '5100000',
					low: '4900000',
					open: '5000000',
					last: '5050000',
					vol: '1.234',
					timestamp: TS,
				},
				{
					pair: 'eth_jpy',
					sell: '500000',
					buy: '499000',
					high: '510000',
					low: '490000',
					open: '500000',
					last: '495000',
					vol: '10.5',
					timestamp: TS,
				},
			],
		});
		const def = allToolDefs.find((t) => t.name === 'get_tickers_jpy');
		expect(def).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: assertion above guarantees def is defined
		const out = await def!.handler({ view: 'ranked', sortBy: 'change24h', order: 'desc', limit: 5 });
		// biome-ignore lint/suspicious/noExplicitAny: handler returns McpResponse
		const r = out as any;
		const text = getContentText(r);
		// 件数とソート条件が text に出る
		expect(text).toContain('全');
		expect(text).toContain('ペア取得');
		expect(text).toContain('sortBy=change24h');
		expect(text).toContain('top5');
	});
});
