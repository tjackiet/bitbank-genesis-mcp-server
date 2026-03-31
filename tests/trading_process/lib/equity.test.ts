import { describe, expect, it } from 'vitest';
import { calculateEquityAndDrawdown } from '../../../tools/trading_process/lib/equity.js';
import type { Candle, Trade } from '../../../tools/trading_process/types.js';

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------
function makeCandles(times: string[], closes: number[]): Candle[] {
	return times.map((time, i) => ({
		time,
		open: closes[i],
		high: closes[i] + 5,
		low: closes[i] - 5,
		close: closes[i],
	}));
}

// ---------------------------------------------------------------------------
// calculateEquityAndDrawdown
// ---------------------------------------------------------------------------
describe('calculateEquityAndDrawdown', () => {
	it('トレードなしの場合はエクイティ0%、ドローダウン0%', () => {
		const candles = makeCandles(['t0', 't1', 't2'], [100, 105, 110]);
		const result = calculateEquityAndDrawdown([], candles);
		expect(result.equity_curve).toHaveLength(3);
		expect(result.drawdown_curve).toHaveLength(3);
		expect(result.max_drawdown).toBe(0);
		for (const e of result.equity_curve) {
			expect(e.equity_pct).toBe(0);
		}
		for (const d of result.drawdown_curve) {
			expect(d.drawdown_pct).toBe(0);
		}
	});

	it('1トレード（利益）でエクイティが増加する', () => {
		const candles = makeCandles(['t0', 't1', 't2', 't3'], [100, 100, 110, 110]);
		const trades: Trade[] = [
			{
				entry_time: 't1',
				entry_price: 100,
				exit_time: 't2',
				exit_price: 110,
				pnl_pct: 10,
				fee_pct: 0,
				net_return: 1.1,
			},
		];
		const result = calculateEquityAndDrawdown(trades, candles);
		// t2 で決済 → 確定エクイティ = 1.0 * 1.1 = 1.1 → 10%
		expect(result.equity_curve[2].equity_pct).toBeCloseTo(10, 1);
		// t3 以降はポジションなし → 確定エクイティを維持
		expect(result.equity_curve[3].equity_pct).toBeCloseTo(10, 1);
	});

	it('1トレード（損失）でエクイティが減少する', () => {
		const candles = makeCandles(['t0', 't1', 't2', 't3'], [100, 100, 90, 90]);
		const trades: Trade[] = [
			{
				entry_time: 't1',
				entry_price: 100,
				exit_time: 't2',
				exit_price: 90,
				pnl_pct: -10,
				fee_pct: 0,
				net_return: 0.9,
			},
		];
		const result = calculateEquityAndDrawdown(trades, candles);
		expect(result.equity_curve[2].equity_pct).toBeCloseTo(-10, 1);
		expect(result.max_drawdown).toBeGreaterThan(0);
	});

	it('ポジション保有中は含み損益を反映する', () => {
		const candles = makeCandles(['t0', 't1', 't2', 't3', 't4'], [100, 100, 120, 110, 110]);
		const trades: Trade[] = [
			{
				entry_time: 't1',
				entry_price: 100,
				exit_time: 't3',
				exit_price: 110,
				pnl_pct: 10,
				fee_pct: 0,
				net_return: 1.1,
			},
		];
		const result = calculateEquityAndDrawdown(trades, candles);
		// t2: 含み益 = (120/100 - 1) * 100 = 20%
		expect(result.equity_curve[2].equity_pct).toBeCloseTo(20, 1);
		// t3: 決済時 → net_return で確定 = 10%
		expect(result.equity_curve[3].equity_pct).toBeCloseTo(10, 1);
	});

	it('ドローダウンが正しく計算される', () => {
		const candles = makeCandles(['t0', 't1', 't2', 't3'], [100, 100, 120, 90]);
		const trades: Trade[] = [
			{
				entry_time: 't1',
				entry_price: 100,
				exit_time: 't3',
				exit_price: 90,
				pnl_pct: -10,
				fee_pct: 0,
				net_return: 0.9,
			},
		];
		const result = calculateEquityAndDrawdown(trades, candles);
		// t2 で含みピーク、t3 で下落 → ドローダウン > 0
		expect(result.max_drawdown).toBeGreaterThan(0);
		// ドローダウンは常に 0 以上
		for (const d of result.drawdown_curve) {
			expect(d.drawdown_pct).toBeGreaterThanOrEqual(0);
		}
	});

	it('複数トレードで複利計算が正しい', () => {
		const candles = makeCandles(['t0', 't1', 't2', 't3', 't4', 't5'], [100, 100, 110, 110, 121, 121]);
		const trades: Trade[] = [
			{
				entry_time: 't1',
				entry_price: 100,
				exit_time: 't2',
				exit_price: 110,
				pnl_pct: 10,
				fee_pct: 0,
				net_return: 1.1,
			},
			{
				entry_time: 't3',
				entry_price: 110,
				exit_time: 't4',
				exit_price: 121,
				pnl_pct: 10,
				fee_pct: 0,
				net_return: 1.1,
			},
		];
		const result = calculateEquityAndDrawdown(trades, candles);
		// 1.1 * 1.1 = 1.21 → 21%
		expect(result.equity_curve[4].equity_pct).toBeCloseTo(21, 1);
	});
});
