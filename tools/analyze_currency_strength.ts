import getTickersJpy from './get_tickers_jpy.js';
import analyzeIndicators from './analyze_indicators.js';
import { ok, fail, failFromError } from '../lib/result.js';
import { formatPercent, formatVolumeJPY, formatPriceJPY } from '../lib/formatter.js';
import { nowIso } from '../lib/datetime.js';
import {
	AnalyzeCurrencyStrengthInputSchema,
	AnalyzeCurrencyStrengthOutputSchema,
} from '../src/schemas.js';
import type { ToolDefinition } from '../src/tool-definition.js';

// ── Types ──

interface TickerItem {
	pair: string;
	last: string;
	open: string;
	vol: string;
	change24h?: number | null;
	change24hPct?: number | null;
}

interface RankedItem {
	pair: string;
	currency: string;
	score: number;
	rank: number;
	components: {
		change24h: number | null;
		rsi: number | null;
		smaDeviation: number | null;
		volumeRank: number;
	};
	price: number | null;
	volumeJPY: number | null;
	interpretation: 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong_bearish';
}

// ── Helpers ──

function clamp(x: number, min: number, max: number) { return Math.max(min, Math.min(max, x)); }

function interpret(score: number): RankedItem['interpretation'] {
	if (score >= 50) return 'strong_bullish';
	if (score >= 20) return 'bullish';
	if (score <= -50) return 'strong_bearish';
	if (score <= -20) return 'bearish';
	return 'neutral';
}

function extractCurrency(pair: string): string {
	return pair.replace(/_jpy$/i, '').toUpperCase();
}

// ── Main ──

