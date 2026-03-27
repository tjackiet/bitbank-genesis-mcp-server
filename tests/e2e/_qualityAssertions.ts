/**
 * E2E 品質アサーション — MCP ツールレスポンスの決定論的品質チェック
 *
 * tools.md のルール「LLM は content[0].text だけが見える」を機械的に強制し、
 * ツールの使いやすさ・レスポンス品質を E2E テストで担保する。
 *
 * 評価軸:
 *   1. Content Richness — content テキストに LLM が判断に必要なデータが含まれるか
 *   2. Structural Consistency — ok/fail に応じた structuredContent の整合性
 *   3. Description Quality — ツール定義の description が十分に具体的か
 *   4. Error Clarity — 失敗時のメッセージが原因と対処を含むか
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { expect } from 'vitest';

/** callTool の戻り値型 */
type CallToolResult = Awaited<ReturnType<Client['callTool']>>;

/**
 * structuredContent から Result オブジェクトを取得する。
 *
 * handler が McpResponse を返した場合、respond() がそれを再ラップするため
 * Result は structuredContent.structuredContent に入る。
 * handler が plain Result を返した場合は structuredContent 直下に ok がある。
 * この関数は両方のケースを透過的に扱う。
 */
function sc(result: CallToolResult): Record<string, unknown> | undefined {
	const raw = result.structuredContent as Record<string, unknown> | undefined;
	if (!raw) return undefined;
	// ok が直下にあればそのまま（plain Result パターン）
	if ('ok' in raw) return raw;
	// McpResponse ラップ: structuredContent.structuredContent に Result がある
	const inner = raw.structuredContent as Record<string, unknown> | undefined;
	if (inner && 'ok' in inner) return inner;
	// どちらにも ok がない場合は raw をそのまま返す
	return raw;
}

/** content からテキストを結合 */
function extractText(result: CallToolResult): string {
	return (result.content as Array<{ type: string; text: string }>)
		.filter((c) => c.type === 'text')
		.map((c) => c.text)
		.join('\n');
}

// ────────────────────────────────────────────────────────
// 1. Content Richness — summary 一行だけでないことを検証
// ────────────────────────────────────────────────────────

/**
 * ok レスポンスの content テキストが summary 一行だけでなく、
 * LLM が判断に使えるデータを含んでいることを検証する。
 *
 * tools.md: 「ok(summary, data, meta) をそのまま返すと
 * toToolResult が summary 一行だけを content に入れるため、
 * LLM はデータを一切受け取れずハルシネーションを起こす」
 */
export function assertContentRichness(result: CallToolResult, opts: { minLines?: number } = {}): void {
	const structured = sc(result);
	const text = extractText(result);
	const isOk = structured?.ok === true;

	// ok レスポンスは content にデータが含まれていなければならない
	if (isOk) {
		const lines = text.split('\n').filter((l) => l.trim().length > 0);
		const minLines = opts.minLines ?? 2;
		expect(
			lines.length,
			`[ContentRichness] ok レスポンスの content が ${minLines} 行未満。` +
				'summary だけを返していませんか？ handler で content テキストにデータを含めてください。' +
				`\n実際の content:\n${text.slice(0, 200)}`,
		).toBeGreaterThanOrEqual(minLines);
	}

	// ok/fail どちらでも content は空であってはならない
	expect(text.length, '[ContentRichness] content テキストが空です').toBeGreaterThan(0);
}

// ────────────────────────────────────────────────────────
// 2. Structural Consistency — ok/fail の構造整合性
// ────────────────────────────────────────────────────────

/**
 * ok レスポンスの structuredContent が Result パターン (ADR-0001) に準拠し、
 * content テキストと矛盾しないことを検証する。
 */
