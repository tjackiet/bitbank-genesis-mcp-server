import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import getTicker from '../tools/get_ticker.js';
import getOrderbook from '../tools/get_orderbook.js';
import getCandles from '../tools/get_candles.js';
import analyzeIndicators from '../tools/analyze_indicators.js';
import renderChartSvg from '../tools/render_chart_svg.js';
import renderDepthSvg from '../tools/render_depth_svg.js';
import detectPatterns from '../tools/detect_patterns.js';
import { logToolRun, logError } from '../lib/logger.js';
import { stddev } from '../lib/math.js';
import { formatPriceJPY, formatPercent, formatCurrency, formatCurrencyShort, formatPrice as fmtPrice, formatVolumeJPY } from '../lib/formatter.js';
// schemas.ts を単一のソースとして参照し、型は z.infer に委譲
import { RenderChartSvgInputSchema, RenderChartSvgOutputSchema, GetTickerInputSchema, GetOrderbookInputSchema, GetCandlesInputSchema, GetIndicatorsInputSchema } from './schemas.js';
import { GetVolMetricsInputSchema, GetVolMetricsOutputSchema } from './schemas.js';
// removed GetMarketSummary schemas
import { GetTransactionsInputSchema } from './schemas.js';
import getTransactions from '../tools/get_transactions.js';
import getFlowMetrics from '../tools/get_flow_metrics.js';
import getVolatilityMetrics from '../tools/get_volatility_metrics.js';
// removed get_market_summary tool
import analyzeMarketSignal from '../tools/analyze_market_signal.js';
import analyzeIchimokuSnapshot from '../tools/analyze_ichimoku_snapshot.js';
import analyzeBbSnapshot from '../tools/analyze_bb_snapshot.js';
import analyzeSmaSnapshot from '../tools/analyze_sma_snapshot.js';
import analyzeSupportResistance from '../tools/analyze_support_resistance.js';
import analyzeCandlePatterns from '../tools/analyze_candle_patterns.js';
import renderCandlePatternDiagram from '../tools/render_candle_pattern_diagram.js';
import { runBacktest, getAvailableStrategies, getStrategyDefaults } from '../tools/trading_process/index.js';
import getTickersJpy from '../tools/get_tickers_jpy.js';
import detectMacdCross from '../tools/detect_macd_cross.js';
import detectWhaleEvents from '../tools/detect_whale_events.js';
import analyzeMacdPattern from './handlers/analyzeMacdPattern.js';
import { DetectPatternsInputSchema, DetectPatternsOutputSchema } from './schemas.js';
import { AnalyzeMarketSignalInputSchema, AnalyzeMarketSignalOutputSchema } from './schemas.js';
import { RunBacktestInputSchema, RunBacktestOutputSchema, StrategyTypeEnum } from './schemas.js';
// typed prompt schema imports not used; prompts are registered via prompts.ts
import { prompts as promptDefs } from './prompts.js';
import { SYSTEM_PROMPT } from './system-prompt.js';

const server = new McpServer({ name: 'bitbank-mcp', version: '0.4.2' });
// Explicit registries for tools/prompts to improve STDIO inspector compatibility
const registeredTools: Array<{ name: string; description: string; inputSchema: any }> = [];
const registeredPrompts: Array<{ name: string; description: string }> = [];

type TextContent = { type: 'text'; text: string; _meta?: Record<string, unknown> };
type ToolReturn = { content: TextContent[]; structuredContent?: Record<string, unknown> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const respond = (result: unknown): ToolReturn => {
	// 優先順位: custom content > summary > safe JSON fallback
	let text = '';
	if (isPlainObject(result)) {
		const r: any = result as any;
		// ツールが content を提供している場合（配列 or 文字列）を優先
		if (Array.isArray(r.content)) {
			const first = r.content.find((c: any) => c && c.type === 'text' && typeof c.text === 'string');
			if (first) {
				text = String(first.text);
			}
		} else if (typeof r.content === 'string') {
			text = String(r.content);
		}
		// 上記で未決定なら summary を採用
		if (!text && typeof r.summary === 'string') {
			text = String(r.summary);
		}
	}
	// それでも空の場合は安全な短縮JSONにフォールバック
	if (!text) {
		try {
			const json = JSON.stringify(result, (_key, value) => {
				if (typeof value === 'string' && value.length > 2000) return `…omitted (${value.length} chars)`;
				return value;
			}, 2);
			text = json.length > 4000 ? json.slice(0, 4000) + '\n…(truncated)…' : json;
		} catch {
			text = String(result);
		}
	}
	return {
		content: [{ type: 'text', text }],
		...(isPlainObject(result) ? { structuredContent: result } : {}),
	};
};

function registerToolWithLog<S extends z.ZodTypeAny, R = unknown>(
	name: string,
	schema: { description: string; inputSchema: S },
	handler: (input: z.infer<S>) => Promise<R>
) {
	// Convert Zod schema → JSON Schema (subset) for MCP inspector
	const unwrapZod = (s: any): any => {
		let cur = s;
		for (let i = 0; i < 6; i++) {
			const def = cur?._def;
			if (!def) break;
			if (def?.schema) { cur = def.schema; continue; }
			if (def?.innerType) { cur = def.innerType; continue; }
			break;
		}
		return cur;
	};
	const toJsonSchema = (s: any): any => {
		s = unwrapZod(s);
		const t = s?._def?.typeName;
		switch (t) {
			case 'ZodString': {
				const out: any = { type: 'string' };
				const checks = s?._def?.checks || [];
				const rex = checks.find((c: any) => c.kind === 'regex')?.regex;
				if (rex) out.pattern = String(rex.source);
				return out;
			}
			case 'ZodNumber': {
				const out: any = { type: 'number' };
				const checks = s?._def?.checks || [];
				const min = checks.find((c: any) => c.kind === 'min')?.value;
				const max = checks.find((c: any) => c.kind === 'max')?.value;
				if (Number.isFinite(min)) out.minimum = min;
				if (Number.isFinite(max)) out.maximum = max;
				return out;
			}
			case 'ZodBoolean': return { type: 'boolean' };
			case 'ZodEnum': return { type: 'string', enum: [...(s?._def?.values || [])] };
			case 'ZodArray': return { type: 'array', items: toJsonSchema(s?._def?.type) };
			case 'ZodTuple': {
				const items = (s?._def?.items || []).map((it: any) => toJsonSchema(it));
				return { type: 'array', items, minItems: items.length, maxItems: items.length };
			}
			case 'ZodRecord': return { type: 'object', additionalProperties: toJsonSchema(s?._def?.valueType) };
			case 'ZodObject': {
				const shape = (s as any).shape || (typeof s?._def?.shape === 'function' ? s._def.shape() : undefined) || {};
				const properties: Record<string, any> = {};
				const required: string[] = [];
				for (const [key, zodProp] of Object.entries(shape)) {
					// detect defaults and optional
					let defVal: any = undefined;
					let isOptional = false;
					let cur: any = zodProp as any;
					for (let i = 0; i < 6; i++) {
						const def = cur?._def;
						if (!def) break;
						if (def.typeName === 'ZodDefault') {
							try { defVal = typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue; } catch { }
							cur = def.innerType; continue;
						}
						if (def.typeName === 'ZodOptional') { isOptional = true; cur = def.innerType; continue; }
						if (def?.schema) { cur = def.schema; continue; }
						if (def?.innerType) { cur = def.innerType; continue; }
						break;
					}
					properties[key] = toJsonSchema(cur);
					if (defVal !== undefined) properties[key].default = defVal;
					if (!isOptional && defVal === undefined) required.push(key);
				}
				const obj: any = { type: 'object', properties };
				if (required.length) obj.required = required;
				return obj;
			}
			default: return {};
		}
	};

	// Build JSON Schema for listing
	const inputSchemaJson = toJsonSchema(schema.inputSchema) || { type: 'object', properties: {} };
	registeredTools.push({ name, description: schema.description, inputSchema: inputSchemaJson });

	// For actual registration, the SDK expects a Zod raw shape (not JSON schema)
	const getRawShape = (s: z.ZodTypeAny): z.ZodRawShape => {
		let cur: any = s as any;
		for (let i = 0; i < 6; i++) {
			if (cur?.shape) break;
			const def = cur?._def;
			if (!def) break;
			if (def?.schema) { cur = def.schema; continue; }
			if (def?.innerType) { cur = def.innerType; continue; }
			break;
		}
		if (cur?.shape) return cur.shape as z.ZodRawShape;
		throw new Error('inputSchema must be or wrap a ZodObject');
	};

	server.registerTool(name, { description: schema.description, inputSchema: getRawShape(schema.inputSchema) } as any, async (input: any) => {
		const t0 = Date.now();
		try {
			const result = await handler(input as z.infer<S>);
			const ms = Date.now() - t0;
			logToolRun({ tool: name, input, result, ms });
			return respond(result);
		} catch (err: unknown) {
			const ms = Date.now() - t0;
			logError(name, err, input);
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: 'text', text: `internal error: ${message || 'unknown error'}` }],
				structuredContent: {
					ok: false,
					summary: `internal error: ${message || 'unknown error'}`,
					meta: { ms, errorType: 'internal' },
				},
			};
		}
	});
}

registerToolWithLog(
	'get_ticker',
	{ description: '単一ペアのティッカーを取得（/ticker）。価格・出来高・24h高安。', inputSchema: GetTickerInputSchema },
	async ({ pair }) => getTicker(pair)
);

registerToolWithLog(
	'get_orderbook',
	{ description: `板情報の統合ツール（単一の /depth API呼出しで全モードをカバー）。

【mode 一覧】
- summary（デフォルト）: 上位N層の正規化＋累計サイズ＋spread。topN=1-200。
- pressure: 帯域(±0.1%/0.5%/1%等)別の買い/売り圧力バランス。bandsPct で帯域を指定。
- statistics: 範囲分析(±0.5%/1%/2%)＋流動性ゾーン＋大口注文＋総合評価。ranges, priceZones で指定。
- raw: 生の bids/asks 配列＋壁ゾーン自動推定。`, inputSchema: GetOrderbookInputSchema },
	async ({ pair, mode, topN, bandsPct, ranges, priceZones }: any) => {
		return getOrderbook({ pair, mode, topN, bandsPct, ranges, priceZones });
	}
);

registerToolWithLog(
	'get_candles',
	{ description: `ローソク足（OHLCV）を取得。

【パラメータ】
- pair: 通貨ペア（例: btc_jpy）
- type: 時間足（1min, 5min, 15min, 30min, 1hour, 4hour, 8hour, 12hour, 1day, 1week, 1month）
- date: 日付指定。1min〜1hour→YYYYMMDD形式、4hour以上→YYYY形式
- limit: 取得本数

【重要】バックテストを行う場合は、このツールではなく run_backtest を使用してください。
run_backtest はデータ取得・計算・チャート描画をすべて行い、結果をワンコールで返します。
独自にバックテストロジックを実装する必要はありません。`, inputSchema: GetCandlesInputSchema },
	async ({ pair, type, date, limit, view }) => {
		const result: any = await getCandles(pair, type, date, limit);
		if (view === 'items') {
			const items = result?.data?.normalized ?? [];
			return {
				content: [{ type: 'text', text: JSON.stringify(items, null, 2) }],
				// structuredContent は Record<string, unknown> が期待されるため、配列は直接渡さない
				structuredContent: { items } as Record<string, unknown>,
			};
		}
		// view=full でもサンプル（先頭5件）を本文に含める
		try {
			const items = Array.isArray(result?.data?.normalized) ? result.data.normalized : [];
			const sample = items.slice(0, 5);
			const header = String(result?.summary ?? `${String(pair).toUpperCase()} [${String(type)}]`);
			const text = `${header}\nSample (first ${sample.length}/${items.length}):\n${JSON.stringify(sample, null, 2)}`;
			return { content: [{ type: 'text', text }], structuredContent: result as Record<string, unknown> };
		} catch {
			return result;
		}
	}
);

