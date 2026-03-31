import { describe, expect, it } from 'vitest';
import {
	ChartIndicatorGroupEnum,
	ChartMetaSchema,
	ChartStatsSchema,
	PrepareChartDataInputSchema,
	RenderChartSvgIndicatorEnum,
	RenderChartSvgInputSchema,
} from '../../src/schema/chart.js';

describe('ChartMetaSchema', () => {
	it('有効なメタを受け入れる', () => {
		const result = ChartMetaSchema.parse({ pastBuffer: 26, shift: 26 });
		expect(result.pastBuffer).toBe(26);
	});

	it('空オブジェクトを受け入れる（全 optional）', () => {
		expect(ChartMetaSchema.parse({})).toEqual({});
	});
});

describe('ChartStatsSchema', () => {
	it('有効な統計を受け入れる', () => {
		const result = ChartStatsSchema.parse({ min: 90, max: 110, avg: 100, volume_avg: 500 });
		expect(result.min).toBe(90);
		expect(result.volume_avg).toBe(500);
	});

	it('必須フィールドが欠けると拒否する', () => {
		expect(() => ChartStatsSchema.parse({ min: 90, max: 110 })).toThrow();
	});
});

describe('ChartIndicatorGroupEnum', () => {
	it('全グループを受け入れる', () => {
		const groups = [
			'SMA_5',
			'SMA_20',
			'SMA_25',
			'SMA_50',
			'SMA_75',
			'SMA_200',
			'EMA_12',
			'EMA_26',
			'EMA_50',
			'EMA_200',
			'BB',
			'ICHIMOKU',
			'RSI',
			'MACD',
			'STOCH',
		];
		for (const g of groups) {
			expect(ChartIndicatorGroupEnum.parse(g)).toBe(g);
		}
	});
});

describe('RenderChartSvgIndicatorEnum', () => {
	it('BB_EXTENDED や ICHIMOKU_EXTENDED を含む', () => {
		expect(RenderChartSvgIndicatorEnum.parse('BB_EXTENDED')).toBe('BB_EXTENDED');
		expect(RenderChartSvgIndicatorEnum.parse('ICHIMOKU_EXTENDED')).toBe('ICHIMOKU_EXTENDED');
	});
});

describe('PrepareChartDataInputSchema', () => {
	it('デフォルト値を適用する', () => {
		const result = PrepareChartDataInputSchema.parse({});
		expect(result.pair).toBe('btc_jpy');
		expect(result.type).toBe('1day');
		expect(result.limit).toBe(30);
		expect(result.tz).toBe('Asia/Tokyo');
	});

	it('indicators を受け入れる', () => {
		const result = PrepareChartDataInputSchema.parse({ indicators: ['SMA_20', 'BB', 'RSI'] });
		expect(result.indicators).toEqual(['SMA_20', 'BB', 'RSI']);
	});

	it('limit 範囲外を拒否する', () => {
		expect(() => PrepareChartDataInputSchema.parse({ limit: 4 })).toThrow();
		expect(() => PrepareChartDataInputSchema.parse({ limit: 501 })).toThrow();
	});
});

describe('RenderChartSvgInputSchema', () => {
	it('デフォルト値を適用する', () => {
		const result = RenderChartSvgInputSchema.parse({});
		expect(result.pair).toBe('btc_jpy');
		expect(result.type).toBe('1day');
		expect(result.limit).toBe(60);
		expect(result.style).toBe('candles');
		expect(result.indicators).toEqual([]);
		expect(result.svgMinify).toBe(true);
	});

	it('ICHIMOKU と SMA の同時指定を拒否する', () => {
		const result = RenderChartSvgInputSchema.safeParse({
			indicators: ['ICHIMOKU', 'SMA_20'],
		});
		expect(result.success).toBe(false);
	});

	it('ICHIMOKU と BB の同時指定を拒否する', () => {
		const result = RenderChartSvgInputSchema.safeParse({
			indicators: ['ICHIMOKU', 'BB'],
		});
		expect(result.success).toBe(false);
	});

	it('SMA と BB の同時指定は許可する', () => {
		const result = RenderChartSvgInputSchema.safeParse({
			indicators: ['SMA_20', 'BB'],
		});
		expect(result.success).toBe(true);
	});

	it('subPanels を受け入れる', () => {
		const result = RenderChartSvgInputSchema.parse({ subPanels: ['macd', 'rsi'] });
		expect(result.subPanels).toEqual(['macd', 'rsi']);
	});
});
