import { describe, expect, it } from 'vitest';
import { prompts } from '../../src/prompts.js';
import { isPrivateApiEnabled } from '../../src/private/config.js';

/** Private API 不要のプロンプト（常に公開） */
const publicPromptNames = [
  '🌅 おはようレポート',
  '🔰 BTCの価格を分析して',
  '🔰 ETHの価格を分析して',
  '🔰 今注目のコインは？',
  '中級：主要指標でBTCを分析して',
  '中級：BTCのフロー分析をして',
  '中級：BTCの板の状況を詳しく見て',
  '中級：BTCのパターン分析をして',
  '中級：BTCのサポレジを分析して',
];

/** Private API 必須のプロンプト（API キー設定時のみ公開） */
const privatePromptNames = [
  '💼 ポートフォリオ分析レポート',
];

const expectedPromptNames = isPrivateApiEnabled()
  ? [
      '🌅 おはようレポート',
      '💼 ポートフォリオ分析レポート',
      ...publicPromptNames.slice(1),
    ]
  : publicPromptNames;

describe('prompts contract', () => {
  it(`MCP 公開対象は日本語名の ${expectedPromptNames.length} プロンプトに限定される（Private API ${isPrivateApiEnabled() ? '有効' : '無効'}）`, () => {
    expect(prompts).toHaveLength(expectedPromptNames.length);
    expect(prompts.map((prompt) => prompt.name)).toEqual(expectedPromptNames);
  });

  it('Private API 無効時はポートフォリオ Prompt が含まれない', () => {
    const names = prompts.map((p) => p.name);
    if (isPrivateApiEnabled()) {
      for (const name of privatePromptNames) {
        expect(names).toContain(name);
      }
    } else {
      for (const name of privatePromptNames) {
        expect(names).not.toContain(name);
      }
    }
  });

  it('公開プロンプトはすべて非 ASCII 名で description を持つ', () => {
    for (const prompt of prompts) {
      expect(/[^\x00-\x7F]/.test(prompt.name)).toBe(true);
      expect(prompt.description).toEqual(expect.any(String));
      expect(prompt.description.length).toBeGreaterThan(0);
    }
  });
});