registerToolWithLog(
	'analyze_indicators',
	{ description: 'テクニカル指標を用いて値動きを分析（ローソク足 /candlestick を入力）。SMA/RSI/BB/一目/MACD。分析には十分な limit を指定（例: 日足200本）。\n\n【重要】バックテストを行う場合は、このツールではなく run_backtest を使用してください。run_backtest はデータ取得・計算・チャート描画をすべて行い、結果をワンコールで返します。', inputSchema: GetIndicatorsInputSchema },
	async ({ pair, type, limit }) => {
		const res: any = await analyzeIndicators(pair, type, limit);
		if (!res?.ok) return res;
		const ind: any = res?.data?.indicators ?? {};
		const candles: any[] = Array.isArray(res?.data?.normalized) ? res.data.normalized : [];
		const close = candles.at(-1)?.close ?? null;
		const prev = candles.at(-2)?.close ?? null;
		const nowJst = (() => {
			try { return new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false }).replace(/\//g, '-'); } catch { return new Date().toISOString(); }
		})();
		const fmtJPY = formatPriceJPY;
		const fmtPct = (v: number | null | undefined, digits = 1) => formatPercent(v, { sign: true, digits });
		const vsCurPct = (ref?: number | null) => {
			if (close == null || ref == null || !Number.isFinite(close) || !Number.isFinite(ref) || ref === 0) return 'n/a';
			const pct = ((ref - close) / Math.abs(close)) * 100;
			const dir = ref >= close ? '上方' : '下方';
			return `${fmtPct(pct, 1)} ${dir}`;
		};
		const deltaPrev = (() => {
			if (close == null || prev == null || !Number.isFinite(prev) || prev === 0) return null;
			const amt = Number(close) - Number(prev);
			const pct = (amt / Math.abs(Number(prev))) * 100;
			return { amt, pct };
		})();
		const deltaLabel = (() => {
			const t = String(type ?? '').toLowerCase();
			if (t.includes('day')) return '前日比';
			if (t.includes('week')) return '前週比';
			if (t.includes('month')) return '前月比';
			if (t.includes('hour')) return '前時間比';
			if (t.includes('min')) return '前足比';
			return '前回比';
		})();
		const rsi = ind.RSI_14 ?? null;
		const rsiSeries = Array.isArray(res?.data?.indicators?.RSI_14_series) ? res.data.indicators.RSI_14_series : null;
		const recentRsiRaw = (() => {
			if (!Array.isArray(rsiSeries) || rsiSeries.length === 0) return [];
			return rsiSeries.slice(-7).map((v: any) => {
				const num = Number(v);
				return Number.isFinite(num) ? num : null;
			});
		})();
		const recentRsiFormatted = recentRsiRaw.map(v => (v == null ? 'n/a' : Number(v).toFixed(1)));
		const rsiTrendLabel = (() => {
			if (recentRsiRaw.length < 2) return null;
			const first = recentRsiRaw.find(v => v != null);
			const last = [...recentRsiRaw].reverse().find(v => v != null);
			if (first == null || last == null) return null;
			const diff = last - first;
			if (Math.abs(diff) < 1) return '横ばい';
			return diff > 0 ? '回復傾向' : '悪化傾向';
		})();
		const rsiUnitLabel = (() => {
			const t = String(type ?? '').toLowerCase();
			if (t.includes('day')) return '日';
			if (t.includes('week')) return '週';
			if (t.includes('month')) return '月';
			if (t.includes('hour')) return '時間';
			if (t.includes('min')) return '本';
			return '本';
		})();
		const sma25 = ind.SMA_25 ?? null;
		const sma75 = ind.SMA_75 ?? null;
		const sma200 = ind.SMA_200 ?? null;
		const bbMid = ind.BB_middle ?? ind.BB2_middle ?? null;
		const bbUp = ind.BB_upper ?? ind.BB2_upper ?? null;
		const bbLo = ind.BB_lower ?? ind.BB2_lower ?? null;
		const sigmaZ = (close != null && bbMid != null && bbUp != null && (bbUp - bbMid) !== 0)
			? Number((2 * (close - bbMid) / (bbUp - bbMid)).toFixed(2))
			: null;
		const bandWidthPct = (bbUp != null && bbLo != null && bbMid)
			? Number((((bbUp - bbLo) / bbMid) * 100).toFixed(2))
			: null;
		const macdLine = ind.MACD_line ?? null;
		const macdSignal = ind.MACD_signal ?? null;
		const macdHist = ind.MACD_hist ?? null;
		const spanA = ind.ICHIMOKU_spanA ?? null;
		const spanB = ind.ICHIMOKU_spanB ?? null;
		const tenkan = ind.ICHIMOKU_conversion ?? null;
		const kijun = ind.ICHIMOKU_base ?? null;
		const cloudTop = (spanA != null && spanB != null) ? Math.max(spanA, spanB) : null;
		const cloudBot = (spanA != null && spanB != null) ? Math.min(spanA, spanB) : null;
		const cloudPos = (close != null && cloudTop != null && cloudBot != null)
			? (close > cloudTop ? 'above_cloud' : (close < cloudBot ? 'below_cloud' : 'in_cloud'))
			: 'unknown';
		const trend = res?.data?.trend ?? 'unknown';
		const count = res?.meta?.count ?? candles.length ?? 0;
		// Helpers: slope and last cross
		const slopeOf = (seriesKey: string, n = 5): number | null => {
			const arr = Array.isArray(res?.data?.indicators?.series?.[seriesKey]) ? res.data.indicators.series[seriesKey] : null;
			if (!arr || arr.length < 2) return null;
			const len = Math.min(n, arr.length);
			const a = Number(arr.at(-len) ?? NaN);
			const b = Number(arr.at(-1) ?? NaN);
			if (!Number.isFinite(a) || !Number.isFinite(b) || len <= 1) return null;
			return (b - a) / (len - 1);
		};
		const slopeSym = (s: number | null | undefined) => (s == null ? '➡️' : (s > 0 ? '📈' : (s < 0 ? '📉' : '➡️')));
		const lastMacdCross = (() => {
			const macdArr = Array.isArray(res?.data?.indicators?.series?.MACD_line) ? res.data.indicators.series.MACD_line : null;
			const sigArr = Array.isArray(res?.data?.indicators?.series?.MACD_signal) ? res.data.indicators.series.MACD_signal : null;
			if (!macdArr || !sigArr) return null;
			const L = Math.min(macdArr.length, sigArr.length);
			let lastIdx: number | null = null;
			let lastType: 'golden' | 'dead' | null = null;
			for (let i = L - 2; i >= 0; i--) {
				const a0 = Number(macdArr[i]), b0 = Number(sigArr[i]);
				const a1 = Number(macdArr[i + 1]), b1 = Number(sigArr[i + 1]);
				if ([a0, b0, a1, b1].some(v => !Number.isFinite(v))) continue;
				const prevDiff = a0 - b0;
				const nextDiff = a1 - b1;
				if (prevDiff === 0) continue;
				if ((prevDiff < 0 && nextDiff > 0) || (prevDiff > 0 && nextDiff < 0)) {
					lastIdx = i + 1;
					lastType = nextDiff > 0 ? 'golden' : 'dead';
					break;
				}
			}
			if (lastIdx == null) return null;
			const barsAgo = (L - 1) - lastIdx;
			return { type: lastType, barsAgo };
		})();
		const divergence = (() => {
			// simple divergence check over last 14 bars using linear slope
			const N = Math.min(14, candles.length);
			if (N < 5) return null;
			const pxA = Number(candles.at(-N)?.close ?? NaN), pxB = Number(candles.at(-1)?.close ?? NaN);
			const histSeries = Array.isArray(res?.data?.indicators?.series?.MACD_hist) ? res.data.indicators.series.MACD_hist : null;
			if (!Number.isFinite(pxA) || !Number.isFinite(pxB) || !histSeries || histSeries.length < N) return null;
			const hA = Number(histSeries.at(-N) ?? NaN), hB = Number(histSeries.at(-1) ?? NaN);
			if (!Number.isFinite(hA) || !Number.isFinite(hB)) return null;
			const pxSlopeUp = pxB > pxA, pxSlopeDn = pxB < pxA;
			const histSlopeUp = hB > hA, histSlopeDn = hB < hA;
			if (pxSlopeUp && histSlopeDn) return 'ベアリッシュ（価格↑・モメンタム↓）';
			if (pxSlopeDn && histSlopeUp) return 'ブルリッシュ（価格↓・モメンタム↑）';
			return 'なし';
		})();
		// SMA arrangement and deviations
		const curNum = Number(close ?? NaN);
		const s25n = Number(sma25 ?? NaN), s75n = Number(sma75 ?? NaN), s200n = Number(sma200 ?? NaN);
		const arrangement = (() => {
			const pts: Array<{ label: string; v: number }> = [];
			if (Number.isFinite(curNum)) pts.push({ label: '価格', v: curNum });
			if (Number.isFinite(s25n)) pts.push({ label: '25日', v: s25n });
			if (Number.isFinite(s75n)) pts.push({ label: '75日', v: s75n });
			if (Number.isFinite(s200n)) pts.push({ label: '200日', v: s200n });
			if (pts.length < 3) return 'n/a';
			pts.sort((a, b) => a.v - b.v);
			return pts.map(p => p.label).join(' < ');
		})();
		const devPct = (ma?: number | null) => {
			if (!Number.isFinite(curNum) || !Number.isFinite(Number(ma))) return null;
			return ((Number(ma) - curNum) / Math.abs(curNum)) * 100;
		};
		const s25Dev = devPct(sma25), s75Dev = devPct(sma75), s200Dev = devPct(sma200);
		const s25Slope = slopeOf('SMA_25', 5), s75Slope = slopeOf('SMA_75', 5), s200Slope = slopeOf('SMA_200', 7);
		// BB width trend and sigma history (last 5-7 bars)
		const bbSeries = {
			upper: Array.isArray(res?.data?.indicators?.series?.BB_upper) ? res.data.indicators.series.BB_upper
				: (Array.isArray(res?.data?.indicators?.series?.BB2_upper) ? res.data.indicators.series.BB2_upper : null),
			lower: Array.isArray(res?.data?.indicators?.series?.BB_lower) ? res.data.indicators.series.BB_lower
				: (Array.isArray(res?.data?.indicators?.series?.BB2_lower) ? res.data.indicators.series.BB2_lower : null),
			middle: Array.isArray(res?.data?.indicators?.series?.BB_middle) ? res.data.indicators.series.BB_middle
				: (Array.isArray(res?.data?.indicators?.series?.BB2_middle) ? res.data.indicators.series.BB2_middle : null),
		};
		const bwTrend = (() => {
			try {
				if (!bbSeries.upper || !bbSeries.lower || !bbSeries.middle) return null;
				const L = Math.min(bbSeries.upper.length, bbSeries.lower.length, bbSeries.middle.length);
				if (L < 6) return null;
				const cur = (bbSeries.upper.at(-1) - bbSeries.lower.at(-1)) / Math.max(1e-12, bbSeries.middle.at(-1));
				const prev5 = (bbSeries.upper.at(-6) - bbSeries.lower.at(-6)) / Math.max(1e-12, bbSeries.middle.at(-6));
				if (!Number.isFinite(cur) || !Number.isFinite(prev5)) return null;
				return cur > prev5 ? '拡大中' : (cur < prev5 ? '収縮中' : '不変');
			} catch { return null; }
		})();
		const sigmaHistory = (() => {
			try {
				if (!bbSeries.upper || !bbSeries.middle) return null;
				const L = Math.min(candles.length, bbSeries.upper.length, bbSeries.middle.length);
				if (L < 6) return null;
				const idxs = [-6, -1];
				const vals = idxs.map(off => {
					const c = Number(candles.at(off)?.close ?? NaN);
					const m = Number(bbSeries.middle.at(off) ?? NaN);
					const u = Number(bbSeries.upper.at(off) ?? NaN);
					if (![c, m, u].every(Number.isFinite)) return null;
					const z = Number((2 * (c - m) / Math.max(1e-12, u - m)).toFixed(2));
					return { off, z };
				});
				return vals;
			} catch { return null; }
		})();
		// Ichimoku extras: cloud thickness, chikou proxy, three signals, distance to cloud
		const cloudThickness = (cloudTop != null && cloudBot != null) ? (cloudTop - cloudBot) : null;
		const cloudThicknessPct = (cloudThickness != null && close != null && Number.isFinite(close)) ? (cloudThickness / Math.max(1e-12, Number(close))) * 100 : null;
		const chikouBull = (() => {
			if (candles.length < 27 || close == null) return null;
			const past = Number(candles.at(-27)?.close ?? NaN);
			if (!Number.isFinite(past)) return null;
			return Number(close) > past;
		})();
		const threeSignals = (() => {
			const aboveCloud = cloudPos === 'above_cloud';
			const convAboveBase = (tenkan != null && kijun != null) ? (Number(tenkan) >= Number(kijun)) : null;
			const chikouAbove = chikouBull;
			let judge: '三役好転' | '三役逆転' | '混在' = '混在';
			if (aboveCloud && convAboveBase === true && chikouAbove === true) judge = '三役好転';
			if (cloudPos === 'below_cloud' && convAboveBase === false && chikouAbove === false) judge = '三役逆転';
			return { judge, aboveCloud, convAboveBase, chikouAbove };
		})();
		const toCloudDistance = (() => {
			if (close == null || cloudTop == null || cloudBot == null) return null;
			if (cloudPos === 'below_cloud') {
				const need = cloudBot - Number(close);
				return need > 0 ? (need / Math.max(1e-12, Number(close))) * 100 : 0;
			}
			if (cloudPos === 'above_cloud') {
				const need = Number(close) - cloudTop;
				return need > 0 ? (need / Math.max(1e-12, Number(close))) * 100 : 0;
			}
			return 0;
		})();

		const lines: string[] = [];
		// Header with time and 24h change
		lines.push(`=== ${String(pair).toUpperCase()} ${String(type)} 分析 ===`);
		lines.push(`${nowJst} 現在`);
		const chgLine = deltaPrev ? `(${deltaLabel}: ${fmtPct(deltaPrev.pct, 1)})` : '';
		lines.push(deltaPrev ? `${fmtJPY(close)} ${chgLine}` : fmtJPY(close));
		lines.push('');
		// 総合判定（簡潔）
		lines.push('【総合判定】');
		const trendText = trend === 'strong_downtrend' ? '強い下降トレンド ⚠️' : (trend === 'uptrend' ? '上昇トレンド' : '中立/レンジ');
		const rsiHint = (rsi == null) ? '—' : (Number(rsi) < 30 ? '売られすぎ' : (Number(rsi) > 70 ? '買われすぎ' : '中立圏'));
		const bwState = bandWidthPct == null ? '—' : (bandWidthPct < 8 ? 'スクイーズ' : (bandWidthPct > 20 ? 'エクスパンション' : '標準'));
		lines.push(`  トレンド: ${trendText}`);
		lines.push(`  勢い: RSI=${rsi ?? 'n/a'} → ${rsiHint}`);
		lines.push(`  リスク: BB幅=${bandWidthPct != null ? bandWidthPct + '%' : 'n/a'} → ${bwState}${bwTrend ? `（${bwTrend}）` : ''}`);
		lines.push('');
		// Momentum
		lines.push('【モメンタム】');
		const rsiInterp = (val: number | null) => {
			if (val == null) return '—';
			if (val < 30) return '売られすぎ圏（反発の可能性）';
			if (val < 50) return '弱め（反発余地）';
			if (val < 70) return '中立〜強め';
			return '買われすぎ圏（反落の可能性）';
		};
		lines.push(`  RSI(14): ${rsi ?? 'n/a'} → ${rsiInterp(Number(rsi))}`);
		if (recentRsiFormatted.length >= 2) {
			lines.push(`    【RSI推移（直近${recentRsiFormatted.length}${rsiUnitLabel}）】`);
			lines.push('');
			lines.push(`    ${recentRsiFormatted.join(' → ')}`);
		}
		const macdHistFmt = macdHist == null ? 'n/a' : `${Math.round(Number(macdHist)).toLocaleString()}`;
		const macdHint = (macdHist == null) ? '—' : (Number(macdHist) >= 0 ? '強気継続（プラス＝上昇圧力）' : '弱気継続（マイナス＝下落圧力）');
		lines.push(`  MACD: hist=${macdHistFmt} → ${macdHint}`);
		const crossStr = lastMacdCross ? `${lastMacdCross.type === 'golden' ? 'ゴールデン' : 'デッド'}クロス: ${lastMacdCross.barsAgo}本前` : '直近クロス: なし';
		lines.push(`    ・${crossStr}`);
		lines.push(`    ・ダイバージェンス: ${divergence ?? 'なし'}`);
		lines.push('');
		// Trend (SMA)
		lines.push('【トレンド（移動平均線）】');
		lines.push(`  配置: ${arrangement}`);
		lines.push(`  SMA(25): ${fmtJPY(sma25)} (${vsCurPct(sma25)}) ${slopeSym(s25Slope)}`);
		lines.push(`  SMA(75): ${fmtJPY(sma75)} (${vsCurPct(sma75)}) ${slopeSym(s75Slope)}`);
		lines.push(`  SMA(200): ${fmtJPY(sma200)} (${vsCurPct(sma200)}) ${slopeSym(s200Slope)}`);
		// Simple cross info
		const crossInfo = (() => {
			const s25 = Array.isArray(res?.data?.indicators?.series?.SMA_25) ? res.data.indicators.series.SMA_25 : null;
			const s75 = Array.isArray(res?.data?.indicators?.series?.SMA_75) ? res.data.indicators.series.SMA_75 : null;
			if (!s25 || !s75) return null;
			const L = Math.min(s25.length, s75.length);
			let lastIdx: number | null = null; let t: 'golden' | 'dead' | null = null;
			for (let i = L - 2; i >= 0; i--) {
				const d0 = Number(s25[i]) - Number(s75[i]);
				const d1 = Number(s25[i + 1]) - Number(s75[i + 1]);
				if (![d0, d1].every(Number.isFinite)) continue;
				if ((d0 < 0 && d1 > 0) || (d0 > 0 && d1 < 0)) { lastIdx = i + 1; t = d1 > 0 ? 'golden' : 'dead'; break; }
			}
			if (lastIdx == null) return '直近クロス: なし';
			return `直近クロス: ${t === 'golden' ? 'ゴールデン' : 'デッド'}（${(L - 1 - lastIdx)}本前）`;
		})();
		if (crossInfo) lines.push(`  ${crossInfo}`);
		lines.push('');
		// Volatility (BB)
		lines.push('【ボラティリティ（ボリンジャーバンド±2σ）】');
		lines.push(`  現在位置: ${sigmaZ != null ? `${sigmaZ}σ` : 'n/a'} → ${sigmaZ != null ? (sigmaZ <= -1 ? '売られすぎ' : (sigmaZ >= 1 ? '買われすぎ' : '中立')) : '—'}`);
		lines.push(`  middle: ${fmtJPY(bbMid)} (${vsCurPct(bbMid)})`);
		lines.push(`  upper:  ${fmtJPY(bbUp)} (${vsCurPct(bbUp)})`);
		lines.push(`  lower:  ${fmtJPY(bbLo)} (${vsCurPct(bbLo)})${(bbLo != null && close != null && Number(bbLo) < Number(close)) ? '' : ' ← 現在価格に近い'}`);
		if (bandWidthPct != null) lines.push(`  バンド幅: ${bandWidthPct}% → ${bwTrend ?? '—'}`);
		if (sigmaHistory && sigmaHistory[0] && sigmaHistory[1]) {
			const ago5 = sigmaHistory[0]?.z; const curZ = sigmaHistory[1]?.z;
			lines.push('  過去推移:');
			if (ago5 != null) lines.push(`    ・5日前: ${ago5}σ`);
			if (curZ != null) lines.push(`    ・現在: ${curZ}σ`);
		}
		lines.push('');
		// Ichimoku
		lines.push('【一目均衡表】');
		lines.push(`  現在位置: ${cloudPos === 'below_cloud' ? '雲の下 → 弱気' : (cloudPos === 'above_cloud' ? '雲の上 → 強気' : '雲の中 → 中立')}`);
		lines.push(`  転換線: ${fmtJPY(tenkan)} (${vsCurPct(tenkan)}) ${slopeSym(slopeOf('ICHIMOKU_conversion', 5))}`);
		lines.push(`  基準線: ${fmtJPY(kijun)} (${vsCurPct(kijun)}) ${slopeSym(slopeOf('ICHIMOKU_base', 5))}`);
		lines.push(`  先行スパンA: ${fmtJPY(spanA)} (${vsCurPct(spanA)})`);
		lines.push(`  先行スパンB: ${fmtJPY(spanB)} (${vsCurPct(spanB)})`);
		if (cloudThickness != null) lines.push(`  雲の厚さ: ${Math.round(cloudThickness).toLocaleString()}円（${cloudThicknessPct != null ? `${cloudThicknessPct.toFixed(1)}%` : 'n/a'}）`);
		if (chikouBull != null) lines.push(`  遅行スパン: ${chikouBull ? '価格より上 → 強気' : '価格より下 → 弱気'}`);
		if (threeSignals) lines.push(`  三役判定: ${threeSignals.judge}`);
		if (toCloudDistance != null && cloudPos === 'below_cloud') lines.push(`  雲突入まで: ${toCloudDistance.toFixed(1)}%`);
		lines.push('');
		lines.push('【次に確認すべきこと】');
		lines.push('  ・より詳しく: analyze_bb_snapshot / analyze_ichimoku_snapshot / analyze_sma_snapshot');
		lines.push('  ・転換サイン例: RSI>40, MACDヒストグラムのプラ転, 25日線の明確な上抜け');
		lines.push('');
		lines.push('詳細は structuredContent.data.indicators / chart を参照。');
		const text = lines.join('\n');
		return { content: [{ type: 'text', text }], structuredContent: res as Record<string, unknown> };
	}
);

