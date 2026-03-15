import type { z } from 'zod';
import { today } from '../lib/datetime.js';
import { formatSummary } from '../lib/formatter.js';
import { fail, failFromError, failFromValidation, ok } from '../lib/result.js';
import { createMeta, ensurePair } from '../lib/validate.js';
import {
	type AnalyzeEmaSnapshotDataSchemaOut,
	AnalyzeEmaSnapshotInputSchema,
	AnalyzeEmaSnapshotOutputSchema,
} from '../src/schemas.js';
import type { ToolDefinition } from '../src/tool-definition.js';
import analyzeIndicators, { ema } from './analyze_indicators.js';
import getCandles from './get_candles.js';

const FIXED_EMA_PERIODS = [12, 26, 50, 200] as const;

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

export interface BuildEmaSnapshotTextInput {
	baseSummary: string;
	type: string;
	maLines: MaLineEntry[];
	crossStatuses: CrossStatus[];
	recentCrosses: RecentCrossEntry[];
}

/** テキスト組み立て（EMAスナップショット）— テスト可能な純粋関数 */
export function buildEmaSnapshotText(input: BuildEmaSnapshotTextInput): string {
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
		return `EMA(${it.period}): ${valStr} (${pctStr}, ${absStr}) slope=${it.slope}${slopeRate ? ` (${slopeRate})` : ''}${pos}`;
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
		'📌 含まれるもの: EMA値・傾き・クロス状態・配列パターン・価格との乖離',
		'📌 含まれないもの: SMA・RSI・MACD・BB・一目均衡表、出来高フロー、板情報',
		'📌 補完ツール: analyze_sma_snapshot（SMA）, analyze_indicators（他指標）, analyze_bb_snapshot（BB）, get_flow_metrics（出来高）',
	]
		.filter(Boolean)
		.join('\n');
}

