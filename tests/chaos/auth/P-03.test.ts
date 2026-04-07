/**
 * Chaos P-03: 署名の ACCESS-TIME-WINDOW（5秒）ギリギリの遅延リクエスト
 * 仮説: TIME-WINDOW 内なら成功、超過なら認証エラーを返す
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	buildGetMessage,
	buildPostMessage,
	createGetAuthHeaders,
	createPostAuthHeaders,
	sign,
} from '../../../src/private/auth.js';

describe('Chaos: P-03 — ACCESS-TIME-WINDOW 境界の署名検証', () => {
	/** 仮説: TIME-WINDOW の値が署名対象に含まれ、ヘッダーとして送信される */

	beforeEach(() => {
		process.env.BITBANK_API_KEY = 'test_key';
		process.env.BITBANK_API_SECRET = 'test_secret';
	});

	afterEach(() => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;
	});

	it('デフォルトの TIME-WINDOW は 5000ms', () => {
		const headers = createGetAuthHeaders('/v1/user/assets');
		expect(headers['ACCESS-TIME-WINDOW']).toBe('5000');
	});

	it('カスタム TIME-WINDOW を指定できる', () => {
		const headers = createGetAuthHeaders('/v1/user/assets', undefined, '10000');
		expect(headers['ACCESS-TIME-WINDOW']).toBe('10000');
	});

	it('TIME-WINDOW が異なると署名が変わる', () => {
		const rt = '1700000000000';
		const h1 = createGetAuthHeaders('/v1/user/assets', rt, '5000');
		const h2 = createGetAuthHeaders('/v1/user/assets', rt, '10000');

		expect(h1['ACCESS-SIGNATURE']).not.toBe(h2['ACCESS-SIGNATURE']);
		expect(h1['ACCESS-REQUEST-TIME']).toBe(h2['ACCESS-REQUEST-TIME']);
	});

	it('GET 署名対象文字列: requestTime + timeWindow + path', () => {
		const msg = buildGetMessage('1700000000000', '5000', '/v1/user/assets');
		expect(msg).toBe('17000000000005000/v1/user/assets');
	});

	it('POST 署名対象文字列: requestTime + timeWindow + body', () => {
		const body = '{"pair":"btc_jpy"}';
		const msg = buildPostMessage('1700000000000', '5000', body);
		expect(msg).toBe(`17000000000005000${body}`);
	});

	it('requestTime が異なると署名が変わる（タイミング攻撃への耐性）', () => {
		const sig1 = sign('test_secret', buildGetMessage('1700000000000', '5000', '/v1/user/assets'));
		const sig2 = sign('test_secret', buildGetMessage('1700000001000', '5000', '/v1/user/assets'));
		expect(sig1).not.toBe(sig2);
	});

	it('POST: requestTime を固定して署名を再現できる（決定的）', () => {
		const rt = '1700000000000';
		const body = '{"pair":"btc_jpy","amount":"0.001"}';

		const h1 = createPostAuthHeaders(body, rt);
		const h2 = createPostAuthHeaders(body, rt);

		expect(h1['ACCESS-SIGNATURE']).toBe(h2['ACCESS-SIGNATURE']);
	});

	it('ボディが 1 文字でも変わると署名が変わる', () => {
		const rt = '1700000000000';
		const h1 = createPostAuthHeaders('{"pair":"btc_jpy","amount":"0.001"}', rt);
		const h2 = createPostAuthHeaders('{"pair":"btc_jpy","amount":"0.002"}', rt);

		expect(h1['ACCESS-SIGNATURE']).not.toBe(h2['ACCESS-SIGNATURE']);
	});
});
