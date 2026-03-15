// Hand-written type declarations for the corresponding .ts module.
import type { OkResult, FailResult } from '../src/schemas.js';

export function ok<T = Record<string, unknown>, M = Record<string, unknown>>(
	summary: string,
	data?: T,
	meta?: M,
): OkResult<T, M>;

export function fail<M = Record<string, unknown>>(message: string, type?: string, meta?: M): FailResult<M>;

export function parseAsResult<T, M>(
	schema: { parse: (v: unknown) => unknown },
	value: unknown,
): OkResult<T, M> | FailResult;
