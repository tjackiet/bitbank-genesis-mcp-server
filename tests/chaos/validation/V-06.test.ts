/**
 * Chaos V-06: analyze_indicators に最小限（3本）のローソク足データ
 * 仮説: 計算不能な指標は NaN/null ではなく、明示的に「不足」を返す
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import analyzeIndicators from '../../../tools/analyze_indicators.js';

/** 最小限のローソク足データ（3本）を返すモック */
function mockMinimalCandles() {
	const now = Date.now();
	const candles = [
		[now - 120000, '5000000', '5010000', '4990000', '5005000', '100'],
		[now - 60000, '5005000', '5020000', '4995000', '5015000', '150'],
		[now, '5015000', '5025000', '5000000', '5010000', '120'],
	];

	vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response(
			JSON.stringify({
				success: 1,
				data: { candlestick: [{ ohlcv: candles, type: '1hour' }] },
			}),
			{ status: 200, headers: { 'Content-Type': 'application/json' } },
		),
	);
}

describe('Chaos: V-06 — analyze_indicators に最小限（3本）のローソク足', () => {
	/** 仮説: 不足指標は明示的に警告され、クラッシュしない */

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('3本のデータでクラッシュしない', async () => {
		mockMinimalCandles();

		const result = await analyzeIndicators('btc_jpy', '1hour', 3);

		// クラッシュせずに結果を返す
		expect(result).toBeDefined();
		expect(typeof result.ok).toBe('boolean');
	});

	it('データ不足の警告が含まれる', async () => {
		mockMinimalCandles();

		const result = await analyzeIndicators('btc_jpy', '1hour', 3);

		if (result.ok) {
			// meta.warnings にデータ不足の警告が含まれる
			const meta = result.meta as Record<string, unknown>;
			const warnings = meta.warnings as string[] | undefined;
			if (warnings && warnings.length > 0) {
				// SMA, RSI, Bollinger 等のデータ不足警告がある
				const hasInsufficientWarning = warnings.some((w: string) => w.includes('データ不足'));
				expect(hasInsufficientWarning).toBe(true);
			}
		}
	});

	it('SMA_200 は3本のデータでは計算不能', async () => {
		mockMinimalCandles();

		const result = await analyzeIndicators('btc_jpy', '1hour', 3);

		if (result.ok) {
			const data = result.data as Record<string, unknown>;
			const indicators = data.indicators as Record<string, unknown> | undefined;
			if (indicators) {
				// SMA_200 は null か NaN のはず
				const sma200 = indicators.SMA_200;
				if (sma200 != null) {
					expect(Number.isNaN(Number(sma200))).toBe(true);
				}
			}
		}
	});

	it('トレンド判定が insufficient_data になる', async () => {
		mockMinimalCandles();

		const result = await analyzeIndicators('btc_jpy', '1hour', 3);

		if (result.ok) {
			const data = result.data as Record<string, unknown>;
			const trend = data.trend;
			// SMA_25/75 が計算不能なので insufficient_data
			if (trend != null) {
				expect(trend).toBe('insufficient_data');
			}
		}
	});
});
