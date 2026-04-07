/**
 * Chaos V-01: ペア名に SQL インジェクション文字列を指定
 * 仮説: 正規化・許可リストチェックで拒否
 */

import { describe, expect, it } from 'vitest';
import { ensurePair, normalizePair } from '../../../lib/validate.js';

describe('Chaos: V-01 — ペア名に SQL インジェクション文字列を指定', () => {
	/** 仮説: 正規化の正規表現で全て拒否される */

	const SQL_PAYLOADS = [
		"'; DROP TABLE orders;--",
		"1' OR '1'='1",
		"btc_jpy'; DELETE FROM users;--",
		'btc_jpy UNION SELECT * FROM secrets',
		"' OR 1=1 --",
		"btc_jpy; EXEC xp_cmdshell('dir')",
		'btc_jpy\n; DROP TABLE--',
	];

	it.each(SQL_PAYLOADS)('SQL ペイロード %j → normalizePair が null', (payload) => {
		expect(normalizePair(payload)).toBeNull();
	});

	it.each(SQL_PAYLOADS)('SQL ペイロード %j → ensurePair が失敗', (payload) => {
		const result = ensurePair(payload);
		expect(result.ok).toBe(false);
	});

	it('正規表現が許可する文字は [a-z0-9] と _ のみ', () => {
		// 特殊文字を含む文字列は全て null
		const specials = [
			';',
			"'",
			'"',
			'<',
			'>',
			'&',
			'|',
			'\\',
			'/',
			'(',
			')',
			'{',
			'}',
			'=',
			'-',
			'+',
			'*',
			'!',
			'@',
			'#',
			'$',
			'%',
			'^',
			'`',
			'~',
		];
		for (const ch of specials) {
			expect(normalizePair(`btc${ch}jpy`)).toBeNull();
		}
	});

	it('正常なペア名は通過する', () => {
		expect(normalizePair('btc_jpy')).toBe('btc_jpy');
		expect(ensurePair('btc_jpy')).toEqual({ ok: true, pair: 'btc_jpy' });
	});
});
