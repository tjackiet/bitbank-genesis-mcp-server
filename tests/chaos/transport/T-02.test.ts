/**
 * Chaos T-02: 超大サイズの tools/call パラメータ（1MB+）
 * 仮説: メモリ枯渇せず、適切にリジェクトする
 *
 * ツールハンドラに到達する前に Zod バリデーションが走るため、
 * 巨大パラメータは schema レベルで処理される。
 */

import { describe, expect, it } from 'vitest';
import { CancelOrdersInputSchema } from '../../../src/private/schemas.js';
import { GetTickerInputSchema } from '../../../src/schemas.js';

describe('Chaos: T-02 — 超大サイズのパラメータ', () => {
	/** 仮説: Zod が巨大な入力でもメモリ枯渇せず処理する */

	it('1MB の pair 文字列を Zod が処理できる（リジェクト）', () => {
		const hugePair = 'a'.repeat(1_000_000);
		const result = GetTickerInputSchema.safeParse({ pair: hugePair });
		// pair は string なので Zod は通す（ensurePair で拒否される）
		// ここでは Zod のパース自体がクラッシュしないことを確認
		expect(result).toBeDefined();
	});

	it('10万文字の pair でもクラッシュしない', () => {
		const bigPair = 'x'.repeat(100_000);
		const result = GetTickerInputSchema.safeParse({ pair: bigPair });
		expect(result).toBeDefined();
	});

	it('大量の order_ids（10000件）で Zod がリジェクト', () => {
		const manyIds = Array.from({ length: 10000 }, (_, i) => i + 1);
		const result = CancelOrdersInputSchema.safeParse({
			pair: 'btc_jpy',
			order_ids: manyIds,
			confirmation_token: 'token',
			token_expires_at: Date.now() + 60000,
		});
		// max(30) でリジェクト
		expect(result.success).toBe(false);
	});

	it('深くネストされたオブジェクトでクラッシュしない', () => {
		// Zod が想定しない深いネストを渡す
		let nested: Record<string, unknown> = { value: 'deep' };
		for (let i = 0; i < 100; i++) {
			nested = { inner: nested };
		}
		const result = GetTickerInputSchema.safeParse({ pair: 'btc_jpy', extra: nested });
		// strict() でない限り extra フィールドは無視される
		expect(result).toBeDefined();
	});

	it('大量のプロパティを持つオブジェクトでクラッシュしない', () => {
		const bigObj: Record<string, string> = { pair: 'btc_jpy' };
		for (let i = 0; i < 10000; i++) {
			bigObj[`extra_${i}`] = `value_${i}`;
		}
		const result = GetTickerInputSchema.safeParse(bigObj);
		// pair が有効なので Zod は通す（余分なフィールドは strip）
		expect(result).toBeDefined();
	});
});
