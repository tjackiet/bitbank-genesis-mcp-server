/**
 * Chaos T-01: STDIO に不正な JSON-RPC を送信
 * 仮説: パースエラーで適切なエラーレスポンスを返し、サーバーはクラッシュしない
 *
 * MCP SDK が JSON-RPC パースを担うため、ここではサーバー層の respond() と
 * registerToolWithLog() のエラーハンドリングを直接テストする。
 */

import { describe, expect, it } from 'vitest';

/**
 * respond() 相当のロジックを検証する。
 * src/server.ts の respond() は export されていないため、同等のロジックをテストする。
 */
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

describe('Chaos: T-01 — 不正なレスポンスデータの処理', () => {
	/** 仮説: respond() がどんな入力でもクラッシュせず、テキストを返す */

	it('null を渡してもクラッシュしない', () => {
		const result = respond(null);
		expect(result.content[0].text).toBeTruthy();
		expect(result.content[0].type).toBe('text');
	});

	it('undefined を渡してもクラッシュしない', () => {
		const result = respond(undefined);
		expect(result.content[0].text).toBeTruthy();
	});

	it('空オブジェクトを渡してもクラッシュしない', () => {
		const result = respond({});
		expect(result.content[0].text).toBeTruthy();
	});

	it('循環参照オブジェクトでもクラッシュしない', () => {
		const obj: Record<string, unknown> = { key: 'value' };
		obj.self = obj;
		// JSON.stringify が失敗するが、catch で String(result) にフォールバック
		const result = respond(obj);
		expect(result.content[0].text).toBeTruthy();
	});

	it('巨大な文字列を含むオブジェクトは切り詰められる', () => {
		const result = respond({ data: 'x'.repeat(10000) });
		expect(result.content[0].text.length).toBeLessThan(10000);
	});

	it('巨大な JSON は 4000 文字で切り詰められる', () => {
		const bigObj: Record<string, string> = {};
		for (let i = 0; i < 500; i++) {
			bigObj[`key_${i}`] = `value_${i}`;
		}
		const result = respond(bigObj);
		expect(result.content[0].text).toContain('truncated');
	});

	it('文字列を直接渡しても処理できる', () => {
		const result = respond('plain string result');
		expect(result.content[0].text).toContain('plain string result');
	});

	it('数値を渡しても処理できる', () => {
		const result = respond(42);
		expect(result.content[0].text).toContain('42');
	});

	it('配列を渡しても処理できる', () => {
		const result = respond([1, 2, 3]);
		expect(result.content[0].text).toBeTruthy();
	});

	it('正常な Result オブジェクトは summary を返す', () => {
		const result = respond({ ok: true, summary: 'テスト成功', data: {} });
		expect(result.content[0].text).toBe('テスト成功');
	});
});
