/**
 * Chaos P-01: BITBANK_API_KEY のみ設定（SECRET なし）
 * 仮説: Private ツールが登録されず、Public ツールのみで正常動作
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGetAuthHeaders, createPostAuthHeaders } from '../../../src/private/auth.js';
import { getPrivateApiConfig, isPrivateApiEnabled } from '../../../src/private/config.js';

describe('Chaos: P-01 — BITBANK_API_KEY のみ設定（SECRET なし）', () => {
	/** 仮説: Private API が無効化され、認証ヘッダー生成が失敗する */

	beforeEach(() => {
		process.env.BITBANK_API_KEY = 'valid_api_key_123';
		delete process.env.BITBANK_API_SECRET;
	});

	afterEach(() => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;
	});

	it('isPrivateApiEnabled() が false を返す', () => {
		expect(isPrivateApiEnabled()).toBe(false);
	});

	it('getPrivateApiConfig() が null を返す', () => {
		expect(getPrivateApiConfig()).toBeNull();
	});

	it('createGetAuthHeaders() が throw する', () => {
		expect(() => createGetAuthHeaders('/v1/user/assets')).toThrow('未設定');
	});

	it('createPostAuthHeaders() が throw する', () => {
		expect(() => createPostAuthHeaders('{"pair":"btc_jpy"}')).toThrow('未設定');
	});

	it('SECRET のみ設定でも同様に無効', () => {
		delete process.env.BITBANK_API_KEY;
		process.env.BITBANK_API_SECRET = 'valid_api_secret_456';

		expect(isPrivateApiEnabled()).toBe(false);
		expect(getPrivateApiConfig()).toBeNull();
	});

	it('片方設定 → 片方削除 → 再設定の状態遷移', () => {
		// KEY のみ → 無効
		expect(isPrivateApiEnabled()).toBe(false);

		// 両方設定 → 有効
		process.env.BITBANK_API_SECRET = 'secret';
		expect(isPrivateApiEnabled()).toBe(true);

		// SECRET 削除 → 再び無効
		delete process.env.BITBANK_API_SECRET;
		expect(isPrivateApiEnabled()).toBe(false);
	});
});
