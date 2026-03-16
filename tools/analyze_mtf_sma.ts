import type { z } from 'zod';
import { failFromError, failFromValidation, ok } from '../lib/result.js';
import { createMeta, ensurePair } from '../lib/validate.js';
import {
	type AnalyzeMtfSmaDataSchemaOut,
	AnalyzeMtfSmaInputSchema,
	type AnalyzeMtfSmaMetaSchemaOut,
	AnalyzeMtfSmaOutputSchema,
} from '../src/schemas.js';
import type { ToolDefinition } from '../src/tool-definition.js';
import analyzeSmaSnapshot from './analyze_sma_snapshot.js';

export default async function analyzeMtfSma(
	pair: string = 'btc_jpy',
	timeframes: string[] = ['1hour', '4hour', '1day'],
	periods: number[] = [25, 75, 200],
) {
	const chk = ensurePair(pair);
	if (!chk.ok) return failFromValidation(chk, AnalyzeMtfSmaOutputSchema);

	try {
		// Deduplicate timeframes to avoid redundant calls
		const uniqueTimeframes = [...new Set(timeframes)];

		// Run all timeframes in parallel — each triggers analyzeIndicators
		// which has a 30s TTL cache, so same pair+type won't re-fetch.
		const results = await Promise.all(
			uniqueTimeframes.map(async (tf) => {
				const res = await analyzeSmaSnapshot(chk.pair, tf, 220, periods);
				return { timeframe: tf, result: res as Record<string, unknown> };
			}),
		);

		// Build per-timeframe results (pick fields relevant to MTF view)
		const byTimeframe: Record<string, unknown> = {};
		const alignments: string[] = [];

		for (const { timeframe, result } of results) {
			if (result?.ok && result?.data) {
				const d = result.data as Record<string, unknown>;
				const summary = d.summary as Record<string, unknown> | undefined;
				byTimeframe[timeframe] = {
					alignment: d.alignment,
					position: (summary?.position as string) ?? 'unknown',
					latest: d.latest,
					sma: d.sma,
					smas: d.smas,
					crosses: d.crosses,
					recentCrosses: d.recentCrosses,
					tags: d.tags,
				};
				alignments.push(d.alignment as string);
			} else {
				byTimeframe[timeframe] = { alignment: 'unknown', latest: { close: null } };
				alignments.push('unknown');
			}
		}

		// Confluence judgment — any unknown in requested timeframes → aligned=false, direction=unknown
		let direction: 'bullish' | 'bearish' | 'mixed' | 'unknown';
		let aligned: boolean;

		if (alignments.some((a) => a === 'unknown')) {
			direction = 'unknown';
			aligned = false;
		} else if (alignments.every((a) => a === 'bullish')) {
			direction = 'bullish';
			aligned = true;
		} else if (alignments.every((a) => a === 'bearish')) {
			direction = 'bearish';
			aligned = true;
		} else {
			direction = 'mixed';
			aligned = false;
		}

		const dirLabel = direction === 'bullish' ? '上昇' : direction === 'bearish' ? '下降' : '混合';
		const tfEntry = (tf: string) => byTimeframe[tf] as Record<string, unknown> | undefined;
		const summary = aligned
			? `全時間軸が${dirLabel}方向で一致`
			: `時間軸間で方向が分かれている（${timeframes.map((tf) => `${tf}:${tfEntry(tf)?.alignment}`).join(', ')})`;

		const summaryText = `${timeframes.map((tf) => `${tf}: ${tfEntry(tf)?.alignment}`).join(' / ')} → ${summary}`;

		const data: z.infer<typeof AnalyzeMtfSmaDataSchemaOut> = {
			timeframes: byTimeframe as z.infer<typeof AnalyzeMtfSmaDataSchemaOut>['timeframes'],
			confluence: { aligned, direction, summary },
		};

		const meta = createMeta(chk.pair, { timeframes, periods }) as z.infer<typeof AnalyzeMtfSmaMetaSchemaOut>;
		return AnalyzeMtfSmaOutputSchema.parse(ok(summaryText, data, meta));
	} catch (e: unknown) {
		return failFromError(e, { schema: AnalyzeMtfSmaOutputSchema });
	}
}

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'analyze_mtf_sma',
	description:
		'[Multi-Timeframe SMA / MTF] 複数タイムフレームSMA一括分析（multi-timeframe / MTF / SMA alignment / confluence）。整列方向とコンフルエンスを判定。',
	inputSchema: AnalyzeMtfSmaInputSchema,
	handler: async ({ pair, timeframes, periods }: { pair?: string; timeframes?: string[]; periods?: number[] }) =>
		analyzeMtfSma(pair, timeframes, periods),
};
