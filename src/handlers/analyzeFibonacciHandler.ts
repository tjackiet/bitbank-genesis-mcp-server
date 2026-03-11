import analyzeFibonacci from '../../tools/analyze_fibonacci.js';
import { AnalyzeFibonacciInputSchema, AnalyzeFibonacciOutputSchema } from '../schemas.js';
import type { ToolDefinition } from '../tool-definition.js';
import { formatPair, timeframeLabel, formatPrice, formatPercent } from '../../lib/formatter.js';

export const toolDef: ToolDefinition = {
	name: 'analyze_fibonacci',
	description: `[Fibonacci / Retracement / Extension] フィボナッチ分析（fibonacci / retracement / extension / swing high-low）。スイング自動検出→リトレースメント/エクステンション水準を算出。過去の反応実績（反発率・リターン）付き。

複数タイムフレーム分析には analyze_mtf_fibonacci を使用。`,
	inputSchema: AnalyzeFibonacciInputSchema,
	handler: async (args: any) => {
		const result = await analyzeFibonacci(args);
		const res = AnalyzeFibonacciOutputSchema.parse(result as any);
		if (!res?.ok) return res as any;

		const data: any = (res as any)?.data ?? {};
		const meta: any = (res as any)?.meta ?? {};
		const pair = String(data.pair || args?.pair || 'btc_jpy');
		const tfLabel = timeframeLabel(String(data.timeframe || '1day'));
		const pairLabel = formatPair(pair);

		// Build text content for LLM
		const contentArr: any[] = (res as any)?.content ?? [];
		const existingText = contentArr.length > 0 ? contentArr[0].text : '';

		// Return with structuredContent for tool chaining / visualization
		return {
			content: [{ type: 'text', text: existingText }],
			structuredContent: {
				ok: true,
				type: 'fibonacci',
				summary: (res as any)?.summary ?? `${pairLabel} フィボナッチ分析`,
				data: {
					pair: data.pair,
					timeframe: data.timeframe,
					currentPrice: data.currentPrice,
					trend: data.trend,
					swingHigh: data.swingHigh,
					swingLow: data.swingLow,
					range: data.range,
					levels: data.levels ?? [],
					extensions: data.extensions ?? [],
					position: data.position ?? {},
					levelStats: data.levelStats ?? [],
				},
				meta,
			} as Record<string, unknown>,
		};
	},
};