export function assertOkStructure(result: CallToolResult): void {
	const structured = sc(result);
	const text = extractText(result);

	expect(structured, '[OkStructure] structuredContent が存在しません').toBeDefined();
	expect(structured?.ok, '[OkStructure] structuredContent.ok が true ではありません').toBe(true);

	// summary は string であること
	const summary = structured?.summary;
	expect(typeof summary, '[OkStructure] summary が string ではありません').toBe('string');
	expect((summary as string).length, '[OkStructure] summary が空です').toBeGreaterThan(0);

	// content テキストが空でないこと
	expect(text.length, '[OkStructure] content テキストが空です').toBeGreaterThan(0);
}

/**
 * fail レスポンスの structuredContent が FailResult パターンに準拠し、
 * errorType が含まれていることを検証する。
 */
export function assertFailStructure(result: CallToolResult): void {
	const structured = sc(result);
	const text = extractText(result);

	expect(structured, '[FailStructure] structuredContent が存在しません').toBeDefined();
	expect(structured?.ok, '[FailStructure] structuredContent.ok が false ではありません').toBe(false);

	// meta.errorType が存在すること
	const meta = structured?.meta as Record<string, unknown> | undefined;
	expect(meta?.errorType, '[FailStructure] meta.errorType が存在しません').toBeDefined();
	expect(typeof meta?.errorType, '[FailStructure] meta.errorType が string ではありません').toBe('string');

	// content テキストにエラー情報が含まれること
	expect(text.length, '[FailStructure] エラー時の content テキストが空です').toBeGreaterThan(0);
}

// ────────────────────────────────────────────────────────
// 3. Description Quality — ツール定義の description の品質
// ────────────────────────────────────────────────────────

/**
 * tools/list で返される各ツールの description が十分に具体的かを検証する。
 *
 * - 最低文字数を満たすこと（短すぎる description は LLM がツールを正しく選べない）
 * - 空でないこと
 */
export function assertDescriptionQuality(
	tools: Array<{ name: string; description?: string }>,
	opts: { minLength?: number } = {},
): void {
	const minLength = opts.minLength ?? 15;
	for (const tool of tools) {
		expect(tool.description, `[DescriptionQuality] ツール "${tool.name}" に description がありません`).toBeDefined();
		expect(
			(tool.description ?? '').length,
			`[DescriptionQuality] ツール "${tool.name}" の description が短すぎます (${minLength}文字未満): "${tool.description}"`,
		).toBeGreaterThanOrEqual(minLength);
	}
}

// ────────────────────────────────────────────────────────
// 4. Error Clarity — エラーメッセージの明瞭性
// ────────────────────────────────────────────────────────

/**
 * fail レスポンスの content テキストが、原因を推測できる程度に
 * 具体的な情報を含んでいることを検証する。
 */
export function assertErrorClarity(result: CallToolResult, opts: { minLength?: number } = {}): void {
	const structured = sc(result);
	const text = extractText(result);
	const minLength = opts.minLength ?? 5;

	// fail レスポンスであること
	expect(structured?.ok, '[ErrorClarity] ok: false のレスポンスが前提です').toBe(false);

	// テキストが十分な長さであること
	expect(
		text.length,
		`[ErrorClarity] エラーメッセージが短すぎます (${minLength}文字未満): "${text}"`,
	).toBeGreaterThanOrEqual(minLength);
}

// ────────────────────────────────────────────────────────
// 複合アサーション — テストで1行で呼べる便利関数
// ────────────────────────────────────────────────────────

/**
 * ok レスポンスに対する全品質チェックを一括実行。
 *
 * - Content Richness (summary 一行だけでないか)
 * - Structural Consistency (Result パターン準拠)
 */
export function assertOkQuality(result: CallToolResult, opts: { minLines?: number } = {}): void {
	assertOkStructure(result);
	assertContentRichness(result, opts);
}

/**
 * fail レスポンスに対する全品質チェックを一括実行。
 *
 * - Structural Consistency (FailResult パターン準拠)
 * - Error Clarity (エラーメッセージの具体性)
 */
export function assertFailQuality(result: CallToolResult, opts: { minLength?: number } = {}): void {
	assertFailStructure(result);
	assertErrorClarity(result, opts);
}
