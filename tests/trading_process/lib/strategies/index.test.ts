import { describe, expect, it } from 'vitest';
import {
	getAvailableStrategies,
	getStrategy,
	getStrategyDefaults,
} from '../../../../tools/trading_process/lib/strategies/index.js';

describe('getAvailableStrategies', () => {
	it('4つの戦略タイプを返す', () => {
		const strategies = getAvailableStrategies();
		expect(strategies).toHaveLength(4);
		expect(strategies).toContain('sma_cross');
		expect(strategies).toContain('rsi');
		expect(strategies).toContain('macd_cross');
		expect(strategies).toContain('bb_breakout');
	});
});

describe('getStrategy', () => {
	it('sma_cross を取得できる', () => {
		const strategy = getStrategy('sma_cross');
		expect(strategy).toBeDefined();
		expect(strategy?.name).toBe('SMA Crossover');
	});

	it('rsi を取得できる', () => {
		const strategy = getStrategy('rsi');
		expect(strategy).toBeDefined();
		expect(strategy?.name).toBe('RSI');
	});

	it('bb_breakout を取得できる', () => {
		const strategy = getStrategy('bb_breakout');
		expect(strategy).toBeDefined();
		expect(strategy?.name).toBe('Bollinger Bands Breakout');
	});

	it('macd_cross を取得できる', () => {
		const strategy = getStrategy('macd_cross');
		expect(strategy).toBeDefined();
		expect(strategy?.name).toBe('MACD Crossover');
	});
});

describe('getStrategyDefaults', () => {
	it('sma_cross のデフォルトパラメータを返す', () => {
		const defaults = getStrategyDefaults('sma_cross');
		expect(defaults).toBeDefined();
		expect(defaults?.short).toBe(5);
		expect(defaults?.long).toBe(20);
	});

	it('rsi のデフォルトパラメータを返す', () => {
		const defaults = getStrategyDefaults('rsi');
		expect(defaults).toBeDefined();
		expect(defaults?.period).toBe(14);
	});

	it('bb_breakout のデフォルトパラメータを返す', () => {
		const defaults = getStrategyDefaults('bb_breakout');
		expect(defaults).toBeDefined();
		expect(defaults?.period).toBe(20);
		expect(defaults?.stddev).toBe(2);
	});
});

describe('Strategy.validate', () => {
	it('全戦略が validate を関数として持つ', () => {
		for (const type of getAvailableStrategies()) {
			const strategy = getStrategy(type);
			expect(strategy).toBeDefined();
			expect(typeof strategy?.validate).toBe('function');
		}
	});

	it('全戦略の validate(defaultParams) が valid:true / errors:[] / normalizedParams ⊇ defaultParams を返す', () => {
		for (const type of getAvailableStrategies()) {
			const strategy = getStrategy(type);
			if (!strategy) throw new Error(`strategy ${type} not registered`);
			const result = strategy.validate(strategy.defaultParams);
			expect(result.valid).toBe(true);
			expect(result.errors).toEqual([]);
			for (const [key, value] of Object.entries(strategy.defaultParams)) {
				expect(result.normalizedParams[key]).toBe(value);
			}
		}
	});

	it('全戦略の validate({}) は欠損キーをデフォルトで埋めた normalizedParams を返す', () => {
		for (const type of getAvailableStrategies()) {
			const strategy = getStrategy(type);
			if (!strategy) throw new Error(`strategy ${type} not registered`);
			const result = strategy.validate({});
			expect(result.valid).toBe(true);
			for (const [key, value] of Object.entries(strategy.defaultParams)) {
				expect(result.normalizedParams[key]).toBe(value);
			}
		}
	});
});
