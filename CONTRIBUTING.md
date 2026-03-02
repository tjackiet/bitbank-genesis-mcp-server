## Contributing

開発者向けの最小ルールです。詳細は `src/schemas.ts` を単一ソースに保つ点だけ覚えておけばOKです。

### 開発フロー
1. `src/schemas.ts` を更新（入力・出力ともに Zod を単一ソース化）
2. 型生成: `npm run gen:types`
3. 実装更新: ツール/サーバーの戻りを OutputSchema で検証
4. 型チェック: `npm run typecheck`

### PR 前チェック
```bash
npm run gen:types
npm run typecheck
```