export default async function analyzeCurrencyStrength(
	topN: number = 10,
	type: string = '1day',
) {
	try {
		// 1. Fetch all tickers
		const tickerRes: any = await getTickersJpy();
		if (!tickerRes?.ok) {
			return AnalyzeCurrencyStrengthOutputSchema.parse(
				fail(tickerRes?.summary || 'tickers fetch failed', 'upstream')
			);
		}
		const tickers: TickerItem[] = Array.isArray(tickerRes.data) ? tickerRes.data : [];
		if (tickers.length === 0) {
			return AnalyzeCurrencyStrengthOutputSchema.parse(
				fail('ティッカーデータが空です', 'upstream')
			);
		}

		// 2. Deduplicate by pair (keep first occurrence), sort by volume descending, pick top N
		const seenPairs = new Set<string>();
		const uniqueTickers = tickers.filter(t => {
			if (seenPairs.has(t.pair)) return false;
			seenPairs.add(t.pair);
			return true;
		});
		const withVolume = uniqueTickers.map(t => {
			const lastN = Number(t.last);
			const volN = Number(t.vol);
			const volumeJPY = (Number.isFinite(lastN) && Number.isFinite(volN)) ? lastN * volN : 0;
			const openN = Number(t.open);
			const change24h = (t.change24hPct != null)
				? Number(t.change24hPct)
				: (Number.isFinite(openN) && openN > 0 && Number.isFinite(lastN))
					? Number((((lastN - openN) / openN) * 100).toFixed(2))
					: null;
			return { ...t, lastN, volumeJPY, change24h };
		});
		withVolume.sort((a, b) => b.volumeJPY - a.volumeJPY);
		const targets = withVolume.slice(0, topN);

		// 3. Fetch RSI & SMA for each target (parallel, with concurrency limit)
		const indicatorResults = await Promise.allSettled(
			targets.map(t => analyzeIndicators(t.pair, type, 60))
		);

		// 3b. Check if ALL indicators failed
		const allIndicatorsFailed = indicatorResults.every(r =>
			r.status === 'rejected' || !(r.value as any)?.ok
		);
		if (allIndicatorsFailed) {
			return AnalyzeCurrencyStrengthOutputSchema.parse(
				fail('全銘柄のテクニカル指標取得に失敗しました', 'upstream')
			);
		}

		// 4. Compute composite score for each
		const items: RankedItem[] = targets.map((t, i) => {
			const indResult = indicatorResults[i];
			const ind = (indResult.status === 'fulfilled' && (indResult.value as any)?.ok)
				? (indResult.value as any).data
				: null;

			// Component: 24h change → score [-100, +100]
			// ±5% → ±100
			const changePct = t.change24h;
			const changeScore = changePct != null ? clamp(changePct / 5 * 100, -100, 100) : 0;

			// Component: RSI → score [-100, +100]
			// RSI 50 = 0, RSI 70+ = +100, RSI 30- = -100
			const rsi = ind?.indicators?.RSI_14 as number | null ?? null;
			const rsiScore = rsi != null ? clamp((rsi - 50) / 20 * 100, -100, 100) : 0;

			// Component: SMA25 deviation → score [-100, +100]
			// price > SMA25 = positive, price < SMA25 = negative
			// ±3% deviation → ±100
			const sma25 = ind?.indicators?.SMA_25 as number | null ?? null;
			const latestClose = ind?.normalized?.at(-1)?.close as number | undefined;
			let smaDeviation: number | null = null;
			let smaScore = 0;
			if (sma25 != null && latestClose != null && sma25 > 0) {
				smaDeviation = Number(((latestClose - sma25) / sma25 * 100).toFixed(2));
				smaScore = clamp(smaDeviation / 3 * 100, -100, 100);
			}

			// Component: volume rank bonus (higher volume → small positive bias)
			const volumeRank = i + 1;
			const volumeBonus = clamp((topN - i) / topN * 10, 0, 10);

			// Composite: 40% change + 30% RSI + 25% SMA + 5% volume
			const score = Number((
				changeScore * 0.40 +
				rsiScore * 0.30 +
				smaScore * 0.25 +
				volumeBonus * 0.05
			).toFixed(1));

			return {
				pair: t.pair,
				currency: extractCurrency(t.pair),
				score,
				rank: 0, // assigned after sorting
				components: {
					change24h: changePct,
					rsi,
					smaDeviation,
					volumeRank,
				},
				price: Number.isFinite(t.lastN) ? t.lastN : null,
				volumeJPY: t.volumeJPY > 0 ? t.volumeJPY : null,
				interpretation: interpret(score),
			};
		});

		// 5. Sort by score descending and assign ranks
		items.sort((a, b) => b.score - a.score);
		items.forEach((item, i) => { item.rank = i + 1; });

		// 6. Build summary
		const strongBullish = items.filter(it => it.interpretation === 'strong_bullish').map(it => it.currency);
		const strongBearish = items.filter(it => it.interpretation === 'strong_bearish').map(it => it.currency);
		const avgScore = Number((items.reduce((s, it) => s + it.score, 0) / items.length).toFixed(1));
		const marketBias = avgScore >= 15 ? 'bullish' as const : avgScore <= -15 ? 'bearish' as const : 'neutral' as const;

		const data = {
			rankings: items,
			summary: {
				totalPairs: tickers.length,
				analyzedPairs: items.length,
				strongBullish,
				strongBearish,
				marketBias,
				avgScore,
			},
		};

		const meta = {
			fetchedAt: nowIso(),
			type,
			topN,
		};

		// Build text summary
		const lines: string[] = [];
		lines.push(`📊 通貨強弱ランキング（出来高上位${items.length}銘柄 / 全${tickers.length}ペア）`);
		lines.push(`市場バイアス: ${marketBias === 'bullish' ? '🟢 強気' : marketBias === 'bearish' ? '🔴 弱気' : '⚪ 中立'}（平均スコア: ${avgScore}）`);
		lines.push('');
		for (const item of items) {
			const emoji = item.score >= 50 ? '🟢' : item.score >= 20 ? '🔵' : item.score <= -50 ? '🔴' : item.score <= -20 ? '🟠' : '⚪';
			const chgStr = item.components.change24h != null ? formatPercent(item.components.change24h, { sign: true, digits: 2 }) : 'n/a';
			const rsiStr = item.components.rsi != null ? `RSI=${Math.round(item.components.rsi)}` : 'RSI=n/a';
			const smaStr = item.components.smaDeviation != null ? `SMA25乖離${formatPercent(item.components.smaDeviation, { sign: true, digits: 2 })}` : '';
			const volStr = formatVolumeJPY(item.volumeJPY);
			const priceStr = item.price != null ? formatPriceJPY(item.price) : 'n/a';
			lines.push(`${item.rank}. ${emoji} ${item.currency} ${priceStr} score=${item.score} | 24h:${chgStr} | ${rsiStr} | ${smaStr} | 出来高${volStr}`);
		}
		if (strongBullish.length > 0) {
			lines.push('');
			lines.push(`🟢 注目（強気）: ${strongBullish.join(', ')}`);
		}
		if (strongBearish.length > 0) {
			lines.push(`🔴 注意（弱気）: ${strongBearish.join(', ')}`);
		}
		lines.push('');
		lines.push('---');
		lines.push('📌 含まれるもの: 24h変化率・RSI・SMA乖離率に基づく相対強弱スコアと市場バイアス');
		lines.push('📌 含まれないもの: 板情報・フロー分析・サポレジ・チャートパターン');
		lines.push('📌 補完ツール: analyze_market_signal（個別銘柄の詳細分析）, analyze_volume_profile（出来高プロファイル）');

		const summaryText = lines.join('\n');

		return AnalyzeCurrencyStrengthOutputSchema.parse(
			ok(summaryText, data as any, meta as any)
		);
	} catch (e: unknown) {
		return failFromError(e, { schema: AnalyzeCurrencyStrengthOutputSchema });
	}
}

// ── ToolDef ──

export const toolDef: ToolDefinition = {
	name: 'analyze_currency_strength',
	description:
		'[Currency Strength / Ranking / Screening] 通貨強弱ランキング（currency strength / relative strength / ranking / screening）。' +
		'全JPYペアを複合スコア（変化率・RSI・SMA乖離・出来高）で判定。注目銘柄の発見・スクリーニングに。',
	inputSchema: AnalyzeCurrencyStrengthInputSchema,
	handler: async ({ topN, type }: any) =>
		analyzeCurrencyStrength(Number(topN), type),
};
