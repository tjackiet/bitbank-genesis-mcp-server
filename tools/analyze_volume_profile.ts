/**
 * analyze_volume_profile — 約定データから Volume Profile + VWAP + 約定サイズ分布を算出
 *
 * 内部で getTransactions を呼び出し、get_flow_metrics と同様のマージ戦略で
 * 約定データを収集。そこから3つの指標を導出する:
 *
 * 1. VWAP (出来高加重平均価格) + ±1σ/2σ バンド
 * 2. Volume Profile (価格帯別出来高分布 + POC + Value Area)
 * 3. Trade Size Distribution (約定サイズ別の分類 + 大口偏り)
 */

import getTransactions from './get_transactions.js';
import { ok, fail, failFromError, failFromValidation } from '../lib/result.js';
import { createMeta, ensurePair, validateLimit } from '../lib/validate.js';
import { formatPair, formatPrice, formatPercent } from '../lib/formatter.js';
import { toIsoWithTz, toDisplayTime, dayjs } from '../lib/datetime.js';
import { median } from '../lib/math.js';
import { AnalyzeVolumeProfileInputSchema, AnalyzeVolumeProfileOutputSchema } from '../src/schemas.js';
import type { ToolDefinition } from '../src/tool-definition.js';

type Tx = { price: number; amount: number; side: 'buy' | 'sell'; timestampMs: number; isoTime: string };

// ── Transaction fetch helpers (shared pattern with get_flow_metrics) ──

function mergeTxResults(results: unknown[]): Tx[] {
	const seen = new Set<string>();
	const merged: Tx[] = [];
	for (const res of results) {
		const r = res as { ok?: boolean; data?: { normalized?: Tx[] } } | null;
		if (r?.ok && Array.isArray(r.data?.normalized)) {
			for (const tx of r.data.normalized as Tx[]) {
				const key = `${tx.timestampMs}:${tx.price}:${tx.amount}:${tx.side}`;
				if (!seen.has(key)) {
					seen.add(key);
					merged.push(tx);
				}
			}
		}
	}
	return merged;
}

async function fetchTransactions(pair: string, hours?: number, limit?: number): Promise<Tx[]> {
	if (hours != null && hours > 0) {
		const nowMs = Date.now();
		const sinceMs = nowMs - hours * 3600_000;
		const sinceDayjs = dayjs(sinceMs).tz('Asia/Tokyo');
		const nowDayjs = dayjs(nowMs).tz('Asia/Tokyo');

		const dates: string[] = [];
		let d = sinceDayjs.startOf('day');
		while (d.isBefore(nowDayjs) || d.isSame(nowDayjs, 'day')) {
			dates.push(d.format('YYYYMMDD'));
			d = d.add(1, 'day');
		}

		const fetches: Promise<unknown>[] = dates.map(ds => getTransactions(pair, 1000, ds));
		fetches.push(getTransactions(pair, 1000));
		const results = await Promise.all(fetches);
		return mergeTxResults(results)
			.filter(t => t.timestampMs >= sinceMs && t.timestampMs <= nowMs)
			.sort((a, b) => a.timestampMs - b.timestampMs);
	}

	// Count-based
	const lim = limit ?? 500;
	const latestRes = await getTransactions(pair, Math.min(lim, 1000));
	const latestTxs = ((latestRes as any)?.ok ? (latestRes as any).data.normalized : []) as Tx[];
	if (latestTxs.length >= lim) return latestTxs.slice(-lim);

	// Supplement with previous days
	const todayJst = dayjs().tz('Asia/Tokyo');
	const supplementFetches: Promise<unknown>[] = [
		getTransactions(pair, 1000, todayJst.subtract(1, 'day').format('YYYYMMDD')),
	];
	if (lim > 500) {
		supplementFetches.push(
			getTransactions(pair, 1000, todayJst.subtract(2, 'day').format('YYYYMMDD'))
		);
	}
	const supplementResults = await Promise.all(supplementFetches);
	return mergeTxResults([latestRes, ...supplementResults])
		.sort((a, b) => a.timestampMs - b.timestampMs)
		.slice(-lim);
}

