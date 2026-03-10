/**
 * analyzeMyPortfolioHandler — ポートフォリオ分析のハンドラ（Phase 3）。
 *
 * 1. get_my_assets で現在保有を取得
 * 2. get_my_trade_history で約定履歴を取得し、通貨ごとの平均取得単価・実現損益を算出
 * 3. ticker で現在価格を取得し、評価損益を算出
 * 4. （オプション）テクニカル分析を統合
 */

import { ok, fail } from '../../lib/result.js';
import { nowIso } from '../../lib/datetime.js';
import { formatPrice, formatPair, formatPercent, formatPriceJPY } from '../../lib/formatter.js';
import { getDefaultClient, PrivateApiError } from '../private/client.js';
import {
	AnalyzeMyPortfolioOutputSchema,
} from '../private/schemas.js';
import analyzeIndicators from '../../tools/analyze_indicators.js';

// ── Private API レスポンス型 ──

interface RawAsset {
	asset: string;
	free_amount: string;
	onhand_amount: string;
	locked_amount: string;
	amount_precision: number;
	withdrawal_fee: { min: string; max: string } | string;
	stop_deposit: boolean;
	stop_withdrawal: boolean;
}

interface RawTrade {
	trade_id: number;
	pair: string;
	order_id: number;
	side: string;
	type: string;
	amount: string;
	price: string;
	maker_taker: string;
	fee_amount_base: string;
	fee_amount_quote: string;
	executed_at: number;
}

// ── Ticker 取得 ──

