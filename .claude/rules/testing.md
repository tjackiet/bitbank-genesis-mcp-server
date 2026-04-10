---
globs: tests/**/*.test.ts
---

# テスト作成ガイド

## エッジケースの優先順位（迷ったらこの順）

1. 空配列
2. `null` / 欠損値
3. 重複入力
4. 単一要素
5. 最小値 / 最大値 / off-by-one

## テスト観点

- 入力バリデーション（Zod スキーマ）
- `ok` / `fail` の分岐
- API 異常系（ネットワークエラー、レスポンス不正）
- エッジケース（上記の優先順位に従う）

## モック規約

`fetch` モックは `globalThis.fetch` を直接差し替える。`vi.spyOn` は使わない。

```ts
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

it('ネットワークエラー', async () => {
  globalThis.fetch = vi.fn().mockRejectedValue(
    new TypeError('fetch failed'),
  ) as unknown as typeof fetch;
  // ...
});
```

内部ツール呼び出しのモックは `vi.mock` を優先する:

```ts
vi.mock('../xxx.js', () => ({ default: vi.fn() }));
```
