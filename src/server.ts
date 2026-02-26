import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { logToolRun, logError } from '../lib/logger.js';
import { allToolDefs } from './tool-registry.js';
import { prompts as promptDefs } from './prompts.js';
import { SYSTEM_PROMPT } from './system-prompt.js';

const server = new McpServer({ name: 'bitbank-mcp', version: '0.4.2' });
// Explicit registries for tools/prompts to improve STDIO inspector compatibility
const registeredTools: Array<{ name: string; description: string; inputSchema: any }> = [];
const registeredPrompts: Array<{ name: string; description: string }> = [];

type TextContent = { type: 'text'; text: string; _meta?: Record<string, unknown> };
type ToolReturn = { content: TextContent[]; structuredContent?: Record<string, unknown> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const respond = (result: unknown): ToolReturn => {
	// 優先順位: custom content > summary > safe JSON fallback
	let text = '';
	if (isPlainObject(result)) {
		const r: any = result as any;
		// ツールが content を提供している場合（配列 or 文字列）を優先
		if (Array.isArray(r.content)) {
			const first = r.content.find((c: any) => c && c.type === 'text' && typeof c.text === 'string');
			if (first) {
				text = String(first.text);
			}
		} else if (typeof r.content === 'string') {
			text = String(r.content);
		}
		// 上記で未決定なら summary を採用
		if (!text && typeof r.summary === 'string') {
			text = String(r.summary);
		}
	}
	// それでも空の場合は安全な短縮JSONにフォールバック
	if (!text) {
		try {
			const json = JSON.stringify(result, (_key, value) => {
				if (typeof value === 'string' && value.length > 2000) return `…omitted (${value.length} chars)`;
				return value;
			}, 2);
			text = json.length > 4000 ? json.slice(0, 4000) + '\n…(truncated)…' : json;
		} catch {
			text = String(result);
		}
	}
	return {
		content: [{ type: 'text', text }],
		...(isPlainObject(result) ? { structuredContent: result } : {}),
	};
};

function registerToolWithLog<S extends z.ZodTypeAny, R = unknown>(
	name: string,
	schema: { description: string; inputSchema: S },
	handler: (input: z.infer<S>) => Promise<R>
) {
	// Convert Zod schema → JSON Schema (subset) for MCP inspector
	const unwrapZod = (s: any): any => {
		let cur = s;
		for (let i = 0; i < 6; i++) {
			const def = cur?._def;
			if (!def) break;
			if (def?.schema) { cur = def.schema; continue; }
			if (def?.innerType) { cur = def.innerType; continue; }
			break;
		}
		return cur;
	};
	const toJsonSchema = (s: any): any => {
		s = unwrapZod(s);
		const t = s?._def?.typeName;
		switch (t) {
			case 'ZodString': {
				const out: any = { type: 'string' };
				const checks = s?._def?.checks || [];
				const rex = checks.find((c: any) => c.kind === 'regex')?.regex;
				if (rex) out.pattern = String(rex.source);
				return out;
			}
			case 'ZodNumber': {
				const out: any = { type: 'number' };
				const checks = s?._def?.checks || [];
				const min = checks.find((c: any) => c.kind === 'min')?.value;
				const max = checks.find((c: any) => c.kind === 'max')?.value;
				if (Number.isFinite(min)) out.minimum = min;
				if (Number.isFinite(max)) out.maximum = max;
				return out;
			}
			case 'ZodBoolean': return { type: 'boolean' };
			case 'ZodEnum': return { type: 'string', enum: [...(s?._def?.values || [])] };
			case 'ZodArray': return { type: 'array', items: toJsonSchema(s?._def?.type) };
			case 'ZodTuple': {
				const items = (s?._def?.items || []).map((it: any) => toJsonSchema(it));
				return { type: 'array', items, minItems: items.length, maxItems: items.length };
			}
			case 'ZodRecord': return { type: 'object', additionalProperties: toJsonSchema(s?._def?.valueType) };
			case 'ZodObject': {
				const shape = (s as any).shape || (typeof s?._def?.shape === 'function' ? s._def.shape() : undefined) || {};
				const properties: Record<string, any> = {};
				const required: string[] = [];
				for (const [key, zodProp] of Object.entries(shape)) {
					// detect defaults and optional
					let defVal: any = undefined;
					let isOptional = false;
					let cur: any = zodProp as any;
					for (let i = 0; i < 6; i++) {
						const def = cur?._def;
						if (!def) break;
						if (def.typeName === 'ZodDefault') {
							try { defVal = typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue; } catch { }
							cur = def.innerType; continue;
						}
						if (def.typeName === 'ZodOptional') { isOptional = true; cur = def.innerType; continue; }
						if (def?.schema) { cur = def.schema; continue; }
						if (def?.innerType) { cur = def.innerType; continue; }
						break;
					}
					properties[key] = toJsonSchema(cur);
					if (defVal !== undefined) properties[key].default = defVal;
					if (!isOptional && defVal === undefined) required.push(key);
				}
				const obj: any = { type: 'object', properties };
				if (required.length) obj.required = required;
				return obj;
			}
			default: return {};
		}
	};

	// Build JSON Schema for listing
	const inputSchemaJson = toJsonSchema(schema.inputSchema) || { type: 'object', properties: {} };
	registeredTools.push({ name, description: schema.description, inputSchema: inputSchemaJson });

	// For actual registration, the SDK expects a Zod raw shape (not JSON schema)
	const getRawShape = (s: z.ZodTypeAny): z.ZodRawShape => {
		let cur: any = s as any;
		for (let i = 0; i < 6; i++) {
			if (cur?.shape) break;
			const def = cur?._def;
			if (!def) break;
			if (def?.schema) { cur = def.schema; continue; }
			if (def?.innerType) { cur = def.innerType; continue; }
			break;
		}
		if (cur?.shape) return cur.shape as z.ZodRawShape;
		throw new Error('inputSchema must be or wrap a ZodObject');
	};

	server.registerTool(name, { description: schema.description, inputSchema: getRawShape(schema.inputSchema) } as any, async (input: any) => {
		const t0 = Date.now();
		try {
			const result = await handler(input as z.infer<S>);
			const ms = Date.now() - t0;
			logToolRun({ tool: name, input, result, ms });
			return respond(result);
		} catch (err: unknown) {
			const ms = Date.now() - t0;
			logError(name, err, input);
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: 'text', text: `internal error: ${message || 'unknown error'}` }],
				structuredContent: {
					ok: false,
					summary: `internal error: ${message || 'unknown error'}`,
					meta: { ms, errorType: 'internal' },
				},
			};
		}
	});
}

