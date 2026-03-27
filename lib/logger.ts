import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { nowIso, today } from './datetime.js';

const LOG_DIR = process.env.LOG_DIR || './logs';
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LEVELS: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const THRESH = LEVELS[LOG_LEVEL] ?? LEVELS.info;

function ensureDir(dir: string) {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJsonl(file: string, obj: unknown) {
	ensureDir(path.dirname(file));
	fs.appendFileSync(file, `${JSON.stringify(obj)}\n`);
}

// ── チェーンハッシュ（取引操作ログ専用） ──

let lastTradeHash = '0'.repeat(64);

/** チェーンハッシュ付きで取引操作ログを書き込む */
function writeTradeJsonl(file: string, record: Record<string, unknown>) {
	ensureDir(path.dirname(file));
	const withChain = { ...record, _prevHash: lastTradeHash };
	const json = JSON.stringify(withChain);
	lastTradeHash = createHash('sha256').update(json).digest('hex');
	const finalRecord = { ...withChain, _hash: lastTradeHash };
	fs.appendFileSync(file, `${JSON.stringify(finalRecord)}\n`);
}

export function log(level: 'error' | 'warn' | 'info' | 'debug', event: Record<string, unknown>): void {
	if ((LEVELS[level] ?? 2) > THRESH) return;
	const date = today('YYYY-MM-DD');
	const file = path.join(LOG_DIR, `${date}.jsonl`);
	const record = { ts: nowIso(), level, ...event } as const;
	try {
		writeJsonl(file, record);
	} catch {
		// best-effort: ignore log failures
	}
}

export function logToolRun(args: { tool: string; input: unknown; result: unknown; ms: number }): void {
	const { tool, input, result, ms } = args;
	const r = result as Record<string, unknown> | null | undefined;
	const safeData = {
		ok: r?.ok,
		summary: r?.summary,
		meta: r?.meta,
	};
	log('info', { type: 'tool_run', tool, input, ms, result: safeData });
}

export function logError(tool: string, err: unknown, input: unknown): void {
	log('error', {
		type: 'tool_error',
		tool,
		input,
		error: (err instanceof Error ? err.message : undefined) || String(err),
	});
}

// ── 取引操作ログ（チェーンハッシュ付き） ──

export function logTradeAction(action: {
	type: 'create_order' | 'cancel_order' | 'cancel_orders';
	orderId?: number;
	orderIds?: number[];
	pair: string;
	side?: string;
	orderType?: string;
	amount?: string;
	price?: string | null;
	triggerPrice?: string | null;
	status: string;
	confirmed: boolean;
}) {
	const date = today('YYYY-MM-DD');
	const file = path.join(LOG_DIR, `${date}.jsonl`);
	const record: Record<string, unknown> = {
		ts: nowIso(),
		level: 'info',
		category: 'trade_action',
		...action,
	};
	try {
		writeTradeJsonl(file, record);
	} catch {
		// best-effort
	}
}
