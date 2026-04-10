# CLAUDE.md - AIForge

## コマンド

```bash
npm test                    # vitest で全テスト実行
npm run lint:fix            # Oxlint で自動修正
npm run format              # Biome でフォーマット
npm run gen:types           # Zod スキーマから型定義を生成
npm run typecheck           # tsc --noEmit
```

## コード品質

- リンター（Biome / Oxlint）・pre-commit hook・banned-patterns が検出するルールに従う。
  警告やエラーが出たら無視・回避せず修正する。
- 独自の可視化コード生成は禁止 → `.claude/rules/charting.md`

## アーキテクチャ

- スキーマ変更は `src/schemas.ts`（Zod）を単一ソースとする
- 全ツールは `Result<T, M>` パターン（`ok()` / `fail()`）で返す

## リポジトリルール

- `main` ブランチ保護。PR 経由でマージ。
- `AGENTS.md` は `CLAUDE.md` への symlink。
