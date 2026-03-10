/**
 * analyze_my_portfolio — ポートフォリオ分析ツール（Phase 3 + Phase 4 拡張）。
 *
 * 保有資産・約定履歴・入出金履歴・テクニカル分析を統合し、
 * 損益状況とポートフォリオ全体の評価を LLM に提供する。
 * 入出金データがあれば口座全体のリターンを概算する。
 */

import { AnalyzeMyPortfolioInputSchema } from '../../src/private/schemas.js';
import analyzeMyPortfolioHandler from '../../src/handlers/analyzeMyPortfolioHandler.js';
import type { ToolDefinition } from '../../src/tool-definition.js';

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'analyze_my_portfolio',
	description:
		'ポートフォリオ分析。口座全体（JPY含む）の評価額と暗号資産の評価損益・実現損益（手数料反映済み）を算出。入出金データがあれば総入金額 vs 現在評価額で口座全体のリターンも概算（直近100件ベース、暗号資産入庫は現在価格で仮評価）。売り切り銘柄の実現損益も含む。オプションでテクニカル分析を統合。Private API（要APIキー設定）。',
	inputSchema: AnalyzeMyPortfolioInputSchema,
	handler: async (args: any) => analyzeMyPortfolioHandler(args ?? {}),
};
