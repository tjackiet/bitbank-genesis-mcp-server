import getCandles from './get_candles.js';
import { ok, fail, failFromError, failFromValidation } from '../lib/result.js';
import { createMeta, ensurePair } from '../lib/validate.js';
import { formatSummary, formatPrice, formatPercent } from '../lib/formatter.js';
import {
	AnalyzeFibonacciInputSchema,
	AnalyzeFibonacciOutputSchema,
} from '../src/schemas.js';
import type { ToolDefinition } from '../src/tool-definition.js';

// フィボナッチ比率定義
const RETRACEMENT_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
const EXTENSION_RATIOS = [1.272, 1.618] as const;

interface FibLevel {
	ratio: number;
	label: string;
	price: number;
	pctFromCurrent: number;
	zone: 'retracement' | 'extension';
}

/**
 * ルックバック期間内の主要スイングハイ/ローを検出する。
 * 全期間の最高値・最安値を使い、その出現順序でトレンド方向を判定する。
 */
function detectSwings(
	candles: Array<{ isoTime: string; high: number; low: number }>
): { swingHigh: { price: number; date: string; index: number }; swingLow: { price: number; date: string; index: number } } {
	let highestPrice = -Infinity;
	let highestDate = '';
	let highestIndex = 0;
	let lowestPrice = Infinity;
	let lowestDate = '';
	let lowestIndex = 0;

	for (let i = 0; i < candles.length; i++) {
		if (candles[i].high > highestPrice) {
			highestPrice = candles[i].high;
			highestDate = candles[i].isoTime.split('T')[0];
			highestIndex = i;
		}
		if (candles[i].low < lowestPrice) {
			lowestPrice = candles[i].low;
			lowestDate = candles[i].isoTime.split('T')[0];
			lowestIndex = i;
		}
	}

	return {
		swingHigh: { price: highestPrice, date: highestDate, index: highestIndex },
		swingLow: { price: lowestPrice, date: lowestDate, index: lowestIndex },
	};
}

/**
 * フィボナッチ水準を算出する。
 * - 上昇トレンド（安値→高値）: 高値からの戻り率
 * - 下降トレンド（高値→安値）: 安値からの戻り率
 */
function calculateLevels(
	swingHigh: number,
	swingLow: number,
	trend: 'uptrend' | 'downtrend',
	currentPrice: number
): FibLevel[] {
	const range = swingHigh - swingLow;
	const levels: FibLevel[] = [];

	for (const ratio of RETRACEMENT_RATIOS) {
		// 上昇トレンド: 高値から下方へリトレース
		// 下降トレンド: 安値から上方へリトレース
		const price = trend === 'uptrend'
			? swingHigh - range * ratio
			: swingLow + range * ratio;

		levels.push({
			ratio,
			label: ratio === 0 ? '0%' : ratio === 1 ? '100%' : `${(ratio * 100).toFixed(1)}%`,
			price: Math.round(price * 100) / 100,
			pctFromCurrent: ((price - currentPrice) / currentPrice) * 100,
			zone: 'retracement',
		});
	}

	for (const ratio of EXTENSION_RATIOS) {
		const price = trend === 'uptrend'
			? swingHigh - range * ratio
			: swingLow + range * ratio;

		levels.push({
			ratio,
			label: `${(ratio * 100).toFixed(1)}%`,
			price: Math.round(price * 100) / 100,
			pctFromCurrent: ((price - currentPrice) / currentPrice) * 100,
			zone: 'extension',
		});
	}

	return levels;
}

function findNearestLevel(levels: FibLevel[]): FibLevel | null {
	if (levels.length === 0) return null;
	return levels.reduce((nearest, level) =>
		Math.abs(level.pctFromCurrent) < Math.abs(nearest.pctFromCurrent) ? level : nearest
	);
}

function describePricePosition(
	currentPrice: number,
	levels: FibLevel[],
	trend: 'uptrend' | 'downtrend'
): string {
	// リトレースメントレベルのみ対象（0%〜100%）
	const retracementLevels = levels
		.filter(l => l.zone === 'retracement')
		.sort((a, b) => b.price - a.price); // 高い順

	// 現在価格がどの2つのレベルの間にあるか
	for (let i = 0; i < retracementLevels.length - 1; i++) {
		const upper = retracementLevels[i];
		const lower = retracementLevels[i + 1];
		if (currentPrice <= upper.price && currentPrice >= lower.price) {
			return `${upper.label}（${formatPrice(upper.price)}）と${lower.label}（${formatPrice(lower.price)}）の間`;
		}
	}

	const highest = retracementLevels[0];
	const lowest = retracementLevels[retracementLevels.length - 1];
	if (currentPrice > highest.price) {
		return trend === 'uptrend'
			? `スイングハイ（${formatPrice(highest.price)}）を上回る`
			: `100%戻し（${formatPrice(highest.price)}）を上回る`;
	}
	return trend === 'uptrend'
		? `100%戻し（${formatPrice(lowest.price)}）を下回る`
		: `スイングロー（${formatPrice(lowest.price)}）を下回る`;
}

