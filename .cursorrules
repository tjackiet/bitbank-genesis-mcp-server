# CLAUDE.md - AIForge (bitbank-mcp-sandbox)

## プロジェクト概要

bitbank 暗号資産取引所の MCP (Model Context Protocol) サーバー。
40+ のツールを通じてリアルタイム市場データ取得・テクニカル分析・チャート描画・バックテストを提供する。

## 技術スタック

- **言語**: TypeScript 5.9（strict モード）
- **ランタイム**: Node.js 20+（Docker は Node 22-alpine）
- **フレームワーク**: Express 5（HTTP トランスポート用）
- **MCP SDK**: @modelcontextprotocol/sdk
- **バリデーション**: Zod（`src/schemas.ts` が単一ソース）
- **CLI 実行**: tsx
- **日時処理**: dayjs

## よく使う bash コマンド

```bash
# サーバー起動
npm start                   # MCP サーバー（stdio）
npm run dev                 # デバッグモード（LOG_LEVEL=debug）
npm run http                # HTTP サーバー

# 型生成 & チェック
npm run gen:types           # Zod スキーマから型定義を生成
npm run typecheck           # tsc --noEmit
npm run build               # gen:types + typecheck

# テスト
npm test                    # tools/tests/test_get_tickers_jpy.ts を実行

# 同期・生成
npm run sync:manifest       # schemas.ts → manifest.json
npm run sync:prompts        # server.ts の登録 → prompts.json

# チャート描画 CLI
npx tsx tools/render_chart_svg_cli.ts <pair> <type> <limit> [--flags]

# PR 前に必ず実行
npm run sync:manifest && npm run sync:prompts && npm run gen:types && npm run typecheck
```

## 重要なファイル・ディレクトリ

| パス | 役割 |
|------|------|
| `src/server.ts` | MCP サーバー本体（ツール・プロンプト登録） |
| `src/schemas.ts` | Zod スキーマ定義（**単一ソース**） |
| `src/prompts.ts` | MCP プロンプト定義 |
| `src/http.ts` | Express HTTP トランスポート |
| `tools/` | 各ツール実装（40+ファイル） |
| `tools/render_chart_svg.ts` | チャート描画（**AI は必ずこれを使う**） |
| `tools/tests/` | テストファイル |
| `lib/` | 共有ユーティリティ |
| `lib/validate.ts` | ペア名・リミット等のバリデーション |
| `lib/result.ts` | `ok()` / `fail()` 結果ラッパー |
| `lib/http.ts` | `fetchJson()` HTTP リクエスト＋リトライ |
| `lib/logger.ts` | JSONL ロガー |
| `lib/formatter.ts` | 価格・ペア名フォーマット |
| `lib/datetime.ts` | 日時処理（dayjs ベース） |

## コードスタイル・規約

- ESLint / Prettier の設定ファイルは無い。TypeScript strict モードによる型安全を重視。
- 全ツールは `Result<T, M>` パターン（`ok()` / `fail()`）で値を返す。
- スキーマ変更は必ず `src/schemas.ts` を起点とする（Zod が単一ソース）。
- ツールの入出力は Zod スキーマで検証する。
- ログは JSONL 形式（`lib/logger.ts`）。
- 日時処理は `lib/datetime.ts` の関数を使用（`new Date` は避ける）。

## テストの実行方法

```bash
npm test
```
- テストファイル: `tools/tests/test_get_tickers_jpy.ts`
- 現状は tsx による直接実行。専用テストフレームワーク（Jest 等）は未導入。

## 開発フロー

1. `src/schemas.ts` を更新（Zod スキーマ）
2. `npm run gen:types` で型定義を生成
3. ツール / サーバーの実装を更新
4. `npm run typecheck` で型チェック
5. PR 前に `sync:manifest` / `sync:prompts` / `gen:types` / `typecheck` を実行

## CI (GitHub Actions)

- トリガー: `main` への push / PR
- Node 20 + npm キャッシュ
- ステップ: `npm ci` → `gen:types` → `typecheck`

## リポジトリルール

- ブランチ戦略: `main` ブランチを保護。PR 経由でマージ。
- `CLAUDE.md`（本ファイル）が正とし、`.cursorrules` へコピーで同期する。
- `AGENTS.md` は `CLAUDE.md` への symlink。

## 環境変数

```bash
PORT=3000              # HTTP サーバーポート
LOG_DIR=./logs         # ログ出力先
LOG_LEVEL=info         # error | warn | info | debug
MCP_ENABLE_HTTP=1      # HTTP トランスポート有効化
```

## セットアップ手順

```bash
git clone <repo>
cd bitbank-genesis-mcp-server
cp .env.example .env        # 必要に応じて編集
npm install                 # 依存インストール（postinstall で assets もコピー）
npm run gen:types           # 型定義を生成
npm run typecheck           # 型チェック確認
npm start                   # サーバー起動
```

---

## チャート・可視化に関する AI 利用ポリシー

AI（Claude / GPT）はチャートや可視化を求められた場合、**必ず本プロジェクトの描画ツールを使うこと**。
独自に可視化コード（D3 / Chart.js / Canvas / SVG 等）を生成してはいけない。
Artifact は「ツールの出力（SVG 文字列）」をそのまま表示する用途に限定する。

### 描画ツール一覧

| ツール | ファイル | 用途 |
|--------|----------|------|
| `render_chart_svg` | `tools/render_chart_svg.ts` | ローソク足・ライン・BB・一目均衡表・SMA 等メインチャート |
| `render_depth_svg` | `tools/render_depth_svg.ts` | 板の深度チャート |
| `render_candle_pattern_diagram` | `tools/render_candle_pattern_diagram.ts` | ローソク足パターン図解（教育用） |

- BB / 一目均衡表 / SMA のオプション詳細は `tools/render_chart_svg.ts` 先頭の JSDoc を参照。
- 大きな変更を行う場合は README の該当箇所も更新すること。

## メンテナンスルール

- `CLAUDE.md`（本体）と `.cursorrules` は同じ内容を維持すること。
- `AGENTS.md` は `CLAUDE.md` への symlink。
- 編集時は `CLAUDE.md` を更新し、`.cursorrules` にも反映する。
  - 同期コマンド: `cp CLAUDE.md .cursorrules`