// ── VWAP Calculation ──

function calcVwap(txs: Tx[]) {
	let sumPV = 0;
	let sumV = 0;
	for (const t of txs) {
		sumPV += t.price * t.amount;
		sumV += t.amount;
	}
	const vwap = sumV > 0 ? sumPV / sumV : 0;

	// Weighted standard deviation
	let sumWeightedSqDiff = 0;
	for (const t of txs) {
		sumWeightedSqDiff += t.amount * (t.price - vwap) ** 2;
	}
	const stdDev = sumV > 0 ? Math.sqrt(sumWeightedSqDiff / sumV) : 0;

	return { vwap, stdDev };
}

// ── Volume Profile Calculation ──

function calcVolumeProfile(txs: Tx[], bins: number, valueAreaPct: number) {
	const prices = txs.map(t => t.price);
	const priceLow = Math.min(...prices);
	const priceHigh = Math.max(...prices);
	const range = priceHigh - priceLow;

	// Guard against zero range (all trades at same price)
	const step = range > 0 ? range / bins : 1;
	const adjustedLow = range > 0 ? priceLow : priceLow - bins / 2;

	const profileBins: Array<{
		low: number; high: number; buyVolume: number; sellVolume: number; totalVolume: number;
	}> = [];
	for (let i = 0; i < bins; i++) {
		profileBins.push({
			low: adjustedLow + i * step,
			high: adjustedLow + (i + 1) * step,
			buyVolume: 0, sellVolume: 0, totalVolume: 0,
		});
	}

	// Distribute trades into bins
	for (const t of txs) {
		let idx = range > 0 ? Math.floor((t.price - adjustedLow) / step) : Math.floor(bins / 2);
		if (idx >= bins) idx = bins - 1;
		if (idx < 0) idx = 0;
		if (t.side === 'buy') profileBins[idx].buyVolume += t.amount;
		else profileBins[idx].sellVolume += t.amount;
		profileBins[idx].totalVolume += t.amount;
	}

	const totalVolume = profileBins.reduce((s, b) => s + b.totalVolume, 0);

	// POC (Point of Control): bin with highest volume
	let pocIdx = 0;
	let pocVol = 0;
	for (let i = 0; i < profileBins.length; i++) {
		if (profileBins[i].totalVolume > pocVol) {
			pocVol = profileBins[i].totalVolume;
			pocIdx = i;
		}
	}
	const pocPrice = (profileBins[pocIdx].low + profileBins[pocIdx].high) / 2;

	// Value Area: expand from POC until covering valueAreaPct of total volume
	const targetVol = totalVolume * valueAreaPct;
	let vaVol = profileBins[pocIdx].totalVolume;
	let vaLow = pocIdx;
	let vaHigh = pocIdx;
	while (vaVol < targetVol && (vaLow > 0 || vaHigh < bins - 1)) {
		const lowCandidate = vaLow > 0 ? profileBins[vaLow - 1].totalVolume : -1;
		const highCandidate = vaHigh < bins - 1 ? profileBins[vaHigh + 1].totalVolume : -1;
		if (lowCandidate >= highCandidate && lowCandidate >= 0) {
			vaLow--;
			vaVol += profileBins[vaLow].totalVolume;
		} else if (highCandidate >= 0) {
			vaHigh++;
			vaVol += profileBins[vaHigh].totalVolume;
		} else {
			break;
		}
	}

	const isJpy = true; // This tool always operates on JPY pairs primarily
	const fmtBin = (b: typeof profileBins[0]) => {
		const lo = isJpy ? Math.round(b.low).toLocaleString() : b.low.toFixed(2);
		const hi = isJpy ? Math.round(b.high).toLocaleString() : b.high.toFixed(2);
		return `${lo}〜${hi}`;
	};

	return {
		bins: profileBins.map((b, i) => ({
			low: Number(b.low.toFixed(2)),
			high: Number(b.high.toFixed(2)),
			label: fmtBin(b),
			buyVolume: Number(b.buyVolume.toFixed(8)),
			sellVolume: Number(b.sellVolume.toFixed(8)),
			totalVolume: Number(b.totalVolume.toFixed(8)),
			pct: totalVolume > 0 ? Number(((b.totalVolume / totalVolume) * 100).toFixed(1)) : 0,
			dominant: b.buyVolume > b.sellVolume * 1.2 ? 'buy' as const
				: b.sellVolume > b.buyVolume * 1.2 ? 'sell' as const
				: 'balanced' as const,
		})),
		poc: {
			price: Number(pocPrice.toFixed(2)),
			volume: Number(pocVol.toFixed(8)),
			binIndex: pocIdx,
		},
		valueArea: {
			high: Number(profileBins[vaHigh].high.toFixed(2)),
			low: Number(profileBins[vaLow].low.toFixed(2)),
			volume: Number(vaVol.toFixed(8)),
			pct: totalVolume > 0 ? Number(((vaVol / totalVolume) * 100).toFixed(1)) : 0,
		},
	};
}

