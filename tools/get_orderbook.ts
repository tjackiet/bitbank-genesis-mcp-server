/**
 * get_orderbook — 統合板情報ツール
 *
 * mode で分析粒度を切り替え、内部では単一の /depth API 呼出しで全モードをカバー。
 *
 * | mode        | 旧ツール                  | 概要                                       |
 * |-------------|---------------------------|--------------------------------------------|
 * | summary     | get_orderbook             | 上位N層の正規化＋累計サイズ＋spread          |
 * | pressure    | get_orderbook_pressure    | 帯域(±0.1%/0.5%/1%等)別 買い/売り圧力        |
 * | statistics  | get_orderbook_statistics  | 範囲分析＋流動性ゾーン＋大口注文＋総合評価     |
 * | raw         | get_depth                 | 生の bids/asks 配列＋壁ゾーン自動推定          |
 */

import { ensurePair, validateLimit, createMeta } from '../lib/validate.js';
import { ok, fail, failFromError, failFromValidation } from '../lib/result.js';
import { formatSummary, formatTimestampJST } from '../lib/formatter.js';
import { toIsoTime } from '../lib/datetime.js';
import { fetchJson, BITBANK_API_BASE, DEFAULT_RETRIES } from '../lib/http.js';
import { estimateZones } from '../lib/depth-analysis.js';
import type { OrderbookLevelWithCum } from '../src/types/domain.d.ts';

export type OrderbookMode = 'summary' | 'pressure' | 'statistics' | 'raw';

export interface GetOrderbookParams {
  pair?: string;
  mode?: OrderbookMode;
  /** summary mode: 上位N層 (1-200, default 10) */
  topN?: number;
  /** pressure mode: 帯域幅 (default [0.001, 0.005, 0.01]) */
  bandsPct?: number[];
  /** statistics mode: 範囲% (default [0.5, 1.0, 2.0]) */
  ranges?: number[];
  /** statistics mode: 価格ゾーン分割数 (default 10) */
  priceZones?: number;
  /** raw mode: 最大レベル数 (default 200) */
  maxLevels?: number;
  /** タイムアウト */
  timeoutMs?: number;
}

// ─── ヘルパー ───

type RawLevel = [string, string]; // [price, size] from API
type NumLevel = [number, number]; // [price, size] parsed

function toLevelsWithCum(levels: NumLevel[], n: number): OrderbookLevelWithCum[] {
  const out = levels.slice(0, n).map(([price, size]) => ({ price, size, cumSize: 0 }));
  let cum = 0;
  for (const lvl of out) {
    cum += Number.isFinite(lvl.size) ? lvl.size : 0;
    lvl.cumSize = Number(cum.toFixed(8));
  }
  return out;
}

// ─── mode=summary ───

function buildSummary(pair: string, bidsNum: NumLevel[], asksNum: NumLevel[], topN: number, timestamp: number) {
  const bids = toLevelsWithCum(bidsNum, topN);
  const asks = toLevelsWithCum(asksNum, topN);

  const bestAsk = asks[0]?.price ?? null;
  const bestBid = bids[0]?.price ?? null;
  const spread = bestAsk != null && bestBid != null ? Number((bestAsk - bestBid).toFixed(0)) : null;
  const mid = bestAsk != null && bestBid != null ? Number(((bestAsk + bestBid) / 2).toFixed(2)) : null;

  const summary = formatSummary({
    pair,
    latest: mid ?? undefined,
    extra: `bid=${bestBid ?? 'N/A'} ask=${bestAsk ?? 'N/A'} spread=${spread ?? 'N/A'}`,
  });

  const text = [
    `📸 ${formatTimestampJST(timestamp)}`,
    '',
    summary,
    '',
    `📊 板情報 (上位${topN}層):`,
    `中値: ${mid?.toLocaleString() ?? 'N/A'}円`,
    `スプレッド: ${spread?.toLocaleString() ?? 'N/A'}円`,
    '',
    `🟢 買い板 (Bids): ${bids.length}層`,
    ...bids.slice(0, 5).map((b, i) => `  ${i + 1}. ${b.price.toLocaleString()}円 ${b.size.toFixed(4)} BTC (累計: ${b.cumSize.toFixed(4)} BTC)`),
    bids.length > 5 ? `  ... 他 ${bids.length - 5}層` : '',
    '',
    `🔴 売り板 (Asks): ${asks.length}層`,
    ...asks.slice(0, 5).map((a, i) => `  ${i + 1}. ${a.price.toLocaleString()}円 ${a.size.toFixed(4)} BTC (累計: ${a.cumSize.toFixed(4)} BTC)`),
    asks.length > 5 ? `  ... 他 ${asks.length - 5}層` : '',
  ].filter(Boolean).join('\n');

  const data = {
    mode: 'summary' as const,
    normalized: {
      pair, bestBid, bestAsk, spread, mid, bids, asks,
      timestamp, isoTime: toIsoTime(timestamp),
    },
  };
  return { text, data, mid };
}

