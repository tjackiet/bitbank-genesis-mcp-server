import http from 'node:http';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * src/http.ts のレート制限ミドルウェアと同一構成で
 * express + express-rate-limit の動作を検証する。
 * stdio トランスポートにはレート制限が適用されないことを暗黙的に保証
 * （express ミドルウェアなので HTTP 以外には影響しない）。
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 3; // テスト用に少数

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
	const app = express();

	const limiter = rateLimit({
		windowMs: WINDOW_MS,
		max: MAX_REQUESTS,
		standardHeaders: 'draft-7',
		legacyHeaders: false,
		message: { error: 'Too many requests. Please try again later.' },
	});

	app.use('/mcp', limiter);
	app.post('/mcp', (_req, res) => {
		res.json({ ok: true });
	});

	// レート制限の対象外
	app.get('/health', (_req, res) => {
		res.json({ ok: true });
	});

	await new Promise<void>((resolve) => {
		server = app.listen(0, '127.0.0.1', () => resolve());
	});
	const addr = server.address() as { port: number };
	baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve, reject) => {
		server.close((err) => (err ? reject(err) : resolve()));
	});
});

describe('HTTP rate limiting on /mcp', () => {
	it('制限内のリクエストは 200 を返す', async () => {
		const res = await fetch(`${baseUrl}/mcp`, { method: 'POST' });
		expect(res.status).toBe(200);
		// draft-7: combined RateLimit ヘッダ
		const rl = res.headers.get('ratelimit');
		expect(rl).toContain(`limit=${MAX_REQUESTS}`);
	});

	it('制限超過で 429 を返す', async () => {
		// 残り枠を使い切る（beforeAll 後 1 回使用済みなので MAX-1 回追加）
		for (let i = 0; i < MAX_REQUESTS - 1; i++) {
			await fetch(`${baseUrl}/mcp`, { method: 'POST' });
		}

		const res = await fetch(`${baseUrl}/mcp`, { method: 'POST' });
		expect(res.status).toBe(429);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain('Too many requests');
	});

	it('/health はレート制限の対象外', async () => {
		// /mcp が制限超過でも /health は影響を受けない
		const res = await fetch(`${baseUrl}/health`);
		expect(res.status).toBe(200);
	});

	it('レスポンスに RateLimit 標準ヘッダが含まれる', async () => {
		// 新しいウィンドウで確認するため別 app を作る
		const app2 = express();
		const limiter2 = rateLimit({
			windowMs: WINDOW_MS,
			max: 10,
			standardHeaders: 'draft-7',
			legacyHeaders: false,
		});
		app2.use('/mcp', limiter2);
		app2.post('/mcp', (_req, res) => res.json({ ok: true }));

		const srv2 = await new Promise<http.Server>((resolve) => {
			const s = app2.listen(0, '127.0.0.1', () => resolve(s));
		});
		const addr2 = srv2.address() as { port: number };

		try {
			const res = await fetch(`http://127.0.0.1:${addr2.port}/mcp`, { method: 'POST' });
			expect(res.status).toBe(200);
			// draft-7: "limit=10, remaining=9, reset=N" 形式
			const rl = res.headers.get('ratelimit');
			expect(rl).toContain('limit=10');
			expect(rl).toContain('remaining=9');
			expect(rl).toMatch(/reset=\d+/);
			// RateLimit-Policy ヘッダも付与される
			expect(res.headers.get('ratelimit-policy')).toBeTruthy();
		} finally {
			await new Promise<void>((resolve, reject) => {
				srv2.close((err) => (err ? reject(err) : resolve()));
			});
		}
	});
});