// ── Trade Size Distribution ──

function calcTradeSizeDistribution(txs: Tx[]) {
	const amounts = txs.map(t => t.amount).sort((a, b) => a - b);
	const p25 = amounts[Math.floor(amounts.length * 0.25)] ?? 0;
	const p75 = amounts[Math.floor(amounts.length * 0.75)] ?? 0;
	const p95 = amounts[Math.floor(amounts.length * 0.95)] ?? 0;

	const categories = [
		{ label: '小口', minSize: 0, maxSize: p25, filter: (a: number) => a <= p25 },
		{ label: '中口', minSize: p25, maxSize: p75, filter: (a: number) => a > p25 && a <= p75 },
		{ label: '大口', minSize: p75, maxSize: p95, filter: (a: number) => a > p75 && a <= p95 },
		{ label: '特大口', minSize: p95, maxSize: null as number | null, filter: (a: number) => a > p95 },
	];

	const totalVolume = txs.reduce((s, t) => s + t.amount, 0);

	const result = categories.map(c => {
		const matching = txs.filter(t => c.filter(t.amount));
		const vol = matching.reduce((s, t) => s + t.amount, 0);
		const buyVol = matching.filter(t => t.side === 'buy').reduce((s, t) => s + t.amount, 0);
		const sellVol = matching.filter(t => t.side === 'sell').reduce((s, t) => s + t.amount, 0);
		return {
			label: c.label,
			minSize: Number(c.minSize.toFixed(8)),
			maxSize: c.maxSize != null ? Number(c.maxSize.toFixed(8)) : null,
			count: matching.length,
			volume: Number(vol.toFixed(8)),
			pct: totalVolume > 0 ? Number(((vol / totalVolume) * 100).toFixed(1)) : 0,
			buyVolume: Number(buyVol.toFixed(8)),
			sellVolume: Number(sellVol.toFixed(8)),
		};
	});

	// Large trade bias (大口 + 特大口)
	const largeTxs = txs.filter(t => t.amount > p75);
	const largeBuyVol = largeTxs.filter(t => t.side === 'buy').reduce((s, t) => s + t.amount, 0);
	const largeSellVol = largeTxs.filter(t => t.side === 'sell').reduce((s, t) => s + t.amount, 0);
	const ratio = largeSellVol > 0 ? Number((largeBuyVol / largeSellVol).toFixed(2)) : (largeBuyVol > 0 ? null : null);
	const interpretation = ratio == null
		? (largeBuyVol > 0 ? '大口は買い一色' : '大口取引なし')
		: ratio > 1.3 ? '大口は買い優勢（蓄積の可能性）'
		: ratio < 0.7 ? '大口は売り優勢（分配の可能性）'
		: '大口は買い売り均衡';

	return {
		categories: result,
		thresholds: { p25: Number(p25.toFixed(8)), p75: Number(p75.toFixed(8)), p95: Number(p95.toFixed(8)) },
		largeTradeBias: {
			buyVolume: Number(largeBuyVol.toFixed(8)),
			sellVolume: Number(largeSellVol.toFixed(8)),
			ratio,
			interpretation,
		},
	};
}

