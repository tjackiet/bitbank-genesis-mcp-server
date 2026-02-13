import { describe, it, expect } from 'vitest';
import {
  formatPair,
  formatPrice,
  formatPriceJPY,
  formatCurrency,
  formatCurrencyShort,
  formatPercent,
  formatVolumeJPY,
  formatSummary,
} from './formatter.js';

describe('formatPair', () => {
  it('アンダースコアをスラッシュに変換し大文字化する', () => {
    expect(formatPair('btc_jpy')).toBe('BTC/JPY');
  });
  it('空文字は空文字を返す（アンダースコアなし）', () => {
    expect(formatPair('')).toBe('');
  });
});

describe('formatPrice', () => {
  it('JPY ペアは ¥ プレフィックス付きで返す', () => {
    const result = formatPrice(100000, 'btc_jpy');
    expect(result).toContain('¥');
    expect(result).toContain('100,000');
  });
  it('非 JPY ペアは ¥ なしで返す', () => {
    const result = formatPrice(0.05, 'eth_btc');
    expect(result).not.toContain('¥');
  });
  it('pair 省略時は JPY として扱う', () => {
    const result = formatPrice(50000);
    expect(result).toContain('¥');
  });
  it('null/undefined は N/A を返す', () => {
    expect(formatPrice(null)).toBe('N/A');
    expect(formatPrice(undefined)).toBe('N/A');
  });
  it('Infinity は N/A を返す', () => {
    expect(formatPrice(Infinity)).toBe('N/A');
  });
});

describe('formatPriceJPY', () => {
  it('円サフィックス付きで四捨五入する', () => {
    expect(formatPriceJPY(123456.7)).toBe('123,457円');
  });
  it('null は n/a を返す', () => {
    expect(formatPriceJPY(null)).toBe('n/a');
  });
});

describe('formatCurrency', () => {
  it('JPY ペアは JPY サフィックス付きで返す', () => {
    const result = formatCurrency(50000, 'btc_jpy');
    expect(result).toContain('JPY');
  });
  it('非 JPY ペアは小数2桁で返す', () => {
    expect(formatCurrency(0.123, 'eth_btc')).toBe('0.12');
  });
  it('null は n/a を返す', () => {
    expect(formatCurrency(null)).toBe('n/a');
  });
});

describe('formatCurrencyShort', () => {
  it('1000以上の JPY は k 表記する', () => {
    expect(formatCurrencyShort(12000, 'btc_jpy')).toBe('12k JPY');
  });
  it('1000未満の JPY はそのまま表示する', () => {
    const result = formatCurrencyShort(500, 'btc_jpy');
    expect(result).toContain('500');
    expect(result).toContain('JPY');
  });
  it('null は n/a を返す', () => {
    expect(formatCurrencyShort(null)).toBe('n/a');
  });
});

describe('formatPercent', () => {
  it('デフォルトは小数1桁の % 表記', () => {
    expect(formatPercent(1.5)).toBe('1.5%');
  });
  it('sign: true で正数に + を付ける', () => {
    expect(formatPercent(1.5, { sign: true })).toBe('+1.5%');
  });
  it('負数は + なし', () => {
    expect(formatPercent(-2.3, { sign: true })).toBe('-2.3%');
  });
  it('multiply: true で 100 倍する', () => {
    expect(formatPercent(0.05, { multiply: true })).toBe('5.0%');
  });
  it('digits で小数桁数を変更できる', () => {
    expect(formatPercent(1.234, { digits: 2 })).toBe('1.23%');
  });
  it('null は n/a を返す', () => {
    expect(formatPercent(null)).toBe('n/a');
  });
});

describe('formatVolumeJPY', () => {
  it('1億以上は億円表記', () => {
    expect(formatVolumeJPY(100_000_000)).toBe('1.0億円');
    expect(formatVolumeJPY(250_000_000)).toBe('2.5億円');
  });
  it('1億未満は万円表記', () => {
    expect(formatVolumeJPY(50_000_000)).toBe('5000万円');
  });
  it('null は n/a を返す', () => {
    expect(formatVolumeJPY(null)).toBe('n/a');
  });
});

describe('formatSummary', () => {
  it('pair のみで基本サマリーを生成する', () => {
    const result = formatSummary({ pair: 'btc_jpy' });
    expect(result).toContain('BTC/JPY');
  });
  it('totalItems 指定でローソク足取得サマリーを生成する', () => {
    const result = formatSummary({ pair: 'btc_jpy', timeframe: '1day', totalItems: 30 });
    expect(result).toContain('ローソク足30本取得');
    expect(result).toContain('1day');
  });
  it('latest 指定で中値を表示する', () => {
    const result = formatSummary({ pair: 'btc_jpy', latest: 15000000 });
    expect(result).toContain('中値=');
  });
  it('extra を末尾に追加する', () => {
    const result = formatSummary({ pair: 'btc_jpy', extra: '追加情報' });
    expect(result).toContain('追加情報');
  });
});
