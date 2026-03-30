/**
 * get_my_trade_history — 自分の約定履歴を取得する Private API ツール。
 *
 * bitbank Private API `/v1/user/spot/trade_history` を呼び出し、
 * LLM が分析しやすい形に整形して返す。
 */

import { nowIso, parseIso8601, toIsoMs } from '../../lib/datetime.js';
import { formatPair, formatPrice } from '../../lib/formatter.js';
import { fail, ok } from '../../lib/result.js';
import { getDefaultClient, PrivateApiError } from '../../src/private/client.js';
import { GetMyTradeHistoryInputSchema, GetMyTradeHistoryOutputSchema } from '../../src/private/schemas.js';
import type { ToolDefinition } from '../../src/tool-definition.js';

/** bitbank /v1/user/spot/trade_history のレスポンス型 */
interface RawTrade {
	trade_id: number;
	pair: string;
	order_id: number;
	side: string;
	position_side?: string;
	type: string;
	amount: string;
	price: string;
	maker_taker: string;
	fee_amount_base: string;
	fee_amount_quote: string;
	profit_loss?: string;
	interest?: string;
	executed_at: number;
}

export default async function getMyTradeHistory(args: {
	pair?: string;
	count?: number;
	order?: 'asc' | 'desc';
	since?: string;
	end?: string;
}) {
	const { pair, count = 100, order = 'desc', since, end } = args;
	const client = getDefaultClient();

	try {
		// クエリパラメータを組み立て
		const params: Record<string, string> = {};
		if (pair) params.pair = pair;
		if (count !== 100) params.count = String(count);
		if (order !== 'desc') params.order = order;

		// ISO8601 → unix ms 変換（strict parse で不正日時を弾く）
		if (since) {
			const parsed = parseIso8601(since);
			if (!parsed) {
				return GetMyTradeHistoryOutputSchema.parse(fail(`since の日時形式が不正です: ${since}`, 'validation_error'));
			}
			params.since = String(parsed.valueOf());
		}
		if (end) {
			const parsed = parseIso8601(end);
			if (!parsed) {
				return GetMyTradeHistoryOutputSchema.parse(fail(`end の日時形式が不正です: ${end}`, 'validation_error'));
			}
			params.end = String(parsed.valueOf());
		}

		const rawData = await client.get<{ trades: RawTrade[] }>(
			'/v1/user/spot/trade_history',
			Object.keys(params).length > 0 ? params : undefined,
		);

		const timestamp = nowIso();

		// 約定データの整形
		const trades = rawData.trades.map((t) => ({
			trade_id: t.trade_id,
			pair: t.pair,
			order_id: t.order_id,
			side: t.side,
			type: t.type,
			amount: t.amount,
			price: t.price,
			maker_taker: t.maker_taker,
			fee_amount_base: t.fee_amount_base,
			fee_amount_quote: t.fee_amount_quote,
			executed_at: toIsoMs(t.executed_at) ?? String(t.executed_at),
		}));

		// サマリー文字列の生成
		const lines: string[] = [];
		const pairLabel = pair ? formatPair(pair) : '全ペア';
		lines.push(`約定履歴: ${pairLabel} ${trades.length}件`);

		if (trades.length > 0) {
			lines.push('');

			// サマリーに表示する約定（最大10件）
			// desc（デフォルト）: 先頭が直近なのでそのまま slice
			// asc: 末尾が直近なので末尾10件を取得
			const displayTrades = order === 'asc' ? trades.slice(-10) : trades.slice(0, 10);
			for (const t of displayTrades) {
				const sideLabel = t.side === 'buy' ? '買' : '売';
				const isJpy = t.pair.includes('jpy');
				const price = isJpy ? formatPrice(Number(t.price)) : t.price;
				lines.push(
					`[trade: ${t.trade_id} / order: ${t.order_id}] ${t.executed_at} ${formatPair(t.pair)} ${sideLabel} ${t.amount} @ ${price} (${t.maker_taker})`,
				);
			}

			if (trades.length > 10) {
				lines.push(`... 他 ${trades.length - 10}件`);
			}

			// 集計情報
			const buyCount = trades.filter((t) => t.side === 'buy').length;
			const sellCount = trades.filter((t) => t.side === 'sell').length;
			lines.push('');
			lines.push(`集計: 買 ${buyCount}件 / 売 ${sellCount}件`);
		}

		const summary = lines.join('\n');

		const data = {
			trades,
			timestamp,
		};

		const meta = {
			fetchedAt: timestamp,
			tradeCount: trades.length,
			pair: pair || undefined,
			...(client.lastRateLimit ? { rateLimit: client.lastRateLimit } : {}),
		};

		return GetMyTradeHistoryOutputSchema.parse(ok(summary, data, meta));
	} catch (err) {
		if (err instanceof PrivateApiError) {
			return GetMyTradeHistoryOutputSchema.parse(fail(err.message, err.errorType));
		}
		return GetMyTradeHistoryOutputSchema.parse(
			fail(err instanceof Error ? err.message : '約定履歴取得中に予期しないエラーが発生しました', 'upstream_error'),
		);
	}
}

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'get_my_trade_history',
	description:
		'[My Trades / Trade History / Fills] 自分の約定履歴（my trades / trade history / fills / executions）を取得。通貨ペア・期間・件数でフィルタ可能。Private API。',
	inputSchema: GetMyTradeHistoryInputSchema,
	handler: async (args: { pair?: string; count?: number; order?: 'asc' | 'desc'; since?: string; end?: string }) =>
		getMyTradeHistory(args ?? {}),
};
