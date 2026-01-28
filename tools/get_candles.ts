import { fetchJson, BITBANK_API_BASE } from '../lib/http.js';
import { ensurePair, validateLimit, validateDate, createMeta } from '../lib/validate.js';
import { ok, fail } from '../lib/result.js';
import { GetCandlesOutputSchema } from '../src/schemas.js';
import { formatSummary } from '../lib/formatter.js';
import { toIsoTime } from '../lib/datetime.js';
import { getErrorMessage } from '../lib/error.js';
import type { Result, GetCandlesData, GetCandlesMeta, CandleType } from '../src/types/domain.d.ts';

const TYPES: Set<CandleType | string> = new Set([
  '1min',
  '5min',
  '15min',
  '30min',
  '1hour',
  '4hour',
  '8hour',
  '12hour',
  '1day',
  '1week',
  '1month',
]);

// 年単位でリクエストする時間足（YYYY形式）
const YEARLY_TYPES: Set<string> = new Set([
  '4hour',
  '8hour',
  '12hour',
  '1day',
  '1week',
  '1month',
]);

// 日単位でリクエストする時間足（YYYYMMDD形式）
const DAILY_TYPES: Set<string> = new Set([
  '1min',
  '5min',
  '15min',
  '30min',
  '1hour',
]);

// 時間足ごとの年間本数（複数年取得時の計算用）
const BARS_PER_YEAR: Record<string, number> = {
  '1month': 12,
  '1week': 52,
  '1day': 365,
  '12hour': 730,
  '8hour': 1095,
  '4hour': 2190,
};

// 時間足ごとの1日あたりの本数
const BARS_PER_DAY: Record<string, number> = {
  '1min': 1440,
  '5min': 288,
  '15min': 96,
  '30min': 48,
  '1hour': 24,
};

