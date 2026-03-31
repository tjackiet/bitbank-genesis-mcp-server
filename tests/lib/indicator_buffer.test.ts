import { describe, expect, it } from 'vitest';
import { getFetchCount } from '../../lib/indicator_buffer.js';

describe('getFetchCount', () => {
	it('インジケータ指定なしなら displayCount をそのまま返す', () => {
		expect(getFetchCount(100)).toBe(100);
	});

	it('空配列なら displayCount をそのまま返す', () => {
		expect(getFetchCount(100, [])).toBe(100);
	});

	it('SMA_5 の場合は period-1=4 をバッファとして加算', () => {
		expect(getFetchCount(100, ['SMA_5'])).toBe(104);
	});

	it('SMA_200 の場合は period-1=199 をバッファとして加算', () => {
		expect(getFetchCount(100, ['SMA_200'])).toBe(299);
	});

	it('複数インジケータの場合は最大 period を使う', () => {
		expect(getFetchCount(50, ['SMA_5', 'SMA_200', 'EMA_12'])).toBe(249);
	});

	it('BB_20 の period=20 → バッファ 19', () => {
		expect(getFetchCount(30, ['BB_20'])).toBe(49);
	});

	it('RSI_14 の period=15 → バッファ 14', () => {
		expect(getFetchCount(30, ['RSI_14'])).toBe(44);
	});

	it('STOCH の period=20 → バッファ 19', () => {
		expect(getFetchCount(30, ['STOCH'])).toBe(49);
	});

	it('ICHIMOKU の period=78 → バッファ 77', () => {
		expect(getFetchCount(50, ['ICHIMOKU'])).toBe(127);
	});

	it('EMA_200 と ICHIMOKU の場合は EMA_200(200) が最大', () => {
		expect(getFetchCount(50, ['EMA_200', 'ICHIMOKU'])).toBe(249);
	});

	it('displayCount が 0 でもバッファのみ返す', () => {
		expect(getFetchCount(0, ['SMA_20'])).toBe(19);
	});

	it('displayCount が 1 の最小ケース', () => {
		expect(getFetchCount(1, ['SMA_5'])).toBe(5);
	});
});
