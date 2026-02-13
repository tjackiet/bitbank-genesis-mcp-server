import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // テストファイルのパターン
    include: ['lib/**/*.test.ts', 'tools/**/*.test.ts'],
    // タイムアウト（ネットワーク系テストがある場合を考慮）
    testTimeout: 10_000,
    // ESM 対応
    pool: 'forks',
  },
});
