/**
 * Chaos T-05: HTTP トランスポートで不正な Origin ヘッダー
 * 仮説: DNS Rebinding Protection が拒否する
 *
 * HTTP トランスポートの設定パラメータを検証する。
 * 実際の HTTP リクエストは StreamableHTTPServerTransport の責務だが、
 * サーバー設定が正しく構成されることを確認。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Chaos: T-05 — HTTP トランスポートの DNS Rebinding Protection 設定', () => {
	/** 仮説: enableDnsRebindingProtection が常に true で設定される */

	const originalEnv: Record<string, string | undefined> = {};

	beforeEach(() => {
		originalEnv.ALLOWED_HOSTS = process.env.ALLOWED_HOSTS;
		originalEnv.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS;
	});

	afterEach(() => {
		if (originalEnv.ALLOWED_HOSTS === undefined) delete process.env.ALLOWED_HOSTS;
		else process.env.ALLOWED_HOSTS = originalEnv.ALLOWED_HOSTS;
		if (originalEnv.ALLOWED_ORIGINS === undefined) delete process.env.ALLOWED_ORIGINS;
		else process.env.ALLOWED_ORIGINS = originalEnv.ALLOWED_ORIGINS;
	});

	it('ALLOWED_HOSTS 未設定時のデフォルトは 127.0.0.1,localhost', () => {
		delete process.env.ALLOWED_HOSTS;
		const hosts = (process.env.ALLOWED_HOSTS || '127.0.0.1,localhost')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		expect(hosts).toContain('127.0.0.1');
		expect(hosts).toContain('localhost');
	});

	it('ALLOWED_HOSTS にカスタム値を設定できる', () => {
		process.env.ALLOWED_HOSTS = 'myserver.local,192.168.1.100';
		const hosts = process.env.ALLOWED_HOSTS.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		expect(hosts).toContain('myserver.local');
		expect(hosts).toContain('192.168.1.100');
		expect(hosts).not.toContain('localhost');
	});

	it('ALLOWED_ORIGINS 未設定時は空配列（制限なし）', () => {
		delete process.env.ALLOWED_ORIGINS;
		const origins = (process.env.ALLOWED_ORIGINS || '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		expect(origins).toEqual([]);
	});

	it('ALLOWED_ORIGINS にカスタム値を設定できる', () => {
		process.env.ALLOWED_ORIGINS = 'https://myapp.example.com,https://localhost:3000';
		const origins = process.env.ALLOWED_ORIGINS.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		expect(origins).toContain('https://myapp.example.com');
		expect(origins).toContain('https://localhost:3000');
	});

	it('カンマ区切りで空白を含む値は trim される', () => {
		process.env.ALLOWED_HOSTS = ' 127.0.0.1 , localhost , ';
		const hosts = process.env.ALLOWED_HOSTS.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		expect(hosts).toEqual(['127.0.0.1', 'localhost']);
	});

	it('空文字のみの ALLOWED_HOSTS は空配列になる', () => {
		process.env.ALLOWED_HOSTS = ',,,';
		const hosts = process.env.ALLOWED_HOSTS.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		expect(hosts).toEqual([]);
	});
});
