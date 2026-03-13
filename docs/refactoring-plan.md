# ディレクトリ構成リファクタリング計画

各ステップは独立してコミット可能。ビルドを壊さないよう段階的に進める。

---

## Step 1: 不要ファイルの削除

- `tools/index.ts` を削除（どこからもインポートされていない未使用バレルエクスポート）

**理由**: ゴミ掃除を最初にやると以降の作業が楽になる。
**リスク**: なし（未使用を確認済み）

---

## Step 2: テストを `tools/tests/` からルート `tests/` へ移動

現状: `tools/tests/` に60ファイル超のテストがあり、テスト対象は `tools/` だけでなく `lib/` や `src/` も含む。

- `tools/tests/` → `tests/` へ移動
- `tools/tests/lib/` → `tests/lib/` へ移動
- `tools/tests/private/` → `tests/private/` へ移動
- `tools/tests/fixtures/` → `tests/fixtures/` へ移動
- `vitest.config.ts` のパスを更新

**理由**: テストがツール実装ディレクトリに入っているのは不自然。`lib/` のテストまで `tools/tests/` にあるのは設計的に破綻している。
**リスク**: 低（import パスの書き換えが必要だが機械的作業）

---

## Step 3: CLI スクリプトを `scripts/` に統合

現状: `tools/*_cli.ts`（9ファイル）と `scripts/run_backtest_e2e.ts`（1ファイル）にCLIスクリプトが分散。

- `tools/*_cli.ts` → `scripts/` へ移動
- `tools/lib/cli-utils.ts` → `scripts/cli-utils.ts` へ移動（CLI専用ユーティリティなので）
- `tools/stat.ts`, `tools/report.ts` → `scripts/` へ移動（MCPツールではなくCLIスクリプト）
- `tools/gen_types.ts` → `scripts/` へ移動（コード生成スクリプト）
- `package.json` の `gen:types` スクリプトパスを更新

**理由**: 「MCPツール定義」と「開発用CLIスクリプト」が同じディレクトリにあるのが混乱の元。
**リスク**: 低（スタンドアロンスクリプトなので他からの依存なし）

---

## Step 4: `src/handlers/` の命名統一

現状: `*Handler.ts` と `*Views.ts` が混在。

- `analyzeCandlePatternsViews.ts` → `analyzeCandlePatternsHandler.ts` にリネーム
- `detectPatternsViews.ts` → `detectPatternsHandler.ts` にリネーム
- 各ファイル内のエクスポート名も統一
- インポート元を更新

**理由**: 同じ役割のファイルが2つの命名規則を持つのは初見殺し。
**リスク**: 低（インポートパスの書き換えのみ）

---

## Step 5: `src/utils/` を解消

現状: `src/utils/pattern-diagrams.ts` が1ファイルだけ孤立。

- `src/utils/pattern-diagrams.ts` → `lib/pattern-diagrams.ts` へ移動
- `tools/patterns/` 内の4ファイルのインポートパスを更新

**理由**: 1ファイルのためだけのディレクトリは認知負荷。既存の `lib/` に共有ユーティリティとして配置する方が自然。
**リスク**: 低（依存4ファイルのパス更新のみ）

---

## Step 6: `.d.ts` ファイルの整理

現状: `lib/` 内に手書き `.d.ts` が4つ、`src/types/schemas.generated.d.ts` が自動生成。区別がつかない。

- `schemas.generated.d.ts` を `.gitignore` に追加（生成物はVCS管理しない）
- `lib/*.d.ts`（手書き4ファイル）にコメントヘッダ `// Hand-written type declarations` を追加
  - もしくは各 `.ts` ファイルの型エクスポートで代替可能か検討し、不要なら削除

**理由**: 生成物と手書きが混在すると「触っていいのか」判断できない。
**リスク**: 低

---

## Step 7: package.json の name 統一

- `"name": "bb-mcp-sandbox"` → `"name": "bitbank-genesis-mcp-server"` に変更

**理由**: リポジトリ名・CLAUDE.md のプロジェクト説明と一致させる。
**リスク**: なし（private パッケージなので外部影響ゼロ）

---

## 対象外（今回はやらない）

以下は影響範囲が大きく、段階的に別PRで検討すべき：

- **`tools/patterns/` の移動**: `detect_patterns.ts` と密結合（12+ファイル）。移動するなら `lib/patterns/` が妥当だが、import 書き換えが大量になるため別途判断
- **`tools/trading_process/` の移動**: 独立サブパッケージ級だが、現状3箇所からの依存があり、移動先の設計議論が必要
- **`src/` と `tools/` の境界再設計**: ハンドラ分離パターン自体の見直しはアーキテクチャ判断を伴う
