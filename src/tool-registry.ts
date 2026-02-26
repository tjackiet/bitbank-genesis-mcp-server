/**
 * tool-registry.ts — 全 MCP ツール定義の集約
 *
 * 各ツールファイル（tools/*.ts）または複雑なハンドラファイル（src/handlers/*Handler.ts）から
 * toolDef をインポートし、配列として server.ts に提供する。
 *
 * 【ツール追加手順】
 * 1. tools/<name>.ts にツール関数を実装
 * 2. 同ファイル（または src/handlers/<name>Handler.ts）に toolDef を export
 * 3. ★ 本ファイルに import + allToolDefs に追加 ★
 * 4. npm run sync:manifest && npm run typecheck
 */

import type { ToolDefinition } from './tool-definition.js';

// ── Simple tools（toolDef はツールファイル内） ──
import { toolDef as getTicker } from '../tools/get_ticker.js';
import { toolDef as getOrderbook } from '../tools/get_orderbook.js';
import { toolDef as analyzeIchimokuSnapshot } from '../tools/analyze_ichimoku_snapshot.js';
import { toolDef as analyzeBbSnapshot } from '../tools/analyze_bb_snapshot.js';
import { toolDef as analyzeSmaSnapshot } from '../tools/analyze_sma_snapshot.js';
import { toolDef as analyzeSupportResistance } from '../tools/analyze_support_resistance.js';
import { toolDef as analyzeCandlePatterns } from '../tools/analyze_candle_patterns.js';
import { toolDef as detectWhaleEvents } from '../tools/detect_whale_events.js';

// ── Medium tools（toolDef + inline handler はツールファイル内） ──
import { toolDef as getCandles } from '../tools/get_candles.js';
import { toolDef as getTransactions } from '../tools/get_transactions.js';
import { toolDef as getFlowMetrics } from '../tools/get_flow_metrics.js';
import { toolDef as renderDepthSvg } from '../tools/render_depth_svg.js';
import { toolDef as renderCandlePatternDiagram } from '../tools/render_candle_pattern_diagram.js';
import { toolDef as detectMacdCross } from '../tools/detect_macd_cross.js';

// ── Complex tools（toolDef + handler は src/handlers/ に分離） ──
import { toolDef as analyzeIndicators } from './handlers/analyzeIndicatorsHandler.js';
import { toolDef as getVolatilityMetrics } from './handlers/getVolatilityMetricsHandler.js';
import { toolDef as renderChartSvg } from './handlers/renderChartSvgHandler.js';
import { toolDef as detectPatterns } from './handlers/detectPatternsHandler.js';
import { toolDef as analyzeMarketSignal } from './handlers/analyzeMarketSignalHandler.js';
import { toolDef as getTickersJpy } from './handlers/getTickersJpyHandler.js';
import { toolDef as analyzeMacdPattern } from './handlers/analyzeMacdPattern.js';
import { toolDef as runBacktest } from './handlers/runBacktestHandler.js';

/**
 * 全 MCP ツール定義の配列。
 * server.ts はこの配列をイテレートして registerToolWithLog を呼ぶ。
 */
export const allToolDefs: ToolDefinition[] = [
	// Data retrieval
	getTicker,
	getOrderbook,
	getCandles,
	getTransactions,
	getFlowMetrics,
	getVolatilityMetrics,
	getTickersJpy,

	// Analysis
	analyzeIndicators,
	analyzeBbSnapshot,
	analyzeIchimokuSnapshot,
	analyzeSmaSnapshot,
	analyzeSupportResistance,
	analyzeCandlePatterns,
	analyzeMacdPattern,
	analyzeMarketSignal,

	// Detection
	detectPatterns,
	detectMacdCross,
	detectWhaleEvents,

	// Rendering
	renderChartSvg,
	renderDepthSvg,
	renderCandlePatternDiagram,

	// Trading
	runBacktest,
];
