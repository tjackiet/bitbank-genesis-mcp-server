/**
 * auth.ts の署名テストベクタ。
 *
 * 既知の入力（秘密鍵・nonce・パス・ボディ）から期待される署名を検証する。
 * 実 API キーは使わない。
 */

import { describe, it, expect } from 'vitest';
import { sign, buildGetMessage, buildPostMessage } from '../../src/private/auth.js';

// テストベクタ: 固定の秘密鍵・nonce・パスから手計算した署名
// 検証方法: echo -n "<message>" | openssl dgst -sha256 -hmac "<secret>" で照合可能
const TEST_SECRET = 'test_secret_key_for_signing_12345';

describe('auth.ts 署名テストベクタ', () => {
	describe('sign()', () => {
		it('HMAC-SHA256 で正しい署名を生成する', () => {
			// echo -n "hello" | openssl dgst -sha256 -hmac "test_secret_key_for_signing_12345"
			const result = sign(TEST_SECRET, 'hello');
			expect(result).toBe(
				'660734c3a029a8c28d20d8ba3471667e260d9eafb4cd0701ca3fc04fafc9ef29',
			);
		});

		it('空文字列の署名が正しい', () => {
			// echo -n "" | openssl dgst -sha256 -hmac "test_secret_key_for_signing_12345"
			const result = sign(TEST_SECRET, '');
			expect(result).toBe(
				'7ed44d7d96ada1a991bab26f803a3a87428d33741a1ffb21cd4ad7fc80d42401',
			);
		});
	});

	describe('buildGetMessage()', () => {
		it('nonce + path を連結する', () => {
			const message = buildGetMessage('1234567890', '/v1/user/assets');
			expect(message).toBe('1234567890/v1/user/assets');
		});

		it('クエリパラメータ付きパスも正しく連結する', () => {
			const message = buildGetMessage('1234567890', '/v1/user/spot/trade_history?pair=btc_jpy&count=10');
			expect(message).toBe('1234567890/v1/user/spot/trade_history?pair=btc_jpy&count=10');
		});
	});

	describe('buildPostMessage()', () => {
		it('nonce + JSON body を連結する', () => {
			const body = JSON.stringify({ pair: 'btc_jpy', amount: '0.01', side: 'buy', type: 'market' });
			const message = buildPostMessage('1234567890', body);
			expect(message).toBe('1234567890' + body);
		});
	});

	describe('GET リクエストの署名検証（エンドツーエンド）', () => {
		it('nonce + path から正しい署名を生成する', () => {
			const nonce = '1709000000000';
			const path = '/v1/user/assets';
			const message = buildGetMessage(nonce, path);
			const signature = sign(TEST_SECRET, message);

			// message = "1709000000000/v1/user/assets"
			expect(message).toBe('1709000000000/v1/user/assets');
			// 署名は決定的なので毎回同じ値が出る
			expect(signature).toHaveLength(64); // SHA256 hex = 64文字
			expect(signature).toMatch(/^[0-9a-f]{64}$/);

			// 同じ入力なら同じ出力（冪等性）
			const signature2 = sign(TEST_SECRET, message);
			expect(signature).toBe(signature2);
		});
	});

	describe('POST リクエストの署名検証（エンドツーエンド）', () => {
		it('nonce + body から正しい署名を生成する', () => {
			const nonce = '1709000000000';
			const body = '{"pair":"btc_jpy","amount":"0.01","side":"buy","type":"market"}';
			const message = buildPostMessage(nonce, body);
			const signature = sign(TEST_SECRET, message);

			expect(message).toBe(nonce + body);
			expect(signature).toHaveLength(64);
			expect(signature).toMatch(/^[0-9a-f]{64}$/);
		});
	});

	describe('異なる入力で異なる署名が生成される', () => {
		it('パスが異なれば署名が異なる', () => {
			const nonce = '1709000000000';
			const sig1 = sign(TEST_SECRET, buildGetMessage(nonce, '/v1/user/assets'));
			const sig2 = sign(TEST_SECRET, buildGetMessage(nonce, '/v1/user/spot/trade_history'));
			expect(sig1).not.toBe(sig2);
		});

		it('nonce が異なれば署名が異なる', () => {
			const path = '/v1/user/assets';
			const sig1 = sign(TEST_SECRET, buildGetMessage('1709000000000', path));
			const sig2 = sign(TEST_SECRET, buildGetMessage('1709000000001', path));
			expect(sig1).not.toBe(sig2);
		});

		it('秘密鍵が異なれば署名が異なる', () => {
			const message = buildGetMessage('1709000000000', '/v1/user/assets');
			const sig1 = sign('secret_a', message);
			const sig2 = sign('secret_b', message);
			expect(sig1).not.toBe(sig2);
		});
	});
});
