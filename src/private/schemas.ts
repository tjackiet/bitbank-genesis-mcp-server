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

export const AnalyzeMyPortfolioDataSchema = z.object({
	holdings: z.array(HoldingPnlSchema).describe('保有銘柄一覧（JPY評価額降順）'),
	total_jpy_value: z.number().optional().describe('ポートフォリオ合計評価額'),
	total_cost_basis: z.number().optional().describe('ポートフォリオ合計取得原価'),
	total_unrealized_pnl: z.number().optional().describe('合計評価損益'),
	total_unrealized_pnl_pct: z.number().optional().describe('合計評価損益率（%）'),
	total_realized_pnl: z.number().optional().describe('合計実現損益'),
	technical: z.array(TechnicalSummarySchema).optional().describe('テクニカル分析サマリー'),
	timestamp: z.string(),
});

export const AnalyzeMyPortfolioMetaSchema = z.object({
	fetchedAt: z.string(),
	holdingCount: z.number().int(),
	hasPnl: z.boolean(),
	hasTechnical: z.boolean(),
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
