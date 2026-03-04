import analyzeFibonacci from '../../tools/analyze_fibonacci.js';
import { AnalyzeFibonacciInputSchema, AnalyzeFibonacciOutputSchema } from '../schemas.js';
import type { ToolDefinition } from '../tool-definition.js';
import { formatPair, timeframeLabel, formatPrice, formatPercent } from '../../lib/formatter.js';

export const toolDef: ToolDefinition = {
	name: 'analyze_fibonacci',
	description: `フィボナッチ・リトレースメント／エクステンション水準を自動計算。

【機能】
- スイングハイ・スイングローを自動検出しトレンド判定
- リトレースメント水準（0%, 23.6%, 38.2%, 50%, 61.8%, 78.6%, 100%）を算出
- エクステンション水準（127.2%, 141.4%, 161.8%, 200%, 261.8%）を算出
- 現在価格と各水準の距離（%）、最寄り水準を特定
- 過去の反応実績（反発率・平均リターン・滞在期間）を統計

【出力】
- content: LLM 向けテキスト解説
- structuredContent: 全水準の価格・距離%・反応統計を含む JSON
  → render_chart_svg や HTML アーティファクトで即座に可視化可能
  → structuredContent.data.levels: リトレースメント水準配列
  → structuredContent.data.extensions: エクステンション水準配列
  → structuredContent.data.position: 現在価格の位置情報
  → structuredContent.data.levelStats: 各水準の反応実績統計

【パラメータ】
- pair: 通貨ペア（デフォルト: btc_jpy）
- type: 時間足（デフォルト: 1day）
- lookbackDays: 分析期間（デフォルト: 90日）
- mode: retracement / extension / both（デフォルト: both）
- historyLookbackDays: 反応実績の集計期間（デフォルト: 180日）

複数タイムフレーム分析が必要な場合は analyze_mtf_fibonacci を使用。`,
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
