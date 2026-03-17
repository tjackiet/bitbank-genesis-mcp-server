import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // テストファイルのパターン
    include: ['tests/**/*.test.ts'],
    // タイムアウト（ネットワーク系テストがある場合を考慮）
    testTimeout: 10_000,
    // ESM 対応
    pool: 'forks',
    // カバレッジ設定
    coverage: {
      provider: 'v8',
      // CI でカバレッジ低下を検出するための閾値（現状ベースライン基準）
      thresholds: {
        statements: 50,
        branches: 35,
        functions: 50,
        lines: 50,
      },
    },
  },
});