// get_depth removed — consolidated into get_orderbook (mode=raw)
// render_chart_html は当面サポート外のため未登録

registerToolWithLog(
	'get_transactions',
	{ description: '約定履歴を取得（/transactions）。直近60件 or 日付指定。view=summary|items。minAmount/minPrice等でフィルタ可。', inputSchema: GetTransactionsInputSchema },
	async ({ pair, limit, date, minAmount, maxAmount, minPrice, maxPrice, view }: any) => {
		const res: any = await getTransactions(pair, limit, date);
		if (!res?.ok) return res;
		// filter on normalized
		const hasFilter = minAmount != null || maxAmount != null || minPrice != null || maxPrice != null;
		const items = (res?.data?.normalized ?? []).filter((t: any) => (
			(minAmount == null || t.amount >= minAmount) &&
			(maxAmount == null || t.amount <= maxAmount) &&
			(minPrice == null || t.price >= minPrice) &&
			(maxPrice == null || t.price <= maxPrice)
		));
		// フィルタ適用時のみサマリを再計算（フィルタなしの場合はget_transactionsのsummaryをそのまま使用）
		const summary = hasFilter
			? `${String(pair).toUpperCase().replace('_', '/')} フィルタ後 ${items.length}件 (buy=${items.filter((t: any) => t.side === 'buy').length} sell=${items.filter((t: any) => t.side === 'sell').length})`
			: res.summary;
		if (view === 'items') {
			const text = JSON.stringify(items, null, 2);
			return { content: [{ type: 'text', text }], structuredContent: { ...res, summary, data: { ...res.data, normalized: items } } as Record<string, unknown> };
		}
		return { ...res, summary, data: { ...res.data, normalized: items } };
	}
);

registerToolWithLog(
	'get_flow_metrics',
	{ description: '/transactions をベースにフロー分析。CVD・アグレッサー比・スパイク検出。bucketMs で時間バケット指定。view=summary|buckets|full。', inputSchema: (await import('./schemas.js')).GetFlowMetricsInputSchema as any },
	async ({ pair, limit, date, bucketMs, view, bucketsN, tz }: any) => {
		const res: any = await getFlowMetrics(pair, Number(limit), date, Number(bucketMs), tz);
		if (!res?.ok) return res;
		if (view === 'summary') return res;
		const agg = res?.data?.aggregates ?? {};
		const buckets: any[] = res?.data?.series?.buckets ?? [];
		const n = Number(bucketsN ?? 10);
		const last = buckets.slice(-n);
		const fmt = (b: any) => `${b.displayTime || b.isoTime}  buy=${b.buyVolume} sell=${b.sellVolume} total=${b.totalVolume} cvd=${b.cvd}${b.spike ? ` spike=${b.spike}` : ''}`;
		let text = `${String(pair).toUpperCase()} Flow Metrics (bucketMs=${res?.data?.params?.bucketMs ?? bucketMs})\n`;
		text += `Totals: trades=${agg.totalTrades} buyVol=${agg.buyVolume} sellVol=${agg.sellVolume} net=${agg.netVolume} buy%=${(agg.aggressorRatio * 100 || 0).toFixed(1)} CVD=${agg.finalCvd}`;
		if (view === 'buckets') {
			text += `\n\nRecent ${last.length} buckets:\n` + last.map(fmt).join('\n');
			return { content: [{ type: 'text', text }], structuredContent: res as Record<string, unknown> };
		}
		// full
		text += `\n\nAll buckets:\n` + buckets.map(fmt).join('\n');
		return { content: [{ type: 'text', text }], structuredContent: res as Record<string, unknown> };
	}
);
// get_depth_diff / get_orderbook_pressure / get_orderbook_statistics removed
// — consolidated into get_orderbook (mode=summary/pressure/statistics/raw)

registerToolWithLog(
	'get_volatility_metrics',
	{ description: '/candlestick をベースにボラティリティを算出。RV/ATR/Parkinson/GK/RS。view=summary|detailed|full。', inputSchema: GetVolMetricsInputSchema },
	async ({ pair, type, limit, windows, useLogReturns, annualize, view }: any) => {
		const res: any = await getVolatilityMetrics(pair, type, limit, windows, { useLogReturns, annualize });
		if (!res?.ok) return res;
		const meta = res?.data?.meta || {};
		const a = res?.data?.aggregates || {};
		const roll: any[] = Array.isArray(res?.data?.rolling) ? res.data.rolling : [];
		const closeSeries: number[] = Array.isArray(res?.data?.series?.close) ? res.data.series.close : [];
		const lastClose = closeSeries.at(-1) ?? null;
		const ann = !!meta.annualize;
		const baseMs = Number(meta.baseIntervalMs ?? 0);
		const annFactor = ann && baseMs > 0 ? Math.sqrt(365 * 24 * 3600 * 1000 / baseMs) : 1;
		const rvAnn = a.rv_std_ann != null ? a.rv_std_ann : (a.rv_std != null ? a.rv_std * annFactor : null);
		const pkAnn = a.parkinson != null ? a.parkinson * (ann ? annFactor : 1) : null;
		const gkAnn = a.garmanKlass != null ? a.garmanKlass * (ann ? annFactor : 1) : null;
		const rsAnn = a.rogersSatchell != null ? a.rogersSatchell * (ann ? annFactor : 1) : null;
		const atrAbs = a.atr != null ? a.atr : null;
		const atrPct = lastClose ? (atrAbs as number) / lastClose : null;

		// tags: base + derived
		const tagsBase: string[] = Array.isArray(res?.data?.tags) ? [...res.data.tags] : [];
		const tagsDerived: string[] = [];
		if (Array.isArray(roll) && roll.length >= 2) {
			const minW = Math.min(...roll.map(r => r.window));
			const maxW = Math.max(...roll.map(r => r.window));
			const short = roll.find(r => r.window === minW);
			const long = roll.find(r => r.window === maxW);
			const shortVal = short ? (short.rv_std_ann ?? (short.rv_std != null ? short.rv_std * annFactor : null)) : null;
			const longVal = long ? (long.rv_std_ann ?? (long.rv_std != null ? long.rv_std * annFactor : null)) : null;
			if (shortVal != null && longVal != null) {
				if (shortVal > longVal * 1.05) tagsDerived.push('expanding_vol');
				else if (shortVal < longVal * 0.95) tagsDerived.push('contracting_vol');
				if (shortVal > 0.4) tagsDerived.push('high_short_term_vol');
			}
		}
		if (rvAnn != null) {
			if (rvAnn > 0.5) tagsDerived.push('high_vol');
			if (rvAnn < 0.2) tagsDerived.push('low_vol');
		}
		if (rvAnn != null && atrPct != null && rvAnn > 0) {
			const diff = Math.abs(atrPct - rvAnn) / rvAnn;
			if (diff > 0.2) tagsDerived.push('atr_divergence');
		}
		const tagsAll = [...new Set([...(tagsBase || []), ...tagsDerived])];

		// beginner view (plain language for non-experts)
		if (view === 'beginner') {
			const rvPct = formatPercent(rvAnn, { multiply: true, digits: 0 });
			const atrJpy = formatPriceJPY(atrAbs);
			const atrPctStr = formatPercent(atrPct, { multiply: true });
			const closeStr = formatPriceJPY(lastClose);
			const lines = [
				`${String(pair).toUpperCase()} [${String(type)}] 現在価格: ${closeStr}`,
				`・年間のおおよその動き: 約${rvPct}（1年でこのくらい上下しやすい目安）`,
				`・1日の平均的な動き: 約${atrJpy}（約${atrPctStr}）`,
				tagsAll.length ? `・今の傾向: ${tagsAll.map(t => t.replaceAll('_', ' ')).join(', ')}` : null,
			].filter(Boolean).join('\n');
			return { content: [{ type: 'text', text: lines }], structuredContent: { ...res, data: { ...res.data, tags: tagsAll } } as Record<string, unknown> };
		}

		// summary view
		if (view === 'summary') {
			const line = `${String(pair).toUpperCase()} [${String(type)}] samples=${meta.sampleSize ?? 'n/a'} RV=${fmtPct(rvAnn)} ATR=${fmtCurrencyShort(pair, atrAbs)} PK=${fmtPct(pkAnn)} GK=${fmtPct(gkAnn)} RS=${fmtPct(rsAnn)} Tags: ${tagsAll.join(', ')}`;
			return { content: [{ type: 'text', text: line }], structuredContent: { ...res, data: { ...res.data, tags: tagsAll } } as Record<string, unknown> };
		}

		// detailed/full
		const windowsList = roll.map(r => r.window).join('/');
		const header = `${String(pair).toUpperCase()} [${String(type)}] close=${lastClose != null ? Number(lastClose).toLocaleString() : 'n/a'}\n`;
		const block1 = `【Volatility Metrics${ann ? ' (annualized)' : ''}, ${meta.sampleSize ?? 'n/a'} samples】\nRV (std): ${fmtPct(rvAnn)}\nATR: ${fmtCurrency(pair, atrAbs)}\nParkinson: ${fmtPct(pkAnn)}\nGarman-Klass: ${fmtPct(gkAnn)}\nRogers-Satchell: ${fmtPct(rsAnn)}`;

		const maxW = roll.length ? Math.max(...roll.map(r => r.window)) : null;
		const baseVal = maxW != null ? (roll.find(r => r.window === maxW)?.rv_std_ann ?? ((roll.find(r => r.window === maxW)?.rv_std ?? null) as number) * (ann ? annFactor : 1)) : null;
		const arrowFor = (val: number | null | undefined) => {
			if (val == null || baseVal == null) return '→';
			if (val > baseVal * 1.05) return '⬆⬆';
			if (val > baseVal) return '⬆';
			if (val < baseVal * 0.95) return '⬇⬇';
			if (val < baseVal) return '⬇';
			return '→';
		};
		const trendLines = roll.map(r => {
			const now = r.rv_std_ann ?? (r.rv_std != null ? r.rv_std * (ann ? annFactor : 1) : null);
			return `${r.window}-day RV: ${fmtPct(now)} ${arrowFor(now)}`;
		});

		let text = header + '\n' + block1 + '\n\n' + `【Rolling Trends (${windowsList}-day windows)】\n` + trendLines.join('\n') + '\n\n' + `【Assessment】\nTags: ${tagsAll.join(', ')}`;
		if (view === 'full') {
			const series = res?.data?.series || {};
			const tsArr: number[] = Array.isArray(series.ts) ? series.ts : [];
			const firstIso = tsArr.length ? new Date(tsArr[0]).toISOString() : 'n/a';
			const lastIso = tsArr.length ? new Date(tsArr[tsArr.length - 1]).toISOString() : 'n/a';
			const cArr: number[] = Array.isArray(series.close) ? series.close : [];
			const minClose = cArr.length ? Math.min(...cArr) : null;
			const maxClose = cArr.length ? Math.max(...cArr) : null;
			const retArr: number[] = Array.isArray(series.ret) ? series.ret : [];
			const mean = retArr.length ? (retArr.reduce((s, v) => s + v, 0) / retArr.length) : null;
			const std = retArr.length ? stddev(retArr) : null;
			text += `\n\n【Series】\nTotal: ${meta.sampleSize ?? cArr.length} candles\nFirst: ${firstIso} , Last: ${lastIso}\nClose range: ${minClose != null ? Number(minClose).toLocaleString() : 'n/a'} - ${maxClose != null ? Number(maxClose).toLocaleString() : 'n/a'} JPY\nReturns: mean=${formatPercent(mean, { multiply: true, digits: 2 })}, std=${formatPercent(std, { multiply: true, digits: 2 })}${ann ? ' (base interval)' : ''}`;
		}
		return { content: [{ type: 'text', text }], structuredContent: { ...res, data: { ...res.data, tags: tagsAll } } as Record<string, unknown> };

		function fmtPct(x: any) { return formatPercent(x, { multiply: true }); }
		function fmtCurrency(p: any, v: any) { return formatCurrency(v, p); }
		function fmtCurrencyShort(p: any, v: any) { return formatCurrencyShort(v, p); }
	}
);

