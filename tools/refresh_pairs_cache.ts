import { nowIso } from '../lib/datetime.js';
import { getErrorMessage } from '../lib/error.js';
import { fetchPairsSpec, type PairSpec } from '../lib/pairs.js';
import { fail, ok, toStructured } from '../lib/result.js';
import { RefreshPairsCacheInputSchema } from '../src/schemas.js';
import type { McpResponse, ToolDefinition } from '../src/tool-definition.js';

/** content テキストに常時載せる主要ペア（存在するもののみ表示）。 */
const HIGHLIGHT_PAIRS = ['btc_jpy', 'eth_jpy', 'xrp_jpy'];

function formatRate(v: string | null): string {
	return v == null ? 'N/A' : v;
}

function rateLine(spec: PairSpec): string {
	return `  - ${spec.name}: taker=${formatRate(spec.taker_fee_rate_quote)} / maker=${formatRate(spec.maker_fee_rate_quote)}`;
}

/**
 * /spot/pairs 手数料レートの TTL キャッシュを強制再取得する public ツール。
 *
 * fetchPairsSpec({ forceRefresh: true }) を呼び、TTL 内でも必ず再 fetch して
 * キャッシュを新値で上書きする。取得失敗時は fail() を返す（サーバーは継続）。
 */
export default async function refreshPairsCache(
	args: { pair?: string } = {},
): Promise<McpResponse | ReturnType<typeof fail>> {
	try {
		const map = await fetchPairsSpec({ forceRefresh: true });
		const fetchedAt = nowIso();

		const requested = args.pair?.trim().toLowerCase();
		// 注記対象ペア + 主要ペアを表示（重複排除・存在するもののみ）。
		const targetNames = [...new Set([...(requested ? [requested] : []), ...HIGHLIGHT_PAIRS])];
		const shown: PairSpec[] = [];
		for (const name of targetNames) {
			const spec = map.get(name);
			if (spec) shown.push(spec);
		}

		const lines = [`/spot/pairs キャッシュを強制再取得しました（${map.size} ペア）`, `取得時刻: ${fetchedAt}`];
		if (requested && !map.has(requested)) {
			lines.push(`⚠️ 指定ペア '${args.pair}' は /spot/pairs に存在しません`);
		}
		if (shown.length > 0) {
			lines.push('主要ペアの手数料率（quote 建て）:');
			for (const spec of shown) lines.push(rateLine(spec));
		}

		const summary = `/spot/pairs を再取得しました（${map.size} ペア, ${fetchedAt}）`;
		const data = {
			pairCount: map.size,
			fetchedAt,
			pairs: shown.map((s) => ({
				pair: s.name,
				taker_fee_rate_quote: s.taker_fee_rate_quote,
				maker_fee_rate_quote: s.maker_fee_rate_quote,
			})),
		};

		const result = ok(summary, data, {});
		return {
			content: [{ type: 'text', text: lines.join('\n') }],
			structuredContent: toStructured(result),
		};
	} catch (err) {
		return fail(`/spot/pairs の再取得に失敗しました: ${getErrorMessage(err)}`, 'upstream');
	}
}

// ── MCP ツール定義（tool-registry から自動収集） ──
export const toolDef: ToolDefinition = {
	name: 'refresh_pairs_cache',
	description:
		'[Maintenance / Fees] /spot/pairs 手数料レートの TTL キャッシュ（既定 1h）を強制再取得する。キャンペーン境界などで最新の maker/taker 手数料率を即時反映したいときに使う。引数なしで全ペアを再取得（pair 指定で対象ペアの率を強調表示）。',
	inputSchema: RefreshPairsCacheInputSchema,
	handler: async (args: { pair?: string }) => refreshPairsCache(args ?? {}),
};
