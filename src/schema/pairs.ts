import { z } from 'zod';

/**
 * refresh_pairs_cache の入力スキーマ。
 *
 * 引数なしで全ペアの /spot/pairs キャッシュを強制再取得する。
 * `pair` を渡した場合も再取得は全ペア対象だが、結果テキストで対象ペアの
 * 手数料率を強調表示する（注記用）。
 */
export const RefreshPairsCacheInputSchema = z.object({
	pair: z.string().optional().describe('注記表示する対象ペア（例: btc_jpy）。指定しても再取得は全ペア対象。'),
});
