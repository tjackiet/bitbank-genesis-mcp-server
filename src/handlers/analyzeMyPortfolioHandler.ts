/**
 * analyzeMyPortfolioHandler — ポートフォリオ分析のハンドラ（Phase 3 + Phase 4 拡張）。
 *
 * 1. get_my_assets で現在保有を取得
 * 2. get_my_trade_history で約定履歴を取得し、通貨ごとの平均取得単価・実現損益を算出
 * 3. ticker で現在価格を取得し、評価損益を算出
 * 4. （Phase 4）入出金履歴を取得し、口座全体のリターンを概算
 * 5. （オプション）テクニカル分析を統合
 *
 * 入出金データがある場合は「総入金額 vs 現在評価額」で口座全体のリターンを概算。
 * 入出金 API が失敗/データなしの場合は従来の約定ベース分析にフォールバック。
 */

import { ok, fail } from '../../lib/result.js';
import { nowIso, dayjs } from '../../lib/datetime.js';
import { formatPrice, formatPair, formatPercent, formatPriceJPY } from '../../lib/formatter.js';
import { getDefaultClient, PrivateApiError, BitbankPrivateClient } from '../private/client.js';
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

interface RawDeposit {
	uuid: string;
	asset: string;
	amount: string;
	status: string;
	found_at: number;
	confirmed_at: number;
}

interface RawWithdrawal {
	uuid: string;
	asset: string;
	amount: string;
	fee?: string;
	status: string;
	requested_at: number;
}

interface DepositWithdrawalData {
	deposits: RawDeposit[];
	withdrawals: RawWithdrawal[];
	/** 一部の API リクエストが失敗した場合の警告メッセージ */
	warnings: string[];
	/** 全リクエストが失敗した場合 true */
	allFailed: boolean;
	/** 全履歴を取得できたか（false = API 件数上限に達した） */
	isComplete: boolean;
}

/** 個別 API リクエストの結果をラップ */
type FetchResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function tryGet<T>(client: BitbankPrivateClient, path: string, params?: Record<string, string>): Promise<FetchResult<T>> {
	try {
		const data = await client.get<T>(path, params);
		return { ok: true, data };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: msg };
	}
}

/** ページネーション付きで入金履歴を全件取得（最大 MAX_PAGES ページ） */
const MAX_PAGES = 10;

async function paginateDeposits(
	client: BitbankPrivateClient,
	baseParams: Record<string, string>,
): Promise<{ deposits: RawDeposit[]; complete: boolean; error?: string }> {
	const all: RawDeposit[] = [];
	let since: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const params = { ...baseParams, count: '100', ...(since ? { since } : {}) };
		const result = await tryGet<{ deposits: RawDeposit[] }>(client, '/v1/user/deposit_history', params);
		if (!result.ok) {
			return { deposits: all, complete: all.length === 0 ? false : true, error: result.error };
		}
		const batch = result.data.deposits || [];
		all.push(...batch);
		if (batch.length < 100) {
			return { deposits: all, complete: true };
		}
		// 次ページ: 最後のレコードの confirmed_at + 1ms を since に
		const lastTs = batch[batch.length - 1]?.confirmed_at;
		if (!lastTs) break;
		since = String(lastTs + 1);
	}
	return { deposits: all, complete: false };
}

async function paginateWithdrawals(
	client: BitbankPrivateClient,
	baseParams: Record<string, string>,
): Promise<{ withdrawals: RawWithdrawal[]; complete: boolean; error?: string }> {
	const all: RawWithdrawal[] = [];
	let since: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const params = { ...baseParams, count: '100', ...(since ? { since } : {}) };
		const result = await tryGet<{ withdrawals: RawWithdrawal[] }>(client, '/v1/user/withdrawal_history', params);
		if (!result.ok) {
			return { withdrawals: all, complete: all.length === 0 ? false : true, error: result.error };
		}
		const batch = result.data.withdrawals || [];
		all.push(...batch);
		if (batch.length < 100) {
			return { withdrawals: all, complete: true };
		}
		const lastTs = batch[batch.length - 1]?.requested_at;
		if (!lastTs) break;
		since = String(lastTs + 1);
	}
	return { withdrawals: all, complete: false };
}

/** ページネーション付きで約定履歴を全件取得（最大 MAX_PAGES ページ、古い順） */
async function paginateTrades(
	client: BitbankPrivateClient,
): Promise<RawTrade[]> {
	const all: RawTrade[] = [];
	let since: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const params: Record<string, string> = { count: '1000', order: 'asc' };
		if (since) params.since = since;
		const result = await tryGet<{ trades: RawTrade[] }>(client, '/v1/user/spot/trade_history', params);
		if (!result.ok) break;
		const batch = result.data.trades || [];
		all.push(...batch);
		if (batch.length < 1000) break;
		// 次ページ: 最後の約定の executed_at + 1ms を since に
		const lastTs = batch[batch.length - 1]?.executed_at;
		if (!lastTs) break;
		since = String(lastTs + 1);
	}
	return all;
}

/**
 * 入出金履歴を取得する（JPY + 暗号資産の両方、ページネーション対応）。
 * 全リクエスト失敗時は null を返す。一部失敗時は warnings 付きで返す。
 */
async function fetchDepositWithdrawal(client: BitbankPrivateClient): Promise<DepositWithdrawalData | null> {
	try {
		const [cryptoDepResult, jpyDepResult, cryptoWdResult, jpyWdResult] = await Promise.all([
			paginateDeposits(client, {}),
			paginateDeposits(client, { asset: 'jpy' }),
			paginateWithdrawals(client, {}),
			paginateWithdrawals(client, { asset: 'jpy' }),
		]);

		const warnings: string[] = [];
		const apiResults = [
			{ error: cryptoDepResult.error, label: '暗号資産入庫履歴' },
			{ error: jpyDepResult.error, label: 'JPY入金履歴' },
			{ error: cryptoWdResult.error, label: '暗号資産出庫履歴' },
			{ error: jpyWdResult.error, label: 'JPY出金履歴' },
		];
		for (const { error, label } of apiResults) {
			if (error) {
				warnings.push(`${label}の取得に失敗: ${error}`);
			}
		}

		// 全チャネルでデータゼロかつエラーあり = 全失敗
		const totalItems = cryptoDepResult.deposits.length + jpyDepResult.deposits.length
			+ cryptoWdResult.withdrawals.length + jpyWdResult.withdrawals.length;
		if (totalItems === 0 && warnings.length === 4) {
			return { deposits: [], withdrawals: [], warnings, allFailed: true, isComplete: false };
		}

		// 成功分からデータを収集
		const rawDeposits = [...cryptoDepResult.deposits, ...jpyDepResult.deposits];
		const rawWithdrawals = [...cryptoWdResult.withdrawals, ...jpyWdResult.withdrawals];

		// UUID で重複排除
		const seenDeposit = new Set<string>();
		const allDeposits = rawDeposits.filter((d) => {
			if (seenDeposit.has(d.uuid)) return false;
			seenDeposit.add(d.uuid);
			return true;
		});

		const seenWithdrawal = new Set<string>();
		const allWithdrawals = rawWithdrawals.filter((w) => {
			if (seenWithdrawal.has(w.uuid)) return false;
			seenWithdrawal.add(w.uuid);
			return true;
		});

		const isComplete = cryptoDepResult.complete && jpyDepResult.complete
			&& cryptoWdResult.complete && jpyWdResult.complete;

		return { deposits: allDeposits, withdrawals: allWithdrawals, warnings, allFailed: false, isComplete };
	} catch {
		return null;
	}
}

