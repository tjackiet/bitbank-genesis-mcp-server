/**
 * chart/render-depth — Depth チャート（板の深度）の SVG 描画。
 *
 * メインのローソク足チャートとは完全に独立したコードパス。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { formatPair } from '../../lib/formatter.js';
import getDepth from '../../lib/get-depth.js';
import { fail, ok } from '../../lib/result.js';
import type { Pair, Result } from '../../src/schemas.js';

type RenderData = { svg?: string; filePath?: string; legend?: Record<string, string> };
type RenderMeta = {
	pair: Pair;
	type: string;
	bbMode: 'default' | 'extended';
	[key: string]: unknown;
};

export async function renderDepthChart(
	pair: string,
	args: { depth?: { levels?: number }; type?: string },
	effectivePrecision: number,
): Promise<Result<RenderData, RenderMeta>> {
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
		const msg = e instanceof Error ? e.message : String(e);
		return fail(msg || 'failed to render depth', 'internal');
	}
}