async function fetchTickerPrices(): Promise<Map<string, number>> {
	const prices = new Map<string, number>();
	try {
		const res = await fetch('https://public.bitbank.cc/tickers_jpy', {
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) return prices;
		const json = (await res.json()) as { success?: number; data?: Array<{ pair: string; last: string }> };
		if (json.success !== 1 || !Array.isArray(json.data)) return prices;
		for (const item of json.data) {
			const asset = item.pair.replace('_jpy', '');
			const last = Number(item.last);
			if (Number.isFinite(last) && last > 0) prices.set(asset, last);
		}
	} catch { /* ticker 失敗は非致命的 */ }
	return prices;
}

// ── 損益計算エンジン ──

interface PnlResult {
	avg_buy_price: number | undefined;
	cost_basis: number | undefined;
	realized_pnl: number;
	trade_count: number;
}

/**
 * 約定履歴から通貨ごとの平均取得単価と実現損益を算出する。
 * 移動平均法（総平均法）を採用。
 */
function calcPnl(trades: RawTrade[], asset: string): PnlResult {
	// この通貨に関する約定を古い順にソート
	const pair = `${asset}_jpy`;
	const relevant = trades
		.filter((t) => t.pair === pair)
		.sort((a, b) => a.executed_at - b.executed_at);

	if (relevant.length === 0) {
		return { avg_buy_price: undefined, cost_basis: undefined, realized_pnl: 0, trade_count: 0 };
	}

	let holdingQty = 0;
	let holdingCost = 0; // 保有分の取得原価合計
	let realizedPnl = 0;

	for (const t of relevant) {
		const qty = Number(t.amount);
		const price = Number(t.price);
		if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;

		if (t.side === 'buy') {
			holdingCost += qty * price;
			holdingQty += qty;
		} else {
			// sell: 移動平均法で原価を按分
			if (holdingQty > 0) {
				const avgCost = holdingCost / holdingQty;
				const sellCost = qty * avgCost;
				const sellRevenue = qty * price;
				realizedPnl += sellRevenue - sellCost;
				holdingCost -= sellCost;
				holdingQty -= qty;
				// 誤差修正: 数量がゼロ近くなったらコストもリセット
				if (holdingQty < 1e-12) {
					holdingQty = 0;
					holdingCost = 0;
				}
			} else {
				// 保有ゼロ状態での売り（空売り等）: 実現損益のみ計上
				realizedPnl += qty * price;
			}
		}
	}

	const avgBuyPrice = holdingQty > 0 ? holdingCost / holdingQty : undefined;
	const costBasis = holdingQty > 0 ? holdingCost : undefined;

	return {
		avg_buy_price: avgBuyPrice,
		cost_basis: costBasis,
		realized_pnl: Math.round(realizedPnl),
		trade_count: relevant.length,
	};
}

// ── テクニカル分析 ──

interface TechnicalSummary {
	pair: string;
	trend?: string;
	rsi_14?: number;
	sma_deviation_pct?: number;
	signal?: string;
}

async function fetchTechnical(pairs: string[]): Promise<TechnicalSummary[]> {
	const results: TechnicalSummary[] = [];
	// 並列で取得（最大5通貨に制限）
	const targets = pairs.slice(0, 5);
	const promises = targets.map(async (pair) => {
		try {
			const res = await analyzeIndicators(pair, '1day', 60);
			if (!res?.ok) return null;
			const data = res.data as any;
			const indicators = data?.indicators || {};
			const rsi14 = indicators.RSI_14 != null ? Number(indicators.RSI_14) : undefined;
			const sma25 = indicators.SMA_25 != null ? Number(indicators.SMA_25) : undefined;
			const lastClose = data?.normalized?.at?.(-1)?.close;

			let smaDeviation: number | undefined;
			if (sma25 && lastClose && Number.isFinite(sma25) && Number.isFinite(lastClose)) {
				smaDeviation = Math.round(((lastClose - sma25) / sma25) * 10000) / 100;
			}

			// trend は analyzeIndicators の meta に含まれる
			const trend = (res.meta as any)?.trend;

			// シグナル判定
			let signal = 'neutral';
			if (rsi14 != null) {
				if (rsi14 >= 70) signal = 'overbought';
				else if (rsi14 <= 30) signal = 'oversold';
			}
			if (trend === 'bullish' && signal === 'neutral') signal = 'bullish';
			if (trend === 'bearish' && signal === 'neutral') signal = 'bearish';

			return {
				pair,
				trend,
				rsi_14: rsi14 != null ? Math.round(rsi14 * 100) / 100 : undefined,
				sma_deviation_pct: smaDeviation,
				signal,
			};
		} catch {
			return null;
		}
	});

	const settled = await Promise.all(promises);
	for (const r of settled) {
		if (r) results.push(r);
	}
	return results;
}

// ── メインハンドラ ──

export default async function analyzeMyPortfolioHandler(args: {
	include_technical?: boolean;
	include_pnl?: boolean;
}) {
	const { include_technical = true, include_pnl = true } = args;
	const client = getDefaultClient();

	try {
		// 1. 保有資産 + ticker を並列取得
		const [rawAssets, prices] = await Promise.all([
			client.get<{ assets: RawAsset[] }>('/v1/user/assets'),
			fetchTickerPrices(),
		]);

		// ゼロでない資産のみ（JPY 除外）
		const nonZeroAssets = rawAssets.assets.filter((a) => {
			const amount = Number(a.onhand_amount);
			return Number.isFinite(amount) && amount > 0 && a.asset !== 'jpy';
		});

		// 2. 約定履歴取得（PnL 計算用、最大1000件）
		let allTrades: RawTrade[] = [];
		if (include_pnl) {
			try {
				const tradeData = await client.get<{ trades: RawTrade[] }>(
					'/v1/user/spot/trade_history',
					{ count: '1000', order: 'asc' },
				);
				allTrades = tradeData.trades || [];
			} catch {
				// 約定履歴取得失敗は非致命的（PnL なしで続行）
			}
		}

		const timestamp = nowIso();

		// 3. 各保有通貨の損益算出
		let totalJpyValue = 0;
		let totalCostBasis = 0;
		let totalRealizedPnl = 0;
		let hasCostData = false;

		const holdings = nonZeroAssets.map((a) => {
			const amount = a.onhand_amount;
			const currentPrice = prices.get(a.asset);
			const jpyValue = currentPrice ? Number(amount) * currentPrice : undefined;

			if (jpyValue != null && Number.isFinite(jpyValue)) {
				totalJpyValue += jpyValue;
			}

			const pair = `${a.asset}_jpy`;
			const pnl = include_pnl ? calcPnl(allTrades, a.asset) : undefined;

			if (pnl?.cost_basis != null) {
				totalCostBasis += pnl.cost_basis;
				hasCostData = true;
			}
			if (pnl) {
				totalRealizedPnl += pnl.realized_pnl;
			}

			const unrealizedPnl = (jpyValue != null && pnl?.cost_basis != null)
				? Math.round(jpyValue - pnl.cost_basis)
				: undefined;
			const unrealizedPnlPct = (unrealizedPnl != null && pnl?.cost_basis != null && pnl.cost_basis > 0)
				? Math.round((unrealizedPnl / pnl.cost_basis) * 10000) / 100
				: undefined;

			return {
				asset: a.asset,
				pair,
				amount,
				avg_buy_price: pnl?.avg_buy_price != null ? Math.round(pnl.avg_buy_price) : undefined,
				current_price: currentPrice != null ? Math.round(currentPrice) : undefined,
				jpy_value: jpyValue != null ? Math.round(jpyValue) : undefined,
				cost_basis: pnl?.cost_basis != null ? Math.round(pnl.cost_basis) : undefined,
				unrealized_pnl: unrealizedPnl,
				unrealized_pnl_pct: unrealizedPnlPct,
				realized_pnl: pnl?.realized_pnl,
				trade_count: pnl?.trade_count,
			};
		});

		// JPY 評価額降順ソート
		holdings.sort((a, b) => (b.jpy_value ?? 0) - (a.jpy_value ?? 0));

		// 合計評価損益
		const totalUnrealizedPnl = hasCostData ? Math.round(totalJpyValue - totalCostBasis) : undefined;
		const totalUnrealizedPnlPct = (totalUnrealizedPnl != null && totalCostBasis > 0)
			? Math.round((totalUnrealizedPnl / totalCostBasis) * 10000) / 100
			: undefined;

		// 4. テクニカル分析（オプション）
		let technical: TechnicalSummary[] | undefined;
		if (include_technical && holdings.length > 0) {
			const jpyPairs = holdings
				.filter((h) => h.jpy_value != null)
				.map((h) => h.pair);
			technical = await fetchTechnical(jpyPairs);
		}

		// 5. サマリー文字列の生成
		const lines: string[] = [];
		lines.push(`ポートフォリオ分析: ${holdings.length}銘柄`);
		if (totalJpyValue > 0) {
			lines.push(`合計評価額: ${formatPrice(Math.round(totalJpyValue))}`);
		}
		if (totalUnrealizedPnl != null) {
			const sign = totalUnrealizedPnl >= 0 ? '+' : '';
			lines.push(`合計評価損益: ${sign}${formatPriceJPY(totalUnrealizedPnl)} (${formatPercent(totalUnrealizedPnlPct, { sign: true })})`);
		}
		if (totalRealizedPnl !== 0) {
			const sign = totalRealizedPnl >= 0 ? '+' : '';
			lines.push(`合計実現損益: ${sign}${formatPriceJPY(totalRealizedPnl)}`);
		}
		lines.push('');

		// 銘柄別サマリー
		for (const h of holdings) {
			const assetUpper = h.asset.toUpperCase();
			let line = `${assetUpper}: ${h.amount}`;
			if (h.jpy_value != null) {
				line += ` (${formatPriceJPY(h.jpy_value)})`;
			}
			if (h.unrealized_pnl != null) {
				const sign = h.unrealized_pnl >= 0 ? '+' : '';
				line += ` 損益: ${sign}${formatPriceJPY(h.unrealized_pnl)}`;
				if (h.unrealized_pnl_pct != null) {
					line += ` (${formatPercent(h.unrealized_pnl_pct, { sign: true })})`;
				}
			}
			if (h.avg_buy_price != null) {
				line += ` 取得単価: ${formatPrice(h.avg_buy_price)}`;
			}
			lines.push(line);
		}

		// テクニカルサマリー
		if (technical && technical.length > 0) {
			lines.push('');
			lines.push('テクニカル分析:');
			for (const t of technical) {
				const parts = [formatPair(t.pair)];
				if (t.trend) parts.push(`トレンド: ${t.trend}`);
				if (t.rsi_14 != null) parts.push(`RSI: ${t.rsi_14}`);
				if (t.sma_deviation_pct != null) parts.push(`SMA乖離: ${formatPercent(t.sma_deviation_pct, { sign: true })}`);
				if (t.signal) parts.push(`シグナル: ${t.signal}`);
				lines.push(`  ${parts.join(' / ')}`);
			}
		}

		const summary = lines.join('\n');

		const data = {
			holdings,
			total_jpy_value: totalJpyValue > 0 ? Math.round(totalJpyValue) : undefined,
			total_cost_basis: hasCostData ? Math.round(totalCostBasis) : undefined,
			total_unrealized_pnl: totalUnrealizedPnl,
			total_unrealized_pnl_pct: totalUnrealizedPnlPct,
			total_realized_pnl: totalRealizedPnl !== 0 ? totalRealizedPnl : undefined,
			technical: technical && technical.length > 0 ? technical : undefined,
			timestamp,
		};

		const meta = {
			fetchedAt: timestamp,
			holdingCount: holdings.length,
			hasPnl: include_pnl && allTrades.length > 0,
			hasTechnical: include_technical && (technical?.length ?? 0) > 0,
		};

		return AnalyzeMyPortfolioOutputSchema.parse(ok(summary, data, meta));
	} catch (err) {
		if (err instanceof PrivateApiError) {
			return AnalyzeMyPortfolioOutputSchema.parse(
				fail(err.message, err.errorType),
			);
		}
		return AnalyzeMyPortfolioOutputSchema.parse(
			fail(
				err instanceof Error ? err.message : 'ポートフォリオ分析中に予期しないエラーが発生しました',
				'upstream_error',
			),
		);
	}
}
