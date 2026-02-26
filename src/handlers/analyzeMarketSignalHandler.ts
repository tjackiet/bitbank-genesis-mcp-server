import analyzeMarketSignal from '../../tools/analyze_market_signal.js';
import { AnalyzeMarketSignalInputSchema, AnalyzeMarketSignalOutputSchema } from '../schemas.js';
import type { ToolDefinition } from '../tool-definition.js';

export const toolDef: ToolDefinition = {
	name: 'analyze_market_signal',
	description: '【初動トリアージ専用】市場の総合状態を単一スコア(-100〜+100)で瞬時評価。分析の起点として最初に呼び出すツール。\n\n■ 主な用途\n- 「今、買い/売り/中立のどれか？」の即答\n- 詳細分析が必要な要素の特定\n- 複数銘柄の相対比較・スクリーニング\n\n■ スコア計算式\nscore = 0.35×buyPressure + 0.25×cvdTrend + 0.15×momentum + 0.10×volatility + 0.15×smaTrend\n\n5要素の意味:\n- buyPressure (35%): 板の買い/売り注文バランス\n- cvdTrend (25%): 累積出来高差分の方向性\n- momentum (15%): RSI/MACDなどの勢い指標\n- volatility (10%): 価格変動の大きさ\n- smaTrend (15%): 移動平均線の配置と変化\n\n■ このツールの限界（重要）\nこれは概要把握用のスナップショット。詳細分析には以下の専門ツールを併用すること:\n- フロー詳細分析 → get_flow_metrics (時系列バケット、スパイク検出)\n- ボラティリティ詳細 → get_volatility_metrics (RV/ATR/Parkinson/GK/RS)\n- テクニカル指標詳細 → get_indicators (RSI/MACD/BB/一目の全詳細値)\n- 板の帯域別分析 → get_orderbook (mode=pressure, ±0.1%/0.5%/1%等の層別圧力)\n- パターン検出 → detect_patterns（形成中+完成済みの統合版）\n\n■ LLMへの指示\n1. スコアを説明する際は必ず計算式と各要素の寄与度を明示\n2. 最も影響している要素（topContributors）を強調\n3. スコアが中立付近または要素間で矛盾がある場合、追加の専門ツール呼び出しを推奨\n4. SMA関連は「SMA配置トレンド(構造)」と「短期SMA変化スコア(勢い)」を区別して説明',
	inputSchema: AnalyzeMarketSignalInputSchema,
	handler: async ({ pair, type, flowLimit, bucketMs, windows }: any) => {
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
	},
};
