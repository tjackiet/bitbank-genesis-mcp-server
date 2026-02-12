#!/usr/bin/env tsx
import renderChartSvg from './render_chart_svg.js';
import { parseArgs, intArg } from './lib/cli-utils.js';
import type { RenderChartSvgOptions, ChartStyle, BbMode, IchimokuMode, Pair } from '../src/types/domain.d.ts';

async function main() {
	const { positional, flags } = parseArgs();

	const pair = (positional[0] || 'btc_jpy') as Pair;
	const type = positional[1] || '1day';
	const limit = intArg(positional[2], 60);

	const withIchimoku = flags['with-ichimoku'] === true;
	const noSma = flags['no-sma'] === true;
	const noBb = flags['no-bb'] === true;
	const smaOnly = flags['sma-only'] === true;
	const bbOnly = flags['bb-only'] === true;
	const ichimokuOnly = flags['ichimoku-only'] === true;
	const candlesOnly = flags['candles-only'] === true;

	// forceLayers / depth は型定義外だが render_chart_svg が内部で参照する
	const options: RenderChartSvgOptions & Record<string, unknown> = {
		pair,
		type,
		limit,
		// 既定はロウソクのみ（インジケータは明示されたときだけ）
		withSMA: noSma ? [] : [],
		withBB: false,
		withIchimoku,
	};

	// Heuristic override flags
	if (flags['force-layers'] === true || flags['no-auto-lighten'] === true) {
		options.forceLayers = true;
	}

	if (typeof flags['ichimoku-mode'] === 'string') {
		options.ichimoku = { mode: flags['ichimoku-mode'] as IchimokuMode };
		options.withIchimoku = true;
	}

	// Style: --style=candles|line|depth
	if (typeof flags.style === 'string') {
		const style = flags.style;
		if (style === 'candles' || style === 'line' || style === 'depth') {
			options.style = style as ChartStyle;
		}
	}

	// Depth options: --depth-levels=200
	if (typeof flags['depth-levels'] === 'string') {
		const levels = parseInt(flags['depth-levels'], 10);
		if (Number.isFinite(levels)) {
			options.depth = { levels };
		}
	}

	// BollingerBands モード: --bb-mode=default|extended（後方互換で light/full も受け付け）
	if (typeof flags['bb-mode'] === 'string') {
		const bbMode = flags['bb-mode'];
		const normalized = bbMode === 'light' ? 'default' : bbMode === 'full' ? 'extended' : bbMode;
		if (normalized === 'default' || normalized === 'extended') {
			options.bbMode = normalized as BbMode;
		}
	}

	if (typeof flags.sma === 'string' && flags.sma.length > 0) {
		const periods = flags.sma
			.split(',')
			.map((v) => parseInt(v.trim(), 10))
			.filter((n) => Number.isFinite(n) && n > 0);
		if (periods.length > 0) {
			options.withSMA = periods;
		}
	}

	// --- 単独表示フラグの処理 ---
	if (smaOnly) {
		options.withBB = false;
		options.withIchimoku = false;
	}
	if (bbOnly) {
		options.withBB = true;
		options.withSMA = [];
		options.withIchimoku = false;
	}
	if (ichimokuOnly) {
		options.withIchimoku = true;
		options.withBB = false;
		options.withSMA = [];
		if (!options.ichimoku) options.ichimoku = { mode: 'default' };
	}
	if (candlesOnly) {
		options.withBB = false;
		options.withSMA = [];
		options.withIchimoku = false;
	}

	// --- 自動判定 ---
	const hasSmaFlag = typeof flags.sma === 'string';
	const hasBbMode = typeof flags['bb-mode'] === 'string';
	if (options.withIchimoku) {
		options.withBB = false;
		options.withSMA = [];
	} else if (hasBbMode) {
		if (!hasSmaFlag && !noSma) {
			options.withSMA = [];
		}
		options.withBB = true;
	} else if (hasSmaFlag && !noBb) {
		options.withBB = false;
	}

	const result = await renderChartSvg(options);
	if (result.ok) {
		const data = result.data as Record<string, unknown>;
		if (data.filePath) {
			console.error(`Chart saved to ${data.filePath}`);
		}
		console.log(data.svg);
	} else {
		console.error('Failed to generate chart:', result.summary);
		process.exit(1);
	}
}

main();
