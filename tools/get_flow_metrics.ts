import { dayjs, toDisplayTime, toIsoTime, toIsoWithTz } from '../lib/datetime.js';
import { formatSummary } from '../lib/formatter.js';
import { fail, failFromError, failFromValidation, ok } from '../lib/result.js';
import { createMeta, ensurePair, validateLimit } from '../lib/validate.js';
import { GetFlowMetricsInputSchema, GetFlowMetricsOutputSchema } from '../src/schemas.js';
import type { ToolDefinition } from '../src/tool-definition.js';
import getTransactions from './get_transactions.js';

type Tx = { price: number; amount: number; side: 'buy' | 'sell'; timestampMs: number; isoTime: string };

export interface FlowMetricsBucket {
	timestampMs: number;
	isoTime: string;
	isoTimeJST?: string;
	displayTime?: string;
	buyVolume: number;
	sellVolume: number;
	totalVolume: number;
	cvd: number;
	zscore: number | null;
	spike: 'notice' | 'warning' | 'strong' | null;
}

export interface BuildFlowMetricsTextInput {
	baseSummary: string;
	dataWarning?: string;
	totalTrades: number;
	buyVolume: number;
	sellVolume: number;
	netVolume: number;
	aggressorRatio: number;
	cvd: number;
	buckets: FlowMetricsBucket[];
	bucketMs: number;
}

/** テキスト組み立て（フロー分析結果）— テスト可能な純粋関数 */
export function buildFlowMetricsText(input: BuildFlowMetricsTextInput): string {
	const {
		baseSummary,
		dataWarning,
		totalTrades,
		buyVolume,
		sellVolume,
		netVolume,
		aggressorRatio,
		cvd,
		buckets,
		bucketMs,
	} = input;
	const bucketLines = buckets.map((b, i) => {
		const t = b.displayTime || b.isoTimeJST || b.isoTime || '?';
		const sp = b.spike ? ` spike:${b.spike}` : '';
		return `[${i}] ${t} buy:${b.buyVolume} sell:${b.sellVolume} cvd:${b.cvd} z:${b.zscore ?? 'n/a'}${sp}`;
	});
	const warningLine = dataWarning ? `\n${dataWarning}` : '';
	return (
		baseSummary +
		warningLine +
		`\naggregates: totalTrades=${totalTrades} buyVol=${Number(buyVolume.toFixed(4))} sellVol=${Number(sellVolume.toFixed(4))} netVol=${Number(netVolume.toFixed(4))} aggRatio=${aggressorRatio} finalCvd=${Number(cvd.toFixed(4))}` +
		`\n\n📋 全${buckets.length}件のバケット (${bucketMs}ms間隔):\n` +
		bucketLines.join('\n') +
		`\n\n---\n📌 含まれるもの: 時系列バケット（買い/売り出来高・CVD・Zスコア・スパイク）、集計値` +
		`\n📌 含まれないもの: 個別約定の詳細、OHLCV価格データ、板情報、テクニカル指標` +
		`\n📌 補完ツール: get_transactions（個別約定）, get_candles（OHLCV）, get_orderbook（板情報）, analyze_indicators（指標）`
	);
}

/** 複数の getTransactions 結果をマージし重複を除去する（失敗数も返す） */
function mergeTxResults(results: unknown[]): { txs: Tx[]; totalCount: number; failedCount: number } {
	const seen = new Set<string>();
	const merged: Tx[] = [];
	let failedCount = 0;
	for (const res of results) {
		const r = res as { ok?: boolean; data?: { normalized?: Tx[] } } | null;
		if (r?.ok && Array.isArray(r.data?.normalized)) {
			for (const tx of r.data.normalized as Tx[]) {
				const key = `${tx.timestampMs}:${tx.price}:${tx.amount}:${tx.side}`;
				if (!seen.has(key)) {
					seen.add(key);
					merged.push(tx);
				}
			}
		} else {
			failedCount++;
		}
	}
	return { txs: merged, totalCount: results.length, failedCount };
}

