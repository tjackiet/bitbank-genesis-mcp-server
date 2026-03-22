/**
 * create_order — 現物注文を発注する Private API ツール。
 *
 * bitbank Private API `POST /v1/user/spot/order` を呼び出し、
 * 指定したパラメータで注文を発注する。
 *
 * 対応注文タイプ（現物のみ）:
 * - limit: 指値注文（price 必須）
 * - market: 成行注文
 * - stop: 逆指値注文（trigger_price 必須、トリガー到達で成行発注）
 * - stop_limit: 逆指値指値注文（trigger_price + price 必須）
 *
 * セキュリティ:
 * - amount / price / trigger_price のバリデーションをサーバー側で実施
 * - 注文タイプに応じた必須パラメータの事前チェック
 * - LLM は system-prompt のガイドラインに従い、発注前にユーザーへ確認を取る
 */

import { nowIso } from '../../lib/datetime.js';
import { formatPair, formatPrice } from '../../lib/formatter.js';
import { log } from '../../lib/logger.js';
import { fail, ok } from '../../lib/result.js';
import { getDefaultClient, PrivateApiError } from '../../src/private/client.js';
import type { OrderResponse } from '../../src/private/schemas.js';
import { CreateOrderInputSchema, CreateOrderOutputSchema } from '../../src/private/schemas.js';
import type { ToolDefinition } from '../../src/tool-definition.js';

/** 注文タイプごとの必須パラメータチェック */
function validateOrderParams(args: {
	type: string;
	price?: string;
	trigger_price?: string;
	post_only?: boolean;
}): string | null {
	const { type, price, trigger_price, post_only } = args;

	switch (type) {
		case 'limit':
			if (!price) return 'limit 注文には price（指値価格）が必須です';
			break;
		case 'market':
			if (price) return 'market 注文に price は指定できません（成行で約定します）';
			if (trigger_price) return 'market 注文に trigger_price は指定できません。逆指値は type="stop" を使用してください';
			break;
		case 'stop':
			if (!trigger_price) return 'stop 注文には trigger_price（トリガー価格）が必須です';
			if (price)
				return 'stop 注文に price は指定できません。トリガー到達後に指値で発注したい場合は type="stop_limit" を使用してください';
			break;
		case 'stop_limit':
			if (!trigger_price) return 'stop_limit 注文には trigger_price（トリガー価格）が必須です';
			if (!price) return 'stop_limit 注文には price（トリガー到達後の指値価格）が必須です';
			break;
	}

	// post_only は limit のみ
	if (post_only && type !== 'limit') {
		return 'post_only は limit 注文でのみ有効です';
	}

	return null;
}

/** 数値文字列の正値チェック */
function isPositiveNumericString(s: string): boolean {
	const n = Number(s);
	return Number.isFinite(n) && n > 0;
}

