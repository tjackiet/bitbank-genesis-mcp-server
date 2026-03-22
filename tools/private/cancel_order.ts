/**
 * cancel_order — 注文をキャンセルする Private API ツール。
 *
 * bitbank Private API `POST /v1/user/spot/cancel_order` を呼び出し、
 * 指定した注文IDの注文をキャンセルする。
 *
 * エラーケース:
 * - 50009: 注文が見つからない
 * - 50010: キャンセル不可（既にキャンセル・約定済みなど）
 * - 50026: 既にキャンセル済み
 * - 50027: 既に約定済み
 */

import { nowIso, toIsoMs } from '../../lib/datetime.js';
import { formatPair, formatPrice } from '../../lib/formatter.js';
import { fail, ok } from '../../lib/result.js';
import { getDefaultClient, PrivateApiError } from '../../src/private/client.js';
import type { OrderResponse } from '../../src/private/schemas.js';
import { CancelOrderInputSchema, CancelOrderOutputSchema } from '../../src/private/schemas.js';
import type { ToolDefinition } from '../../src/tool-definition.js';

export default async function cancelOrder(args: { pair: string; order_id: number }) {
	const { pair, order_id } = args;
	const client = getDefaultClient();

	try {
		const rawOrder = await client.post<OrderResponse>('/v1/user/spot/cancel_order', {
			pair,
			order_id,
		});

		const timestamp = nowIso();
		const isJpy = pair.includes('jpy');
		const sideLabel = rawOrder.side === 'buy' ? '買' : '売';
		const price = rawOrder.price ? (isJpy ? formatPrice(Number(rawOrder.price)) : rawOrder.price) : '成行';
		const amount = rawOrder.start_amount ?? rawOrder.executed_amount;

		const lines: string[] = [];
		lines.push(`注文キャンセル完了: ${formatPair(pair)}`);
		lines.push(`  注文ID: ${order_id}`);
		lines.push(`  ${sideLabel} ${rawOrder.type} ${amount} @ ${price}`);
		lines.push(`  ステータス: ${rawOrder.status}`);
		if (rawOrder.executed_amount && rawOrder.executed_amount !== '0') {
			lines.push(`  約定済み数量: ${rawOrder.executed_amount}`);
		}
		lines.push(
			`  キャンセル日時: ${rawOrder.canceled_at ? (toIsoMs(rawOrder.canceled_at) ?? String(rawOrder.canceled_at)) : timestamp}`,
		);

		const summary = lines.join('\n');

		return CancelOrderOutputSchema.parse(
			ok(summary, { order: rawOrder, timestamp }, { fetchedAt: timestamp, orderId: order_id, pair }),
		);
	} catch (err) {
		if (err instanceof PrivateApiError) {
			// キャンセル固有エラーの補足メッセージ
			const codeMessages: Record<number, string> = {
				50009: '指定された注文が見つかりません（3ヶ月以上前の注文は参照不可）',
				50010: 'この注文はキャンセルできません',
				50026: 'この注文は既にキャンセル済みです',
				50027: 'この注文は既に約定済みです',
			};
			const msg = (err.bitbankCode && codeMessages[err.bitbankCode]) || err.message;
			return CancelOrderOutputSchema.parse(fail(msg, err.errorType));
		}
		return CancelOrderOutputSchema.parse(
			fail(err instanceof Error ? err.message : '注文キャンセル中に予期しないエラーが発生しました', 'upstream_error'),
		);
	}
}

export const toolDef: ToolDefinition = {
	name: 'cancel_order',
	description: '[Cancel Order] 指定した注文IDの注文をキャンセルする。キャンセル後の注文情報を返す。Private API。',
	inputSchema: CancelOrderInputSchema,
	handler: async (args) => {
		const result = await cancelOrder(args as { pair: string; order_id: number });
		if (!result.ok) return result;
		const text = `${result.summary}\n${JSON.stringify(result.data, null, 2)}`;
		return {
			content: [{ type: 'text', text }],
			structuredContent: result as unknown as Record<string, unknown>,
		};
	},
};
