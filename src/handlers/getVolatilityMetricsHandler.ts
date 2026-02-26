import getVolatilityMetrics from '../../tools/get_volatility_metrics.js';
import { GetVolMetricsInputSchema } from '../schemas.js';
import type { ToolDefinition } from '../tool-definition.js';
import { formatPercent, formatCurrency, formatCurrencyShort, formatPriceJPY } from '../../lib/formatter.js';
import { toIsoTime } from '../../lib/datetime.js';
import { stddev } from '../../lib/math.js';

export const toolDef: ToolDefinition = {
	name: 'get_volatility_metrics',
	description: '/candlestick をベースにボラティリティを算出。RV/ATR/Parkinson/GK/RS。view=summary|detailed|full。',
	inputSchema: GetVolMetricsInputSchema,
	handler: async ({ pair, type, limit, windows, useLogReturns, annualize, view }: any) => {
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
			const line = `${String(pair).toUpperCase()} [${String(type)}] samples=${meta.sampleSize ?? 'n/a'} RV=${fmtPct(rvAnn)} ATR=${fmtCurrencyShortFn(pair, atrAbs)} PK=${fmtPct(pkAnn)} GK=${fmtPct(gkAnn)} RS=${fmtPct(rsAnn)} Tags: ${tagsAll.join(', ')}`;
			return { content: [{ type: 'text', text: line }], structuredContent: { ...res, data: { ...res.data, tags: tagsAll } } as Record<string, unknown> };
		}

		// detailed/full
		const windowsList = roll.map(r => r.window).join('/');
		const header = `${String(pair).toUpperCase()} [${String(type)}] close=${lastClose != null ? Number(lastClose).toLocaleString() : 'n/a'}\n`;
		const block1 = `【Volatility Metrics${ann ? ' (annualized)' : ''}, ${meta.sampleSize ?? 'n/a'} samples】\nRV (std): ${fmtPct(rvAnn)}\nATR: ${fmtCurrencyFn(pair, atrAbs)}\nParkinson: ${fmtPct(pkAnn)}\nGarman-Klass: ${fmtPct(gkAnn)}\nRogers-Satchell: ${fmtPct(rsAnn)}`;

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
			const firstIso = tsArr.length ? (toIsoTime(tsArr[0]) ?? 'n/a') : 'n/a';
			const lastIso = tsArr.length ? (toIsoTime(tsArr[tsArr.length - 1]) ?? 'n/a') : 'n/a';
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
		function fmtCurrencyFn(p: any, v: any) { return formatCurrency(v, p); }
		function fmtCurrencyShortFn(p: any, v: any) { return formatCurrencyShort(v, p); }
	},
};
