/**
 * Chaos R-04: ツールの handler が undefined を返す
 * 仮説: クラッシュしない（型安全性の検証）
 *
 * respond() は undefined を受け取った場合でもフォールバックで
 * テキスト応答を生成する。ここではその挙動を検証する。
 */

import { describe, expect, it } from 'vitest';

/** src/server.ts の respond() と同等のロジック */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function respond(result: unknown): {
	content: Array<{ type: string; text: string }>;
	structuredContent?: Record<string, unknown>;
} {
	let text = '';
	if (isPlainObject(result)) {
		const r = result as Record<string, unknown>;
		if (Array.isArray(r.content)) {
			const first = (r.content as Array<Record<string, unknown>>).find(
				(c) => c && c.type === 'text' && typeof c.text === 'string',
			);
			if (first) text = String(first.text);
		} else if (typeof r.content === 'string') {
			text = String(r.content);
		}
		if (!text && typeof r.summary === 'string') {
			text = String(r.summary);
		}
	}
	if (!text) {
		try {
			const json = JSON.stringify(
				result,
				(_key, value) => {
					if (typeof value === 'string' && value.length > 2000) return `…omitted (${value.length} chars)`;
					return value;
				},
				2,
			);
			text = json.length > 4000 ? `${json.slice(0, 4000)}\n…(truncated)…` : json;
		} catch {
			text = String(result);
		}
	}
	return {
		content: [{ type: 'text', text }],
		...(isPlainObject(result) ? { structuredContent: result } : {}),
	};
}

describe('Chaos: R-04 — ツール handler が undefined / 異常値を返す', () => {
	/** 仮説: respond() がフォールバックでテキスト応答を生成する */

	it('undefined → テキスト応答を返す', () => {
		const result = respond(undefined);
		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe('text');
		expect(result.content[0].text).toBeTruthy();
		// structuredContent は付与されない（isPlainObject(undefined) === false）
		expect(result.structuredContent).toBeUndefined();
	});

	it('null → テキスト応答を返す', () => {
		const result = respond(null);
		expect(result.content[0].text).toBe('null');
		expect(result.structuredContent).toBeUndefined();
	});

	it('空の content 配列 → summary にフォールバック', () => {
		const result = respond({ content: [], summary: 'フォールバック' });
		expect(result.content[0].text).toBe('フォールバック');
	});

	it('content が不正な型 → summary にフォールバック', () => {
		const result = respond({ content: 42, summary: 'fallback text' });
		expect(result.content[0].text).toBe('fallback text');
	});

	it('summary も content もない → JSON シリアライズにフォールバック', () => {
		const result = respond({ data: [1, 2, 3], meta: { count: 3 } });
		expect(result.content[0].text).toContain('"data"');
		expect(result.content[0].text).toContain('"meta"');
	});

	it('boolean true → テキスト応答を返す', () => {
		const result = respond(true);
		expect(result.content[0].text).toBe('true');
	});

	it('boolean false → テキスト応答を返す', () => {
		const result = respond(false);
		expect(result.content[0].text).toBe('false');
	});

	it('0 → テキスト応答を返す', () => {
		const result = respond(0);
		expect(result.content[0].text).toBe('0');
	});

	it('空文字列 → テキスト応答を返す', () => {
		const result = respond('');
		expect(result.content[0].text).toBe('""');
	});
});