// === Auto-register all tools from registry ===
for (const def of allToolDefs) {
	registerToolWithLog(
		def.name,
		{ description: def.description, inputSchema: def.inputSchema },
		def.handler as any
	);
}

// === Register prompts (SDK 形式に寄せた最小導入) ===
function registerPromptSafe(name: string, def: { description: string; messages: any[] }) {
	const s: any = server as any;
	if (typeof s.registerPrompt === 'function') {
		// Inspector 互換: tool_code をテキストに変換し、role=system は user 扱いにする
		const toSdkMessages = (msgs: any[]) =>
			msgs.map((msg) => {
				const blocks = Array.isArray(msg.content) ? msg.content : [];
				const text = blocks
					.map((b: any) => {
						if (b?.type === 'text' && typeof b.text === 'string') return b.text;
						if (b?.type === 'tool_code') {
							const tool = b.tool_name || 'tool';
							const args = b.tool_input ? JSON.stringify(b.tool_input) : '{}';
							return `Call ${tool} with ${args}`;
						}
						return '';
					})
					.filter(Boolean)
					.join('\n');
				return { role: msg.role === 'system' ? 'user' : 'assistant', content: { type: 'text', text } };
			});
		registeredPrompts.push({ name, description: def.description });
		s.registerPrompt(
			name,
			{ description: def.description },
			() => ({ description: def.description, messages: toSdkMessages(def.messages) })
		);
	} else {
		// no-op if SDK doesn't support prompts in this version
	}
}

