import { afterEach, describe, expect, it } from 'vitest';
import { getPrivateApiConfig, isPrivateApiEnabled } from '../../src/private/config.js';

describe('private/config', () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	describe('isPrivateApiEnabled', () => {
		it('両方設定されていれば true', () => {
			process.env.BITBANK_API_KEY = 'key';
			process.env.BITBANK_API_SECRET = 'secret';
			expect(isPrivateApiEnabled()).toBe(true);
		});

		it('KEY のみでは false', () => {
			process.env.BITBANK_API_KEY = 'key';
			delete process.env.BITBANK_API_SECRET;
			expect(isPrivateApiEnabled()).toBe(false);
		});

		it('SECRET のみでは false', () => {
			delete process.env.BITBANK_API_KEY;
			process.env.BITBANK_API_SECRET = 'secret';
			expect(isPrivateApiEnabled()).toBe(false);
		});

		it('両方未設定で false', () => {
			delete process.env.BITBANK_API_KEY;
			delete process.env.BITBANK_API_SECRET;
			expect(isPrivateApiEnabled()).toBe(false);
		});

		it('空文字は未設定扱い', () => {
			process.env.BITBANK_API_KEY = '';
			process.env.BITBANK_API_SECRET = '';
			expect(isPrivateApiEnabled()).toBe(false);
		});
	});

	describe('getPrivateApiConfig', () => {
		it('両方設定されていれば config を返す', () => {
			process.env.BITBANK_API_KEY = 'my-key';
			process.env.BITBANK_API_SECRET = 'my-secret';
			expect(getPrivateApiConfig()).toEqual({
				apiKey: 'my-key',
				apiSecret: 'my-secret',
			});
		});

		it('KEY のみでは null', () => {
			process.env.BITBANK_API_KEY = 'my-key';
			delete process.env.BITBANK_API_SECRET;
			expect(getPrivateApiConfig()).toBeNull();
		});

		it('SECRET のみでは null', () => {
			delete process.env.BITBANK_API_KEY;
			process.env.BITBANK_API_SECRET = 'my-secret';
			expect(getPrivateApiConfig()).toBeNull();
		});

		it('両方未設定で null', () => {
			delete process.env.BITBANK_API_KEY;
			delete process.env.BITBANK_API_SECRET;
			expect(getPrivateApiConfig()).toBeNull();
		});
	});
});