/** 部分失敗時の警告メッセージを生成する */
function partialFailureWarning(totalCount: number, failedCount: number): string | null {
	if (failedCount === 0) return null;
	return `⚠️ ${totalCount}件中${failedCount}件のAPI取得に失敗しました。データが不完全な可能性があります。`;
}

export default async function getFlowMetrics(
	pair: string = 'btc_jpy',
	limit: number = 100,
	date?: string,
	bucketMs: number = 60_000,
	tz: string = 'Asia/Tokyo',
	hours?: number,
) {
	const chk = ensurePair(pair);
	if (!chk.ok) return failFromValidation(chk, GetFlowMetricsOutputSchema) as any;

	try {
		let txs: Tx[];
		let fetchWarning: string | undefined;

		if (hours != null && hours > 0) {
			// === 時間範囲ベースの取得 ===
			const nowMs = Date.now();
			const sinceMs = nowMs - hours * 3600_000;

			// bitbank API は JST 基準の日付を使用するため、JST で日付計算
			const sinceDayjs = dayjs(sinceMs).tz('Asia/Tokyo');
			const nowDayjs = dayjs(nowMs).tz('Asia/Tokyo');

			// 必要な日付を YYYYMMDD (JST) 形式で列挙（古い順）
			const dates: string[] = [];
			let d = sinceDayjs.startOf('day');
			while (d.isBefore(nowDayjs) || d.isSame(nowDayjs, 'day')) {
				dates.push(d.format('YYYYMMDD'));
				d = d.add(1, 'day');
			}

			// 全日付を日付指定エンドポイントで取得（当日含む）
			// 当日分は日付指定だと直近数分が欠ける場合があるため latest も併用
			const fetches: Promise<unknown>[] = dates.map((ds) => getTransactions(chk.pair, 1000, ds));
			fetches.push(getTransactions(chk.pair, 1000)); // latest で最新約定を補完

			const results = await Promise.all(fetches);
			const { txs: allTxs, totalCount, failedCount } = mergeTxResults(results);

			// 過半数失敗なら信頼性が低いため fail
			if (failedCount > 0 && failedCount >= totalCount / 2) {
				return GetFlowMetricsOutputSchema.parse(
					fail(`API取得の過半数が失敗しました（${totalCount}件中${failedCount}件失敗）`, 'upstream'),
				) as any;
			}
			fetchWarning = partialFailureWarning(totalCount, failedCount) ?? undefined;

			txs = allTxs
				.filter((t) => t.timestampMs >= sinceMs && t.timestampMs <= nowMs)
				.sort((a, b) => a.timestampMs - b.timestampMs);
		} else {
			// === 件数ベース取得 ===
			const lim = validateLimit(limit, 1, 2000);
			if (!lim.ok) return failFromValidation(lim, GetFlowMetricsOutputSchema) as any;

			if (date) {
				// 明示的な日付指定がある場合はそのまま取得
				const txRes = await getTransactions(chk.pair, Math.min(lim.value, 1000), date);
				if (!txRes?.ok)
					return GetFlowMetricsOutputSchema.parse(
						fail(txRes?.summary || 'failed', (txRes?.meta as any)?.errorType || 'internal'),
					) as any;
				txs = txRes.data.normalized as Tx[];
			} else {
				// 日付指定なし: latest で取得し、不足なら日付ベースで補完
				const latestRes = await getTransactions(chk.pair, Math.min(lim.value, 1000));
				const latestOk = !!(latestRes as any)?.ok;
				const latestTxs = (latestOk ? (latestRes as any).data.normalized : []) as Tx[];

				if (latestTxs.length >= lim.value) {
					txs = latestTxs;
				} else {
					// latest の返却数が不足 → 前日・前々日の日付ベース取得で補完
					// bitbank の latest エンドポイントは約60件のみ返却するため
					const todayJst = dayjs().tz('Asia/Tokyo');
					const supplementFetches: Promise<unknown>[] = [
						getTransactions(chk.pair, 1000, todayJst.subtract(1, 'day').format('YYYYMMDD')),
					];
					if (lim.value > 500) {
						supplementFetches.push(getTransactions(chk.pair, 1000, todayJst.subtract(2, 'day').format('YYYYMMDD')));
					}
					const supplementResults = await Promise.all(supplementFetches);
					const allResults = [latestRes, ...supplementResults];
					const { txs: merged, totalCount, failedCount } = mergeTxResults(allResults);
					// 全て失敗した場合は network エラーとして返す
					if (merged.length === 0 && failedCount > 0) {
						return GetFlowMetricsOutputSchema.parse(fail('upstream fetch all failed', 'network')) as any;
					}
					// 過半数失敗なら fail
					if (failedCount > 0 && failedCount >= totalCount / 2) {
						return GetFlowMetricsOutputSchema.parse(
							fail(`API取得の過半数が失敗しました（${totalCount}件中${failedCount}件失敗）`, 'upstream'),
						) as any;
					}
					fetchWarning = partialFailureWarning(totalCount, failedCount) ?? undefined;
					txs = merged.sort((a, b) => a.timestampMs - b.timestampMs).slice(-lim.value);
				}
			}
		}
		if (!Array.isArray(txs) || txs.length === 0) {
			return GetFlowMetricsOutputSchema.parse(
				ok(
					'no transactions',
					{
						source: 'transactions',
						params: { bucketMs },
						aggregates: {
							totalTrades: 0,
							buyTrades: 0,
							sellTrades: 0,
							buyVolume: 0,
							sellVolume: 0,
							netVolume: 0,
							aggressorRatio: 0,
							finalCvd: 0,
						},
						series: { buckets: [] },
					},
					createMeta(chk.pair, { count: 0, bucketMs }),
				),
			) as any;
		}

		// バケット分割
		const t0 = txs[0].timestampMs;
		const buckets: Array<{ ts: number; buys: number; sells: number; vBuy: number; vSell: number }> = [];
		const idx = (ms: number) => Math.floor((ms - t0) / bucketMs);
		for (const t of txs) {
			const k = idx(t.timestampMs);
			while (buckets.length <= k)
				buckets.push({ ts: t0 + buckets.length * bucketMs, buys: 0, sells: 0, vBuy: 0, vSell: 0 });
			if (t.side === 'buy') {
				buckets[k].buys++;
				buckets[k].vBuy += t.amount;
			} else {
				buckets[k].sells++;
				buckets[k].vSell += t.amount;
			}
		}

		// CVD とスパイク
		const outBuckets: Array<{
			timestampMs: number;
			isoTime: string;
			isoTimeJST?: string;
			displayTime?: string;
			buyVolume: number;
			sellVolume: number;
			totalVolume: number;
			cvd: number;
			zscore: number | null;
			spike: 'notice' | 'warning' | 'strong' | null;
		}> = [];
		let cvd = 0;
		const vols = buckets.map((b) => b.vBuy + b.vSell);
		const mean = vols.reduce((a, b) => a + b, 0) / Math.max(1, vols.length);
		const variance = vols.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, vols.length);
		const stdev = Math.sqrt(variance);
		const spikeLevel = (z: number): 'notice' | 'warning' | 'strong' | null => {
			if (!Number.isFinite(z)) return null;
			if (z >= 3) return 'strong';
			if (z >= 2) return 'warning';
			if (z >= 1.5) return 'notice';
			return null;
		};

		for (const b of buckets) {
			const vol = b.vBuy + b.vSell;
			cvd += b.vBuy - b.vSell;
			const z = stdev > 0 ? (vol - mean) / stdev : 0;
			const ts = b.ts + bucketMs - 1;
			outBuckets.push({
				timestampMs: ts,
				isoTime: toIsoTime(ts) ?? '',
				isoTimeJST: toIsoWithTz(ts, tz) ?? undefined,
				displayTime: toDisplayTime(ts, tz) ?? undefined,
				buyVolume: Number(b.vBuy.toFixed(8)),
				sellVolume: Number(b.vSell.toFixed(8)),
				totalVolume: Number(vol.toFixed(8)),
				cvd: Number(cvd.toFixed(8)),
				zscore: Number.isFinite(z) ? Number(z.toFixed(2)) : null,
				spike: spikeLevel(z),
			});
		}

		const totalTrades = txs.length;
		const buyTrades = txs.filter((t) => t.side === 'buy').length;
		const sellTrades = totalTrades - buyTrades;
		const buyVolume = txs.filter((t) => t.side === 'buy').reduce((s, t) => s + t.amount, 0);
		const sellVolume = txs.filter((t) => t.side === 'sell').reduce((s, t) => s + t.amount, 0);
		const netVolume = buyVolume - sellVolume;
		const aggressorRatio = totalTrades > 0 ? Number((buyTrades / totalTrades).toFixed(3)) : 0;

		// 実際の取得範囲を計算
		const actualStartMs = txs[0]?.timestampMs;
		const actualEndMs = txs[txs.length - 1]?.timestampMs;
		const actualDurationMin = actualStartMs && actualEndMs ? Math.round((actualEndMs - actualStartMs) / 60_000) : 0;

		// データ不足警告
		const warnings: string[] = [];
		if (fetchWarning) warnings.push(fetchWarning);
		if (hours != null && hours > 0 && actualDurationMin > 0) {
			const requestedMin = hours * 60;
			const coveragePct = Math.round((actualDurationMin / requestedMin) * 100);
			if (coveragePct < 80) {
				warnings.push(
					`⚠️ ${hours}時間分をリクエストしましたが、取得できたデータは約${actualDurationMin}分間（カバー率${coveragePct}%）です。bitbank API の返却上限による制約の可能性があります。`,
				);
			}
		}
		const dataWarning = warnings.length > 0 ? warnings.join('\n') : undefined;

		// スパイク情報を集計（spike が null でないものをフィルタ）
		const spikes = outBuckets.filter((b) => b.spike !== null);
		let spikeInfo = '';
		if (spikes.length > 0) {
			const spikeDetails = spikes
				.slice(0, 3)
				.map((s) => {
					const time = s.displayTime || s.isoTime || '';
					const level = s.spike === 'strong' ? '🚨強' : s.spike === 'warning' ? '⚠️中' : '📈弱';
					const direction = s.cvd > 0 ? '買い' : '売り';
					return `${time}(${level}${direction})`;
				})
				.join(', ');
			spikeInfo = ` | スパイク${spikes.length}件: ${spikeDetails}`;
		} else {
			spikeInfo = ' | スパイクなし';
		}

		const rangeLabel =
			actualStartMs && actualEndMs
				? ` (${toDisplayTime(actualStartMs, tz) ?? '?'}〜${toDisplayTime(actualEndMs, tz) ?? '?'}, ${actualDurationMin}分間)`
				: '';
		const baseSummary = formatSummary({
			pair: chk.pair,
			latest: txs.at(-1)?.price,
			extra: `trades=${totalTrades} buy%=${(aggressorRatio * 100).toFixed(1)} CVD=${cvd.toFixed(2)}${spikeInfo}${rangeLabel}`,
		});
		// テキスト summary に全バケットデータを含める（LLM が structuredContent.data を読めない対策）
		const summary = buildFlowMetricsText({
			baseSummary,
			dataWarning,
			totalTrades,
			buyVolume,
			sellVolume,
			netVolume,
			aggressorRatio,
			cvd,
			buckets: outBuckets,
			bucketMs,
		});

		const data = {
			source: 'transactions' as const,
			params: { bucketMs },
			aggregates: {
				totalTrades,
				buyTrades,
				sellTrades,
				buyVolume: Number(buyVolume.toFixed(8)),
				sellVolume: Number(sellVolume.toFixed(8)),
				netVolume: Number(netVolume.toFixed(8)),
				aggressorRatio,
				finalCvd: Number(cvd.toFixed(8)),
			},
			series: { buckets: outBuckets },
		};

		const offsetMin = dayjs().utcOffset();
		const offset = `${offsetMin >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0')}:${String(Math.abs(offsetMin) % 60).padStart(2, '0')}`;
		const metaExtra: Record<string, unknown> = {
			count: totalTrades,
			bucketMs,
			timezone: tz,
			timezoneOffset: offset,
			serverTime: toIsoWithTz(Date.now(), tz) ?? undefined,
		};
		if (hours != null) {
			metaExtra.hours = hours;
			metaExtra.mode = 'time_range';
		}
		if (actualStartMs && actualEndMs) {
			metaExtra.actualRange = {
				start: toIsoWithTz(actualStartMs, tz) ?? toIsoTime(actualStartMs),
				end: toIsoWithTz(actualEndMs, tz) ?? toIsoTime(actualEndMs),
				durationMinutes: actualDurationMin,
			};
		}
		if (dataWarning) {
			metaExtra.warning = dataWarning;
		}
		const meta = createMeta(chk.pair, metaExtra);
		return GetFlowMetricsOutputSchema.parse(ok(summary, data as any, meta as any)) as any;
	} catch (e: unknown) {
		return failFromError(e, { schema: GetFlowMetricsOutputSchema }) as any;
	}
}

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'get_flow_metrics',
	description: `[Flow / CVD / Buy-Sell Pressure] 資金フロー分析（flow / CVD / aggressor ratio / buy-sell pressure）。約定データからCVD・アグレッサー比・スパイクを検出。hours（推奨）で時間範囲指定、または limit で件数指定。`,
	inputSchema: GetFlowMetricsInputSchema,
	handler: async ({ pair, limit, date, bucketMs, view, bucketsN, tz, hours }: any) => {
		const res: any = await getFlowMetrics(
			pair,
			Number(limit),
			date,
			Number(bucketMs),
			tz,
			hours != null ? Number(hours) : undefined,
		);
		if (!res?.ok) return res;
		if (view === 'summary') return res;
		const agg = res?.data?.aggregates ?? {};
		const buckets: any[] = res?.data?.series?.buckets ?? [];
		const n = Number(bucketsN ?? 10);
		const last = buckets.slice(-n);
		const fmt = (b: any) =>
			`${b.displayTime || b.isoTime}  buy=${b.buyVolume} sell=${b.sellVolume} total=${b.totalVolume} cvd=${b.cvd}${b.spike ? ` spike=${b.spike}` : ''}`;
		const actualRange = res?.meta?.actualRange;
		const rangeStr = actualRange
			? ` 実取得範囲: ${actualRange.start}〜${actualRange.end}（${actualRange.durationMinutes}分間）`
			: '';
		const warnStr = res?.meta?.warning ? `\n${res.meta.warning}` : '';
		let text = `${String(pair).toUpperCase()} Flow Metrics (bucketMs=${res?.data?.params?.bucketMs ?? bucketMs})${rangeStr}\n`;
		text += `Totals: trades=${agg.totalTrades} buyVol=${agg.buyVolume} sellVol=${agg.sellVolume} net=${agg.netVolume} buy%=${(agg.aggressorRatio * 100 || 0).toFixed(1)} CVD=${agg.finalCvd}${warnStr}`;
		if (view === 'buckets') {
			text += `\n\nRecent ${last.length} buckets:\n` + last.map(fmt).join('\n');
			return { content: [{ type: 'text', text }], structuredContent: res as Record<string, unknown> };
		}
		text += `\n\nAll buckets:\n` + buckets.map(fmt).join('\n');
		return { content: [{ type: 'text', text }], structuredContent: res as Record<string, unknown> };
	},
};
