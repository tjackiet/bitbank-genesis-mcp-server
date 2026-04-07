/**
 * Chaos S-10: cancel_orders に 31件以上の order_id を渡す
 * 仮説: Zod スキーマがリジェクトする
 */

import { describe, expect, it } from 'vitest';
import { CancelOrdersInputSchema, PreviewCancelOrdersInputSchema } from '../../../src/private/schemas.js';

describe('Chaos: S-10 — cancel_orders に 31件以上の order_id を渡す', () => {
	/** 仮説: Zod スキーマの max(30) でリジェクトされる */

	it('31件の order_ids で PreviewCancelOrdersInputSchema がリジェクト', () => {
		const orderIds = Array.from({ length: 31 }, (_, i) => i + 1);
		const result = PreviewCancelOrdersInputSchema.safeParse({
			pair: 'btc_jpy',
			order_ids: orderIds,
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			const msg = result.error.issues[0].message;
			expect(msg).toBeDefined();
		}
	});

	it('31件の order_ids で CancelOrdersInputSchema がリジェクト', () => {
		const orderIds = Array.from({ length: 31 }, (_, i) => i + 1);
		const result = CancelOrdersInputSchema.safeParse({
			pair: 'btc_jpy',
			order_ids: orderIds,
			confirmation_token: 'some_token',
			token_expires_at: Date.now() + 60_000,
		});

		expect(result.success).toBe(false);
	});

	it('100件でもリジェクトされる', () => {
		const orderIds = Array.from({ length: 100 }, (_, i) => i + 1);
		const result = PreviewCancelOrdersInputSchema.safeParse({
			pair: 'btc_jpy',
			order_ids: orderIds,
		});

		expect(result.success).toBe(false);
	});

	it('0件（空配列）でもリジェクトされる', () => {
		const result = PreviewCancelOrdersInputSchema.safeParse({
			pair: 'btc_jpy',
			order_ids: [],
		});

		expect(result.success).toBe(false);
	});

	it('正常系: 30件（上限ちょうど）は通過する', () => {
		const orderIds = Array.from({ length: 30 }, (_, i) => i + 1);
		const result = PreviewCancelOrdersInputSchema.safeParse({
			pair: 'btc_jpy',
			order_ids: orderIds,
		});

		expect(result.success).toBe(true);
	});

	it('正常系: 1件（下限ちょうど）は通過する', () => {
		const result = PreviewCancelOrdersInputSchema.safeParse({
			pair: 'btc_jpy',
			order_ids: [12345],
		});

		expect(result.success).toBe(true);
	});
});
