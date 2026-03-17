---
globs: tools/render_*.ts, tools/prepare_*.ts, src/handlers/*chart*.ts, src/handlers/*render*.ts, src/prompts.ts
---

# チャート・可視化ポリシー

## 基本原則

チャートや可視化のデータは**必ず本プロジェクトのツール**から取得する。
LLM が独自にテクニカル指標（SMA・BB・一目均衡表等）を計算してはいけない。

## 描画パス

### 1. サーバー側 SVG 生成（ファイル保存・Cursor 向け）

- `render_chart_svg` — ローソク足・ライン・BB・一目均衡表・SMA 等
- `render_depth_svg` — 板の深度チャート
- `render_candle_pattern_diagram` — ローソク足パターン図解

Cursor では `savePng: true` + ワークスペース内の `outputDir` を推奨。

### 2. Visualizer 描画（Claude 会話内インライン表示）

`prepare_chart_data` の出力を使い、LLM が Visualizer（HTML/SVG/Chart.js）で描画する。

- 指標値はすべて `prepare_chart_data` が計算済みで返す
- LLM は受け取った配列をプロットするだけ（計算しない）
- 一目均衡表の先行スパン・遅行スパンのシフトも適用済み

### 禁止事項

- LLM が独自にテクニカル指標を計算すること（`prepare_chart_data` を使う）
- 開発者が独自に可視化コード（D3 / Chart.js / Canvas / SVG 等）をツール実装内に生成すること

## 例外

- おはようレポート（`src/prompts.ts` の ohayo）では `<svg><polyline>` 簡易スパークラインをインライン生成してよい