/**
 * 入出金データから口座全体のリターンを算出する。
 *
 * - JPY 入金: 投資元本（入金）
 * - JPY 出金: 投資元本の回収（出金）
 * - 暗号資産入庫: 現在の市場価格で仮評価し、投入額に加算（入庫時点の価格は取得不可）
 * - 暗号資産出庫: 損益計算からは除外（他所への送金であり売却ではない）
 * - 純投入額 = JPY入金合計 - JPY出金合計 + 暗号資産入庫の推定JPY評価額
 * - 口座全体リターン = (現在評価額 - 純投入額) / 純投入額
 */
interface DepositWithdrawalSummary {
	total_jpy_deposited: number;
	total_jpy_withdrawn: number;
	net_jpy_invested: number;
	crypto_deposit_count: number;
	crypto_deposit_estimated_jpy: number | undefined;
	crypto_withdrawal_count: number;
	account_return_pct: number | undefined;
	account_return_jpy: number | undefined;
	is_complete: boolean;
	analysis_basis: 'deposit_withdrawal' | 'trade_only';
}

function calcDepositWithdrawalSummary(
	dw: DepositWithdrawalData,
	totalJpyValue: number,
	prices: Map<string, number>,
): DepositWithdrawalSummary {
	// DONE ステータスの入金のみ集計（FOUND / CONFIRMED は未完了）
	const completedDeposits = dw.deposits.filter((d) => d.status === 'DONE');
	const completedWithdrawals = dw.withdrawals.filter((w) => w.status === 'DONE');

	// JPY 入出金
	const jpyDeposits = completedDeposits.filter((d) => d.asset === 'jpy');
	const jpyWithdrawals = completedWithdrawals.filter((w) => w.asset === 'jpy');
	const totalJpyDeposited = jpyDeposits.reduce((sum, d) => sum + Number(d.amount), 0);
	const totalJpyWithdrawn = jpyWithdrawals.reduce((sum, w) => sum + Number(w.amount), 0);

	// 暗号資産入出庫
	const cryptoDeposits = completedDeposits.filter((d) => d.asset !== 'jpy');
	const cryptoWithdrawals = completedWithdrawals.filter((w) => w.asset !== 'jpy');

	// 暗号資産入庫の推定 JPY 評価（現在の市場価格で仮評価）
	// 注意: 入庫「時点」の価格は取得不可のため、現在価格での仮評価
	let cryptoDepositEstimatedJpy = 0;
	let hasEstimate = false;
	for (const d of cryptoDeposits) {
		const price = prices.get(d.asset);
		const amount = Number(d.amount);
		if (price && Number.isFinite(amount) && amount > 0) {
			cryptoDepositEstimatedJpy += amount * price;
			hasEstimate = true;
		}
	}

	const netJpyInvested = totalJpyDeposited - totalJpyWithdrawn + (hasEstimate ? cryptoDepositEstimatedJpy : 0);

	// 口座全体リターン
	let accountReturnPct: number | undefined;
	let accountReturnJpy: number | undefined;
	if (netJpyInvested > 0 && totalJpyValue > 0) {
		accountReturnJpy = Math.round(totalJpyValue - netJpyInvested);
		accountReturnPct = Math.round(((totalJpyValue - netJpyInvested) / netJpyInvested) * 10000) / 100;
	}

	return {
		total_jpy_deposited: Math.round(totalJpyDeposited),
		total_jpy_withdrawn: Math.round(totalJpyWithdrawn),
		net_jpy_invested: Math.round(netJpyInvested),
		crypto_deposit_count: cryptoDeposits.length,
		crypto_deposit_estimated_jpy: hasEstimate ? Math.round(cryptoDepositEstimatedJpy) : undefined,
		crypto_withdrawal_count: cryptoWithdrawals.length,
		account_return_pct: accountReturnPct,
		account_return_jpy: accountReturnJpy,
		is_complete: dw.isComplete,
		analysis_basis: 'deposit_withdrawal',
	};
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
 * 移動平均法（総平均法）を採用。手数料（fee_amount_quote）を考慮。
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
	let holdingCost = 0; // 保有分の取得原価合計（手数料込み）
	let realizedPnl = 0;

	for (const t of relevant) {
		const qty = Number(t.amount);
		const price = Number(t.price);
		if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;

		// 決済通貨（JPY）建ての手数料
		const feeQuote = Number(t.fee_amount_quote) || 0;

		if (t.side === 'buy') {
			// 買い: 約定金額 + 手数料 = 取得原価
			holdingCost += qty * price + feeQuote;
			holdingQty += qty;
		} else {
			// sell: 移動平均法で原価を按分
			if (holdingQty > 0) {
				const avgCost = holdingCost / holdingQty;
				const sellCost = qty * avgCost;
				const sellRevenue = qty * price - feeQuote; // 売却収入から手数料を差し引く
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
				realizedPnl += qty * price - feeQuote;
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

// ── 期間別実現損益（年初来 / 月初来） ──

interface PeriodRealizedPnl {
	/** 期間内の合計実現損益（JPY） */
	realized_pnl: number;
	/** 期間内の売却約定件数 */
	sell_count: number;
	/** 期間の開始日時（ISO8601 JST） */
	period_start: string;
	/** 期間の終了日時（ISO8601 JST） = 取得時点 */
	period_end: string;
}

/**
 * 指定期間内の実現損益を算出する。
 *
 * 移動平均法の avg_cost は全履歴から計算し（期間開始前の買いも含む）、
 * 期間内の売り約定のみ実現損益として集計する。
 *
 * @param trades 全約定履歴（古い順ソート済み）
 * @param sinceMs 期間開始のミリ秒タイムスタンプ（JST 境界）
 * @param periodStart ISO8601 形式の期間開始文字列
 * @param periodEnd ISO8601 形式の期間終了文字列
 */
function calcPeriodRealizedPnl(
	trades: RawTrade[],
	sinceMs: number,
	periodStart: string,
	periodEnd: string,
): PeriodRealizedPnl {
	// 全通貨の約定を古い順にソート
	const sorted = [...trades].sort((a, b) => a.executed_at - b.executed_at);

	// 通貨ごとに移動平均法で avg_cost を追跡し、期間内の sell のみ realized に計上
	const holdings = new Map<string, { qty: number; cost: number }>();
	let periodRealized = 0;
	let periodSellCount = 0;

	for (const t of sorted) {
		const asset = t.pair.replace('_jpy', '');
		if (asset === 'jpy') continue;

		const qty = Number(t.amount);
		const price = Number(t.price);
		if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;

		const feeQuote = Number(t.fee_amount_quote) || 0;
		const h = holdings.get(asset) ?? { qty: 0, cost: 0 };

		if (t.side === 'buy') {
			h.cost += qty * price + feeQuote;
			h.qty += qty;
		} else {
			// sell
			let sellRealized = 0;
			if (h.qty > 0) {
				const avgCost = h.cost / h.qty;
				const sellCost = qty * avgCost;
				const sellRevenue = qty * price - feeQuote;
				sellRealized = sellRevenue - sellCost;
				h.cost -= sellCost;
				h.qty -= qty;
				if (h.qty < 1e-12) { h.qty = 0; h.cost = 0; }
			} else {
				sellRealized = qty * price - feeQuote;
			}

			// 期間内の売りのみ集計
			if (t.executed_at >= sinceMs) {
				periodRealized += sellRealized;
				periodSellCount++;
			}
		}

		holdings.set(asset, h);
	}

	return {
		realized_pnl: Math.round(periodRealized),
		sell_count: periodSellCount,
		period_start: periodStart,
		period_end: periodEnd,
	};
}

/**
 * JST 基準の年初来・月初来の境界タイムスタンプを返す。
 */
function getJstPeriodBoundaries() {
	const nowJst = dayjs().tz('Asia/Tokyo');
	const yearStart = nowJst.startOf('year');
	const monthStart = nowJst.startOf('month');
	const dayStart = nowJst.startOf('day');
	return {
		yearStartMs: yearStart.valueOf(),
		yearStartIso: yearStart.format('YYYY-MM-DDTHH:mm:ssZ'),
		monthStartMs: monthStart.valueOf(),
		monthStartIso: monthStart.format('YYYY-MM-DDTHH:mm:ssZ'),
		dayStartMs: dayStart.valueOf(),
		dayStartIso: dayStart.format('YYYY-MM-DDTHH:mm:ssZ'),
		nowIso: nowJst.format('YYYY-MM-DDTHH:mm:ssZ'),
	};
}

// ── 期間別パフォーマンス（評価額比較） ──

interface PeriodPerformance {
	start_value_jpy: number;
	current_value_jpy: number;
	change_jpy: number;
	change_pct: number | undefined;
	net_flow_jpy: number;
	withdrawal_fee_jpy: number;
	adjusted_change_jpy: number;
	adjusted_change_pct: number | undefined;
	period_start: string;
	period_end: string;
	note: string;
}

/**
 * 指定された通貨ペアの1dayキャンドルから、年初・月初の始値を取得する。
 * 期初時点の「口座評価額」を復元するために使用。
 */
async function fetchPeriodStartPrices(
	pairs: string[],
	yearStartMs: number,
	monthStartMs: number,
	dayStartMs: number,
): Promise<Map<string, { yearStart?: number; monthStart?: number; dayStart?: number }>> {
	const result = new Map<string, { yearStart?: number; monthStart?: number; dayStart?: number }>();
	const nowJst = dayjs().tz('Asia/Tokyo');
	const year = nowJst.year();

	const promises = pairs.map(async (pair) => {
		try {
			const url = `https://public.bitbank.cc/${pair}/candlestick/1day/${year}`;
			const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
			if (!res.ok) return;
			const json = (await res.json()) as {
				success?: number;
				data?: { candlestick?: Array<{ ohlcv?: Array<Array<string | number>> }> };
			};
			if (json.success !== 1) return;

			const ohlcv = json.data?.candlestick?.[0]?.ohlcv;
			if (!Array.isArray(ohlcv) || ohlcv.length === 0) return;

			let yearStartPrice: number | undefined;
			let monthStartPrice: number | undefined;
			let dayStartPrice: number | undefined;

			for (const candle of ohlcv) {
				const ts = Number(candle[5]);
				const open = Number(candle[0]);
				if (!Number.isFinite(open) || open <= 0) continue;

				if (yearStartPrice == null && ts >= yearStartMs) {
					yearStartPrice = open;
				}
				if (monthStartPrice == null && ts >= monthStartMs) {
					monthStartPrice = open;
				}
				if (dayStartPrice == null && ts >= dayStartMs) {
					dayStartPrice = open;
				}
				if (yearStartPrice != null && monthStartPrice != null && dayStartPrice != null) break;
			}

			const asset = pair.replace('_jpy', '');
			result.set(asset, { yearStart: yearStartPrice, monthStart: monthStartPrice, dayStart: dayStartPrice });
		} catch {
			// Non-fatal: price unavailable for this pair
		}
	});

	await Promise.all(promises);
	return result;
}

/**
 * 現在の保有情報から取引・入出金を逆順に辿り、指定日時の保有状態を復元する。
 */
function reconstructHoldingsAtDate(
	currentHoldings: Array<{ asset: string; amount: string }>,
	trades: RawTrade[],
	sinceMs: number,
	dw: DepositWithdrawalData | null,
): Map<string, number> {
	const holdings = new Map<string, number>();
	for (const h of currentHoldings) {
		const amount = Number(h.amount);
		if (Number.isFinite(amount) && amount > 0) {
			holdings.set(h.asset, amount);
		}
	}

	// Reverse trades since sinceMs (newest first)
	const recentTrades = trades
		.filter((t) => t.executed_at >= sinceMs)
		.sort((a, b) => b.executed_at - a.executed_at);

	for (const t of recentTrades) {
		const asset = t.pair.replace('_jpy', '');
		const qty = Number(t.amount);
		const price = Number(t.price);
		const feeQuote = Number(t.fee_amount_quote) || 0;
		if (!Number.isFinite(qty) || !Number.isFinite(price)) continue;

		const current = holdings.get(asset) ?? 0;
		const currentJpy = holdings.get('jpy') ?? 0;

		if (t.side === 'buy') {
			// Reverse buy: remove crypto, add back JPY spent
			const newAmount = current - qty;
			if (newAmount < 1e-12) {
				holdings.delete(asset);
			} else {
				holdings.set(asset, newAmount);
			}
			holdings.set('jpy', currentJpy + qty * price + feeQuote);
		} else {
			// Reverse sell: add back crypto, remove JPY received
			holdings.set(asset, current + qty);
			holdings.set('jpy', currentJpy - qty * price + feeQuote);
		}
	}

	// Reverse deposits/withdrawals since sinceMs
	if (dw) {
		const completedDeposits = dw.deposits.filter(
			(d) => d.status === 'DONE' && d.confirmed_at >= sinceMs,
		);
		const completedWithdrawals = dw.withdrawals.filter(
			(w) => w.status === 'DONE' && w.requested_at >= sinceMs,
		);

		for (const d of completedDeposits) {
			const current = holdings.get(d.asset) ?? 0;
			const newAmount = current - Number(d.amount);
			if (newAmount < 1e-12) {
				holdings.delete(d.asset);
			} else {
				holdings.set(d.asset, newAmount);
			}
		}

		for (const w of completedWithdrawals) {
			const current = holdings.get(w.asset) ?? 0;
			const fee = Number(w.fee) || 0;
			holdings.set(w.asset, current + Number(w.amount) + fee);
		}
	}

	// Clean up negative/zero holdings
	for (const [asset, amount] of holdings) {
		if (amount < 1e-12) holdings.delete(asset);
	}

	return holdings;
}

/**
 * 復元された保有情報と価格マップから口座評価額を算出する。
 */
function calcPortfolioValue(
	holdings: Map<string, number>,
	priceMap: Map<string, number>,
): number {
	let total = 0;
	for (const [asset, amount] of holdings) {
		if (asset === 'jpy') {
			total += amount;
		} else {
			const price = priceMap.get(asset);
			if (price) {
				total += amount * price;
			}
		}
	}
	return total;
}

interface PeriodNetFlowResult {
	/** 純入出金額（元本移動のみ。出金手数料は含まない） */
	net_flow_jpy: number;
	/** 期間中の出金手数料合計（JPY）。コストとして performance に残る */
	withdrawal_fee_jpy: number;
}

/**
 * 期間中の純入出金額と出金手数料を分離して算出する。
 *
 * - net_flow_jpy: 元本の移動のみ（出金手数料を含まない）。
 *   正値 = 純入金（口座に資金流入）、負値 = 純出金。
 * - withdrawal_fee_jpy: 出金時に失った手数料の合計。
 *   adjusted_change から net_flow を引いた結果にこのコストが残る。
 *
 * 暗号資産の入出庫は現在価格で仮評価。
 */
function calcPeriodNetFlow(
	dw: DepositWithdrawalData | null,
	sinceMs: number,
	prices: Map<string, number>,
): PeriodNetFlowResult {
	if (!dw) return { net_flow_jpy: 0, withdrawal_fee_jpy: 0 };

	const completedDeposits = dw.deposits.filter(
		(d) => d.status === 'DONE' && d.confirmed_at >= sinceMs,
	);
	const completedWithdrawals = dw.withdrawals.filter(
		(w) => w.status === 'DONE' && w.requested_at >= sinceMs,
	);

	let netFlow = 0;
	let withdrawalFee = 0;

	// Deposits (inflow)
	for (const d of completedDeposits) {
		if (d.asset === 'jpy') {
			netFlow += Number(d.amount);
		} else {
			const price = prices.get(d.asset);
			const amount = Number(d.amount);
			if (price && Number.isFinite(amount) && amount > 0) {
				netFlow += amount * price;
			}
		}
	}

	// Withdrawals — 元本（外部フロー）と手数料（コスト）を分離
	for (const w of completedWithdrawals) {
		const fee = Number(w.fee) || 0;
		if (w.asset === 'jpy') {
			netFlow -= Number(w.amount);
			withdrawalFee += fee;
		} else {
			const price = prices.get(w.asset);
			const amount = Number(w.amount);
			if (price && Number.isFinite(amount) && amount > 0) {
				netFlow -= amount * price;
				if (fee > 0) {
					withdrawalFee += fee * price;
				}
			}
		}
	}

	return {
		net_flow_jpy: Math.round(netFlow),
		withdrawal_fee_jpy: Math.round(withdrawalFee),
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

			// trend は analyzeIndicators の data に含まれる
			const trend = data?.trend;

			// シグナル判定
			// analyzeIndicators の trend は uptrend/strong_uptrend/downtrend/strong_downtrend/sideways
			let signal = 'neutral';
			if (rsi14 != null) {
				if (rsi14 >= 70) signal = 'overbought';
				else if (rsi14 <= 30) signal = 'oversold';
			}
			const isBullish = trend === 'uptrend' || trend === 'strong_uptrend';
			const isBearish = trend === 'downtrend' || trend === 'strong_downtrend';
			if (isBullish && signal === 'neutral') signal = 'bullish';
			if (isBearish && signal === 'neutral') signal = 'bearish';

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
	include_deposit_withdrawal?: boolean;
}) {
	const { include_technical = true, include_pnl = true, include_deposit_withdrawal = true } = args;
	const client = getDefaultClient();

	try {
		// 1. 保有資産 + ticker を並列取得
		const [rawAssets, prices] = await Promise.all([
			client.get<{ assets: RawAsset[] }>('/v1/user/assets'),
			fetchTickerPrices(),
		]);

		// ゼロでない資産（JPY 含む）
		const nonZeroAssets = rawAssets.assets.filter((a) => {
			const amount = Number(a.onhand_amount);
			return Number.isFinite(amount) && amount > 0;
		});

		// 2. 約定履歴 + 入出金履歴を並列取得（全件ページネーション）
		const tradePromise = include_pnl
			? paginateTrades(client)
			: Promise.resolve([] as RawTrade[]);

		const dwPromise = include_deposit_withdrawal
			? fetchDepositWithdrawal(client)
			: Promise.resolve(null);

		const [allTrades, dwData] = await Promise.all([tradePromise, dwPromise]);

		// JST 基準の年初来・月初来の境界（period performance + realized PnL 両方で使用）
		const boundaries = getJstPeriodBoundaries();

		// 期間パフォーマンス用: 全関連ペアのキャンドルデータを早期フェッチ開始
		const allRelevantPairs = new Set<string>();
		for (const a of nonZeroAssets) {
			if (a.asset !== 'jpy') allRelevantPairs.add(`${a.asset}_jpy`);
		}
		for (const t of allTrades) {
			if (t.pair.endsWith('_jpy') && !t.pair.startsWith('jpy_')) {
				allRelevantPairs.add(t.pair);
			}
		}
		const periodPricePromise = include_pnl
			? fetchPeriodStartPrices([...allRelevantPairs], boundaries.yearStartMs, boundaries.monthStartMs, boundaries.dayStartMs)
			: Promise.resolve(new Map<string, { yearStart?: number; monthStart?: number; dayStart?: number }>());

		const timestamp = nowIso();

		// 3. 各保有通貨の損益算出
		let totalJpyValue = 0;
		let totalCostBasis = 0;
		let totalRealizedPnl = 0;
		let hasCostData = false;

		const holdings = nonZeroAssets.map((a) => {
			const amount = a.onhand_amount;
			const isJpy = a.asset === 'jpy';

			// JPY はそのまま評価額 = 保有量
			const currentPrice = isJpy ? 1 : prices.get(a.asset);
			const jpyValue = isJpy
				? Number(amount)
				: (currentPrice ? Number(amount) * currentPrice : undefined);

			if (jpyValue != null && Number.isFinite(jpyValue)) {
				totalJpyValue += jpyValue;
			}

			// JPY は損益計算不要
			if (isJpy) {
				return {
					asset: a.asset,
					pair: 'jpy',
					amount,
					avg_buy_price: undefined,
					current_price: undefined,
					jpy_value: jpyValue != null ? Math.round(jpyValue) : undefined,
					cost_basis: undefined,
					unrealized_pnl: undefined,
					unrealized_pnl_pct: undefined,
					realized_pnl: undefined,
					trade_count: undefined,
				};
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

		// 売り切り銘柄の実現損益を集計（現在保有ゼロだが約定履歴がある通貨）
		if (include_pnl && allTrades.length > 0) {
			const heldAssets = new Set(nonZeroAssets.map((a) => a.asset));
			const tradedAssets = new Set(
				allTrades
					.map((t) => t.pair.replace('_jpy', ''))
					.filter((a) => a !== 'jpy'),
			);
			for (const asset of tradedAssets) {
				if (!heldAssets.has(asset)) {
					const pnl = calcPnl(allTrades, asset);
					if (pnl.realized_pnl !== 0) {
						totalRealizedPnl += pnl.realized_pnl;
					}
				}
			}
		}

		// 6.5. 年初来・月初来の実現損益を算出（JST 基準）
		let yearlyRealizedPnl: PeriodRealizedPnl | undefined;
		let monthlyRealizedPnl: PeriodRealizedPnl | undefined;
		if (include_pnl && allTrades.length > 0) {
			yearlyRealizedPnl = calcPeriodRealizedPnl(
				allTrades, boundaries.yearStartMs, boundaries.yearStartIso, boundaries.nowIso,
			);
			monthlyRealizedPnl = calcPeriodRealizedPnl(
				allTrades, boundaries.monthStartMs, boundaries.monthStartIso, boundaries.nowIso,
			);
		}

		// 6.6. 期間別パフォーマンス（評価額比較）— 主指標
		let yearlyPerformance: PeriodPerformance | undefined;
		let monthlyPerformance: PeriodPerformance | undefined;
		let dailyPerformance: PeriodPerformance | undefined;
		if (include_pnl) {
			const periodPrices = await periodPricePromise;
			const currentJpyValueRounded = Math.round(totalJpyValue);
			const performanceNote = '期初評価額は現在の保有状態から約定・入出金を逆算して復元し、期初時点の始値（1day candle open）で評価。暗号資産の入出庫は現在価格で仮評価。純入出金は元本移動のみ（出金手数料を含まない）。調整後増減 = 単純増減 - 純入出金（市場変動 + 出金手数料コスト）。';

			// 年初比パフォーマンス
			const yearStartHoldings = reconstructHoldingsAtDate(
				nonZeroAssets.map((a) => ({ asset: a.asset, amount: a.onhand_amount })),
				allTrades, boundaries.yearStartMs, dwData,
			);
			const yearStartPriceMap = new Map<string, number>();
			for (const [asset, pp] of periodPrices) {
				if (pp.yearStart != null) yearStartPriceMap.set(asset, pp.yearStart);
			}
			const yearStartValue = Math.round(calcPortfolioValue(yearStartHoldings, yearStartPriceMap));
			const yearFlow = calcPeriodNetFlow(dwData, boundaries.yearStartMs, prices);
			const yearChange = currentJpyValueRounded - yearStartValue;
			const yearAdjusted = yearChange - yearFlow.net_flow_jpy;
			yearlyPerformance = {
				start_value_jpy: yearStartValue,
				current_value_jpy: currentJpyValueRounded,
				change_jpy: yearChange,
				change_pct: yearStartValue > 0 ? Math.round((yearChange / yearStartValue) * 10000) / 100 : undefined,
				net_flow_jpy: yearFlow.net_flow_jpy,
				withdrawal_fee_jpy: yearFlow.withdrawal_fee_jpy,
				adjusted_change_jpy: yearAdjusted,
				adjusted_change_pct: yearStartValue > 0 ? Math.round((yearAdjusted / yearStartValue) * 10000) / 100 : undefined,
				period_start: boundaries.yearStartIso,
				period_end: boundaries.nowIso,
				note: performanceNote,
			};

			// 月初比パフォーマンス
			const monthStartHoldings = reconstructHoldingsAtDate(
				nonZeroAssets.map((a) => ({ asset: a.asset, amount: a.onhand_amount })),
				allTrades, boundaries.monthStartMs, dwData,
			);
			const monthStartPriceMap = new Map<string, number>();
			for (const [asset, pp] of periodPrices) {
				if (pp.monthStart != null) monthStartPriceMap.set(asset, pp.monthStart);
			}
			const monthStartValue = Math.round(calcPortfolioValue(monthStartHoldings, monthStartPriceMap));
			const monthFlow = calcPeriodNetFlow(dwData, boundaries.monthStartMs, prices);
			const monthChange = currentJpyValueRounded - monthStartValue;
			const monthAdjusted = monthChange - monthFlow.net_flow_jpy;
			monthlyPerformance = {
				start_value_jpy: monthStartValue,
				current_value_jpy: currentJpyValueRounded,
				change_jpy: monthChange,
				change_pct: monthStartValue > 0 ? Math.round((monthChange / monthStartValue) * 10000) / 100 : undefined,
				net_flow_jpy: monthFlow.net_flow_jpy,
				withdrawal_fee_jpy: monthFlow.withdrawal_fee_jpy,
				adjusted_change_jpy: monthAdjusted,
				adjusted_change_pct: monthStartValue > 0 ? Math.round((monthAdjusted / monthStartValue) * 10000) / 100 : undefined,
				period_start: boundaries.monthStartIso,
				period_end: boundaries.nowIso,
				note: performanceNote,
			};

			// 前日比（当日 00:00 JST）パフォーマンス
			const dayStartHoldings = reconstructHoldingsAtDate(
				nonZeroAssets.map((a) => ({ asset: a.asset, amount: a.onhand_amount })),
				allTrades, boundaries.dayStartMs, dwData,
			);
			const dayStartPriceMap = new Map<string, number>();
			for (const [asset, pp] of periodPrices) {
				if (pp.dayStart != null) dayStartPriceMap.set(asset, pp.dayStart);
			}
			const dayStartValue = Math.round(calcPortfolioValue(dayStartHoldings, dayStartPriceMap));
			const dayFlow = calcPeriodNetFlow(dwData, boundaries.dayStartMs, prices);
			const dayChange = currentJpyValueRounded - dayStartValue;
			const dayAdjusted = dayChange - dayFlow.net_flow_jpy;
			dailyPerformance = {
				start_value_jpy: dayStartValue,
				current_value_jpy: currentJpyValueRounded,
				change_jpy: dayChange,
				change_pct: dayStartValue > 0 ? Math.round((dayChange / dayStartValue) * 10000) / 100 : undefined,
				net_flow_jpy: dayFlow.net_flow_jpy,
				withdrawal_fee_jpy: dayFlow.withdrawal_fee_jpy,
				adjusted_change_jpy: dayAdjusted,
				adjusted_change_pct: dayStartValue > 0 ? Math.round((dayAdjusted / dayStartValue) * 10000) / 100 : undefined,
				period_start: boundaries.dayStartIso,
				period_end: boundaries.nowIso,
				note: performanceNote,
			};
		}

		// JPY 評価額降順ソート
		holdings.sort((a, b) => (b.jpy_value ?? 0) - (a.jpy_value ?? 0));

		// 暗号資産 / JPY を分離（テクニカル分析・サマリー・評価損益で使い分ける）
		const cryptoHoldings = holdings.filter((h) => h.asset !== 'jpy');
		const jpyHolding = holdings.find((h) => h.asset === 'jpy');

		// 合計評価損益（暗号資産部分のみ。JPY 残高は cost_basis に含めない）
		// ticker 未取得の銘柄がある場合は totalCostBasis に原価だけ積まれて過大なマイナスになるため、
		// 現在値が取れた銘柄の原価だけを集計し直す
		let validCostBasis = 0;
		let validJpyValue = 0;
		for (const h of cryptoHoldings) {
			if (h.jpy_value != null && h.cost_basis != null) {
				validCostBasis += h.cost_basis;
				validJpyValue += h.jpy_value;
			}
		}
		const hasValidCostData = validCostBasis > 0;
		const totalUnrealizedPnl = hasValidCostData ? Math.round(validJpyValue - validCostBasis) : undefined;
		const totalUnrealizedPnlPct = (totalUnrealizedPnl != null && validCostBasis > 0)
			? Math.round((totalUnrealizedPnl / validCostBasis) * 10000) / 100
			: undefined;

		// ticker 未取得の銘柄がある場合は警告
		const missingPriceAssets = cryptoHoldings
			.filter((h) => h.jpy_value == null && h.cost_basis != null)
			.map((h) => h.asset.toUpperCase());
		const hasMissingPrices = missingPriceAssets.length > 0;

		// 4. 入出金ベースのリターン計算（Phase 4）
		let dwSummary: DepositWithdrawalSummary | undefined;
		const dwWarnings: string[] = [];
		if (dwData) {
			if (dwData.allFailed) {
				// 全リクエスト失敗: trade_only フォールバック + 警告
				dwWarnings.push('入出金履歴の取得に全て失敗したため、約定ベースの分析のみです');
			} else {
				if (dwData.warnings.length > 0) {
					dwWarnings.push(...dwData.warnings.map((w) => `注意: ${w}（部分的なデータで概算）`));
				}
				if (dwData.deposits.length > 0 || dwData.withdrawals.length > 0) {
					dwSummary = calcDepositWithdrawalSummary(dwData, totalJpyValue, prices);
				}
			}
		}

		// 5. テクニカル分析（オプション、暗号資産のみ）
		let technical: TechnicalSummary[] | undefined;
		if (include_technical && cryptoHoldings.length > 0) {
			const jpyPairs = cryptoHoldings
				.filter((h) => h.jpy_value != null)
				.map((h) => h.pair);
			technical = await fetchTechnical(jpyPairs);
		}

		// 5.5. depositWithdrawalStatus の判定（summary 生成より先に確定する）:
		// - not_requested: include_deposit_withdrawal=false
		// - available: 入出金データ取得成功＋分析実行
		// - no_history: API取得成功・警告なし・本当に履歴0件
		// - fallback: API取得失敗・partial failure 等で約定ベースにフォールバック
		let depositWithdrawalStatus: 'available' | 'fallback' | 'no_history' | 'not_requested';
		if (!include_deposit_withdrawal) {
			depositWithdrawalStatus = 'not_requested';
		} else if (dwSummary != null) {
			depositWithdrawalStatus = 'available';
		} else if (
			dwData
			&& !dwData.allFailed
			&& dwData.warnings.length === 0
			&& dwData.deposits.length === 0
			&& dwData.withdrawals.length === 0
		) {
			depositWithdrawalStatus = 'no_history';
		} else {
			depositWithdrawalStatus = 'fallback';
		}

		// 6. サマリー文字列の生成
		const lines: string[] = [];
		lines.push(`ポートフォリオ分析: 暗号資産 ${cryptoHoldings.length}銘柄${jpyHolding ? ' + JPY' : ''}`);
		lines.push(`取得時刻: ${timestamp}`);
		if (totalJpyValue > 0) {
			lines.push(`口座合計: ${formatPrice(Math.round(totalJpyValue))}${jpyHolding ? ` (うち JPY: ${formatPriceJPY(jpyHolding.jpy_value ?? 0)})` : ''}`);
		}

		// 主指標: 前日比・年初比・月初比の口座評価額増減
		if (dailyPerformance) {
			const dSign = dailyPerformance.change_jpy >= 0 ? '+' : '';
			lines.push(`前日比: ${formatPriceJPY(dailyPerformance.start_value_jpy)} → ${formatPriceJPY(dailyPerformance.current_value_jpy)}`);
			lines.push(`  増減: ${dSign}${formatPriceJPY(dailyPerformance.change_jpy)}${dailyPerformance.change_pct != null ? ` (${formatPercent(dailyPerformance.change_pct, { sign: true })})` : ''}`);
			if (dailyPerformance.net_flow_jpy !== 0 || dailyPerformance.withdrawal_fee_jpy > 0) {
				const adjSign = dailyPerformance.adjusted_change_jpy >= 0 ? '+' : '';
				lines.push(`  入出金調整後: ${adjSign}${formatPriceJPY(dailyPerformance.adjusted_change_jpy)}${dailyPerformance.adjusted_change_pct != null ? ` (${formatPercent(dailyPerformance.adjusted_change_pct, { sign: true })})` : ''}`);
				const flowSign = dailyPerformance.net_flow_jpy >= 0 ? '+' : '';
				lines.push(`  純入出金（元本）: ${flowSign}${formatPriceJPY(dailyPerformance.net_flow_jpy)}`);
				if (dailyPerformance.withdrawal_fee_jpy > 0) {
					lines.push(`  出金手数料: -${formatPriceJPY(dailyPerformance.withdrawal_fee_jpy)}`);
				}
			}
		}
		if (yearlyPerformance) {
			const ySign = yearlyPerformance.change_jpy >= 0 ? '+' : '';
			lines.push(`年初比: ${formatPriceJPY(yearlyPerformance.start_value_jpy)} → ${formatPriceJPY(yearlyPerformance.current_value_jpy)}`);
			lines.push(`  増減: ${ySign}${formatPriceJPY(yearlyPerformance.change_jpy)}${yearlyPerformance.change_pct != null ? ` (${formatPercent(yearlyPerformance.change_pct, { sign: true })})` : ''}`);
			if (yearlyPerformance.net_flow_jpy !== 0 || yearlyPerformance.withdrawal_fee_jpy > 0) {
				const adjSign = yearlyPerformance.adjusted_change_jpy >= 0 ? '+' : '';
				lines.push(`  入出金調整後: ${adjSign}${formatPriceJPY(yearlyPerformance.adjusted_change_jpy)}${yearlyPerformance.adjusted_change_pct != null ? ` (${formatPercent(yearlyPerformance.adjusted_change_pct, { sign: true })})` : ''}`);
				const flowSign = yearlyPerformance.net_flow_jpy >= 0 ? '+' : '';
				lines.push(`  純入出金（元本）: ${flowSign}${formatPriceJPY(yearlyPerformance.net_flow_jpy)}`);
				if (yearlyPerformance.withdrawal_fee_jpy > 0) {
					lines.push(`  出金手数料: -${formatPriceJPY(yearlyPerformance.withdrawal_fee_jpy)}`);
				}
			}
		}
		if (monthlyPerformance) {
			const mSign = monthlyPerformance.change_jpy >= 0 ? '+' : '';
			lines.push(`月初比: ${formatPriceJPY(monthlyPerformance.start_value_jpy)} → ${formatPriceJPY(monthlyPerformance.current_value_jpy)}`);
			lines.push(`  増減: ${mSign}${formatPriceJPY(monthlyPerformance.change_jpy)}${monthlyPerformance.change_pct != null ? ` (${formatPercent(monthlyPerformance.change_pct, { sign: true })})` : ''}`);
			if (monthlyPerformance.net_flow_jpy !== 0 || monthlyPerformance.withdrawal_fee_jpy > 0) {
				const adjSign = monthlyPerformance.adjusted_change_jpy >= 0 ? '+' : '';
				lines.push(`  入出金調整後: ${adjSign}${formatPriceJPY(monthlyPerformance.adjusted_change_jpy)}${monthlyPerformance.adjusted_change_pct != null ? ` (${formatPercent(monthlyPerformance.adjusted_change_pct, { sign: true })})` : ''}`);
				const flowSign = monthlyPerformance.net_flow_jpy >= 0 ? '+' : '';
				lines.push(`  純入出金（元本）: ${flowSign}${formatPriceJPY(monthlyPerformance.net_flow_jpy)}`);
				if (monthlyPerformance.withdrawal_fee_jpy > 0) {
					lines.push(`  出金手数料: -${formatPriceJPY(monthlyPerformance.withdrawal_fee_jpy)}`);
				}
			}
		}
		if (yearlyPerformance || monthlyPerformance) {
			lines.push(`期間基準: JST`);
			lines.push('※ 期初評価額は約定・入出金を逆算して復元、期初始値で評価。暗号資産入出庫は現在価格で仮評価');
			lines.push('※ 出金元本は外部フローとして除外、出金手数料はコストとして performance に含む');
		}

		// 入出金分析状態と分析基準をsummaryに明示（structuredContentを見ないLLM向け）
		if (depositWithdrawalStatus === 'available') {
			lines.push(`入出金分析状態: available`);
			lines.push(`分析基準: deposit_withdrawal`);
		} else if (depositWithdrawalStatus === 'fallback') {
			lines.push(`入出金分析状態: fallback`);
			lines.push(`分析基準: trade_only`);
			if (dwData?.allFailed) {
				lines.push('※ 入出金APIの取得に全て失敗したため、約定ベースの分析のみです');
			} else {
				lines.push('※ API取得失敗またはpartial failureのため、約定ベースの分析にフォールバックしています');
			}
		} else if (depositWithdrawalStatus === 'no_history') {
			lines.push(`入出金分析状態: no_history`);
			lines.push(`分析基準: trade_only`);
			lines.push('※ 入出金履歴が0件のため、入出金ベース分析なし。約定ベースの分析のみです');
		} else {
			// not_requested
			lines.push(`入出金分析状態: not_requested`);
			lines.push(`分析基準: trade_only`);
			lines.push('※ 入出金分析は未リクエスト。約定ベースの分析のみです');
		}

		// 入出金ベースの口座全体リターン（Phase 4）
		if (dwSummary && dwSummary.account_return_jpy != null) {
			const sign = dwSummary.account_return_jpy >= 0 ? '+' : '';
			const approxLabel = dwSummary.is_complete ? '' : '（概算）';
			lines.push(`口座全体リターン${approxLabel}: ${sign}${formatPriceJPY(dwSummary.account_return_jpy)} (${formatPercent(dwSummary.account_return_pct, { sign: true })})`);
			// 内訳を式追跡しやすい形で表示
			lines.push(`  JPY入金合計: ${formatPriceJPY(dwSummary.total_jpy_deposited)}`);
			if (dwSummary.total_jpy_withdrawn > 0) {
				lines.push(`  JPY出金合計: ${formatPriceJPY(dwSummary.total_jpy_withdrawn)}`);
			}
			const netJpyDeposit = dwSummary.total_jpy_deposited - dwSummary.total_jpy_withdrawn;
			lines.push(`  JPY純入金: ${formatPriceJPY(Math.round(netJpyDeposit))}`);
			if (dwSummary.crypto_deposit_estimated_jpy) {
				lines.push(`  暗号資産入庫の仮評価: ${formatPriceJPY(dwSummary.crypto_deposit_estimated_jpy)}（${dwSummary.crypto_deposit_count}件、現在価格ベース）`);
			}
			lines.push(`  純投入額: ${formatPriceJPY(dwSummary.net_jpy_invested)}${dwSummary.crypto_deposit_estimated_jpy ? '（JPY純入金 + 暗号資産入庫の仮評価）' : ''}`);
			if (!dwSummary.is_complete) {
				lines.push('  ※ 入出金履歴が多く全件取得できなかったため、概算値です');
			}
			if (dwSummary.crypto_deposit_count > 0 && !dwSummary.crypto_deposit_estimated_jpy) {
				lines.push(`  ※ 暗号資産入庫 ${dwSummary.crypto_deposit_count}件の価格が取得できず仮評価に含まれていません`);
			}
			if (dwSummary.crypto_withdrawal_count > 0) {
				lines.push(`  ※ 暗号資産出庫 ${dwSummary.crypto_withdrawal_count}件は送金として損益計算から除外しています`);
			}
		}

		// 入出金取得の警告
		if (dwWarnings.length > 0) {
			for (const w of dwWarnings) {
				lines.push(`  ${w}`);
			}
		}

		if (totalUnrealizedPnl != null) {
			const sign = totalUnrealizedPnl >= 0 ? '+' : '';
			lines.push(`合計評価損益（約定ベース）: ${sign}${formatPriceJPY(totalUnrealizedPnl)} (${formatPercent(totalUnrealizedPnlPct, { sign: true })})`);
		}
		lines.push('');

		// 銘柄別サマリー（暗号資産のみ。JPY は口座合計に含む）
		for (const h of cryptoHoldings) {
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

		// ticker 未取得警告
		if (hasMissingPrices) {
			lines.push('');
			lines.push(`注意: ${missingPriceAssets.join(', ')} の現在価格が取得できなかったため、評価損益から除外しています`);
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

		// deposit_withdrawal_summary の出し分け（status に基づく一貫した契約）:
		// - available: dwSummary（実データ、analysis_basis='deposit_withdrawal'）
		// - fallback: placeholder（analysis_basis='trade_only'）— 常に返す
		// - no_history: undefined（API成功だが履歴なし）
		// - not_requested: undefined（未リクエスト）
		const fallbackPlaceholder = {
			total_jpy_deposited: 0,
			total_jpy_withdrawn: 0,
			net_jpy_invested: 0,
			crypto_deposit_count: 0,
			crypto_deposit_estimated_jpy: undefined,
			crypto_withdrawal_count: 0,
			account_return_pct: undefined,
			account_return_jpy: undefined,
			is_complete: false,
			analysis_basis: 'trade_only' as const,
		};

		const depositWithdrawalSummary = depositWithdrawalStatus === 'available'
			? dwSummary
			: depositWithdrawalStatus === 'fallback'
				? fallbackPlaceholder
				: undefined;

		const data = {
			holdings,
			total_jpy_value: totalJpyValue > 0 ? Math.round(totalJpyValue) : undefined,
			total_cost_basis: hasValidCostData ? Math.round(validCostBasis) : undefined,
			total_unrealized_pnl: totalUnrealizedPnl,
			total_unrealized_pnl_pct: totalUnrealizedPnlPct,
			total_realized_pnl: totalRealizedPnl !== 0 ? totalRealizedPnl : undefined,
			daily_performance: dailyPerformance,
			yearly_performance: yearlyPerformance,
			monthly_performance: monthlyPerformance,
			yearly_realized_pnl: yearlyRealizedPnl ? {
				realized_pnl: yearlyRealizedPnl.realized_pnl,
				sell_count: yearlyRealizedPnl.sell_count,
				period_start: yearlyRealizedPnl.period_start,
				period_end: yearlyRealizedPnl.period_end,
			} : undefined,
			monthly_realized_pnl: monthlyRealizedPnl ? {
				realized_pnl: monthlyRealizedPnl.realized_pnl,
				sell_count: monthlyRealizedPnl.sell_count,
				period_start: monthlyRealizedPnl.period_start,
				period_end: monthlyRealizedPnl.period_end,
			} : undefined,
			deposit_withdrawal_summary: depositWithdrawalSummary,
			technical: technical && technical.length > 0 ? technical : undefined,
			timestamp,
		};

		const meta = {
			fetchedAt: timestamp,
			holdingCount: holdings.length,
			hasPnl: include_pnl && allTrades.length > 0,
			hasTechnical: include_technical && (technical?.length ?? 0) > 0,
			depositWithdrawalStatus,
			periodBasis: 'jst' as const,
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
