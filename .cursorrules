# CLAUDE.md - AIForge (bitbank-mcp-sandbox)

## プロジェクト概要

bitbank 暗号資産取引所の MCP サーバー。40+ ツールでリアルタイム市場データ取得・テクニカル分析・チャート描画・バックテストを提供。

## 技術スタック

- **言語**: TypeScript 5.9（strict モード）
- **ランタイム**: Node.js 20+（Docker は Node 22-alpine）
- **フレームワーク**: Express 5（HTTP トランスポート用）
- **MCP SDK**: @modelcontextprotocol/sdk
- **バリデーション**: Zod（`src/schemas.ts` が単一ソース）
- **CLI 実行**: tsx / **日時処理**: dayjs

## bash コマンド

```bash
npm start                   # MCP サーバー（stdio）
npm run dev                 # デバッグモード（LOG_LEVEL=debug）
npm run http                # HTTP サーバー
npm run gen:types           # Zod スキーマから型定義を生成
npm run typecheck           # tsc --noEmit
npm run build               # gen:types + typecheck
npm test                    # tools/tests/test_get_tickers_jpy.ts を実行

# PR 前に必ず実行
npm run sync:manifest && npm run sync:prompts && npm run gen:types && npm run typecheck
```

## 重要なファイル

| パス | 役割 |
|------|------|
| `src/server.ts` | MCP サーバー本体（自動登録ループ・トランスポート） |
| `src/tool-registry.ts` | **全ツール定義の集約**（allToolDefs 配列） |
| `src/schemas.ts` | Zod スキーマ定義（**単一ソース**） |
| `tools/` | 各ツール実装（40+ ファイル）＋ `toolDef` エクスポート |
| `src/handlers/` | 複雑なハンドラロジック（100行超のツール用） |
| `lib/` | 共有ユーティリティ（`result.ts`, `validate.ts`, `http.ts`, `datetime.ts` 等） |

## コードスタイル・規約

- ESLint / Prettier 無し。TypeScript strict モードで型安全を担保。
- 全ツールは `Result<T, M>` パターン（`ok()` / `fail()`）で返す。
- スキーマ変更は `src/schemas.ts` を起点（Zod が単一ソース）。
- 日時処理は `lib/datetime.ts` を使用（`new Date` は避ける）。

## ツール追加・修正

ツールは各ファイルが `toolDef` をエクスポート → `src/tool-registry.ts` が集約 → `src/server.ts` が自動登録。
**server.ts を直接編集する必要はない。**

### 新規追加

1. `tools/<name>.ts` に実装 + `export const toolDef: ToolDefinition = { name, description, inputSchema, handler }`
   - ハンドラが100行超なら `src/handlers/<name>Handler.ts` に分離
2. `src/tool-registry.ts` の `allToolDefs` に追加
3. `npm run sync:manifest && npm run typecheck`

### 既存修正

`tools/<name>.ts` か `src/handlers/<name>Handler.ts` の `toolDef` を編集するだけ。server.ts 不要。

## CI (GitHub Actions)

`main` への push / PR → `npm ci` → `gen:types` → `typecheck`

## リポジトリルール

- `main` ブランチ保護。PR 経由でマージ。
- `CLAUDE.md` が正。編集後 `cp CLAUDE.md .cursorrules` で同期。
- `AGENTS.md` は `CLAUDE.md` への symlink。

---

## AI 利用ポリシー

### チャート・可視化

AI はチャートや可視化を求められた場合、**必ず本プロジェクトの描画ツールを使うこと**。
独自に可視化コード（D3 / Chart.js / Canvas / SVG 等）を生成してはいけない。

| ツール | ファイル | 用途 |
|--------|----------|------|
| `render_chart_svg` | `tools/render_chart_svg.ts` | ローソク足・ライン・BB・一目均衡表・SMA 等 |
| `render_depth_svg` | `tools/render_depth_svg.ts` | 板の深度チャート |
| `render_candle_pattern_diagram` | `tools/render_candle_pattern_diagram.ts` | ローソク足パターン図解 |

Cursor では `savePng: true` + ワークスペース内の `outputDir` を推奨（ワークスペース外はパスがクリック不可）。

### HTML 出力時の Tailwind CSS

- `cdn.tailwindcss.com`（Play CDN）は**使用禁止**。
- `<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">` を使う。
- `bg-opacity-*`, `bg-[#xxx]`, `backdrop-*`, `ring-*` は非対応。`<style>` ブロックか `style` 属性で代替。
