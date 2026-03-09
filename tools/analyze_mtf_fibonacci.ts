import analyzeFibonacci from './analyze_fibonacci.js';
import { ok, failFromError, failFromValidation } from '../lib/result.js';
import { createMeta, ensurePair } from '../lib/validate.js';
import { formatPrice, formatPair, formatPercent } from '../lib/formatter.js';
import { z } from 'zod';
import { AnalyzeMtfFibonacciInputSchema as _BaseInputSchema, AnalyzeMtfFibonacciOutputSchema } from '../src/schemas.js';

const AnalyzeMtfFibonacciInputSchema = _BaseInputSchema.extend({
	lookbackDays: z.array(z.number().int().min(14).max(365)).nonempty().optional().default([30, 90, 180]),
});
import type { ToolDefinition } from '../src/tool-definition.js';
import type { Pair } from '../src/types/domain.d.ts';

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
	tolerancePct: number = 1.0
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
			const pctDiff = Math.abs(sorted[j].price - avgPrice) / avgPrice * 100;

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
	periodResults: Array<{ lookbackDays: number; data: any }>,
	confluence: ConfluenceZone[]
): Array<{ type: 'text'; text: string }> {
	const lines: string[] = [];
	const pairLabel = formatPair(pair);

	lines.push(`【マルチタイムフレーム・フィボナッチ分析】${pairLabel}`);
	lines.push(`現在価格: ${formatPrice(currentPrice, pair)}`);
	lines.push('');

	// Per-period summaries
	for (const pr of periodResults) {
		const d = pr.data;
		lines.push(`--- ${pr.lookbackDays}日 ---`);
		lines.push(`  トレンド: ${d.trend === 'up' ? '上昇↑' : '下降↓'}`);
		lines.push(`  スイングハイ: ${formatPrice(d.swingHigh.price, pair)}（${d.swingHigh.date}）`);
		lines.push(`  スイングロー: ${formatPrice(d.swingLow.price, pair)}（${d.swingLow.date}）`);

		// All retracement levels (0% and 100% are swing points, still useful for reference)
		const allLevels = (d.levels as FibLevel[]) ?? [];
		for (const kl of allLevels) {
			const nearest = kl.isNearest ? ' ← 最寄り' : '';
			lines.push(
				`  ${(kl.ratio * 100).toFixed(1)}%: ${formatPrice(kl.price, pair)} (${formatPercent(kl.distancePct, { sign: true })})${nearest}`
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
				`  ${formatPrice(zone.priceZone[0], pair)} 〜 ${formatPrice(zone.priceZone[1], pair)} (${formatPercent(zone.distancePct, { sign: true })}) [信頼度: ${strengthJa}]`
			);
			for (const ml of zone.matchedLevels) {
				lines.push(
					`    - ${ml.lookbackDays}日: ${(ml.ratio * 100).toFixed(1)}% = ${formatPrice(ml.price, pair)}`
				);
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

export default async function analyzeMtfFibonacci(
	pair: string = 'btc_jpy',
	lookbackDays: number[] = [30, 90, 180]
) {
	const chk = ensurePair(pair);
	if (!chk.ok) return failFromValidation(chk, AnalyzeMtfFibonacciOutputSchema) as any;

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
				return { lookbackDays: days, result: res as any };
			})
		);

		// Build per-period data
		const periods: Record<string, any> = {};
		const periodSummaries: Array<{ lookbackDays: number; data: any; levels: FibLevel[] }> = [];
		let currentPrice = 0;

		for (const { lookbackDays: days, result } of results) {
			if (result?.ok && result?.data) {
				const d = result.data;
				periods[String(days)] = {
					lookbackDays: days,
					trend: d.trend,
					swingHigh: { price: d.swingHigh.price, date: d.swingHigh.date },
					swingLow: { price: d.swingLow.price, date: d.swingLow.date },
					levels: d.levels,
				};
				periodSummaries.push({ lookbackDays: days, data: d, levels: d.levels ?? [] });
				if (d.currentPrice) currentPrice = d.currentPrice;
			} else {
				periods[String(days)] = {
					lookbackDays: days,
					trend: 'down',
					swingHigh: { price: 0, date: '' },
					swingLow: { price: 0, date: '' },
					levels: [],
				};
			}
		}

		// Detect confluence
		const confluenceInput = periodSummaries.map((ps) => ({
			lookbackDays: ps.lookbackDays,
			levels: ps.levels,
		}));
		const confluence = detectConfluence(confluenceInput, currentPrice);

		// Generate content
		const content = generateMtfContent(chk.pair, currentPrice, periodSummaries, confluence);

		const confluenceCount = confluence.length;
		const strongCount = confluence.filter((z) => z.strength === 'strong').length;
		const summaryText = confluenceCount > 0
			? `${formatPair(chk.pair)} MTFフィボナッチ: ${confluenceCount}個の合流ゾーン検出（強: ${strongCount}個）`
			: `${formatPair(chk.pair)} MTFフィボナッチ: 合流ゾーンなし（各期間の水準が分散）`;

		const data = {
			pair: chk.pair,
			currentPrice,
			periods,
			confluence,
		};

		const meta = createMeta(chk.pair as Pair, { lookbackDays: uniqueDays });

		return AnalyzeMtfFibonacciOutputSchema.parse({
			ok: true,
			summary: summaryText,
			content,
			data,
			meta,
		}) as any;
	} catch (e: unknown) {
		return failFromError(e, { schema: AnalyzeMtfFibonacciOutputSchema }) as any;
	}
}

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'analyze_mtf_fibonacci',
	description: `複数のルックバック期間でフィボナッチ水準を一括計算し、コンフルエンス（合流）ゾーンを自動検出。

【機能】
- 各期間で独立にスイング検出・フィボナッチ・リトレースメント水準を算出
- 異なる期間の水準が集中するコンフルエンス（合流）ゾーンを検出
- 合流ゾーンの信頼度を strong / moderate / weak で判定

【出力】
- content: 各期間の要約 + コンフルエンスゾーン一覧
- structuredContent.data: 全期間のフィボナッチ水準 + confluence 配列

【パラメータ】
- pair: 通貨ペア（デフォルト: btc_jpy）
- lookbackDays: ルックバック期間の配列（デフォルト: [30, 90, 180]）

analyze_fibonacci を1回ずつ呼ぶ必要なし。内部並列実行で高速。`,
	inputSchema: AnalyzeMtfFibonacciInputSchema,
	handler: async ({ pair, lookbackDays }: any) =>
		analyzeMtfFibonacci(pair, lookbackDays),
};