// ─── mode=pressure ───

function buildPressure(pair: string, bidsRaw: RawLevel[], asksRaw: RawLevel[], bandsPct: number[], timestamp: number) {
  const bestAsk = Number(asksRaw?.[0]?.[0] ?? NaN);
  const bestBid = Number(bidsRaw?.[0]?.[0] ?? NaN);
  const baseMid = (Number.isFinite(bestAsk) && Number.isFinite(bestBid)) ? (bestAsk + bestBid) / 2 : null;

  function sumInBand(levels: RawLevel[], low: number, high: number) {
    let s = 0;
    for (const [p, q] of levels) {
      const price = Number(p), qty = Number(q);
      if (Number.isFinite(price) && Number.isFinite(qty) && price >= low && price <= high) s += qty;
    }
    return s;
  }

  const eps = 1e-9;
  const bands = bandsPct.map((w) => {
    if (!Number.isFinite(baseMid as any)) {
      return { widthPct: w, baseMid: null, baseBidSize: 0, baseAskSize: 0, bidDelta: 0, askDelta: 0, netDelta: 0, netDeltaPct: null as number | null, tag: null as 'notice' | 'warning' | 'strong' | null };
    }
    const bidLow = (baseMid as number) * (1 - w);
    const bidHigh = baseMid as number;
    const askLow = baseMid as number;
    const askHigh = (baseMid as number) * (1 + w);

    const buyVol = sumInBand(bidsRaw, bidLow, bidHigh);
    const sellVol = sumInBand(asksRaw, askLow, askHigh);

    const net = Number((buyVol - sellVol).toFixed(8));
    const pressure = Number(((buyVol - sellVol) / (buyVol + sellVol + eps)).toFixed(4));

    const v = Math.abs(pressure);
    const tag: 'notice' | 'warning' | 'strong' | null = v >= 0.2 ? 'strong' : v >= 0.1 ? 'warning' : v >= 0.05 ? 'notice' : null;

    return {
      widthPct: w,
      baseMid: baseMid as number,
      baseBidSize: Number(buyVol.toFixed(8)),
      baseAskSize: Number(sellVol.toFixed(8)),
      bidDelta: Number(buyVol.toFixed(8)),
      askDelta: Number((-sellVol).toFixed(8)),
      netDelta: net,
      netDeltaPct: pressure,
      tag,
    };
  });

  const strongestTag: 'notice' | 'warning' | 'strong' | null =
    bands.some((b) => b.tag === 'strong') ? 'strong' :
    bands.some((b) => b.tag === 'warning') ? 'warning' :
    bands.some((b) => b.tag === 'notice') ? 'notice' : null;

  const summary = formatSummary({ pair, latest: baseMid ?? undefined, extra: `bands=${bandsPct.join(',')}; tag=${strongestTag ?? 'none'}` });

  const text = [
    `📸 ${formatTimestampJST(timestamp)}`,
    '',
    summary,
    '',
    '📊 板圧力分析:',
    ...bands.map((b) =>
      `±${((b.widthPct) * 100).toFixed(2)}%: 買い ${b.baseBidSize.toFixed(2)} BTC / 売り ${b.baseAskSize.toFixed(2)} BTC (圧力: ${((b.netDeltaPct ?? 0) * 100).toFixed(1)}%)${b.tag ? ` [${b.tag}]` : ''}`
    ),
    '',
    `💡 総合評価: ${strongestTag ?? '均衡'}`,
  ].filter(Boolean).join('\n');

  const data = {
    mode: 'pressure' as const,
    bands,
    aggregates: { netDelta: Number(bands.reduce((s, b) => s + b.netDelta, 0).toFixed(8)), strongestTag },
  };
  return { text, data, mid: baseMid };
}

