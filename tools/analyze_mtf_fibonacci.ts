import { z } from 'zod';
import { formatPair, formatPercent, formatPrice } from '../lib/formatter.js';
import { failFromError, failFromValidation } from '../lib/result.js';
import { createMeta, ensurePair } from '../lib/validate.js';
import { collectUpstreamWarnings, extractUpstreamWarning, prependWarnings } from '../lib/warning-propagation.js';
import { AnalyzeMtfFibonacciInputSchema as _BaseInputSchema, AnalyzeMtfFibonacciOutputSchema } from '../src/schemas.js';
import analyzeFibonacci from './analyze_fibonacci.js';

const AnalyzeMtfFibonacciInputSchema = _BaseInputSchema.extend({
	lookbackDays: z.array(z.number().int().min(14).max(365)).nonempty().optional().default([30, 90, 180]),
});

import type { Pair } from '../src/schemas.js';
import type { ToolDefinition } from '../src/tool-definition.js';

// ── Types ──

interface FibLevel {
	ratio: number;
	price: number;
	distancePct: number;
	isNearest: boolean;
}

interface ConfluenceZone {
	priceZone: [number, number];
	matchedLevels: Array<{ lookbackDays: number; ratio: number; price: number }>;
	strength: 'strong' | 'moderate' | 'weak';
	distancePct: number;
}

// ── Confluence Detection ──

/**
 * Find price zones where Fibonacci levels from different lookback periods cluster together.
 * A confluence zone indicates stronger support/resistance.
 */
function detectConfluence(
	periodResults: Array<{ lookbackDays: number; levels: FibLevel[] }>,
	currentPrice: number,
	tolerancePct: number = 1.0,
): ConfluenceZone[] {
	// Collect all levels from all periods
	const allLevels: Array<{ lookbackDays: number; ratio: number; price: number }> = [];

	for (const period of periodResults) {
		for (const level of period.levels) {
			// Skip 0% and 100% as they are just swing points
			if (level.ratio === 0 || level.ratio === 1.0) continue;
			allLevels.push({
				lookbackDays: period.lookbackDays,
				ratio: level.ratio,
				price: level.price,
			});
		}
	}

	if (allLevels.length < 2) return [];

	// Sort by price
	const sorted = [...allLevels].sort((a, b) => a.price - b.price);

	// Cluster nearby levels using tolerance
	const zones: ConfluenceZone[] = [];
	const used = new Set<number>();

	for (let i = 0; i < sorted.length; i++) {
		if (used.has(i)) continue;

		const cluster = [sorted[i]];
		used.add(i);

		for (let j = i + 1; j < sorted.length; j++) {
			if (used.has(j)) continue;

			const avgPrice = cluster.reduce((s, c) => s + c.price, 0) / cluster.length;
			const pctDiff = (Math.abs(sorted[j].price - avgPrice) / avgPrice) * 100;

			if (pctDiff <= tolerancePct) {
				cluster.push(sorted[j]);
				used.add(j);
			}
		}

		// Only consider as confluence if levels from at least 2 different periods match
		const uniquePeriods = new Set(cluster.map((c) => c.lookbackDays));
		if (uniquePeriods.size < 2) continue;

		const prices = cluster.map((c) => c.price);
		const zoneMin = Math.min(...prices);
		const zoneMax = Math.max(...prices);
		const zoneCenter = (zoneMin + zoneMax) / 2;
		const distancePct = ((zoneCenter - currentPrice) / currentPrice) * 100;

		const strength: 'strong' | 'moderate' | 'weak' =
			uniquePeriods.size >= 3 ? 'strong' : uniquePeriods.size >= 2 && cluster.length >= 3 ? 'moderate' : 'weak';

		zones.push({
			priceZone: [Math.round(zoneMin), Math.round(zoneMax)],
			matchedLevels: cluster,
			strength,
			distancePct: Number(distancePct.toFixed(2)),
		});
	}

	// Sort by distance from current price
	zones.sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct));

	return zones;
}

// ── Content Generation ──