registerToolWithLog(
	'render_chart_svg',
	{ description: 'ローソク足/ライン/板チャートをSVG形式で生成します。\n\n【重要な使用タイミング（厳守）】\n- ユーザーが「描画/可視化/チャートで見たい」等と明示したときのみ使用\n- detect_patterns 等の結果を「図で確認したい」とユーザーが要望したとき\n\n【使用してはいけない場合】\n- 数値だけで足りる問い合わせ（分析/要約のみ）\n- ユーザーが視覚化を求めていないとき（自発的に使わない）\n\n【返却形式】\n- data.svg: 完全なSVG文字列\n- data.filePath: ファイル保存時のパス\n- data.legend: 描画したレイヤの凡例\n- meta.range: { start, end }（ISO8601）\n- meta.indicators: 表示中のインジケータ一覧\n\n【チャート表示方法（重要）】\nClaude.aiでチャートを表示するには、HTMLファイルにSVGを埋め込んで提示してください。\nSVGファイルを直接 present_files で提示しても、ダウンロードリンクになるだけで画像として表示されません。\n\n手順:\n1. render_chart_svg を呼び出し、data.svg を取得\n2. create_file でHTMLファイル（SVG埋め込み）を /mnt/user-data/outputs/ に保存\n3. present_files でHTMLファイルを提示\n\n※ SVGファイル単体の present_files は非推奨（表示されない）\n\n【他ツールとの連携】\n1) detect_patterns を実行\n2) 返却された data.overlays を取得\n3) render_chart_svg({ overlays: data.overlays }) に渡して描画\n\n【軽量化オプション】\n- svgPrecision, svgMinify, simplifyTolerance, viewBoxTight\n- maxSvgBytes: 超過時は data.filePath、preferFile=true: 常に保存のみ', inputSchema: RenderChartSvgInputSchema },
	async (args: any) => {
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
					'',
					'【次のステップ】Claude.aiでチャートを表示するには、このSVGをHTMLに埋め込んで create_file → present_files してください。',
					'※ SVGファイル単体の present_files は画像として表示されません。'
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
			const txt = String((parsed as any)?.summary || '');
			return { content: [{ type: 'text', text: txt }], structuredContent: parsed as any };
		} catch {
			return { content: [{ type: 'text', text: String((parsed as any)?.summary || 'chart rendered') }], structuredContent: parsed as any };
		}
	}
);

// Lightweight, dedicated depth renderer (bypasses indicators), returns proper meta.pair/type
registerToolWithLog(
	'render_depth_svg',
	{
		description: '板の深さ(Depth)チャートをSVGで生成します。軽量・専用実装で meta.pair/type を常に含みます。\n\n【返却形式】\n- data.svg: 完全なSVG文字列\n- data.filePath: ファイル保存時のパス\n- meta.pair/type: 銘柄と時間軸\n\n【チャート表示方法（重要）】\nClaude.aiでチャートを表示するには、HTMLファイルにSVGを埋め込んで提示してください。\nSVGファイルを直接 present_files で提示しても、ダウンロードリンクになるだけで画像として表示されません。\n\n手順:\n1. render_depth_svg を呼び出し、data.svg を取得\n2. create_file でHTMLファイル（SVG埋め込み）を /mnt/user-data/outputs/ に保存\n3. present_files でHTMLファイルを提示\n\n※ autoSave のデフォルト保存先（/assets）はClaude.ai環境では書き込み不可。HTMLファイル埋め込み方式を推奨。\n※ SVGファイル単体の present_files は非推奨（表示されない）\n\n使い方:\nrender_depth_svg({ pair: \"btc_jpy\", type: \"1day\", depth: { levels: 200 } })', inputSchema: (await import('zod')).z.object({
			pair: (await import('zod')).z.string().default('btc_jpy'),
			type: (await import('zod')).z.string().default('1day'),
			depth: (await import('zod')).z.object({ levels: (await import('zod')).z.number().int().min(10).max(1000).optional().default(200) }).optional().default({ levels: 200 }),
			preferFile: (await import('zod')).z.boolean().optional(),
			autoSave: (await import('zod')).z.boolean().optional(),
		}) as any
	},
	async ({ pair, type, depth, preferFile, autoSave }: any) => {
		const res: any = await renderDepthSvg({ pair, type, depth, preferFile, autoSave });
		if (!res?.ok) return res;
		const data: any = (res as any).data || {};
		const meta: any = (res as any).meta || {};
		const header = `${String(pair).toUpperCase()} Depth chart`;
		if (data?.filePath) {
			const text = `${header}\nSaved: computer://${data.filePath}`;
			return { content: [{ type: 'text', text }], structuredContent: res as any };
		}
		if (data?.svg) {
			const text = [
				header,
				'',
				'--- Depth SVG ---',
				`identifier: depth-${String(pair)}-${Date.now()}`,
				`title: Depth ${String(pair).toUpperCase()}`,
				'type: image/svg+xml',
				'',
				String(data.svg),
			].join('\n');
			return { content: [{ type: 'text', text }], structuredContent: res as any };
		}
		return { content: [{ type: 'text', text: header }], structuredContent: res as any };
	}
);

