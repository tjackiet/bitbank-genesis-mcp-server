import type { z } from 'zod';
import type { Result } from './schemas.js';

/** SVG 等を直接返すハンドラ用の事前フォーマット済み MCP レスポンス */
export interface McpResponse {
	content: Array<{ type: string; text: string }>;
	structuredContent: Record<string, unknown>;
}

/**
 * MCP ツール定義。各ツールファイル（または src/handlers/）で `toolDef` として export する。
 * server.ts は tool-registry.ts 経由でこの定義を自動収集し registerToolWithLog に渡す。
 *
 * ツール追加/改修時は toolDef を更新するだけで server.ts の変更は不要。
 */
export interface ToolDefinition {
	/** MCP ツール名 (e.g. 'get_ticker') */
	name: string;
	/** ツール説明（LLM 向け） */
	description: string;
	/** Zod 入力スキーマ */
	inputSchema: z.ZodTypeAny;
	/** MCP ハンドラ（入力を受けて結果を返す）。respond() で自動ラップされる。 */
	handler(args: Record<string, unknown>): Promise<Result | McpResponse>;
}
