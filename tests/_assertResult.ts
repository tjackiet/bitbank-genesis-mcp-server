/**
 * テスト用 Result 型絞り込みヘルパー
 *
 * `const res: any = await fn()` の `: any` を除去した後、
 * `res.data.xxx` にアクセスするために型を絞り込む。
 */
import { expect } from 'vitest';
import type { FailResult } from '../src/schema/types.js';

// biome-ignore lint/suspicious/noExplicitAny: テスト専用 — deep property access を許容する
type AnyRecord = Record<string, any>;

/** ok: true に絞り込む。handler の Result | McpResponse 両方に対応。 */
export function assertOk<T>(
	res: T,
): asserts res is T & { ok: true; summary: string; data: AnyRecord; meta: AnyRecord } {
	expect((res as { ok?: boolean }).ok).toBe(true);
}

/** ok: false に絞り込む。 */
export function assertFail<T>(res: T): asserts res is T & FailResult<AnyRecord> {
	expect((res as { ok?: boolean }).ok).toBe(false);
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
