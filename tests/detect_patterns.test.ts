import { afterEach, describe, expect, it, vi } from 'vitest';
import { asMockResult } from './_assertResult.js';

vi.mock('../tools/detect_patterns.js', () => ({
	default: vi.fn(),
}));

import { toolDef } from '../src/handlers/detectPatternsHandler.js';
import detectPatterns from '../tools/detect_patterns.js';

function okResult(overrides: Record<string, unknown> = {}) {
	return {
		ok: true,
		summary: 'ok',
		data: {
			patterns: [],
			overlays: { ranges: [] },
			warnings: [],
			statistics: {},
		},
		meta: {
			pair: 'btc_jpy',
			type: '1day',
			count: 0,
			visualization_hints: { preferred_style: 'line', highlight_patterns: [] },
			debug: { swings: [], candidates: [] },
		},
		...overrides,
	};
}

describe('detect_patterns handler', () => {
	const mockedDetectPatterns = vi.mocked(detectPatterns);

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('データ不足時は generic な tolerance 調整ではなく insufficient data をそのまま案内するべき', async () => {
		mockedDetectPatterns.mockResolvedValueOnce(
			okResult({
				summary: 'insufficient data',
				data: {
					patterns: [],
					overlays: { ranges: [] },
					warnings: [],
					statistics: {},
				},
				meta: {
					pair: 'btc_jpy',
					type: '1day',
					count: 0,
					visualization_hints: { preferred_style: 'line', highlight_patterns: [] },
					debug: { swings: [], candidates: [] },
				},
			}) as any,
		);

		const res = await toolDef.handler({
			pair: 'btc_jpy',
			type: '1day',
			limit: 20,
			view: 'detailed',
		});

		const text = res.content[0].text as string;
		expect(text).toContain('insufficient data');
		expect(text).not.toContain('tolerance を 0.03-0.06 に緩和してください');
	});

	it('summary view で includeForming=true のときは includeForming を再指定する案内を出すべきではない', async () => {
		mockedDetectPatterns.mockResolvedValueOnce(
			okResult({
				data: {
					patterns: [
						{
							type: 'triangle_symmetrical',
							confidence: 0.82,
							timeframe: '1day',
							timeframeLabel: '日足',
							range: {
								start: '2026-01-01T00:00:00.000Z',
								end: '2026-01-10T00:00:00.000Z',
							},
							status: 'forming',
						},
					],
					overlays: {
						ranges: [
							{
								start: '2026-01-01T00:00:00.000Z',
								end: '2026-01-10T00:00:00.000Z',
								label: 'triangle_symmetrical',
							},
						],
					},
					warnings: [],
					statistics: {},
				},
				meta: {
					pair: 'btc_jpy',
					type: '1day',
					count: 1,
					visualization_hints: { preferred_style: 'line', highlight_patterns: ['triangle_symmetrical'] },
					debug: { swings: [], candidates: [] },
				},
			}) as any,
		);

		const res = await toolDef.handler({
			pair: 'btc_jpy',
			type: '1day',
			limit: 90,
			view: 'summary',
			includeForming: true,
		});

		const text = res.content[0].text as string;
		expect(text).not.toContain('※形成中は includeForming=true を指定してください。');
	});

	it('debug view でも warnings と statistics を structuredContent.data に保持するべき', async () => {
		const warnings = [
			{
				type: 'low_detection_count',
				message: '検出数が少ないです',
				suggestedParams: { tolerancePct: 0.03 },
			},
		];
		const statistics = {
			triangle_symmetrical: {
				detected: 1,
				withAftermath: 1,
				successRate: 0.5,
				avgReturn7d: 0.02,
				avgReturn14d: 0.04,
				medianReturn7d: 0.01,
			},
		};

		mockedDetectPatterns.mockResolvedValueOnce(
			okResult({
				data: {
					patterns: [
						{
							type: 'triangle_symmetrical',
							confidence: 0.82,
							timeframe: '1day',
							timeframeLabel: '日足',
							range: {
								start: '2026-01-01T00:00:00.000Z',
								end: '2026-01-10T00:00:00.000Z',
							},
							status: 'completed',
						},
					],
					overlays: {
						ranges: [
							{
								start: '2026-01-01T00:00:00.000Z',
								end: '2026-01-10T00:00:00.000Z',
								label: 'triangle_symmetrical',
							},
						],
					},
					warnings,
					statistics,
				},
				meta: {
					pair: 'btc_jpy',
					type: '1day',
					count: 1,
					visualization_hints: { preferred_style: 'line', highlight_patterns: ['triangle_symmetrical'] },
					debug: {
						swings: [{ idx: 1, price: 100, kind: 'H', isoTime: '2026-01-02T00:00:00.000Z' }],
						candidates: [{ type: 'triangle_symmetrical', accepted: true }],
					},
				},
			}) as any,
		);

		const res = await toolDef.handler({
			pair: 'btc_jpy',
			type: '1day',
			limit: 90,
			view: 'debug',
		});

		expect(res.structuredContent.data.warnings).toEqual(warnings);
		expect(res.structuredContent.data.statistics).toEqual(statistics);
	});
});
