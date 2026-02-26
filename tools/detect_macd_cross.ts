import analyzeIndicators from './analyze_indicators.js';
import { ALLOWED_PAIRS } from '../lib/validate.js';
import { ok, fail, failFromError } from '../lib/result.js';
import { formatSummary } from '../lib/formatter.js';
import { z } from 'zod';
import type { ToolDefinition } from '../src/tool-definition.js';

export default async function detectMacdCross(
  market: 'all' | 'jpy' = 'all',
  lookback: number = 3,
  pairs?: string[],
  view: 'summary' | 'detailed' = 'summary',
  screen?: {
    minHistogramDelta?: number;
    maxBarsAgo?: number;
    minReturnPct?: number;
    maxReturnPct?: number;
    crossType?: 'golden' | 'dead' | 'both';
    sortBy?: 'date' | 'histogram' | 'return' | 'barsAgo';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    withPrice?: boolean;
  }
) {
  try {
    const universe = pairs && pairs.length
      ? pairs.filter(p => ALLOWED_PAIRS.has(p as any))
      : Array.from(ALLOWED_PAIRS.values()).filter(p => market === 'jpy' ? p.endsWith('_jpy') : true);
    const results: Array<{ pair: string; type: 'golden' | 'dead'; macd: number; signal: number; isoTime?: string | null }> = [];
    const resultsDetailed: Array<{
      pair: string;
      type: 'golden' | 'dead';
      crossIndex: number;
      crossDate: string | null;
      barsAgo: number;
      macdAtCross: number | null;
      signalAtCross: number | null;
      histogramPrev: number | null;
      histogramCurr: number | null;
      histogramDelta: number | null;
      prevCross: { type: 'golden' | 'dead'; barsAgo: number; date: string | null } | null;
      priceAtCross: number | null;
      currentPrice: number | null;
      returnSinceCrossPct: number | null;
    }> = [];
    await Promise.all(universe.map(async (pair) => {
      try {
        const ind = await analyzeIndicators(pair, '1day', 120);
        if (!ind?.ok) return;
        const macdSeries = (ind.data?.indicators as { macd_series?: { line: number[]; signal: number[] } })?.macd_series;
        const line = macdSeries?.line || [];
        const signal = macdSeries?.signal || [];
        const candles = (ind.data?.normalized || []) as Array<{ isoTime?: string | null; close?: number | null }>;
        const n = line.length;
        if (n < 2) return;
        const end = n - 1;
        const start = Math.max(1, n - lookback);
        for (let i = start; i <= end; i++) {
          const prevDiff = (line[i - 1] ?? null) != null && (signal[i - 1] ?? null) != null ? (line[i - 1] as number) - (signal[i - 1] as number) : null;
          const currDiff = (line[i] ?? null) != null && (signal[i] ?? null) != null ? (line[i] as number) - (signal[i] as number) : null;
          if (prevDiff == null || currDiff == null) continue;
          if (prevDiff <= 0 && currDiff > 0) {
            results.push({ pair: pair as string, type: 'golden', macd: line[i] as number, signal: signal[i] as number, isoTime: candles[i]?.isoTime ?? null });
            // detailed info
            const currentPrice = (candles.at(-1)?.close ?? null) as number | null;
            const priceAtCross = (candles[i]?.close ?? null) as number | null;
            const retPct = priceAtCross && currentPrice != null ? Number((((currentPrice - priceAtCross) / priceAtCross) * 100).toFixed(2)) : null;
            // previous cross lookup
            let prevIdx: number | null = null;
            let prevType: 'golden' | 'dead' | null = null;
            for (let j = i - 1; j >= 1; j--) {
              const pd = (line[j - 1] ?? null) != null && (signal[j - 1] ?? null) != null ? (line[j - 1] as number) - (signal[j - 1] as number) : null;
              const cd = (line[j] ?? null) != null && (signal[j] ?? null) != null ? (line[j] as number) - (signal[j] as number) : null;
              if (pd == null || cd == null) continue;
              if (pd <= 0 && cd > 0) { prevIdx = j; prevType = 'golden'; break; }
              if (pd >= 0 && cd < 0) { prevIdx = j; prevType = 'dead'; break; }
            }
            resultsDetailed.push({
              pair: pair as string,
              type: 'golden',
              crossIndex: i,
              crossDate: candles[i]?.isoTime ?? null,
              barsAgo: (n - 1) - i,
              macdAtCross: (line[i] ?? null) as number | null,
              signalAtCross: (signal[i] ?? null) as number | null,
              histogramPrev: prevDiff,
              histogramCurr: currDiff,
              histogramDelta: (currDiff != null && prevDiff != null) ? Number((currDiff - prevDiff).toFixed(4)) : null,
              prevCross: prevIdx != null ? { type: prevType as any, barsAgo: i - prevIdx, date: candles[prevIdx]?.isoTime ?? null } : null,
              priceAtCross,
              currentPrice,
              returnSinceCrossPct: retPct,
            });
            break;
          }
          if (prevDiff >= 0 && currDiff < 0) {
            results.push({ pair: pair as string, type: 'dead', macd: line[i] as number, signal: signal[i] as number, isoTime: candles[i]?.isoTime ?? null });
            const currentPrice = (candles.at(-1)?.close ?? null) as number | null;
            const priceAtCross = (candles[i]?.close ?? null) as number | null;
            const retPct = priceAtCross && currentPrice != null ? Number((((currentPrice - priceAtCross) / priceAtCross) * 100).toFixed(2)) : null;
            let prevIdx: number | null = null;
            let prevType: 'golden' | 'dead' | null = null;
            for (let j = i - 1; j >= 1; j--) {
              const pd = (line[j - 1] ?? null) != null && (signal[j - 1] ?? null) != null ? (line[j - 1] as number) - (signal[j - 1] as number) : null;
              const cd = (line[j] ?? null) != null && (signal[j] ?? null) != null ? (line[j] as number) - (signal[j] as number) : null;
              if (pd == null || cd == null) continue;
              if (pd <= 0 && cd > 0) { prevIdx = j; prevType = 'golden'; break; }
              if (pd >= 0 && cd < 0) { prevIdx = j; prevType = 'dead'; break; }
            }
            resultsDetailed.push({
              pair: pair as string,
              type: 'dead',
              crossIndex: i,
              crossDate: candles[i]?.isoTime ?? null,
              barsAgo: (n - 1) - i,
              macdAtCross: (line[i] ?? null) as number | null,
              signalAtCross: (signal[i] ?? null) as number | null,
              histogramPrev: prevDiff,
              histogramCurr: currDiff,
              histogramDelta: (currDiff != null && prevDiff != null) ? Number((currDiff - prevDiff).toFixed(4)) : null,
              prevCross: prevIdx != null ? { type: prevType as any, barsAgo: i - prevIdx, date: candles[prevIdx]?.isoTime ?? null } : null,
              priceAtCross,
              currentPrice,
              returnSinceCrossPct: retPct,
            });
            break;
          }
        }
      } catch { }
    }));

    // screening (applies to summary and detailed when provided)
    const opts = screen || {};
    const crossType = (opts.crossType || 'both');
    const totalFound = resultsDetailed.length;
    let filtered = resultsDetailed.slice();
    filtered = filtered.filter(r => {
      if (crossType !== 'both' && r.type !== crossType) return false;
      if (opts.minHistogramDelta != null && r.histogramDelta != null && Math.abs(r.histogramDelta) < opts.minHistogramDelta) return false;
      if (opts.maxBarsAgo != null && r.barsAgo != null && r.barsAgo > opts.maxBarsAgo) return false;
      if (opts.minReturnPct != null && !(r.returnSinceCrossPct != null && r.returnSinceCrossPct >= opts.minReturnPct)) return false;
      if (opts.maxReturnPct != null && !(r.returnSinceCrossPct != null && r.returnSinceCrossPct <= opts.maxReturnPct)) return false;
      return true;
    });
    // sort
    const sortBy = opts.sortBy || 'date';
    const order = (opts.sortOrder || 'desc') === 'desc' ? -1 : 1;
    const safeNum = (v: unknown, def = 0) => (v == null || Number.isNaN(Number(v)) ? def : Number(v));
    const projReturn = (v: unknown) => (v == null ? Number.NEGATIVE_INFINITY : Number(v));
    filtered.sort((a, b) => {
      if (sortBy === 'histogram') {
        const aa = Math.abs(safeNum(a.histogramDelta));
        const bb = Math.abs(safeNum(b.histogramDelta));
        return (bb - aa) * (order === -1 ? 1 : -1);
      }
      if (sortBy === 'return') {
        const ar = projReturn(a.returnSinceCrossPct);
        const br = projReturn(b.returnSinceCrossPct);
        return ((br - ar) * (order === -1 ? 1 : -1));
      }
      if (sortBy === 'barsAgo') {
        return ((safeNum(a.barsAgo) - safeNum(b.barsAgo)) * (order === -1 ? 1 : -1));
      }
      // date (newer first when desc): smaller barsAgo first
      return (((safeNum(a.barsAgo) - safeNum(b.barsAgo))) * (order === -1 ? 1 : -1));
    });
    if (opts.limit != null && opts.limit > 0) filtered = filtered.slice(0, opts.limit);

    const resultsScreened = filtered.map(r => ({ pair: r.pair, type: r.type, macd: r.macdAtCross as number, signal: r.signalAtCross as number, isoTime: r.crossDate }));
    const brief = resultsScreened.slice(0, 6).map(r => `${r.pair}:${r.type}${r.isoTime ? '@' + String(r.isoTime).slice(0, 10) : ''}`).join(', ');
    // human-readable screen conditions
    const conds: string[] = [];
    if (crossType && crossType !== 'both') conds.push(crossType);
    if (opts.minHistogramDelta != null) conds.push(`ヒストグラム≥${opts.minHistogramDelta}`);
    if (opts.maxBarsAgo != null) conds.push(`bars≤${opts.maxBarsAgo}`);
    if (opts.minReturnPct != null) conds.push(`return≥${opts.minReturnPct}%`);
    if (opts.maxReturnPct != null) conds.push(`return≤${opts.maxReturnPct}%`);
    if (opts.limit != null) conds.push(`top${opts.limit}`);
    const condStr = conds.length ? ` (全${totalFound}件中, 条件: ${conds.join(', ')})` : '';
    const baseSummaryMacd = formatSummary({ pair: 'multi', latest: undefined, extra: `crosses=${resultsScreened.length}${condStr}${brief ? ' [' + brief + ']' : ''}` });
    // テキスト summary に全クロスデータを含める（LLM が structuredContent.data を読めない対策）
    const crossLines = filtered.map((r, i) => {
      const date = r.crossDate ? String(r.crossDate).slice(0, 10) : '?';
      const ret = r.returnSinceCrossPct != null ? ` ret:${r.returnSinceCrossPct >= 0 ? '+' : ''}${r.returnSinceCrossPct}%` : '';
      const hd = r.histogramDelta != null ? ` histDelta:${r.histogramDelta}` : '';
      const prev = r.prevCross ? ` prev:${r.prevCross.type}(${r.prevCross.barsAgo}bars)` : '';
      return `[${i}] ${r.pair} ${r.type} @${date} barsAgo:${r.barsAgo} macd:${r.macdAtCross} sig:${r.signalAtCross}${hd}${ret}${prev}`;
    });
    const summary = baseSummaryMacd + `\n\n📋 全${filtered.length}件のクロス詳細:\n` + crossLines.join('\n')
      + `\n\n---\n📌 含まれるもの: MACDクロス検出（種類・日付・ヒストグラム差分・リターン率・前回クロス）`
      + `\n📌 含まれないもの: 他のテクニカル指標（RSI・BB等）、出来高分析、板情報`
      + `\n📌 補完ツール: analyze_indicators（全指標詳細）, analyze_market_signal（総合シグナル）, get_flow_metrics（出来高）`;
    const data: Record<string, unknown> = { results: resultsScreened };
    if (view === 'detailed') {
      data.resultsDetailed = resultsDetailed;
      data.screenedDetailed = filtered;
    }
    return ok(summary, data, { market, lookback, pairs: universe, view, screen: { ...opts, crossType, sortBy, sortOrder: opts.sortOrder || 'desc' } });
  } catch (e: unknown) {
    return failFromError(e);
  }
}

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'detect_macd_cross',
	description: `既にクロスした銘柄のスクリーニング専用。forming 中の検出は analyze_macd_pattern を使用。

市場内の銘柄で直近のMACDゴールデンクロス/デッドクロスを検出します（1day）。

view: summary|detailed（既定=summary）
- summary: 簡潔な一覧（高速スキャン用）
- detailed: クロス強度・価格変化等の詳細（分析用）
推奨: まず summary で全体把握 → 気になる銘柄のみ detailed で深掘り

lookback（既定=3）: 用途別の目安
- リアルタイム監視: 1-2
- 週次レビュー: 5-7

pairs で検査対象ペアを限定可能。

screen（任意）: スクリーニング用フィルタ/ソート
- minHistogramDelta: ヒストグラム変化の下限
- maxBarsAgo: 直近バー数以内
- minReturnPct: クロス以降の騰落率下限
- crossType: golden|dead|both
- sortBy: date|histogram|return|barsAgo（既定=date）
- sortOrder: asc|desc（既定=desc）
- limit: 上位N件`,
	inputSchema: z.object({ market: z.enum(['all', 'jpy']).default('all'), lookback: z.number().int().min(1).max(10).default(3), pairs: z.array(z.string()).optional(), view: z.enum(['summary', 'detailed']).optional().default('summary'), screen: z.object({ minHistogramDelta: z.number().optional(), maxBarsAgo: z.number().int().min(0).optional(), minReturnPct: z.number().optional(), crossType: z.enum(['golden', 'dead', 'both']).optional().default('both'), sortBy: z.enum(['date', 'histogram', 'return', 'barsAgo']).optional().default('date'), sortOrder: z.enum(['asc', 'desc']).optional().default('desc'), limit: z.number().int().min(1).max(100).optional(), withPrice: z.boolean().optional() }).optional() }),
	handler: async ({ market, lookback, pairs, view, screen }: any) => {
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
	},
};