function generateMtfContent(
	pair: string,
	currentPrice: number,
	periodResults: Array<{ lookbackDays: number; data: Record<string, unknown> }>,
	confluence: ConfluenceZone[],
): Array<{ type: 'text'; text: string }> {
	const lines: string[] = [];
	const pairLabel = formatPair(pair);

	lines.push(`【マルチタイムフレーム・フィボナッチ分析】${pairLabel}`);
	lines.push(`現在価格: ${formatPrice(currentPrice, pair)}`);
	lines.push('');

	// Per-period summaries
	for (const pr of periodResults) {
		const d = pr.data;
		const swingHigh = d.swingHigh as { price: number; date: string };
		const swingLow = d.swingLow as { price: number; date: string };
		lines.push(`--- ${pr.lookbackDays}日 ---`);
		lines.push(`  トレンド: ${d.trend === 'up' ? '上昇↑' : '下降↓'}`);
		lines.push(`  スイングハイ: ${formatPrice(swingHigh.price, pair)}（${swingHigh.date}）`);
		lines.push(`  スイングロー: ${formatPrice(swingLow.price, pair)}（${swingLow.date}）`);

		// All retracement levels (0% and 100% are swing points, still useful for reference)
		const allLevels = (d.levels as FibLevel[]) ?? [];
		for (const kl of allLevels) {
			const nearest = kl.isNearest ? ' ← 最寄り' : '';
			lines.push(
				`  ${(kl.ratio * 100).toFixed(1)}%: ${formatPrice(kl.price, pair)} (${formatPercent(kl.distancePct, { sign: true })})${nearest}`,
			);
		}
		lines.push('');
	}

	// Confluence zones
	if (confluence.length > 0) {
		lines.push('【コンフルエンス（合流）ゾーン】');
		for (const zone of confluence) {
			const strengthJa = zone.strength === 'strong' ? '強' : zone.strength === 'moderate' ? '中' : '弱';
			lines.push(
				`  ${formatPrice(zone.priceZone[0], pair)} 〜 ${formatPrice(zone.priceZone[1], pair)} (${formatPercent(zone.distancePct, { sign: true })}) [信頼度: ${strengthJa}]`,
			);
			for (const ml of zone.matchedLevels) {
				lines.push(`    - ${ml.lookbackDays}日: ${(ml.ratio * 100).toFixed(1)}% = ${formatPrice(ml.price, pair)}`);
			}
		}
		lines.push('');
	} else {
		lines.push('【コンフルエンス】合流ゾーンは検出されませんでした');
		lines.push('');
	}

	lines.push('【判定ロジック】');
	lines.push('- 各ルックバック期間で独立にスイング検出・フィボナッチ水準を算出');
	lines.push('- 異なる期間の水準が±1%以内に集中する「合流ゾーン」を検出');
	lines.push('- 3期間以上の合流 → 信頼度「強」、2期間の合流 → 信頼度「中〜弱」');

	return [{ type: 'text', text: lines.join('\n') }];
}

// ── Main Handler ──

