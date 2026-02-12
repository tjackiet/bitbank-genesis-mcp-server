import { ensurePair, createMeta } from '../lib/validate.js';
import { fetchJson, BITBANK_API_BASE } from '../lib/http.js';
import { ok, fail, failFromError, failFromValidation } from '../lib/result.js';
import { formatSummary, formatTimestampJST } from '../lib/formatter.js';
import { estimateZones } from '../lib/depth-analysis.js';
import { GetDepthOutputSchema } from '../src/schemas.js';

export interface GetDepthOptions { timeoutMs?: number; maxLevels?: number }

export default async function getDepth(
  pair: string,
  { timeoutMs = 3000, maxLevels = 200 }: GetDepthOptions = {}
) {
  const chk = ensurePair(pair);
  if (!chk.ok) return failFromValidation(chk);

  const url = `${BITBANK_API_BASE}/${chk.pair}/depth`;
  try {
    const json: unknown = await fetchJson(url, { timeoutMs, retries: 2 });
    const jsonObj = json as { data?: Record<string, unknown> };
    const d = jsonObj?.data ?? {};
    const asks = Array.isArray(d.asks) ? d.asks.slice(0, maxLevels) : [];
    const bids = Array.isArray(d.bids) ? d.bids.slice(0, maxLevels) : [];

    // 簡易サマリ（最良気配と件数）
    const bestAsk = asks[0]?.[0] ?? null;
    const bestBid = bids[0]?.[0] ?? null;
    const mid = bestBid && bestAsk ? Number(((Number(bestBid) + Number(bestAsk)) / 2).toFixed(2)) : null;
    const summary = formatSummary({
      pair: chk.pair,
      latest: mid ?? undefined,
      extra: `levels: bids=${bids.length} asks=${asks.length}`,
    });

    const data = {
      asks,
      bids,
      asks_over: d.asks_over,
      asks_under: d.asks_under,
      bids_over: d.bids_over,
      bids_under: d.bids_under,
      ask_market: d.ask_market,
      bid_market: d.bid_market,
      timestamp: Number(d.timestamp ?? d.timestamp_ms ?? Date.now()),
      sequenceId:
        d.sequenceId != null ? Number(d.sequenceId) :
          d.sequence_id != null ? Number(d.sequence_id) :
            undefined,
      overlays: {
        depth_zones: [
          ...estimateZones(bids.slice(0, 50).map(([p, s]: [unknown, unknown]) => [Number(p), Number(s)] as [number, number]), 'bid'),
          ...estimateZones(asks.slice(0, 50).map(([p, s]: [unknown, unknown]) => [Number(p), Number(s)] as [number, number]), 'ask'),
        ],
      },
    };

    // タイムスタンプ付きテキスト出力
    const text = [
      `📸 ${formatTimestampJST(data.timestamp)}`,
      '',
      summary,
      `板の層数: 買い ${bids.length}層 / 売り ${asks.length}層`,
      mid ? `中値: ${mid.toLocaleString()}円` : '',
    ].filter(Boolean).join('\n');

    const meta = createMeta(chk.pair);
    return GetDepthOutputSchema.parse(ok(text, data as any, meta as any));
  } catch (err: unknown) {
    return failFromError(err, { schema: GetDepthOutputSchema, timeoutMs, defaultType: 'network', defaultMessage: 'ネットワークエラー' }) as any;
  }
}


