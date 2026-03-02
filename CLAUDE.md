# CLAUDE.md - bitbank-genesis-mcp-server

## プロジェクト概要

bitbank 暗号資産取引所の **MCP サーバー**。bitbank 公開 API（認証不要）をデータソースとし、LLM が暗号資産の市場分析を行うための **22 ツール + 9 プロンプト** を提供する。

ツールは大きく 2 層に分かれる。

- **生データ取得**（Raw）— API の応答をそのまま、または軽量整形して返すツール
- **加工・分析**（Processed）— 生データから指標計算・パターン検出・スコアリング・可視化まで行い、LLM が即座に解釈できる形で返すツール

この 2 層設計により、LLM がローソク足の数値を自力で計算する必要がなく、ハルシネーションを防ぎながら質の高い分析を提供できる。

## ツール一覧（22 ツール）

### A. データ取得 — 生（Raw）：7 ツール

API から取得したデータを整形して返す。計算・判定は行わない。

| ツール | 概要 |
|--------|------|
| `get_ticker` | 単一ペアのティッカー（価格・24h 高安・出来高） |
| `get_tickers_jpy` | 全 JPY ペアのティッカー一括取得（ランキング表示可、10s キャッシュ） |
| `get_orderbook` | 板情報（4 モード: summary / pressure / statistics / raw） |
| `get_depth` | 板の生深度データ（asks/bids 配列＋ゾーン推定） |
| `get_candles` | ローソク足 OHLCV（11 時間軸: 1min〜1month） |
| `get_transactions` | 約定履歴（直近 60 件 or 日付指定、フィルタ可） |
| `get_flow_metrics` | 約定ベースのフロー集計（CVD・買売比率・スパイク検出） |

### B. データ取得 — 加工（Processed）：1 ツール

生データに統計計算を加えて返す。

| ツール | 概要 |
|--------|------|
| `get_volatility_metrics` | ボラティリティ算出（RV / ATR / Parkinson / GK / RS） |

### C. テクニカル分析：7 ツール

ローソク足・板データから指標計算・スナップショットを生成。

| ツール | 概要 |
|--------|------|
| `analyze_indicators` | 統合指標（SMA / RSI / BB / 一目 / MACD / StochRSI） |
| `analyze_bb_snapshot` | ボリンジャーバンド数値スナップ（z-score・帯幅・スクイーズ判定） |
| `analyze_ichimoku_snapshot` | 一目均衡表スナップ（雲との位置関係・転換/基準線・雲の傾き） |
| `analyze_sma_snapshot` | SMA スナップ（クロス検出・整列状態・傾き） |
| `analyze_support_resistance` | サポレジ自動検出（接触回数・強度・崩壊実績） |
| `analyze_candle_patterns` | ローソク足パターン検出（1〜3 本: ハンマー/包み足/三兵 等） |
| `analyze_macd_pattern` | MACD クロス forming 検出＋過去統計（完了率推定・勝率） |

### D. 総合判定・スクリーニング：1 ツール

複数指標を統合してスコアを算出。

| ツール | 概要 |
|--------|------|
| `analyze_market_signal` | 統合トリアージスコア（-100〜+100）。構成: buyPressure 35% / cvdTrend 25% / momentum 15% / volatility 10% / smaTrend 15% |

### E. パターン検出：3 ツール

| ツール | 概要 |
|--------|------|
| `detect_patterns` | 大型チャートパターン（ダブルトップ/H&S/三角等 13 種、forming/completed/invalid 状態管理） |
| `detect_macd_cross` | MACD クロス済み銘柄の全 JPY ペアスクリーニング |
| `detect_whale_events` | 大口注文検出（板×ローソク足。蓄積/分配圧力判定） |

### F. 可視化（SVG 生成）：3 ツール