export default async function createOrder(args: {
	pair: string;
	amount: string;
	price?: string;
	side: 'buy' | 'sell';
	type: 'limit' | 'market' | 'stop' | 'stop_limit';
	post_only?: boolean;
	trigger_price?: string;
}) {
	const { pair, amount, price, side, type, post_only, trigger_price } = args;

	// バリデーション: 注文タイプ別の必須パラメータ
	const paramError = validateOrderParams({ type, price, trigger_price, post_only });
	if (paramError) {
		return CreateOrderOutputSchema.parse(fail(paramError, 'validation_error'));
	}

	// バリデーション: 数値の正値チェック
	if (!isPositiveNumericString(amount)) {
		return CreateOrderOutputSchema.parse(fail('amount は正の数値を指定してください', 'validation_error'));
	}
	if (price && !isPositiveNumericString(price)) {
		return CreateOrderOutputSchema.parse(fail('price は正の数値を指定してください', 'validation_error'));
	}
	if (trigger_price && !isPositiveNumericString(trigger_price)) {
		return CreateOrderOutputSchema.parse(fail('trigger_price は正の数値を指定してください', 'validation_error'));
	}

	const client = getDefaultClient();

	try {
		// リクエストボディの構築（undefinedのフィールドは除外）
		const body: Record<string, unknown> = { pair, amount, side, type };
		if (price) body.price = price;
		if (post_only != null) body.post_only = post_only;
		if (trigger_price) body.trigger_price = trigger_price;

		const rawOrder = await client.post<OrderResponse>('/v1/user/spot/order', body);

		const timestamp = nowIso();
		const isJpy = pair.includes('jpy');
		const sideLabel = side === 'buy' ? '買' : '売';
		const fmtPrice = price ? (isJpy ? formatPrice(Number(price)) : price) : '成行';

		// 構造化ログに記録
		log('info', {
			type: 'create_order',
			orderId: rawOrder.order_id,
			pair,
			side,
			orderType: type,
			amount,
			price: price ?? null,
			triggerPrice: trigger_price ?? null,
			status: rawOrder.status,
		});

		// サマリー生成
		const lines: string[] = [];
		lines.push(`注文発注完了: ${formatPair(pair)}`);
		lines.push(`  注文ID: ${rawOrder.order_id}`);
		lines.push(`  方向: ${sideLabel} / タイプ: ${type}`);
		lines.push(`  数量: ${amount}`);
		lines.push(`  価格: ${fmtPrice}`);
		if (trigger_price) {
			lines.push(`  トリガー価格: ${isJpy ? formatPrice(Number(trigger_price)) : trigger_price}`);
		}
		if (post_only) {
			lines.push('  Post Only: 有効');
		}
		lines.push(`  ステータス: ${rawOrder.status}`);

		const summary = lines.join('\n');

		return CreateOrderOutputSchema.parse(
			ok(
				summary,
				{ order: rawOrder, timestamp },
				{ fetchedAt: timestamp, orderId: rawOrder.order_id, pair, side, type },
			),
		);
	} catch (err) {
		if (err instanceof PrivateApiError) {
			// 取引固有エラーの補足メッセージ
			const codeMessages: Record<number, string> = {
				60001: '残高が不足しています。保有資産を確認してください',
				60002: '成行買い注文の数量上限を超えています',
				60003: '注文数量が最小数量を下回っています',
				60004: '注文数量が最大数量を超えています',
				60005: '注文価格が下限を下回っています',
				60006: '注文価格が上限を超えています',
				60011: '同時注文数の上限（30件）に達しています。既存注文をキャンセルしてください',
				60016: 'トリガー価格が不正です',
				70004: '現在、買い注文が制限されています',
				70005: '現在、売り注文が制限されています',
				70006: '現在、この通貨ペアの取引が制限されています',
				70009: '現在、成行注文が制限されています。指値注文をお試しください',
			};
			const msg = (err.bitbankCode && codeMessages[err.bitbankCode]) || err.message;
			return CreateOrderOutputSchema.parse(fail(msg, err.errorType));
		}
		return CreateOrderOutputSchema.parse(
			fail(err instanceof Error ? err.message : '注文発注中に予期しないエラーが発生しました', 'upstream_error'),
		);
	}
}

export const toolDef: ToolDefinition = {
	name: 'create_order',
	description: [
		'[Create Order / Place Order / Buy / Sell] 現物注文を発注する。Private API。',
		'注文タイプ: limit（指値）, market（成行）, stop（逆指値）, stop_limit（逆指値指値）。',
		'⚠️ 実際に取引が実行されます。発注前にユーザーへの確認を必ず行ってください。',
	].join(' '),
	inputSchema: CreateOrderInputSchema,
	handler: async (args) => {
		const result = await createOrder(
			args as {
				pair: string;
				amount: string;
				price?: string;
				side: 'buy' | 'sell';
				type: 'limit' | 'market' | 'stop' | 'stop_limit';
				post_only?: boolean;
				trigger_price?: string;
			},
		);
		if (!result.ok) return result;
		const text = `${result.summary}\n${JSON.stringify(result.data, null, 2)}`;
		return {
			content: [{ type: 'text', text }],
			structuredContent: result as unknown as Record<string, unknown>,
		};
	},
};
