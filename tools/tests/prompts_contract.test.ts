import { describe, expect, it } from 'vitest';
import { prompts } from '../../src/prompts.js';

const expectedPromptNames = [
  '🌅 おはようレポート',
  '💼 ポートフォリオ分析レポート',
  '🔰 BTCの価格を分析して',
  '🔰 ETHの価格を分析して',
  '🔰 今注目のコインは？',
  '中級：主要指標でBTCを分析して',
  '中級：BTCのフロー分析をして',
  '中級：BTCの板の状況を詳しく見て',
  '中級：BTCのパターン分析をして',
  '中級：BTCのサポレジを分析して',
];

describe('prompts contract', () => {
  it('MCP 公開対象は日本語名の 10 プロンプトに限定される', () => {
    expect(prompts).toHaveLength(10);
    expect(prompts.map((prompt) => prompt.name)).toEqual(expectedPromptNames);
  });

  it('公開プロンプトはすべて非 ASCII 名で description を持つ', () => {
    for (const prompt of prompts) {
      expect(/[^\x00-\x7F]/.test(prompt.name)).toBe(true);
      expect(prompt.description).toEqual(expect.any(String));
      expect(prompt.description.length).toBeGreaterThan(0);
    }
  });
});