// ── Main ──

export default async function analyzeVolumeProfile(
	pair: string = 'btc_jpy',
	hours?: number,
	limit: number = 500,
	bins: number = 20,
	valueAreaPct: number = 0.70,
	tz: string = 'Asia/Tokyo',
) {
	const chk = ensurePair(pair);
	if (!chk.ok) return failFromValidation(chk, AnalyzeVolumeProfileOutputSchema) as any;

	try {
		const txs = await fetchTransactions(chk.pair, hours, limit);
		if (txs.length < 10) {
			return AnalyzeVolumeProfileOutputSchema.parse(
				fail('約定データが不足しています（10件未満）', 'user')
			) as any;
		}

		const currentPrice = txs[txs.length - 1].price;
		const { vwap, stdDev } = calcVwap(txs);
		const profile = calcVolumeProfile(txs, bins, valueAreaPct);
		const tradeSizes = calcTradeSizeDistribution(txs);

		// VWAP position classification
		const dev = currentPrice - vwap;
		const deviationPct = vwap > 0 ? Number(((dev / vwap) * 100).toFixed(2)) : 0;
		const position =
			dev > 2 * stdDev ? 'above_2sigma' as const :
			dev > stdDev ? 'above_1sigma' as const :
			dev < -2 * stdDev ? 'below_2sigma' as const :
			dev < -stdDev ? 'below_1sigma' as const :
			'at_vwap' as const;

		const positionLabel: Record<string, string> = {
			above_2sigma: '大幅に割高（+2σ超）→ 短期反落リスク高',
			above_1sigma: 'やや割高（+1σ超）→ 利確検討圏',
			at_vwap: 'VWAP近辺（±1σ以内）→ フェアバリュー圏',
			below_1sigma: 'やや割安（-1σ超）→ 押し目検討圏',
			below_2sigma: '大幅に割安（-2σ超）→ 短期反発期待',
		};

		// Time range info
		const startMs = txs[0].timestampMs;
		const endMs = txs[txs.length - 1].timestampMs;
		const durationMin = Math.round((endMs - startMs) / 60_000);
		const totalVolume = txs.reduce((s, t) => s + t.amount, 0);
		const priceHigh = Math.max(...txs.map(t => t.price));
		const priceLow = Math.min(...txs.map(t => t.price));

		const data = {
			vwap: {
				price: Number(vwap.toFixed(2)),
				stdDev: Number(stdDev.toFixed(2)),
				bands: {
					upper2sigma: Number((vwap + 2 * stdDev).toFixed(2)),
					upper1sigma: Number((vwap + stdDev).toFixed(2)),
					lower1sigma: Number((vwap - stdDev).toFixed(2)),
					lower2sigma: Number((vwap - 2 * stdDev).toFixed(2)),
				},
				currentPrice,
				deviationPct,
				position,
				interpretation: positionLabel[position],
			},
			profile,
			tradeSizes,
			params: {
				totalTrades: txs.length,
				totalVolume: Number(totalVolume.toFixed(8)),
				priceRange: { high: priceHigh, low: priceLow },
				timeRange: {
					start: toIsoWithTz(startMs, tz) ?? '',
					end: toIsoWithTz(endMs, tz) ?? '',
					durationMin,
				},
				bins,
				valueAreaPct,
			},
		};

		// Build summary text
		const pairDisplay = formatPair(chk.pair);
		const fmtPx = (p: number) => formatPrice(p, chk.pair);
		const rangeStr = `${toDisplayTime(startMs, tz) ?? '?'}〜${toDisplayTime(endMs, tz) ?? '?'}`;

		const topBins = [...profile.bins].sort((a, b) => b.totalVolume - a.totalVolume).slice(0, 5);
		const profileText = topBins.map((b, i) => {
			const bar = '█'.repeat(Math.max(1, Math.round(b.pct / 3)));
			return `  ${i + 1}. ${b.label}円: ${bar} ${b.pct}% (買${b.buyVolume.toFixed(4)}/売${b.sellVolume.toFixed(4)}) [${b.dominant}]`;
		}).join('\n');

		const summary = [
			`${pairDisplay} Volume Profile & VWAP (${txs.length}件, ${durationMin}分間)`,
			`期間: ${rangeStr}`,
			'',
			'📊 VWAP:',
			`  VWAP: ${fmtPx(vwap)} (σ=${fmtPx(stdDev)})`,
			`  バンド: +2σ=${fmtPx(vwap + 2 * stdDev)} / +1σ=${fmtPx(vwap + stdDev)} / -1σ=${fmtPx(vwap - stdDev)} / -2σ=${fmtPx(vwap - 2 * stdDev)}`,
			`  現在値: ${fmtPx(currentPrice)} (VWAP比 ${formatPercent(deviationPct, { sign: true })})`,
			`  判定: ${positionLabel[position]}`,
			'',
			'📈 Volume Profile (出来高上位5帯):',
			profileText,
			`  POC: ${fmtPx(profile.poc.price)} (最大出来高価格帯)`,
			`  Value Area: ${fmtPx(profile.valueArea.low)}〜${fmtPx(profile.valueArea.high)} (${profile.valueArea.pct}%)`,
			'',
			`💰 約定サイズ分布 (閾値: P25=${tradeSizes.thresholds.p25}, P75=${tradeSizes.thresholds.p75}, P95=${tradeSizes.thresholds.p95}):`,
			`  分類基準: 小口≤P25, 中口P25–P75, 大口P75–P95, 特大口>P95`,
			...tradeSizes.categories.map(c =>
				`  ${c.label}: ${c.count}件 ${c.volume.toFixed(4)} (${c.pct}%) 買${c.buyVolume.toFixed(4)}/売${c.sellVolume.toFixed(4)}`
			),
			`  大口偏り: ${tradeSizes.largeTradeBias.interpretation}`,
			'',
			`---`,
			`📌 含まれるもの: VWAP＋σバンド、価格帯別出来高分布(POC/VA)、約定サイズ分布`,
			`📌 含まれないもの: 時系列フロー（CVD等）、板情報、テクニカル指標`,
			`📌 補完ツール: get_flow_metrics（CVD・スパイク）, get_orderbook（板情報）, analyze_indicators（指標）`,
		].join('\n');

		const meta = createMeta(chk.pair, { count: txs.length });
		return AnalyzeVolumeProfileOutputSchema.parse(ok(summary, data as any, meta as any)) as any;
	} catch (e: unknown) {
		return failFromError(e, { schema: AnalyzeVolumeProfileOutputSchema }) as any;
	}
}

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'analyze_volume_profile',
	description: `約定データから VWAP・Volume Profile・約定サイズ分布を算出。
- VWAP: 出来高加重平均価格 ±1σ/2σバンド → 割高/割安判定
- Volume Profile: 価格帯別出来高。POC（最大出来高帯）・Value Area（70%集中帯）
- 約定サイズ分布: 四分位で4分類（小口≤P25, 中口P25–P75, 大口P75–P95, 特大口>P95）。大口売買偏りで蓄積/分配を推定
hours（推奨）で期間指定、bins=20で価格帯分割。`,
	inputSchema: AnalyzeVolumeProfileInputSchema,
	handler: async ({ pair, hours, limit, bins, valueAreaPct, tz }: any) =>
		analyzeVolumeProfile(pair, hours != null ? Number(hours) : undefined, Number(limit), Number(bins), Number(valueAreaPct), tz),
};
