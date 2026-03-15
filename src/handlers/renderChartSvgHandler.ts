import renderChartSvg from '../../tools/render_chart_svg.js';
import { RenderChartSvgInputSchema, RenderChartSvgOutputSchema } from '../schemas.js';
import type { ToolDefinition } from '../tool-definition.js';

export const toolDef: ToolDefinition = {
	name: 'render_chart_svg',
	description:
		'[Chart / SVG / Candlestick Chart / Visualization] ローソク足・ラインチャートをSVG生成（chart / SVG / candlestick chart / visualization / BB / Ichimoku / SMA）。\n\nユーザーが描画・可視化を明示した場合のみ使用。自発的呼び出し禁止。\ndetect_patterns の overlays を渡してパターン描画可能。data.svg をHTMLに埋め込んで表示。',
	inputSchema: RenderChartSvgInputSchema,
	handler: async (args: any) => {
		const raw = await renderChartSvg(args as any);
		const parsed = RenderChartSvgOutputSchema.parse(raw);

		const data: any = (parsed as any).data || {};
		const meta: any = (parsed as any).meta || {};
		const pair = String(meta?.pair || args?.pair || 'pair').toUpperCase();
		const type = String(meta?.type || args?.type || '1day');

		if (!data?.svg) {
			const txt = String((parsed as any)?.summary || 'chart rendered (no svg)');
			return { content: [{ type: 'text', text: txt }], structuredContent: parsed as any };
		}

		// run_backtest と同じ方式: 生 SVG をテキストとしてそのまま返す
		const id = String(meta?.identifier || `${pair}-${type}-${Date.now()}`);
		const ttl = String(meta?.title || `${pair} ${type} chart`);
		const rangeLine = meta?.range ? `Period: ${meta.range.start} \u2013 ${meta.range.end}` : '';
		const indLine =
			Array.isArray(meta?.indicators) && meta.indicators.length ? `Indicators: ${meta.indicators.join(', ')}` : '';
		const legendLines = data?.legend
			? Object.entries(data.legend)
					.map(([k, v]: any[]) => `${k}: ${String(v)}`)
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
				...(parsed as any),
				artifactHint: {
					renderHint: 'ARTIFACT_REQUIRED',
					displayType: 'image/svg+xml',
					source: 'inline_svg',
				},
			},
		};
	},
};
