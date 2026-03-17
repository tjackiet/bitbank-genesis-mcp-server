/**
 * prepare_chart_data — Visualizer / チャート描画用の時系列データを返す。
 *
 * analyze_indicators の chart (ChartPayload) を内部で呼び出し、
 * Visualizer が直接プロットできる {time, value}[] 形式に整形する。
 * 一目均衡表の chikou シフトは適用済み。
 */

import { fail, failFromError, ok } from '../lib/result.js';
import { createMeta, ensurePair } from '../lib/validate.js';
import type { Candle, FailResult, NumericSeries, OkResult } from '../src/schemas.js';
import { PrepareChartDataInputSchema } from '../src/schemas.js';
import type { ToolDefinition } from '../src/tool-definition.js';
import analyzeIndicators from './analyze_indicators.js';

// ── 指標グループ → chart.indicators キーのマッピング ──

const MAIN_SERIES_KEYS: Record<string, string[]> = {
	SMA_5: ['SMA_5'],
	SMA_20: ['SMA_20'],
	SMA_25: ['SMA_25'],
	SMA_50: ['SMA_50'],
	SMA_75: ['SMA_75'],
	SMA_200: ['SMA_200'],
	EMA_12: ['EMA_12'],
	EMA_26: ['EMA_26'],
	EMA_50: ['EMA_50'],
	EMA_200: ['EMA_200'],
	BB: ['BB_upper', 'BB_middle', 'BB_lower'],
	ICHIMOKU: ['ICHI_tenkan', 'ICHI_kijun', 'ICHI_spanA', 'ICHI_spanB', 'ICHI_chikou'],
};

type TimeValue = { time: string; value: number | null };

/** NumericSeries + Candle[] → {time, value}[] */
function toTimeSeries(series: NumericSeries, candles: Candle[]): TimeValue[] {
	return series.map((v, i) => ({
		time: candles[i]?.isoTime ?? '',
		value: v,
	}));
}

interface PrepareChartDataResult {
	candles: Array<{ time: string; open: number; high: number; low: number; close: number; volume?: number }>;
	series: Record<string, TimeValue[]>;
	subPanels: {
		RSI_14?: TimeValue[];
		MACD?: { line: TimeValue[]; signal: TimeValue[]; hist: TimeValue[] };
		STOCH_K?: TimeValue[];
		STOCH_D?: TimeValue[];
	};
}

interface PrepareChartDataMeta {
	pair: string;
	type: string;
	count: number;
}

export default async function prepareChartData(
	pair: string = 'btc_jpy',
	type: string = '1day',
	limit: number = 100,
	indicators?: string[],
): Promise<OkResult<PrepareChartDataResult, PrepareChartDataMeta> | FailResult> {
	const chk = ensurePair(pair);
	if (!chk.ok) return fail(chk.error.message, chk.error.type);

	try {
		const res = await analyzeIndicators(chk.pair, type, limit);
		if (!res.ok) return fail(res.summary.replace(/^Error: /, ''), res.meta.errorType);

		const chart = res.data.chart;
		const candles = chart.candles.slice(-limit);
		const chartIndicators = chart.indicators as Record<string, unknown>;

		// 指標フィルタ: 指定がなければ全グループ
		const selectedGroups =
			indicators && indicators.length > 0 ? new Set(indicators) : new Set(Object.keys(MAIN_SERIES_KEYS));

		// メインパネル系列の構築
		const series: Record<string, TimeValue[]> = {};
		for (const [group, keys] of Object.entries(MAIN_SERIES_KEYS)) {
			if (!selectedGroups.has(group)) continue;
			for (const key of keys) {
				const arr = chartIndicators[key];
				if (!Array.isArray(arr)) continue;
				const sliced = (arr as NumericSeries).slice(-limit);
				series[key] = toTimeSeries(sliced, candles);
			}
		}

		// サブパネル系列の構築
		const subPanels: PrepareChartDataResult['subPanels'] = {};

		if (selectedGroups.has('RSI')) {
			const rsiArr = chartIndicators.RSI_14_series;
			if (Array.isArray(rsiArr)) {
				subPanels.RSI_14 = toTimeSeries((rsiArr as NumericSeries).slice(-limit), candles);
			}
		}

		if (selectedGroups.has('MACD')) {
			const macdData = chartIndicators.macd_series as
				| { line: NumericSeries; signal: NumericSeries; hist: NumericSeries }
				| undefined;
			if (macdData) {
				subPanels.MACD = {
					line: toTimeSeries(macdData.line.slice(-limit), candles),
					signal: toTimeSeries(macdData.signal.slice(-limit), candles),
					hist: toTimeSeries(macdData.hist.slice(-limit), candles),
				};
			}
		}

		if (selectedGroups.has('STOCH')) {
			const stochK = chartIndicators.stoch_k_series;
			const stochD = chartIndicators.stoch_d_series;
			if (Array.isArray(stochK)) {
				subPanels.STOCH_K = toTimeSeries((stochK as NumericSeries).slice(-limit), candles);
			}
			if (Array.isArray(stochD)) {
				subPanels.STOCH_D = toTimeSeries((stochD as NumericSeries).slice(-limit), candles);
			}
		}

		const data: PrepareChartDataResult = {
			candles: candles.map((c) => ({
				time: c.isoTime ?? '',
				open: c.open,
				high: c.high,
				low: c.low,
				close: c.close,
				volume: c.volume,
			})),
			series,
			subPanels,
		};

		const meta: PrepareChartDataMeta = {
			...createMeta(chk.pair),
			type,
			count: candles.length,
		};

		return ok(
			`${chk.pair} ${type} chart data (${candles.length} candles, ${Object.keys(series).length} series)`,
			data,
			meta,
		);
	} catch (err: unknown) {
		return failFromError(err);
	}
}

export const toolDef: ToolDefinition = {
	name: 'prepare_chart_data',
	description:
		'[Chart / Candlestick / Visualization] チャート描画の第一選択ツール。ローソク足・指標の時系列データを {time, value}[] 形式で返す。全指標は計算・シフト適用済みで Visualizer が直接プロット可能。BB / Ichimoku / SMA / RSI / MACD 対応。\n\nSVG/PNG ファイル保存が必要な場合のみ render_chart_svg を使用。指標の最新値やトレンド判定が必要な場合は analyze_indicators を使用。',
	inputSchema: PrepareChartDataInputSchema,
	handler: async ({
		pair,
		type,
		limit,
		indicators,
	}: {
		pair?: string;
		type?: string;
		limit?: number;
		indicators?: string[];
	}) => {
		const result = await prepareChartData(pair ?? 'btc_jpy', type ?? '1day', limit ?? 100, indicators);
		if (!result.ok) return result;
		// LLM は structuredContent を参照できないため、content テキストにデータを含める
		const text = `${result.summary}\n${JSON.stringify(result.data, null, 2)}`;
		return {
			content: [{ type: 'text', text }],
			structuredContent: result as unknown as Record<string, unknown>,
		};
	},
};
