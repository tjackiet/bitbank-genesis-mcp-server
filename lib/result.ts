import type { OkResult, FailResult } from '../src/types/domain.d.ts';
import { getErrorMessage, isAbortError } from './error.js';

export function ok<T = Record<string, unknown>, M = Record<string, unknown>>(
	summary: string,
	data: T = {} as T,
	meta: M = {} as M
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
	meta: M = {} as M
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
	const {
		schema,
		timeoutMs,
		defaultType = 'internal',
		defaultMessage = 'internal error',
	} = opts;

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


