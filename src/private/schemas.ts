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

// ── get_my_trade_history（Phase 2 で実装、スキーマは先行定義） ──

export const GetMyTradeHistoryInputSchema = z.object({
	pair: z.string().optional()
		.describe('通貨ペア（省略で全ペア）'),
	since: z.string().optional()
		.describe('開始日時（ISO8601）'),
	end: z.string().optional()
		.describe('終了日時（ISO8601）'),
	count: z.number().max(1000).default(100)
		.describe('取得件数（最大1000）'),
});

// ── analyze_my_portfolio（Phase 3 で実装、スキーマは先行定義） ──

export const AnalyzeMyPortfolioInputSchema = z.object({
	include_technical: z.boolean().default(true)
		.describe('保有銘柄のテクニカル分析を含めるか'),
	include_pnl: z.boolean().default(true)
		.describe('損益分析を含めるか'),
});
