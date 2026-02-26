import { ensurePair, createMeta } from '../lib/validate.js';
import { fetchJson, BITBANK_API_BASE, DEFAULT_RETRIES } from '../lib/http.js';
import { ok, fail, failFromError, failFromValidation } from '../lib/result.js';
import { formatPair, formatPrice, formatPercent } from '../lib/formatter.js';
import { toIsoTime, toDisplayTime } from '../lib/datetime.js';
import { GetTickerInputSchema, GetTickerOutputSchema } from '../src/schemas.js';
import type { ToolDefinition } from '../src/tool-definition.js';
import type { Result, GetTickerData, GetTickerMeta } from '../src/types/domain.d.ts';

export interface GetTickerOptions {
  timeoutMs?: number;
}

/**
 * ticker データから content 用のサマリ文字列を生成
 */
function formatTickerSummary(pair: string, d: Record<string, unknown>): string {
  const pairDisplay = formatPair(pair);
  const isJpy = pair.toLowerCase().includes('jpy');

  const last = d.last != null ? Number(d.last) : null;
  const open = d.open != null ? Number(d.open) : null;
  const high = d.high != null ? Number(d.high) : null;
  const low = d.low != null ? Number(d.low) : null;
  const buy = d.buy != null ? Number(d.buy) : null;
  const sell = d.sell != null ? Number(d.sell) : null;
  const vol = d.vol != null ? Number(d.vol) : null;

  // 通貨単位
  const baseCurrency = pair.split('_')[0]?.toUpperCase() ?? '';

  // 価格フォーマット（ペア依存）
  const fmtPx = (v: number | null) => formatPrice(v, pair);

  // 変動率計算
  let changeStr = '';
  if (last !== null && open !== null && open !== 0) {
    const changePct = ((last - open) / open) * 100;
    changeStr = formatPercent(changePct, { sign: true, digits: 2 });
  }

  // スプレッド計算
  let spreadStr = '';
  if (buy !== null && sell !== null) {
    spreadStr = fmtPx(sell - buy);
  }

  // 出来高フォーマット（通貨ベース単位なのでカスタム）
  const formatVolume = (v: number | null): string => {
    if (v === null) return 'N/A';
    if (v >= 1000) {
      return `${(v / 1000).toFixed(2)}K ${baseCurrency}`;
    }
    return `${v.toFixed(4)} ${baseCurrency}`;
  };

  // サマリ構築
  const lines: string[] = [];
  lines.push(`${pairDisplay} 現在値: ${fmtPx(last)}`);
  lines.push(`24h: 始値 ${fmtPx(open)} / 高値 ${fmtPx(high)} / 安値 ${fmtPx(low)}`);
  if (changeStr) {
    lines.push(`24h変動: ${changeStr}`);
  }
  lines.push(`出来高: ${formatVolume(vol)}`);
  lines.push(`Bid: ${fmtPx(buy)} / Ask: ${fmtPx(sell)}${spreadStr ? `（スプレッド: ${spreadStr}）` : ''}`);

  const tsNum = d.timestamp != null ? Number(d.timestamp) : null;
  const timeStr = tsNum != null ? toDisplayTime(tsNum) : null;
  if (timeStr) lines.push(`📸 ${timeStr} 時点`);

  return lines.join('\n');
}

export default async function getTicker(
  pair: string,
  { timeoutMs = 5000 }: GetTickerOptions = {}
): Promise<Result<GetTickerData, GetTickerMeta>> {
  const chk = ensurePair(pair);
  if (!chk.ok) return failFromValidation(chk) as any;

  const url = `${BITBANK_API_BASE}/${chk.pair}/ticker`;

  try {
    const json: unknown = await fetchJson(url, { timeoutMs, retries: DEFAULT_RETRIES });
    const jsonObj = json as { data?: Record<string, unknown> };

    const d = jsonObj?.data ?? {};
    const summary = formatTickerSummary(chk.pair, d);

    const data: GetTickerData = {
      raw: json,
      normalized: {
        pair: chk.pair,
        last: d.last != null ? Number(d.last) : null,
        buy: d.buy != null ? Number(d.buy) : null,
        sell: d.sell != null ? Number(d.sell) : null,
        open: d.open != null ? Number(d.open) : null,
        high: d.high != null ? Number(d.high) : null,
        low: d.low != null ? Number(d.low) : null,
        volume: d.vol != null ? Number(d.vol) : null,
        timestamp: d.timestamp != null ? Number(d.timestamp) : null,
        isoTime: toIsoTime(d.timestamp),
      },
    };

    return GetTickerOutputSchema.parse(ok(summary, data, createMeta(chk.pair))) as unknown as Result<GetTickerData, GetTickerMeta>;
  } catch (err: unknown) {
    return failFromError(err, { schema: GetTickerOutputSchema, timeoutMs, defaultType: 'network', defaultMessage: 'ネットワークエラー' }) as unknown as Result<GetTickerData, GetTickerMeta>;
  }
}

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'get_ticker',
	description: '単一ペアのティッカーを取得（/ticker）。価格・出来高・24h高安。',
	inputSchema: GetTickerInputSchema,
	handler: async ({ pair }: any) => getTicker(pair),
};
