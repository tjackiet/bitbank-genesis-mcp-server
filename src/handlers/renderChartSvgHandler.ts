import type { z } from 'zod';
import renderChartSvg from '../../tools/render_chart_svg.js';
import { RenderChartSvgInputSchema, RenderChartSvgOutputSchema } from '../schemas.js';
import type { ToolDefinition } from '../tool-definition.js';

type ChartOutput = z.infer<typeof RenderChartSvgOutputSchema>;

export const toolDef: ToolDefinition = {
	name: 'render_chart_svg',
	description:
		'[SVG file / PNG save] ローソク足・ラインチャートをサーバー側で SVG/PNG に生成。BB / Ichimoku / SMA 対応。\nクライアント側で描画可能な場合は prepare_chart_data を優先。\nユーザーが SVG/PNG 保存を明示した場合のみ使用。自発的呼び出し禁止。\ndetect_patterns の overlays を渡してパターン描画可能。',
	inputSchema: RenderChartSvgInputSchema,
	handler: async (args: Record<string, unknown>) => {
		const raw = await renderChartSvg(args as z.infer<typeof RenderChartSvgInputSchema>);
		const parsed: ChartOutput = RenderChartSvgOutputSchema.parse(raw);

		const data = ((parsed as Record<string, unknown>).data as Record<string, unknown>) ?? {};
		const meta = ((parsed as Record<string, unknown>).meta as Record<string, unknown>) ?? {};
		const pair = String(meta.pair || (args as Record<string, unknown>).pair || 'pair').toUpperCase();
		const type = String(meta.type || (args as Record<string, unknown>).type || '1day');

		if (!('svg' in data) || !data.svg) {
			const txt = String(parsed.summary || 'chart rendered (no svg)');
			return { content: [{ type: 'text', text: txt }], structuredContent: parsed as Record<string, unknown> };
		}

		// run_backtest と同じ方式: 生 SVG をテキストとしてそのまま返す
		const id = String(meta.identifier || `${pair}-${type}-${Date.now()}`);
		const ttl = String(meta.title || `${pair} ${type} chart`);
		const range = meta.range as { start?: string; end?: string } | undefined;
		const rangeLine = range ? `Period: ${range.start} \u2013 ${range.end}` : '';
		const indicators = meta.indicators as string[] | undefined;
		const indLine = Array.isArray(indicators) && indicators.length ? `Indicators: ${indicators.join(', ')}` : '';
		const legendLines =
			'legend' in data && data.legend
				? Object.entries(data.legend)
						.map(([k, v]) => `${k}: ${String(v)}`)
						.join(' / ')
				: '';

		const summary = [`${pair} ${type} chart`, rangeLine, indLine, legendLines].filter(Boolean).join(' | ');

		const svgBlock = [
			'',
			'--- Chart SVG ---',
			`identifier: ${id}`,
			`title: ${ttl}`,
			'type: image/svg+xml',
			'',
			String(data.svg),
		].join('\n');

		return {
			content: [{ type: 'text', text: summary + svgBlock }],
			structuredContent: {
				...(parsed as Record<string, unknown>),
				artifactHint: {
					renderHint: 'ARTIFACT_REQUIRED',
					displayType: 'image/svg+xml',
					source: 'inline_svg',
				},
			},
		};
	},
};
