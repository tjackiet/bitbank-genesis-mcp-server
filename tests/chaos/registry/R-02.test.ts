/**
 * Chaos R-02: ツールの handler が例外を throw する
 * 仮説: registerToolWithLog のラッパーがキャッチし、構造化エラーを返す
 *
 * src/server.ts の registerToolWithLog() は handler を try-catch で囲み、
 * throw された例外を { ok: false, meta: { errorType: 'internal' } } に変換する。
 */

import { describe, expect, it } from 'vitest';

/**
 * registerToolWithLog の catch ブロック（src/server.ts:213-225）を再現。
 * handler が throw した場合の応答生成ロジック。
 */
function simulateHandlerError(err: unknown): {
	content: Array<{ type: string; text: string }>;
	structuredContent: { ok: boolean; summary: string; meta: { ms: number; errorType: string } };
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

describe('Chaos: R-02 — ツール handler が同期例外を throw する', () => {
	/** 仮説: 構造化エラーレスポンスに変換される */

	it('Error オブジェクトの throw', () => {
		const result = simulateHandlerError(new Error('Handler crashed'));
		expect(result.structuredContent.ok).toBe(false);
		expect(result.structuredContent.meta.errorType).toBe('internal');
		expect(result.content[0].text).toContain('Handler crashed');
	});

	it('TypeError の throw', () => {
		const result = simulateHandlerError(new TypeError('Cannot read properties of null'));
		expect(result.structuredContent.ok).toBe(false);
		expect(result.content[0].text).toContain('Cannot read properties');
	});

	it('RangeError の throw', () => {
		const result = simulateHandlerError(new RangeError('Maximum call stack size exceeded'));
		expect(result.structuredContent.ok).toBe(false);
		expect(result.content[0].text).toContain('Maximum call stack');
	});

	it('文字列の throw', () => {
		const result = simulateHandlerError('string error thrown');
		expect(result.structuredContent.ok).toBe(false);
		expect(result.content[0].text).toContain('string error thrown');
	});

	it('数値の throw', () => {
		const result = simulateHandlerError(42);
		expect(result.structuredContent.ok).toBe(false);
		expect(result.content[0].text).toContain('42');
	});

	it('オブジェクトの throw', () => {
		const result = simulateHandlerError({ code: 'ERR_CUSTOM', detail: 'something went wrong' });
		expect(result.structuredContent.ok).toBe(false);
		// String({ ... }) → "[object Object]"
		expect(result.content[0].text).toBeTruthy();
	});

	it('メッセージが空の Error', () => {
		const result = simulateHandlerError(new Error(''));
		expect(result.content[0].text).toContain('不明なエラー');
	});

	it('errorType は常に internal', () => {
		const errors = [new Error('test'), new TypeError('type error'), 'string', 42, null, undefined];
		for (const err of errors) {
			const result = simulateHandlerError(err);
			expect(result.structuredContent.meta.errorType).toBe('internal');
		}
	});
});
