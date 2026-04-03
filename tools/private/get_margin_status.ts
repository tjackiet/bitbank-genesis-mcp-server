/**
 * get_margin_status — 信用取引ステータスを取得する Private API ツール。
 *
 * bitbank Private API `/v1/user/margin/status` を呼び出し、
 * 保証金・建玉・ロスカット情報を取得して返す。
 */

import { nowIso } from '../../lib/datetime.js';
import { formatPrice } from '../../lib/formatter.js';
import { fail, ok } from '../../lib/result.js';
import { getDefaultClient, PrivateApiError } from '../../src/private/client.js';
import { GetMarginStatusInputSchema, GetMarginStatusOutputSchema } from '../../src/private/schemas.js';
import type { ToolDefinition } from '../../src/tool-definition.js';

/** bitbank /v1/user/margin/status のレスポンス型 */
interface RawMarginStatus {
	status: string;
	total_margin_balance: string;
	total_margin_balance_percentage: string | null;
	margin_position_profit_loss: string;
	unrealized_cost: string;
	total_margin_position_product: string;
	open_margin_position_product: string;
	open_margin_order_product: string;
	total_position_maintenance_margin: string;
	total_long_position_maintenance_margin: string;
	total_short_position_maintenance_margin: string;
	total_open_order_maintenance_margin: string;
	total_long_open_order_maintenance_margin: string;
	total_short_open_order_maintenance_margin: string;
	losscut_rate: string | null;
	available_long_margin: string;
	available_short_margin: string;
}

/** 警告が必要なステータス */
const WARNING_STATUSES = new Set(['CALL', 'LOSSCUT', 'DEBT']);

const STATUS_LABELS: Record<string, string> = {
	NORMAL: '正常',
	LOSSCUT: '強制決済中',
	CALL: '追証発生中',
	DEBT: '不足金発生中',
	SETTLED: '精算済み',
};

export default async function getMarginStatus(_args: Record<string, unknown>) {
	const client = getDefaultClient();

	try {
		const raw = await client.get<RawMarginStatus>('/v1/user/margin/status');
		const timestamp = nowIso();

		const hasWarning = WARNING_STATUSES.has(raw.status);
		const statusLabel = STATUS_LABELS[raw.status] ?? raw.status;

		// サマリー文字列の生成
		const lines: string[] = [];

		if (hasWarning) {
			lines.push(`⚠ 信用取引ステータス: ${statusLabel}（${raw.status}）`);
		} else {
			lines.push(`信用取引ステータス: ${statusLabel}（${raw.status}）`);
		}

		lines.push('');
		lines.push(`保証金合計: ${formatPrice(Number(raw.total_margin_balance))} 円`);
		if (raw.total_margin_balance_percentage !== null) {
			lines.push(`保証金率: ${raw.total_margin_balance_percentage}%`);
		}

		lines.push(`建玉含み損益: ${formatPrice(Number(raw.margin_position_profit_loss))} 円`);
		lines.push(`未実現コスト: ${formatPrice(Number(raw.unrealized_cost))} 円`);
		lines.push('');
		lines.push(`建玉総評価額: ${formatPrice(Number(raw.total_margin_position_product))} 円`);
		lines.push(`  保有建玉: ${formatPrice(Number(raw.open_margin_position_product))} 円`);
		lines.push(`  注文中建玉: ${formatPrice(Number(raw.open_margin_order_product))} 円`);
		lines.push('');
		lines.push(`維持保証金合計: ${formatPrice(Number(raw.total_position_maintenance_margin))} 円`);
		lines.push(`  ロング: ${formatPrice(Number(raw.total_long_position_maintenance_margin))} 円`);
		lines.push(`  ショート: ${formatPrice(Number(raw.total_short_position_maintenance_margin))} 円`);
		lines.push(`  注文: ${formatPrice(Number(raw.total_open_order_maintenance_margin))} 円`);

		if (raw.losscut_rate !== null) {
			lines.push('');
			lines.push(`強制決済率: ${raw.losscut_rate}%`);
		}

		lines.push('');
		lines.push(
			`新規建て可能額 — ロング: ${formatPrice(Number(raw.available_long_margin))} 円 / ショート: ${formatPrice(Number(raw.available_short_margin))} 円`,
		);

		if (hasWarning) {
			lines.push('');
			if (raw.status === 'CALL') {
				lines.push('⚠ 追証が発生しています。期日までに追加保証金を入金するか、建玉を決済してください。');
			} else if (raw.status === 'LOSSCUT') {
				lines.push('⚠ 強制決済が実行中です。保証金率が閾値を下回ったため、建玉が自動決済されています。');
			} else if (raw.status === 'DEBT') {
				lines.push('⚠ 不足金が発生しています。速やかに入金してください。');
			}
		}

		const summary = lines.join('\n');

		const data = {
			status: raw.status as 'NORMAL' | 'LOSSCUT' | 'CALL' | 'DEBT' | 'SETTLED',
			total_margin_balance: raw.total_margin_balance,
			total_margin_balance_percentage: raw.total_margin_balance_percentage,
			margin_position_profit_loss: raw.margin_position_profit_loss,
			unrealized_cost: raw.unrealized_cost,
			total_margin_position_product: raw.total_margin_position_product,
			open_margin_position_product: raw.open_margin_position_product,
			open_margin_order_product: raw.open_margin_order_product,
			total_position_maintenance_margin: raw.total_position_maintenance_margin,
			total_long_position_maintenance_margin: raw.total_long_position_maintenance_margin,
			total_short_position_maintenance_margin: raw.total_short_position_maintenance_margin,
			total_open_order_maintenance_margin: raw.total_open_order_maintenance_margin,
			total_long_open_order_maintenance_margin: raw.total_long_open_order_maintenance_margin,
			total_short_open_order_maintenance_margin: raw.total_short_open_order_maintenance_margin,
			losscut_rate: raw.losscut_rate,
			available_long_margin: raw.available_long_margin,
			available_short_margin: raw.available_short_margin,
			timestamp,
		};

		const meta = {
			fetchedAt: timestamp,
			hasWarning,
			...(client.lastRateLimit ? { rateLimit: client.lastRateLimit } : {}),
		};

		return GetMarginStatusOutputSchema.parse(ok(summary, data, meta));
	} catch (err) {
		if (err instanceof PrivateApiError) {
			return GetMarginStatusOutputSchema.parse(fail(err.message, err.errorType));
		}
		return GetMarginStatusOutputSchema.parse(
			fail(
				err instanceof Error ? err.message : '信用取引ステータス取得中に予期しないエラーが発生しました',
				'upstream_error',
			),
		);
	}
}

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'get_margin_status',
	description:
		'[Margin Status / 信用取引ステータス] 信用取引の口座状況（保証金・建玉評価額・維持保証金・ロスカット率・新規建て可能額）を取得。追証（CALL）・強制決済（LOSSCUT）・不足金（DEBT）発生時はアラート付き。Private API。',
	inputSchema: GetMarginStatusInputSchema,
	handler: async (args: Record<string, unknown>) => getMarginStatus(args),
};
