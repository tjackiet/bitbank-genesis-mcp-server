/**
 * bitbank Private API 認証モジュール。
 *
 * ACCESS-TIME-WINDOW 方式を採用。
 * 署名対象文字列: requestTime + timeWindow + path/body
 * ヘッダー: ACCESS-KEY, ACCESS-REQUEST-TIME, ACCESS-TIME-WINDOW, ACCESS-SIGNATURE
 *
 * @see https://github.com/bitbankinc/bitbank-api-docs/blob/master/rest-api.md
 */

import { createHmac } from 'node:crypto';
import { getPrivateApiConfig } from './config.js';

/** デフォルトの TIME-WINDOW（ミリ秒）。最大 60000 まで設定可能 */
const DEFAULT_TIME_WINDOW = '5000';

export interface AuthHeaders {
	'ACCESS-KEY': string;
	'ACCESS-REQUEST-TIME': string;
	'ACCESS-TIME-WINDOW': string;
	'ACCESS-SIGNATURE': string;
}

/**
 * GET リクエスト用の署名対象文字列を組み立てる。
 * 形式: requestTime + timeWindow + path（クエリパラメータ含む）
 */
export function buildGetMessage(requestTime: string, timeWindow: string, path: string): string {
	return requestTime + timeWindow + path;
}

/**
 * POST リクエスト用の署名対象文字列を組み立てる。
 * 形式: requestTime + timeWindow + JSON body
 */
export function buildPostMessage(requestTime: string, timeWindow: string, body: string): string {
	return requestTime + timeWindow + body;
}

/**
 * HMAC-SHA256 署名を生成する。
 * テスト時に秘密鍵とメッセージを直接渡せるよう、純粋関数として分離。
 */
export function sign(secret: string, message: string): string {
	return createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * GET リクエスト用の認証ヘッダーを生成する。
 *
 * @param path - リクエストパス（例: '/v1/user/assets'）、クエリパラメータ含む
 * @param requestTime - テスト時に固定値を注入可能。省略時はミリ秒タイムスタンプ
 * @param timeWindow - TIME-WINDOW 値（ミリ秒）。省略時は 5000
 */
export function createGetAuthHeaders(
	path: string,
	requestTime?: string,
	timeWindow: string = DEFAULT_TIME_WINDOW,
): AuthHeaders {
	const config = getPrivateApiConfig();
	if (!config) {
		throw new Error('BITBANK_API_KEY / BITBANK_API_SECRET が未設定です');
	}

	const rt = requestTime ?? Date.now().toString();
	const message = buildGetMessage(rt, timeWindow, path);
	const signature = sign(config.apiSecret, message);

	return {
		'ACCESS-KEY': config.apiKey,
		'ACCESS-REQUEST-TIME': rt,
		'ACCESS-TIME-WINDOW': timeWindow,
		'ACCESS-SIGNATURE': signature,
	};
}

/**
 * POST リクエスト用の認証ヘッダーを生成する。
 *
 * @param body - JSON.stringify 済みのリクエストボディ
 * @param requestTime - テスト時に固定値を注入可能。省略時はミリ秒タイムスタンプ
 * @param timeWindow - TIME-WINDOW 値（ミリ秒）。省略時は 5000
 */
export function createPostAuthHeaders(
	body: string,
	requestTime?: string,
	timeWindow: string = DEFAULT_TIME_WINDOW,
): AuthHeaders {
	const config = getPrivateApiConfig();
	if (!config) {
		throw new Error('BITBANK_API_KEY / BITBANK_API_SECRET が未設定です');
	}

	const rt = requestTime ?? Date.now().toString();
	const message = buildPostMessage(rt, timeWindow, body);
	const signature = sign(config.apiSecret, message);

	return {
		'ACCESS-KEY': config.apiKey,
		'ACCESS-REQUEST-TIME': rt,
		'ACCESS-TIME-WINDOW': timeWindow,
		'ACCESS-SIGNATURE': signature,
	};
}