export default async function analyzeMtfFibonacci(pair: string = 'btc_jpy', lookbackDays: number[] = [30, 90, 180]) {
	const chk = ensurePair(pair);
	if (!chk.ok) return failFromValidation(chk, AnalyzeMtfFibonacciOutputSchema);

	try {
		// Deduplicate lookback periods
		const uniqueDays = [...new Set(lookbackDays)];

		// Run all lookback periods in parallel
		const results = await Promise.all(
			uniqueDays.map(async (days) => {
				const res = await analyzeFibonacci({
					pair: chk.pair,
					type: '1day',
					lookbackDays: days,
					mode: 'retracement',
					historyLookbackDays: days,
				});
				return { lookbackDays: days, result: res as Record<string, unknown> };
			}),
		);

		// Build per-period data
		const periods: Record<string, unknown> = {};
		const periodSummaries: Array<{ lookbackDays: number; data: Record<string, unknown>; levels: FibLevel[] }> = [];
		let currentPrice = 0;

		// 子 analyze_fibonacci の meta.warning（get_candles 由来）/ 失敗期間 を集約。
		// `[Nd]` prefix 付き 1 文字列に集約 → meta.warning
		const warningSources: Array<{ source: string; warning?: string }> = [];
		let hasFailure = false;

		for (const { lookbackDays: days, result } of results) {
			if (result?.ok && result?.data) {
				const d = result.data as Record<string, unknown>;
				const swingHigh = d.swingHigh as { price: number; date: string };
				const swingLow = d.swingLow as { price: number; date: string };
				const levels = (d.levels as FibLevel[]) ?? [];
				periods[String(days)] = {
					lookbackDays: days,
					trend: d.trend,
					swingHigh: { price: swingHigh.price, date: swingHigh.date },
					swingLow: { price: swingLow.price, date: swingLow.date },
					levels,
				};
				periodSummaries.push({ lookbackDays: days, data: d, levels });
				if (d.currentPrice) currentPrice = d.currentPrice as number;

				const { warning: childWarning } = extractUpstreamWarning(result.meta);
				if (childWarning) warningSources.push({ source: `${days}d`, warning: childWarning });
			} else {
				periods[String(days)] = {
					lookbackDays: days,
					trend: 'down',
					swingHigh: { price: 0, date: '' },
					swingLow: { price: 0, date: '' },
					levels: [],
				};
				hasFailure = true;
				const failMsg = (result as { summary?: string } | null | undefined)?.summary || 'analyzeFibonacci failed';
				warningSources.push({ source: `${days}d`, warning: failMsg });
			}
		}

		// `[Nd]` prefix 付き 1 文字列に集約。失敗期間がある場合は信頼度低下警告も末尾に追記する。
		const aggregatedWarning = collectUpstreamWarnings(warningSources);
		const warningLines: string[] = [];
		if (aggregatedWarning) warningLines.push(aggregatedWarning);
		if (hasFailure) warningLines.push('⚠️ 一部期間のデータ取得失敗のため合流解釈の信頼度低');
		const warning = warningLines.length > 0 ? warningLines.join('\n') : undefined;

		// Detect confluence
		const confluenceInput = periodSummaries.map((ps) => ({
			lookbackDays: ps.lookbackDays,
			levels: ps.levels,
		}));
		const confluence = detectConfluence(confluenceInput, currentPrice);

		// Generate content + prepend upstream warning at the top (LLM が JSON より前に気づけるように)。
		const rawContent = generateMtfContent(chk.pair, currentPrice, periodSummaries, confluence);
		const content =
			warning && rawContent.length > 0
				? [
						{ type: 'text' as const, text: prependWarnings(rawContent[0].text, { warning }, { separator: '\n' }) },
						...rawContent.slice(1),
					]
				: rawContent;

		const confluenceCount = confluence.length;
		const strongCount = confluence.filter((z) => z.strength === 'strong').length;
		const baseSummary =
			confluenceCount > 0
				? `${formatPair(chk.pair)} MTFフィボナッチ: ${confluenceCount}個の合流ゾーン検出（強: ${strongCount}個）`
				: `${formatPair(chk.pair)} MTFフィボナッチ: 合流ゾーンなし（各期間の水準が分散）`;
		const summaryText = prependWarnings(baseSummary, { warning }, { separator: '\n' });

		const data = {
			pair: chk.pair,
			currentPrice,
			periods,
			confluence,
		};

		const meta = createMeta(chk.pair as Pair, {
			lookbackDays: uniqueDays,
			...(warning ? { warning } : {}),
		});

		return AnalyzeMtfFibonacciOutputSchema.parse({
			ok: true,
			summary: summaryText,
			content,
			data,
			meta,
		});
	} catch (e: unknown) {
		return failFromError(e, { schema: AnalyzeMtfFibonacciOutputSchema });
	}
}

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'analyze_mtf_fibonacci',
	description: `[Multi-Timeframe Fibonacci / Confluence] 複数期間フィボナッチ一括分析（MTF fibonacci / confluence zone）。複数ルックバック期間の水準を並列計算し、コンフルエンス（合流）ゾーンを自動検出。analyze_fibonacci を個別に呼ぶ必要なし。`,
	inputSchema: AnalyzeMtfFibonacciInputSchema,
	handler: async ({ pair, lookbackDays }: { pair?: string; lookbackDays?: number[] }) =>
		analyzeMtfFibonacci(pair, lookbackDays),
};
