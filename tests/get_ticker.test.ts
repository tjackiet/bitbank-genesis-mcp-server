import { afterEach, describe, expect, it, vi } from 'vitest';
import getTicker from '../tools/get_ticker.js';
import { asMockResult, assertFail } from './_assertResult.js';

describe('getTicker', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('未対応pairはバリデーションエラーを返す', async () => {
		const res = await getTicker('unknown_jpy');
		assertFail(res);
		expect(res.meta?.errorType).toBe('user');
	});

	it('上流レスポンスが不正な場合は ok:false を返すべき', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			asMockResult<Response>({
				ok: true,
				status: 200,
				statusText: 'OK',
				json: async () => ({ success: 1 }),
			}),
		);

		const res = await getTicker('btc_jpy', { timeoutMs: 100 });
		assertFail(res);
		expect(res.meta?.errorType).toBe('upstream');
	});
});
