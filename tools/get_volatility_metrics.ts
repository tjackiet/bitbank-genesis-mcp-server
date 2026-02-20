import getCandles from './get_candles.js';
import { ok, fail, failFromError, failFromValidation } from '../lib/result.js';
import { ensurePair, validateLimit, createMeta } from '../lib/validate.js';
import { formatSummary } from '../lib/formatter.js';
import { stddev, slidingStddev, slidingMean } from '../lib/math.js';
import { nowIso } from '../lib/datetime.js';
import { GetVolMetricsOutputSchema } from '../src/schemas.js';

type Candle = { open: number; high: number; low: number; close: number; isoTime?: string | null };

function baseIntervalMsOf(type: string): number {
  switch (type) {
    case '1min': return 60_000;
    case '5min': return 5 * 60_000;
    case '15min': return 15 * 60_000;
    case '30min': return 30 * 60_000;
    case '1hour': return 60 * 60_000;
    case '4hour': return 4 * 60 * 60_000;
    case '8hour': return 8 * 60 * 60_000;
    case '12hour': return 12 * 60 * 60_000;
    case '1day': return 24 * 60 * 60_000;
    case '1week': return 7 * 24 * 60 * 60_000;
    case '1month': return 30 * 24 * 60 * 60_000; // approx
    default: return 24 * 60 * 60_000;
  }
}

function periodsPerYear(type: string): number {
  const secondsPerYear = 365 * 24 * 60 * 60;
  const intervalSec = baseIntervalMsOf(type) / 1000;
  return Math.max(1, Math.floor(secondsPerYear / intervalSec));
}

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function safeLog(x: number): number {
  return Math.log(Math.max(x, 1e-12));
}