export default async function analyzeEmaSnapshot(
	pair: string = 'btc_jpy',
	type: string = '1day',
	limit: number = 220,
	periods: number[] = [12, 26, 50, 200],
) {
	const chk = ensurePair(pair);
	if (!chk.ok) return failFromValidation(chk, AnalyzeEmaSnapshotOutputSchema);
	try {
		const maxPeriod = Math.max(...periods, 200);
		const fetchLimit = Math.max(maxPeriod, limit);

		const hasCustomPeriods = periods.some((p) => !(FIXED_EMA_PERIODS as readonly number[]).includes(p));

		let close: number | null = null;
		let chartInd: any = {};
		let candles: Array<{ isoTime?: string | null }> = [];
		let normalizedLen = 0;
		const map: Record<string, number | null> = {};

		if (hasCustomPeriods) {
			const candlesResult = await getCandles(chk.pair, type, undefined, fetchLimit);
			if (!candlesResult.ok)
				return AnalyzeEmaSnapshotOutputSchema.parse(
					fail(candlesResult.summary || 'candles failed', candlesResult.meta.errorType || 'internal'),
				);
			const normalized = candlesResult.data.normalized;
			const allCloses = normalized.map((c) => c.close);
			close = allCloses.at(-1) ?? null;
			candles = normalized;
			normalizedLen = normalized.length;

			for (const p of periods) {
				const series = ema(allCloses, p);
				const key = `EMA_${p}`;
				map[key] = series.at(-1) ?? null;
				chartInd[key] = series;
			}
		} else {
			const indRes = await analyzeIndicators(chk.pair, type, fetchLimit);
			if (!indRes.ok)
				return AnalyzeEmaSnapshotOutputSchema.parse(
					fail(indRes.summary || 'indicators failed', indRes.meta.errorType || 'internal'),
				);
			close = indRes.data.normalized.at(-1)?.close ?? null;
			chartInd = indRes?.data?.chart?.indicators || {};
			candles = Array.isArray(indRes?.data?.chart?.candles)
				? indRes.data.chart.candles
				: Array.isArray(indRes?.data?.normalized)
					? indRes.data.normalized
					: [];
			normalizedLen = indRes.data.normalized.length;

			const indRecord = indRes.data.indicators as Record<string, number[] | number | null>;
			for (const p of periods) {
				const key = `EMA_${p}`;
				map[key] = (indRecord[key] as number | null) ?? null;
				if (!chartInd[key]) {
					chartInd[key] = indRecord[`ema_${p}_series`] ?? [];
				}
			}
		}

		const _lastIdx = Math.max(0, candles.length - 1);

		const crosses: Array<{ a: string; b: string; type: 'golden' | 'dead'; delta: number }> = [];
		const crossPairs: Array<[number, number]> = [];
		const uniquePeriods = [...new Set(periods)];
		for (let i = 0; i < uniquePeriods.length; i++) {
			for (let j = i + 1; j < uniquePeriods.length; j++) crossPairs.push([uniquePeriods[i], uniquePeriods[j]]);
		}
		for (const [a, b] of crossPairs) {
			const va = map[`EMA_${a}`];
			const vb = map[`EMA_${b}`];
			if (va != null && vb != null) {
				const delta = (va as number) - (vb as number);
				crosses.push({
					a: `EMA_${a}`,
					b: `EMA_${b}`,
					type: delta >= 0 ? 'golden' : 'dead',
					delta: Number(delta.toFixed(2)),
				});
			}
		}

		const lookback = 30;
		type RecentCross = { type: 'golden_cross' | 'dead_cross'; pair: [number, number]; barsAgo: number; date: string };
		const recentCrosses: RecentCross[] = [];
		for (const [a, b] of crossPairs) {
			const sa: Array<number | null> = Array.isArray(chartInd?.[`EMA_${a}`]) ? chartInd[`EMA_${a}`] : [];
			const sb: Array<number | null> = Array.isArray(chartInd?.[`EMA_${b}`]) ? chartInd[`EMA_${b}`] : [];
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
					const crossType = curr > 0 ? 'golden_cross' : 'dead_cross';
					const barsAgo = n - 1 - i;
					const date = String(candles[i]?.isoTime || '').slice(0, 10) || today('YYYY-MM-DD');
					recentCrosses.push({ type: crossType, pair: [a, b], barsAgo, date });
				}
			}
		}

		const sorted = [...new Set(periods)].sort((a, b) => a - b);
		let alignment: 'bullish' | 'bearish' | 'mixed' | 'unknown' = 'unknown';
		const vals = sorted.map((p) => map[`EMA_${p}`]);
		const allPresent = vals.every((v): v is number => v != null);
		if (allPresent && vals.length >= 3) {
			const numVals = vals as number[];
			const allDesc = numVals.every((v, i) => i === 0 || v <= numVals[i - 1]);
			const allAsc = numVals.every((v, i) => i === 0 || v >= numVals[i - 1]);
			if (allDesc) alignment = 'bullish';
			else if (allAsc) alignment = 'bearish';
			else alignment = 'mixed';
		}

		const tags: string[] = [];
		if (alignment === 'bullish') tags.push('ema_bullish_alignment');
		if (alignment === 'bearish') tags.push('ema_bearish_alignment');

		const emaVals = periods.map((p) => map[`EMA_${p}`]).filter((v): v is number => v != null);
		let position: 'above_all' | 'below_all' | 'between' | 'unknown' = 'unknown';
		if (close != null && emaVals.length) {
			const minE = Math.min(...emaVals);
			const maxE = Math.max(...emaVals);
			if (close > maxE) position = 'above_all';
			else if (close < minE) position = 'below_all';
			else position = 'between';
		}

		function slopeOfLabel(period: number): 'rising' | 'falling' | 'flat' {
			const s: Array<number | null> = Array.isArray(chartInd?.[`EMA_${period}`]) ? chartInd[`EMA_${period}`] : [];
			const n = s.length;
			if (n < 6) return 'flat';
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

		function slopeRates(period: number): {
			pctTotal: number | null;
			pctPerBar: number | null;
			barsWindow: number | null;
		} {
			const s: Array<number | null> = Array.isArray(chartInd?.[`EMA_${period}`]) ? chartInd[`EMA_${period}`] : [];
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

		const emasExt: Record<
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
			const val = map[`EMA_${p}`];
			const distancePct =
				close != null && val != null && val !== 0 ? Number((((close - val) / val) * 100).toFixed(2)) : null;
			const distanceAbs = close != null && val != null ? Number((close - val).toFixed(2)) : null;
			const slope = slopeOfLabel(p);
			const rates = slopeRates(p);
			const slopePctPerBar = rates.pctPerBar != null ? Number(rates.pctPerBar.toFixed(3)) : null;
			const slopePctTotal = rates.pctTotal != null ? Number(rates.pctTotal.toFixed(2)) : null;
			const barsWindow = rates.barsWindow;
			const entry: any = { value: val, distancePct, distanceAbs, slope, slopePctPerBar, slopePctTotal, barsWindow };
			if (type === '1day') entry.slopePctPerDay = slopePctPerBar;
			if (close != null && val != null) entry.pricePosition = close > val ? 'above' : close < val ? 'below' : 'equal';
			emasExt[String(p)] = entry;
		}

		const topPeriods = Array.from(new Set(periods)).sort((a, b) => a - b);
		const maLines: MaLineEntry[] = topPeriods.map((p) => {
			const it = emasExt[String(p)];
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
		const summaryText = buildEmaSnapshotText({
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

		const data: z.infer<typeof AnalyzeEmaSnapshotDataSchemaOut> = {
			latest: { close },
			ema: map,
			crosses,
			alignment,
			tags,
			summary: { close, align: alignment, position },
			emas: emasExt,
			recentCrosses,
		};
		const meta = createMeta(chk.pair, { type, count: normalizedLen, periods });
		return AnalyzeEmaSnapshotOutputSchema.parse(ok(summaryText, data, meta));
	} catch (e: unknown) {
		return failFromError(e, { schema: AnalyzeEmaSnapshotOutputSchema });
	}
}

export const toolDef: ToolDefinition = {
	name: 'analyze_ema_snapshot',
	description:
		'[EMA / Exponential Moving Average] EMA（exponential moving average / trend / slope）の最新値・整列・クロス・傾きを返す（既定: 12/26/50/200）。',
	inputSchema: AnalyzeEmaSnapshotInputSchema,
	handler: async ({ pair, type, limit, periods }: any) => analyzeEmaSnapshot(pair, type, limit, periods),
};
