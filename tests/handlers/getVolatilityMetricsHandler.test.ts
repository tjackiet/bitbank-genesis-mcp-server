import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../tools/get_volatility_metrics.js', () => ({
	default: vi.fn(),
}));

import {
	buildVolatilityBeginnerText,
	buildVolatilityDetailedText,
	buildVolatilitySummaryText,
	toolDef,
	type VolDetailedInput,
	type VolViewInput,
} from '../../src/handlers/getVolatilityMetricsHandler.js';
import getVolatilityMetrics from '../../tools/get_volatility_metrics.js';

const mockedGetVolatilityMetrics = vi.mocked(getVolatilityMetrics);

afterEach(() => {
	vi.clearAllMocks();
});

// ─── 共通フィクスチャ ─────────────────────────────────────────────────────────

function makeViewInput(overrides: Partial<VolViewInput> = {}): VolViewInput {
	return {
		pair: 'btc_jpy',
		type: '1day',
		lastClose: 10_000_000,
		ann: true,
		annFactor: Math.sqrt(365),
		annFactorFull: Math.sqrt(365),
		sampleSize: 100,
		rvAnn: 0.6,
		pkAnn: 0.55,
		gkAnn: 0.58,
		rsAnn: 0.52,
		atrAbs: 300_000,
		atrPct: 0.03,
		tagsAll: ['high_vol'],
		rolling: [
			{ window: 7, rv_std: 0.03, rv_std_ann: 0.57 },
			{ window: 30, rv_std: 0.028, rv_std_ann: 0.53 },
		],
		...overrides,
	};
}

// ─── buildVolatilityBeginnerText ──────────────────────────────────────────────

describe('buildVolatilityBeginnerText', () => {
	it('ペア名と時間軸が含まれる', () => {
		const text = buildVolatilityBeginnerText(makeViewInput());
		expect(text).toContain('BTC_JPY');
		expect(text).toContain('[1day]');
	});

	it('年間の動き・1日の動きのラベルが含まれる', () => {
		const text = buildVolatilityBeginnerText(makeViewInput());
		expect(text).toContain('年間のおおよその動き');
		expect(text).toContain('1日の平均的な動き');
	});

	it('tagsAll が空のときタグ行が出ない', () => {
		const text = buildVolatilityBeginnerText(makeViewInput({ tagsAll: [] }));
		expect(text).not.toContain('今の傾向');
	});

	it('tagsAll がある時タグ行が出る', () => {
		const text = buildVolatilityBeginnerText(makeViewInput({ tagsAll: ['high_vol', 'expanding_vol'] }));
		expect(text).toContain('今の傾向');
		expect(text).toContain('high vol');
	});
});

// ─── buildVolatilitySummaryText ───────────────────────────────────────────────

describe('buildVolatilitySummaryText', () => {
	it('全メトリクス（RV/ATR/PK/GK/RS）が含まれる', () => {
		const text = buildVolatilitySummaryText(makeViewInput());
		expect(text).toContain('RV=');
		expect(text).toContain('ATR=');
		expect(text).toContain('PK=');
		expect(text).toContain('GK=');
		expect(text).toContain('RS=');
	});

	it('Tags が含まれる', () => {
		const text = buildVolatilitySummaryText(makeViewInput({ tagsAll: ['low_vol'] }));
		expect(text).toContain('Tags: low_vol');
	});

	it('sampleSize が含まれる', () => {
		const text = buildVolatilitySummaryText(makeViewInput({ sampleSize: 200 }));
		expect(text).toContain('samples=200');
	});
});

// ─── buildVolatilityDetailedText ─────────────────────────────────────────────

