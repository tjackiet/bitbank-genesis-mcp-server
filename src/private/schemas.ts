/**
 * プライベート API 系の Zod スキーマ。
 * src/schemas.ts から re-export され、単一ソースの原則を維持する。
 */

import { z } from 'zod';

// FailResultSchema を直接定義（schemas.ts からの循環参照を避けるため）
const PrivateFailResultSchema = z.object({
	ok: z.literal(false),
	summary: z.string(),
	data: z.object({}).passthrough(),
	meta: z.object({ errorType: z.string() }).passthrough(),
});

// ── get_my_assets ──

export const GetMyAssetsInputSchema = z.object({
	include_jpy_valuation: z.boolean().default(true)
		.describe('各通貨の日本円評価額を含めるか'),
});

const AssetItemSchema = z.object({
	asset: z.string().describe('通貨コード（例: btc, jpy）'),
	amount: z.string().describe('総保有量'),
	available_amount: z.string().describe('利用可能量'),
	locked_amount: z.string().describe('ロック中の量'),
	jpy_value: z.number().optional().describe('日本円評価額'),
	allocation_pct: z.number().optional().describe('構成比（%）'),
});

export const GetMyAssetsDataSchema = z.object({
	assets: z.array(AssetItemSchema),
	total_jpy_value: z.number().optional(),
	timestamp: z.string(),
});

export const GetMyAssetsMetaSchema = z.object({
	fetchedAt: z.string(),
	assetCount: z.number().int(),
	hasJpyValuation: z.boolean(),
});

export const GetMyAssetsOutputSchema = z.union([
	z.object({
		ok: z.literal(true),
		summary: z.string(),
		data: GetMyAssetsDataSchema,
		meta: GetMyAssetsMetaSchema,
	}),
	PrivateFailResultSchema,
]);

// ── get_my_trade_history ──

export const GetMyTradeHistoryInputSchema = z.object({
	pair: z.string().optional()
		.describe('通貨ペア（例: btc_jpy）。省略で全ペア'),
	count: z.number().max(1000).default(100)
		.describe('取得件数（最大1000）'),
	order: z.enum(['asc', 'desc']).default('desc')
		.describe('ソート順（asc: 古い順, desc: 新しい順）'),
	since: z.string().optional()
		.describe('開始日時（ISO8601、例: 2025-01-01T00:00:00+09:00）'),
	end: z.string().optional()
		.describe('終了日時（ISO8601、例: 2025-12-31T23:59:59+09:00）'),
});

const TradeItemSchema = z.object({
	trade_id: z.number().describe('約定ID'),
	pair: z.string().describe('通貨ペア'),
	order_id: z.number().describe('注文ID'),
	side: z.string().describe('売買（buy / sell）'),
	type: z.string().describe('注文タイプ（limit / market）'),
	amount: z.string().describe('約定数量'),
	price: z.string().describe('約定価格'),
	maker_taker: z.string().describe('メイカー / テイカー'),
	fee_amount_base: z.string().describe('手数料（基軸通貨）'),
	fee_amount_quote: z.string().describe('手数料（決済通貨）'),
	executed_at: z.string().describe('約定日時（ISO8601）'),
});

export const GetMyTradeHistoryDataSchema = z.object({
	trades: z.array(TradeItemSchema),
	timestamp: z.string(),
});

export const GetMyTradeHistoryMetaSchema = z.object({
	fetchedAt: z.string(),
	tradeCount: z.number().int(),
	pair: z.string().optional(),
});

export const GetMyTradeHistoryOutputSchema = z.union([
	z.object({
		ok: z.literal(true),
		summary: z.string(),
		data: GetMyTradeHistoryDataSchema,
		meta: GetMyTradeHistoryMetaSchema,
	}),
	PrivateFailResultSchema,
]);

// ── get_my_orders ──

export const GetMyOrdersInputSchema = z.object({
	pair: z.string().optional()
		.describe('通貨ペア（例: btc_jpy）。省略で全ペア'),
	count: z.number().max(1000).default(100)
		.describe('取得件数（最大1000）'),
	since: z.string().optional()
		.describe('開始日時（ISO8601）'),
	end: z.string().optional()
		.describe('終了日時（ISO8601）'),
});

