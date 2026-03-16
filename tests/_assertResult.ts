/**
 * テスト用 Result 型絞り込みヘルパー
 *
 * `const res: any = await fn()` の `: any` を除去した後、
 * `res.data.xxx` にアクセスするために型を絞り込む。
 */
import { expect } from 'vitest';

/**
 * Result が ok: true であることを assert し、型を絞り込む。
 * `expect(res.ok).toBe(true)` の代替として使用。
 */
export function assertOk<T extends { ok: boolean }>(res: T): asserts res is Extract<T, { ok: true }> {
	expect(res.ok).toBe(true);
}

/**
 * Result が ok: false であることを assert し、型を絞り込む。
 * `expect(res.ok).toBe(false)` の代替として使用。
 */
export function assertFail<T extends { ok: boolean }>(res: T): asserts res is Extract<T, { ok: false }> {
	expect(res.ok).toBe(false);
}

/**
 * テスト用モックキャスト。`as any` の代替。
 *
 * `mockResolvedValueOnce` 等に渡す部分モックオブジェクトを
 * 関数の戻り値型に合わせてキャストする。T はコンテキストから推論される。
 *
 * @example
 * mockedFn.mockResolvedValueOnce(asMockResult(buildObj()));
 */
export function asMockResult<T>(value: unknown): T {
	return value as T;
}
