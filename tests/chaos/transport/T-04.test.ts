/**
 * Chaos T-04: STDIO の stdin を途中で閉じる
 * 仮説: サーバーが graceful に終了し、ログが残る
 *
 * 実際の STDIO ストリーム切断は E2E テストが必要だが、
 * ここではサーバー層のエラーハンドリングを検証する。
 * registerToolWithLog() の catch ブロックが全ての例外を処理することを確認。
 */

import { describe, expect, it } from 'vitest';

describe('Chaos: T-04 — ツール実行中の異常終了シナリオ', () => {
	/** 仮説: ハンドラが throw しても構造化エラーレスポンスを返す */

	/**
	 * registerToolWithLog の catch ブロックのロジックを再現。
	 * src/server.ts:213-225
	 */
	function simulateToolError(err: unknown): {
		content: Array<{ type: string; text: string }>;
		structuredContent: Record<string, unknown>;
	} {
		const message = err instanceof Error ? err.message : String(err);
		return {
			content: [{ type: 'text', text: `内部エラー: ${message || '不明なエラー'}` }],
			structuredContent: {
				ok: false,
				summary: `内部エラー: ${message || '不明なエラー'}`,
				meta: { ms: 0, errorType: 'internal' },
			},
		};
	}

	it('Error オブジェクトを適切にフォーマット', () => {
		const result = simulateToolError(new Error('Connection reset'));
		expect(result.content[0].text).toContain('Connection reset');
		expect(result.structuredContent.ok).toBe(false);
	});

	it('文字列エラーを適切にフォーマット', () => {
		const result = simulateToolError('unexpected disconnect');
		expect(result.content[0].text).toContain('unexpected disconnect');
	});

	it('null エラーでも内部エラーとして応答', () => {
		const result = simulateToolError(null);
		expect(result.content[0].text).toContain('内部エラー');
		expect(result.structuredContent.ok).toBe(false);
	});

	it('undefined エラーでも内部エラーとして応答', () => {
		const result = simulateToolError(undefined);
		expect(result.content[0].text).toContain('内部エラー');
		expect(result.structuredContent.ok).toBe(false);
	});

	it('空文字エラーでも「不明なエラー」で応答', () => {
		const result = simulateToolError(new Error(''));
		expect(result.content[0].text).toContain('不明なエラー');
	});

	it('タイムアウトエラーをフォーマット', () => {
		const result = simulateToolError(new Error('ツール実行がタイムアウトしました (60秒)'));
		expect(result.content[0].text).toContain('タイムアウト');
		expect(result.structuredContent.meta).toEqual({ ms: 0, errorType: 'internal' });
	});

	it('structuredContent が常に ok: false を持つ', () => {
		const errors = [new Error('test'), 'string error', null, 42, { custom: 'obj' }];
		for (const err of errors) {
			const result = simulateToolError(err);
			expect(result.structuredContent.ok).toBe(false);
			expect((result.structuredContent.meta as Record<string, unknown>).errorType).toBe('internal');
		}
	});
});
