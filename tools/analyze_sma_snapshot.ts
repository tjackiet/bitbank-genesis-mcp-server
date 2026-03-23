import type { z } from 'zod';
import { today } from '../lib/datetime.js';
import { formatSummary } from '../lib/formatter.js';
import { fail, failFromError, failFromValidation, ok } from '../lib/result.js';
import { createMeta, ensurePair } from '../lib/validate.js';
import {
	type AnalyzeSmaSnapshotDataSchemaOut,
	AnalyzeSmaSnapshotInputSchema,
	AnalyzeSmaSnapshotOutputSchema,
} from '../src/schemas.js';
import type { ToolDefinition } from '../src/tool-definition.js';
import analyzeIndicators from './analyze_indicators.js';

export interface MaLineEntry {
	period: number;
	value: number | null;
	distancePct: number | null;
	distanceAbs: number | null;
	slope: 'rising' | 'falling' | 'flat';
	slopePctPerBar: number | null;
	pricePosition?: 'above' | 'below' | 'equal';
}

export interface CrossStatus {
	a: string;
	b: string;
	type: 'golden' | 'dead';
	delta: number;
}

export interface RecentCrossEntry {
	type: 'golden_cross' | 'dead_cross';
	pair: [number, number];
	barsAgo: number;
	date: string;
}

export interface BuildSmaSnapshotTextInput {
	baseSummary: string;
	type: string;
	maLines: MaLineEntry[];
	crossStatuses: CrossStatus[];
	recentCrosses: RecentCrossEntry[];
}

/** テキスト組み立て（SMAスナップショット）— テスト可能な純粋関数 */
export function buildSmaSnapshotText(input: BuildSmaSnapshotTextInput): string {
	const { baseSummary, type, maLines, crossStatuses, recentCrosses } = input;
	const distanceLines = maLines.map((it) => {
		const valStr = it.value != null ? it.value : 'n/a';
		const pctStr = it.distancePct != null ? `${it.distancePct >= 0 ? '+' : ''}${it.distancePct}%` : 'n/a';
		const absStr =
			it.distanceAbs != null ? `${it.distanceAbs >= 0 ? '+' : ''}${Number(it.distanceAbs).toLocaleString()}円` : 'n/a';
		const slopeRate =
			it.slopePctPerBar != null
				? `${it.slopePctPerBar >= 0 ? '+' : ''}${it.slopePctPerBar}%/${type === '1day' ? 'day' : 'bar'}`
				: null;
		const pos = it.pricePosition
			? it.pricePosition === 'above'
				? '（価格は上）'
				: it.pricePosition === 'below'
					? '（価格は下）'
					: '（同水準）'
			: '';
		return `SMA(${it.period}): ${valStr} (${pctStr}, ${absStr}) slope=${it.slope}${slopeRate ? ` (${slopeRate})` : ''}${pos}`;
	});
	const crossStatusLines = crossStatuses.map((c) => `${c.a}/${c.b}: ${c.type} (delta:${c.delta})`);
	const allRecentLines = recentCrosses.map(
		(rc) => `${rc.type} ${rc.pair.join('/')} - ${rc.barsAgo} bars ago (${rc.date})`,
	);
	return [
		baseSummary,
		'',
		...distanceLines,
		...(crossStatusLines.length ? ['', 'Cross Status:', ...crossStatusLines] : []),
		...(allRecentLines.length ? ['', 'Recent Crosses (all):', ...allRecentLines] : []),
		'',
		'---',
		'📌 含まれるもの: SMA値・傾き・クロス状態・配列パターン・価格との乖離',
		'📌 含まれないもの: 他のテクニカル指標（RSI・MACD・BB・一目均衡表）、出来高フロー、板情報',
		'📌 補完ツール: analyze_indicators（他指標）, analyze_bb_snapshot（BB）, get_flow_metrics（出来高）, get_orderbook（板情報）',
	]
		.filter(Boolean)
		.join('\n');
}