// ─── mode=statistics ───

function buildStatistics(pair: string, bidsNum: NumLevel[], asksNum: NumLevel[], ranges: number[], priceZones: number, timestamp: number) {
  const bestBid = bidsNum.length ? Math.max(...bidsNum.map(([p]) => p)) : null;
  const bestAsk = asksNum.length ? Math.min(...asksNum.map(([p]) => p)) : null;
  const mid = (bestBid != null && bestAsk != null) ? (bestBid + bestAsk) / 2 : null;

  const basic = {
    currentPrice: mid != null ? Math.round(mid) : null,
    bestBid: bestBid != null ? Number(bestBid) : null,
    bestAsk: bestAsk != null ? Number(bestAsk) : null,
    spread: (bestBid != null && bestAsk != null) ? Number(bestAsk) - Number(bestBid) : null,
    spreadPct: (bestBid != null && bestAsk != null && mid) ? (Number(bestAsk) - Number(bestBid)) / Number(mid) : null,
  };

  function sumWithinPct(levels: NumLevel[], pct: number, side: 'bid' | 'ask') {
    if (!mid) return { vol: 0, val: 0 };
    const minP = mid * (1 - pct / 100);
    const maxP = mid * (1 + pct / 100);
    let vol = 0; let val = 0;
    for (const [price, size] of levels) {
      if (side === 'bid' && price >= minP && price <= mid) { vol += size; val += size * price; }
      if (side === 'ask' && price <= maxP && price >= mid) { vol += size; val += size * price; }
    }
    return { vol, val };
  }

  const rangesOut = ranges.map((pct) => {
    const b = sumWithinPct(bidsNum, pct, 'bid');
    const a = sumWithinPct(asksNum, pct, 'ask');
    const ratio = a.vol > 0 ? (b.vol / a.vol) : (b.vol > 0 ? Infinity : 0);
    const interpretation = ratio > 1.2 ? '買い板が厚い（下値堅い）' : (ratio < 0.8 ? '売り板が厚い（上値重い）' : '均衡');
    return { pct, bidVolume: Number(b.vol.toFixed(4)), askVolume: Number(a.vol.toFixed(4)), bidValue: Math.round(b.val), askValue: Math.round(a.val), ratio: Number(ratio.toFixed(2)), interpretation };
  });

  // Liquidity zones
  const maxPct = Math.max(...ranges);
  const minPrice = mid ? mid * (1 - maxPct / 100) : 0;
  const maxPrice = mid ? mid * (1 + maxPct / 100) : 0;
  const step = priceZones > 0 && mid ? (maxPrice - minPrice) / priceZones : 0;
  const zones: Array<{ priceRange: string; bidVolume: number; askVolume: number; dominance: 'bid' | 'ask' | 'balanced'; note?: string }> = [];
  if (step > 0) {
    for (let i = 0; i < priceZones; i++) {
      const lo = minPrice + i * step;
      const hi = lo + step;
      const bVol = bidsNum.filter(([p]) => p >= lo && p < hi).reduce((s, [, sz]) => s + sz, 0);
      const aVol = asksNum.filter(([p]) => p >= lo && p < hi).reduce((s, [, sz]) => s + sz, 0);
      const dom = bVol > aVol * 1.2 ? 'bid' : (aVol > bVol * 1.2 ? 'ask' : 'balanced');
      const note = dom === 'bid' ? '強い買いサポート' : (dom === 'ask' ? '強い売り圧力' : undefined);
      zones.push({ priceRange: `${Math.round(lo).toLocaleString()} - ${Math.round(hi).toLocaleString()}`, bidVolume: Number(bVol.toFixed(4)), askVolume: Number(aVol.toFixed(4)), dominance: dom, note });
    }
  }

  // Large orders
  const threshold = 0.1;
  const largeBids = bidsNum.filter(([, sz]) => sz >= threshold).slice(0, 20).map(([p, sz]) => ({ price: Math.round(p), size: Number(sz.toFixed(3)), distance: mid ? Number((((p - mid) / mid) * 100).toFixed(2)) : null }));
  const largeAsks = asksNum.filter(([, sz]) => sz >= threshold).slice(0, 20).map(([p, sz]) => ({ price: Math.round(p), size: Number(sz.toFixed(3)), distance: mid ? Number((((p - mid) / mid) * 100).toFixed(2)) : null }));

  // Overall assessment
  const lastRatio = rangesOut[0]?.ratio ?? 1;
  const overall = lastRatio > 1.1 ? '買い優勢' : (lastRatio < 0.9 ? '売り優勢' : '均衡');
  const strength = Math.abs(lastRatio - 1) > 0.3 ? 'strong' : (Math.abs(lastRatio - 1) > 0.1 ? 'moderate' : 'weak');
  const liquidity = (rangesOut[0]?.bidVolume ?? 0) + (rangesOut[0]?.askVolume ?? 0) > 20 ? 'high' : (((rangesOut[0]?.bidVolume ?? 0) + (rangesOut[0]?.askVolume ?? 0) > 5) ? 'medium' : 'low');
  const recommendation = overall === '買い優勢' ? '下値が堅く、買いエントリーに適した環境。' : (overall === '売り優勢' ? '上値が重く、押し目待ち・警戒。' : '均衡圏、レンジ想定。');

  const text = [
    `📸 ${formatTimestampJST(timestamp)}`,
    '',
    '=== ' + String(pair).toUpperCase() + ' 板統計分析 ===',
    '💰 現在価格: ' + (basic.currentPrice != null ? `${basic.currentPrice.toLocaleString()}円` : 'n/a'),
    basic.spread != null ? `   スプレッド: ${basic.spread}円 (${((basic.spreadPct || 0) * 100).toFixed(6)}%)` : '',
    '',
    '📊 板の厚み分析:',
    ...rangesOut.map((r) => `±${r.pct}%レンジ: 買い ${r.bidVolume} BTC / 売り ${r.askVolume} BTC (比率 ${r.ratio}) → ${r.interpretation}`),
    '',
    '📈 価格帯別の流動性分布:',
    ...zones.slice(0, 5).map((z) => `${z.priceRange}円: 買い ${z.bidVolume} / 売り ${z.askVolume} (${z.dominance}) ${z.note || ''}`),
    '',
    '🐋 大口注文:',
    ...largeBids.slice(0, 3).map((o) => `買い板: ${o.price.toLocaleString()}円に${o.size} BTC (${o.distance != null ? (o.distance >= 0 ? '+' : '') + o.distance + '%' : ''})`),
    ...largeAsks.slice(0, 3).map((o) => `売り板: ${o.price.toLocaleString()}円に${o.size} BTC (${o.distance != null ? (o.distance >= 0 ? '+' : '') + o.distance + '%' : ''})`),
    '',
    `💡 総合評価: ${overall}（${strength}）`,
    recommendation,
  ].filter(Boolean).join('\n');

  const data = {
    mode: 'statistics' as const,
    basic,
    ranges: rangesOut,
    liquidityZones: zones,
    largeOrders: { bids: largeBids, asks: largeAsks, threshold },
    summary: { overall, strength, liquidity, recommendation },
  };
  return { text, data, mid };
}

