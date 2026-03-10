/**
 * analyze_my_portfolio — ポートフォリオ分析ツール（Phase 3）。
 *
 * 保有資産・約定履歴・テクニカル分析を統合し、
 * 損益状況とポートフォリオ全体の評価を LLM に提供する。
 */

import { AnalyzeMyPortfolioInputSchema } from '../../src/private/schemas.js';
import analyzeMyPortfolioHandler from '../../src/handlers/analyzeMyPortfolioHandler.js';
import type { ToolDefinition } from '../../src/tool-definition.js';

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'analyze_my_portfolio',
	description:
		'ポートフォリオ分析。保有資産の評価損益・実現損益・構成比を算出し、オプションでテクニカル分析を統合。Private API（要APIキー設定）。',
	inputSchema: AnalyzeMyPortfolioInputSchema,
	handler: async (args: any) => analyzeMyPortfolioHandler(args ?? {}),
};
