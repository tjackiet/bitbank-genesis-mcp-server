/**
 * prepare_depth_data — Visualizer / 板深度チャート描画用の累積データを返す。
 *
 * getDepth（/depth API）を呼び出し、price × cumulative volume の階段配列として
 * コンパクトに整形する。render_depth_svg と同じ累積計算ロジック（lib/depth-analysis）
 * を共有する。
 *
 * クライアント側（Claude.ai Visualizer 等）で描画可能な場合はこのツールを優先。
 * ファイル保存が必要な場合は render_depth_svg を使用すること。
 */

import { toIsoTime } from '../lib/datetime.js';
import { buildCumulativeSteps } from '../lib/depth-analysis.js';
import getDepth from '../lib/get-depth.js';
import { fail, failFromError, failFromValidation, ok, toStructured } from '../lib/result.js';
import { createMeta, ensurePair } from '../lib/validate.js';
import type { FailResult, OkResult, Pair } from '../src/schemas.js';
import { PrepareDepthDataInputSchema } from '../src/schemas.js';
import type { ToolDefinition } from '../src/tool-definition.js';

/** 価格を「JPY ペアなら整数、それ以外は小数2桁」で丸める */
function roundPrice(p: number, jpyPair: boolean): number {
	return jpyPair ? Math.round(p) : Number(p.toFixed(2));
}

/** Volume は固定小数桁に丸める */
function roundVolume(v: number): number {
	return Number(v.toFixed(6));
}

interface PrepareDepthDataResult {
	/** bids: 高価格 → 低価格 の [price, cumulativeVolume] 階段データ */
	bids: Array<[number, number]>;
	/** asks: 低価格 → 高価格 の [price, cumulativeVolume] 階段データ */
	asks: Array<[number, number]>;
	bestBid: number | null;
	bestAsk: number | null;
	/** (bestBid + bestAsk) / 2 */
	mid: number | null;
	/** bestAsk - bestBid */
	spread: number | null;
	/** spread / mid */
	spreadPct: number | null;
	/** 買い板全体の累積量 */
	totalBidVolume: number;
	/** 売り板全体の累積量 */
	totalAskVolume: number;
	/** mid を中心とする ±bandPct% 範囲の買い/売り量と比率 */
	band: {
		pct: number;
		bidVolume: number;
		askVolume: number;
		ratio: number | null;
	};
	/** 板取得時刻（Unix ms） */
	timestamp: number;
	/** 板取得時刻（ISO8601, UTC） */
	isoTime: string | null;
}

interface PrepareDepthDataMeta {
	pair: Pair;
	fetchedAt: string;
	levels: { bids: number; asks: number };
	/** 出来高の単位（ペアのベース通貨。例: btc_jpy → "BTC"） */
	volumeUnit: string;
}

export interface PrepareDepthDataParams {
	pair?: string;
	/** 取得する最大レベル数（片側） */
	levels?: number;
	/** mid を中心とした band 比率（0.01 = ±1%） */
	bandPct?: number;
}

