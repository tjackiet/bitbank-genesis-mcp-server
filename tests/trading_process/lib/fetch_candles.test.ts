import { describe, expect, it } from 'vitest';
import { getPeriodBars } from '../../../tools/trading_process/lib/fetch_candles.js';

describe('getPeriodBars', () => {
	it('1D / 1M は 30 を返す', () => {
		expect(getPeriodBars('1D', '1M')).toBe(30);
	});

	it('1D / 3M は 90 を返す', () => {
		expect(getPeriodBars('1D', '3M')).toBe(90);
	});

	it('1D / 6M は 180 を返す', () => {
		expect(getPeriodBars('1D', '6M')).toBe(180);
	});

	it('4H / 1M は 180 を返す', () => {
		expect(getPeriodBars('4H', '1M')).toBe(180);
	});

	it('4H / 3M は 540 を返す', () => {
		expect(getPeriodBars('4H', '3M')).toBe(540);
	});

	it('1H / 6M は 4320 を返す', () => {
		expect(getPeriodBars('1H', '6M')).toBe(4320);
	});

	it('1H / 1M は 720 を返す', () => {
		expect(getPeriodBars('1H', '1M')).toBe(720);
	});
});
