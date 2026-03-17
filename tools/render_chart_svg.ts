// tools/render_chart_svg.ts
/**
 * Render chart as SVG or save to file depending on options.
 *
 * ## ボリンジャーバンド (BB)
 * - default : ±2σ のみ描画（軽量版）
 * - extended: ±1σ, ±2σ, ±3σ を描画（完全版）
 * - CLI: `--bb-mode=default|extended`、`--no-bb` で無効化
 * - 後方互換: `--bb-mode=light` → default、`--bb-mode=full` → extended
 *
 * ## 一目均衡表 (Ichimoku)
 * - default : 転換線・基準線・雲（先行スパン A/B）
 * - extended: 上記＋遅行スパン
 * - CLI: `--with-ichimoku --ichimoku-mode=default|extended`
 * - 指定なしの場合はオフ
 *
 * ## SMA
 * - デフォルトでは描画しない
 * - CLI: `--sma=5,20,50` のように明示指定した場合のみ描画
 * - 利用可能な期間: 5, 20, 25, 50, 75, 200
 *
 * @returns Result<
 *   { svg?: string | null; filePath?: string | null; legend?: Record<string,string> },
 *   { pair: string; type: string; limit?: number; indicators?: string[]; bbMode: 'default'|'extended'; range?: {start:string; end:string}; sizeBytes?: number; layerCount?: number; truncated?: boolean; }>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { dayjs } from '../lib/datetime.js';
import { getErrorMessage } from '../lib/error.js';
import { formatPair } from '../lib/formatter.js';
import getDepth from '../lib/get-depth.js';
import { fail, ok } from '../lib/result.js';
import type { CandleType, ChartPayload, Pair, RenderChartSvgOptions, Result } from '../src/schemas.js';
import analyzeIndicators from './analyze_indicators.js';

/** Internal options extending the public schema with undocumented/debug properties */
type RenderChartSvgInternalOpts = RenderChartSvgOptions & {
	debug?: boolean;
	forceLayers?: boolean;
	noAutoLighten?: boolean;
};

type RenderData = { svg?: string; filePath?: string; legend?: Record<string, string> };
type RenderMeta = {
	pair: Pair;
	type: CandleType | string;
	limit?: number;
	indicators?: string[];
	bbMode: 'default' | 'extended';
	range?: { start: string; end: string };
	sizeBytes?: number;
	layerCount?: number;
	truncated?: boolean;
	fallback?: string;
	warnings?: string[];
	debug?: Record<string, unknown>;
};

