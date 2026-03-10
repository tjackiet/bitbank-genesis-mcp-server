/**
 * get_my_deposit_withdrawal — 入出金（入庫/出庫）履歴を取得する Private API ツール。
 *
 * bitbank Private API `/v1/user/deposit_history` および `/v1/user/withdrawal_history` を呼び出し、
 * LLM が分析しやすい形に整形して返す。
 *
 * - JPY 入出金: asset=jpy で取得
 * - 暗号資産入出庫: asset 省略または通貨コード指定で取得
 * - 両方を統合して返す（デフォルト動作: 全通貨 + JPY の入出金を統合取得）
 */

import { ok, fail } from '../../lib/result.js';
import { nowIso, toIsoMs, parseIso8601 } from '../../lib/datetime.js';
import { formatPrice } from '../../lib/formatter.js';
import { getDefaultClient, PrivateApiError, BitbankPrivateClient } from '../../src/private/client.js';
import {
	GetMyDepositWithdrawalInputSchema,
	GetMyDepositWithdrawalOutputSchema,
} from '../../src/private/schemas.js';
import type { ToolDefinition } from '../../src/tool-definition.js';

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

/** bitbank /v1/user/deposit_history のレスポンス型 */
interface RawDeposit {
	uuid: string;
	asset: string;
	network?: string;
	amount: string;
	txid?: string | null;
	status: string;
	found_at: number;
	confirmed_at: number;
}

/** bitbank /v1/user/withdrawal_history のレスポンス型 */
interface RawWithdrawal {
	uuid: string;
	asset: string;
	account_uuid?: string;
	amount: string;
	fee?: string;
	label?: string;
	address?: string;
	network?: string;
	txid?: string | null;
	destination_tag?: number | string | null;
	bank_name?: string;
	branch_name?: string;
	account_type?: string;
	account_number?: string;
	account_owner?: string;
	status: string;
	requested_at: number;
}

