import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express-serve-static-core';

const PORT = Number(process.env.PORT ?? 8787);
const ENDPOINT = '/mcp';

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
	{ description: 'Return a ping response', inputSchema: {} },
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
	expressMiddleware?: () => RequestHandler;
};
const transport = new HttpTransport({
	path: ENDPOINT,
	sessionIdGenerator: () => randomUUID(),
	enableDnsRebindingProtection: true,
	...(allowedHosts.length ? { allowedHosts } : {}),
	...(allowedOrigins.length ? { allowedOrigins } : {}),
});

await server.connect(transport);

const mw: RequestHandler =
	typeof transport.expressMiddleware === 'function'
		? transport.expressMiddleware()
		: (_req: Request, _res: Response, next: NextFunction) => next();
app.use(ENDPOINT, mw);

app.listen(PORT, '::', () => {
	// eslint-disable-next-line no-console
	console.log(`MCP HTTP listening on http://localhost:${PORT}${ENDPOINT}`);
});