export default async function renderChartSvg(
	args: RenderChartSvgInternalOpts = {},
): Promise<Result<RenderData, RenderMeta>> {
	// --- パラメータの解決（強制排他ルール） ---
	const style = (args.style === 'line' ? 'line' : 'candles') as 'candles' | 'line';
	// depth は特別扱い（ローソクを描かない）
	const isDepth = args.style === 'depth';
	let withIchimoku = args.withIchimoku ?? false;
	const ichimokuOpt = args.ichimoku || {};
	// モード正規化: light→default, full→extended（後方互換）
	const normalizeIchimokuMode = (m: unknown): 'default' | 'extended' => {
		const s = String(m ?? '').toLowerCase();
		if (s === 'full' || s === 'extended') return 'extended';
		if (s === 'light' || s === 'default') return 'default';
		return 'default';
	};
	const ichimokuMode = normalizeIchimokuMode(ichimokuOpt.mode || (withIchimoku ? 'default' : 'default'));
	const drawChikou = ichimokuMode === 'extended' || ichimokuOpt.withChikou === true;

	// デフォルト: 明示されない限りSMAは描画しない
	// 互換: 以前の仕様からの流入に備え、withIchimoku時は引き続きBB/SMAをオフ
	let withSMA = args.withSMA ?? [];
	let withEMA = args.withEMA ?? [];
	let withBB = args.withBB ?? false;
	const svgPrecision = Math.max(0, Math.min(3, Number(args.svgPrecision ?? 1)));
	const effectivePrecision = Math.max(1, svgPrecision);
	const svgMinify = args.svgMinify !== false;
	const simplifyTolerance = Math.max(0, Number(args.simplifyTolerance ?? 0.5));
	const viewBoxTight = args.viewBoxTight !== false;
	// BBモード正規化: light→default, full→extended（後方互換）
	const normalizeBbMode = (m: unknown): 'default' | 'extended' => {
		const s = String(m ?? '').toLowerCase();
		if (s === 'full' || s === 'extended') return 'extended';
		if (s === 'light' || s === 'default') return 'default';
		return 'default';
	};
	const bbMode: 'default' | 'extended' = normalizeBbMode(args.bbMode || 'default');
	if (withIchimoku) {
		withSMA = [];
		withEMA = [];
		withBB = false;
	}

	const {
		pair = 'btc_jpy',
		// normalize to CandleType-like values (historically 'day' was used)
		type = '1day',
		limit = 60,
		withLegend = true,
		overlays,
		tz = 'Asia/Tokyo',
	} = args;
	const debugEnabled = Boolean(args.debug);
	const debugInfo: Record<string, unknown[]> = debugEnabled ? { notes: [] } : {};
	const forceLayers = args.forceLayers === true || args.noAutoLighten === true;

	// Sub-panel configuration
	const subPanelTypes: Array<'macd' | 'rsi' | 'volume'> = ((args.subPanels || []) as string[]).filter(
		(t): t is 'macd' | 'rsi' | 'volume' => ['macd', 'rsi', 'volume'].includes(t),
	);
	const SUB_PANEL_HEIGHT = 120;
	const SUB_PANEL_GAP = 24;

	// === Depth チャート（独立描画） ===
	if (isDepth) {
		try {
			const depth = await getDepth(pair, { maxLevels: args.depth?.levels ?? 200 });
			if (!depth.ok) return fail(depth.summary.replace(/^Error: /, ''), depth.meta?.errorType || 'internal');
			const asks: Array<[string, string]> = depth.data.asks || [];
			const bids: Array<[string, string]> = depth.data.bids || [];
			// 価格レンジ
			const minBid = Number(bids[bids.length - 1]?.[0] ?? bids[0]?.[0] ?? 0);
			const maxAsk = Number(asks[asks.length - 1]?.[0] ?? asks[0]?.[0] ?? 0);
			const xMinP = Math.min(minBid, Number(bids[0]?.[0] ?? minBid));
			const xMaxP = Math.max(maxAsk, Number(asks[0]?.[0] ?? maxAsk));
			// 累積量（左：bids 降順→小へ、右：asks 昇順→大へ）
			const bidsSorted = [...bids]
				.map(([p, s]) => [Number(p), Number(s)] as [number, number])
				.sort((a, b) => b[0] - a[0]);
			const asksSorted = [...asks]
				.map(([p, s]) => [Number(p), Number(s)] as [number, number])
				.sort((a, b) => a[0] - b[0]);
			let cum = 0;
			const bidSteps: Array<[number, number]> = [];
			for (const [p, s] of bidsSorted) {
				cum += s;
				bidSteps.push([p, cum]);
			}
			cum = 0;
			const askSteps: Array<[number, number]> = [];
			for (const [p, s] of asksSorted) {
				cum += s;
				askSteps.push([p, cum]);
			}
			const maxQty = Math.max(bidSteps.at(-1)?.[1] || 0, askSteps.at(-1)?.[1] || 0) || 1;

			// キャンバス
			const w = 860,
				h = 420;
			const padding = { top: 36, right: 12, bottom: 32, left: 64 };
			const plotW = w - padding.left - padding.right;
			const plotH = h - padding.top - padding.bottom;
			const x = (price: number) =>
				Number((padding.left + ((price - xMinP) * plotW) / Math.max(1, xMaxP - xMinP)).toFixed(effectivePrecision));
			const y = (qty: number) => Number((h - padding.bottom - (qty * plotH) / maxQty).toFixed(effectivePrecision));

			// ステップパス生成
			const toStepPath = (steps: Array<[number, number]>) => {
				if (!steps.length) return '';
				const pts = steps.map(([p, q]) => `${x(p)},${y(q)}`);
				return `M ${pts.join(' L ')}`;
			};
			const bidPath = toStepPath(bidSteps);
			const askPath = toStepPath(askSteps);

			// 塗りつぶし（ステップ下を半透明で）
			const toFillPath = (steps: Array<[number, number]>, side: 'bid' | 'ask') => {
				if (!steps.length) return '';
				const head = steps[0];
				const tail = steps[steps.length - 1];
				const baseY = y(0);
				const poly = ['M', `${x(head[0])},${baseY}`, 'L']
					.concat(steps.map(([p, q]) => `${x(p)},${y(q)}`))
					.concat(['L', `${x(tail[0])},${baseY}`, 'Z'])
					.join(' ');
				const fill = side === 'bid' ? 'rgba(16,185,129,0.12)' : 'rgba(249,115,22,0.12)';
				return `<path d="${poly}" fill="${fill}" stroke="none"/>`;
			};
			const bidFill = toFillPath(bidSteps, 'bid');
			const askFill = toFillPath(askSteps, 'ask');

			const mid = (Number(bids[0]?.[0] ?? 0) + Number(asks[0]?.[0] ?? 0)) / 2;
			const yAxis = `
        <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${h - padding.bottom}" stroke="#4b5563" stroke-width="1"/>
      `;
			const xAxis = `
        <line x1="${padding.left}" y1="${h - padding.bottom}" x2="${w - padding.right}" y2="${h - padding.bottom}" stroke="#4b5563" stroke-width="1"/>
      `;
			const legendDepth = `
        <g font-size="12" fill="#e5e7eb" transform="translate(${padding.left}, ${Math.max(14, padding.top - 18)})">
          <rect x="0" y="-10" width="12" height="12" fill="#10b981"></rect>
          <text x="16" y="0">買い (Bids)</text>
          <rect x="120" y="-10" width="12" height="12" fill="#f97316"></rect>
          <text x="136" y="0">売り (Asks)</text>
        </g>`;

			const svg = `
      <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" style="background-color:#1f2937;color:#e5e7eb;font-family:sans-serif;max-width:100%;height:auto;">
        <title>${formatPair(pair)} depth chart</title>
        ${legendDepth}
        <g class="axes">${yAxis}${xAxis}</g>
        <g class="plot-area">
          ${bidFill}
          ${askFill}
          <path d="${bidPath}" fill="none" stroke="#10b981" stroke-width="2"/>
          <path d="${askPath}" fill="none" stroke="#f97316" stroke-width="2"/>
          <line x1="${x(mid)}" y1="${padding.top}" x2="${x(mid)}" y2="${h - padding.bottom}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="4 4"/>
        </g>
      </svg>`;
			const assetsDir = path.join(process.cwd(), 'assets');
			await fs.mkdir(assetsDir, { recursive: true });
			const outputPath = path.join(assetsDir, `depth-${pair}-${Date.now()}.svg`);
			await fs.writeFile(outputPath, svg);
			// Note: meta.type should reflect timeframe for schema compatibility (not 'depth')
			const metaOut: RenderMeta = {
				pair: pair as Pair,
				type: String(args.type || '1day'),
				bbMode: 'default',
			};
			return ok<RenderData, RenderMeta>(
				`${formatPair(pair)} depth chart saved to ${outputPath}`,
				{ filePath: outputPath, svg },
				metaOut,
			);
		} catch (e: unknown) {
			return fail(getErrorMessage(e) || 'failed to render depth', 'internal');
		}
	}

	// --- 事前見積もりヒューリスティクス（重そうなら candles-only にフォールバック） ---
	const estimatedLayers =
		(withIchimoku ? 1 : 0) +
		(withBB ? (bbMode === 'extended' ? 3 : 1) : 0) +
		(Array.isArray(withSMA) ? withSMA.length : 0) +
		(Array.isArray(withEMA) ? withEMA.length : 0) +
		1; // +1 for base series
	const summaryNotes: string[] = [];
	if (!forceLayers && limit * estimatedLayers > 500) {
		if (withBB || (withSMA && withSMA.length > 0) || (withEMA && withEMA.length > 0) || withIchimoku) {
			withBB = false;
			withSMA = [];
			withEMA = [];
			if (withIchimoku) {
				// keep user intent for ichimoku unless very heavy
				if (limit * (1 + (bbMode === 'extended' ? 3 : 1)) > 800) {
					// fallback to candles only if still heavy
					withIchimoku = false;
					args.withIchimoku = false;
				}
			}
			summaryNotes.push('heavy chart detected → fallback to candles-only to avoid oversized SVG');
		}
	}

	// ★ データ取得はバッファ計算をgetIndicatorsに任せる
	// 一目均衡表の雲を適切に表示するには limit >= 60 が必要（先行スパンB: 52期間 + シフト: 26日）
	const ICHIMOKU_MIN_LIMIT_FOR_CLOUD = 60;
	const warnings: string[] = [];

	// 一目均衡表使用時に limit が小さすぎる場合は自動調整
	let effectiveLimit = limit;
	if (withIchimoku && limit < ICHIMOKU_MIN_LIMIT_FOR_CLOUD) {
		effectiveLimit = ICHIMOKU_MIN_LIMIT_FOR_CLOUD;
		summaryNotes.push(`一目均衡表の雲表示のため limit を ${limit} → ${effectiveLimit} に自動調整`);
	}

	const internalLimit = withIchimoku ? effectiveLimit + 26 : effectiveLimit;
	const res = await analyzeIndicators(pair, type, internalLimit);
	if (!res?.ok) {
		return fail(
			res?.summary?.replace?.(/^Error: /, '') || 'failed to fetch indicators',
			res?.meta?.errorType || 'internal',
		);
	}

	const chartData = res.data?.chart as ChartPayload;
	const items = chartData?.candles || [];
	const indicators = chartData?.indicators;
	/** Safe dynamic indicator access by key (for EMA_${p}, BB${n}_upper, etc.) */
	const indicatorSeries = (key: string): Array<number | null> | undefined =>
		(indicators as Record<string, unknown>)[key] as Array<number | null> | undefined;
	const pastBuffer = chartData.meta?.pastBuffer ?? 0;
	const forwardShiftMeta = chartData.meta?.shift ?? 0;
	// 一目を描画しない場合は forwardShift を 0 にする（間隔が詰まるのを防ぐ）
	const forwardShift = withIchimoku ? forwardShiftMeta : 0;
	const displayItems = items.slice(pastBuffer);

	if (!items?.length) {
		return fail('No candle data available to render SVG chart.', 'user');
	}

	// 一目均衡表の雲（spanA/spanB）が十分なデータを持っているかチェック
	if (withIchimoku) {
		const spanA = indicators?.ICHI_spanA as Array<number | null> | undefined;
		const spanB = indicators?.ICHI_spanB as Array<number | null> | undefined;
		const spanAValidCount = spanA?.filter((v) => v !== null)?.length ?? 0;
		const spanBValidCount = spanB?.filter((v) => v !== null)?.length ?? 0;

		if (spanBValidCount === 0) {
			warnings.push('先行スパンBのデータが不足しています。雲が描画されません。');
		} else if (spanAValidCount < effectiveLimit || spanBValidCount < effectiveLimit) {
			const cloudCoverage = Math.min(spanAValidCount, spanBValidCount);
			const coveragePct = Math.round((cloudCoverage / effectiveLimit) * 100);
			if (coveragePct < 80) {
				warnings.push(`雲のカバー率: ${coveragePct}%（${cloudCoverage}/${effectiveLimit}本）。`);
			}
		}
	}

	// Y軸スケール用の "きれいな" 目盛りを生成する関数
	function niceTicks(min: number, max: number, count = 5): number[] {
		if (max < min) [min, max] = [max, min];
		const range = max - min;
		if (range === 0) return [min];

		// stepが極小値になるのを防ぐ
		const step = Math.max(1e-9, 10 ** Math.floor(Math.log10(range / count)));
		const err = (count * step) / range;

		let niceStep: number;
		if (err <= 0.15) niceStep = step * 10;
		else if (err <= 0.35) niceStep = step * 5;
		else if (err <= 0.75) niceStep = step * 2;
		else niceStep = step;

		// JSの浮動小数点誤差を吸収するため、toFixedで丸める
		const precision = Math.max(0, -Math.floor(Math.log10(niceStep)));
		const niceMin = Math.round(min / niceStep) * niceStep;
		const ticks: number[] = [];
		// 無限ループ対策
		for (let v = niceMin; ticks.length < 20 && v <= max * 1.01; v += niceStep) {
			ticks.push(Number(v.toFixed(precision)));
		}

		return ticks;
	}

	// Y軸ラベルの省略表示フォーマッタ
	const isJpyPair = pair.toLowerCase().includes('jpy');
	const formatYLabel = (val: number): string => {
		const abs = Math.abs(val);
		const prefix = isJpyPair ? '¥' : '';
		if (abs >= 1_000_000_000) return `${prefix}${(val / 1_000_000_000).toFixed(1)}B`;
		if (abs >= 1_000_000) return `${prefix}${(val / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
		if (abs >= 10_000) return `${prefix}${(val / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
		if (abs >= 1_000) return `${prefix}${val.toLocaleString()}`;
		return `${prefix}${val}`;
	};

	const xs = displayItems.map((_, i) => i);
	const highs = displayItems.map((d) => d.high as number);
	const lows = displayItems.map((d) => d.low as number);
	const _xMin = 0;
	const _xMax = xs.length - 1;
	// forwardShift は上部で meta.shift から取得済み

	// Y軸の範囲を、表示されるすべての要素から計算
	const allYValues: number[] = [...highs, ...lows];
	if (withIchimoku) {
		allYValues.push(...(indicators.ICHI_tenkan?.slice(pastBuffer).filter((v: number | null) => v !== null) || []));
		allYValues.push(...(indicators.ICHI_kijun?.slice(pastBuffer).filter((v: number | null) => v !== null) || []));
		allYValues.push(...(indicators.ICHI_spanA?.slice(pastBuffer).filter((v: number | null) => v !== null) || []));
		allYValues.push(...(indicators.ICHI_spanB?.slice(pastBuffer).filter((v: number | null) => v !== null) || []));
	}
	if (withBB) {
		if (bbMode === 'extended') {
			['BB1_upper', 'BB1_lower', 'BB2_upper', 'BB2_lower', 'BB3_upper', 'BB3_lower'].forEach((key) => {
				const series = indicatorSeries(key)?.slice(pastBuffer) || [];
				allYValues.push(...series.filter((v: number | null) => v !== null));
			});
		} else {
			allYValues.push(...(indicators.BB_upper?.slice(pastBuffer).filter((v: number | null) => v !== null) || []));
			allYValues.push(...(indicators.BB_lower?.slice(pastBuffer).filter((v: number | null) => v !== null) || []));
		}
	}
	if (withSMA && withSMA.length > 0) {
		const pickSmaSeries = (p: number) => {
			switch (p) {
				case 5:
					return indicators.SMA_5 as number[] | undefined;
				case 20:
					return indicators.SMA_20 as number[] | undefined;
				case 25:
					return indicators.SMA_25 as number[] | undefined;
				case 50:
					return indicators.SMA_50 as number[] | undefined;
				case 75:
					return indicators.SMA_75 as number[] | undefined;
				case 200:
					return indicators.SMA_200 as number[] | undefined;
				default:
					return undefined;
			}
		};
		withSMA.forEach((period) => {
			const series = pickSmaSeries(period) || [];
			allYValues.push(...series.slice(pastBuffer).filter((v: number | null) => v !== null));
		});
	}
	if (withEMA && withEMA.length > 0) {
		const pickEmaSeries = (p: number) => {
			switch (p) {
				case 12:
					return indicators.EMA_12 as number[] | undefined;
				case 26:
					return indicators.EMA_26 as number[] | undefined;
				case 50:
					return indicators.EMA_50 as number[] | undefined;
				case 200:
					return indicators.EMA_200 as number[] | undefined;
				default:
					return indicatorSeries(`EMA_${p}`) as number[] | undefined;
			}
		};
		withEMA.forEach((period: number) => {
			const series = pickEmaSeries(period) || [];
			allYValues.push(...series.slice(pastBuffer).filter((v: number | null) => v !== null));
		});
	}

	const dataYMin = Math.min(...allYValues);
	const dataYMax = Math.max(...allYValues);
	const yPad = Math.min(0.2, Math.max(0, Number(args.yPaddingPct ?? 0.06)));
	const yRange = dataYMax - dataYMin;
	// クリップ回避用の安全ヘッドルーム（レンジの2%）
	const autoHeadroom = yRange * 0.02;
	// データレンジに対する相対パディング（値幅に比例してタイトに描画）
	const yAxisMinWithBuffer = yRange > 0 ? dataYMin - yRange * yPad : dataYMin * (1 - yPad);
	const yAxisMaxTarget = yRange > 0 ? dataYMax + yRange * yPad + autoHeadroom : dataYMax * (1 + yPad) + autoHeadroom;
	const yTicks = niceTicks(yAxisMinWithBuffer, yAxisMaxTarget, 6);
	const yMin = yTicks[0];
	const yMax = yTicks.at(-1) as number;

	// Y軸ラベルの最大幅に基づいてpadding.leftを動的に調整
	const maxLabelWidth = Math.max(...yTicks.map((v) => formatYLabel(v).length));
	const dynamicPaddingLeft = maxLabelWidth * 8 + 16; // 1文字8pxと仮定 + 余白

	// スケール計算
	const w = 860;
	const h = 420;
	// 上部に余白を多めに確保（凡例が詰まらないように）
	const padding = viewBoxTight
		? { top: 36, right: 12, bottom: 32, left: dynamicPaddingLeft }
		: { top: 48, right: 16, bottom: 40, left: dynamicPaddingLeft };
	const plotW = w - padding.left - padding.right;
	const plotH = h - padding.top - padding.bottom;

	// Dynamic total height: price panel + sub-panels
	const subPanelsTotalH =
		subPanelTypes.length > 0 ? subPanelTypes.length * SUB_PANEL_HEIGHT + subPanelTypes.length * SUB_PANEL_GAP : 0;
	const totalH = h + subPanelsTotalH;
	const xAxisBottom = totalH - padding.bottom;

	// X座標計算: 描画ウィンドウ内での相対位置を計算
	// Xはバー中心を(i+0.5)に置き、左右に半スロットの余白を確保して端の切れを防ぐ
	const totalSlots = Math.max(1, xs.length + forwardShift);
	const x = (i: number) => Number((padding.left + ((i + 0.5) * plotW) / totalSlots).toFixed(effectivePrecision));
	const y = (v: number) =>
		Number((h - padding.bottom - ((v - yMin) * plotH) / Math.max(1, yMax - yMin)).toFixed(effectivePrecision));

	// --- 凡例メタデータと描画レイヤーの準備 ---
	const legendMeta: Record<string, string> = {};
	let legendLayers = '';

	// 自動調整: 未指定時は本数に応じて隙間が過剰/不足にならないよう最適化
	let barWidthRatio = Number(args.barWidthRatio);
	if (!Number.isFinite(barWidthRatio)) {
		const n = xs.length;
		if (n <= 30)
			barWidthRatio = 0.55; // 少本数 → やや細め（間延び防止）
		else if (n <= 45) barWidthRatio = 0.6;
		else if (n <= 60) barWidthRatio = 0.65;
		else barWidthRatio = 0.7; // 多本数 → やや太め（隙間詰め）
	}
	barWidthRatio = Math.min(0.9, Math.max(0.1, barWidthRatio));
	const barW = Math.max(2, (plotW / Math.max(1, xs.length)) * barWidthRatio);

	// ローソク（棒＋ヒゲ） or 折れ線
	let sticks = '';
	let bodies = '';
	let priceLine = '';
	let wantPriceLine = false;
	if (style === 'candles') {
		sticks = displayItems
			.map((d, i: number) => {
				const cx = x(i);
				return `<line x1="${cx}" y1="${y(d.high)}" x2="${cx}" y2="${y(d.low)}" class="w"/>`;
			})
			.join('');
		bodies = displayItems
			.map((d, i: number) => {
				const cx = x(i) - barW / 2;
				const o = y(d.open);
				const c = y(d.close);
				const top = Math.min(o, c);
				const bot = Math.max(o, c);
				const up = d.close >= d.open;
				return `<rect x="${Number(cx.toFixed(effectivePrecision))}" y="${Number(top.toFixed(effectivePrecision))}" width="${Number(barW.toFixed(effectivePrecision))}" height="${Number(Math.max(1, bot - top).toFixed(effectivePrecision))}" class="${up ? 'u' : 'd'}"/>`;
			})
			.join('');
	} else if (style === 'line') {
		// style === 'line' → 終値の折れ線（描画はヘルパー定義後に実施）
		wantPriceLine = true;
	} else if (style === 'depth') {
		// depth は価格系列の描画を行わず、後段の overlays/axes のみ使用
	}

	// --- インジケータ描画 ---
	const smaColors: Record<number, string> = {
		5: '#f472b6',
		20: '#a78bfa',
		25: '#3b82f6',
		50: '#22d3ee',
		75: '#f59e0b',
		200: '#10b981',
	};
	const bbColors = {
		bandFill2: 'rgba(59, 130, 246, 0.10)', // 2σバンド塗り
		line1: '#9ca3af', // ±1σ
		line2: '#3b82f6', // ±2σ
		line3: '#f59e0b', // ±3σ
		middle: '#9ca3af',
	} as const;

	// 汎用的なライン描画関数
	const round = (v: number) => Number(v.toFixed(svgPrecision));

	// 共通の RDP 風ポイント簡略化ヘルパー
	type Pt = { x: number; y: number };
	const simplifyPts = (raw: Pt[]): Pt[] => {
		if (simplifyTolerance <= 0 || raw.length <= 2) return raw;
		const sqTol = simplifyTolerance * simplifyTolerance;
		const simplified: Pt[] = [raw[0]];
		for (let i = 1; i < raw.length - 1; i++) {
			const a = raw[i - 1],
				b = raw[i],
				c = raw[i + 1];
			const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
			const dx = c.x - a.x;
			const dy = c.y - a.y;
			const len2 = dx * dx + dy * dy || 1;
			if ((area * area) / len2 >= sqTol) simplified.push(b);
		}
		simplified.push(raw[raw.length - 1]);
		return simplified;
	};

	const createLinePath = (
		data: Array<number | null> | undefined,
		color: string,
		options: { dash?: string; width?: string; offset?: number; simplify?: boolean } = {},
	) => {
		if (!data || data.length === 0) return '';
		let raw: Pt[] = [];
		const offset = options.offset || 0; // 先行(+26) / 遅行(-26)
		let skipped = 0;
		data.forEach((val, i) => {
			if (val !== null && typeof val === 'number') {
				const posIndex = i - pastBuffer + offset;
				// 極端に描画領域外になる点はスキップしてパス破綻を防ぐ
				if (posIndex < -1 || posIndex > xs.length + forwardShift + 1) {
					skipped++;
					return;
				}
				raw.push({ x: x(posIndex), y: y(val) });
			}
		});
		if (raw.length === 0) return '';
		// RDP風の単純化
		if (options.simplify !== false) {
			raw = simplifyPts(raw);
		}
		const points = raw.map((p) => `${round(p.x)},${round(p.y)}`);
		const d = `M ${points.join(' L ')}`;
		const dash = options.dash ? `stroke-dasharray="${options.dash}"` : '';
		const width = options.width || '2';
		if (debugEnabled) {
			if (!debugInfo.paths) debugInfo.paths = [];
			debugInfo.paths.push({ color, count: raw.length, skipped });
		}
		return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" ${dash}/>`;
	};

	// 折れ線（終値）を必要に応じて描画
	if (wantPriceLine) {
		const closesFull: Array<number | null> = items.map((d) => (typeof d.close === 'number' ? d.close : null));
		priceLine = createLinePath(closesFull, '#60a5fa', { width: '1.5', simplify: true, offset: 0 });
	}

	// --- 型安全なインジケータ参照ヘルパー ---
	const bbSeries = {
		getUpper: (mode: 'default' | 'extended') => (mode === 'extended' ? indicators?.BB2_upper : indicators?.BB_upper),
		getMiddle: (mode: 'default' | 'extended') => (mode === 'extended' ? indicators?.BB2_middle : indicators?.BB_middle),
		getLower: (mode: 'default' | 'extended') => (mode === 'extended' ? indicators?.BB2_lower : indicators?.BB_lower),
		getBand: (sigma: 1 | 2 | 3) => {
			switch (sigma) {
				case 1:
					return { upper: indicators?.BB1_upper, middle: indicators?.BB1_middle, lower: indicators?.BB1_lower };
				case 2:
					return { upper: indicators?.BB2_upper, middle: indicators?.BB2_middle, lower: indicators?.BB2_lower };
				case 3:
					return { upper: indicators?.BB3_upper, middle: indicators?.BB3_middle, lower: indicators?.BB3_lower };
				default:
					return { upper: undefined, middle: undefined, lower: undefined };
			}
		},
	} as const;

	const ichiSeries = {
		tenkan: indicators?.ICHI_tenkan as Array<number | null> | undefined,
		kijun: indicators?.ICHI_kijun as Array<number | null> | undefined,
		spanA: indicators?.ICHI_spanA as Array<number | null> | undefined,
		spanB: indicators?.ICHI_spanB as Array<number | null> | undefined,
		chikou: indicators?.ICHI_chikou as Array<number | null> | undefined,
	} as const;

	// SMAレイヤー
	const sma5 = (indicators?.SMA_5 || []) as Array<number | null>;
	const sma20 = (indicators?.SMA_20 || []) as Array<number | null>;
	const sma25 = (indicators?.SMA_25 || []) as Array<number | null>;
	const sma50 = (indicators?.SMA_50 || []) as Array<number | null>;
	const sma75 = (indicators?.SMA_75 || []) as Array<number | null>;
	const sma200 = (indicators?.SMA_200 || []) as Array<number | null>;
	let smaLayers = '';
	// インジケーターは簡略化しない（見た目の忠実度を優先）
	if (withSMA?.includes(5) && sma5.length > 0) smaLayers += createLinePath(sma5, smaColors[5], { simplify: false });
	if (withSMA?.includes(20) && sma20.length > 0) smaLayers += createLinePath(sma20, smaColors[20], { simplify: false });
	if (withSMA?.includes(25) && sma25.length > 0) smaLayers += createLinePath(sma25, smaColors[25], { simplify: false });
	if (withSMA?.includes(50) && sma50.length > 0) smaLayers += createLinePath(sma50, smaColors[50], { simplify: false });
	if (withSMA?.includes(75) && sma75.length > 0) smaLayers += createLinePath(sma75, smaColors[75], { simplify: false });
	if (withSMA?.includes(200) && sma200.length > 0)
		smaLayers += createLinePath(sma200, smaColors[200], { simplify: false });

	// EMAレイヤー（SMAと区別するため暖色系・破線）
	const emaColors: Record<number, string> = { 12: '#ff6b35', 26: '#ffd166', 50: '#ef476f', 200: '#06d6a0' };
	let emaLayers = '';
	if (withEMA && withEMA.length > 0) {
		const pickEmaSeries = (p: number) => {
			switch (p) {
				case 12:
					return indicators.EMA_12 as number[] | undefined;
				case 26:
					return indicators.EMA_26 as number[] | undefined;
				case 50:
					return indicators.EMA_50 as number[] | undefined;
				case 200:
					return indicators.EMA_200 as number[] | undefined;
				default:
					return indicatorSeries(`EMA_${p}`) as number[] | undefined;
			}
		};
		for (const period of withEMA) {
			const series = (pickEmaSeries(period) || []) as Array<number | null>;
			if (series.length > 0) {
				const color = emaColors[period] || '#ff9f1c';
				emaLayers += createLinePath(series, color, { simplify: false, dash: '6,3' });
			}
		}
	}

	// ボリンジャーバンド
	let bbLayers = '';
	if (withBB) {
		const createBBPoints = (data?: Array<number | null>): Pt[] => {
			const points: Pt[] = [];
			let skipped = 0;
			data?.forEach?.((val, i) => {
				if (val !== null && val !== undefined) {
					const posIndex = i - pastBuffer;
					if (posIndex < -1 || posIndex > xs.length + forwardShift + 1) {
						skipped++;
						return;
					}
					points.push({ x: x(posIndex), y: y(val) });
				}
			});
			if (debugEnabled) {
				if (!debugInfo.bb) debugInfo.bb = [];
				debugInfo.bb.push({ count: points.length, skipped });
			}
			return points;
		};
		const createPathFromPoints = (points?: Pt[]): string => {
			if (!points || points.length === 0) return '';
			return `M ${points.map((p) => `${round(p.x)},${round(p.y)}`).join(' L ')}`;
		};

		const makeBand = (upperSeries?: Array<number | null>, lowerSeries?: Array<number | null>) => {
			const upperPoints = createBBPoints(upperSeries);
			const lowerPoints = createBBPoints(lowerSeries);
			const upperPath = createPathFromPoints(upperPoints);
			const lowerPath = createPathFromPoints(lowerPoints);
			let bandPath = '';
			if (upperPoints.length > 0 && lowerPoints.length > 0) {
				const lowerPointsReversed = [...lowerPoints].reverse();
				const allPoints = [...upperPoints, ...lowerPointsReversed];
				bandPath = `${createPathFromPoints(allPoints)} Z`;
			}
			return { upperPath, lowerPath, bandPath };
		};

		if (bbMode === 'extended') {
			// ±2σのバンド塗り
			const band2 = makeBand(bbSeries.getBand(2).upper, bbSeries.getBand(2).lower);
			bbLayers += `
        <path d="${band2.bandPath}" fill="${bbColors.bandFill2}" stroke="none" />
      `;
			// ±1σ ライン（グレー）
			const p1u = createPathFromPoints(createBBPoints(bbSeries.getBand(1).upper));
			const p1l = createPathFromPoints(createBBPoints(bbSeries.getBand(1).lower));
			bbLayers += `
        <path d="${p1u}" fill="none" stroke="${bbColors.line1}" stroke-width="1"/>
        <path d="${p1l}" fill="none" stroke="${bbColors.line1}" stroke-width="1"/>
      `;
			// ±2σ ライン（青） + 中央線（灰の破線）
			const p2u = createPathFromPoints(createBBPoints(bbSeries.getBand(2).upper));
			const p2m = createPathFromPoints(createBBPoints(bbSeries.getBand(2).middle));
			const p2l = createPathFromPoints(createBBPoints(bbSeries.getBand(2).lower));
			bbLayers += `
        <path d="${p2u}" fill="none" stroke="${bbColors.line2}" stroke-width="1"/>
        <path d="${p2l}" fill="none" stroke="${bbColors.line2}" stroke-width="1"/>
        <path d="${p2m}" fill="none" stroke="${bbColors.middle}" stroke-width="1" stroke-dasharray="4 4"/>
      `;
			// ±3σ ライン（オレンジ）
			const p3u = createPathFromPoints(createBBPoints(bbSeries.getBand(3).upper));
			const p3l = createPathFromPoints(createBBPoints(bbSeries.getBand(3).lower));
			bbLayers += `
        <path d="${p3u}" fill="none" stroke="${bbColors.line3}" stroke-width="1"/>
        <path d="${p3l}" fill="none" stroke="${bbColors.line3}" stroke-width="1"/>
      `;
		} else {
			// light: 互換キー（±2σ）のみを使って従来描画
			const band2 = makeBand(bbSeries.getUpper('default'), bbSeries.getLower('default'));
			const mid2 = createPathFromPoints(createBBPoints(bbSeries.getMiddle('default')));
			bbLayers = `
        <path d="${band2.bandPath}" fill="${bbColors.bandFill2}" stroke="none" />
        <path d="${band2.upperPath}" fill="none" stroke="${bbColors.line2}" stroke-width="1"/>
        <path d="${band2.lowerPath}" fill="none" stroke="${bbColors.line2}" stroke-width="1"/>
        <path d="${mid2}" fill="none" stroke="${bbColors.middle}" stroke-width="1" stroke-dasharray="4 4"/>
      `;
		}
	}

	// 一目均衡表
	let ichimokuLayers = '';
	if (withIchimoku && ichiSeries.tenkan) {
		const tenkanPath = createLinePath(ichiSeries.tenkan, '#00a3ff', { width: '1', offset: 0 });
		const kijunPath = createLinePath(ichiSeries.kijun, '#ff4d4d', { width: '1', offset: 0 });
		const chikouPath = drawChikou
			? createLinePath(ichiSeries.chikou, '#16a34a', { width: '1', dash: '2 2', offset: -26 })
			: '';
		const spanAPath = createLinePath(ichiSeries.spanA, '#16a34a', { width: '1', offset: 26 });
		const spanBPath = createLinePath(ichiSeries.spanB, '#ef4444', { width: '1', offset: 26 });

		// 雲の描画（交点で色切替）
		// 描画領域外のポイントを除外してSVGサイズを削減
		const createCloudPaths = (spanA?: Array<number | null>, spanB?: Array<number | null>, offset?: number) => {
			let greenCloudPath = '';
			let redCloudPath = '';
			let currentTop: Array<{ x: number; y: number }> = [];
			let currentBottom: Array<{ x: number; y: number }> = [];
			let currentIsGreen: boolean | null = null;

			// 描画領域の範囲（少し余裕を持たせる）
			const minPosIndex = -1;
			const maxPosIndex = xs.length + forwardShift + 1;

			const pushPolygon = () => {
				if (currentTop.length < 2 || currentBottom.length < 2) return;
				const polygon = `M ${[...currentTop, ...currentBottom.slice().reverse()].map((p) => `${p.x},${p.y}`).join(' L ')} Z`;
				if (currentIsGreen) greenCloudPath += polygon;
				else redCloudPath += polygon;
			};

			const getPosIndex = (i: number) => i - pastBuffer + (offset || 0);
			const toPoint = (i: number, yVal: number) => ({ x: x(getPosIndex(i)), y: y(yVal) });

			const len = Math.max(spanA?.length || 0, spanB?.length || 0);
			for (let i = 0; i < len - 1; i++) {
				const a0 = spanA?.[i] as number | null;
				const b0 = spanB?.[i] as number | null;
				const a1 = spanA?.[i + 1] as number | null;
				const b1 = spanB?.[i + 1] as number | null;
				if (
					a0 == null ||
					b0 == null ||
					a1 == null ||
					b1 == null ||
					!Number.isFinite(a0) ||
					!Number.isFinite(b0) ||
					!Number.isFinite(a1) ||
					!Number.isFinite(b1)
				) {
					pushPolygon();
					currentTop = [];
					currentBottom = [];
					currentIsGreen = null;
					continue;
				}

				// 描画領域外のセグメントをスキップ（SVGサイズ削減）
				const posIndex0 = getPosIndex(i);
				const posIndex1 = getPosIndex(i + 1);
				if (posIndex1 < minPosIndex || posIndex0 > maxPosIndex) {
					// 完全に描画領域外 → スキップ
					pushPolygon();
					currentTop = [];
					currentBottom = [];
					currentIsGreen = null;
					continue;
				}

				const isGreen0 = a0 >= b0;
				const isGreen1 = a1 >= b1;
				if (currentIsGreen === null) {
					currentIsGreen = isGreen0;
					currentTop.push(toPoint(i, currentIsGreen ? a0 : b0));
					currentBottom.push(toPoint(i, currentIsGreen ? b0 : a0));
				}
				if (isGreen0 === isGreen1) {
					currentTop.push(toPoint(i + 1, currentIsGreen ? a1 : b1));
					currentBottom.push(toPoint(i + 1, currentIsGreen ? b1 : a1));
					continue;
				}
				const da = a1 - a0;
				const db = b1 - b0;
				const denom = da - db;
				const t = denom === 0 ? 0 : (a0 - b0) / denom;
				const tClamped = Math.max(0, Math.min(1, t));
				const xi = i + tClamped;
				const yi = a0 + tClamped * da;
				const pInt = toPoint(xi, yi);
				currentTop.push(pInt);
				currentBottom.push(pInt);
				pushPolygon();
				currentIsGreen = isGreen1;
				currentTop = [pInt, toPoint(i + 1, currentIsGreen ? a1 : b1)];
				currentBottom = [pInt, toPoint(i + 1, currentIsGreen ? b1 : a1)];
			}
			pushPolygon();
			return { greenCloudPath, redCloudPath };
		};

		const { greenCloudPath, redCloudPath } = createCloudPaths(ichiSeries.spanA, ichiSeries.spanB, 26);

		ichimokuLayers = `
      <path d="${greenCloudPath}" fill="rgba(16, 163, 74, 0.16)" stroke="none" />
      <path d="${redCloudPath}" fill="rgba(239, 68, 68, 0.24)" stroke="none" />
      ${tenkanPath}
      ${kijunPath}
      ${chikouPath}
      ${spanAPath}
      ${spanBPath}
    `;
	}

	// --- インジケータメタデータの構築（withLegend に依存しない） ---
	if (withSMA?.length > 0) {
		withSMA.forEach((p) => {
			legendMeta[`SMA_${p}`] = `SMA ${p} (${smaColors[p]})`;
		});
	}
	if (withEMA?.length > 0) {
		withEMA.forEach((p: number) => {
			legendMeta[`EMA_${p}`] = `EMA ${p} (${emaColors[p] || '#ff9f1c'})`;
		});
	}
	if (withBB) {
		if (bbMode === 'extended') {
			legendMeta.BB1 = 'BB ±1σ';
			legendMeta.BB2 = 'BB ±2σ';
			legendMeta.BB3 = 'BB ±3σ';
		} else {
			legendMeta.BB = 'Bollinger Bands (±2σ)';
		}
	}
	if (withIchimoku) {
		legendMeta.Ichimoku = '一目均衡表';
	}

	// --- 凡例の動的構築 ---
	if (withLegend) {
		const legendItems: Array<{ text: string; color: string }> = [];
		if (withSMA?.length > 0) {
			withSMA.forEach((p) => {
				legendItems.push({ text: `SMA ${p}`, color: smaColors[p] || '#e5e7eb' });
			});
		}
		if (withEMA?.length > 0) {
			withEMA.forEach((p: number) => {
				legendItems.push({ text: `EMA ${p}`, color: emaColors[p] || '#ff9f1c' });
			});
		}
		if (withBB) {
			if (bbMode === 'extended') {
				legendItems.push({ text: 'BB ±1σ', color: bbColors.line1 });
				legendItems.push({ text: 'BB ±2σ', color: bbColors.line2 });
				legendItems.push({ text: 'BB ±3σ', color: bbColors.line3 });
			} else {
				legendItems.push({ text: 'BB ±2σ', color: bbColors.line2 });
			}
		}
		if (withIchimoku) {
			legendItems.push({ text: '転換線', color: '#00a3ff' });
			legendItems.push({ text: '基準線', color: '#ff4d4d' });
		}

		const yOffset = Math.max(14, padding.top - 18);
		legendLayers =
			`<g font-size="12" fill="#e5e7eb">` +
			legendItems
				.map((item, i) => {
					const xPos = padding.left + i * 130;
					return `<g transform="translate(${xPos}, ${yOffset})">
        <rect y="-10" width="12" height="12" fill="${item.color}"></rect>
        <text x="16" y="0">${item.text}</text>
      </g>`;
				})
				.join('') +
			`</g>`;
	}

	// Y軸 (価格)
	const yAxis = `
    <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${h - padding.bottom}" stroke="#4b5563" stroke-width="1"/>
    <g font-size="12" fill="#9ca3af">
      ${yTicks
				.map((val) => {
					const yPos = y(val);
					return `<text x="${padding.left - 8}" y="${yPos}" text-anchor="end" dominant-baseline="middle">${formatYLabel(val)}</text>`;
				})
				.join('')}
    </g>
  `;

	// X軸 (日付) - timeframe に応じたフォーマットで表示
	// タイムゾーンを適用してdayjsインスタンスを生成
	const toDayjs = (d: { isoTime?: string | null; time?: string | number | null; timestamp?: string | number | null }) =>
		dayjs(d?.isoTime || d?.time || d?.timestamp).tz(tz);
	// 全データが同一日に収まるかを判定
	const firstDate = toDayjs(displayItems[0]);
	const lastDate = toDayjs(displayItems[displayItems.length - 1]);
	const isSameDay =
		firstDate.isValid() && lastDate.isValid() && firstDate.format('YYYYMMDD') === lastDate.format('YYYYMMDD');

	// timeframe に基づくフォーマット決定
	const formatXLabel = (d: ReturnType<typeof dayjs>): string => {
		const tf = String(type).toLowerCase();
		if (['1min', '5min', '15min', '30min'].includes(tf)) {
			return d.format('H:mm');
		}
		if (['1hour', '4hour'].includes(tf)) {
			return isSameDay ? d.format('H:mm') : d.format('M/D H:mm');
		}
		if (['8hour', '12hour', '1day'].includes(tf)) {
			return `${d.month() + 1}/${d.date()}`;
		}
		// 1week, 1month
		return d.format('YYYY/M/D');
	};

	const xAxis = `
    <line x1="${padding.left}" y1="${h - padding.bottom}" x2="${w - padding.right}" y2="${h - padding.bottom}" stroke="#4b5563" stroke-width="1"/>
    ${subPanelTypes.length > 0 ? `<line x1="${padding.left}" y1="${xAxisBottom}" x2="${w - padding.right}" y2="${xAxisBottom}" stroke="#4b5563" stroke-width="1"/>` : ''}
    <g font-size="12" fill="#9ca3af">
      ${displayItems
				.map((d, i: number) => {
					const step = Math.max(1, Math.floor(displayItems.length / 5));
					if (i % step !== 0) return '';
					const xPos = x(i);
					const date = toDayjs(d);
					if (!date.isValid()) return '';
					const label = formatXLabel(date);
					return `<text x="${xPos}" y="${xAxisBottom + 16}" text-anchor="middle" fill="#9ca3af" font-size="10">${label}</text>`;
				})
				.join('')}
    </g>
  `;

	// --- Sub-panel rendering ---
	let subPanelSvg = '';
	if (subPanelTypes.length > 0) {
		const pricePanelBottom = h - padding.bottom;
		let currentTop = pricePanelBottom + SUB_PANEL_GAP;

		const LEGEND_H = 18;
		const subPanelY = (v: number, min: number, max: number, top: number) => {
			const dataH = SUB_PANEL_HEIGHT - LEGEND_H;
			const range = Math.max(1e-10, max - min);
			return Number((top + SUB_PANEL_HEIGHT - ((v - min) * dataH) / range).toFixed(effectivePrecision));
		};

		for (const panelType of subPanelTypes) {
			const panelBottom = currentTop + SUB_PANEL_HEIGHT;
			let pc = '';
			// panel background + top border
			pc += `<rect x="${padding.left}" y="${currentTop}" width="${plotW}" height="${SUB_PANEL_HEIGHT}" fill="rgba(255,255,255,0.02)"/>`;
			pc += `<line x1="${padding.left}" y1="${currentTop}" x2="${w - padding.right}" y2="${currentTop}" stroke="#374151" stroke-width="0.5"/>`;

			if (panelType === 'macd') {
				const ms = indicators?.macd_series as { line?: number[]; signal?: number[]; hist?: number[] } | undefined;
				const mLine = (ms?.line || []) as Array<number | null>;
				const mSig = (ms?.signal || []) as Array<number | null>;
				const mHist = (ms?.hist || []) as Array<number | null>;
				const vals: number[] = [];
				for (const s of [mLine, mSig, mHist]) {
					const sliced = s.slice(pastBuffer);
					for (let i = 0; i < sliced.length; i++) {
						const v = sliced[i];
						if (v != null && i < displayItems.length) vals.push(v as number);
					}
				}
				if (vals.length > 0) {
					const mMin = Math.min(...vals);
					const mMax = Math.max(...vals);
					const pad = (mMax - mMin) * 0.1 || 1;
					const yMin = mMin - pad;
					const yMax = mMax + pad;
					const py = (v: number) => subPanelY(v, yMin, yMax, currentTop);

					// zero line
					if (yMin < 0 && yMax > 0) {
						pc += `<line x1="${padding.left}" y1="${py(0)}" x2="${w - padding.right}" y2="${py(0)}" stroke="#4b5563" stroke-width="0.5" stroke-dasharray="4 4"/>`;
					}
					// histogram bars
					const hBarW = Math.max(1, barW * 0.7);
					mHist.forEach((val, i) => {
						if (val == null) return;
						const idx = i - pastBuffer;
						if (idx < 0 || idx >= displayItems.length) return;
						const cx = x(idx);
						const topY = py(val as number);
						const zeroY = py(0);
						const color = (val as number) >= 0 ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)';
						pc += `<rect x="${Number((cx - hBarW / 2).toFixed(1))}" y="${Math.min(topY, zeroY)}" width="${Number(hBarW.toFixed(1))}" height="${Math.max(1, Math.abs(topY - zeroY))}" fill="${color}"/>`;
					});
					// MACD line
					const lPts: string[] = [];
					mLine.forEach((v, i) => {
						if (v != null) {
							const idx = i - pastBuffer;
							if (idx >= 0 && idx < displayItems.length) lPts.push(`${x(idx)},${py(v as number)}`);
						}
					});
					if (lPts.length > 1)
						pc += `<path d="M ${lPts.join(' L ')}" fill="none" stroke="#3b82f6" stroke-width="1.5"/>`;
					// Signal line
					const sPts: string[] = [];
					mSig.forEach((v, i) => {
						if (v != null) {
							const idx = i - pastBuffer;
							if (idx >= 0 && idx < displayItems.length) sPts.push(`${x(idx)},${py(v as number)}`);
						}
					});
					if (sPts.length > 1)
						pc += `<path d="M ${sPts.join(' L ')}" fill="none" stroke="#f97316" stroke-width="1.5"/>`;
					// Y-axis ticks
					const mt = niceTicks(yMin, yMax, 3);
					mt.forEach((v) => {
						pc += `<text x="${padding.left - 8}" y="${py(v)}" text-anchor="end" dominant-baseline="middle" fill="#9ca3af" font-size="10">${v.toFixed(0)}</text>`;
					});
				}
				pc += `<text x="${padding.left + 4}" y="${currentTop + 12}" fill="#9ca3af" font-size="10" font-weight="bold">MACD</text>`;
				// legend
				pc += `<line x1="${padding.left + 50}" y1="${currentTop + 8}" x2="${padding.left + 62}" y2="${currentTop + 8}" stroke="#3b82f6" stroke-width="1.5"/>`;
				pc += `<text x="${padding.left + 65}" y="${currentTop + 12}" fill="#9ca3af" font-size="9">MACD</text>`;
				pc += `<line x1="${padding.left + 100}" y1="${currentTop + 8}" x2="${padding.left + 112}" y2="${currentTop + 8}" stroke="#f97316" stroke-width="1.5"/>`;
				pc += `<text x="${padding.left + 115}" y="${currentTop + 12}" fill="#9ca3af" font-size="9">Signal</text>`;
			} else if (panelType === 'rsi') {
				const rsiSeries = (indicators?.RSI_14_series || []) as Array<number | null>;
				const rMin = 0,
					rMax = 100;
				const py = (v: number) => subPanelY(v, rMin, rMax, currentTop);
				// zone fills
				pc += `<rect x="${padding.left}" y="${py(100)}" width="${plotW}" height="${Math.abs(py(70) - py(100))}" fill="rgba(239,68,68,0.06)"/>`;
				pc += `<rect x="${padding.left}" y="${py(30)}" width="${plotW}" height="${Math.abs(py(0) - py(30))}" fill="rgba(34,197,94,0.06)"/>`;
				// reference lines
				(
					[
						{ v: 70, c: '#ef4444', d: '2 2' },
						{ v: 50, c: '#4b5563', d: '4 4' },
						{ v: 30, c: '#22c55e', d: '2 2' },
					] as const
				).forEach(({ v, c, d }) => {
					pc += `<line x1="${padding.left}" y1="${py(v)}" x2="${w - padding.right}" y2="${py(v)}" stroke="${c}" stroke-width="0.5" stroke-dasharray="${d}"/>`;
				});
				// RSI line
				const rPts: string[] = [];
				rsiSeries.forEach((v, i) => {
					if (v != null) {
						const idx = i - pastBuffer;
						if (idx >= 0 && idx < displayItems.length) rPts.push(`${x(idx)},${py(v as number)}`);
					}
				});
				if (rPts.length > 1) pc += `<path d="M ${rPts.join(' L ')}" fill="none" stroke="#a78bfa" stroke-width="1.5"/>`;
				// Y-axis ticks
				[0, 30, 50, 70, 100].forEach((v) => {
					pc += `<text x="${padding.left - 8}" y="${py(v)}" text-anchor="end" dominant-baseline="middle" fill="#9ca3af" font-size="10">${v}</text>`;
				});
				pc += `<text x="${padding.left + 4}" y="${currentTop + 12}" fill="#9ca3af" font-size="10" font-weight="bold">RSI (14)</text>`;
				// inline legend
				pc += `<line x1="${padding.left + 65}" y1="${currentTop + 8}" x2="${padding.left + 77}" y2="${currentTop + 8}" stroke="#a78bfa" stroke-width="1.5"/>`;
				pc += `<text x="${padding.left + 80}" y="${currentTop + 12}" fill="#9ca3af" font-size="9">RSI</text>`;
			} else if (panelType === 'volume') {
				const volumes = displayItems.map((d) => (d.volume as number) || 0);
				const vMax = Math.max(...volumes) || 1;
				const py = (v: number) => subPanelY(v, 0, vMax, currentTop);
				// volume bars
				volumes.forEach((vol, i) => {
					if (vol <= 0) return;
					const cx = x(i);
					const topY = py(vol);
					const bottomY = py(0);
					const up = displayItems[i].close >= displayItems[i].open;
					const color = up ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)';
					const vBarW = barW;
					pc += `<rect x="${Number((cx - vBarW / 2).toFixed(1))}" y="${topY}" width="${Number(vBarW.toFixed(1))}" height="${Math.max(1, bottomY - topY)}" fill="${color}"/>`;
				});
				// Y-axis ticks
				const vt = niceTicks(0, vMax, 3);
				vt.forEach((v) => {
					const label =
						v >= 1e9
							? `${(v / 1e9).toFixed(1)}B`
							: v >= 1e6
								? `${(v / 1e6).toFixed(1)}M`
								: v >= 1e3
									? `${(v / 1e3).toFixed(0)}K`
									: v.toFixed(0);
					pc += `<text x="${padding.left - 8}" y="${py(v)}" text-anchor="end" dominant-baseline="middle" fill="#9ca3af" font-size="10">${label}</text>`;
				});
				pc += `<text x="${padding.left + 4}" y="${currentTop + 12}" fill="#9ca3af" font-size="10" font-weight="bold">Volume</text>`;
				// inline legend
				pc += `<rect x="${padding.left + 55}" y="${currentTop + 4}" width="8" height="8" fill="rgba(34,197,94,0.5)"/>`;
				pc += `<text x="${padding.left + 66}" y="${currentTop + 12}" fill="#9ca3af" font-size="9">Up</text>`;
				pc += `<rect x="${padding.left + 85}" y="${currentTop + 4}" width="8" height="8" fill="rgba(239,68,68,0.5)"/>`;
				pc += `<text x="${padding.left + 96}" y="${currentTop + 12}" fill="#9ca3af" font-size="9">Down</text>`;
			}
			// panel Y-axis line
			pc += `<line x1="${padding.left}" y1="${currentTop}" x2="${padding.left}" y2="${panelBottom}" stroke="#4b5563" stroke-width="1"/>`;
			subPanelSvg += pc;
			currentTop = panelBottom + SUB_PANEL_GAP;
		}
	}

	// --- 2種類のSVGを構築 ---
	const createSvgString = (layers: { ichimoku: string; bb: string; sma: string; ema: string }) => `
    <svg width="${w}" height="${totalH}" viewBox="0 0 ${w} ${totalH}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" style="background-color: #1f2937; color: #e5e7eb; font-family: sans-serif; max-width: 100%; height: auto;">
      <title>${formatPair(pair)} ${type} chart</title>
      <style>.u{fill:#16a34a}.d{fill:#ef4444}.w{stroke:#9ca3af;stroke-width:${Math.max(1, Math.min(2.5, barW * 0.15)).toFixed(1)}}</style>
      <defs>
        <clipPath id="plotArea">
          <rect x="${padding.left}" y="${padding.top}" width="${plotW}" height="${plotH}"/>
        </clipPath>
      </defs>
      <g class="axes">
        ${yAxis}
        ${xAxis}
      </g>
      <g class="plot-area" clip-path="url(#plotArea)">
        ${layers.ichimoku}
        ${layers.bb}
  ${sticks}
  ${bodies}
${priceLine}
        ${layers.sma}
        ${layers.ema}
        ${(() => {
					if (!overlays || !overlays.ranges) return '';
					const mkRect = (startIso: string, endIso: string, color?: string, label?: string) => {
						const findIndexByIso = (iso: string) => displayItems.findIndex((d) => d.isoTime === iso);
						const i0 = findIndexByIso(startIso);
						const i1 = findIndexByIso(endIso);
						if (i0 < 0 || i1 < 0) return '';
						const left = Math.min(x(i0), x(i1));
						const right = Math.max(x(i0), x(i1));
						const width = Math.max(0, right - left);
						const fill = color || 'rgba(180,180,40,0.18)';
						const rect = `<rect x="${left}" y="${padding.top}" width="${width}" height="${plotH}" fill="${fill}" />`;
						const text = label
							? `<text x="${left + 4}" y="${padding.top + 12}" fill="#e5e7eb" font-size="10">${label}</text>`
							: '';
						return rect + text;
					};
					return overlays.ranges
						.map((r: { start: string; end: string; color?: string; label?: string }) =>
							mkRect(r.start, r.end, r.color, r.label),
						)
						.join('');
				})()}
        ${(() => {
					if (!overlays || !overlays.annotations) return '';
					// ピン＆テキストを上部に配置し、重なりを軽減するため縦位置を交互にずらす
					let slot = 0;
					const mkPin = (iso: string, text: string) => {
						const findIndexByIso = (s: string) => displayItems.findIndex((d) => d.isoTime === s);
						const i = findIndexByIso(iso);
						if (i < 0) return '';
						const cx = x(i);
						const y0 = padding.top + 6 + (slot++ % 2) * 12; // 交互にオフセット
						const stemY1 = y0 + 10;
						const circle = `<circle cx="${cx}" cy="${y0}" r="3" fill="#e5e7eb" />`;
						const stem = `<line x1="${cx}" y1="${y0 + 3}" x2="${cx}" y2="${Math.min(padding.top + plotH - 6, stemY1)}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="2 2" />`;
						const label = `<text x="${cx + 6}" y="${y0 + 4}" fill="#e5e7eb" font-size="10">${text}</text>`;
						return circle + stem + label;
					};
					return overlays.annotations.map((a: { isoTime: string; text: string }) => mkPin(a.isoTime, a.text)).join('');
				})()}
        ${(() => {
					if (!overlays || !overlays.depth_zones) return '';
					const mkBand = (low: number, high: number, color?: string, label?: string) => {
						const y1 = y(high);
						const y2 = y(low);
						const rect = `<rect x="${padding.left}" y="${Math.min(y1, y2)}" width="${plotW}" height="${Math.abs(y2 - y1)}" fill="${color || 'rgba(34,197,94,0.08)'}" />`;
						const text = label
							? `<text x="${padding.left + 4}" y="${Math.min(y1, y2) + 12}" fill="#e5e7eb" font-size="10">${label}</text>`
							: '';
						return rect + text;
					};
					return overlays.depth_zones
						.map((z: { low: number; high: number; color?: string; label?: string }) =>
							mkBand(z.low, z.high, z.color, z.label),
						)
						.join('');
				})()}
      </g>
      <g class="legend">
        ${legendLayers}
      </g>
      <g class="sub-panels">
        ${subPanelSvg}
      </g>
    </svg>
  `;

	let fullSvg = createSvgString({ ichimoku: ichimokuLayers, bb: bbLayers, sma: smaLayers, ema: emaLayers });
	let lightSvg = createSvgString({
		ichimoku: withIchimoku ? ichimokuLayers : '',
		bb: bbLayers,
		sma: smaLayers,
		ema: emaLayers,
	});
	if (svgMinify) {
		const minify = (s: string) => s.replace(/\s{2,}/g, ' ').replace(/>\s+</g, '><');
		fullSvg = minify(fullSvg);
		lightSvg = minify(lightSvg);
	}

	// --- 安全のための簡易サニタイゼーション ---
	const sanitizeSvg = (s: string) =>
		s
			// strip script tags
			.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
			// drop on* event handlers
			.replace(/\son[a-z]+="[^"]*"/gi, '')
			.replace(/\son[a-z]+='[^']*'/gi, '');

	// --- 返却: 常に生 SVG をインライン返却 ---
	const finalSvg = sanitizeSvg(withIchimoku ? lightSvg : fullSvg);
	const sizeBytes = Buffer.byteLength(finalSvg, 'utf8');
	const layerCount = estimatedLayers;

	// Human-friendly identifiers
	const title = `${formatPair(pair)} ${type} chart`;
	const rangeStart = displayItems[0]?.isoTime || '';
	const rangeEnd = displayItems.at(-1)?.isoTime || '';
	const identifier =
		`${String(pair)}-${String(type)}-${String(rangeStart).slice(0, 10)}-${String(rangeEnd).slice(0, 10)}`.replace(
			/[^a-z0-9_-]+/gi,
			'-',
		);

	const metaBase: RenderMeta & { identifier?: string; title?: string } = {
		pair: pair as Pair,
		type,
		limit: effectiveLimit,
		indicators: Object.keys(legendMeta),
		bbMode,
		range: { start: rangeStart, end: rangeEnd },
		sizeBytes,
		layerCount,
		...(identifier ? { identifier } : {}),
		...(title ? { title } : {}),
		...(warnings.length > 0 ? { warnings } : {}),
	};
	if (debugEnabled) {
		metaBase.debug = {
			x: { count: xs.length, totalSlots, padding, plotW },
			y: { yMin, yMax, ticks: yTicks },
			data: { withBB, withSMA, withEMA, withIchimoku, forwardShift, pastBuffer },
			...debugInfo,
		};
	}

	const summary = summaryNotes.length
		? `${formatPair(pair)} ${type} chart rendered (${summaryNotes.join('; ')})`
		: `${formatPair(pair)} ${type} chart rendered`;

	return ok<RenderData, RenderMeta>(summary, { svg: finalSvg, legend: legendMeta }, metaBase);
}
