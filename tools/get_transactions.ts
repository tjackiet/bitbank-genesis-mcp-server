import { fetchJson, BITBANK_API_BASE, DEFAULT_RETRIES } from '../lib/http.js';
import { ensurePair, validateLimit, createMeta } from '../lib/validate.js';
import { ok, fail, failFromError, failFromValidation } from '../lib/result.js';
import { formatPair, formatPrice } from '../lib/formatter.js';
import { toIsoMs, dayjs } from '../lib/datetime.js';
import { GetTransactionsOutputSchema } from '../src/schemas.js';

type TxnRaw = Record<string, unknown>;

function toMs(input: unknown): number | null {
  if (input == null) return null;
  const n = Number(input);
  if (!Number.isFinite(n)) return null;
  return n < 1e12 ? Math.floor(n * 1000) : Math.floor(n);
}

function normalizeSide(v: unknown): 'buy' | 'sell' | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'buy') return 'buy';
  if (s === 'sell') return 'sell';
  return null;
}

type NormalizedTxn = { price: number; amount: number; side: 'buy' | 'sell'; timestampMs: number; isoTime: string };

/**
 * 取引サマリを生成
 */
function formatTransactionsSummary(
  pair: string,
  transactions: NormalizedTxn[],
  buys: number,
  sells: number
): string {
  const pairDisplay = formatPair(pair);
  const isJpy = pair.toLowerCase().includes('jpy');
  const baseCurrency = pair.split('_')[0]?.toUpperCase() ?? '';
  const lines: string[] = [];

  const fmtPx = (price: number) => formatPrice(price, pair);

  const formatTime = (ms: number): string => {
    return dayjs(ms).tz('Asia/Tokyo').format('HH:mm:ss');
  };

  lines.push(`${pairDisplay} 直近取引 ${transactions.length}件`);

  if (transactions.length > 0) {
    const latestTxn = transactions[transactions.length - 1];
    lines.push(`最新約定: ${fmtPx(latestTxn.price)}`);

    // 買い/売り比率
    const total = buys + sells;
    const buyRatio = total > 0 ? Math.round((buys / total) * 100) : 0;
    const sellRatio = 100 - buyRatio;
    const dominant = buyRatio >= 60 ? '買い優勢' : buyRatio <= 40 ? '売り優勢' : '拮抗';
    const dominantRatio = buyRatio >= 60 ? buyRatio : buyRatio <= 40 ? sellRatio : buyRatio;
    lines.push(`買い: ${buys}件 / 売り: ${sells}件（${dominant} ${dominantRatio}%）`);

    // 出来高合計
    const totalVolume = transactions.reduce((sum, t) => sum + t.amount, 0);
    const volStr = totalVolume >= 1 ? totalVolume.toFixed(4) : totalVolume.toFixed(6);
    lines.push(`出来高: ${volStr} ${baseCurrency}`);

    // 期間
    const oldest = transactions[0];
    const newest = transactions[transactions.length - 1];
    lines.push(`期間: ${formatTime(oldest.timestampMs)}〜${formatTime(newest.timestampMs)}`);
  }

  return lines.join('\n');
}

export default async function getTransactions(
  pair: string = 'btc_jpy',
  limit: number = 100,
  date?: string
) {
  const chk = ensurePair(pair);
  if (!chk.ok) return failFromValidation(chk, GetTransactionsOutputSchema) as any;

  const lim = validateLimit(limit, 1, 1000);
  if (!lim.ok) return failFromValidation(lim, GetTransactionsOutputSchema) as any;

  const url = date && /\d{8}/.test(String(date))
    ? `${BITBANK_API_BASE}/${chk.pair}/transactions/${date}`
    : `${BITBANK_API_BASE}/${chk.pair}/transactions`;

  try {
    const json: unknown = await fetchJson(url, { timeoutMs: 4000, retries: DEFAULT_RETRIES });
    const jsonObj = json as { data?: { transactions?: TxnRaw[] } };
    const arr: TxnRaw[] = (jsonObj?.data?.transactions ?? []) as TxnRaw[];

    const items = arr
      .map((t) => {
        const price = Number(t.price);
        const amount = Number(t.amount ?? t.size);
        const side = normalizeSide(t.side);
        const ms = toMs(t.executed_at ?? t.timestamp ?? t.date);
        const isoTime = toIsoMs(ms);
        if (!Number.isFinite(price) || !Number.isFinite(amount) || side == null || isoTime == null) return null;
        return { price, amount, side, timestampMs: ms as number, isoTime };
      })
      .filter(Boolean) as NormalizedTxn[];

    const sorted = items.sort((a, b) => a.timestampMs - b.timestampMs);
    const latest = sorted.slice(-lim.value);

    const buys = latest.filter((t) => t.side === 'buy').length;
    const sells = latest.filter((t) => t.side === 'sell').length;
    const baseSummary = formatTransactionsSummary(chk.pair, latest, buys, sells);
    // テキスト summary に全取引データを含める（LLM が structuredContent.data を読めない対策）
    const txLines = latest.map((t, i) => {
      const time = dayjs(t.timestampMs).tz('Asia/Tokyo').format('HH:mm:ss');
      return `[${i}] ${time} ${t.side} ${t.price} x${t.amount}`;
    });
    const summary = baseSummary + `\n\n📋 全${latest.length}件の取引:\n` + txLines.join('\n')
      + `\n\n---\n📌 含まれるもの: 個別約定（時刻・売買方向・価格・数量）、買い/売り件数比率`
      + `\n📌 含まれないもの: 集計済みフロー指標（CVD・Zスコア・スパイク）、OHLCV、板情報`
      + `\n📌 補完ツール: get_flow_metrics（集計フロー・CVD・スパイク検出）, get_candles（OHLCV）, get_orderbook（板情報）`;

    const data = { raw: json, normalized: latest };
    const meta = createMeta(chk.pair, { count: latest.length, source: date ? 'by_date' : 'latest' });
    return GetTransactionsOutputSchema.parse(ok(summary, data as any, meta as any)) as any;
  } catch (e: unknown) {
    return failFromError(e, { schema: GetTransactionsOutputSchema, defaultType: 'network', defaultMessage: 'ネットワークエラー' }) as any;
  }
}



