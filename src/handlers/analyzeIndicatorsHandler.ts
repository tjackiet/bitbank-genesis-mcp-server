import analyzeIndicators from '../../tools/analyze_indicators.js';
import { GetIndicatorsInputSchema } from '../schemas.js';
import type { ToolDefinition } from '../tool-definition.js';
import { formatPriceJPY, formatPercent } from '../../lib/formatter.js';
import { toDisplayTime, nowIso } from '../../lib/datetime.js';

export const toolDef: ToolDefinition = {
	name: 'analyze_indicators',
	description: 'テクニカル指標を用いて値動きを分析（ローソク足 /candlestick を入力）。SMA/RSI/BB/一目/MACD/ストキャスティクスRSI。分析には十分な limit を指定（例: 日足200本）。\n\n【重要】バックテストを行う場合は、このツールではなく run_backtest を使用してください。run_backtest はデータ取得・計算・チャート描画をすべて行い、結果をワンコールで返します。',
	inputSchema: GetIndicatorsInputSchema,
	handler: async ({ pair, type, limit }: any) => {
		const res: any = await analyzeIndicators(pair, type, limit);
		if (!res?.ok) return res;
		const ind: any = res?.data?.indicators ?? {};
		const candles: any[] = Array.isArray(res?.data?.normalized) ? res.data.normalized : [];
		const close = candles.at(-1)?.close ?? null;
		const prev = candles.at(-2)?.close ?? null;
		const nowJst = toDisplayTime(undefined) ?? nowIso();
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
		// Stochastic RSI
		const stochK = ind.STOCH_RSI_K ?? null;
		const stochD = ind.STOCH_RSI_D ?? null;
		const stochPrevK = ind.STOCH_RSI_prevK ?? null;
		const stochPrevD = ind.STOCH_RSI_prevD ?? null;
		lines.push('【ストキャスティクスRSI】');
		if (stochK != null && stochD != null) {
			lines.push(`  %K: ${Number(stochK).toFixed(1)}  %D: ${Number(stochD).toFixed(1)}`);
			const stochZone = Number(stochK) <= 20 ? '売られすぎゾーン' : (Number(stochK) >= 80 ? '買われすぎゾーン' : '中立圏');
			const stochStrength = Number(stochK) <= 10 ? '（強い売られすぎ）' : (Number(stochK) >= 90 ? '（強い買われすぎ）' : '');
			lines.push(`  判定: ${stochZone}${stochStrength}`);
			if (stochPrevK != null && stochPrevD != null) {
				const prevBelow = Number(stochPrevK) < Number(stochPrevD);
				const curAbove = Number(stochK) > Number(stochD);
				const prevAbove = Number(stochPrevK) > Number(stochPrevD);
				const curBelow = Number(stochK) < Number(stochD);
				if (prevBelow && curAbove) {
					lines.push('  クロス: %Kが%Dを上抜け（買いシグナル候補）');
				} else if (prevAbove && curBelow) {
					lines.push('  クロス: %Kが%Dを下抜け（売りシグナル候補）');
				} else {
					lines.push('  クロス: なし');
				}
			}
		} else {
			lines.push('  データ不足');
		}
		lines.push('');
		// OBV
		const obvVal = ind.OBV ?? null;
		const obvSma20 = ind.OBV_SMA20 ?? null;
		const obvTrend = ind.OBV_trend ?? null;
		lines.push('【OBV (On-Balance Volume)】');
		if (obvVal != null) {
			const obvUnit = String(pair).toLowerCase().includes('btc') ? 'BTC' : '';
			lines.push(`  現在値: ${Number(obvVal).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${obvUnit}`.trim());
			if (obvSma20 != null) lines.push(`  SMA(20): ${Number(obvSma20).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${obvUnit}`.trim());
			if (obvTrend != null) {
				const obvTrendLabel = obvTrend === 'rising' ? 'OBV > SMA → 出来高が上昇を支持' : (obvTrend === 'falling' ? 'OBV < SMA → 出来高が下落を支持' : 'OBV ≈ SMA → 出来高中立');
				lines.push(`  トレンド: ${obvTrendLabel}`);
			}
			// Divergence check: price direction vs OBV direction over recent bars
			const obvPrev = ind.OBV_prevObv ?? null;
			if (obvPrev != null && prev != null && close != null) {
				const priceUp = Number(close) > Number(prev);
				const priceDn = Number(close) < Number(prev);
				const obvUp = Number(obvVal) > Number(obvPrev);
				const obvDn = Number(obvVal) < Number(obvPrev);
				if (priceUp && obvDn) {
					lines.push('  ダイバージェンス: ベアリッシュ（価格↑・OBV↓）→ 上昇の持続力に疑問');
				} else if (priceDn && obvUp) {
					lines.push('  ダイバージェンス: ブルリッシュ（価格↓・OBV↑）→ 反発の可能性');
				} else {
					lines.push('  ダイバージェンス: なし（価格とOBVが同方向）');
				}
			}
		} else {
			lines.push('  データ不足');
		}
		lines.push('');
		lines.push('【次に確認すべきこと】');
		lines.push('  ・より詳しく: analyze_bb_snapshot / analyze_ichimoku_snapshot / analyze_sma_snapshot');
		lines.push('  ・転換サイン例: RSI>40, MACDヒストグラムのプラ転, 25日線の明確な上抜け');
		lines.push('');
		lines.push('詳細は structuredContent.data.indicators / chart を参照。');
		const text = lines.join('\n');
		return { content: [{ type: 'text', text }], structuredContent: res as Record<string, unknown> };
	},
};
