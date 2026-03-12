import { describe, it, expect } from 'vitest';
import { buildDepthText, type BuildDepthTextInput } from '../get_depth.js';

function makeInput(overrides?: Partial<BuildDepthTextInput>): BuildDepthTextInput {
  return {
    timestamp: 1_700_000_000_000,
    summary: 'BTC/JPY 中値=5,000,050円 levels: bids=3 asks=2',
    bids: [['5000000', '0.3'], ['4999900', '0.5'], ['4999800', '1.0']],
    asks: [['5000100', '0.2'], ['5000200', '0.4']],
    mid: 5_000_050,
    ...overrides,
  };
}

describe('buildDepthText', () => {
  it('基本出力: タイムスタンプ・板層数・中値を含む', () => {
    const text = buildDepthText(makeInput());
    expect(text).toContain('📸');
    expect(text).toContain('買い 3層');
    expect(text).toContain('売り 2層');
    expect(text).toContain('中値: 5,000,050円');
  });

  it('買い板・売り板の各行が番号付きで出力される', () => {
    const text = buildDepthText(makeInput());
    expect(text).toContain('🟢 買い板 (全3層)');
    expect(text).toContain('1. 5,000,000円 0.3');
    expect(text).toContain('2. 4,999,900円 0.5');
    expect(text).toContain('3. 4,999,800円 1.0');
    expect(text).toContain('🔴 売り板 (全2層)');
    expect(text).toContain('1. 5,000,100円 0.2');
    expect(text).toContain('2. 5,000,200円 0.4');
  });

  it('mid が null の場合は中値行を出力しない', () => {
    const text = buildDepthText(makeInput({ mid: null }));
    expect(text).not.toContain('中値:');
  });

  it('空の板データの場合は0層と表示', () => {
    const text = buildDepthText(makeInput({ bids: [], asks: [] }));
    expect(text).toContain('買い 0層');
    expect(text).toContain('売り 0層');
    expect(text).toContain('🟢 買い板 (全0層)');
  });

  it('フッターに補完ツール情報を含む', () => {
    const text = buildDepthText(makeInput());
    expect(text).toContain('📌 含まれるもの:');
    expect(text).toContain('📌 含まれないもの:');
    expect(text).toContain('📌 補完ツール:');
    expect(text).toContain('get_orderbook');
  });

  it('summary テキストが出力に含まれる', () => {
    const text = buildDepthText(makeInput({ summary: 'CUSTOM_SUMMARY_TEXT' }));
    expect(text).toContain('CUSTOM_SUMMARY_TEXT');
  });
});
