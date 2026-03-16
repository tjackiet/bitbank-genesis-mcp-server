import { describe, expect, it } from 'vitest';
import {
	buildTickersJpyItemsText,
	buildTickersJpyRankedText,
	type NormalizedTicker,
} from '../src/handlers/getTickersJpyHandler.js';

function makeTicker(pair: string, overrides?: Partial<NormalizedTicker>): NormalizedTicker {
	return {
		pair,
		lastN: 5_000_000,
		openN: 4_900_000,
		highN: 5_100_000,
		lowN: 4_800_000,
		buyN: 4_999_000,
		sellN: 5_001_000,
		changeN: 2.04,
		volN: 100,
		volumeInJPY: 500_000_000,
		...overrides,
	};
}

describe('buildTickersJpyRankedText', () => {
	it('ヘッダーにペア総数・ソート条件・表示数を含む', () => {
		const text = buildTickersJpyRankedText(20, [makeTicker('btc_jpy')], 'change24h', 'desc', 5);
		expect(text).toContain('全20ペア取得');
		expect(text).toContain('sortBy=change24h');
		expect(text).toContain('desc');
		expect(text).toContain('top5');
	});

	it('ランキング行に番号・ペア名・変化率・価格・出来高を含む', () => {
		const text = buildTickersJpyRankedText(
			10,
			[makeTicker('btc_jpy', { changeN: 2.04, lastN: 5_000_000, volumeInJPY: 500_000_000 })],
			'change24h',
			'desc',
			5,
		);
		expect(text).toContain('1. BTC/JPY');
		expect(text).toContain('+2.04%');
		expect(text).toContain('出来高');
	});

	it('changeN が負の場合はマイナス符号が付く', () => {
		const text = buildTickersJpyRankedText(10, [makeTicker('eth_jpy', { changeN: -3.5 })], 'change24h', 'desc', 5);
		expect(text).toContain('-3.50%');
	});

	it('changeN が null の場合は n/a', () => {
		const text = buildTickersJpyRankedText(10, [makeTicker('xrp_jpy', { changeN: null })], 'change24h', 'desc', 5);
		expect(text).toContain('n/a');
	});

	it('複数ペアの番号が正しく振られる', () => {
		const text = buildTickersJpyRankedText(
			10,
			[makeTicker('btc_jpy'), makeTicker('eth_jpy'), makeTicker('xrp_jpy')],
			'change24h',
			'desc',
			3,
		);
		expect(text).toContain('1. BTC/JPY');
		expect(text).toContain('2. ETH/JPY');
		expect(text).toContain('3. XRP/JPY');
	});
});

describe('buildTickersJpyItemsText', () => {
	it('ペア総数を含む', () => {
		const text = buildTickersJpyItemsText([makeTicker('btc_jpy')]);
		expect(text).toContain('全1ペア取得');
	});

	it('5件以内なら全て表示し「他Nペア」を表示しない', () => {
		const items = Array.from({ length: 3 }, (_, i) => makeTicker(`pair${i}_jpy`));
		const text = buildTickersJpyItemsText(items);
		expect(text).not.toContain('他');
	});

	it('6件以上なら上位5件 + 「他Nペア」を表示', () => {
		const items = Array.from({ length: 8 }, (_, i) => makeTicker(`pair${i}_jpy`));
		const text = buildTickersJpyItemsText(items);
		expect(text).toContain('他3ペア');
	});

	it('各行にペア名・価格・変化率・出来高を含む', () => {
		const text = buildTickersJpyItemsText([
			makeTicker('btc_jpy', { lastN: 5_000_000, changeN: 1.5, volumeInJPY: 100_000_000 }),
		]);
		expect(text).toContain('BTC/JPY');
		expect(text).toContain('+1.50%');
		expect(text).toContain('出来高');
	});

	it('lastN が null の場合は N/A', () => {
		const text = buildTickersJpyItemsText([makeTicker('btc_jpy', { lastN: null })]);
		expect(text).toContain('N/A');
	});
});