// ─── mode=raw ───

function buildRaw(pair: string, rawJson: Record<string, unknown>, bidsRaw: RawLevel[], asksRaw: RawLevel[], timestamp: number) {
  const bestAsk = asksRaw[0]?.[0] != null ? Number(asksRaw[0][0]) : null;
  const bestBid = bidsRaw[0]?.[0] != null ? Number(bidsRaw[0][0]) : null;
  const mid = bestBid != null && bestAsk != null ? Number(((Number(bestBid) + Number(bestAsk)) / 2).toFixed(2)) : null;

  const bidsNum: NumLevel[] = bidsRaw.map(([p, s]) => [Number(p), Number(s)]);
  const asksNum: NumLevel[] = asksRaw.map(([p, s]) => [Number(p), Number(s)]);

  const summary = formatSummary({
    pair,
    latest: mid ?? undefined,
    extra: `levels: bids=${bidsRaw.length} asks=${asksRaw.length}`,
  });

  const text = [
    `📸 ${formatTimestampJST(timestamp)}`,
    '',
    summary,
    `板の層数: 買い ${bidsRaw.length}層 / 売り ${asksRaw.length}層`,
    mid ? `中値: ${mid.toLocaleString()}円` : '',
  ].filter(Boolean).join('\n');

  const d = rawJson;
  const data = {
    mode: 'raw' as const,
    asks: asksRaw,
    bids: bidsRaw,
    asks_over: d.asks_over,
    asks_under: d.asks_under,
    bids_over: d.bids_over,
    bids_under: d.bids_under,
    ask_market: d.ask_market,
    bid_market: d.bid_market,
    timestamp,
    sequenceId:
      d.sequenceId != null ? Number(d.sequenceId) :
        d.sequence_id != null ? Number(d.sequence_id) :
          undefined,
    overlays: {
      depth_zones: [
        ...estimateZones(bidsNum.slice(0, 50), 'bid'),
        ...estimateZones(asksNum.slice(0, 50), 'ask'),
      ],
    },
  };

  return { text, data, mid };
}