export default async function getMyDepositWithdrawal(args: {
	asset?: string;
	type?: 'deposit' | 'withdrawal' | 'all';
	count?: number;
	since?: string;
	end?: string;
}) {
	const { asset, type = 'all', count = 25, since, end } = args;
	const client = getDefaultClient();

	try {
		// クエリパラメータを組み立て
		const baseParams: Record<string, string> = {};
		if (count !== 25) baseParams.count = String(count);

		// ISO8601 → unix ms 変換
		if (since) {
			const parsed = parseIso8601(since);
			if (!parsed) {
				return GetMyDepositWithdrawalOutputSchema.parse(
					fail(`since の日時形式が不正です: ${since}`, 'validation_error'),
				);
			}
			baseParams.since = String(parsed.valueOf());
		}
		if (end) {
			const parsed = parseIso8601(end);
			if (!parsed) {
				return GetMyDepositWithdrawalOutputSchema.parse(
					fail(`end の日時形式が不正です: ${end}`, 'validation_error'),
				);
			}
			baseParams.end = String(parsed.valueOf());
		}

		// 入出金履歴を取得
		// asset が指定されている場合: そのまま API に渡す
		// asset が未指定の場合: 暗号資産（asset 省略）+ JPY（asset=jpy）の両方を取得
		const fetchDeposits = type === 'deposit' || type === 'all';
		const fetchWithdrawals = type === 'withdrawal' || type === 'all';

		let allDeposits: RawDeposit[] = [];
		let allWithdrawals: RawWithdrawal[] = [];
		const warnings: string[] = [];

		if (asset) {
			// 特定通貨の場合: 1回ずつ
			const params = { ...baseParams, asset };
			const [depResult, wdResult] = await Promise.all([
				fetchDeposits
					? tryGet<{ deposits: RawDeposit[] }>(client, '/v1/user/deposit_history', params)
					: Promise.resolve({ ok: true as const, data: { deposits: [] as RawDeposit[] } }),
				fetchWithdrawals
					? tryGet<{ withdrawals: RawWithdrawal[] }>(client, '/v1/user/withdrawal_history', params)
					: Promise.resolve({ ok: true as const, data: { withdrawals: [] as RawWithdrawal[] } }),
			]);
			if (depResult.ok) {
				allDeposits = depResult.data.deposits || [];
			} else {
				warnings.push(`入金/入庫履歴の取得に失敗: ${depResult.error}`);
			}
			if (wdResult.ok) {
				allWithdrawals = wdResult.data.withdrawals || [];
			} else {
				warnings.push(`出金/出庫履歴の取得に失敗: ${wdResult.error}`);
			}
		} else {
			// 全通貨: 暗号資産 + JPY を並列取得
			const cryptoParams = Object.keys(baseParams).length > 0 ? baseParams : undefined;
			const jpyParams = { ...baseParams, asset: 'jpy' };

			const [cryptoDepResult, jpyDepResult, cryptoWdResult, jpyWdResult] = await Promise.all([
				fetchDeposits
					? tryGet<{ deposits: RawDeposit[] }>(client, '/v1/user/deposit_history', cryptoParams)
					: Promise.resolve({ ok: true as const, data: { deposits: [] as RawDeposit[] } }),
				fetchDeposits
					? tryGet<{ deposits: RawDeposit[] }>(client, '/v1/user/deposit_history', jpyParams)
					: Promise.resolve({ ok: true as const, data: { deposits: [] as RawDeposit[] } }),
				fetchWithdrawals
					? tryGet<{ withdrawals: RawWithdrawal[] }>(client, '/v1/user/withdrawal_history', cryptoParams)
					: Promise.resolve({ ok: true as const, data: { withdrawals: [] as RawWithdrawal[] } }),
				fetchWithdrawals
					? tryGet<{ withdrawals: RawWithdrawal[] }>(client, '/v1/user/withdrawal_history', jpyParams)
					: Promise.resolve({ ok: true as const, data: { withdrawals: [] as RawWithdrawal[] } }),
			]);

			const apiResults = [
				{ result: cryptoDepResult, label: '暗号資産入庫履歴' },
				{ result: jpyDepResult, label: 'JPY入金履歴' },
				{ result: cryptoWdResult, label: '暗号資産出庫履歴' },
				{ result: jpyWdResult, label: 'JPY出金履歴' },
			];
			for (const { result, label } of apiResults) {
				if (!result.ok) {
					warnings.push(`${label}の取得に失敗: ${result.error}`);
				}
			}

			allDeposits = [
				...(cryptoDepResult.ok ? cryptoDepResult.data.deposits || [] : []),
				...(jpyDepResult.ok ? jpyDepResult.data.deposits || [] : []),
			];
			allWithdrawals = [
				...(cryptoWdResult.ok ? cryptoWdResult.data.withdrawals || [] : []),
				...(jpyWdResult.ok ? jpyWdResult.data.withdrawals || [] : []),
			];
		}

		// UUID で重複排除（暗号資産クエリに JPY が含まれるケースに備える）
		allDeposits = deduplicateByUuid(allDeposits);
		allWithdrawals = deduplicateByUuid(allWithdrawals);

		const timestamp = nowIso();

		// 入金データの整形
		const deposits = allDeposits.map((d) => ({
			uuid: d.uuid,
			asset: d.asset,
			amount: d.amount,
			network: d.network || undefined,
			txid: d.txid || undefined,
			status: d.status,
			found_at: toIsoMs(d.found_at) ?? undefined,
			confirmed_at: toIsoMs(d.confirmed_at) ?? undefined,
		}));

		// 出金データの整形
		const withdrawals = allWithdrawals.map((w) => ({
			uuid: w.uuid,
			asset: w.asset,
			amount: w.amount,
			fee: w.fee || undefined,
			network: w.network || undefined,
			txid: w.txid || undefined,
			label: w.label || undefined,
			address: w.address || undefined,
			bank_name: w.bank_name || undefined,
			status: w.status,
			requested_at: toIsoMs(w.requested_at) ?? undefined,
		}));

		// サマリー文字列の生成
		const lines: string[] = [];
		const assetLabel = asset ? asset.toUpperCase() : '全通貨';
		lines.push(`入出金履歴: ${assetLabel}`);
		lines.push('');

		// 入金サマリー
		if (deposits.length > 0) {
			lines.push(`入金/入庫: ${deposits.length}件`);
			const jpyDeposits = deposits.filter((d) => d.asset === 'jpy');
			const cryptoDeposits = deposits.filter((d) => d.asset !== 'jpy');
			if (jpyDeposits.length > 0) {
				const totalJpy = jpyDeposits.reduce((sum, d) => sum + Number(d.amount), 0);
				lines.push(`  JPY 入金: ${jpyDeposits.length}件 合計 ${formatPrice(Math.round(totalJpy))}`);
			}
			if (cryptoDeposits.length > 0) {
				lines.push(`  暗号資産入庫: ${cryptoDeposits.length}件`);
				for (const d of cryptoDeposits.slice(0, 5)) {
					lines.push(`    ${d.asset.toUpperCase()} ${d.amount} (${d.status})${d.found_at ? ` ${d.found_at}` : ''}`);
				}
				if (cryptoDeposits.length > 5) lines.push(`    ... 他 ${cryptoDeposits.length - 5}件`);
			}
		} else {
			lines.push('入金/入庫: 0件');
		}

		lines.push('');

		// 出金サマリー
		if (withdrawals.length > 0) {
			lines.push(`出金/出庫: ${withdrawals.length}件`);
			const jpyWithdrawals = withdrawals.filter((w) => w.asset === 'jpy');
			const cryptoWithdrawals = withdrawals.filter((w) => w.asset !== 'jpy');
			if (jpyWithdrawals.length > 0) {
				const totalJpy = jpyWithdrawals.reduce((sum, w) => sum + Number(w.amount), 0);
				lines.push(`  JPY 出金: ${jpyWithdrawals.length}件 合計 ${formatPrice(Math.round(totalJpy))}`);
			}
			if (cryptoWithdrawals.length > 0) {
				lines.push(`  暗号資産出庫: ${cryptoWithdrawals.length}件`);
				for (const w of cryptoWithdrawals.slice(0, 5)) {
					lines.push(`    ${w.asset.toUpperCase()} ${w.amount} (${w.status})${w.requested_at ? ` ${w.requested_at}` : ''}`);
				}
				if (cryptoWithdrawals.length > 5) lines.push(`    ... 他 ${cryptoWithdrawals.length - 5}件`);
			}
		} else {
			lines.push('出金/出庫: 0件');
		}

		// 警告（partial failure）
		if (warnings.length > 0) {
			lines.push('');
			for (const w of warnings) {
				lines.push(`警告: ${w}`);
			}
		}

		const summary = lines.join('\n');

		const data = {
			deposits,
			withdrawals,
			timestamp,
		};

		const meta = {
			fetchedAt: timestamp,
			depositCount: deposits.length,
			withdrawalCount: withdrawals.length,
			asset: asset || undefined,
		};

		return GetMyDepositWithdrawalOutputSchema.parse(ok(summary, data, meta));
	} catch (err) {
		if (err instanceof PrivateApiError) {
			return GetMyDepositWithdrawalOutputSchema.parse(
				fail(err.message, err.errorType),
			);
		}
		return GetMyDepositWithdrawalOutputSchema.parse(
			fail(
				err instanceof Error ? err.message : '入出金履歴取得中に予期しないエラーが発生しました',
				'upstream_error',
			),
		);
	}
}

/** UUID で重複排除 */
function deduplicateByUuid<T extends { uuid: string }>(items: T[]): T[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		if (seen.has(item.uuid)) return false;
		seen.add(item.uuid);
		return true;
	});
}

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'get_my_deposit_withdrawal',
	description: '入出金・入出庫の履歴を取得。JPY入出金と暗号資産入出庫の両方に対応。通貨・期間・タイプでフィルタ可能。Private API（要APIキー設定）。',
	inputSchema: GetMyDepositWithdrawalInputSchema,
	handler: async (args: any) => getMyDepositWithdrawal(args ?? {}),
};
