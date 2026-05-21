/**
 * preview_cancel_orders — 一括キャンセルのプレビューと確認トークン発行。
 *
 * キャンセル対象の注文ID一覧を表示し、cancel_orders に渡す確認トークンを発行する。
 * 実際のキャンセルは行わない。
 *
 * elicitation 対応ホストでは preview → ユーザー確認 → cancel_orders までを
 * このハンドラ内で完結させる。非対応ホストでは従来通り structuredContent
 * 経由でトークンを渡しフォールバックする（Progressive Enhancement）。
 */

import { formatPair } from '../../lib/formatter.js';
import { ok, toStructured } from '../../lib/result.js';
import { generateToken } from '../../src/private/confirmation.js';
import { withElicitedConfirmation } from '../../src/private/elicitation.js';
import { PreviewCancelOrdersInputSchema, PreviewCancelOrdersOutputSchema } from '../../src/private/schemas.js';
import type { ToolDefinition } from '../../src/tool-definition.js';
import cancelOrders from './cancel_orders.js';

export default function previewCancelOrders(args: { pair: string; order_ids: number[] }) {
	const { pair, order_ids } = args;

	const tokenParams = { pair, order_ids };
	const { token, expiresAt } = generateToken('cancel_orders', tokenParams);

	const lines: string[] = [];
	lines.push(`📋 一括キャンセルプレビュー: ${formatPair(pair)} ${order_ids.length}件`);
	for (const id of order_ids) {
		lines.push(`  注文ID: ${id}`);
	}
	lines.push('');
	lines.push('⚠️ この一括キャンセルはユーザーの最終確認（ホスト UI または elicitation）を経るまで実行されません。');

	const summary = lines.join('\n');

	return PreviewCancelOrdersOutputSchema.parse(
		ok(
			summary,
			{ confirmation_token: token, expires_at: expiresAt, preview: { pair, order_ids } },
			{ action: 'cancel_orders' as const },
		),
	);
}

export const toolDef: ToolDefinition = {
	name: 'preview_cancel_orders',
	description: [
		'[Preview Cancel Orders] 一括キャンセルのプレビューと確認トークン発行。実際のキャンセルは行わない。Private API。',
		'cancel_orders を実行するには、まずこのツールで確認トークンを取得する必要がある。',
		'⚠️ confirmation_token は LLM 可視テキストには含めない。ホスト UI または elicitation のユーザー確認を経て cancel_orders が呼ばれる前提。LLM が独断でトークンを引用して cancel_orders を呼ぶと意図しないキャンセルになり得る。',
	].join(' '),
	inputSchema: PreviewCancelOrdersInputSchema,
	// MCP Apps (SEP-1865): 対応ホストでは iframe 内にキャンセル確認 UI を表示する。
	// 非対応ホストでは無視され、従来のテキスト確認フローがそのまま動作する（Progressive Enhancement）。
	_meta: {
		ui: {
			resourceUri: 'ui://cancel/confirm.html',
		},
	},
	handler: async (args, extra) => {
		const typedArgs = args as { pair: string; order_ids: number[] };
		const result = previewCancelOrders(typedArgs);
		if (!result.ok) return result;

		// フォールバック: confirmation_token は LLM 可視テキストには含めない。
		const fallbackText = [
			result.summary,
			'',
			'※ confirmation_token はホスト UI / structuredContent 経由でのみ受け渡されます。',
			'  LLM はトークンを引用したり、ユーザー確認なしに cancel_orders を呼ばないでください。',
		].join('\n');
		const previewStructured = toStructured(result);

		// elicitation 対応ホストでは preview → ユーザー確認 → cancel_orders までを
		// このハンドラ内で完結させる。
		return withElicitedConfirmation({
			extra,
			summary: result.summary,
			confirmTitle: `これら ${typedArgs.order_ids.length} 件の注文を一括キャンセルする`,
			// 内部的に cancel_orders を実行。監査ログには route='elicitation' で記録される。
			onConfirmed: () =>
				cancelOrders(
					{
						...typedArgs,
						confirmation_token: result.data.confirmation_token,
						token_expires_at: result.data.expires_at,
					},
					'elicitation',
				),
			onDeclinedText: 'ユーザーが一括キャンセル操作を取り消しました（elicitation）',
			declinedStructured: previewStructured,
			fallback: {
				content: [{ type: 'text', text: fallbackText }],
				structuredContent: previewStructured,
			},
		});
	},
};