registerToolWithLog(
	'detect_patterns',
	{ description: '古典的チャートパターン（ダブルトップ/ヘッドアンドショルダーズ/三角持ち合い/ウェッジ等）を統合検出します。\n\n🆕 統合版: 形成中（forming）と完成済み（completed）の両方を1回で取得可能。\n\n【オプション】\n- includeForming: true → 形成中パターンを含める（status=forming/near_completion）\n- includeCompleted: true → 完成済みパターンを含める（status=completed）\n- requireCurrentInPattern + currentRelevanceDays: 鮮度フィルタ（N日以内のみ）\n\n【パターン別推奨パラメータ】\n- pennant/flag: swingDepth≈5, minBarsBetweenSwings≈3（短期の旗型パターン向け）\n- triangle/wedge: swingDepth≈10, tolerancePct≈0.03（中期の収束パターン向け）\n- double_top/double_bottom: tolerancePct≈0.02（価格水準の一致精度重視）\n\n【出力】\n- content: 検出名・パターン整合度・期間・ステータス\n- ウェッジ: breakoutDirection（up/down）とoutcome（success/failure）を含む\n- 視覚確認: structuredContent.data.overlays を render_chart_svg.overlays に渡す\n\nview=summary|detailed|full（既定=detailed）。', inputSchema: DetectPatternsInputSchema },
	async ({ pair, type, limit, patterns, swingDepth, tolerancePct, minBarsBetweenSwings, view, requireCurrentInPattern, currentRelevanceDays }: any) => {
		const out = await detectPatterns(pair, type, limit, { patterns, swingDepth, tolerancePct, minBarsBetweenSwings, requireCurrentInPattern, currentRelevanceDays });
		const res = DetectPatternsOutputSchema.parse(out as any);
		if (!res?.ok) return res as any;
		const pats: any[] = Array.isArray((res as any)?.data?.patterns) ? (res as any).data.patterns : [];
		const meta: any = (res as any)?.meta || {};
		const count = Number(meta?.count ?? pats.length ?? 0);
		const hdr = `${String(pair).toUpperCase()} [${String(type)}] ${limit ?? count}本から${pats.length}件を検出`;
		// Debug view: list swings and candidates with reasons
		if (view === 'debug') {
			const swings = Array.isArray(meta?.debug?.swings) ? meta.debug.swings : [];
			const cands = Array.isArray(meta?.debug?.candidates) ? meta.debug.candidates : [];
			const swingLines = swings.map((s: any) => `- ${s.kind} idx=${s.idx} price=${Math.round(Number(s.price)).toLocaleString()} (${s.isoTime || 'n/a'})`);
			const candLines = cands.map((c: any, i: number) => {
				const tag = c.accepted ? '✅' : '❌';
				const reason = c.accepted ? (c.reason ? ` (${c.reason})` : '') : (c.reason ? ` [${c.reason}]` : '');
				const pts = Array.isArray(c.points) ? c.points.map((p: any) => `${p.role}@${p.idx}:${Math.round(Number(p.price)).toLocaleString()}`).join(', ') : '';
				const indices = Array.isArray(c.indices) ? ` indices=[${c.indices.join(',')}]` : '';
				// details を必ず表示（spread と slopes）
				let detailsStr = '\n   details: none';
				if (c.details) {
					const d = c.details || {};
					const s1 = Number(d.spreadStart);
					const s2 = Number(d.spreadEnd);
					const hi = Number(d.hiSlope);
					const lo = Number(d.loSlope);
					const spreadPart = (Number.isFinite(s1) && Number.isFinite(s2))
						? `${Math.round(s1).toLocaleString()} → ${Math.round(s2).toLocaleString()}`
						: 'n/a';
					const hiPart = Number.isFinite(hi) ? hi.toFixed(8) : 'n/a';
					const loPart = Number.isFinite(lo) ? lo.toFixed(8) : 'n/a';
					// 専用: type_classification_failed の内訳を本文に表示
					if (String(c?.reason) === 'type_classification_failed') {
						const fh = Number(d?.slopeHigh);
						const fl = Number(d?.slopeLow);
						const fr = String(d?.failureReason || '');
						const ratio = Number(d?.slopeRatio);
						const fhStr = Number.isFinite(fh) ? fh.toFixed(8) : 'n/a';
						const flStr = Number.isFinite(fl) ? fl.toFixed(8) : 'n/a';
						const ratioStr = Number.isFinite(ratio) ? ratio.toFixed(3) : 'n/a';
						detailsStr =
							`\n   failureReason: ${fr || 'n/a'}` +
							`\n   slopes: hi=${fhStr} lo=${flStr}` +
							`\n   slopeRatio: ${ratioStr}`;
					} else if (String(c?.reason) === 'probe_window') {
						const fh = Number(d?.slopeHigh);
						const fl = Number(d?.slopeLow);
						const pr = Number(d?.priceRange);
						const bs = Number(d?.barsSpan);
						const ms = Number(d?.minMeaningfulSlope);
						const fhStr = Number.isFinite(fh) ? fh.toFixed(8) : 'n/a';
						const flStr = Number.isFinite(fl) ? fl.toFixed(8) : 'n/a';
						const prStr = Number.isFinite(pr) ? Math.round(pr).toLocaleString() : 'n/a';
						const bsStr = Number.isFinite(bs) ? String(bs) : 'n/a';
						const msStr = Number.isFinite(ms) ? ms.toFixed(8) : 'n/a';
						const highsIn = Array.isArray(d?.highsIn) ? d.highsIn.map((p: any) => `[${p.index}:${Math.round(Number(p.price)).toLocaleString()}]`).join(', ') : 'n/a';
						const lowsIn = Array.isArray(d?.lowsIn) ? d.lowsIn.map((p: any) => `[${p.index}:${Math.round(Number(p.price)).toLocaleString()}]`).join(', ') : 'n/a';
						detailsStr =
							`\n   upper.slope: ${fhStr}` +
							`\n   lower.slope: ${flStr}` +
							`\n   priceRange: ${prStr}` +
							`\n   barsSpan: ${bsStr}` +
							`\n   minMeaningfulSlope: ${msStr}` +
							`\n   highsIn: ${highsIn}` +
							`\n   lowsIn: ${lowsIn}`;
					} else if (String(c?.reason) === 'declining_highs' || String(c?.reason) === 'declining_highs_probe') {
						const fa = Number(d?.firstAvg);
						const sa = Number(d?.secondAvg);
						const ratio = Number(d?.ratio);
						const faStr = Number.isFinite(fa) ? Math.round(fa).toLocaleString() : 'n/a';
						const saStr = Number.isFinite(sa) ? Math.round(sa).toLocaleString() : 'n/a';
						const ratioStr = Number.isFinite(ratio) ? (ratio * 100).toFixed(1) + '%' : 'n/a';
						const cnt = Number(d?.highsCount);
						const cntStr = Number.isFinite(cnt) ? String(cnt) : 'n/a';
						detailsStr =
							`\n   ${String(c?.reason) === 'declining_highs' ? 'declining_highs: true' : 'declining_highs_probe: metrics'}` +
							`\n   highsIn.count: ${cntStr}` +
							`\n   1st half avg: ${faStr}` +
							`\n   2nd half avg: ${saStr}` +
							`\n   ratio: ${ratioStr}`;
					} else if (String(c?.reason) === 'rising_probe') {
						const r2h = Number(d?.r2High), r2l = Number(d?.r2Low);
						const sh = Number(d?.slopeHigh), sl = Number(d?.slopeLow);
						const sratio = Number(d?.slopeRatioLH);
						const pr = Number(d?.priceRange), bs = Number(d?.barsSpan), ms = Number(d?.minMeaningfulSlope);
						const fa = Number(d?.firstAvg), sa = Number(d?.secondAvg), dr = Number(d?.ratio);
						const highsIn = Array.isArray(d?.highsIn) ? d.highsIn.map((p: any) => `[${p.index}:${Math.round(Number(p.price)).toLocaleString()}]`).join(', ') : 'n/a';
						const lowsIn = Array.isArray(d?.lowsIn) ? d.lowsIn.map((p: any) => `[${p.index}:${Math.round(Number(p.price)).toLocaleString()}]`).join(', ') : 'n/a';
						detailsStr =
							`\n   r2: hi=${Number.isFinite(r2h) ? r2h.toFixed(3) : 'n/a'}, lo=${Number.isFinite(r2l) ? r2l.toFixed(3) : 'n/a'}` +
							`\n   slopes: hi=${Number.isFinite(sh) ? sh.toFixed(6) : 'n/a'} lo=${Number.isFinite(sl) ? sl.toFixed(6) : 'n/a'}` +
							`\n   slopeRatioLH: ${Number.isFinite(sratio) ? sratio.toFixed(3) : 'n/a'}` +
							`\n   priceRange: ${Number.isFinite(pr) ? Math.round(pr).toLocaleString() : 'n/a'}, barsSpan: ${Number.isFinite(bs) ? String(bs) : 'n/a'}` +
							`\n   minMeaningfulSlope: ${Number.isFinite(ms) ? ms.toFixed(6) : 'n/a'}` +
							`\n   highsIn: ${highsIn}` +
							`\n   lowsIn: ${lowsIn}` +
							`\n   declining_highs metrics: firstAvg=${Number.isFinite(fa) ? Math.round(fa).toLocaleString() : 'n/a'}, secondAvg=${Number.isFinite(sa) ? Math.round(sa).toLocaleString() : 'n/a'}, ratio=${Number.isFinite(dr) ? (dr * 100).toFixed(1) + '%' : 'n/a'}`;
					} else if (String(c?.reason) === 'post_filter_rising_highs_not_declining') {
						const fa = Number(d?.firstAvg);
						const sa = Number(d?.secondAvg);
						const ratio = Number(d?.ratio);
						const faStr = Number.isFinite(fa) ? Math.round(fa).toLocaleString() : 'n/a';
						const saStr = Number.isFinite(sa) ? Math.round(sa).toLocaleString() : 'n/a';
						const ratioStr = Number.isFinite(ratio) ? (ratio * 100).toFixed(1) + '%' : 'n/a';
						const cnt = Number(d?.highsCount);
						const cntStr = Number.isFinite(cnt) ? String(cnt) : 'n/a';
						detailsStr =
							`\n   post_filter: rising highs not declining` +
							`\n   highsIn.count: ${cntStr}` +
							`\n   1st half avg: ${faStr}` +
							`\n   2nd half avg: ${saStr}` +
							`\n   ratio: ${ratioStr}`;
					} else if (String(c?.reason) === 'post_filter_falling_lows_not_rising') {
						const fa = Number(d?.firstAvg);
						const sa = Number(d?.secondAvg);
						const ratio = Number(d?.ratio);
						const faStr = Number.isFinite(fa) ? Math.round(fa).toLocaleString() : 'n/a';
						const saStr = Number.isFinite(sa) ? Math.round(sa).toLocaleString() : 'n/a';
						const ratioStr = Number.isFinite(ratio) ? (ratio * 100).toFixed(1) + '%' : 'n/a';
						const cnt = Number(d?.lowsCount);
						const cntStr = Number.isFinite(cnt) ? String(cnt) : 'n/a';
						detailsStr =
							`\n   post_filter: falling lows not rising` +
							`\n   lowsIn.count: ${cntStr}` +
							`\n   1st half avg: ${faStr}` +
							`\n   2nd half avg: ${saStr}` +
							`\n   ratio: ${ratioStr}`;
					} else {
						detailsStr = `\n   spread: ${spreadPart}${(Number.isFinite(hi) || Number.isFinite(lo)) ? `, slopes: hi=${hiPart} lo=${loPart}` : ''}`;
					}
				}
				return `${i + 1}. ${tag} ${c.type}${reason}${indices}${pts ? `\n   ${pts}` : ''}${detailsStr}`;
			});
			const text = [
				hdr,
				'',
				'【Swings】',
				swingLines.length ? swingLines.join('\n') : 'なし',
				'',
				'【Candidates】',
				candLines.length ? candLines.join('\n') : 'なし',
			].join('\n');
			// structuredContent に candidates を含める
			try {
				const result: any = res as any;
				return {
					content: [{ type: 'text', text }],
					structuredContent: {
						data: {
							patterns: (result?.data?.patterns ?? []),
							overlays: (result?.data?.overlays ?? null),
							candidates: cands,
						},
						meta: result?.meta ?? {},
						ok: result?.ok ?? true,
						summary: result?.summary ?? hdr,
					} as Record<string, unknown>,
				};
			} catch {
				return { content: [{ type: 'text', text }], structuredContent: res as any };
			}
		}
		// detection period (if candles range available in meta or infer from patterns)
		try {
			const toTs = (s?: string) => { try { return s ? Date.parse(s) : NaN; } catch { return NaN; } };
			const ends = pats.map(p => toTs(p?.range?.end)).filter((x: number) => Number.isFinite(x));
			const starts = pats.map(p => toTs(p?.range?.start)).filter((x: number) => Number.isFinite(x));
			if (starts.length && ends.length) {
				const startIso = new Date(Math.min(...starts)).toISOString().slice(0, 10);
				const endIso = new Date(Math.max(...ends)).toISOString().slice(0, 10);
				const days = Math.max(1, Math.round((Math.max(...ends) - Math.min(...starts)) / 86400000));
				// prepend detection window line in summary/detailed
				if (view === 'summary') {
					// nothing extra here; appended below
				}
			}
		} catch { }
		// 種別別件数集計
		const byType = pats.reduce((m: Record<string, number>, p: any) => { const k = String(p?.type || 'unknown'); m[k] = (m[k] || 0) + 1; return m; }, {} as Record<string, number>);
		const typeSummary = Object.entries(byType).map(([k, v]) => `${k}×${v}`).join(', ');
		const fmtLine = (p: any, idx: number) => {
			const name = String(p?.type || 'unknown');
			const conf = p?.confidence != null ? Number(p.confidence).toFixed(2) : 'n/a';
			const range = p?.range ? `${p.range.start} ~ ${p.range.end}` : 'n/a';
			let priceRange: string | null = null;
			if (Array.isArray(p?.pivots) && p.pivots.length) {
				const prices = p.pivots.map((v: any) => Number(v?.price)).filter((x: any) => Number.isFinite(x));
				if (prices.length) priceRange = `${Math.min(...prices).toLocaleString()}円 - ${Math.max(...prices).toLocaleString()}円`;
			}
			let neckline: string | null = null;
			if (Array.isArray(p?.neckline) && p.neckline.length === 2) {
				const [a, b] = p.neckline;
				const y1 = Number(a?.y);
				const y2 = Number(b?.y);
				if (Number.isFinite(y1) && Number.isFinite(y2)) {
					neckline = (y1 === y2)
						? `${y1.toLocaleString()}円（水平）`
						: `${y1.toLocaleString()}円 → ${y2.toLocaleString()}円`;
				}
			}
			// map idx -> isoTime using debug swings if available
			const idxToIso: Record<number, string> = {};
			try {
				const swings = (meta as any)?.debug?.swings;
				if (Array.isArray(swings)) {
					for (const s of swings) {
						const i = Number((s as any)?.idx);
						const t = String((s as any)?.isoTime || '');
						if (Number.isFinite(i) && t) idxToIso[i] = t;
					}
				}
			} catch { /* noop */ }
			// pivot detail lines (only for full/debug and double_top/double_bottom)
			const pivotLines: Array<string | null> = [];
			if ((view === 'full' || view === 'debug') && Array.isArray(p?.pivots) && p.pivots.length >= 3) {
				const pivs = p.pivots as Array<{ idx: number; price: number }>;
				const roleLabels =
					p.type === 'double_top'
						? ['山1', '谷', '山2']
						: (p.type === 'double_bottom' ? ['谷1', '山', '谷2'] : null);
				if (roleLabels) {
					for (let i = 0; i < 3; i++) {
						const pv = pivs[i];
						if (!pv) continue;
						const d = idxToIso[Number(pv.idx)] || '';
						const date = d ? d.slice(0, 10) : 'n/a';
						pivotLines.push(`   - ${roleLabels[i]}: ${date} (${Math.round(Number(pv.price)).toLocaleString()}円)`);
					}
				}
			}
			// breakout detail if present
			let breakoutLine: string | null = null;
			try {
				if ((view === 'full' || view === 'debug') && p?.breakout?.idx != null) {
					const bidx = Number(p.breakout.idx);
					const bpx = Number(p.breakout.price);
					const bdate = idxToIso[bidx] ? String(idxToIso[bidx]).slice(0, 10) : 'n/a';
					const bprice = Number.isFinite(bpx) ? Math.round(bpx).toLocaleString() : 'n/a';
					breakoutLine = `   - ブレイク: ${bdate} (${bprice}円)`;
				}
			} catch { /* ignore */ }
			// ウェッジパターンのブレイク方向と結果（LLM が正しく解釈できるように）
			let wedgeOutcomeLine: string | null = null;
			try {
				if ((p?.type === 'falling_wedge' || p?.type === 'rising_wedge') && p?.breakoutDirection && p?.outcome) {
					const directionJa = p.breakoutDirection === 'up' ? '上方' : '下方';
					const outcomeJa = p.outcome === 'success' ? '成功' : '失敗';
					const expectedDir = p.type === 'falling_wedge' ? '上方' : '下方';
					const meaning = p.type === 'falling_wedge'
						? (p.outcome === 'success' ? '強気転換' : '弱気継続')
						: (p.outcome === 'success' ? '弱気転換' : '強気継続');
					wedgeOutcomeLine = `   - ブレイク方向: ${directionJa}ブレイク（本来は${expectedDir}ブレイクが期待されるパターン）\n   - パターン結果: ${outcomeJa}（${meaning}）`;
				}
			} catch { /* ignore */ }
			// structure diagram SVG (inline for LLM visibility)
			let diagramBlock: string | null = null;
			try {
				if ((view === 'full' || view === 'detailed') && p?.structureDiagram?.svg) {
					const diagram = p.structureDiagram;
					const id = String(diagram?.artifact?.identifier || 'pattern-diagram');
					const title = String(diagram?.artifact?.title || 'パターン構造図');
					const svg = String(diagram.svg);
					diagramBlock = [
						'--- Structure Diagram (SVG) ---',
						`identifier: ${id}`,
						`title: ${title}`,
						'type: image/svg+xml',
						'',
						svg
					].join('\n');
				}
			} catch { /* noop */ }
			const lines = [
				`${idx + 1}. ${name} (パターン整合度: ${conf})`,
				`   - 期間: ${range}`,
				priceRange ? `   - 価格範囲: ${priceRange}` : null,
				...(pivotLines.length ? pivotLines : []),
				neckline ? `   - ネックライン: ${neckline}` : null,
				breakoutLine,
				wedgeOutcomeLine,
				diagramBlock,
			].filter(Boolean);
			return lines.join('\n');
		};
		if ((view || 'detailed') === 'summary') {
			const toTs = (s?: string) => { try { return s ? Date.parse(s) : NaN; } catch { return NaN; } };
			const now = Date.now();
			const within = (ms: number) => pats.filter(p => Number.isFinite(toTs(p?.range?.end)) && (now - toTs(p.range.end)) <= ms).length;
			const in30 = within(30 * 86400000);
			const in90 = within(90 * 86400000);
			const starts = pats.map(p => toTs(p?.range?.start)).filter((x: number) => Number.isFinite(x));
			const ends = pats.map(p => toTs(p?.range?.end)).filter((x: number) => Number.isFinite(x));
			const periodLine = (starts.length && ends.length) ? `検出対象期間: ${new Date(Math.min(...starts)).toISOString().slice(0, 10)} ~ ${new Date(Math.max(...ends)).toISOString().slice(0, 10)} (${Math.max(1, Math.round((Math.max(...ends) - Math.min(...starts)) / 86400000))}日間)` : '';
			const text = `${hdr}（${typeSummary || '分類なし'}、直近30日: ${in30}件、直近90日: ${in90}件）\n${periodLine}\n検討パターン: ${(patterns && patterns.length) ? patterns.join(', ') : '既定セット'}\n※形成中は includeForming=true を指定してください。\n詳細は structuredContent.data.patterns を参照。`;
			return { content: [{ type: 'text', text }], structuredContent: res as any };
		}
		if ((view || 'detailed') === 'full') {
			const body = pats.map((p, i) => fmtLine(p, i)).join('\n\n');
			const overlayNote = (res as any)?.data?.overlays ? '\n\nチャート連携: structuredContent.data.overlays を render_chart_svg.overlays に渡すと注釈/範囲を描画できます。' : '';
			const trustNote = '\n\nパターン整合度について（形状一致度・対称性・期間から算出）:\n  0.8以上 = 理想的な形状（教科書的パターン）\n  0.7-0.8 = 標準的な形状（他指標と併用推奨）\n  0.6-0.7 = やや不明瞭（慎重に判断）\n  0.6未満 = 形状不十分';
			const text = `${hdr}（${typeSummary || '分類なし'}）\n\n【検出パターン（全件）】\n${body}${overlayNote}${trustNote}`;
			return { content: [{ type: 'text', text }], structuredContent: res as any };
		}
		// detailed (default): 上位5件
		const top = pats.slice(0, 5);
		const body = top.length ? top.map((p, i) => fmtLine(p, i)).join('\n\n') : '';
		let none = '';
		if (!top.length) {
			const effTol = (meta as any)?.effective_params?.tolerancePct ?? tolerancePct ?? 'default';
			none = `\nパターンは検出されませんでした（tolerancePct=${effTol}）。\n・検討パターン: ${(patterns && patterns.length) ? patterns.join(', ') : '既定セット'}\n・必要に応じて tolerance を 0.03-0.06 に緩和してください`;
		}
		const overlayNote = (res as any)?.data?.overlays ? '\n\nチャート連携: structuredContent.data.overlays を render_chart_svg.overlays に渡すと注釈/範囲を描画できます。' : '';
		const trustNote = '\n\nパターン整合度について（形状一致度・対称性・期間から算出）:\n  0.8以上 = 理想的な形状（教科書的パターン）\n  0.7-0.8 = 標準的な形状（他指標と併用推奨）\n  0.6-0.7 = やや不明瞭（慎重に判断）\n  0.6未満 = 形状不十分';
		const usage = `\n\nusage_example:\n  step1: detect_patterns を実行\n  step2: structuredContent.data.overlays を取得\n  step3: render_chart_svg の overlays に渡す`;
		const text = `${hdr}（${typeSummary || '分類なし'}）\n\n${top.length ? '【検出パターン】\n' + body : ''}${none}${overlayNote}${trustNote}${usage}`;
		return { content: [{ type: 'text', text }], structuredContent: { ...res, usage_example: { step1: 'detect_patterns を実行', step2: 'data.overlays を取得', step3: 'render_chart_svg の overlays に渡す' } } as any };
	}
);