function todayYyyymmdd(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${m}${day}`;
}

// 単一年のデータを取得する内部関数
async function fetchSingleYear(
  pair: string,
  type: string,
  year: number
): Promise<Array<[unknown, unknown, unknown, unknown, unknown, unknown]>> {
  const url = `${BITBANK_API_BASE}/${pair}/candlestick/${type}/${year}`;
  try {
    const json: unknown = await fetchJson(url, { timeoutMs: 8000, retries: 2 });
    const jsonObj = json as { data?: { candlestick?: Array<{ ohlcv?: unknown[] }> } };
    const cs = jsonObj?.data?.candlestick?.[0];
    const ohlcvs = cs?.ohlcv ?? [];
    return ohlcvs as Array<[unknown, unknown, unknown, unknown, unknown, unknown]>;
  } catch {
    // 存在しない年や取得失敗は空配列を返す
    return [];
  }
}

// 単一日のデータを取得する内部関数
async function fetchSingleDay(
  pair: string,
  type: string,
  dateStr: string  // YYYYMMDD形式
): Promise<Array<[unknown, unknown, unknown, unknown, unknown, unknown]>> {
  const url = `${BITBANK_API_BASE}/${pair}/candlestick/${type}/${dateStr}`;
  try {
    const json: unknown = await fetchJson(url, { timeoutMs: 8000, retries: 2 });
    const jsonObj = json as { data?: { candlestick?: Array<{ ohlcv?: unknown[] }> } };
    const cs = jsonObj?.data?.candlestick?.[0];
    const ohlcvs = cs?.ohlcv ?? [];
    return ohlcvs as Array<[unknown, unknown, unknown, unknown, unknown, unknown]>;
  } catch {
    // 存在しない日や取得失敗は空配列を返す
    return [];
  }
}

// N日前の日付をYYYYMMDD形式で取得
function getDateNDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export default async function getCandles(
  pair: string,
  type: CandleType | string = '1day',
  date: string = todayYyyymmdd(),
  limit: number = 200
): Promise<Result<GetCandlesData, GetCandlesMeta>> {
  const chk = ensurePair(pair);
  if (!chk.ok) return fail(chk.error.message, chk.error.type);

  if (!TYPES.has(type)) {
    return fail(`type は ${[...TYPES].join(', ')} から選択してください（指定値: ${String(type)}）`, 'user');
  }

  const dateCheck = validateDate(date, String(type));
  if (!dateCheck.ok) return fail(dateCheck.error.message, dateCheck.error.type);

  // 複数年取得が必要かどうかを判定
  const isYearlyType = YEARLY_TYPES.has(type);
  const isDailyType = DAILY_TYPES.has(type);
  const barsPerYear = BARS_PER_YEAR[type] || 365;
  const barsPerDay = BARS_PER_DAY[type] || 24;
  
  // 年初付近では今年のデータだけでは足りない場合があるため、
  // 今年の経過日数も考慮して必要年数を計算
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.ceil((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24));
  const estimatedBarsThisYear = Math.floor(dayOfYear * (barsPerYear / 365));
  
  // limit が今年の推定本数を超える場合、または単純計算で複数年が必要な場合
  const yearsNeeded = isYearlyType 
    ? Math.max(Math.ceil(limit / barsPerYear), limit > estimatedBarsThisYear ? 2 : 1)
    : 1;
  const needsMultiYear = isYearlyType && yearsNeeded > 1;

  // 日単位タイプの場合、複数日取得が必要かどうかを判定
  const daysNeeded = isDailyType ? Math.ceil(limit / barsPerDay) + 1 : 1;  // +1 for buffer
  const needsMultiDay = isDailyType && daysNeeded > 1;

  // 複数年/複数日取得の場合は上限を緩和
  const maxLimit = needsMultiYear ? 5000 : (needsMultiDay ? 10000 : 1000);
  const limitCheck = validateLimit(limit, 1, maxLimit);
  if (!limitCheck.ok) return fail(limitCheck.error.message, limitCheck.error.type);

  let ohlcvs: unknown[] = [];
  let json: unknown = null;

  try {
    if (needsMultiYear) {
      // 複数年の並列取得
      const currentYear = new Date().getFullYear();
      const years = Array.from({ length: yearsNeeded }, (_, i) => currentYear - i);

      const results = await Promise.all(
        years.map(year => fetchSingleYear(chk.pair, type, year))
      );

      // 古い年順にマージ（時系列順）
      const allOhlcvs: Array<[unknown, unknown, unknown, unknown, unknown, unknown]> = [];
      for (let i = results.length - 1; i >= 0; i--) {
        allOhlcvs.push(...results[i]);
      }

      // タイムスタンプでソート（念のため）
      allOhlcvs.sort((a, b) => {
        const tsA = Number(a[5]) || 0;
        const tsB = Number(b[5]) || 0;
        return tsA - tsB;
      });

      ohlcvs = allOhlcvs;
      json = { data: { candlestick: [{ ohlcv: ohlcvs }] }, _multiYear: { years, totalFetched: ohlcvs.length } };
    } else if (needsMultiDay) {
      // 複数日の並列取得（1hour, 30min, etc.）
      // 最大同時リクエスト数を制限（API負荷対策）
      // bitbank API: レート制限があるため、控えめな設定に
      // 3並列 + バッチ間500ms遅延 → 約6リクエスト/秒
      const maxConcurrent = 3;
      const batchDelayMs = 500;
      const dates = Array.from({ length: daysNeeded }, (_, i) => getDateNDaysAgo(i));
      
      const allOhlcvs: Array<[unknown, unknown, unknown, unknown, unknown, unknown]> = [];
      
      // バッチ処理で並列取得（バッチ間に遅延を入れる）
      for (let i = 0; i < dates.length; i += maxConcurrent) {
        if (i > 0) {
          // バッチ間の遅延（レート制限対策）
          await new Promise(resolve => setTimeout(resolve, batchDelayMs));
        }
        const batch = dates.slice(i, i + maxConcurrent);
        const results = await Promise.all(
          batch.map(dateStr => fetchSingleDay(chk.pair, type, dateStr))
        );
        for (const result of results) {
          allOhlcvs.push(...result);
        }
      }

      // タイムスタンプでソート（古い順）
      allOhlcvs.sort((a, b) => {
        const tsA = Number(a[5]) || 0;
        const tsB = Number(b[5]) || 0;
        return tsA - tsB;
      });

      ohlcvs = allOhlcvs;
      json = { data: { candlestick: [{ ohlcv: ohlcvs }] }, _multiDay: { daysRequested: daysNeeded, totalFetched: ohlcvs.length } };
    } else {
      // 従来の単一リクエスト
      const url = `${BITBANK_API_BASE}/${chk.pair}/candlestick/${type}/${dateCheck.value}`;
      json = await fetchJson(url, { timeoutMs: 5000, retries: 2 });
      const jsonObj = json as { data?: { candlestick?: Array<{ ohlcv?: unknown[] }> } };
      const cs = jsonObj?.data?.candlestick?.[0];
      ohlcvs = cs?.ohlcv ?? [];
    }

    if (ohlcvs.length === 0) {
      return fail(`ローソク足データが見つかりません (${chk.pair} / ${type} / ${dateCheck.value})`, 'user');
    }

    const rows = ohlcvs.slice(-limitCheck.value) as Array<[unknown, unknown, unknown, unknown, unknown, unknown]>;

    const normalized = rows.map(([o, h, l, c, v, ts]) => ({
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close: Number(c),
      volume: Number(v),
      isoTime: toIsoTime(ts) ?? undefined,
    }));

    // 期間別のキーポイントを抽出
    const totalItems = normalized.length;
    const today = normalized[totalItems - 1];
    const sevenDaysAgo = totalItems >= 8 ? normalized[totalItems - 1 - 7] : null;
    const thirtyDaysAgo = totalItems >= 31 ? normalized[totalItems - 1 - 30] : null;
    const ninetyDaysAgo = totalItems >= 91 ? normalized[totalItems - 1 - 90] : totalItems > 0 ? normalized[0] : null;

    // 変化率を計算
    const calcChange = (from: number | undefined, to: number | undefined) => {
      if (!from || !to) return null;
      return ((to - from) / from) * 100;
    };

    // 出来高情報を計算
    const calcVolumeStats = () => {
      if (totalItems < 14) return null;

      // 直近7日間の平均出来高
      const recent7Days = normalized.slice(totalItems - 7, totalItems);
      const recent7DaysAvg = recent7Days.reduce((sum, c) => sum + c.volume, 0) / 7;

      // その前7日間（8〜14日前）の平均出来高
      const previous7Days = normalized.slice(totalItems - 14, totalItems - 7);
      const previous7DaysAvg = previous7Days.reduce((sum, c) => sum + c.volume, 0) / 7;

      // 過去30日間の平均出来高（データが30本以上ある場合）
      let last30DaysAvg: number | null = null;
      if (totalItems >= 30) {
        const last30 = normalized.slice(totalItems - 30, totalItems);
        last30DaysAvg = last30.reduce((sum, c) => sum + c.volume, 0) / last30.length;
      }

      // 変化率（直近7日 vs その前7日）
      const volumeChangePct = ((recent7DaysAvg - previous7DaysAvg) / previous7DaysAvg) * 100;

      // 判定
      let judgment = 'ほぼ変わりません';
      if (volumeChangePct > 20) judgment = '活発になっています';
      else if (volumeChangePct < -20) judgment = '落ち着いています';

      return {
        recent7DaysAvg: Number(recent7DaysAvg.toFixed(2)),
        previous7DaysAvg: Number(previous7DaysAvg.toFixed(2)),
        last30DaysAvg: last30DaysAvg != null ? Number(last30DaysAvg.toFixed(2)) : null,
        changePct: Number(volumeChangePct.toFixed(1)),
        judgment,
      };
    };

    const volumeStats = calcVolumeStats();

    const keyPoints = {
      today: today ? {
        index: totalItems - 1,
        date: today.isoTime?.split('T')[0] || null,
        close: today.close,
      } : null,
      sevenDaysAgo: sevenDaysAgo ? {
        index: totalItems - 1 - 7,
        date: sevenDaysAgo.isoTime?.split('T')[0] || null,
        close: sevenDaysAgo.close,
        changePct: calcChange(sevenDaysAgo.close, today?.close),
      } : null,
      thirtyDaysAgo: thirtyDaysAgo ? {
        index: totalItems - 1 - 30,
        date: thirtyDaysAgo.isoTime?.split('T')[0] || null,
        close: thirtyDaysAgo.close,
        changePct: calcChange(thirtyDaysAgo.close, today?.close),
      } : null,
      ninetyDaysAgo: ninetyDaysAgo ? {
        index: ninetyDaysAgo === normalized[0] ? 0 : totalItems - 1 - 90,
        date: ninetyDaysAgo.isoTime?.split('T')[0] || null,
        close: ninetyDaysAgo.close,
        changePct: calcChange(ninetyDaysAgo.close, today?.close),
      } : null,
    };

    // 全件の価格範囲を計算
    const priceRange = normalized.length > 0 ? {
      high: Math.max(...normalized.map(c => c.high)),
      low: Math.min(...normalized.map(c => c.low)),
      periodStart: normalized[0].isoTime?.split('T')[0] || '',
      periodEnd: normalized[normalized.length - 1].isoTime?.split('T')[0] || '',
    } : undefined;

    const summary = formatSummary({
      pair: chk.pair,
      timeframe: String(type),
      latest: normalized.at(-1)?.close,
      totalItems,
      keyPoints,
      volumeStats,
      priceRange,
    });

    const metaExtra: Record<string, unknown> = { type, count: normalized.length };
    if (needsMultiYear) {
      metaExtra.multiYear = {
        yearsRequested: yearsNeeded,
        totalFetched: ohlcvs.length,
        limitApplied: limitCheck.value,
      };
    }

    const result = ok<GetCandlesData, GetCandlesMeta>(
      summary,
      { raw: json, normalized, keyPoints, volumeStats } as GetCandlesData,
      createMeta(chk.pair, metaExtra) as GetCandlesMeta
    );
    return GetCandlesOutputSchema.parse(result) as unknown as Result<GetCandlesData, GetCandlesMeta>;
  } catch (e: unknown) {
    const rawMsg = getErrorMessage(e);
    const t = String(type);
    if (/404/.test(rawMsg) && ['4hour', '8hour', '12hour'].includes(t)) {
      const hint = `${t} は YYYY 形式（例: 2025）が必要です。なお、現在この時間足がAPIで提供されていない可能性もあります。1hour または 1day での取得もお試しください。`;
      return GetCandlesOutputSchema.parse(fail(`HTTP 404 Not Found (${chk.pair}/${t}). ${hint}`, 'user')) as unknown as Result<GetCandlesData, GetCandlesMeta>;
    }
    return GetCandlesOutputSchema.parse(fail(rawMsg || 'ネットワークエラー', 'network')) as unknown as Result<GetCandlesData, GetCandlesMeta>;
  }
}


