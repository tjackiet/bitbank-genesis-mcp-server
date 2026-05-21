/**
 * preview_cancel_order — 注文キャンセルのプレビューと確認トークン発行。
 *
 * キャンセル対象の注文情報を表示し、cancel_order に渡す確認トークンを発行する。
 * 実際のキャンセルは行わない。
 *
 * elicitation 対応ホストでは preview → ユーザー確認 → cancel_order までを
 * このハンドラ内で完結させる（LLM から見ると preview_cancel_order 1 回呼び出しで
 * キャンセル完了）。非対応ホストでは従来通り structuredContent 経由でトークンを
 * 渡しフォールバックする（Progressive Enhancement）。
 */

import { formatOrderPositionLabel, formatPair, formatPrice } from '../../lib/formatter.js';
import { ok, toStructured } from '../../lib/result.js';
import { generateToken } from '../../src/private/confirmation.js';
import { withElicitedConfirmation } from '../../src/private/elicitation.js';
import type { OrderResponse } from '../../src/private/schemas.js';
import { PreviewCancelOrderInputSchema, PreviewCancelOrderOutputSchema } from '../../src/private/schemas.js';
import type { ToolDefinition } from '../../src/tool-definition.js';
import cancelOrder from './cancel_order.js';
import getOrder from './get_order.js';

/** 注文詳細をキャンセルプレビューのサマリ行に整形する */
function formatOrderDetailLines(order: OrderResponse, pair: string): string[] {
	const sideLabel = order.side === 'buy' ? '買' : '売';
	const posLabel = formatOrderPositionLabel(order.position_side);
	const isJpy = pair.includes('jpy');
	const price = order.price ? (isJpy ? formatPrice(Number(order.price)) : order.price) : '成行';
	const amount = order.start_amount ?? order.executed_amount ?? '?';
	const lines: string[] = [];
	lines.push(`  方向: ${posLabel}${sideLabel} / タイプ: ${order.type}`);
	lines.push(`  数量: ${amount}（残: ${order.remaining_amount ?? '0'} / 約定: ${order.executed_amount}）`);
	lines.push(`  価格: ${price}`);
	if (order.trigger_price) {
		lines.push(`  トリガー価格: ${isJpy ? formatPrice(Number(order.trigger_price)) : order.trigger_price}`);
	}
	if (order.average_price && order.average_price !== '0') {
		lines.push(`  平均約定価格: ${isJpy ? formatPrice(Number(order.average_price)) : order.average_price}`);
	}
	lines.push(`  ステータス: ${order.status}`);
	return lines;
}

export default async function previewCancelOrder(args: { pair: string; order_id: number }) {
	const { pair, order_id } = args;

	// 注文詳細を取得して preview にも同梱する。失敗してもキャンセル自体は可能なので、
	// エラーは握りつぶしてフォールバック表示にとどめる（ネットワーク不調や認証異常で
	// キャンセル不能になる方が UX として悪いため）。
	let orderDetail: OrderResponse | undefined;
	const detailResult = await getOrder({ pair, order_id });
	if (detailResult.ok) {
		orderDetail = detailResult.data.order;
	}

	const tokenParams = { pair, order_id };
	const { token, expiresAt } = generateToken('cancel_order', tokenParams);

	const lines: string[] = [];
	lines.push(`📋 キャンセルプレビュー: ${formatPair(pair)}`);
	lines.push(`  注文ID: ${order_id}`);
	if (orderDetail) {
		lines.push(...formatOrderDetailLines(orderDetail, pair));
	}
	lines.push('');
	lines.push('⚠️ このキャンセルはユーザーの最終確認（ホスト UI または elicitation）を経るまで実行されません。');

	const summary = lines.join('\n');

	const data: Record<string, unknown> = {
		confirmation_token: token,
		expires_at: expiresAt,
		preview: { pair, order_id },
	};
	if (orderDetail) data.order = orderDetail;

	return PreviewCancelOrderOutputSchema.parse(ok(summary, data, { action: 'cancel_order' as const }));
}

export const toolDef: ToolDefinition = {
	name: 'preview_cancel_order',
	description: [
		'[Preview Cancel Order] 注文キャンセルのプレビューと確認トークン発行。実際のキャンセルは行わない。Private API。',
		'cancel_order を実行するには、まずこのツールで確認トークンを取得する必要がある。',
		'⚠️ confirmation_token は LLM 可視テキストには含めない。ホスト UI または elicitation のユーザー確認を経て cancel_order が呼ばれる前提。LLM が独断でトークンを引用して cancel_order を呼ぶと意図しないキャンセルになり得る。',
	].join(' '),
	inputSchema: PreviewCancelOrderInputSchema,
	// MCP Apps (SEP-1865): 対応ホストでは iframe 内にキャンセル確認 UI を表示する。
	// 非対応ホストでは無視され、従来のテキスト確認フローがそのまま動作する（Progressive Enhancement）。
	_meta: {
		ui: {
			resourceUri: 'ui://cancel/confirm.html',
		},
	},
	handler: async (args, extra) => {
		const typedArgs = args as { pair: string; order_id: number };
		const result = await previewCancelOrder(typedArgs);
		if (!result.ok) return result;

		// フォールバック: confirmation_token は LLM 可視テキストには含めず、
		// structuredContent 側にだけ残す。SEP-1865 UI ボタンや Inspector はこちらを参照する。
		const fallbackText = [
			result.summary,
			'',
			'※ confirmation_token はホスト UI / structuredContent 経由でのみ受け渡されます。',
			'  LLM はトークンを引用したり、ユーザー確認なしに cancel_order を呼ばないでください。',
		].join('\n');
		const previewStructured = toStructured(result);

		// elicitation 対応ホストでは preview → ユーザー確認 → cancel_order までを
		// このハンドラ内で完結させる。
		return withElicitedConfirmation({
			extra,
			summary: result.summary,
			confirmTitle: 'この注文をキャンセルする',
			// 内部的に cancel_order を実行。監査ログには route='elicitation' で記録される。
			onConfirmed: () =>
				cancelOrder(
					{
						...typedArgs,
						confirmation_token: result.data.confirmation_token,
						token_expires_at: result.data.expires_at,
					},
					'elicitation',
				),
			onDeclinedText: 'ユーザーがキャンセル操作を取り消しました（elicitation）',
			declinedStructured: previewStructured,
			fallback: {
				content: [{ type: 'text', text: fallbackText }],
				structuredContent: previewStructured,
			},
		});
	},
};
