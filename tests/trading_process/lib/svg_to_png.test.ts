import { describe, expect, it } from 'vitest';
import { generateBacktestChartFilename } from '../../../tools/trading_process/lib/svg_to_png.js';

describe('generateBacktestChartFilename', () => {
	it('正しいフォーマットのファイル名を生成する', () => {
		const filename = generateBacktestChartFilename('btc_jpy', '1D', 'sma_cross');
		expect(filename).toMatch(/^backtest_btcjpy_1D_sma_cross_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.png$/);
	});

	it('SVG フォーマットを指定できる', () => {
		const filename = generateBacktestChartFilename('eth_jpy', '4H', 'macd', 'svg');
		expect(filename).toMatch(/\.svg$/);
		expect(filename).toContain('ethjpy');
		expect(filename).toContain('4H');
		expect(filename).toContain('macd');
	});

	it('デフォルトは PNG', () => {
		const filename = generateBacktestChartFilename('btc_jpy', '1D', 'test');
		expect(filename).toMatch(/\.png$/);
	});

	it('ペア名のアンダースコアを除去する', () => {
		const filename = generateBacktestChartFilename('xrp_jpy', '1H', 'rsi');
		expect(filename).toContain('xrpjpy');
		expect(filename).not.toContain('xrp_jpy');
	});
});
