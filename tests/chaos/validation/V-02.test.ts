/**
 * Chaos V-02: ペア名に Unicode 特殊文字を指定
 * 仮説: 拒否される
 */

import { describe, expect, it } from 'vitest';
import { ensurePair, normalizePair } from '../../../lib/validate.js';

describe('Chaos: V-02 — ペア名に Unicode 特殊文字を指定', () => {
	/** 仮説: 正規化の正規表現 /^[a-z0-9]+_[a-z0-9]+$/ で全て拒否される */

	const UNICODE_PAYLOADS = [
		'btc_🔥',
		'ＢＴＣ＿ＪＰＹ', // 全角英数
		'btc\u200b_jpy', // ゼロ幅スペース
		'btc\u00a0_jpy', // ノーブレークスペース
		'btc_jpÿ', // Latin supplement
		'вtc_jpy', // キリル文字の в
		'ビットコイン_円',
		'btc_jpy\0', // null byte
		'btc\t_jpy', // tab
		'btc\r\n_jpy', // CRLF
	];

	it.each(UNICODE_PAYLOADS)('Unicode ペイロード %j → normalizePair が null', (payload) => {
		expect(normalizePair(payload)).toBeNull();
	});

	it.each(UNICODE_PAYLOADS)('Unicode ペイロード %j → ensurePair が失敗', (payload) => {
		const result = ensurePair(payload);
		expect(result.ok).toBe(false);
	});

	it('大文字は小文字に正規化される', () => {
		expect(normalizePair('BTC_JPY')).toBe('btc_jpy');
		expect(normalizePair('Btc_Jpy')).toBe('btc_jpy');
	});

	it('前後の空白は trim される', () => {
		expect(normalizePair('  btc_jpy  ')).toBe('btc_jpy');
	});

	it('中間の空白は拒否される', () => {
		expect(normalizePair('btc _jpy')).toBeNull();
		expect(normalizePair('btc_ jpy')).toBeNull();
	});
});
