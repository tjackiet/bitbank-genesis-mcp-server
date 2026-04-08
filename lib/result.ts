import type { FailResult, OkResult } from '../src/schemas.js';
import { getErrorMessage, isAbortError } from './error.js';

export function ok<T = Record<string, unknown>, M = Record<string, unknown>>(
	summary: string,
	data: T = {} as T,
	meta: M = {} as M,
): OkResult<T, M> {
	return {
		ok: true,
		summary,
		data,
		meta,
	};
}

export function fail<M = Record<string, unknown>>(
	message: string,
	type: string = 'user',
	meta: M = {} as M,
): FailResult<M> {
	return {
		ok: false,
		summary: `Error: ${message}`,
		data: {},
		meta: { errorType: type, ...(meta as object) } as FailResult<M>['meta'],
	};
}

export interface FailFromErrorOptions {
	/** Zod スキーマ。指定時は fail() 結果を schema.parse() でラップ */
	schema?: { parse: (v: unknown) => unknown };
	/** タイムアウト検出用の timeoutMs 値。指定時は AbortError を 'timeout' として扱う */
	timeoutMs?: number;
	/** タイムアウト以外のデフォルトエラータイプ (default: 'internal') */
	defaultType?: string;
	/** getErrorMessage が空を返した場合のフォールバックメッセージ (default: 'internal error') */
	defaultMessage?: string;
}

/**
 * catch ブロックで捕捉したエラーから fail() 結果を生成する共通ヘルパー。
 *
 * - AbortError → 'timeout' タイプ + タイムアウトメッセージ
 * - その他 → defaultType + エラーメッセージ
 * - schema 指定時は schema.parse() でラップ
 */
export function failFromError(err: unknown, opts: FailFromErrorOptions = {}): ReturnType<typeof fail> {
	const { schema, timeoutMs, defaultType = 'internal', defaultMessage = 'internal error' } = opts;

	let message: string;
	let errorType: string;

	if (timeoutMs != null && isAbortError(err)) {
		message = `タイムアウト (${timeoutMs}ms)`;
		errorType = 'timeout';
	} else {
		message = getErrorMessage(err) || defaultMessage;
		errorType = defaultType;
	}

	const result = fail(message, errorType);
	return (schema ? schema.parse(result) : result) as ReturnType<typeof fail>;
}

/**
 * Zod スキーマの .parse() 結果を OkResult<T, M> | FailResult として返す型安全ヘルパー。
 *
 * 背景: toolResultSchema() が生成する Zod union の z.infer 型と
 * OkResult<T, M> | FailResult は構造的に一致するが、FailResult の meta 型の
 * 推論差異により TypeScript が直接代入を許可しない。このヘルパーでキャストを
 * 1箇所に集約し、各ツールファイルからキャストを排除する。
 */
export function parseAsResult<T, M>(
	schema: { parse: (v: unknown) => unknown },
	value: unknown,
): OkResult<T, M> | FailResult {
	return schema.parse(value) as OkResult<T, M> | FailResult;
}

/**
 * ensurePair / validateLimit / validateDate の失敗結果から fail() を生成する共通ヘルパー。
 *
 * @param result - バリデーション関数の失敗結果 ({ error: { message, type } })
 * @param schema - Zod スキーマ（指定時は schema.parse() でラップ）
 */
export function failFromValidation(
	result: { error: { message: string; type: string } },
	schema?: { parse: (v: unknown) => unknown },
): FailResult {
	const f = fail(result.error.message, result.error.type);
	return (schema ? schema.parse(f) : f) as FailResult;
}

/**
 * Result オブジェクトを structuredContent 用の Record<string, unknown> に変換する。
 *
 * ツールハンドラが返す McpResponse の structuredContent は Record<string, unknown> を期待するが、
 * Result 型は直接代入できない。このヘルパーでキャストを1箇所に集約し、各ツールファイルから
 * `as unknown as Record<string, unknown>` を排除する。
 */
export function toStructured(result: object): Record<string, unknown> {
	return result as Record<string, unknown>;
}