// ─── メインエントリ ───

export default async function getOrderbook(params: GetOrderbookParams | string = {}) {
  // 後方互換: 旧シグネチャ getOrderbook(pair, topN) 対応
  let opts: GetOrderbookParams;
  if (typeof params === 'string') {
    opts = { pair: params, mode: 'summary' };
  } else {
    opts = params;
  }

  const {
    pair = 'btc_jpy',
    mode = 'summary',
    topN = 10,
    bandsPct = [0.001, 0.005, 0.01],
    ranges = [0.5, 1.0, 2.0],
    priceZones = 10,
    maxLevels = 200,
    timeoutMs = 3000,
  } = opts;

  const chk = ensurePair(pair);
  if (!chk.ok) return failFromValidation(chk);

  if (mode === 'summary') {
    const limitCheck = validateLimit(topN, 1, 200, 'topN');
    if (!limitCheck.ok) return failFromValidation(limitCheck);
  }

  // ─── 単一 API 呼出し ───
  const url = `${BITBANK_API_BASE}/${chk.pair}/depth`;
  try {
    const json: unknown = await fetchJson(url, { timeoutMs, retries: DEFAULT_RETRIES });
    const jsonObj = json as { data?: Record<string, unknown> };
    const d = jsonObj?.data ?? {};
    const rawAsks: RawLevel[] = Array.isArray(d.asks) ? (d.asks as RawLevel[]).slice(0, maxLevels) : [];
    const rawBids: RawLevel[] = Array.isArray(d.bids) ? (d.bids as RawLevel[]).slice(0, maxLevels) : [];
    const timestamp = Number(d.timestamp ?? d.timestamp_ms ?? Date.now());

    // NumLevel 変換（summary / statistics で使用）
    const bidsNum: NumLevel[] = rawBids.map(([p, s]) => [Number(p), Number(s)]);
    const asksNum: NumLevel[] = rawAsks.map(([p, s]) => [Number(p), Number(s)]);

    let result: { text: string; data: any; mid: number | null };

    switch (mode) {
      case 'pressure':
        result = buildPressure(chk.pair, rawBids, rawAsks, bandsPct, timestamp);
        break;
      case 'statistics':
        result = buildStatistics(chk.pair, bidsNum, asksNum, ranges, priceZones, timestamp);
        break;
      case 'raw':
        result = buildRaw(chk.pair, d, rawBids, rawAsks, timestamp);
        break;
      case 'summary':
      default:
        result = buildSummary(chk.pair, bidsNum, asksNum, topN, timestamp);
        break;
    }

    const meta = createMeta(chk.pair, { mode, topN });
    return ok(result.text, result.data as any, meta as any);
  } catch (err: unknown) {
    return failFromError(err, { timeoutMs, defaultType: 'network', defaultMessage: 'ネットワークエラー' });
  }
}