export default async function analyzeFibonacci(
	pair: string = 'btc_jpy',
	type: string = '1day',
	lookbackDays: number = 90
) {
	const chk = ensurePair(pair);
	if (!chk.ok) return failFromValidation(chk, AnalyzeFibonacciOutputSchema) as any;

	try {
		const candlesRes: any = await getCandles(chk.pair, type, undefined as any, lookbackDays + 10);
		if (!candlesRes?.ok) {
			return AnalyzeFibonacciOutputSchema.parse(
				fail(candlesRes?.summary || 'candles failed', (candlesRes?.meta as any)?.errorType || 'internal')
			) as any;
		}

		const candles = candlesRes.data.normalized || [];
		if (candles.length < 10) {
			return AnalyzeFibonacciOutputSchema.parse(
				fail('ローソク足データが不足しています（最低10本必要）', 'data')
			) as any;
		}

		const currentCandle = candles[candles.length - 1];
		const currentPrice = currentCandle.close;

		// スイングハイ/ロー検出
		const { swingHigh, swingLow } = detectSwings(candles);
		const range = swingHigh.price - swingLow.price;

		if (range <= 0) {
			return AnalyzeFibonacciOutputSchema.parse(
				fail('高値と安値が同一のため分析できません', 'data')
			) as any;
		}

		// トレンド方向判定: 安値が先→上昇トレンド、高値が先→下降トレンド
		const trend: 'uptrend' | 'downtrend' = swingLow.index < swingHigh.index ? 'uptrend' : 'downtrend';

		// フィボナッチ水準算出
		const levels = calculateLevels(swingHigh.price, swingLow.price, trend, currentPrice);
		const nearestLevel = findNearestLevel(levels);
		const pricePosition = describePricePosition(currentPrice, levels, trend);

		// content 生成
		const trendLabel = trend === 'uptrend' ? '上昇' : '下降';
		let contentText = `フィボナッチ・リトレースメント分析（過去${lookbackDays}日）\n`;
		contentText += `現在価格: ${formatPrice(currentPrice, chk.pair)}\n`;
		contentText += `トレンド: ${trendLabel}トレンド（${trend === 'uptrend' ? `${swingLow.date} 安値 → ${swingHigh.date} 高値` : `${swingHigh.date} 高値 → ${swingLow.date} 安値`}）\n`;
		contentText += `スイングハイ: ${formatPrice(swingHigh.price, chk.pair)}（${swingHigh.date}）\n`;
		contentText += `スイングロー: ${formatPrice(swingLow.price, chk.pair)}（${swingLow.date}）\n`;
		contentText += `値幅: ${formatPrice(range, chk.pair)}（${formatPercent((range / swingLow.price) * 100, { digits: 1 })}）\n\n`;

		contentText += `【リトレースメント水準】\n`;
		const retLevels = levels.filter(l => l.zone === 'retracement');
		for (const level of retLevels) {
			const dist = formatPercent(level.pctFromCurrent, { digits: 1, sign: true });
			const marker = nearestLevel && level.ratio === nearestLevel.ratio && nearestLevel.zone === 'retracement' ? ' ← 最寄り' : '';
			contentText += `  ${level.label.padStart(6)}: ${formatPrice(level.price, chk.pair)}（現在価格から ${dist}）${marker}\n`;
		}

		contentText += `\n【エクステンション水準】\n`;
		const extLevels = levels.filter(l => l.zone === 'extension');
		for (const level of extLevels) {
			const dist = formatPercent(level.pctFromCurrent, { digits: 1, sign: true });
			const marker = nearestLevel && level.ratio === nearestLevel.ratio && nearestLevel.zone === 'extension' ? ' ← 最寄り' : '';
			contentText += `  ${level.label.padStart(6)}: ${formatPrice(level.price, chk.pair)}（現在価格から ${dist}）${marker}\n`;
		}

		contentText += `\n【現在価格の位置】\n`;
		contentText += `  ${pricePosition}\n`;

		if (nearestLevel) {
			contentText += `  最寄りレベル: ${nearestLevel.label}（${formatPrice(nearestLevel.price, chk.pair)}、距離 ${formatPercent(nearestLevel.pctFromCurrent, { digits: 2, sign: true })}）\n`;
		}

		contentText += `\n【解釈ガイド】\n`;
		if (trend === 'uptrend') {
			contentText += `  上昇トレンドの押し目: 38.2%・50%・61.8%付近は反発の可能性が高い\n`;
			contentText += `  61.8%超えの深い押し: トレンド転換リスクに注意\n`;
		} else {
			contentText += `  下降トレンドの戻り: 38.2%・50%・61.8%付近は反落の可能性が高い\n`;
			contentText += `  61.8%超えの強い戻り: トレンド転換の兆候\n`;
		}

		const summary = formatSummary({
			pair: chk.pair,
			latest: currentPrice,
			extra: `fibonacci ${trendLabel} nearest=${nearestLevel?.label || 'n/a'}`,
		});

		const data = {
			currentPrice,
			swingHigh: { price: swingHigh.price, date: swingHigh.date },
			swingLow: { price: swingLow.price, date: swingLow.date },
			trend,
			levels,
			nearestLevel,
			pricePosition,
		};

		const meta = createMeta(chk.pair, {
			lookbackDays,
			type,
			swingRange: range,
			swingRangePct: Number(((range / swingLow.price) * 100).toFixed(2)),
		});

		return AnalyzeFibonacciOutputSchema.parse({
			ok: true,
			summary,
			content: [{ type: 'text' as const, text: contentText }],
			data,
			meta,
		}) as any;
	} catch (err: unknown) {
		return failFromError(err, { schema: AnalyzeFibonacciOutputSchema, defaultMessage: 'Fibonacci analysis error' }) as any;
	}
}

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'analyze_fibonacci',
	description: 'フィボナッチ・リトレースメント＆エクステンション分析。直近の高値・安値から主要水準（23.6%, 38.2%, 50%, 61.8%, 78.6%, 127.2%, 161.8%）を算出し、現在価格の位置と最寄りレベルを判定。上昇/下降トレンドを自動検出。',
	inputSchema: AnalyzeFibonacciInputSchema,
	handler: async ({ pair, type, lookbackDays }: any) =>
		analyzeFibonacci(pair, type, lookbackDays),
};