describe('buildVolatilityDetailedText', () => {
	function makeDetailed(overrides: Partial<VolDetailedInput> = {}): VolDetailedInput {
		return {
			...makeViewInput(),
			series: {
				ts: [1700000000000, 1700086400000],
				close: [9_900_000, 10_000_000],
				ret: [0.01, 0.005],
			},
			...overrides,
		};
	}

	it('detailed view: Volatility Metrics ブロックが出る', () => {
		const text = buildVolatilityDetailedText(makeDetailed(), 'detailed');
		expect(text).toContain('Volatility Metrics');
		expect(text).toContain('RV (std)');
		expect(text).toContain('Parkinson');
	});

	it('detailed view: Rolling Trends ブロックが出る', () => {
		const text = buildVolatilityDetailedText(makeDetailed(), 'detailed');
		expect(text).toContain('Rolling Trends');
		expect(text).toContain('7-day RV');
		expect(text).toContain('30-day RV');
	});

	it('full view: Series ブロックが追加される', () => {
		const text = buildVolatilityDetailedText(makeDetailed(), 'full');
		expect(text).toContain('Series');
		expect(text).toContain('Total:');
	});

	it('detailed view: Series ブロックが出ない', () => {
		const text = buildVolatilityDetailedText(makeDetailed(), 'detailed');
		expect(text).not.toContain('【Series】');
	});

	it('ローリングウィンドウのトレンド矢印が含まれる', () => {
		const text = buildVolatilityDetailedText(makeDetailed(), 'detailed');
		// 短期(7d)の rv_std_ann=0.57 > 長期(30d)の rv_std_ann=0.53 → ⬆ か ⬆⬆
		expect(text).toMatch(/7-day RV:.*⬆/);
	});

	it('annualize=false の場合ラベルに (annualized) が付かない', () => {
		const text = buildVolatilityDetailedText(makeDetailed({ ann: false }), 'detailed');
		expect(text).not.toContain('(annualized)');
	});
});

// ─── handler: タグ導出ロジック ────────────────────────────────────────────────

describe('toolDef handler - タグ導出', () => {
	function mockVolRes(opts: {
		rvStd?: number;
		rvStdAnn?: number;
		rolling?: Array<{ window: number; rv_std: number; rv_std_ann?: number }>;
		tags?: string[];
	}) {
		return {
			ok: true,
			summary: 'ok',
			data: {
				aggregates: {
					rv_std: opts.rvStd ?? 0.03,
					rv_std_ann: opts.rvStdAnn,
					atr: 300_000,
				},
				rolling: opts.rolling ?? [
					{ window: 7, rv_std: 0.03, rv_std_ann: 0.57 },
					{ window: 30, rv_std: 0.028, rv_std_ann: 0.53 },
				],
				tags: opts.tags ?? [],
				series: {
					ts: [1700000000000],
					close: [10_000_000],
					ret: [0.01],
				},
				meta: {
					annualize: true,
					baseIntervalMs: 86_400_000,
					sampleSize: 100,
				},
			},
			meta: {},
		};
	}

	it('short RV > long RV × 1.05 → expanding_vol タグが追加される', async () => {
		mockedGetVolatilityMetrics.mockResolvedValueOnce(
			mockVolRes({
				rolling: [
					{ window: 7, rv_std: 0.04, rv_std_ann: 0.76 }, // 短期高い
					{ window: 30, rv_std: 0.028, rv_std_ann: 0.53 }, // 長期低い
				],
			}) as never,
		);
		const res = await toolDef.handler({ pair: 'btc_jpy', type: '1day', limit: 100, view: 'summary' });
		const sc = (res as { structuredContent: { data: { tags: string[] } } }).structuredContent;
		expect(sc.data.tags).toContain('expanding_vol');
	});

	it('short RV < long RV × 0.95 → contracting_vol タグが追加される', async () => {
		mockedGetVolatilityMetrics.mockResolvedValueOnce(
			mockVolRes({
				rolling: [
					{ window: 7, rv_std: 0.01, rv_std_ann: 0.19 }, // 短期低い
					{ window: 30, rv_std: 0.04, rv_std_ann: 0.76 }, // 長期高い
				],
			}) as never,
		);
		const res = await toolDef.handler({ pair: 'btc_jpy', type: '1day', limit: 100, view: 'summary' });
		const sc = (res as { structuredContent: { data: { tags: string[] } } }).structuredContent;
		expect(sc.data.tags).toContain('contracting_vol');
	});

	it('rvAnnForTags > 0.5 → high_vol タグが追加される', async () => {
		mockedGetVolatilityMetrics.mockResolvedValueOnce(mockVolRes({ rvStdAnn: 0.6 }) as never);
		const res = await toolDef.handler({ pair: 'btc_jpy', type: '1day', limit: 100, view: 'summary' });
		const sc = (res as { structuredContent: { data: { tags: string[] } } }).structuredContent;
		expect(sc.data.tags).toContain('high_vol');
	});

	it('rvAnnForTags < 0.2 → low_vol タグが追加される', async () => {
		mockedGetVolatilityMetrics.mockResolvedValueOnce(mockVolRes({ rvStdAnn: 0.1 }) as never);
		const res = await toolDef.handler({ pair: 'btc_jpy', type: '1day', limit: 100, view: 'summary' });
		const sc = (res as { structuredContent: { data: { tags: string[] } } }).structuredContent;
		expect(sc.data.tags).toContain('low_vol');
	});

	it('annualize=false でも tags は年率換算値で判定される（annFactorFull を使用）', async () => {
		// rv_std=0.03 で baseIntervalMs=1day → annFactorFull=sqrt(365)≈19.1
		// rv_std_ann = 0.03 * 19.1 ≈ 0.573 > 0.5 → high_vol
		mockedGetVolatilityMetrics.mockResolvedValueOnce(mockVolRes({ rvStd: 0.03, rvStdAnn: undefined }) as never);
		const res = await toolDef.handler({ pair: 'btc_jpy', type: '1day', limit: 100, annualize: false, view: 'summary' });
		const sc = (res as { structuredContent: { data: { tags: string[] } } }).structuredContent;
		expect(sc.data.tags).toContain('high_vol');
	});
});