export default async function getVolatilityMetrics(
  pair: string,
  type: string = '1day',
  limit: number = 200,
  windows: number[] = [14, 20, 30],
  opts?: { useLogReturns?: boolean; annualize?: boolean; tz?: string; cacheTtlMs?: number }
) {
  const chk = ensurePair(pair);
  if (!chk.ok) return failFromValidation(chk, GetVolMetricsOutputSchema) as any;
  const lim = validateLimit(limit, 20, 500);
  if (!lim.ok) return failFromValidation(lim, GetVolMetricsOutputSchema) as any;

  try {
    const cRes: any = await getCandles(chk.pair, type, undefined as any, lim.value);
    if (!cRes?.ok) return GetVolMetricsOutputSchema.parse(fail(cRes?.summary || 'failed', (cRes?.meta as any)?.errorType || 'internal')) as any;
    const candles: Candle[] = (cRes.data?.normalized || []) as any[];
    if (!Array.isArray(candles) || candles.length < 20) {
      return GetVolMetricsOutputSchema.parse(fail('データ不足（最低20本必要）', 'user')) as any;
    }

    const useLog = opts?.useLogReturns ?? true;
    const withAnn = opts?.annualize ?? true;

    const ts: number[] = [];
    const close: number[] = [];
    for (const c of candles) {
      const t = toMs(c.isoTime ?? null);
      if (t != null) ts.push(t);
      else ts.push(ts.length > 0 ? ts[ts.length - 1] + baseIntervalMsOf(type) : Date.now());
      close.push(Number(c.close));
    }

    const ret: number[] = [];
    for (let i = 1; i < close.length; i++) {
      const prev = close[i - 1];
      const curr = close[i];
      if (prev > 0 && curr > 0) {
        ret.push(useLog ? safeLog(curr / prev) : (curr - prev) / prev);
      } else {
        ret.push(0);
      }
    }
    const rvInst = ret.map((r) => Math.abs(r));

    // Per-candle components for OHLC-based estimators
    const pkSeries: number[] = [];
    const gkSeries: number[] = [];
    const rsSeries: number[] = [];
    const trSeries: number[] = [];
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const o = Number(c.open);
      const h = Number(c.high);
      const l = Number(c.low);
      const cl = Number(c.close);
      const logHL = safeLog(h / Math.max(l, 1e-12));
      const logCO = safeLog(cl / Math.max(o, 1e-12));
      const pk = logHL * logHL; // (ln(H/L))^2
      const gk = 0.5 * pk - (2 * Math.log(2) - 1) * (logCO * logCO);
      const rs = safeLog(h / Math.max(cl, 1e-12)) * safeLog(h / Math.max(o, 1e-12)) + safeLog(l / Math.max(cl, 1e-12)) * safeLog(l / Math.max(o, 1e-12));
      pkSeries.push(pk);
      gkSeries.push(gk);
      rsSeries.push(rs);
      // True Range
      const prevClose = i > 0 ? Number(candles[i - 1].close) : cl;
      const tr = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
      trSeries.push(tr);
    }

    // Aggregates over whole sample (use returns length for rv)
    const rvStd = stddev(ret);
    const pkMean = pkSeries.slice(1).reduce((s, v) => s + v, 0) / Math.max(1, pkSeries.length - 1);
    const gkMean = gkSeries.slice(1).reduce((s, v) => s + v, 0) / Math.max(1, gkSeries.length - 1);
    const rsMean = rsSeries.slice(1).reduce((s, v) => s + v, 0) / Math.max(1, rsSeries.length - 1);
    const parkinson = Math.sqrt(Math.max(0, pkMean / (4 * Math.log(2))));
    const garmanKlass = Math.sqrt(Math.max(0, gkMean));
    const rogersSatchell = Math.sqrt(Math.max(0, rsMean));

    // ATR aggregate: use first window (default 14) SMA on TR, take last
    const primaryWindow = Math.max(2, (windows && windows[0]) || 14);
    const atrSeries = slidingMean(trSeries.slice(1), primaryWindow);
    const atrAgg = atrSeries.length > 0 ? atrSeries[atrSeries.length - 1] : 0;

    const annFactor = withAnn ? Math.sqrt(periodsPerYear(type)) : 1;
    const rvStdAnn = withAnn ? rvStd * annFactor : undefined;

    // Rolling per requested windows
    const rollingOut: Array<{ window: number; rv_std: number; rv_std_ann?: number; atr?: number; parkinson?: number; garmanKlass?: number; rogersSatchell?: number }> = [];
    for (const wRaw of windows) {
      const w = Math.max(2, Math.min(wRaw | 0, ret.length));
      if (w > ret.length) continue;
      const rvStdRoll = slidingStddev(ret, w);
      const rvStdLatest = rvStdRoll.at(-1) ?? 0;
      const rvStdAnnLatest = withAnn ? rvStdLatest * annFactor : undefined;
      const pkRoll = slidingMean(pkSeries.slice(1), w); // align to returns index
      const gkRoll = slidingMean(gkSeries.slice(1), w);
      const rsRoll = slidingMean(rsSeries.slice(1), w);
      const atrRoll = slidingMean(trSeries.slice(1), w);
      const p = pkRoll.length ? Math.sqrt(Math.max(0, (pkRoll.at(-1) as number) / (4 * Math.log(2)))) : undefined;
      const gk = gkRoll.length ? Math.sqrt(Math.max(0, gkRoll.at(-1) as number)) : undefined;
      const rs = rsRoll.length ? Math.sqrt(Math.max(0, rsRoll.at(-1) as number)) : undefined;
      const atr = atrRoll.length ? (atrRoll.at(-1) as number) : undefined;
      rollingOut.push({ window: w, rv_std: rvStdLatest, rv_std_ann: rvStdAnnLatest, atr, parkinson: p, garmanKlass: gk, rogersSatchell: rs });
    }

    // Tags (simple heuristic on annualized RV if available)
    const tags: string[] = [];
    const rvRef = rvStdAnn ?? rvStd;
    if (rvRef >= 0.8) tags.push('volatile');
    else if (rvRef <= 0.3) tags.push('calm');

    const data = {
      meta: {
        pair: chk.pair,
        type: String(type),
        fetchedAt: nowIso(),
        baseIntervalMs: baseIntervalMsOf(type),
        sampleSize: candles.length,
        windows: [...windows],
        annualize: withAnn,
        useLogReturns: useLog,
        source: 'bitbank:candlestick' as const,
      },
      aggregates: {
        rv_std: Number(rvStd.toFixed(8)),
        rv_std_ann: withAnn ? Number((rvStdAnn as number).toFixed(8)) : undefined,
        parkinson: Number(parkinson.toFixed(8)),
        garmanKlass: Number(garmanKlass.toFixed(8)),
        rogersSatchell: Number(rogersSatchell.toFixed(8)),
        atr: Number(atrAgg.toFixed(8)),
      },
      rolling: rollingOut.map(r => ({
        window: r.window,
        rv_std: Number(r.rv_std.toFixed(8)),
        rv_std_ann: r.rv_std_ann != null ? Number(r.rv_std_ann.toFixed(8)) : undefined,
        atr: r.atr != null ? Number(r.atr.toFixed(8)) : undefined,
        parkinson: r.parkinson != null ? Number(r.parkinson.toFixed(8)) : undefined,
        garmanKlass: r.garmanKlass != null ? Number(r.garmanKlass.toFixed(8)) : undefined,
        rogersSatchell: r.rogersSatchell != null ? Number(r.rogersSatchell.toFixed(8)) : undefined,
      })),
      series: {
        ts,
        close,
        ret: ret.map((v) => Number(v.toFixed(8))),
        rv_inst: rvInst.map((v) => Number(v.toFixed(8))),
      },
      tags,
    };

    const baseSummaryVol = formatSummary({
      pair: chk.pair,
      timeframe: String(type),
      latest: close.at(-1),
      extra: `rv=${(rvRef).toFixed(3)}${withAnn ? '(ann)' : ''}${tags.length ? ' ' + tags.join(',') : ''}`,
    });
    // テキスト summary にボラティリティ詳細を含める（LLM が structuredContent.data を読めない対策）
    const aggLines = [
      `rv_std:${data.aggregates.rv_std}`,
      data.aggregates.rv_std_ann != null ? `rv_std_ann:${data.aggregates.rv_std_ann}` : '',
      `parkinson:${data.aggregates.parkinson}`,
      `garmanKlass:${data.aggregates.garmanKlass}`,
      `rogersSatchell:${data.aggregates.rogersSatchell}`,
      `atr:${data.aggregates.atr}`,
    ].filter(Boolean).join(' ');
    const rollLines = rollingOut.map((r) => {
      const parts = [`w=${r.window} rv:${r.rv_std.toFixed(6)}`];
      if (r.rv_std_ann != null) parts.push(`ann:${r.rv_std_ann.toFixed(6)}`);
      if (r.atr != null) parts.push(`atr:${r.atr.toFixed(2)}`);
      if (r.parkinson != null) parts.push(`pk:${r.parkinson.toFixed(6)}`);
      return parts.join(' ');
    });
    const summary = baseSummaryVol
      + `\n\naggregates: ${aggLines}`
      + `\n\n📊 ローリング分析:\n` + rollLines.join('\n')
      + `\n\n---\n📌 含まれるもの: ボラティリティ指標（RV・Parkinson・GK・RS・ATR）、ローリング分析`
      + `\n📌 含まれないもの: 価格の方向性・トレンド、出来高フロー、板情報、テクニカル指標`
      + `\n📌 補完ツール: get_candles（価格OHLCV）, analyze_indicators（方向性指標）, get_flow_metrics（出来高フロー）`;

    const meta = createMeta(chk.pair, { type, count: candles.length });
    return GetVolMetricsOutputSchema.parse(ok(summary, data as any, meta as any)) as any;
  } catch (e: unknown) {
    return failFromError(e, { schema: GetVolMetricsOutputSchema }) as any;
  }
}


