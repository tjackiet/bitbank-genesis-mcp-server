import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import rateLimit from 'express-rate-limit';
import type { NextFunction, Request, RequestHandler, Response } from 'express-serve-static-core';

const PORT = Number(process.env.PORT ?? 8787);
const ENDPOINT = '/mcp';

/** レート制限: ウィンドウ（ミリ秒）。デフォルト 60 秒 */
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
/** レート制限: ウィンドウあたり最大リクエスト数。デフォルト 60 */
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 60);

const app = express();
app.use(express.json({ limit: '2mb' }));

// ngrok Free のブラウザ警告回避用ヘッダ
app.use((_req: Request, res: Response, next: NextFunction) => {
	res.setHeader('ngrok-skip-browser-warning', '1');
	next();
});

// 簡易ヘルスチェック
app.get('/health', (_req: Request, res: Response) => {
	res.json({ ok: true, ts: Date.now() });
});
// 最低限の /mcp ルート（メタ確認用）
app.get(ENDPOINT, (_req: Request, res: Response) => {
	res.json({
		version: '1.0',
		actions: [
			{
				name: 'ping',
				description: 'Health check action',
				parameters: { type: 'object', properties: { message: { type: 'string', description: 'Any message' } } },
			},
		],
	});
});

// 最小サーバ（必要に応じて既存の登録ロジックに差し替え可）
const server = new McpServer({ name: 'bb-mcp', version: '1.0.0' });
// SDK の registerTool 型が厳密すぎるため、空スキーマ登録にキャストを集約
(server as unknown as { registerTool: (n: string, s: unknown, h: unknown) => void }).registerTool(
	'ping',
	{
		description: 'Return a ping response',
		inputSchema: { message: { type: 'string', description: 'Any message' } },
	},
	async (args: Record<string, unknown>) => {
		return { content: [{ type: 'text', text: `pong: ${String(args.message ?? '')}` }] };
	},
);

// Streamable HTTP transport
const allowedHosts = (process.env.ALLOWED_HOSTS ?? 'localhost,127.0.0.1,*.ngrok-free.dev')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

// StreamableHTTPServerTransport のコンストラクタ型が SDK で正確に export されていないためキャストを集約
type Transport = Parameters<typeof server.connect>[0];
const HttpTransport = StreamableHTTPServerTransport as unknown as new (
	opts: Record<string, unknown>,
) => Transport & {
	handleRequest?: (req: IncomingMessage, res: ServerResponse, body?: unknown) => Promise<void>;
};
const transport = new HttpTransport({
	path: ENDPOINT,
	sessionIdGenerator: () => randomUUID(),
	enableDnsRebindingProtection: true,
	...(allowedHosts.length ? { allowedHosts } : {}),
	...(allowedOrigins.length ? { allowedOrigins } : {}),
});

await server.connect(transport);

// /mcp エンドポイントにレート制限を適用（stdio には影響しない）
const mcpLimiter = rateLimit({
	windowMs: RATE_LIMIT_WINDOW_MS,
	max: RATE_LIMIT_MAX,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	message: { error: 'Too many requests. Please try again later.' },
});
app.use(ENDPOINT, mcpLimiter as unknown as RequestHandler);

// SDK 公式の handleRequest を使って HTTP リクエストを処理する
const mw: RequestHandler =
	typeof transport.handleRequest === 'function'
		? (req, res, next) => {
				transport.handleRequest!(req, res, req.body).catch(next);
			}
		: (_req: Request, _res: Response, next: NextFunction) => next();
app.use(ENDPOINT, mw);

app.listen(PORT, '::', () => {
	// eslint-disable-next-line no-console
	console.log(`MCP HTTP listening on http://localhost:${PORT}${ENDPOINT}`);
});
