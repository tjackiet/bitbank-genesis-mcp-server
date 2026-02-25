import getTransactions from './get_transactions.js';
import { ok, fail, failFromError, failFromValidation } from '../lib/result.js';
import { createMeta, ensurePair, validateLimit } from '../lib/validate.js';
import { formatSummary } from '../lib/formatter.js';
import { toIsoTime, toIsoWithTz, toDisplayTime, dayjs } from '../lib/datetime.js';
import { GetFlowMetricsOutputSchema } from '../src/schemas.js';

type Tx = { price: number; amount: number; side: 'buy' | 'sell'; timestampMs: number; isoTime: string };

/** 複数の getTransactions 結果をマージし重複を除去する */
function mergeTxResults(results: unknown[]): Tx[] {
  const seen = new Set<string>();
  const merged: Tx[] = [];
  for (const res of results) {
    const r = res as { ok?: boolean; data?: { normalized?: Tx[] } } | null;
    if (r?.ok && Array.isArray(r.data?.normalized)) {
      for (const tx of r.data.normalized as Tx[]) {
        const key = `${tx.timestampMs}:${tx.price}:${tx.amount}:${tx.side}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(tx);
        }
      }
    }
  }
  return merged;
}

export default async function getFlowMetrics(
  pair: string = 'btc_jpy',
  limit: number = 100,
  date?: string,
  bucketMs: number = 60_000,
  tz: string = 'Asia/Tokyo',
  hours?: number
) {
  const chk = ensurePair(pair);
  if (!chk.ok) return failFromValidation(chk, GetFlowMetricsOutputSchema) as any;

  try {
    let txs: Tx[];

    if (hours != null && hours > 0) {
      // === 時間範囲ベースの取得 ===
      const nowMs = Date.now();
      const sinceMs = nowMs - hours * 3600_000;

      // bitbank API は JST 基準の日付を使用するため、JST で日付計算
      const sinceDayjs = dayjs(sinceMs).tz('Asia/Tokyo');
      const nowDayjs = dayjs(nowMs).tz('Asia/Tokyo');
      const todayStr = nowDayjs.format('YYYYMMDD');

      // 必要な日付を YYYYMMDD (JST) 形式で列挙（古い順）
      const dates: string[] = [];
      let d = sinceDayjs.startOf('day');
      while (d.isBefore(nowDayjs) || d.isSame(nowDayjs, 'day')) {
        dates.push(d.format('YYYYMMDD'));
        d = d.add(1, 'day');
      }

      // 過去日（JST）は日付指定エンドポイントで取得
      // 当日（JST）は日付指定だと空/不完全な場合があるため latest で取得
      const pastDates = dates.filter(ds => ds !== todayStr);
      const fetches: Promise<unknown>[] = pastDates.map(ds => getTransactions(chk.pair, 1000, ds));
      fetches.push(getTransactions(chk.pair, 1000)); // latest（日付なし）

      const results = await Promise.all(fetches);
      const allTxs = mergeTxResults(results);

      txs = allTxs
        .filter(t => t.timestampMs >= sinceMs && t.timestampMs <= nowMs)
        .sort((a, b) => a.timestampMs - b.timestampMs);
    } else {
      // === 件数ベース取得 ===
      const lim = validateLimit(limit, 1, 2000);
      if (!lim.ok) return failFromValidation(lim, GetFlowMetricsOutputSchema) as any;

      if (date) {
        // 明示的な日付指定がある場合はそのまま取得
        const txRes = await getTransactions(chk.pair, Math.min(lim.value, 1000), date);
        if (!txRes?.ok) return GetFlowMetricsOutputSchema.parse(fail(txRes?.summary || 'failed', (txRes?.meta as any)?.errorType || 'internal')) as any;
        txs = txRes.data.normalized as Tx[];
      } else {
        // 日付指定なし: latest で取得し、不足なら日付ベースで補完
        const latestRes = await getTransactions(chk.pair, Math.min(lim.value, 1000));
        const latestTxs = (latestRes?.ok ? latestRes.data.normalized : []) as Tx[];

        if (latestTxs.length >= lim.value) {
          txs = latestTxs;
        } else {
          // latest の返却数が不足 → 前日・前々日の日付ベース取得で補完
          // bitbank の latest エンドポイントは約60件のみ返却するため
          const todayJst = dayjs().tz('Asia/Tokyo');
          const supplementFetches: Promise<unknown>[] = [
            getTransactions(chk.pair, 1000, todayJst.subtract(1, 'day').format('YYYYMMDD')),
          ];
          if (lim.value > 500) {
            supplementFetches.push(
              getTransactions(chk.pair, 1000, todayJst.subtract(2, 'day').format('YYYYMMDD'))
            );
          }
          const supplementResults = await Promise.all(supplementFetches);
          const merged = mergeTxResults([latestRes, ...supplementResults]);
          txs = merged
            .sort((a, b) => a.timestampMs - b.timestampMs)
            .slice(-lim.value);
        }
      }
    }
    if (!Array.isArray(txs) || txs.length === 0) {
      return GetFlowMetricsOutputSchema.parse(ok('no transactions', {
        source: 'transactions',
        params: { bucketMs },
        aggregates: {
          totalTrades: 0,
          buyTrades: 0,
          sellTrades: 0,
          buyVolume: 0,
          sellVolume: 0,
          netVolume: 0,
          aggressorRatio: 0,
          finalCvd: 0,
        },
        series: { buckets: [] },
      }, createMeta(chk.pair, { count: 0, bucketMs }))) as any;
    }

    // バケット分割
    const t0 = txs[0].timestampMs;
    const buckets: Array<{ ts: number; buys: number; sells: number; vBuy: number; vSell: number }> = [];
    const idx = (ms: number) => Math.floor((ms - t0) / bucketMs);
    for (const t of txs) {
      const k = idx(t.timestampMs);
      while (buckets.length <= k) buckets.push({ ts: t0 + buckets.length * bucketMs, buys: 0, sells: 0, vBuy: 0, vSell: 0 });
      if (t.side === 'buy') { buckets[k].buys++; buckets[k].vBuy += t.amount; }
      else { buckets[k].sells++; buckets[k].vSell += t.amount; }
    }

    // CVD とスパイク
    const outBuckets: Array<{ timestampMs: number; isoTime: string; isoTimeJST?: string; displayTime?: string; buyVolume: number; sellVolume: number; totalVolume: number; cvd: number; zscore: number | null; spike: 'notice' | 'warning' | 'strong' | null }>
      = [];
    let cvd = 0;
    const vols = buckets.map(b => b.vBuy + b.vSell);
    const mean = vols.reduce((a, b) => a + b, 0) / Math.max(1, vols.length);
    const variance = vols.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / Math.max(1, vols.length);
    const stdev = Math.sqrt(variance);
    const spikeLevel = (z: number): 'notice' | 'warning' | 'strong' | null => {
      if (!Number.isFinite(z)) return null;
      if (z >= 3) return 'strong';
      if (z >= 2) return 'warning';
      if (z >= 1.5) return 'notice';
      return null;
    };

    for (const b of buckets) {
      const vol = b.vBuy + b.vSell;
      cvd += b.vBuy - b.vSell;
      const z = stdev > 0 ? (vol - mean) / stdev : 0;
      const ts = b.ts + bucketMs - 1;
      outBuckets.push({
        timestampMs: ts,
        isoTime: toIsoTime(ts) ?? '',
        isoTimeJST: toIsoWithTz(ts, tz) ?? undefined,
        displayTime: toDisplayTime(ts, tz) ?? undefined,
        buyVolume: Number(b.vBuy.toFixed(8)),
        sellVolume: Number(b.vSell.toFixed(8)),
        totalVolume: Number(vol.toFixed(8)),
        cvd: Number(cvd.toFixed(8)),
        zscore: Number.isFinite(z) ? Number(z.toFixed(2)) : null,
        spike: spikeLevel(z),
      });
    }

    const totalTrades = txs.length;
    const buyTrades = txs.filter(t => t.side === 'buy').length;
    const sellTrades = totalTrades - buyTrades;
    const buyVolume = txs.filter(t => t.side === 'buy').reduce((s, t) => s + t.amount, 0);
    const sellVolume = txs.filter(t => t.side === 'sell').reduce((s, t) => s + t.amount, 0);
    const netVolume = buyVolume - sellVolume;
    const aggressorRatio = totalTrades > 0 ? Number((buyTrades / totalTrades).toFixed(3)) : 0;

    // スパイク情報を集計（spike が null でないものをフィルタ）
    const spikes = outBuckets.filter(b => b.spike !== null);
    let spikeInfo = '';
    if (spikes.length > 0) {
      const spikeDetails = spikes.slice(0, 3).map(s => {
        const time = s.displayTime || s.isoTime || '';
        const level = s.spike === 'strong' ? '🚨強' : s.spike === 'warning' ? '⚠️中' : '📈弱';
        const direction = s.cvd > 0 ? '買い' : '売り';
        return `${time}(${level}${direction})`;
      }).join(', ');
      spikeInfo = ` | スパイク${spikes.length}件: ${spikeDetails}`;
    } else {
      spikeInfo = ' | スパイクなし';
    }

    const baseSummary = formatSummary({
      pair: chk.pair,
      latest: txs.at(-1)?.price,
      extra: `trades=${totalTrades} buy%=${(aggressorRatio * 100).toFixed(1)} CVD=${cvd.toFixed(2)}${spikeInfo}`,
    });
    // テキスト summary に全バケットデータを含める（LLM が structuredContent.data を読めない対策）
    const bucketLines = outBuckets.map((b, i) => {
      const t = b.displayTime || b.isoTimeJST || b.isoTime || '?';
      const sp = b.spike ? ` spike:${b.spike}` : '';
      return `[${i}] ${t} buy:${b.buyVolume} sell:${b.sellVolume} cvd:${b.cvd} z:${b.zscore ?? 'n/a'}${sp}`;
    });
    const summary = baseSummary
      + `\naggregates: totalTrades=${totalTrades} buyVol=${Number(buyVolume.toFixed(4))} sellVol=${Number(sellVolume.toFixed(4))} netVol=${Number(netVolume.toFixed(4))} aggRatio=${aggressorRatio} finalCvd=${Number(cvd.toFixed(4))}`
      + `\n\n📋 全${outBuckets.length}件のバケット (${bucketMs}ms間隔):\n` + bucketLines.join('\n')
      + `\n\n---\n📌 含まれるもの: 時系列バケット（買い/売り出来高・CVD・Zスコア・スパイク）、集計値`
      + `\n📌 含まれないもの: 個別約定の詳細、OHLCV価格データ、板情報、テクニカル指標`
      + `\n📌 補完ツール: get_transactions（個別約定）, get_candles（OHLCV）, get_orderbook（板情報）, analyze_indicators（指標）`;

    const data = {
      source: 'transactions' as const,
      params: { bucketMs },
      aggregates: {
        totalTrades,
        buyTrades,
        sellTrades,
        buyVolume: Number(buyVolume.toFixed(8)),
        sellVolume: Number(sellVolume.toFixed(8)),
        netVolume: Number(netVolume.toFixed(8)),
        aggressorRatio,
        finalCvd: Number(cvd.toFixed(8)),
      },
      series: { buckets: outBuckets },
    };

    const offsetMin = dayjs().utcOffset();
    const offset = `${offsetMin >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0')}:${String(Math.abs(offsetMin) % 60).padStart(2, '0')}`;
    const metaExtra: Record<string, unknown> = { count: totalTrades, bucketMs, timezone: tz, timezoneOffset: offset, serverTime: toIsoWithTz(Date.now(), tz) ?? undefined };
    if (hours != null) {
      metaExtra.hours = hours;
      metaExtra.mode = 'time_range';
    }
    const meta = createMeta(chk.pair, metaExtra);
    return GetFlowMetricsOutputSchema.parse(ok(summary, data as any, meta as any)) as any;
  } catch (e: unknown) {
    return failFromError(e, { schema: GetFlowMetricsOutputSchema }) as any;
  }
}