| ツール | 概要 |
|--------|------|
| `render_chart_svg` | メインチャート（ローソク足/ライン + SMA/BB/一目/MACD/RSI/出来高オーバーレイ） |
| `render_depth_svg` | 板の深度チャート（累積 bid/ask カーブ） |
| `render_candle_pattern_diagram` | ローソク足パターン教育図（analyze_candle_patterns の結果を図解） |

### G. バックテスト：1 ツール

| ツール | 概要 |
|--------|------|
| `run_backtest` | 戦略バックテスト（SMA クロス / RSI / MACD / BB ブレイクアウト。フィルタ付き。P&L + チャート SVG 一括返却） |

## プロンプト（9 種）

MCP Prompts として登録。LLM が自律的に選択する。

| プロンプト | レベル | 用途 |
|-----------|--------|------|
| `beginner_market_check` | 初心者 | 「上がる？」「買い時？」→ やさしい総合判定 |
| `beginner_chart_view` | 初心者 | 「チャート見せて」→ 見方の解説付きチャート |
| `explain_term` | 初心者 | 「RSI って何？」→ 日常の例えで用語解説 |
| `getting_started` | 初心者 | 「何ができるの？」→ 機能紹介 |
| `bb_default_chart` | 中級 | BB ±2σ チャート |
| `bb_extended_chart` | 中級 | BB 拡張版チャート |
| `ichimoku_default_chart` | 中級 | 一目均衡表チャート |
| `candles_only_chart` | 中級 | ローソク足のみチャート |
| `morning_report` | 中級 | おはようレポート（寝ている間の相場変動キャッチアップ） |

## 技術スタック

- **言語**: TypeScript 5.9（strict モード）
- **ランタイム**: Node.js 20+（Docker は Node 22-alpine）
- **フレームワーク**: Express 5（HTTP トランスポート用）
- **MCP SDK**: @modelcontextprotocol/sdk
- **バリデーション**: Zod（`src/schemas.ts` が単一ソース）
- **CLI 実行**: tsx / **日時処理**: dayjs
- **テスト**: Vitest

## bash コマンド

```bash
npm start                   # MCP サーバー（stdio）
npm run dev                 # デバッグモード（LOG_LEVEL=debug）
npm run http                # HTTP サーバー
npm run gen:types           # Zod スキーマから型定義を生成
npm run typecheck           # tsc --noEmit
npm run build               # gen:types + typecheck
npm test                    # Vitest（全テスト）

# PR 前に必ず実行
npm run gen:types && npm run typecheck
```

## アーキテクチャ

### ディレクトリ構成

| パス | 役割 |
|------|------|
| `src/server.ts` | MCP サーバー本体（自動登録ループ・stdio/HTTP トランスポート） |
| `src/tool-registry.ts` | **全ツール定義の集約**（allToolDefs 配列） |
| `src/schemas.ts` | Zod スキーマ定義（**単一ソース**） |
| `src/prompts.ts` | MCP プロンプト定義 + 用語解説データベース |
| `src/system-prompt.ts` | システムプロンプト（ユーザーレベル判定・応答ガイドライン） |
| `tools/` | 各ツール実装＋ `toolDef` エクスポート |
| `src/handlers/` | 複雑なハンドラロジック（100 行超のツール用） |
| `lib/` | 共有ユーティリティ（`result.ts`, `validate.ts`, `http.ts`, `datetime.ts` 等） |

### 設計パターン

- **Result パターン**: 全ツールは `ok(summary, data, meta)` / `fail(message, type, meta)` で返す。例外は投げない。
- **Zod 単一ソース**: `src/schemas.ts` → `npm run gen:types` で型を自動生成。手動で型を書かない。
- **自動登録**: `toolDef` エクスポート → `tool-registry.ts` が集約 → `server.ts` がループ登録。server.ts を直接編集する必要はない。
- **ハンドラ分離**: 100 行超のハンドラは `src/handlers/<name>Handler.ts` に切り出す。

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
3. `npm run gen:types && npm run typecheck`

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