export default async function analyzeSmaSnapshot(
	pair: string = 'btc_jpy',
	type: string = '1day',
	limit: number = 220,
	periods: number[] = [25, 75, 200],
) {
	const chk = ensurePair(pair);
	if (!chk.ok) return failFromValidation(chk, AnalyzeSmaSnapshotOutputSchema);
	try {
		const indRes = await analyzeIndicators(chk.pair, type, Math.max(Math.max(...periods, 200), limit));
		if (!indRes.ok)
			return AnalyzeSmaSnapshotOutputSchema.parse(
				fail(indRes.summary || 'indicators failed', indRes.meta.errorType || 'internal'),
			);

		const close = indRes.data.normalized.at(-1)?.close ?? null;
		const map: Record<string, number | null> = {};
		const indRecord = indRes.data.indicators as Record<string, number[] | number | null>;
		const get = (p: number) => (indRecord[`SMA_${p}`] as number | null) ?? null;
		for (const p of periods) map[`SMA_${p}`] = get(p);

		// Series for slopes/crosses (prefer chart.indicators for complete arrays)
		const chartInd = (indRes?.data?.chart?.indicators ?? {}) as unknown as Record<string, unknown>;
		const candles: Array<{ isoTime?: string | null }> = Array.isArray(indRes?.data?.chart?.candles)
			? indRes.data.chart.candles
			: Array.isArray(indRes?.data?.normalized)
				? indRes.data.normalized
				: [];
		const _lastIdx = Math.max(0, candles.length - 1);

		// Deduplicate periods for cross pair generation
		const uniquePeriods = [...new Set(periods)];

		// Crosses status (current delta sign) and recent cross detection (last 30 bars)
		const crosses: Array<{ a: string; b: string; type: 'golden' | 'dead'; delta: number }> = [];
		const crossPairs: Array<[number, number]> = [];
		for (let i = 0; i < uniquePeriods.length; i++) {
			for (let j = i + 1; j < uniquePeriods.length; j++) crossPairs.push([uniquePeriods[i], uniquePeriods[j]]);
		}
		for (const [a, b] of crossPairs) {
			const va = map[`SMA_${a}`];
			const vb = map[`SMA_${b}`];
			if (va != null && vb != null) {
				const delta = (va as number) - (vb as number);
				crosses.push({
					a: `SMA_${a}`,
					b: `SMA_${b}`,
					type: delta >= 0 ? 'golden' : 'dead',
					delta: Number(delta.toFixed(2)),
				});
			}
		}

		const lookback = 30;
		type RecentCross = { type: 'golden_cross' | 'dead_cross'; pair: [number, number]; barsAgo: number; date: string };
		const recentCrosses: RecentCross[] = [];
		for (const [a, b] of crossPairs) {
			const sa: Array<number | null> = Array.isArray(chartInd?.[`SMA_${a}`])
				? (chartInd[`SMA_${a}`] as Array<number | null>)
				: [];
			const sb: Array<number | null> = Array.isArray(chartInd?.[`SMA_${b}`])
				? (chartInd[`SMA_${b}`] as Array<number | null>)
				: [];
			const n = Math.min(sa.length, sb.length, candles.length);
			if (n < 2) continue;
			const start = Math.max(1, n - lookback);
			for (let i = start; i < n; i++) {
				const prevA = sa[i - 1];
				const prevB = sb[i - 1];
				const curA = sa[i];
				const curB = sb[i];
				if (prevA == null || prevB == null || curA == null || curB == null) continue;
				const prev = prevA - prevB;
				const curr = curA - curB;
				if ((prev <= 0 && curr > 0) || (prev >= 0 && curr < 0)) {
					const type = curr > 0 ? 'golden_cross' : 'dead_cross';
					const barsAgo = n - 1 - i;
					const date = String(candles[i]?.isoTime || '').slice(0, 10) || today('YYYY-MM-DD');
					recentCrosses.push({ type, pair: [a, b], barsAgo, date });
				}
			}
		}

		let alignment: 'bullish' | 'bearish' | 'mixed' | 'unknown' = 'unknown';
		const sortedPeriods = [...new Set(periods)].sort((a, b) => a - b);
		const sortedVals = sortedPeriods.map((p) => map[`SMA_${p}`]);
		if (sortedPeriods.length >= 2 && sortedVals.every((v) => v != null)) {
			const allDesc = sortedVals.every((v, i) => i === 0 || (v as number) < (sortedVals[i - 1] as number));
			const allAsc = sortedVals.every((v, i) => i === 0 || (v as number) > (sortedVals[i - 1] as number));
			if (allDesc) alignment = 'bullish';
			else if (allAsc) alignment = 'bearish';
			else alignment = 'mixed';
		}

		const tags: string[] = [];
		if (alignment === 'bullish') tags.push('sma_bullish_alignment');
		if (alignment === 'bearish') tags.push('sma_bearish_alignment');

		// Position vs all SMAs
		const smaVals = periods.map((p) => map[`SMA_${p}`]).filter((v): v is number => v != null);
		let position: 'above_all' | 'below_all' | 'between' | 'unknown' = 'unknown';
		if (close != null && smaVals.length) {
			const minS = Math.min(...smaVals);
			const maxS = Math.max(...smaVals);
			if (close > maxS) position = 'above_all';
			else if (close < minS) position = 'below_all';
			else position = 'between';
		}

		// Slopes per SMA (use last ~6 bars delta percentage with 0.2% deadband)
		function slopeOfLabel(period: number): 'rising' | 'falling' | 'flat' {
			const s: Array<number | null> = Array.isArray(chartInd?.[`SMA_${period}`])
				? (chartInd[`SMA_${period}`] as Array<number | null>)
				: [];
			const n = s.length;
			if (n < 6) return 'flat';
			// find valid current and 5 bars ago
			let curIdx = n - 1;
			while (curIdx >= 0 && s[curIdx] == null) curIdx--;
			let prevIdx = curIdx - 5;
			while (prevIdx >= 0 && s[prevIdx] == null) prevIdx--;
			if (curIdx < 0 || prevIdx < 0) return 'flat';
			const cur = s[curIdx] as number;
			const prev = s[prevIdx] as number;
			if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return 'flat';
			const pct = (cur - prev) / Math.abs(prev);
			if (pct > 0.002) return 'rising';
			if (pct < -0.002) return 'falling';
			return 'flat';
		}

		// Numeric slope rate (total % over window and %/bar)
		function slopeRates(period: number): {
			pctTotal: number | null;
			pctPerBar: number | null;
			barsWindow: number | null;
		} {
			const s: Array<number | null> = Array.isArray(chartInd?.[`SMA_${period}`])
				? (chartInd[`SMA_${period}`] as Array<number | null>)
				: [];
			const n = s.length;
			if (n < 6) return { pctTotal: null, pctPerBar: null, barsWindow: null };
			let curIdx = n - 1;
			while (curIdx >= 0 && s[curIdx] == null) curIdx--;
			let prevIdx = curIdx - 5;
			while (prevIdx >= 0 && s[prevIdx] == null) prevIdx--;
			if (curIdx < 0 || prevIdx < 0) return { pctTotal: null, pctPerBar: null, barsWindow: null };
			const cur = s[curIdx] as number;
			const prev = s[prevIdx] as number;
			const bars = curIdx - prevIdx;
			if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0 || bars <= 0)
				return { pctTotal: null, pctPerBar: null, barsWindow: null };
			const pctTotal = ((cur - prev) / Math.abs(prev)) * 100;
			const pctPerBar = pctTotal / bars;
			return { pctTotal, pctPerBar, barsWindow: bars };
		}

		// Extended smas object with distancePct/Abs and slope metrics
		const smasExt: Record<
			string,
			{
				value: number | null;
				distancePct: number | null;
				distanceAbs: number | null;
				slope: 'rising' | 'falling' | 'flat';
				slopePctPerBar: number | null;
				slopePctTotal: number | null;
				barsWindow: number | null;
				slopePctPerDay?: number | null;
				pricePosition?: 'above' | 'below' | 'equal';
			}
		> = {};
		for (const p of periods) {
			const val = map[`SMA_${p}`];
			const distancePct =
				close != null && val != null && val !== 0 ? Number((((close - val) / val) * 100).toFixed(2)) : null;
			const distanceAbs = close != null && val != null ? Number((close - val).toFixed(2)) : null;
			const slope = slopeOfLabel(p);
			const rates = slopeRates(p);
			const slopePctPerBar = rates.pctPerBar != null ? Number(rates.pctPerBar.toFixed(3)) : null;
			const slopePctTotal = rates.pctTotal != null ? Number(rates.pctTotal.toFixed(2)) : null;
			const barsWindow = rates.barsWindow;
			const entry: (typeof smasExt)[string] = {
				value: val,
				distancePct,
				distanceAbs,
				slope,
				slopePctPerBar,
				slopePctTotal,
				barsWindow,
			};
			if (type === '1day') entry.slopePctPerDay = slopePctPerBar;
			if (close != null && val != null) entry.pricePosition = close > val ? 'above' : close < val ? 'below' : 'equal';
			smasExt[String(p)] = entry;
		}

		// Multi-line content summary
		const topPeriods = Array.from(new Set(periods)).sort((a, b) => a - b);
		const maLines: MaLineEntry[] = topPeriods.map((p) => {
			const it = smasExt[String(p)];
			return {
				period: p,
				value: it?.value ?? null,
				distancePct: it?.distancePct ?? null,
				distanceAbs: it?.distanceAbs ?? null,
				slope: it?.slope ?? 'flat',
				slopePctPerBar: it?.slopePctPerBar ?? null,
				pricePosition: it?.pricePosition,
			};
		});
		const summaryText = buildSmaSnapshotText({
			baseSummary: formatSummary({
				pair: chk.pair,
				latest: close ?? undefined,
				extra: `align=${alignment} pos=${position}`,
			}),
			type,
			maLines,
			crossStatuses: crosses,
			recentCrosses,
		});

		const data: z.infer<typeof AnalyzeSmaSnapshotDataSchemaOut> = {
			latest: { close },
			sma: map,
			crosses,
			alignment,
			tags,
			// Extended block (kept backward-compatible)
			summary: { close, align: alignment, position },
			smas: smasExt,
			recentCrosses,
		};
		const meta = createMeta(chk.pair, { type, count: indRes.data.normalized.length, periods });
		return AnalyzeSmaSnapshotOutputSchema.parse(ok(summaryText, data, meta));
	} catch (e: unknown) {
		return failFromError(e, { schema: AnalyzeSmaSnapshotOutputSchema });
	}
}

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'analyze_sma_snapshot',
	description:
		'[SMA / Moving Average / Golden Cross] SMA（simple moving average / golden cross / dead cross）の数値スナップショット。最新値・クロス検出・整列状態（bullish/bearish/mixed）。\n\n⚠️ 最新値のみ。時系列チャート描画 → prepare_chart_data（indicators: ["SMA_25","SMA_75"] 等）。',
	inputSchema: AnalyzeSmaSnapshotInputSchema,
	handler: async ({
		pair,
		type,
		limit,
		periods,
	}: {
		pair?: string;
		type?: string;
		limit?: number;
		periods?: number[];
	}) => analyzeSmaSnapshot(pair, type, limit, periods),
};
