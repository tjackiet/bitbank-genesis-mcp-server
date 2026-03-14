# CLAUDE.md - AIForge

## コマンド

```bash
npm test                    # vitest で全テスト実行
npm run lint:fix            # Oxlint で自動修正
npm run format              # Biome でフォーマット
npm run gen:types           # Zod スキーマから型定義を生成
npm run typecheck           # tsc --noEmit
# PR 前に必ず実行:
npm run gen:types && npm run typecheck
```

## 禁止事項

- `any` 型 → `unknown` + 型ガードで絞り込む（Oxlint が検出）
- `new Date()` → `lib/datetime.ts` の dayjs ラッパーを使う（banned-patterns が検出）
- `git commit --no-verify`（`.claude/settings.json` でブロック済み）
- 独自の可視化コード生成 → `.claude/rules/charting.md`

## アーキテクチャルール

- スキーマ変更は `src/schemas.ts`（Zod）を単一ソースとする
- 全ツールは `Result<T, M>` パターン（`ok()` / `fail()`）で返す
- ツール追加・修正 → `.claude/rules/tools.md`
- HTML の Tailwind → `.claude/rules/html.md`

## リポジトリルール

- `main` ブランチ保護。PR 経由でマージ。
- `.cursorrules` / `AGENTS.md` は `CLAUDE.md` への symlink。
