/**
 * Chaos P-02: 空文字の API キーを設定
 * 仮説: isPrivateApiEnabled() が false を返す
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createGetAuthHeaders } from '../../../src/private/auth.js';
import { getPrivateApiConfig, isPrivateApiEnabled } from '../../../src/private/config.js';

describe('Chaos: P-02 — 空文字の API キーを設定', () => {
	/** 仮説: 空文字は falsy なので isPrivateApiEnabled() が false を返す */

	afterEach(() => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;
	});

	it('両方空文字 → isPrivateApiEnabled() === false', () => {
		process.env.BITBANK_API_KEY = '';
		process.env.BITBANK_API_SECRET = '';
		expect(isPrivateApiEnabled()).toBe(false);
	});

	it('KEY が空文字、SECRET が有効 → false', () => {
		process.env.BITBANK_API_KEY = '';
		process.env.BITBANK_API_SECRET = 'valid_secret';
		expect(isPrivateApiEnabled()).toBe(false);
	});

	it('KEY が有効、SECRET が空文字 → false', () => {
		process.env.BITBANK_API_KEY = 'valid_key';
		process.env.BITBANK_API_SECRET = '';
		expect(isPrivateApiEnabled()).toBe(false);
	});

	it('空文字で getPrivateApiConfig() が null を返す', () => {
		process.env.BITBANK_API_KEY = '';
		process.env.BITBANK_API_SECRET = '';
		expect(getPrivateApiConfig()).toBeNull();
	});

	it('空文字で createGetAuthHeaders() が throw する', () => {
		process.env.BITBANK_API_KEY = '';
		process.env.BITBANK_API_SECRET = '';
		expect(() => createGetAuthHeaders('/v1/user/assets')).toThrow('未設定');
	});

	it('スペースのみの値は無効として扱われる', () => {
		process.env.BITBANK_API_KEY = ' ';
		process.env.BITBANK_API_SECRET = ' ';
		expect(isPrivateApiEnabled()).toBe(false);
	});

	it('スペースのみで getPrivateApiConfig() が null を返す', () => {
		process.env.BITBANK_API_KEY = ' ';
		process.env.BITBANK_API_SECRET = ' ';
		expect(getPrivateApiConfig()).toBeNull();
	});

	it('スペースのみで createGetAuthHeaders() が throw する', () => {
		process.env.BITBANK_API_KEY = ' ';
		process.env.BITBANK_API_SECRET = ' ';
		expect(() => createGetAuthHeaders('/v1/user/assets')).toThrow('未設定');
	});
});