// === Register prompts from src/prompts.ts ===
for (const p of (promptDefs as any[])) {
	registerPromptSafe(p.name, { description: p.description, messages: p.messages });
}

// === stdio 接続（最後に実行） ===
const transport = new StdioServerTransport();
await server.connect(transport);

// Fallback handlers to ensure list operations work over STDIO
try {
	(server as any).setRequestHandler?.('tools/list', async () => ({
		tools: registeredTools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
	}));
	(server as any).setRequestHandler?.('prompts/list', async () => ({
		prompts: registeredPrompts.map((p) => ({ name: p.name, description: p.description })),
	}));
	// prompts/get: return specific prompt definition as-is (no conversion)
	(server as any).setRequestHandler?.('prompts/get', async (request: any) => {
		try {
			console.error('[prompts/get] Request received:', safeJson(request));
			const name = request?.params?.name;
			console.error('[prompts/get] Requested name:', name);
			if (!name) {
				console.error('[prompts/get] ERROR: No name provided');
				throw new Error('Prompt name is required');
			}
			console.error('[prompts/get] Available prompts:', (promptDefs as any[]).map((p) => p.name).join(', '));
			const promptDef = (promptDefs as any[]).find((p) => p.name === name);
			if (!promptDef) {
				console.error('[prompts/get] ERROR: Prompt not found:', name);
				throw new Error(`Prompt not found: ${name}`);
			}
			console.error('[prompts/get] Found prompt:', name, 'with', (promptDef as any)?.messages?.length ?? 0, 'messages');
			const result = { description: (promptDef as any).description, messages: (promptDef as any).messages };
			console.error('[prompts/get] Returning result with', (result as any).messages?.length ?? 0, 'messages');
			return result;
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			const stack = error instanceof Error ? error.stack : undefined;
			console.error('[prompts/get] EXCEPTION:', message, stack);
			throw error;
		}
	});
} catch { }

function safeJson(v: unknown) {
	try { return JSON.stringify(v); } catch { return '[unserializable]'; }
}

// Resources: provide system-level prompt as MCP resource
try {
	(server as any).setRequestHandler?.('resources/list', async () => ({
		resources: [
			{
				uri: 'prompt://system',
				name: 'test-bb System Prompt',
				description: 'System-level guidance for using test-bb MCP server',
				mimeType: 'text/plain',
			},
		],
	}));
	(server as any).setRequestHandler?.('resources/read', async (request: any) => {
		const uri = request?.params?.uri;
		if (uri === 'prompt://system') {
			return {
				contents: [
					{ uri: 'prompt://system', mimeType: 'text/plain', text: SYSTEM_PROMPT },
				],
			};
		}
		throw new Error(`Resource not found: ${uri}`);
	});
} catch { }

// Optional HTTP transport (/mcp) when PORT is provided
try {
	const portStr = process.env.PORT;
	const port = portStr ? Number(portStr) : NaN;
	const enableHttp = process.env.MCP_ENABLE_HTTP === '1';
	if (enableHttp && Number.isFinite(port) && port > 0) {
		const { default: express } = await import('express');
		const app = express();
		app.use(express.json());
		const allowedHosts = (process.env.ALLOWED_HOSTS || '127.0.0.1,localhost').split(',').map(s => s.trim()).filter(Boolean);
		const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
		const httpTransport: any = new (StreamableHTTPServerTransport as any)({
			path: '/mcp', // some SDKs use 'path' instead of 'endpoint'
			sessionIdGenerator: () => randomUUID(),
			enableDnsRebindingProtection: true,
			...(allowedHosts.length ? { allowedHosts } : {}),
			...(allowedOrigins.length ? { allowedOrigins } : {}),
		} as any);
		await server.connect(httpTransport as any);
		const mw = typeof httpTransport.expressMiddleware === 'function'
			? httpTransport.expressMiddleware()
			: (req: any, res: any, next: any) => next();
		app.use(mw);
		app.listen(port, () => {
			// no stdout/stderr output to avoid STDIO transport contamination
		});
	}
} catch (e) {
	// eslint-disable-next-line no-console
	console.warn('HTTP transport setup skipped:', (e as any)?.message || e);
}