const OrderItemSchema = z.object({
	order_id: z.number().describe('注文ID'),
	pair: z.string().describe('通貨ペア'),
	side: z.string().describe('売買（buy / sell）'),
	type: z.string().describe('注文タイプ（limit / market / stop 等）'),
	start_amount: z.string().optional().describe('注文数量'),
	remaining_amount: z.string().optional().describe('未約定数量'),
	executed_amount: z.string().optional().describe('約定済み数量'),
	price: z.string().optional().describe('指値価格'),
	average_price: z.string().optional().describe('平均約定価格'),
	status: z.string().describe('注文ステータス'),
	ordered_at: z.string().describe('注文日時（ISO8601）'),
	expire_at: z.string().optional().describe('有効期限（ISO8601）'),
});

export const GetMyOrdersDataSchema = z.object({
	orders: z.array(OrderItemSchema),
	timestamp: z.string(),
});

export const GetMyOrdersMetaSchema = z.object({
	fetchedAt: z.string(),
	orderCount: z.number().int(),
	pair: z.string().optional(),
});

export const GetMyOrdersOutputSchema = z.union([
	z.object({
		ok: z.literal(true),
		summary: z.string(),
		data: GetMyOrdersDataSchema,
		meta: GetMyOrdersMetaSchema,
	}),
	PrivateFailResultSchema,
]);

// ── analyze_my_portfolio（Phase 3） ──

export const AnalyzeMyPortfolioInputSchema = z.object({
	include_technical: z.boolean().default(true)
		.describe('保有銘柄のテクニカル分析を含めるか'),
	include_pnl: z.boolean().default(true)
		.describe('損益分析を含めるか（約定履歴から平均取得単価・損益を算出）'),
	include_deposit_withdrawal: z.boolean().default(true)
		.describe('入出金データを含めるか（true の場合、総入金額 vs 現在評価額で口座全体のリターンを概算。直近100件ベースのため長期口座では概算値）'),
});

const HoldingPnlSchema = z.object({
	asset: z.string().describe('通貨コード'),
	pair: z.string().describe('通貨ペア（例: btc_jpy）'),
	amount: z.string().describe('保有数量'),
	avg_buy_price: z.number().optional().describe('平均取得単価（JPY）'),
	current_price: z.number().optional().describe('現在価格（JPY）'),
	jpy_value: z.number().optional().describe('現在の評価額（JPY）'),
	cost_basis: z.number().optional().describe('取得原価合計（JPY）'),
	unrealized_pnl: z.number().optional().describe('評価損益（JPY）'),
	unrealized_pnl_pct: z.number().optional().describe('評価損益率（%）'),
	realized_pnl: z.number().optional().describe('実現損益（JPY）'),
	trade_count: z.number().optional().describe('約定件数'),
});

const TechnicalSummarySchema = z.object({
	pair: z.string().describe('通貨ペア'),
	trend: z.string().optional().describe('トレンド判定'),
	rsi_14: z.number().optional().describe('RSI(14)'),
	sma_deviation_pct: z.number().optional().describe('SMA(25)乖離率（%）'),
	signal: z.string().optional().describe('総合シグナル'),
});

const DepositWithdrawalSummarySchema = z.object({
	total_jpy_deposited: z.number().describe('JPY 入金合計'),
	total_jpy_withdrawn: z.number().describe('JPY 出金合計'),
	net_jpy_invested: z.number().describe('純 JPY 投入額（入金 - 出金）'),
	crypto_deposit_count: z.number().describe('暗号資産入庫件数'),
	crypto_deposit_estimated_jpy: z.number().optional().describe('暗号資産入庫の推定 JPY 評価額（現在の市場価格で仮評価。入庫時点の価格ではない）'),
	crypto_withdrawal_count: z.number().describe('暗号資産出庫件数'),
	account_return_pct: z.number().optional().describe('口座全体リターン率（%）: (現在評価額 - 純投入額) / 純投入額'),
	account_return_jpy: z.number().optional().describe('口座全体リターン額（JPY）'),
	is_complete: z.boolean().describe('全履歴を取得できたか（false の場合は API 件数上限により一部のみ取得。リターンは概算値）'),
	analysis_basis: z.enum(['deposit_withdrawal', 'trade_only']).describe('分析基準（deposit_withdrawal: 入出金込み, trade_only: 約定ベース）'),
}).optional().describe('入出金ベースのリターン分析（入出金データがある場合のみ）');

