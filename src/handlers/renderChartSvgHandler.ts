import renderChartSvg from '../../tools/render_chart_svg.js';
import { RenderChartSvgInputSchema, RenderChartSvgOutputSchema } from '../schemas.js';
import type { ToolDefinition } from '../tool-definition.js';

export const toolDef: ToolDefinition = {
	name: 'render_chart_svg',
	description: 'ローソク足/ライン/板チャートをSVG形式で生成します。\n\n【重要な使用タイミング（厳守）】\n- ユーザーが「描画/可視化/チャートで見たい」等と明示したときのみ使用\n- detect_patterns 等の結果を「図で確認したい」とユーザーが要望したとき\n\n【使用してはいけない場合】\n- 数値だけで足りる問い合わせ（分析/要約のみ）\n- ユーザーが視覚化を求めていないとき（自発的に使わない）\n\n【返却形式】\n- data.svg: 完全なSVG文字列（そのままアーティファクトとして表示可能）\n- data.legend: 描画したレイヤの凡例\n- meta.range: { start, end }（ISO8601）\n- meta.indicators: 表示中のインジケータ一覧\n\n【チャート表示方法】\n返却される svg をHTMLアーティファクトに埋め込んで表示してください。\n例: <html><body>ここにSVGを埋め込む</body></html>\n\n【他ツールとの連携】\n1) detect_patterns を実行\n2) 返却された data.overlays を取得\n3) render_chart_svg({ overlays: data.overlays }) に渡して描画\n\n【軽量化オプション】\n- svgPrecision, svgMinify, simplifyTolerance, viewBoxTight',
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
		const indLine = Array.isArray(meta?.indicators) && meta.indicators.length
			? `Indicators: ${meta.indicators.join(', ')}` : '';
		const legendLines = data?.legend
			? Object.entries(data.legend).map(([k, v]: any[]) => `${k}: ${String(v)}`).join(' / ') : '';

		const summary = [
			`${pair} ${type} chart`,
			rangeLine,
			indLine,
			legendLines,
		].filter(Boolean).join(' | ');

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
