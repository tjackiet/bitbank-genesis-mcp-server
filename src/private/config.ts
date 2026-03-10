/**
 * Private API の有効化チェック。
 * BITBANK_API_KEY と BITBANK_API_SECRET の両方が設定されている場合のみ有効。
 */

export interface PrivateApiConfig {
	apiKey: string;
	apiSecret: string;
}

/** Private API が有効かどうかを返す */
export function isPrivateApiEnabled(): boolean {
	return !!(process.env.BITBANK_API_KEY && process.env.BITBANK_API_SECRET);
}

/**
 * 環境変数から Private API 設定を読み込む。
 * 未設定の場合は null を返す。
 */
export function getPrivateApiConfig(): PrivateApiConfig | null {
	const apiKey = process.env.BITBANK_API_KEY;
	const apiSecret = process.env.BITBANK_API_SECRET;
	if (!apiKey || !apiSecret) return null;
	return { apiKey, apiSecret };
}