//

registerToolWithLog(
	'analyze_market_signal',
	{ description: '【初動トリアージ専用】市場の総合状態を単一スコア(-100〜+100)で瞬時評価。分析の起点として最初に呼び出すツール。\n\n■ 主な用途\n- 「今、買い/売り/中立のどれか？」の即答\n- 詳細分析が必要な要素の特定\n- 複数銘柄の相対比較・スクリーニング\n\n■ スコア計算式\nscore = 0.35×buyPressure + 0.25×cvdTrend + 0.15×momentum + 0.10×volatility + 0.15×smaTrend\n\n5要素の意味:\n- buyPressure (35%): 板の買い/売り注文バランス\n- cvdTrend (25%): 累積出来高差分の方向性\n- momentum (15%): RSI/MACDなどの勢い指標\n- volatility (10%): 価格変動の大きさ\n- smaTrend (15%): 移動平均線の配置と変化\n\n■ このツールの限界（重要）\nこれは概要把握用のスナップショット。詳細分析には以下の専門ツールを併用すること:\n- フロー詳細分析 → get_flow_metrics (時系列バケット、スパイク検出)\n- ボラティリティ詳細 → get_volatility_metrics (RV/ATR/Parkinson/GK/RS)\n- テクニカル指標詳細 → get_indicators (RSI/MACD/BB/一目の全詳細値)\n- 板の帯域別分析 → get_orderbook (mode=pressure, ±0.1%/0.5%/1%等の層別圧力)\n- パターン検出 → detect_patterns（形成中+完成済みの統合版）\n\n■ LLMへの指示\n1. スコアを説明する際は必ず計算式と各要素の寄与度を明示\n2. 最も影響している要素（topContributors）を強調\n3. スコアが中立付近または要素間で矛盾がある場合、追加の専門ツール呼び出しを推奨\n4. SMA関連は「SMA配置トレンド(構造)」と「短期SMA変化スコア(勢い)」を区別して説明', inputSchema: AnalyzeMarketSignalInputSchema },
	async ({ pair, type, flowLimit, bucketMs, windows }: any) => {
		const res: any = await analyzeMarketSignal(pair, { type, flowLimit, bucketMs, windows });
		// Build readable content to clarify score scale and neutral range
		try {
			if (!res?.ok) return AnalyzeMarketSignalOutputSchema.parse(res);
			const d: any = res?.data || {};
			const brArr: any[] = Array.isArray(d?.breakdownArray) ? d.breakdownArray : [];
			const score100 = Number.isFinite(d?.score100) ? d.score100 : Math.round((d?.score ?? 0) * 100);
			const rec = String(d?.recommendation || 'neutral');
			const conf = String(d?.confidence || 'unknown');
			const range = d?.scoreRange?.displayMin != null ? `${d.scoreRange.displayMin}〜${d.scoreRange.displayMax}` : '-100〜+100';
			const neutralLine = d?.scoreRange?.neutralBandDisplay ? `${d.scoreRange.neutralBandDisplay.min}〜${d.scoreRange.neutralBandDisplay.max}` : '-10〜+10';
			const top = Array.isArray(d?.topContributors) ? d.topContributors.slice(0, 2) : [];
			const confReason = String(d?.confidenceReason || '');
			const next: any[] = Array.isArray(d?.nextActions) ? d.nextActions : [];
			const lines: string[] = [];
			lines.push(`${String(pair).toUpperCase()} [${String(type || '1day')}]`);
			lines.push(`総合スコア: ${score100}（範囲: ${range}、中立域: ${neutralLine}） → 判定: ${rec}（信頼度: ${conf}${confReason ? `: ${confReason}` : ''}）`);
			if (top.length) lines.push(`主要因: ${top.join(', ')}`);
			// SMA詳細（contentにも明示）
			try {
				const sma = (d as any)?.sma || {};
				const curPx = Number.isFinite(sma?.current) ? Math.round(sma.current).toLocaleString() : null;
				const v = sma?.values || {};
				const dev = sma?.deviations || {};
				const arr = String(sma?.arrangement || '');
				if (curPx || v?.sma25 != null || v?.sma75 != null || v?.sma200 != null) {
					lines.push('');
					lines.push('【SMA（移動平均線）詳細】');
					if (curPx) lines.push(`現在価格: ${curPx}円`);
					const fmtVs = (x?: number | null) => (x == null ? 'n/a' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`);
					const dir = (x?: number | null) => (x == null ? '' : (x >= 0 ? '上' : '下'));
					const s25 = Number.isFinite(v?.sma25) ? Math.round(v.sma25).toLocaleString() : 'n/a';
					const s75 = Number.isFinite(v?.sma75) ? Math.round(v.sma75).toLocaleString() : 'n/a';
					const s200 = Number.isFinite(v?.sma200) ? Math.round(v.sma200).toLocaleString() : 'n/a';
					lines.push(`- 短期（25日）: ${s25}円（今の価格より ${fmtVs(dev?.vs25)} ${dir(dev?.vs25)}に位置）`);
					lines.push(`- 中期（75日）: ${s75}円（今の価格より ${fmtVs(dev?.vs75)} ${dir(dev?.vs75)}に位置）`);
					lines.push(`- 長期（200日）: ${s200}円（今の価格より ${fmtVs(dev?.vs200)} ${dir(dev?.vs200)}に位置）`);
					// 配置（価格と各SMAの並び）を明示
					try {
						const curVal = Number.isFinite(sma?.current) ? Number(sma.current) : null;
						const v25 = Number.isFinite(v?.sma25) ? Number(v.sma25) : null;
						const v75 = Number.isFinite(v?.sma75) ? Number(v.sma75) : null;
						const v200 = Number.isFinite(v?.sma200) ? Number(v.sma200) : null;
						const pts: Array<{ label: string; value: number }> = [];
						if (curVal != null) pts.push({ label: '価格', value: curVal });
						if (v25 != null) pts.push({ label: '25日', value: v25 });
						if (v75 != null) pts.push({ label: '75日', value: v75 });
						if (v200 != null) pts.push({ label: '200日', value: v200 });
						if (pts.length >= 3) {
							const order = [...pts].sort((a, b) => b.value - a.value).map(p => p.label).join(' > ');
							const arrLabel = arr === 'bullish' ? '上昇順' : arr === 'bearish' ? '下降順' : '混在';
							const struct = arr === 'bullish' ? '上昇トレンド構造' : arr === 'bearish' ? '下落トレンド構造' : '方向感が弱い';
							lines.push(`配置: ${order}（${arrLabel} → ${struct}）`);
						} else {
							const arrLabel = arr === 'bullish' ? '上昇順' : arr === 'bearish' ? '下降順' : '混在';
							lines.push(`配置: ${arrLabel}`);
						}
					} catch { /* ignore arrangement formatting errors */ }
					// 直近クロス（25/75のみ明示）
					if (sma?.recentCross?.pair === '25/75') {
						const crossJp = sma.recentCross.type === 'golden_cross' ? 'ゴールデンクロス' : 'デッドクロス';
						const ago = Number(sma.recentCross.barsAgo ?? 0);
						const isDaily = String(type || '').includes('day');
						const unit = isDaily ? '日前' : '本前';
						const verb = sma.recentCross.type === 'golden_cross' ? '上抜け' : '下抜け';
						lines.push(`直近クロス: ${ago}${unit} 25日線が75日線を${verb}（${crossJp}）`);
					}
				}
			} catch { /* ignore SMA enrichment errors */ }
			// 補足指標（RSI・一目・MACD）を追加
			try {
				const refs = (d as any)?.refs?.indicators?.latest || {};
				const rsiVal = refs?.RSI_14;
				const spanA = refs?.ICHIMOKU_spanA;
				const spanB = refs?.ICHIMOKU_spanB;
				const macdHist = refs?.MACD_hist;
				const hasSupplementary = rsiVal != null || (spanA != null && spanB != null) || macdHist != null;
				if (hasSupplementary) {
					lines.push('');
					lines.push('【補足指標】');
					// RSI
					if (rsiVal != null && Number.isFinite(rsiVal)) {
						const rsiRounded = Number(rsiVal).toFixed(2);
						const rsiLabel = rsiVal < 30 ? '売られすぎ' : rsiVal > 70 ? '買われすぎ' : '中立圏';
						lines.push(`RSI(14): ${rsiRounded}（${rsiLabel}）`);
					}
					// 一目均衡表
					const curPx = (d as any)?.sma?.current;
					if (spanA != null && spanB != null && curPx != null && Number.isFinite(spanA) && Number.isFinite(spanB)) {
						const cloudTop = Math.max(Number(spanA), Number(spanB));
						const cloudBottom = Math.min(Number(spanA), Number(spanB));
						const cloudThickness = Math.abs(cloudTop - cloudBottom);
						const cloudThicknessPct = curPx > 0 ? ((cloudThickness / curPx) * 100).toFixed(1) : 'n/a';
						let positionLabel = '雲の中';
						let distancePct = 'n/a';
						if (curPx > cloudTop) {
							positionLabel = '雲の上';
							distancePct = `+${((curPx - cloudTop) / curPx * 100).toFixed(1)}%`;
						} else if (curPx < cloudBottom) {
							positionLabel = '雲の下';
							distancePct = `+${((cloudBottom - curPx) / curPx * 100).toFixed(1)}%`;
						} else {
							distancePct = '0%';
						}
						lines.push(`一目均衡表: ${positionLabel}（距離 ${distancePct}、雲の厚さ ${cloudThicknessPct}%）`);
					}
					// MACD
					if (macdHist != null && Number.isFinite(macdHist)) {
						const histRounded = Math.round(macdHist).toLocaleString();
						const macdLabel = macdHist > 0 ? '強気' : '弱気';
						lines.push(`MACD: ヒストグラム ${histRounded}（${macdLabel}）`);
					}
				}
			} catch { /* ignore supplementary enrichment errors */ }
			if (brArr.length) {
				lines.push('');
				lines.push('【内訳（raw×weight=寄与）】');
				for (const b of brArr) {
					const w = (Number(b?.weight || 0) * 100).toFixed(0) + '%';
					const raw = Number(b?.rawScore || 0).toFixed(2);
					const contrib = Number(b?.contribution || 0).toFixed(2);
					const interp = String(b?.interpretation || 'neutral');
					lines.push(`- ${b?.factor}: ${raw}×${w}=${contrib} （${interp}）`);
				}
			} else if (d?.contributions && d?.weights) {
				lines.push('');
				lines.push('【内訳（contribution）】');
				for (const k of Object.keys(d.contributions)) {
					const c = Number(d.contributions[k]).toFixed(2);
					const w = d.weights?.[k] != null ? `${Math.round(d.weights[k] * 100)}%` : '';
					lines.push(`- ${k}: ${c}${w ? `（weight ${w}）` : ''}`);
				}
			}
			if (next.length) {
				lines.push('');
				lines.push('【次の確認候補】');
				for (const a of next.slice(0, 3)) {
					const pri = a?.priority === 'high' ? '高' : a?.priority === 'medium' ? '中' : '低';
					const reason = a?.reason ? ` - ${a.reason}` : '';
					lines.push(`- (${pri}) ${a?.tool}${reason}`);
				}
			}
			const text = lines.join('\n');
			return { content: [{ type: 'text', text }], structuredContent: AnalyzeMarketSignalOutputSchema.parse(res) as any };
		} catch {
			return AnalyzeMarketSignalOutputSchema.parse(res);
		}
	}
);

registerToolWithLog(
	'analyze_ichimoku_snapshot',
	{ description: '一目均衡表の数値スナップショットを返します（視覚的判定は行いません）。価格と雲の位置関係、転換線/基準線の関係、雲の傾き（spanA/Bの差分）を数値から評価します。SVGの見た目について断定しないでください。', inputSchema: (await import('./schemas.js')).AnalyzeIchimokuSnapshotInputSchema as any },
	async ({ pair, type, limit }: any) => analyzeIchimokuSnapshot(pair, type, limit)
);

registerToolWithLog(
	'analyze_bb_snapshot',
	{ description: 'ボリンジャーバンドの数値スナップショットを取得。視覚的判断は行わず、客観的な数値のみ提供。\n\n【mode の使い分け】\n- default (推奨): ±2σ帯の基本情報で高速チェック\n  - middle/upper(+2σ)/lower(-2σ)\n  - zScore: 現在価格が±2σ帯のどこに位置するか\n  - bandWidthPct: バンド幅の middle 比（スクイーズ/エクスパンション把握）\n  - 用途: 初動確認、定期監視、軽量スナップショット\n\n- extended: ±1σ/±2σ/±3σ を含む詳細分析\n  - 全階層のバンド値と各層での価格位置\n  - 極端値検出（±3σタッチ、バンドウォーク等）\n  - 用途: 異常値確認、詳細なボラティリティ分析\n\n【他ツールとの使い分け】\n- get_indicators: RSI/MACD等を含む総合テクニカル分析（重い）\n- analyze_bb_snapshot: BB特化で軽量（速い）\n- render_chart_svg: 視覚化が必要な場合', inputSchema: (await import('./schemas.js')).AnalyzeBbSnapshotInputSchema as any },
	async ({ pair, type, limit, mode }: any) => analyzeBbSnapshot(pair, type, limit, mode)
);

registerToolWithLog(
	'analyze_macd_pattern',
	{ description: 'MACDゴールデンクロス/デッドクロスのforming検出と過去統計分析専用。チャートパターン検出は detect_patterns(includeForming=true) を使用。historyDays（既定90）、performanceWindows（既定1/3/5/10）、minHistogramForForming（既定0.3）。', inputSchema: z.object({ pair: z.string(), historyDays: z.number().int().min(10).max(365).optional().default(90), performanceWindows: z.array(z.number().int().min(1).max(30)).optional().default([1, 3, 5, 10] as any), minHistogramForForming: z.number().min(0).optional().default(0.3) }) as any },
	async ({ pair, historyDays, performanceWindows, minHistogramForForming }: any) => analyzeMacdPattern({ pair, historyDays, performanceWindows, minHistogramForForming })
);

registerToolWithLog(
	'analyze_sma_snapshot',
	{ description: 'SMA の数値スナップショット。指定periodsの最新値、近傍のクロス（golden/dead）、整列状態（bullish/bearish/mixed）。視覚的主張は行いません。', inputSchema: (await import('./schemas.js')).AnalyzeSmaSnapshotInputSchema as any },
	async ({ pair, type, limit, periods }: any) => analyzeSmaSnapshot(pair, type, limit, periods)
);

registerToolWithLog(
	'analyze_support_resistance',
	{ description: 'サポート・レジスタンスを自動検出。過去のローソク足から反発/反落ポイントを抽出し、接触回数・強度・直近の崩壊実績を分析。LLMのハルシネーションを防ぐため、サーバー側で正確に計算してcontentに結果を出力。', inputSchema: (await import('./schemas.js')).AnalyzeSupportResistanceInputSchema as any },
	async ({ pair, lookbackDays, topN, tolerance }: any) => analyzeSupportResistance(pair, { lookbackDays, topN, tolerance })
);

registerToolWithLog(
	'analyze_candle_patterns',
	{
		description: '2本足ローソクパターン検出（包み線・はらみ線・毛抜き・かぶせ線・切り込み線）。BTC/JPY日足の直近5日間から短期反転パターンを検出し、過去180日間の統計（勝率・平均リターン）を付与。初心者向けに自然言語で解説。未確定ローソク対応。\n\n【パラメータ制約】\npair: btc_jpy 固定、timeframe: 1day 固定（現時点ではBTC/JPY日足のみ統計データ蓄積済みのため）。他ペア/時間軸は統計精度が不十分なため非対応。\n\n【視覚化】ユーザーが図での確認を希望した場合、本ツールの結果を render_candle_pattern_diagram に渡してSVG構造図を生成できる。',
		inputSchema: (await import('./schemas.js')).AnalyzeCandlePatternsInputSchema as any
	},
	async (args: any) => analyzeCandlePatterns(args)
);

registerToolWithLog(
	'render_candle_pattern_diagram',
	{
		description: 'analyze_candle_patternsで検出されたパターンを教育用の構造図として視覚化。\n【重要】ユーザーが明示的に「図で見せて」「視覚的に確認したい」等と要求した場合のみ使用。自発的な呼び出しは避けること。分析結果のテキスト説明で十分な場合は不要。\nローソク足5本を表示し、パターン該当2本をオレンジ枠でハイライト。「前日」「確定日」ラベル（オレンジ）、関係性を示す矢印（淡いブルー）付き。初心者が直感的に理解できる構造図。\n\n【返却形式】\n- data.svg: 完全なSVG文字列\n- meta.patternName: パターン名\n\n【表示方法】\ndata.svgをHTMLファイルに埋め込んで保存し、ユーザーに提示。\n※ SVGを直接Markdownに貼っても表示されないため、ファイル出力が必要。\n- Claude.ai: /mnt/user-data/outputs/ に保存してpresent_filesで提示\n- Cursor/他環境: プロジェクト内(例: assets/)に保存してパスを案内',
		inputSchema: z.object({
			candles: z.array(z.object({
				date: z.string().describe('Display date e.g. "11/6(木)"'),
				open: z.number(),
				high: z.number(),
				low: z.number(),
				close: z.number(),
				type: z.enum(['bullish', 'bearish']),
				isPartial: z.boolean().optional(),
			})).min(2).max(10).describe('Candle data array (oldest first)'),
			pattern: z.object({
				name: z.string().describe('Pattern name in Japanese e.g. "陽線包み線"'),
				nameEn: z.string().optional(),
				confirmedDate: z.string().describe('Confirmed date e.g. "11/9(日)"'),
				involvedIndices: z.tuple([z.number().int(), z.number().int()]),
				direction: z.enum(['bullish', 'bearish']).optional(),
			}).optional().describe('Pattern to highlight'),
			title: z.string().optional(),
			theme: z.enum(['dark', 'light']).optional().default('dark'),
		}) as any
	},
	async (args: any) => {
		const res: any = await renderCandlePatternDiagram(args);
		if (!res?.ok) return res;
		const data: any = res.data || {};
		const meta: any = res.meta || {};
		if (data?.svg) {
			const patternName = meta?.patternName || args?.pattern?.name || 'ローソク足パターン';
			const identifier = `candle-pattern-${patternName.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}`;
			const title = `${patternName}構造図`;
			const text = [
				'--- Candle Pattern Diagram ---',
				`identifier: ${identifier}`,
				`title: ${title}`,
				'type: image/svg+xml',
				'',
				String(data.svg),
				'',
				'Chart Info:',
				`- Pattern: ${patternName}`,
				`- Size: ${meta?.width || 800}x${meta?.height || 450}px`,
				`- Candles: ${meta?.candleCount || 5}本`,
			].join('\n');
			const enriched = {
				...res,
				artifactHint: {
					renderHint: 'ARTIFACT_REQUIRED',
					displayType: 'image/svg+xml',
					source: 'inline_svg',
				},
			};
			return { content: [{ type: 'text', text }], structuredContent: enriched };
		}
		return { content: [{ type: 'text', text: res.summary || 'Diagram rendered' }], structuredContent: res };
	}
);

registerToolWithLog(
	'get_tickers_jpy',
	{
		description: '全JPYペアのティッカーを取得（/tickers_jpy）。view=ranked でランキング表示、view=items で全データ。キャッシュ10秒。',
		inputSchema: z.object({
			view: z.enum(['items', 'ranked']).optional().default('ranked'),
			sortBy: z.enum(['change24h', 'volume', 'name']).optional().default('change24h'),
			order: z.enum(['asc', 'desc']).optional().default('desc'),
			limit: z.number().int().min(1).max(50).optional().default(5),
		}) as any
	},
	async (args: any) => {
		const view = (args?.view ?? 'ranked') as 'items' | 'ranked';
		const sortBy = (args?.sortBy ?? 'change24h') as 'change24h' | 'volume' | 'name';
		const order = (args?.order ?? 'desc') as 'asc' | 'desc';
		const limit = Number(args?.limit ?? 5);
		const res: any = await getTickersJpy();
		if (!res?.ok) return res;
		const items: any[] = Array.isArray(res?.data) ? res.data : [];

		// フォーマット関数
		const formatVolume = formatVolumeJPY;
		const formatPrice = fmtPrice;

		// normalize numeric fields（open/high/low 追加）
		const norm = items.map((it: any) => {
			const lastN = it?.last != null ? Number(it.last) : null;
			const openN = it?.open != null ? Number(it.open) : null;
			const highN = it?.high != null ? Number(it.high) : null;
			const lowN = it?.low != null ? Number(it.low) : null;
			const buyN = it?.buy != null ? Number(it.buy) : null;
			const sellN = it?.sell != null ? Number(it.sell) : null;
			const change = (it?.change24h ?? it?.change24hPct);
			const changeN = change != null ? Number(change) : (openN != null && openN > 0 && lastN != null ? Number((((lastN - openN) / openN) * 100).toFixed(2)) : null);
			const volN = it?.vol != null ? Number(it.vol) : null;
			const volumeInJPY = (volN != null && lastN != null && Number.isFinite(volN) && Number.isFinite(lastN))
				? volN * lastN
				: null;
			return { ...it, lastN, openN, highN, lowN, buyN, sellN, changeN, volN, volumeInJPY };
		});

		// ranking logic
		const cmpNum = (a?: number | null, b?: number | null) => {
			const aa = (a == null || Number.isNaN(a)) ? -Infinity : a;
			const bb = (b == null || Number.isNaN(b)) ? -Infinity : b;
			return aa - bb;
		};
		const sorted = [...norm].sort((a, b) => {
			if (sortBy === 'name') {
				return String(a.pair).localeCompare(String(b.pair));
			}
			if (sortBy === 'volume') {
				return cmpNum(a.volumeInJPY, b.volumeInJPY);
			}
			return cmpNum(a.changeN, b.changeN);
		});
		if ((order || 'desc') === 'desc') sorted.reverse();
		const ranked = sorted.slice(0, Number(limit || 5));

		if (view === 'ranked') {
			const lines = ranked.map((r, i) => {
				const chg = formatPercent(r.changeN, { sign: true, digits: 2 });
				const px = formatPrice(r.lastN);
				const volTxt = formatVolume(r.volumeInJPY);
				return `${i + 1}. ${String(r.pair).toUpperCase().replace('_', '/')} ${chg}（${px}、出来高${volTxt}）`;
			});
			const text = [
				`全${items.length}ペア取得（sortBy=${sortBy}, ${order}, top${limit}）`,
				'',
				lines.join('\n'),
			].join('\n');
			return {
				content: [{ type: 'text', text }],
				structuredContent: {
					ok: true,
					summary: `ranked ${ranked.length}/${items.length}`,
					data: { items: norm, ranked },
					meta: res?.meta ?? {},
				} as Record<string, unknown>,
			};
		}

		// view=items: 全データ一覧（上位5件をサマリ表示）
		const top5 = norm.slice(0, 5);
		const lines: string[] = [];
		lines.push(`全${norm.length}ペア取得`);
		lines.push('');
		for (const it of top5) {
			const pairDisplay = String(it.pair).toUpperCase().replace('_', '/');
			const priceStr = formatPrice(it.lastN);
			const changeStr = formatPercent(it.changeN, { sign: true, digits: 2 });
			const volStr = formatVolume(it.volumeInJPY);
			lines.push(`${pairDisplay}: ${priceStr} (${changeStr}) 出来高${volStr}`);
		}
		if (norm.length > 5) {
			lines.push(`... 他${norm.length - 5}ペア`);
		}
		const text = lines.join('\n');
		return {
			content: [{ type: 'text', text }],
			structuredContent: { ...res, data: { items: norm } } as Record<string, unknown>,
		};
	}
);



registerToolWithLog(
	'detect_macd_cross',
	{ description: '既にクロスした銘柄のスクリーニング専用。forming 中の検出は analyze_macd_pattern を使用。\n\n市場内の銘柄で直近のMACDゴールデンクロス/デッドクロスを検出します（1day）。\n\nview: summary|detailed（既定=summary）\n- summary: 簡潔な一覧（高速スキャン用）\n- detailed: クロス強度・価格変化等の詳細（分析用）\n推奨: まず summary で全体把握 → 気になる銘柄のみ detailed で深掘り\n\nlookback（既定=3）: 用途別の目安\n- リアルタイム監視: 1-2\n- 週次レビュー: 5-7\n\npairs で検査対象ペアを限定可能。\n\nscreen（任意）: スクリーニング用フィルタ/ソート\n- minHistogramDelta: ヒストグラム変化の下限\n- maxBarsAgo: 直近バー数以内\n- minReturnPct: クロス以降の騰落率下限\n- crossType: golden|dead|both\n- sortBy: date|histogram|return|barsAgo（既定=date）\n- sortOrder: asc|desc（既定=desc）\n- limit: 上位N件', inputSchema: z.object({ market: z.enum(['all', 'jpy']).default('all').describe('対象市場'), lookback: z.number().int().min(1).max(10).default(3).describe('検出ウィンドウ（推奨: リアルタイム=1-2, 週次=5-7）'), pairs: z.array(z.string()).optional().describe('検査対象を限定（省略時は市場全体）'), view: z.enum(['summary', 'detailed']).optional().default('summary').describe('summary: 簡潔な一覧（高速スキャン） / detailed: クロス強度・騰落率などの詳細（深掘り）。推奨: まず summary → 気になる銘柄のみ detailed'), screen: z.object({ minHistogramDelta: z.number().optional(), maxBarsAgo: z.number().int().min(0).optional(), minReturnPct: z.number().optional(), crossType: z.enum(['golden', 'dead', 'both']).optional().default('both'), sortBy: z.enum(['date', 'histogram', 'return', 'barsAgo']).optional().default('date'), sortOrder: z.enum(['asc', 'desc']).optional().default('desc'), limit: z.number().int().min(1).max(100).optional(), withPrice: z.boolean().optional() }).optional() }) as any },
	async ({ market, lookback, pairs, view, screen }: any) => {
		const res: any = await detectMacdCross(market, lookback, pairs, view, screen);
		if (!res?.ok || view !== 'detailed') return res;
		try {
			const detRaw: any[] = Array.isArray(res?.data?.screenedDetailed)
				? (res as any).data.screenedDetailed
				: (Array.isArray(res?.data?.resultsDetailed) ? (res as any).data.resultsDetailed : []);
			if (!detRaw.length) return res;
			const fmtDelta = (v: any) => v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}`;
			const fmtRet = (v: any) => v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`;
			const lines = detRaw.map((r) => {
				const date = (r?.crossDate || '').slice(0, 10);
				const prevDays = r?.prevCross?.barsAgo != null ? `${r.prevCross.barsAgo}日` : 'n/a';
				return `${String(r.pair)}: ${String(r.type)}@${date} (ヒストグラム${fmtDelta(r?.histogramDelta)}, 前回クロスから${prevDays}${r?.returnSinceCrossPct != null ? `, ${fmtRet(r.returnSinceCrossPct)}` : ''})`;
			});
			const text = `${String(res?.summary || '')}\n${lines.join('\n')}`.trim();
			return { content: [{ type: 'text', text }], structuredContent: res as Record<string, unknown> };
		} catch { return res; }
	}
);

registerToolWithLog(
	'detect_whale_events',
	{ description: '大口投資家の動向を簡易に検出（板×ローソク足）。lookback=30min|1hour|2hour、minSize=0.5BTC既定。推測ベースで、実約定・寿命照合は未実装。', inputSchema: z.object({ pair: z.string().default('btc_jpy'), lookback: z.enum(['30min', '1hour', '2hour']).default('1hour'), minSize: z.number().min(0).default(0.5) }) as any },
	async ({ pair, lookback, minSize }: any) => detectWhaleEvents(pair, lookback, minSize)
);

// === Trading Process: Backtest Tools ===
registerToolWithLog(
	'run_backtest',
	{
		description: `汎用バックテストを実行。データ取得・計算・チャート描画をすべて行い、結果をワンコールで返します。

★★★ 重要 ★★★
このツールはチャート（SVG）を含む完全な結果を返します。
get_candles でデータを取得して独自にバックテストを実装したり、
matplotlib/D3.js 等で独自にチャートを描画する必要はありません。

【利用可能な戦略】
- sma_cross: SMAクロスオーバー（params: short, long）
  - エントリーフィルター（買いシグナルのみ適用、売りはフィルターなし）:
    - sma_filter_period: SMAトレンドフィルター（例: 200 → 価格がSMA200より上の場合のみ買い）
    - rsi_filter_period: RSI計算期間（例: 14）
    - rsi_filter_max: RSIがこの値未満の場合のみ買い（例: 70）
- rsi: RSI売られすぎ/買われすぎ（params: period, overbought, oversold）
- macd_cross: MACDクロスオーバー（params: fast, slow, signal）
  - エントリーフィルター（買いシグナルのみ適用、売りはフィルターなし）:
    - sma_filter_period: SMAトレンドフィルター（例: 200 → 価格がSMA200より上の場合のみ買い）
    - zero_line_filter: -1=MACD≤0で買い（反転狙い）, 1=MACD≥0で買い（トレンド継続）
    - rsi_filter_period: RSI計算期間（例: 14）
    - rsi_filter_max: RSIがこの値未満の場合のみ買い（例: 70）
- bb_breakout: ボリンジャーバンドブレイクアウト（params: period, stddev）

【時間軸】
- 1D: 日足（デフォルト）
- 4H: 4時間足
- 1H: 1時間足

【期間（period）】
- 1M: 約1ヶ月（30日相当）
- 3M: 約3ヶ月（90日相当）
- 6M: 約6ヶ月（180日相当）
※ "30D" のような直接的な日数指定は不可。1M/3M/6M から選択してください。

【入力例】
{
  "pair": "btc_jpy",
  "period": "3M",
  "strategy": {
    "type": "sma_cross",
    "params": { "short": 5, "long": 20 }
  }
}

{
  "pair": "btc_jpy",
  "timeframe": "1H",
  "period": "1M",
  "strategy": { "type": "rsi" }
}

// SMA 5/20 + SMA200トレンドフィルター（価格がSMA200より上の場合のみ買い）
{
  "pair": "btc_jpy",
  "period": "6M",
  "strategy": {
    "type": "sma_cross",
    "params": { "short": 5, "long": 20, "sma_filter_period": 200 }
  }
}

// SMA 5/20 + RSIフィルター（RSI<70のみ買い）
{
  "pair": "btc_jpy",
  "period": "3M",
  "strategy": {
    "type": "sma_cross",
    "params": { "short": 5, "long": 20, "rsi_filter_period": 14, "rsi_filter_max": 70 }
  }
}

// MACD + SMA200トレンドフィルター
{
  "pair": "btc_jpy",
  "period": "6M",
  "strategy": {
    "type": "macd_cross",
    "params": { "sma_filter_period": 200 }
  }
}

// MACD + ゼロライン以下でのみ買い（反転狙い）
{
  "pair": "btc_jpy",
  "period": "6M",
  "strategy": {
    "type": "macd_cross",
    "params": { "zero_line_filter": -1 }
  }
}

【チャート詳細度（chartDetail）— 指定がなければ必ず default を使うこと】
- default: エクイティカーブ + ドローダウン。「損益」「plotして」「グラフ」「チャート」等の表現はすべて default。
- full: 価格+インジケーター+エクイティ+DD+ポジションの5段構成。ユーザーが価格推移やシグナルの視覚的確認を求めた場合に使用（例：「売買タイミングを見せて」「エントリーポイントを表示」「価格チャートも含めて」等）。

【出力】
- summary: テキストサマリー（総損益, トレード数, 勝率, 最大DD, Avg P&L/Trade, Profit Factor, Sharpe Ratio）
- svg: チャート（SVG形式、そのままアーティファクトとして表示可能）

【チャート表示方法】
返却される svg をHTMLアーティファクトに埋め込んで表示してください。
例: <html><body>ここにSVGを埋め込む</body></html>

【注意】
- 過去データに基づくバックテストであり、将来の成果を保証するものではありません`,
		inputSchema: RunBacktestInputSchema as any
	},
	async (args: any) => {
		const res = await runBacktest({
			pair: args.pair,
			timeframe: args.timeframe,
			period: args.period,
			strategy: args.strategy,
			fee_bp: args.fee_bp,
			execution: args.execution,
			outputDir: args.outputDir,
			savePng: args.savePng ?? false,  // デフォルト: false（ファイルシステム非共有のため）
			includeSvg: args.includeSvg ?? true,  // デフォルト: true（SVGを返す）
			chartDetail: args.chartDetail ?? 'default',  // デフォルト: 軽量チャート
		});

		if (!res.ok) {
			const errorText = res.availableStrategies
				? `Error: ${res.error}\nAvailable strategies: ${res.availableStrategies.join(', ')}`
				: `Error: ${res.error}`;
			return { content: [{ type: 'text', text: errorText }], structuredContent: res };
		}

		// SVG がある場合はアーティファクト用のヒントを追加
		let svgHint = '';
		if (res.svg) {
			svgHint = [
				'',
				'--- Backtest Chart (SVG) ---',
				`identifier: backtest-${args.strategy?.type}-${args.pair}-${Date.now()}`,
				`title: ${args.pair?.toUpperCase() || 'BTC_JPY'} ${res.data.input.strategy.type} Backtest`,
				'type: image/svg+xml',
				'',
				res.svg,
			].join('\n');
		}

		return {
			content: [{ type: 'text', text: res.summary + svgHint }],
			structuredContent: {
				ok: true,
				summary: res.summary,
				svg: res.svg,
				data: {
					input: res.data.input,
					summary: res.data.summary,
					trade_count: res.data.trades.length,
				},
				artifactHint: res.svg ? {
					renderHint: 'ARTIFACT_REQUIRED',
					displayType: 'image/svg+xml',
					source: 'inline_svg',
				} : undefined,
			},
		};
	}
);

// prompts are unchanged for TS port and can be reused or migrated later

// 接続は全登録完了後に実行する（tools/prompts の後）

// === Register prompts (SDK 形式に寄せた最小導入) ===
function registerPromptSafe(name: string, def: { description: string; messages: any[] }) {
	const s: any = server as any;
	if (typeof s.registerPrompt === 'function') {
		// Inspector 互換: tool_code をテキストに変換し、role=system は user 扱いにする
		const toSdkMessages = (msgs: any[]) =>
			msgs.map((msg) => {
				const blocks = Array.isArray(msg.content) ? msg.content : [];
				const text = blocks
					.map((b: any) => {
						if (b?.type === 'text' && typeof b.text === 'string') return b.text;
						if (b?.type === 'tool_code') {
							const tool = b.tool_name || 'tool';
							const args = b.tool_input ? JSON.stringify(b.tool_input) : '{}';
							return `Call ${tool} with ${args}`;
						}
						return '';
					})
					.filter(Boolean)
					.join('\n');
				return { role: msg.role === 'system' ? 'user' : 'assistant', content: { type: 'text', text } };
			});
		registeredPrompts.push({ name, description: def.description });
		s.registerPrompt(
			name,
			{ description: def.description },
			() => ({ description: def.description, messages: toSdkMessages(def.messages) })
		);
	} else {
		// no-op if SDK doesn't support prompts in this version
	}
}

// === Register prompts from src/prompts.ts ===
for (const p of (promptDefs as any[])) {
	registerPromptSafe(p.name, { description: p.description, messages: p.messages });
}

// === stdio 接続（最後に実行） ===
const transport = new StdioServerTransport();
await server.connect(transport);

// Fallback handlers to ensure list operations work over STDIO
try {
	(server as any).setRequestHandler?.('tools/list', async () => ({
		tools: registeredTools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
	}));
	(server as any).setRequestHandler?.('prompts/list', async () => ({
		prompts: registeredPrompts.map((p) => ({ name: p.name, description: p.description })),
	}));
	// prompts/get: return specific prompt definition as-is (no conversion)
	(server as any).setRequestHandler?.('prompts/get', async (request: any) => {
		try {
			console.error('[prompts/get] Request received:', safeJson(request));
			const name = request?.params?.name;
			console.error('[prompts/get] Requested name:', name);
			if (!name) {
				console.error('[prompts/get] ERROR: No name provided');
				throw new Error('Prompt name is required');
			}
			console.error('[prompts/get] Available prompts:', (promptDefs as any[]).map((p) => p.name).join(', '));
			const promptDef = (promptDefs as any[]).find((p) => p.name === name);
			if (!promptDef) {
				console.error('[prompts/get] ERROR: Prompt not found:', name);
				throw new Error(`Prompt not found: ${name}`);
			}
			console.error('[prompts/get] Found prompt:', name, 'with', (promptDef as any)?.messages?.length ?? 0, 'messages');
			const result = { description: (promptDef as any).description, messages: (promptDef as any).messages };
			console.error('[prompts/get] Returning result with', (result as any).messages?.length ?? 0, 'messages');
			return result;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			const stack = error instanceof Error ? error.stack : undefined;
			console.error('[prompts/get] EXCEPTION:', message, stack);
			throw error;
		}
	});
} catch { }

function safeJson(v: unknown) {
	try { return JSON.stringify(v); } catch { return '[unserializable]'; }
}

// Resources: provide system-level prompt as MCP resource
try {
	(server as any).setRequestHandler?.('resources/list', async () => ({
		resources: [
			{
				uri: 'prompt://system',
				name: 'test-bb System Prompt',
				description: 'System-level guidance for using test-bb MCP server',
				mimeType: 'text/plain',
			},
		],
	}));
	(server as any).setRequestHandler?.('resources/read', async (request: any) => {
		const uri = request?.params?.uri;
		if (uri === 'prompt://system') {
			return {
				contents: [
					{ uri: 'prompt://system', mimeType: 'text/plain', text: SYSTEM_PROMPT },
				],
			};
		}
		throw new Error(`Resource not found: ${uri}`);
	});
} catch { }

// Optional HTTP transport (/mcp) when PORT is provided
try {
	const portStr = process.env.PORT;
	const port = portStr ? Number(portStr) : NaN;
	const enableHttp = process.env.MCP_ENABLE_HTTP === '1';
	if (enableHttp && Number.isFinite(port) && port > 0) {
		const { default: express } = await import('express');
		const app = express();
		app.use(express.json());
		const allowedHosts = (process.env.ALLOWED_HOSTS || '127.0.0.1,localhost').split(',').map(s => s.trim()).filter(Boolean);
		const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
		const httpTransport: any = new (StreamableHTTPServerTransport as any)({
			path: '/mcp', // some SDKs use 'path' instead of 'endpoint'
			sessionIdGenerator: () => randomUUID(),
			enableDnsRebindingProtection: true,
			...(allowedHosts.length ? { allowedHosts } : {}),
			...(allowedOrigins.length ? { allowedOrigins } : {}),
		} as any);
		await server.connect(httpTransport as any);
		const mw = typeof httpTransport.expressMiddleware === 'function'
			? httpTransport.expressMiddleware()
			: (req: any, res: any, next: any) => next();
		app.use(mw);
		app.listen(port, () => {
			// no stdout/stderr output to avoid STDIO transport contamination
		});
	}
} catch (e) {
	// eslint-disable-next-line no-console
	console.warn('HTTP transport setup skipped:', (e as any)?.message || e);
}
