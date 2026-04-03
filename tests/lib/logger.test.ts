import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub fs before importing logger
vi.mock('node:fs', async () => {
	const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
	return {
		...actual,
		default: { ...actual, appendFileSync: vi.fn(), existsSync: vi.fn(() => true), mkdirSync: vi.fn() },
	};
});

const { logToolRun, logError } = await import('../../lib/logger.js');

describe('logger sensitive field masking', () => {
	beforeEach(() => {
		vi.mocked(fs.appendFileSync).mockClear();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('masks confirmation_token in logToolRun input', () => {
		logToolRun({
			tool: 'create_order',
			input: { pair: 'btc_jpy', confirmation_token: 'secret-hmac-value', token_expires_at: 999 },
			result: { ok: true, summary: 'done' },
			ms: 10,
		});

		const call = vi.mocked(fs.appendFileSync).mock.calls[0];
		expect(call).toBeDefined();
		const logged = JSON.parse(call[1] as string);
		expect(logged.input.confirmation_token).toBe('***');
		expect(logged.input.pair).toBe('btc_jpy');
		expect(logged.input.token_expires_at).toBe(999);
	});

	it('masks confirmation_token in logError input', () => {
		logError('cancel_order', new Error('boom'), {
			pair: 'eth_jpy',
			confirmation_token: 'another-secret',
		});

		const call = vi.mocked(fs.appendFileSync).mock.calls[0];
		expect(call).toBeDefined();
		const logged = JSON.parse(call[1] as string);
		expect(logged.input.confirmation_token).toBe('***');
		expect(logged.input.pair).toBe('eth_jpy');
	});

	it('masks token field in nested objects', () => {
		logToolRun({
			tool: 'test_tool',
			input: { nested: { token: 'should-be-masked' }, safe: 'visible' },
			result: { ok: true },
			ms: 5,
		});

		const call = vi.mocked(fs.appendFileSync).mock.calls[0];
		const logged = JSON.parse(call[1] as string);
		expect(logged.input.nested.token).toBe('***');
		expect(logged.input.safe).toBe('visible');
	});

	it('handles null/undefined input gracefully', () => {
		expect(() => logToolRun({ tool: 't', input: null, result: null, ms: 0 })).not.toThrow();
		expect(() => logError('t', new Error('e'), undefined)).not.toThrow();
	});
});
