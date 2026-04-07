/**
 * Chaos A-05: bitbank API が success: 0 + エラーコード 10007（メンテナンス）
 * 仮説: upstream_error で「メンテナンス中」メッセージを返す
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BitbankPrivateClient } from '../../../src/private/client.js';
import { createMockFetcher, jsonResponse, mockBitbankError } from '../../fixtures/private-api.js';

describe('Chaos: A-05 — bitbank API がメンテナンス中', () => {
	/** 仮説: エラーコード 10007 で「メンテナンス中」メッセージを返す */

	afterEach(() => {
		delete process.env.BITBANK_API_KEY;
		delete process.env.BITBANK_API_SECRET;
		vi.restoreAllMocks();
	});

	it('エラーコード 10007 → メンテナンス中メッセージ', async () => {
		process.env.BITBANK_API_KEY = 'test_key';
		process.env.BITBANK_API_SECRET = 'test_secret';

		const fetcher = createMockFetcher([jsonResponse(mockBitbankError(10007))]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as Error & { errorType?: string; bitbankCode?: number };
			expect(e.message).toContain('メンテナンス');
			expect(e.errorType).toBe('upstream_error');
			expect(e.bitbankCode).toBe(10007);
		}
	});

	it('エラーコード 10008 → 過負荷メッセージ', async () => {
		process.env.BITBANK_API_KEY = 'test_key';
		process.env.BITBANK_API_SECRET = 'test_secret';

		const fetcher = createMockFetcher([jsonResponse(mockBitbankError(10008))]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 0 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch (err) {
			const e = err as Error & { errorType?: string; bitbankCode?: number };
			expect(e.message).toContain('過負荷');
			expect(e.errorType).toBe('upstream_error');
			expect(e.bitbankCode).toBe(10008);
		}
	});

	it('メンテナンスエラーはリトライされない（即座に失敗）', async () => {
		process.env.BITBANK_API_KEY = 'test_key';
		process.env.BITBANK_API_SECRET = 'test_secret';

		const fetcher = createMockFetcher([jsonResponse(mockBitbankError(10007))]);
		const client = new BitbankPrivateClient({ fetcher, maxRetries: 2 });

		try {
			await client.get('/v1/user/assets');
			expect.fail('should throw');
		} catch {
			// メンテナンスは 1 回のリクエストで即座に失敗
			expect(fetcher.calls.length).toBe(1);
		}
	});
});