export default async function prepareDepthData(
	params: PrepareDepthDataParams = {},
): Promise<OkResult<PrepareDepthDataResult, PrepareDepthDataMeta> | FailResult> {
	const { pair = 'btc_jpy', levels = 200, bandPct = 0.01 } = params;

	const chk = ensurePair(pair);
	if (!chk.ok) return failFromValidation(chk);

	const maxLevels = Math.max(10, Math.min(1000, Math.floor(levels)));
	const jpyPair = chk.pair.endsWith('_jpy');

	try {
		const depth = await getDepth(chk.pair, { maxLevels });
		if (!depth.ok) return fail(depth.summary.replace(/^Error: /, ''), depth.meta?.errorType || 'internal');

		const asksRaw: Array<[string, string]> = depth.data.asks || [];
		const bidsRaw: Array<[string, string]> = depth.data.bids || [];

		if (!asksRaw.length || !bidsRaw.length) {
			return fail('板データが不足しています（asks/bids の両方が必要です）', 'upstream');
		}

		const bidsNum = bidsRaw.map(([p, s]) => [Number(p), Number(s)] as [number, number]);
		const asksNum = asksRaw.map(([p, s]) => [Number(p), Number(s)] as [number, number]);

		const bidStepsRaw = buildCumulativeSteps(bidsNum, 'bid');
		const askStepsRaw = buildCumulativeSteps(asksNum, 'ask');

		const bidSteps: Array<[number, number]> = bidStepsRaw.map(([p, q]) => [roundPrice(p, jpyPair), roundVolume(q)]);
		const askSteps: Array<[number, number]> = askStepsRaw.map(([p, q]) => [roundPrice(p, jpyPair), roundVolume(q)]);

		const bestBid = bidStepsRaw[0]?.[0] ?? null;
		const bestAsk = askStepsRaw[0]?.[0] ?? null;
		const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
		const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
		const spreadPct = mid != null && spread != null && mid !== 0 ? Number((spread / mid).toFixed(6)) : null;

		const totalBidVolume = bidStepsRaw.at(-1)?.[1] ?? 0;
		const totalAskVolume = askStepsRaw.at(-1)?.[1] ?? 0;

		// mid を中心とした band 集計
		let bandBidVol = 0;
		let bandAskVol = 0;
		if (mid != null) {
			const bidFloor = mid * (1 - bandPct);
			const askCeil = mid * (1 + bandPct);
			for (const [p, s] of bidsNum) if (p >= bidFloor && p <= mid) bandBidVol += s;
			for (const [p, s] of asksNum) if (p >= mid && p <= askCeil) bandAskVol += s;
		}
		const bandRatio = bandAskVol > 0 ? Number((bandBidVol / bandAskVol).toFixed(4)) : null;

		const timestamp = Number(depth.data.timestamp ?? Date.now());

		const data: PrepareDepthDataResult = {
			bids: bidSteps,
			asks: askSteps,
			bestBid: bestBid != null ? roundPrice(bestBid, jpyPair) : null,
			bestAsk: bestAsk != null ? roundPrice(bestAsk, jpyPair) : null,
			mid: mid != null ? roundPrice(mid, jpyPair) : null,
			spread: spread != null ? roundPrice(spread, jpyPair) : null,
			spreadPct,
			totalBidVolume: roundVolume(totalBidVolume),
			totalAskVolume: roundVolume(totalAskVolume),
			band: {
				pct: bandPct,
				bidVolume: roundVolume(bandBidVol),
				askVolume: roundVolume(bandAskVol),
				ratio: bandRatio,
			},
			timestamp,
			isoTime: toIsoTime(timestamp),
		};

		const volumeUnit = chk.pair.split('_')[0].toUpperCase();
		const meta: PrepareDepthDataMeta = {
			...createMeta(chk.pair),
			levels: { bids: bidSteps.length, asks: askSteps.length },
			volumeUnit,
		} as PrepareDepthDataMeta;

		const ratioText = bandRatio == null ? 'n/a' : bandRatio.toFixed(2);
		const summary = `${chk.pair} depth data (bids: ${bidSteps.length}, asks: ${askSteps.length}, mid: ${data.mid ?? 'n/a'}, ±${(bandPct * 100).toFixed(2)}% ratio: ${ratioText})`;
		return ok<PrepareDepthDataResult, PrepareDepthDataMeta>(summary, data, meta);
	} catch (err: unknown) {
		return failFromError(err, { defaultMessage: '板深度データの整形に失敗しました' });
	}
}

export type { PrepareDepthDataMeta, PrepareDepthDataResult };

export const toolDef: ToolDefinition = {
	name: 'prepare_depth_data',
	description:
		'[Depth Chart / Order Book / Visualization] 板の深度チャート描画の第一選択ツール。\n\n' +
		'getDepth（/depth API）を呼び出し、累積 volume の階段配列 ([price, cumulativeVolume][]) として返す。\n' +
		'Claude.ai の Visualizer 等クライアント側で描画可能な場合はこのツールを優先。\n' +
		'ファイル保存（SVG/PNG）が必要な場合は render_depth_svg を使用。\n\n' +
		'レスポンス形式: { bids: [[price, cumVolume], ...], asks: [[price, cumVolume], ...], bestBid, bestAsk, mid, spread, spreadPct, totalBidVolume, totalAskVolume, band: {pct, bidVolume, askVolume, ratio}, timestamp, isoTime }\n' +
		'- bids は価格降順、asks は価格昇順\n' +
		'- band は mid を中心とした ±bandPct 範囲の買い/売り量と比率（ratio = bidVolume / askVolume）\n' +
		'- JPY ペアの価格は整数に丸め済み',
	inputSchema: PrepareDepthDataInputSchema,
	handler: async ({ pair, levels, bandPct }: { pair?: string; levels?: number; bandPct?: number }) => {
		const result = await prepareDepthData({ pair, levels, bandPct });
		if (!result.ok) return result;
		// LLM は structuredContent を参照できないため、content テキストにデータを含める
		const text = `${result.summary}\n${JSON.stringify(result.data)}`;
		return {
			content: [{ type: 'text', text }],
			structuredContent: toStructured(result),
		};
	},
};
