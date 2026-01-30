# CLAUDE.md - AIForge (bitbank-mcp-sandbox)

## プロジェクト概要

AIForge は bitbank 向け MCP（Model Context Protocol）サーバー。
生データ取得・加工・テクニカル分析・チャート描画・バックテストまでを AI に提供する。

## 技術スタック

- TypeScript（ES modules, tsx で実行）
- MCP SDK: `@modelcontextprotocol/sdk`
- Zod: パラメータバリデーション・スキーマ自動生成
- Sharp: 画像処理（SVG→PNG変換等）

## ビルド・実行

```bash
npm install
npm start            # tsx src/server.ts（stdio）
npm run dev          # LOG_LEVEL=debug で起動
npm run typecheck    # tsc --noEmit
npm run gen:types    # 型定義自動生成
```

## ディレクトリ構成

```
src/
  server.ts         - メインサーバー（ツール登録）
  prompts.ts        - MCP Prompts 定義
  schemas.ts        - Zod スキーマ（入出力）
  system-prompt.ts  - システムプロンプト
  http.ts           - HTTP サーバー（デバッグ用）
  handlers/         - リクエストハンドラ
  types/            - 型定義
  utils/            - ユーティリティ
tools/              - ツール実装（1ツール1ファイル）
lib/                - 共通ライブラリ（http, validate, result, formatter, datetime, error）
docs/               - ドキュメント
assets/             - サンプルSVG等
```

## ツールカテゴリ

詳細は `docs/tools.md` を参照。

### データ取得（生データ）
- get_ticker, get_tickers_jpy, get_candles, get_transactions, get_depth

### データ取得（加工）
- get_orderbook, get_orderbook_pressure, get_orderbook_statistics
- get_flow_metrics, get_volatility_metrics

### 分析
- analyze_indicators, analyze_market_signal, detect_patterns
- detect_macd_cross, analyze_macd_pattern, analyze_candle_patterns
- analyze_ichimoku_snapshot, analyze_bb_snapshot, analyze_sma_snapshot
- analyze_support_resistance, detect_whale_events

### バックテスト
- run_backtest_sma, run_backtest

### 表示
- render_chart_svg, render_depth_svg, render_candle_pattern_diagram

## チャート描画ルール

- チャート描画は必ず `tools/render_chart_svg.ts` を使用すること
- AI は独自に可視化コード（D3/Chart.js/Canvas/SVG等）を生成してはいけない
- Artifact は「ツールの出力（SVG文字列）」をそのまま表示する用途に限定

### ボリンジャーバンド
- デフォルト: ±2σ のみ（`--bb-mode=default`）
- 拡張: ±1σ/±2σ/±3σ（`--bb-mode=extended`）

### 一目均衡表
- デフォルト: 転換線・基準線・雲のみ
- 拡張: 遅行スパン追加（`--ichimoku-mode=extended`）

### SMA
- デフォルト: 描画しない
- 明示指定時のみ: `--sma=5,20,50`（利用可能: 5, 20, 25, 50, 75, 200）

## コーディング規約

- 1ツール1ファイル（`tools/` ディレクトリ）
- 共通ロジックは `lib/` に集約
- Result パターン: `ok()` / `fail()` でツール結果を返却
- エラー出力は日本語
- `ensurePair()` でペアバリデーション必須

## 参考

- bitbank 公開 API: https://github.com/bitbankinc/bitbank-api-docs/blob/master/public-api.md
- ツール詳細: docs/tools.md
- BBサンプル: assets/bb_light.svg
- 一目サンプル: assets/ichimoku_sample.svg

## メンテナンスルール

- `CLAUDE.md`（本体）と `.cursorrules` は同じ内容を維持すること。
- `AGENTS.md` は `CLAUDE.md` への symlink。
- 編集時は `CLAUDE.md` を更新し、`.cursorrules` にも反映する。
  - 同期コマンド: `cp CLAUDE.md .cursorrules`