export const AnalyzeMyPortfolioDataSchema = z.object({
	holdings: z.array(HoldingPnlSchema).describe('保有銘柄一覧（JPY評価額降順）'),
	total_jpy_value: z.number().optional().describe('ポートフォリオ合計評価額'),
	total_cost_basis: z.number().optional().describe('ポートフォリオ合計取得原価'),
	total_unrealized_pnl: z.number().optional().describe('合計評価損益'),
	total_unrealized_pnl_pct: z.number().optional().describe('合計評価損益率（%）'),
	total_realized_pnl: z.number().optional().describe('合計実現損益'),
	deposit_withdrawal_summary: DepositWithdrawalSummarySchema,
	technical: z.array(TechnicalSummarySchema).optional().describe('テクニカル分析サマリー'),
	timestamp: z.string(),
});

export const AnalyzeMyPortfolioMetaSchema = z.object({
	fetchedAt: z.string(),
	holdingCount: z.number().int(),
	hasPnl: z.boolean(),
	hasTechnical: z.boolean(),
	hasDepositWithdrawal: z.boolean(),
});

export const AnalyzeMyPortfolioOutputSchema = z.union([
	z.object({
		ok: z.literal(true),
		summary: z.string(),
		data: AnalyzeMyPortfolioDataSchema,
		meta: AnalyzeMyPortfolioMetaSchema,
	}),
	PrivateFailResultSchema,
]);

// ── get_my_deposit_withdrawal（Phase 4） ──

export const GetMyDepositWithdrawalInputSchema = z.object({
	asset: z.string().optional()
		.describe('通貨コード（例: btc, jpy）。省略で全通貨。JPY入出金を取得するには "jpy" を指定'),
	type: z.enum(['deposit', 'withdrawal', 'all']).default('all')
		.describe('取得タイプ（deposit: 入金/入庫のみ, withdrawal: 出金/出庫のみ, all: 両方）'),
	count: z.number().max(100).default(25)
		.describe('各履歴の取得件数（最大100）'),
	since: z.string().optional()
		.describe('開始日時（ISO8601、例: 2025-01-01T00:00:00+09:00）'),
	end: z.string().optional()
		.describe('終了日時（ISO8601、例: 2025-12-31T23:59:59+09:00）'),
});

const DepositItemSchema = z.object({
	uuid: z.string().describe('入金/入庫ID'),
	asset: z.string().describe('通貨コード'),
	amount: z.string().describe('金額/数量'),
	network: z.string().optional().describe('ネットワーク（暗号資産のみ）'),
	txid: z.string().optional().describe('トランザクションID（暗号資産のみ）'),
	status: z.string().describe('ステータス（FOUND / CONFIRMED / DONE）'),
	found_at: z.string().optional().describe('検出日時（ISO8601）'),
	confirmed_at: z.string().optional().describe('確認日時（ISO8601）'),
});

const WithdrawalItemSchema = z.object({
	uuid: z.string().describe('出金/出庫ID'),
	asset: z.string().describe('通貨コード'),
	amount: z.string().describe('金額/数量'),
	fee: z.string().optional().describe('手数料'),
	network: z.string().optional().describe('ネットワーク（暗号資産のみ）'),
	txid: z.string().optional().describe('トランザクションID（暗号資産のみ）'),
	label: z.string().optional().describe('ラベル'),
	address: z.string().optional().describe('送金先アドレス（暗号資産のみ）'),
	bank_name: z.string().optional().describe('銀行名（JPY出金のみ）'),
	status: z.string().describe('ステータス（CONFIRMING / EXAMINING / SENDING / DONE / REJECTED / CANCELED）'),
	requested_at: z.string().optional().describe('リクエスト日時（ISO8601）'),
});

export const GetMyDepositWithdrawalDataSchema = z.object({
	deposits: z.array(DepositItemSchema),
	withdrawals: z.array(WithdrawalItemSchema),
	timestamp: z.string(),
});

export const GetMyDepositWithdrawalMetaSchema = z.object({
	fetchedAt: z.string(),
	depositCount: z.number().int(),
	withdrawalCount: z.number().int(),
	asset: z.string().optional(),
});

export const GetMyDepositWithdrawalOutputSchema = z.union([
	z.object({
		ok: z.literal(true),
		summary: z.string(),
		data: GetMyDepositWithdrawalDataSchema,
		meta: GetMyDepositWithdrawalMetaSchema,
	}),
	PrivateFailResultSchema,
]);
