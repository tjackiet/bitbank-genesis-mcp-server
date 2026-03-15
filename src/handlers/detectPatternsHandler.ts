import { timeframeLabel } from '../../lib/formatter.js';
import detectPatterns from '../../tools/detect_patterns.js';
import { DetectPatternsInputSchema, DetectPatternsOutputSchema } from '../schemas.js';
import type { ToolDefinition } from '../tool-definition.js';
import {
	buildPeriodLine,
	buildTypeSummary,
	formatDebugView,
	formatDetailedView,
	formatFullView,
	formatSummaryView,
} from './detectPatternsViewsHandler.js';

export const toolDef: ToolDefinition = {
	name: 'detect_patterns',
	description:
		'[Chart Patterns / Double Top / Head and Shoulders / Triangle] チャートパターン検出（chart patterns / double top / double bottom / head and shoulders / triangle / wedge / flag）。形成中+完成済みを統合検出。\n\n視覚確認: 結果の overlays を render_chart_svg に渡して描画可能。',
	inputSchema: DetectPatternsInputSchema,
	handler: async ({
		pair,
		type,
		limit,
		patterns,
		swingDepth,
		tolerancePct,
		minBarsBetweenSwings,
		view,
		requireCurrentInPattern,
		currentRelevanceDays,
		includeForming,
		includeCompleted,
		includeInvalid,
	}: any) => {
		const out = await detectPatterns(pair, type, limit, {
			patterns,
			swingDepth,
			tolerancePct,
			minBarsBetweenSwings,
			requireCurrentInPattern,
			currentRelevanceDays,
			includeForming,
			includeCompleted,
			includeInvalid,
		});
		const res = DetectPatternsOutputSchema.parse(out as any);
		if (!res?.ok) return res as any;
		const pats: any[] = Array.isArray((res as any)?.data?.patterns) ? (res as any).data.patterns : [];
		const meta: any = (res as any)?.meta || {};
		const count = Number(meta?.count ?? pats.length ?? 0);
		const tfLabel = timeframeLabel(String(type));
		const hdr = `${String(pair).toUpperCase()} ${tfLabel}（${String(type)}） ${limit ?? count}本から${pats.length}件を検出`;

		if (view === 'debug') {
			return formatDebugView(hdr, meta, pats, res as any);
		}

		const periodLine = buildPeriodLine(pats);
		const typeSummary = buildTypeSummary(pats);

		if ((view || 'detailed') === 'summary') {
			return formatSummaryView(hdr, pats, periodLine, typeSummary, patterns, includeForming, res as any);
		}
		if ((view || 'detailed') === 'full') {
			return formatFullView(hdr, pats, periodLine, typeSummary, meta, res as any);
		}
		// detailed (default)
		return formatDetailedView(hdr, pats, periodLine, typeSummary, meta, tolerancePct, patterns, res as any);
	},
};
