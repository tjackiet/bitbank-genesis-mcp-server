import renderChartSvg from '../../tools/render_chart_svg.js';
import { RenderChartSvgInputSchema, RenderChartSvgOutputSchema } from '../schemas.js';
import type { ToolDefinition } from '../tool-definition.js';

export const toolDef: ToolDefinition = {
	name: 'render_chart_svg',
	description: 'ローソク足/ライン/板チャートをSVG形式で生成します。\n\n【重要な使用タイミング（厳守）】\n- ユーザーが「描画/可視化/チャートで見たい」等と明示したときのみ使用\n- detect_patterns 等の結果を「図で確認したい」とユーザーが要望したとき\n\n【使用してはいけない場合】\n- 数値だけで足りる問い合わせ（分析/要約のみ）\n- ユーザーが視覚化を求めていないとき（自発的に使わない）\n\n【返却形式】\n- data.svg: 完全なSVG文字列\n- data.filePath: ファイル保存時のパス\n- data.legend: 描画したレイヤの凡例\n- meta.range: { start, end }（ISO8601）\n- meta.indicators: 表示中のインジケータ一覧\n\n【チャート表示方法（重要）】\nClaude.aiでチャートを表示するには、HTMLファイルにSVGを埋め込んで提示してください。\nSVGファイルを直接 present_files で提示しても、ダウンロードリンクになるだけで画像として表示されません。\n\n手順:\n1. render_chart_svg を呼び出し、data.svg を取得\n2. create_file でHTMLファイル（SVG埋め込み）を /mnt/user-data/outputs/ に保存\n3. present_files でHTMLファイルを提示\n\n※ SVGファイル単体の present_files は非推奨（表示されない）\n\n【他ツールとの連携】\n1) detect_patterns を実行\n2) 返却された data.overlays を取得\n3) render_chart_svg({ overlays: data.overlays }) に渡して描画\n\n【出力フォーマット（outputFormat）】\n- svg（デフォルト）: SVG文字列を data.svg に格納\n- dataUri: data:image/svg+xml;base64,... 形式の文字列をテキスト本文に含めて返却。HTMLへの直接埋め込みに最適\n- base64: Base64エンコード文字列を返却\n※ dataUri/base64 指定時は preferFile=true でもエンコード済み文字列がテキスト本文に含まれます\n\n【軽量化オプション】\n- svgPrecision, svgMinify, simplifyTolerance, viewBoxTight\n- maxSvgBytes: 超過時は data.filePath、preferFile=true: 常に保存のみ',
	inputSchema: RenderChartSvgInputSchema,
	handler: async (args: any) => {
		// Default to file-first strategy for reliability
		const effArgs = {
			...args,
			autoSave: args?.autoSave !== undefined ? args.autoSave : true,
			preferFile: args?.preferFile !== undefined ? args.preferFile : true,
		};
		const raw = await renderChartSvg(effArgs as any);
		const parsed = RenderChartSvgOutputSchema.parse(raw);
		// 本文に SVG/メタ情報を含め、LLM が structuredContent を見られない環境でも利用できるようにする
		try {
			const data: any = (parsed as any).data || {};
			const meta: any = (parsed as any).meta || {};
			const pair = String(meta?.pair || args?.pair || 'pair').toUpperCase();
			const type = String(meta?.type || args?.type || '1day');
			const header = `${pair} ${type} chart rendered`;
			// Prefer file output (concise link-based content)
			if (data?.filePath || data?.url) {
				const rangeLine = meta?.range ? `- Period: ${meta.range.start} to ${meta.range.end}` : '';
				const tfLine = `- Timeframe: ${type}${meta?.limit ? ` (${meta.limit} candles)` : ''}`;
				const indLine = `- Indicators: ${Array.isArray(meta?.indicators) && meta.indicators.length ? meta.indicators.join(', ') : 'None'}`;
				const sizeLine = meta?.sizeBytes != null ? `- Size: ${meta.sizeBytes} bytes` : '';
				const linkLine = data?.url ? `View chart: ${data.url}` : `View chart: computer://${data.filePath}`;
				// outputFormat=dataUri/base64 指定時は data.base64 にエンコード済み文字列が格納されている
				const dataUriLine = data?.base64 ? `\nData URI:\n${data.base64}` : '';
				const text = [
					'\n📊 Chart Generated Successfully',
					'',
					linkLine,
					'',
					'Chart Details:',
					`- Pair: ${pair}`,
					rangeLine,
					tfLine,
					indLine,
					sizeLine,
					dataUriLine,
					'',
					'【次のステップ】Claude.aiでチャートを表示するには、このSVGをHTMLに埋め込んで create_file → present_files してください。',
					'※ SVGファイル単体の present_files は非推奨（表示されない）'
				].filter(Boolean).join('\n');
				const enriched = {
					...(parsed as any),
					displayMode: 'file',
					artifactHint: {
						renderHint: 'FILE_LINK',
						displayType: 'image/svg+xml',
						source: 'file',
						svgBytes: Number(meta?.sizeBytes ?? 0),
						filePath: data?.filePath || null,
						fileUrl: data?.url || (data?.filePath ? `computer://${data.filePath}` : null),
					},
				} as any;
				return { content: [{ type: 'text', text }], structuredContent: enriched };
			}
			if (data?.svg) {
				const id = String(meta?.identifier || `${pair}-${type}-${Date.now()}`);
				const ttl = String(meta?.title || `${pair} ${type} chart`);
				const rangeLine = meta?.range ? `- Period: ${meta.range.start} to ${meta.range.end}` : '';
				const tfLine = `- Timeframe: ${type}${meta?.limit ? ` (${meta.limit} candles)` : ''}`;
				const indLine = `- Indicators: ${Array.isArray(meta?.indicators) && meta.indicators.length ? meta.indicators.join(', ') : 'none'}`;
				const sizeLine = meta?.sizeBytes != null ? `- Size: ${meta.sizeBytes} bytes` : '';
				const legendLines = data?.legend ? Object.entries(data.legend).map(([k, v]: any[]) => `- ${k}: ${String(v)}`).join('\n') : '';
				const text = [
					'--- Chart SVG ---',
					`identifier: ${id}`,
					`title: ${ttl}`,
					'type: image/svg+xml',
					'',
					String(data.svg),
					'',
					'Chart Info:',
					rangeLine,
					tfLine,
					indLine,
					sizeLine,
					'',
					legendLines ? 'Legend:\n' + legendLines : ''
				].filter(Boolean).join('\n');
				const enriched = {
					...(parsed as any),
					artifactHint: {
						renderHint: 'ARTIFACT_REQUIRED',
						displayType: 'image/svg+xml',
						source: 'inline_svg',
						svgBytes: Number(meta?.sizeBytes ?? 0),
						filePath: data?.filePath || null,
						fileUrl: data?.url || null,
					},
				} as any;
				return { content: [{ type: 'text', text }], structuredContent: enriched };
			}
			// outputFormat=base64/dataUri でインライン返却（filePath なし）の場合
			if (data?.base64) {
				const rangeLine = meta?.range ? `- Period: ${meta.range.start} to ${meta.range.end}` : '';
				const tfLine = `- Timeframe: ${type}${meta?.limit ? ` (${meta.limit} candles)` : ''}`;
				const text = [
					`📊 ${header}`,
					'',
					'Chart Details:',
					`- Pair: ${pair}`,
					rangeLine,
					tfLine,
					'',
					'Data URI:',
					String(data.base64),
				].filter(Boolean).join('\n');
				return { content: [{ type: 'text', text }], structuredContent: parsed as any };
			}
			const txt = String((parsed as any)?.summary || '');
			return { content: [{ type: 'text', text: txt }], structuredContent: parsed as any };
		} catch {
			return { content: [{ type: 'text', text: String((parsed as any)?.summary || 'chart rendered') }], structuredContent: parsed as any };
		}
	},
};