// ─── handler: ビュー切り替え ──────────────────────────────────────────────────

describe('toolDef handler - view routing', () => {
	function mockOkRes() {
		return {
			ok: true,
			summary: 'ok',
			data: {
				aggregates: { rv_std: 0.02, rv_std_ann: 0.38, atr: 200_000 },
				rolling: [
					{ window: 7, rv_std: 0.022, rv_std_ann: 0.42 },
					{ window: 30, rv_std: 0.019, rv_std_ann: 0.36 },
				],
				tags: [],
				series: {
					ts: [1700000000000],
					close: [5_000_000],
					ret: [0.005],
				},
				meta: {
					annualize: true,
					baseIntervalMs: 86_400_000,
					sampleSize: 50,
				},
			},
			meta: {},
		};
	}

	it('view=beginner のテキストには 1日の平均的な動き が含まれる', async () => {
		mockedGetVolatilityMetrics.mockResolvedValueOnce(mockOkRes() as never);
		const res = await toolDef.handler({ pair: 'btc_jpy', type: '1day', limit: 50, view: 'beginner' });
		const text = (res as { content: Array<{ text: string }> }).content[0].text;
		expect(text).toContain('1日の平均的な動き');
	});

	it('view=summary のテキストには RV= が含まれる', async () => {
		mockedGetVolatilityMetrics.mockResolvedValueOnce(mockOkRes() as never);
		const res = await toolDef.handler({ pair: 'btc_jpy', type: '1day', limit: 50, view: 'summary' });
		const text = (res as { content: Array<{ text: string }> }).content[0].text;
		expect(text).toContain('RV=');
	});

	it('view=detailed のテキストには Rolling Trends が含まれる', async () => {
		mockedGetVolatilityMetrics.mockResolvedValueOnce(mockOkRes() as never);
		const res = await toolDef.handler({ pair: 'btc_jpy', type: '1day', limit: 50, view: 'detailed' });
		const text = (res as { content: Array<{ text: string }> }).content[0].text;
		expect(text).toContain('Rolling Trends');
	});

	it('view=full のテキストには Series が含まれる', async () => {
		mockedGetVolatilityMetrics.mockResolvedValueOnce(mockOkRes() as never);
		const res = await toolDef.handler({ pair: 'btc_jpy', type: '1day', limit: 50, view: 'full' });
		const text = (res as { content: Array<{ text: string }> }).content[0].text;
		expect(text).toContain('Series');
	});

	it('res.ok=false はそのまま返す', async () => {
		mockedGetVolatilityMetrics.mockResolvedValueOnce({ ok: false, summary: 'err' } as never);
		const res = await toolDef.handler({ pair: 'btc_jpy', type: '1day', limit: 50 });
		expect((res as { ok: boolean }).ok).toBe(false);
	});
});
