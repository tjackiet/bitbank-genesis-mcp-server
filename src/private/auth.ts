/**
 * bitbank Private API 認証モジュール。
 *
 * HMAC-SHA256 署名を生成し、認証ヘッダーを返す。
 * 認証ロジックはここに閉じ込め、将来の方式変更時にも
 * ツールやクライアントの変更を最小化する。
 *
 * @see https://github.com/bitbankinc/bitbank-api-docs/blob/master/rest-api.md
 */

import { createHmac } from 'node:crypto';
import { getPrivateApiConfig } from './config.js';

export interface AuthHeaders {
	'ACCESS-KEY': string;
	'ACCESS-NONCE': string;
	'ACCESS-SIGNATURE': string;
	'ACCESS-TIME-WINDOW'?: string;
}

/**
 * GET リクエスト用の署名対象文字列を組み立てる。
 * 形式: nonce + path（クエリパラメータ含む）
 */
export function buildGetMessage(nonce: string, path: string): string {
	return nonce + path;
}

/**
 * POST リクエスト用の署名対象文字列を組み立てる。
 * 形式: nonce + JSON body
 */
export function buildPostMessage(nonce: string, body: string): string {
	return nonce + body;
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
 * @param nonce - テスト時に固定値を注入可能。省略時はミリ秒タイムスタンプ
 */
export function createGetAuthHeaders(path: string, nonce?: string): AuthHeaders {
	const config = getPrivateApiConfig();
	if (!config) {
		throw new Error('BITBANK_API_KEY / BITBANK_API_SECRET が未設定です');
	}

	const n = nonce ?? Date.now().toString();
	const message = buildGetMessage(n, path);
	const signature = sign(config.apiSecret, message);

	return {
		'ACCESS-KEY': config.apiKey,
		'ACCESS-NONCE': n,
		'ACCESS-SIGNATURE': signature,
		'ACCESS-TIME-WINDOW': '5000',
	};
}

/**
 * POST リクエスト用の認証ヘッダーを生成する。
 *
 * @param body - JSON.stringify 済みのリクエストボディ
 * @param nonce - テスト時に固定値を注入可能。省略時はミリ秒タイムスタンプ
 */
export function createPostAuthHeaders(body: string, nonce?: string): AuthHeaders {
	const config = getPrivateApiConfig();
	if (!config) {
		throw new Error('BITBANK_API_KEY / BITBANK_API_SECRET が未設定です');
	}

	const n = nonce ?? Date.now().toString();
	const message = buildPostMessage(n, body);
	const signature = sign(config.apiSecret, message);

	return {
		'ACCESS-KEY': config.apiKey,
		'ACCESS-NONCE': n,
		'ACCESS-SIGNATURE': signature,
		'ACCESS-TIME-WINDOW': '5000',
	};
}
